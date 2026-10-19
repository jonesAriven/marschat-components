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

/**
 * 运行时配置 `app-config.json` 的**探测候选基址**（纯函数，可单测）。
 *
 * 🔴 缺陷背景（2026-10-17 多轮浏览器实测）：此前 `readRuntimeConfig()` 恒以 `/` 为基址，
 *    对 **context-path 部署**的应用（`/kb` `/ops` `/infra` `/portal`）必然 404 ⇒ 返回 `{}`，
 *    后果是 `apps-registry.yml` 派生的运行时配置**整份静默失效**（不报错，只是永远回落
 *    内置默认 / 编译期 env），控制台还长期挂一条 404。正是手册里「不报错但功能坏」那一类。
 *
 * 候选顺序（首个返回 200 且能解析为对象者胜）：
 *   ① 显式 `baseUrl` 且**不等于 `/`**（调用方明确知道部署前缀时，最可靠、零 404）
 *   ② 当前 `pathname` 的**完整目录**（`/a/b/login` → `/a/b/`）—— 覆盖多级前缀
 *   ③ `pathname` 的**首段**（`/infra/login` → `/infra/`）—— 覆盖单级前缀（绝大多数）
 *   ④ `/`（根部署，恒为最后一个候选）
 *
 * ⚠️ 两条顺序铁律：
 *   a. **完整目录必须先于首段** —— 否则多级前缀应用可能误命中上级应用自己的
 *      `app-config.json`（拿错配置比拿不到更危险）。
 *   b. **`/` 恒在最后** —— 显式传 `/` 视为「未指定」（它就是本函数的默认值）。
 *      若把 `/` 排在最前，context-path 应用会先打一发必然 404 的根请求，
 *      控制台长期挂一条 404（本次实测的可见症状）。
 */
export function runtimeConfigCandidates(baseUrl?: string, pathname?: string): string[] {
  const out: string[] = []
  const push = (raw?: string): void => {
    if (!raw) return
    const withSlash = raw.startsWith('/') ? raw : `/${raw}`
    const normalized = withSlash.endsWith('/') ? withSlash : `${withSlash}/`
    if (!out.includes(normalized)) out.push(normalized)
  }
  const explicit = baseUrl && baseUrl !== '/' ? baseUrl : undefined
  push(explicit)
  const segments = (pathname || '/').split('/').filter(Boolean)
  if (segments.length >= 2) {
    push(`/${segments.slice(0, -1).join('/')}`)   // 完整目录（去掉最后一段「页面名」）
  }
  if (segments.length >= 1) {
    push(`/${segments[0]}`)                        // 首段前缀
  }
  push('/')
  return out
}

/**
 * 运行时配置读取的**纯函数化拆分**（0.1.7）。
 *
 * 🔴 缺陷背景（坑 #41；R7–R11 五轮浏览器回归反复出现）：
 * 此前 `readRuntimeConfig()` 的失败路径**完全静默** —— 所有候选都拿不到配置时直接 `return {}`，
 * 调用方回落编译期内置默认值：**不抛错、不 warn**，控制台只有一条不含 URL 的 404。
 * 于是每轮回归都要人工翻 Network 记录、逐条比对 URL 才能定性
 * 「这份应用的运行时配置其实整份没生效」，同一份取证成本连付五轮；
 * 而 root cause（子路径应用以 `/` 为基址）早在 0.1.5 就在公共包修好了 ——
 * 现象照旧，是因为**失效本身不可见**。
 *
 * 拆分原则：**IO（XHR）与「判定 + 文案」分离**，判定与文案都是纯函数，可零依赖单测。
 * 判据**逐字保留**旧实现（`200 + 非对象 ⇒ 不算成功`），只是不再「不作声地 continue」。
 */

/** 单个候选探测的失败归因。 */
export type RuntimeConfigFailureReason =
  /** HTTP 状态非 200（最常见：context-path 应用打到了根路径）。 */
  | 'http-not-200'
  /** 200 但响应体为空（剥掉 `//` 横幅后为空也算）。 */
  | 'empty-body'
  /** 200 且 JSON 合法，但顶层**不是对象**（数组 / 字符串 / 数字 / `null`）。 */
  | 'not-an-object'
  /** JSON 解析失败（含 SPA try_files 回的 `index.html`、未剥净的 `//` 横幅）。 */
  | 'parse-error'

