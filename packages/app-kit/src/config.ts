/**
 * 应用接入配置派生 —— **纯函数，零 import**（可被 Node 直接单测）。
 *
 * 本文件承载「配置化接入」的全部决策逻辑：给定「应用选项 + 运行时 app-config.json + 当前 origin」，
 * 派生出完整的接入配置。把决策逻辑与 Vue / axios / 组件完全解耦，
 * 是为了让「配置优先级」「路径拼接」「令牌键派生」这些最容易出错、也最容易被复制粘贴搞歪的部分
 * **可以被独立验证**（历史事故：`/kb/kb/dashboard` 双前缀、token key 前缀三份各不相同）。
 *
 * 优先级铁律（与 `docs/CONFIG-REFERENCE.md` 一致）：
 *   显式选项 > 运行时 app-config.json > 编译期 env > 内置默认
 */

/** 内置默认值 —— 与平台基线一致，改这里等于改全平台默认。 */
export const DEFAULTS = {
  issuer: 'https://auth.marschat.online',
  loginPath: '/login',
  callbackPath: '/sso-callback',
  usersPath: '/users',
  homePath: '/dashboard',
  sessionProbeIntervalMs: 60_000,
} as const

/** 免检 / 不触发续期的路径（守卫与 401 拦截器共用）。 */
export const DEFAULT_WHITE_LIST_PATHS = [
  '/login',
  '/sso-callback',
  '/forgot-password',
  '/reset-password',
] as const

/** 令牌存储键集合。 */
export interface TokenKeys {
  accessTokenKey: string
  refreshTokenKey: string
  tokenKindKey: string
  idTokenKey: string
}

/** 运行时配置（`public/app-config.json`，由 apps-registry.yml 派生）。 */
export interface RuntimeConfig {
  clientId?: string
  issuer?: string
  contextPath?: string
  apiBase?: string
  authApiBase?: string
  entry?: string
}

/** 会话模式：`oidc` = 浏览器直接持中心 OIDC token；`bff` = 服务端换票（如 portal）。 */
export type SessionMode = 'oidc' | 'bff'

/** 调用方传入的接入选项（全部可选，除 appId）。 */
export interface AppOptionsInput {
  appId: string
  contextPath?: string
  apiBase?: string
  authApiBase?: string
  issuer?: string
  clientId?: string
  loginPath?: string
  callbackPath?: string
  usersPath?: string | false
  homePath?: string
  sessionMode?: SessionMode
  tokenKeyPrefix?: string
  sessionProbeIntervalMs?: number
  whiteListPaths?: string[]
  /** 平台超管恒放行（默认 true）。 */
  adminBypass?: boolean
}

/** 派生结果。 */
export interface ResolvedAppConfig {
  appId: string
  clientId: string
  issuer: string
  contextPath: string
  apiBase: string
  authApiBase: string
  redirectUri: string
  loginUrl: string
  homePath: string
  loginPath: string
  callbackPath: string
  usersPath: string | false
  sessionMode: SessionMode
  tokenKeys: TokenKeys
  sessionProbeIntervalMs: number
  whiteListPaths: string[]
}

/**
 * 归一化部署前缀。
 *
 * `''` / `'/'` → `'/'`（根部署）；`'kb'` → `'/kb'`；`'/kb/'` → `'/kb'`。
 * 归一化是必须的 —— 下游拼 URL 时若拿到 `'kb'`（无前导斜杠）或 `'/kb/'`（尾斜杠），
 * 会产出 `/kbkb/...` 或 `/kb//sso-callback` 这类畸形路径。
 */
export function normalizeContextPath(raw?: string | null): string {
  if (raw === undefined || raw === null) {
    return '/'
  }
  let p = String(raw).trim()
  if (p === '' || p === '/') {
    return '/'
  }
  if (!p.startsWith('/')) {
    p = '/' + p
  }
  while (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1)
  }
  return p
}

/**
 * 部署前缀的「拼接片段」：根部署返回 `''`，子路径返回 `'/kb'`。
 * 用于 `origin + base + path` 拼站内绝对地址（避免根部署拼出 `//login`）。
 */
export function baseFragment(contextPath: string): string {
  return contextPath === '/' ? '' : contextPath
}

/**
 * 由 client_id 派生 localStorage 令牌键。
 *
 * 默认前缀 = 去掉 `marschat-` 前缀并做字符净化：
 * `marschat-kbweb` → `kbweb_`；`cosmic-studio` → `cosmic_studio_`。
 * 存量应用迁移时用 `tokenKeyPrefix` 显式传入旧前缀（如 `'kb_'`），保证老用户登录态不丢。
 */
