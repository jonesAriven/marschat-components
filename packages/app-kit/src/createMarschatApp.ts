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
  type SessionWatcher,
} from '@marschat/auth-components'
import { createRequest, createAuthGuard, type TokenStore } from '@marschat/frontend-common'
import { createMarschatShell, type ShellOptions } from './shell'
import {
  resolveAppConfig,
  toRouterPath,
  type ResolvedAppConfig,
  type RuntimeConfig,
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
 * 不剥注释直接 `JSON.parse` 会抛错 → 运行时配置静默失效、回落编译期默认值。
 * 同步 XHR 是为了让消费方在模块求值期即可拿到常量（与既有各应用同口径）。
 */
export function readRuntimeConfig(baseUrl = '/'): RuntimeConfig {
  try {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', `${baseUrl}app-config.json`, false)
    xhr.send(null)
    if (xhr.status === 200) {
      const raw = xhr.responseText.replace(/^\s*\/\/.*$/gm, '')
      return JSON.parse(raw) as RuntimeConfig
    }
  } catch {
    /* 拉取/解析失败回落默认值 —— 本地开发无产物也能跑 */
  }
  return {}
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
      removeToken()
      void options.router.replace(config.loginPath)
    },
  })

  // ⑤ 权限选项（三层同源：菜单 / 路由守卫 / PermissionGate 共用同一份状态）
  const permissions = {
    issuer: config.issuer,
    clientId: config.clientId,
    getToken: () => getToken(),
    adminBypass: options.adminBypass ?? true,
  }

  // ⑥ 路由守卫 —— **必须在 `app.use(router)` 之前**注册（坑 #5：否则首屏跳过权限判定）
  createAuthGuard(options.router, {
    ensure: () => fetchPermissions(permissions),
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
      if (options.watchSession !== false
        && config.sessionMode === 'oidc'
        && getToken()) {
        watcher = sso.watchSession({
          intervalMs: config.sessionProbeIntervalMs,
          getToken: () => getToken(),
          clearLocalAuth: () => {
            removeToken()
            removeRefreshToken()
          },
          // 身份一致性守卫：共享浏览器换人登录时，本地旧 token 与 IdP 会话身份不符 → 静默重换票
          getLocalIdentity: () => decodeOidcClaims(getToken() || '').sub ?? null,
          onIdentityMismatch: () => void sso.renew(),
        })
      }

      if (options.prefetchPermissions !== false) {
        void fetchPermissions(permissions).catch(() => { /* fail-open：权限预取失败不阻塞启动 */ })
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
