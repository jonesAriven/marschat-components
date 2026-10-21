/**
 * `createMarschatApp` —— 应用接入的**一行装配**。
 *
 * 把此前每个应用各抄一份的 7 件事收敛成一次调用：
 * ① 运行时配置读取 → ② 令牌键绑定 → ③ SSO 客户端 → ④ 统一请求 + 401 分流
 * → ⑤ 路由守卫 → ⑥ 登录 / 回调 / 用户管理路由注册 → ⑦ 会话监视 + 权限预取。
 *
 * <pre>
 * // main.ts —— 新增应用接入登录与用户管理的**全部前端代码**
 * const app = createApp(App)
 * const marschat = createMarschatApp({ appId: 'marschat-xxx', router, menus: myMenus })
 * marschat.install(app)          // 内部按正确顺序挂 router（守卫已先注册）
 * app.use(pinia); app.use(ElementPlus); app.mount('#app')
 * marschat.bootstrap()
 * </pre>
 *
 * 后端侧配套：`marschat.bff.enabled=true` + `bff-whitelist.yml`（见 auth-core 的 BFF 自动装配）。
 */
import { defineComponent, h } from 'vue'
import {
  createSsoClient,
  initTokenConfig,
  getToken,
  setToken,
  removeToken,
  getRefreshToken,
  setRefreshToken,
  removeRefreshToken,
  setTokenKind,
  setIdToken,
  decodeOidcClaims,
  fetchPermissions,
  hasPermission,
  LoginPage,
  SsoCallbackView,
  UserManagementPanel,
  createUserAdminClient,
  clearTokens,
  type SessionWatcher,
  type UsePermissionsOptions,
} from '@marschat/auth-components'
import { createRequest, createAuthGuard, type TokenStore } from '@marschat/frontend-common'
import { createMarschatShell, type ShellOptions } from './shell'
import {
  resolveAppConfig,
  resolvePermissionsIssuer,
  runtimeConfigCandidates,
  loadRuntimeConfig,
  toRouterPath,
  buildPermissionsUrl,
  classifyPermissionsFailure,
  warnPermissionsFailure,
  type PermissionsResponseLike,
  type ResolvedAppConfig,
  type RuntimeConfig,
  type RuntimeConfigProbeResult,
} from './config'
import type {
  MarschatApp,
  MarschatAppOptions,
  RouteLike,
  RouterLike,
} from './types'

/**
 * 读取运行时配置 `public/app-config.json`（由 `apps-registry.yml` 派生）。
 *
 * ⚠️ 坑 #4：生成器产物首行是 `// AUTO-GENERATED ...` 横幅，**不是合法 JSON**；
 * 不剥注释直接 `JSON.parse` 会抛错 → 运行时配置失效、回落编译期默认值。
 * 同步 XHR 是为了让消费方在模块求值期即可拿到常量（与既有各应用同口径）。
 *
 * ⚠️ 坑 #41（0.1.7 修复）：失败路径**曾经完全静默** —— 全败时直接 `return {}`，
 * 调用方回落内置默认值，**不抛错、不 warn**，控制台只有一条不含 URL 的 404。
 * 代价真实且反复发生：R7–R11 **五轮**浏览器回归，每轮都要人工翻 Network 记录、
 * 逐条比对 URL 才能定性「这份应用的运行时配置其实整份没生效」，同一取证成本连付五轮。
 * 现在**全败时输出一条**含全部候选 URL 与归因的中文告警（见 `formatRuntimeConfigWarning`），
 * **成功路径仍零日志**；判定与文案一律走 `config.ts` 的纯函数，可零依赖单测。
 */
export function readRuntimeConfig(baseUrl?: string): RuntimeConfig {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : undefined
  const result = loadRuntimeConfig(
    runtimeConfigCandidates(baseUrl, pathname),
    probeRuntimeConfigWithXhr,
  )
  // 🔴 只在**全部候选都失败**时告警一次：探测本来就带若干 404，逐条 warn 会淹掉控制台
  if (result.warning) {
    console.warn(result.warning)
  }
  return result.config ?? {}
}