/** 一次**失败**探测的记录 —— 告警文案的唯一数据源。 */
export interface RuntimeConfigAttempt {
  /** 完整探测地址（含 `app-config.json`），便于直接贴进浏览器地址栏复核。 */
  url: string
  /** HTTP 状态码；请求本身抛错时为 0。 */
  status: number
  reason: RuntimeConfigFailureReason
}

/** 探测器的返回形态（纯数据，便于测试注入假实现）。 */
export interface RuntimeConfigProbeResult {
  status: number
  body: string
}

/** 同步探测一个 URL（生产实现是同步 XHR；测试注入纯函数）。 */
export type RuntimeConfigProbe = (url: string) => RuntimeConfigProbeResult

/** 一次完整探测的结果。 */
export interface RuntimeConfigLoadResult {
  /** 命中的运行时配置；**全败时为 `null`**（调用方据此回落 `{}`）。 */
  config: RuntimeConfig | null
  /** 失败记录；**成功路径恒为空数组**（调用方据此不产生任何日志）。 */
  attempts: RuntimeConfigAttempt[]
  /**
   * 需要输出的告警文案（**单条**）。
   *
   * 🔴 只在**全部候选都失败**时才非空；成功路径恒为空串。
   *    候选探测本来就会产生若干 404，逐条 warn 会淹掉控制台，
   *    所以这里**聚合成一条**，每条 URL 与其归因都列在文案里。
   */
  warning: string
}