export function deriveTokenKeys(appId: string, prefix?: string): TokenKeys {
  const p = prefix && prefix.length > 0
    ? prefix
    : appId.replace(/^marschat-/, '').replace(/[^a-zA-Z0-9]+/g, '_') + '_'
  return {
    accessTokenKey: `${p}access_token`,
    refreshTokenKey: `${p}refresh_token`,
    tokenKindKey: `${p}token_kind`,
    idTokenKey: `${p}id_token`,
  }
}

/** 三态取值：显式选项 > 运行时配置 > 内置默认。 */
function pick<T>(option: T | undefined, runtime: T | undefined, fallback: T): T {
  if (option !== undefined && option !== null && option !== ('' as unknown as T)) {
    return option
  }
  if (runtime !== undefined && runtime !== null && runtime !== ('' as unknown as T)) {
    return runtime
  }
  return fallback
}

/**
 * 派生完整接入配置。
 *
 * @param options 调用方选项（`appId` 必填）
 * @param runtime `public/app-config.json` 内容（缺失时传 `{}`）
 * @param origin  当前站点 origin（浏览器传 `window.location.origin`；测试可注入固定值）
 */
export function resolveAppConfig(
  options: AppOptionsInput,
  runtime: RuntimeConfig = {},
  origin = 'http://localhost',
): ResolvedAppConfig {
  if (!options || !options.appId) {
    throw new Error('[marschat-app-kit] createMarschatApp 缺少 appId（应为 apps-registry.yml 的 client-id）')
  }

  const contextPath = normalizeContextPath(
    pick(options.contextPath, runtime.contextPath, '/'),
  )
  const clientId = pick(options.clientId, runtime.clientId, options.appId)
  const issuer = pick(options.issuer, runtime.issuer, DEFAULTS.issuer)
  const base = baseFragment(contextPath)

  const apiBase = pick(options.apiBase, runtime.apiBase, `${base}/api`)
  const authApiBase = pick(options.authApiBase, runtime.authApiBase, `${apiBase}/auth`)

  const loginPath = pick(options.loginPath, undefined, DEFAULTS.loginPath)
  const callbackPath = pick(options.callbackPath, undefined, DEFAULTS.callbackPath)
  const homePath = pick(options.homePath, undefined, DEFAULTS.homePath)
  const usersPath = options.usersPath === undefined ? DEFAULTS.usersPath : options.usersPath

  const sessionMode: SessionMode = options.sessionMode ?? 'oidc'
  const sessionProbeIntervalMs = options.sessionProbeIntervalMs ?? DEFAULTS.sessionProbeIntervalMs

  const whiteListPaths = options.whiteListPaths && options.whiteListPaths.length > 0
    ? Array.from(new Set([...DEFAULT_WHITE_LIST_PATHS, ...options.whiteListPaths]))
    : [...DEFAULT_WHITE_LIST_PATHS]

  return {
    appId: options.appId,
    clientId,
    issuer: issuer.replace(/\/+$/, ''),
    contextPath,
    apiBase,
    authApiBase,
    // 回调地址必须与 apps-registry.yml 登记的 redirect-uris 逐字一致，否则中心拒绝
    redirectUri: `${origin}${base}${callbackPath}`,
    loginUrl: `${origin}${base}${loginPath}`,
    homePath,
    loginPath,
    callbackPath,
    usersPath,
    sessionMode,
    tokenKeys: deriveTokenKeys(options.appId, options.tokenKeyPrefix),
    sessionProbeIntervalMs,
    whiteListPaths,
  }
}

/** 站内绝对路径（带部署前缀），用于跨页跳转与 SLO 回跳。 */
export function appUrl(config: Pick<ResolvedAppConfig, 'contextPath'>, path: string, origin = ''): string {
  const base = baseFragment(config.contextPath)
  const p = path.startsWith('/') ? path : `/${path}`
  return `${origin}${base}${p}`
}

/**
 * 从当前地址推导「路由内路径」（剥离部署前缀）。
 *
 * 🔴 这是历史事故「`/kb/kb/dashboard` 双前缀 404」的根治点：
 * vue-router 的 base 已含部署前缀，`router.replace()` 必须传**路由内路径**；
 * 若把 `window.location.pathname`（含前缀）直接传进去，就会二次拼接。
 */
export function toRouterPath(config: Pick<ResolvedAppConfig, 'contextPath'>, pathname: string): string {
  const base = baseFragment(config.contextPath)
  let p = pathname || '/'
  if (base && (p === base || p.startsWith(base + '/'))) {
    p = p.slice(base.length)
  }
  if (!p.startsWith('/')) {
    p = '/' + p
  }
  return p === '' ? '/' : p
}