/**
 * 同步 XHR 探测（与既有实现同口径：模块求值期即可拿到常量）。
 *
 * 请求本身抛错（网络错误 / 无 XHR 环境）由 `loadRuntimeConfig` 归因为一条 attempt，
 * 不再像旧实现那样被空的 `catch {}` 整体吞掉。
 */
function probeRuntimeConfigWithXhr(url: string): RuntimeConfigProbeResult {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, false)
  xhr.send(null)
  return { status: xhr.status, body: xhr.responseText || '' }
}

/**
 * 统一清理本地会话：**令牌四键 + 应用自管键**。
 *
 * 🔴 为什么必须收口到一处：清理发生在**三条独立路径**（401 分流 / 会话丢失 / 登出），
 * 早期版本各写各的，漏一条就留下残留 —— 而 `portal_role` 这类键承载 `isAdmin` 判定，
 * 登出后残留即为**权限信息泄漏**（共用浏览器场景）。集中实现避免「补了一条忘了另两条」。
 *
 * @param clearExtraAuth 应用自管键清理钩子（可选；须幂等 —— 本函数可能被重复调用）
 */
function clearLocalSession(clearExtraAuth?: () => void): void {
  // 令牌四键（含 id_token）与组件库硬编码的 auth_user —— 保持与 auth-components 一致
  clearTokens()
  try {
    localStorage.removeItem('auth_user')
  } catch {
    /* ignore：隐私模式 / 存储被禁用时不应连带阻断登出 */
  }
  try {
    clearExtraAuth?.()
  } catch {
    /* ignore：应用钩子抛错不得让「已清令牌」的登出流程整体失败 */
  }
}

/**
 * 已做过归因诊断的权限地址（模块级：页面会话内只探一次）。
 *
 * 🔴 为什么必须收口：权限探针会被**路由守卫每次导航**触发一次；
 * 若每次都补发一次诊断请求，一个会话几十次导航就多几十个请求 ——
 * 那是把「看不见失败」换成「制造新噪音」，同样不可取。
 */
const DIAGNOSED_PERMISSIONS_URLS = new Set<string>()

/**
 * 对权限探针地址做**一次**归因诊断，失败则输出一条可归因告警（0.1.8）。
 *
 * ⚠️ 只 `console.warn`，**不改变 fail-open 语义**：不拦截、不跳转、不抛错。
 * 诊断请求用的是与 `fetchPermissions` **同一个** URL 与同一份令牌，
 * 因此归因出来的状态码 / 响应体就是真实那一次请求的结论。
 */
async function diagnosePermissionsFailure(url: string, token?: string | null): Promise<void> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  let response: PermissionsResponseLike | null = null
  let payload: unknown = undefined
  try {
    const res = await fetch(url, { headers })
    response = { status: res.status, ok: res.ok }
    // 取文本而不是 `.json()`：`fetchPermissions` 的一大失败来源正是「2xx 但 body 不是 JSON」
    payload = await res.text()
  } catch (err) {
    // fetch 抛错（含 CORS 被拦）⇒ 连响应对象都没有
    warnPermissionsFailure({ url, status: 0, reason: classifyPermissionsFailure(err, null) })
    return
  }
  const status = Number(response?.status ?? 0)
  const reason = classifyPermissionsFailure(undefined, response, payload)
  if (reason === 'unknown') {
    // HTTP 2xx 且响应体合法 ⇒ 只是该应用尚未配置权限点（**正常的** fail-open），不告警
    return
  }
  warnPermissionsFailure({ url, status, reason })
}