/** 剥掉生成器产物的 `// AUTO-GENERATED ...` 横幅（它不是合法 JSON）。 */
function stripRuntimeConfigBanner(raw?: string | null): string {
  return String(raw ?? '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 解析运行时配置文本（纯函数，不抛异常）。
 *
 * ⚠️ 判据与 0.1.6 逐字一致，**不得放宽**：
 *   ① 先剥 `//` 横幅 → ② `JSON.parse` → ③ **顶层必须是对象**（非数组、非 null）。
 *   ③ 是踩坑换来的：SPA 的 `try_files` 兜底会把任意 404 路径回成 `index.html`
 *   （状态 200、内容 HTML），拿到非对象就必须判失败，否则等于拿 HTML 当配置。
 *
 * @returns 解析成功返回配置对象；空串 / null / undefined / 非法 JSON / 非对象一律 `null`
 */
export function parseRuntimeConfig(raw?: string | null): RuntimeConfig | null {
  const text = stripRuntimeConfigBanner(raw)
  if (text.trim() === '') {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return null                       // 非法 JSON（含 HTML）—— 不抛异常，交由调用方换下一个候选
  }
  // 🔴 必须判对象：数组 / 字符串 / 数字 / `null` 都不是合法配置
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as RuntimeConfig
  }
  return null
}

/**
 * 判定「解析失败」的**具体归因**（供告警文案归因）。
 *
 * 与 `parseRuntimeConfig` 共用 `stripRuntimeConfigBanner`，判据无第二套实现：
 * 剥横幅后为空 ⇒ `empty-body`；`JSON.parse` 抛错 ⇒ `parse-error`；
 * 能解析但仍被判失败 ⇒ 只可能是「不是对象」。
 */
export function classifyRuntimeConfigFailure(raw?: string | null): RuntimeConfigFailureReason {
  const text = stripRuntimeConfigBanner(raw)
  if (text.trim() === '') {
    return 'empty-body'
  }
  try {
    JSON.parse(text) as unknown
  } catch {
    return 'parse-error'
  }
  return 'not-an-object'
}

/** 失败归因 → 中文说明。 */
const RUNTIME_CONFIG_REASON_TEXT: Record<RuntimeConfigFailureReason, string> = {
  'http-not-200': 'HTTP 状态非 200（该地址下没有 app-config.json）',
  'empty-body': '响应体为空（200 但没有任何内容）',
  'not-an-object': '响应体是 JSON 但顶层不是对象（数组 / null 等，不是合法配置）',
  'parse-error': 'JSON 解析失败（多半是 SPA try_files 回的 index.html，或未剥净的 // 横幅）',
}

/**
 * 把失败探测记录拼成**一条**可操作的中文告警（纯函数）。
 *
 * 文案三要素：① 每个探测过的**完整 URL** 与其失败原因；② 明确说明「已回落内置默认值」；
 * ③ 给出可操作提示（`contextPath` / `apiBase` 是否登记、`gen-from-registry.py` 是否跑过）。
 *
 * @returns attempts 为空数组时返回**空字符串**（调用方据此跳过日志，保持控制台干净）
 */
export function formatRuntimeConfigWarning(attempts: RuntimeConfigAttempt[]): string {
  if (!attempts || attempts.length === 0) {
    return ''
  }
  const head = '[marschat-app-kit] 运行时配置 app-config.json 未取到，已回落内置默认值'
    + '（本次启动的运行时配置整份不生效）。'
  const detail = attempts.map((attempt, index) => {
    const reason = RUNTIME_CONFIG_REASON_TEXT[attempt.reason] ?? attempt.reason
    return `  ${index + 1}. ${attempt.url} —— ${reason}（HTTP ${attempt.status}）`
  })
  return [
    head,
    `已探测 ${attempts.length} 个候选地址，全部失败：`,
    ...detail,
    '排查：① 确认该应用的 contextPath / apiBase 已登记在 devtools/apps-registry.yml；'
      + '② 跑过 gen-from-registry.py 重新生成 app-config.json；'
      + '③ 确认产物已发布到上面列出的目录下（子路径应用必须落在其 contextPath 目录下）。',
  ].join('\n')
}

/**
 * 按顺序探测候选基址，返回「命中的配置 / 失败记录 / 单条告警」（纯函数，IO 由 `probe` 注入）。
 *
 * 🔴 两条铁律（0.1.7 修复的核心）：
 *   a. **成功路径零日志** —— 任一候选命中即立刻返回，`attempts` 为空、`warning` 为空串。
 *   b. **全败才告警，且只有一条** —— 逐条 warn 会淹掉控制台（探测本来就带若干 404）。
 *
 * @param urls 候选基址（由 `runtimeConfigCandidates` 产出，已按优先级排序）
 * @param probe 同步探测器（生产侧为同步 XHR；抛错视为本候选失败）
 */
export function loadRuntimeConfig(
  urls: string[],
  probe: RuntimeConfigProbe,
): RuntimeConfigLoadResult {
  const attempts: RuntimeConfigAttempt[] = []
  for (const base of urls ?? []) {
    const url = `${base}app-config.json`
    let result: RuntimeConfigProbeResult
    try {
      result = probe(url)
    } catch {
      attempts.push({ url, status: 0, reason: 'http-not-200' })
      continue
    }
    const status = Number(result?.status ?? 0)
    const body = typeof result?.body === 'string' ? result.body : ''
    if (status !== 200) {
      attempts.push({ url, status, reason: 'http-not-200' })
      continue
    }
    const config = parseRuntimeConfig(body)
    if (config) {
      // 成功：立刻返回，**不产生任何日志**（attempts 恒为空数组 ⇒ 调用方跳过日志）
      return { config, attempts: [], warning: '' }
    }
    attempts.push({ url, status, reason: classifyRuntimeConfigFailure(body) })
  }
  return { config: null, attempts, warning: formatRuntimeConfigWarning(attempts) }
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
  /**
   * 应用首页（站内路由内路径）。**建议每个应用显式传入。**
   *
   * 🔴 为什么不能靠默认值：它被路由守卫的 `onDeny` 真实消费 ——
   * 无权限访问时 `router.replace(config.homePath)`，若该路径在本应用**不存在**，
   * vue-router 匹配不到 → 静默停在空白页（不报错、守卫已 `replace` 过所以不重定向）。
   * `DEFAULTS.homePath` 恰好是 `/dashboard` 只对「首页真叫 /dashboard」的应用成立，
   * 这是**运气**而非约定，改默认值即批量静默 404。
   */
  homePath?: string
  sessionMode?: SessionMode
  tokenKeyPrefix?: string
  /**
   * 显式令牌键覆盖 —— **优先级高于 `tokenKeyPrefix` 派生**。
   *
   * 用于令牌键不是 `<prefix>access_token` 形态的应用（如 portal 的 `portal_token`、
   * cosmic 的裸 `token`）。逐字段覆盖：`undefined` 的字段仍走前缀派生，
   * 所以只传一个键、其余保持派生的用法是被支持的。
   */
  tokenKeys?: Partial<TokenKeys>
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

/**
 * 令牌键合并：**先按前缀派生，再逐字段用显式覆盖顶替**。
 *
 * 🔴 为什么是「派生后覆盖」而不是「有覆盖就不用派生」：
 * 存量应用的四个键往往**只有一个**是非标准形态（portal 是 `portal_token`，
 * 其余三个仍是 `portal_xxx`），若「传了 tokenKeys 就不派生」，
 * 漏传的键会变成 `undefined` → localStorage 读到字面量 `"undefined"` →
 * 老用户静默掉登录态。逐字段覆盖让「只覆盖一个」是安全用法。
 *
 * `undefined` 显式传参**不覆盖**（`{ accessTokenKey: undefined }` 等价于不传该字段）。
 */
export function mergeTokenKeys(
  appId: string,
  prefix?: string,
  overrides?: Partial<TokenKeys>,
): TokenKeys {
  const derived = deriveTokenKeys(appId, prefix)
  if (!overrides) {
    return derived
  }
  return {
    accessTokenKey: overrides.accessTokenKey ?? derived.accessTokenKey,
    refreshTokenKey: overrides.refreshTokenKey ?? derived.refreshTokenKey,
    tokenKindKey: overrides.tokenKindKey ?? derived.tokenKindKey,
    idTokenKey: overrides.idTokenKey ?? derived.idTokenKey,
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
    tokenKeys: mergeTokenKeys(options.appId, options.tokenKeyPrefix, options.tokenKeys),
    sessionProbeIntervalMs,
    whiteListPaths,
  }
}

/** 取 URL 的 origin（`http(s)://host[:port]`）；非法输入返回空串。 */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** 去掉结尾冗余斜杠并去空白。 */
function trimSlash(raw: string): string {
  return (raw || '').trim().replace(/\/+$/, '')
}

/**
 * **权限查询基址**（`fetchPermissions` 的 issuer）。
 *
 * ⚠️ **拼装口径（务必先看这行）**：`auth-components` 内部请求的是
 * `` `${issuer}/auth/permissions?client=<clientId>` ``（见 `usePermissions.ts`），
 * 即本函数返回值**必须是不含 `/auth` 的那一级**。实测四家可用代理：
 * `/portal/api`、`/kb/api`、`/infra/api`、`/api` ⇒ 都等于 **`apiBase`**，不是 `authApiBase`。
 * （若误用 `authApiBase` 会拼出 `/kb/api/auth/auth/permissions` ⇒ 404 ⇒ 同样 fail-open。）
 *
 * 🔴 **历史缺陷（STATUS T-ENG-11 / 坑 #42；2026-10-17 真浏览器实测复核）**：
 * 旧实现是 `permissionsIssuer ?? config.issuer`，即缺省把权限查询发到 **IdP 自身**
 * （`https://auth.marschat.online`）。而中心的 `/auth/permissions` **不是浏览器可直连端点**：
 *   - 它校验 **HS384 业务令牌**，浏览器持有的是 **OIDC RS256 access_token** ⇒ 恒 403；
 *   - 即便拿到 403，跨域响应也常被 CORS 拦成 JS 侧的 `Failed to fetch`（kb-web 实测即如此）。
 * 结果是 `fetchPermissions` **恒失败** ⇒ `configured=false` ⇒ 权限体系 **fail-open 全放行**
 * （菜单全出、按钮全可点），**且控制台没有任何可归因报错**——这是最危险的失效形态。
 *
 * 而 portal / kb-web / infra / cosmic **四家后端的同源代理早已就绪**：
 * `${apiBase}/auth/permissions` 实测返回 200 + `configured=true` + 权限点数组。
 * 因此**缺省必须是同源代理**，不是 IdP。
 *
 * 优先级：
 *   1. 显式 `permissionsIssuer`（永远最高优先，保持老写法可覆盖）
 *   2. IdP `issuer` 与本站点**同源**时 → 仍用 `issuer`（自建 IdP 直供权限点的场景）
 *   3. 同源代理 `apiBase`
 *   4. 兜底 `issuer`（无 apiBase 时才走到，正常不存在）
 *
 * ⚠️ 与 `issuer` 的边界：`issuer` 同时被 `ssoConfig.issuer` 消费（OIDC 发现 / 换票 / 会话探针），
 * 改它会让 SSO 免登与 SLO 联动**静默失效**。本函数只影响权限查询，二者不可混为一谈。
 */
export function resolvePermissionsIssuer(
  permissionsIssuer: string | undefined,
  config: Pick<ResolvedAppConfig, 'issuer' | 'apiBase'>,
  origin = 'http://localhost',
): string {
  if (permissionsIssuer && permissionsIssuer.trim()) {
    return trimSlash(permissionsIssuer)
  }
  const issuer = trimSlash(config.issuer)
  const siteOrigin = originOf(origin) || trimSlash(origin)
  const idpOrigin = originOf(issuer)
  // 自建 IdP 与站点同源（如 IdP 由本应用自身代理暴露）→ 直连无跨域问题，保持旧行为
  if (idpOrigin && siteOrigin && idpOrigin === siteOrigin) {
    return issuer
  }
  const proxy = trimSlash(config.apiBase)
  return proxy || issuer
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