/**
 * 权限预取 + 失败归因（0.1.8）—— 路由守卫与 `bootstrap()` 两处共用同一入口。
 *
 * 顺序很关键：**先走 `fetchPermissions`**（它持有组件库的模块级共享状态，
 * 菜单 / 路由守卫 / PermissionGate 三层同源都读这一份），
 * 只有在它落到 `configured === false`（即 fail-open **已经发生**）时，
 * 才补做**一次**诊断探测，拿到「URL + 状态码 + 原因」。
 *
 * ⚠️ 为什么不直接改 `fetchPermissions`：它在 `auth-components`，
 *    其失败路径是**刻意** fail-open 且吞掉异常的（改它会波及全部存量应用）；
 *    本包只加可见性，不动语义 —— 这是本函数的唯一职责。
 *
 * ⚠️ 代价：落到 `configured === false` 的应用**每会话多一次** GET；
 *    成功路径（`configured === true`）零额外请求、零日志。
 */
export async function ensurePermissions(permissions: UsePermissionsOptions): Promise<void> {
  let configured = false
  try {
    const state = await fetchPermissions(permissions)
    configured = !!state?.configured
  } catch {
    // fail-open：预取异常不阻塞启动（与既有行为逐字一致）
    configured = false
  }
  if (configured) {
    return
  }
  // 🔴 未携带令牌（用户尚未登录）⇒ 权限探针拿不到权限点是**预期**的，不是缺陷：
  //    若此时也诊断并告警，每个应用每次首屏（登录页）都会挂一条 401 告警，
  //    那是用噪音换掉可归因性，与「成功路径零日志」的原则相悖。
  //    登录后再导航时这里才有令牌 ⇒ 归因照常发生（kb-ops 的 403 正是登录后才暴露的）。
  const token = permissions.getToken?.()
  if (!token) {
    return
  }
  const url = buildPermissionsUrl(permissions.issuer, permissions.clientId)
  if (DIAGNOSED_PERMISSIONS_URLS.has(url)) {
    return
  }
  DIAGNOSED_PERMISSIONS_URLS.add(url)
  try {
    await diagnosePermissionsFailure(url, token)
  } catch {
    /* ignore：诊断本身失败绝不能反过来影响 fail-open 的既有语义 */
  }
}

/** 令牌存储适配：让 frontend-common 的请求实例复用 auth-components 的令牌读写（**单一真源**）。 */
function createTokenStoreAdapter(): TokenStore {
  return {
    getToken: () => getToken(),
    setToken: (t: string) => setToken(t),
    getRefreshToken: () => getRefreshToken(),
    setRefreshToken: (t: string) => setRefreshToken(t),
    removeToken: () => removeToken(),
    removeRefreshToken: () => removeRefreshToken(),
  }
}

/**
 * 一行装配应用接入。
 *
 * @returns 句柄对象：`{ config, sso, request, permissions, install, bootstrap }`
 */
export function createMarschatApp(options: MarschatAppOptions): MarschatApp {
  if (!options?.router) {
    throw new Error('[marschat-app-kit] createMarschatApp 缺少 router')
  }

  const origin = options.origin
    ?? (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  const runtime = options.runtime ?? readRuntimeConfig('/')
  const config: ResolvedAppConfig = resolveAppConfig(options, runtime, origin)

  // ① 部署 base 声明 —— 必须在守卫/组件跳登录**之前**（坑 #6：不声明则跳域名根 404）
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__MARSCHAT_APP_BASE__ = config.contextPath
  }

  // ② 令牌键绑定（各应用保留自己的历史前缀，老用户登录态不丢）
  initTokenConfig(config.tokenKeys)

  // ③ SSO 客户端
  const ssoConfig = {
    issuer: config.issuer,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scope: 'openid profile',
    loginUrl: config.loginUrl,
    silentLogin: true,
  }
  const sso = createSsoClient(ssoConfig)

  // ④ 统一请求实例（401 分流 + 静默续期由 createRequest 内部完成）
  const request = createRequest({
    baseURL: config.apiBase,
    authBaseURL: config.authApiBase,
    tokenStore: createTokenStoreAdapter(),
    ssoConfig,
    whiteListPaths: config.whiteListPaths,
    onUnauthorized: () => {
      // 非 OIDC 会话的 401：清本地并回登录页
      clearLocalSession(options.clearExtraAuth)
      void options.router.replace(config.loginPath)
    },
  })

  // ⑤ 权限选项（三层同源：菜单 / 路由守卫 / PermissionGate 共用同一份状态）
  //    🔴 issuer 走 `resolvePermissionsIssuer(...)`：
  //       **缺省不可再回落 IdP**。中心的 `/auth/permissions` 校验 HS384 业务令牌，
  //       浏览器只有 OIDC RS256 access_token ⇒ 恒 403，还常被 CORS 拦成 `Failed to fetch`
  //       （kb-web 2026-10-17 实测）⇒ `configured=false` ⇒ 权限体系 **fail-open 全放行且不报错**。
  //       portal / kb-web / infra / cosmic 四家后端的同源代理 `${authApiBase}/permissions`
  //       实测 200 + configured=true，因此缺省指向同源代理才是正解（详见该函数注释）。
  //       注意这里**只**改权限基址；上面 ③ 的 ssoConfig.issuer 仍指向中心，
  //       否则 SSO 免登与 SLO 联动会静默失效。
  const permissions = {
    issuer: resolvePermissionsIssuer(options.permissionsIssuer, config, origin),
    clientId: config.clientId,
    getToken: () => getToken(),
    adminBypass: options.adminBypass ?? true,
  }

  // ⑥ 路由守卫 —— **必须在 `app.use(router)` 之前**注册（坑 #5：否则首屏跳过权限判定）
  createAuthGuard(options.router, {
    // 🔴 走 `ensurePermissions`（0.1.8）：仍先跑 `fetchPermissions` 保持三层同源，
    //    额外只在 `configured === false`（fail-open 已发生）时补一次归因诊断 + 一条告警。
    //    语义不变：fail-open 照样放行，只是失败**可见、可归因**。
    ensure: () => ensurePermissions(permissions),
    // 与菜单 / PermissionGate 共用 auth-components 的**同一份**权限状态（三层同源铁律）；
    // 不自建判定，避免两套实现漂移。code 支持全码与半码（内部自动补 client 前缀）。
    hasPerm: (code: string) => hasPermission(permissions, code),
    onDeny: () => {
      // 🔴 必须传**路由内路径**（坑 #1）：router 已带部署前缀，再拼 CONTEXT_PATH
      //    会落 `/kb/kb/dashboard` → 不匹配任何路由 → 404 空页（2026-09-14 实测事故）
      void options.router.replace(config.homePath)
    },
  })

  // ⑦ 注册登录 / 回调 / 用户管理路由
  //    组件配置一律**宽松透传**（`Record<string, unknown>`），不引用组件库内部类型名 ——
  //    装配层的职责是转发配置，不是复刻组件库的类型面；这样组件库调整内部类型时不会波及接入方。
  const loginPageOptions = (options.loginPage ?? {}) as Record<string, unknown>
  const userManagementOptions = (options.userManagement ?? {}) as Record<string, unknown>

  if (options.autoRoutes !== false) {
    options.router.addRoute({
      path: config.loginPath,
      name: 'marschat-login',
      component: buildLoginRoute({
        options,
        config,
        ssoConfig,
        loginPageOptions,
      }),
      meta: { public: true },
    })

    options.router.addRoute({
      path: config.callbackPath,
      name: 'marschat-sso-callback',
      component: defineComponent({
        name: 'MarschatSsoCallbackRoute',
        setup() {
          return () => h(SsoCallbackView as never, {
            config: ssoConfig,
            onSuccess: (redirect: string) => {
              // 回调返回的是站内绝对路径，必须剥掉部署前缀再交给 router（坑 #1）
              const target = redirect?.startsWith('http')
                ? new URL(redirect).pathname
                : (redirect || config.homePath)
              void options.router.replace(toRouterPath(config, target))
            },
          })
        },
      }),
      meta: { public: true },
    })

    if (config.usersPath !== false) {
      options.router.addRoute({
        path: config.usersPath,
        name: 'marschat-users',
        component: buildUsersRoute({ config, userManagementOptions }),
        meta: { perm: `${config.clientId}:menu:users` },
      })
    }
  }

  // ⑧ 会话监视（幂等单例）+ 权限预取
  let watcher: SessionWatcher | null = null
  let bootstrapped = false

  const app: MarschatApp = {
    config,
    sso,
    request,
    permissions,

    install(vueApp: unknown) {
      // 按正确顺序挂 router：守卫已在 ⑥ 注册完毕，此刻 use(router) 才安全
      const a = vueApp as { use: (p: unknown) => void }
      a.use(options.router)
    },

    bootstrap() {
      if (bootstrapped) {
        return
      }
      bootstrapped = true

      // 🔴 只有 OIDC 会话才启动会话监视：
      //    监视器探的是 auth-center `/auth/session`（IdP 会话）；BFF 换票模式（如 portal）
      //    浏览器侧根本没有 IdP 会话 → 探针恒 false → 3 秒后把在线用户误踢（Phase 11 实测事故）。
      //
      //    ⚠️ `sessionMode` 是**应用级常量**，表达不了「同一应用内两种会话并存」的**双模形态**
      //    （账密 legacy + SSO oidc，如 kb-web / portal）。判据顺序（**0.1.3 行为逐字不变**）：
      //      ① `watchSession` 传函数 → 取其返回值（**按会话实时**判据，仅双模应用需要）；
      //      ② `watchSession` 传布尔 → 与 `sessionMode === 'oidc'` **仍取与**（保持 0.1.3 语义）；
      //      ③ 都不传 → 仅看 `sessionMode === 'oidc'`。
      //    ⚠️ 布尔 `true` **不能**越过 `sessionMode` 闸门（否则 BFF 应用传 true 就会被误踢）。
      const useWatcher = typeof options.watchSession === 'function'
        ? options.watchSession()
        : (options.watchSession ?? true) && config.sessionMode === 'oidc'
      if (useWatcher && getToken()) {
        watcher = sso.watchSession({
          intervalMs: config.sessionProbeIntervalMs,
          getToken: () => getToken(),
          clearLocalAuth: () => {
            // 🔴 走统一清理：漏掉自管键会让 portal_role 之类残留（权限信息泄漏）
            clearLocalSession(options.clearExtraAuth)
          },
          // 身份一致性守卫：共享浏览器换人登录时，本地旧 token 与 IdP 会话身份不符 → 静默重换票
          getLocalIdentity: () => decodeOidcClaims(getToken() || '').sub ?? null,
          onIdentityMismatch: () => void sso.renew(),
        })
      }

      if (options.prefetchPermissions !== false) {
        // 🔴 与守卫同一入口：预取 + 失败归因（同一 URL 同一会话只告警一次）
        void ensurePermissions(permissions).catch(() => { /* fail-open：权限预取失败不阻塞启动 */ })
      }
    },

    /** 共享外壳：宿主 `App.vue` 里 `<component :is="marschat.createShell()" />` 即得统一布局。 */
    createShell(overrides) {
      return createMarschatShell({
        router: options.router,
        menus: options.menus ?? [],
        permissions,
        title: config.appId,
        brand: (options.loginPage?.title as string | undefined) ?? config.appId,
        homePath: config.homePath,
        onLogout: () => {
          watcher?.stop()
          // 🔴 登出也必须清自管键：共用浏览器下残留的 portal_role 会被下一个人读到
          clearLocalSession(options.clearExtraAuth)
          sso.logout()
        },
        ...overrides,
      })
    },
  }

  return app
}

/** 登录路由组件：包装 LoginPage，并把账密提交接到中心（经应用 BFF）。 */
function buildLoginRoute(ctx: {
  options: MarschatAppOptions
  config: ResolvedAppConfig
  ssoConfig: { issuer: string; clientId: string; redirectUri: string; loginUrl: string; scope: string; silentLogin: boolean }
  loginPageOptions: Record<string, unknown>
}) {
  const { options, config, ssoConfig, loginPageOptions } = ctx

  return defineComponent({
    name: 'MarschatLoginRoute',
    setup() {
      const redirectTarget = options.afterLoginRedirect || config.homePath

      const onLogin = async (credentials: { username: string; password: string }) => {
        await passwordLogin(config, credentials)
        void options.router.replace(redirectTarget)
      }

      const onSsoLogin = () => {
        const sso = createSsoClient(ssoConfig)
        void sso.login(redirectTarget)
      }

      const onPasswordReset = () => {
        window.location.href = `${config.issuer}/login.html`
      }

      return () => h(LoginPage as never, {
        config: {
          title: loginPageOptions.title ?? config.appId,
          ...loginPageOptions,
        },
        onLogin,
        onSsoLogin,
        onPasswordReset,
      })
    },
  })
}

/**
 * 账密登录：POST 应用 BFF `${authApiBase}/login`，把中心返回的凭据落到本地。
 *
 * ⚠️ 坑 #21：必须保留中心返回的 `role`，否则前端 `isAdmin` 判定失效 →
 * 管理员菜单（如「用户管理」）整块消失，功能不可达。
 */
async function passwordLogin(
  config: ResolvedAppConfig,
  credentials: { username: string; password: string },
): Promise<Record<string, unknown>> {
  const res = await fetch(`${config.authApiBase}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.code !== 200) {
    throw new Error(body?.message || '登录失败')
  }
  const data = (body.data || {}) as Record<string, unknown>
  const accessToken = (data.accessToken || data.access_token) as string | undefined
  if (!accessToken) {
    throw new Error('登录响应缺少 accessToken（应用 BFF 未回传中心令牌）')
  }
  setToken(accessToken)
  // 账密登录换来的是**中心令牌**，按 oidc 标记才能让 401 分流走静默续期（坑 #3）
  setTokenKind('oidc')
  const refreshToken = (data.refreshToken || data.refresh_token) as string | undefined
  if (refreshToken) {
    setRefreshToken(refreshToken)
  }
  if (data.idToken) {
    setIdToken(String(data.idToken))
  }
  return data
}

/** 用户管理路由组件：包装 UserManagementPanel，数据源指向同源 BFF（默认 app 作用域）。 */
function buildUsersRoute(ctx: {
  config: ResolvedAppConfig
  userManagementOptions: Record<string, unknown>
}) {
  const { config, userManagementOptions } = ctx

  return defineComponent({
    name: 'MarschatUsersRoute',
    setup() {
      const baseUrl = (userManagementOptions.baseUrl as string | undefined)
        ?? `${config.contextPath === '/' ? '' : config.contextPath}/api/admin/users`
      const scopeMode = (userManagementOptions.scopeMode as 'app' | 'platform' | undefined) ?? 'app'

      const client = createUserAdminClient({
        baseUrl,
        getToken: () => getToken(),
        onUnauthorized: () => {
          // 会话失效 → 静默重授权（不把用户踢到空白页）
          void createSsoClient({
            issuer: config.issuer,
            clientId: config.clientId,
            redirectUri: config.redirectUri,
            loginUrl: config.loginUrl,
          }).renew()
        },
      })

      const panelConfig = {
        title: '本系统用户',
        subtitle: '管理本系统的成员与角色（身份由统一认证中心维护）',
        ...userManagementOptions,
        client,
        scope: scopeMode === 'platform'
          ? { mode: 'platform' as const }
          : { mode: 'app' as const, clientId: config.clientId },
      }

      return () => h(UserManagementPanel as never, { config: panelConfig })
    },
  })
}

/** 导出路由类型，便于宿主在守卫里做类型标注。 */
export type { RouteLike, RouterLike }
