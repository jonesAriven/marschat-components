/**
 * 公共 API 契约的类型级自测 —— 证明 README/脚手布里写的「一行装配」**真的能编译**。
 *
 * 本文件不运行（`tsconfig.test.json` 只做 `--noEmit` 检查），它的价值在于：
 * 一旦 `createMarschatApp` 的选项名、返回句柄、外壳工厂签名发生变化，
 * 或者文档示例与实际 API 脱节，CI 的类型检查就会失败 ——
 * 把「文档说的」与「代码做的」绑在一起，避免又出现手册与实现长期漂移。
 */
import {
  createMarschatApp,
  createMarschatShell,
  resolveAppConfig,
  deriveTokenKeys,
  toRouterPath,
  normalizeContextPath,
  type MarschatApp,
  type MarschatAppOptions,
  type RouterLike,
} from '../src/index'

/** 最小可用的 vue-router 替身（结构性兼容，证明本包不硬依赖 vue-router）。 */
const fakeRouter: RouterLike = {
  beforeEach: () => undefined,
  addRoute: () => undefined,
  replace: () => undefined,
  currentRoute: { value: { path: '/' } },
}

/** 场景 1：文档中的「一行装配」—— 只给 appId / router / menus。 */
const marschat: MarschatApp = createMarschatApp({
  appId: 'marschat-demo',
  router: fakeRouter,
  menus: [
    { key: 'dashboard', title: '工作台', path: '/dashboard', order: 1, skipPerm: true },
    { key: 'users', title: '本系统用户', path: '/users', order: 2 },
  ],
})

/** 场景 2：返回句柄的每个成员都必须存在且类型正确。 */
const _config: string = marschat.config.contextPath
const _issuer: string = marschat.config.issuer
const _redirect: string = marschat.config.redirectUri
const _usersPath: string | false = marschat.config.usersPath
const _mode: 'oidc' | 'bff' = marschat.config.sessionMode
const _tokenKey: string = marschat.config.tokenKeys.accessTokenKey
const _clientId: string = marschat.permissions.clientId
marschat.install({ use: () => undefined })
marschat.bootstrap()
const _shell = marschat.createShell()
const _shell2 = marschat.createShell({ title: '自定义标题', brand: '品牌' })

/** 场景 3：存量应用迁移的完整配置面（portal 形态：BFF 会话 + 旧令牌键 + 自定义登录路径）。 */
const portalLike: MarschatAppOptions = {
  appId: 'marschat-portal',
  router: fakeRouter,
  contextPath: '/portal',
  tokenKeyPrefix: 'portal_',
  sessionMode: 'bff',
  loginPath: '/auth/login',
  callbackPath: '/auth/callback',
  usersPath: '/admin/users',
  homePath: '/home',
  loginPage: { title: '平台门户', color: '#3d5af1', layout: 'split' },
  userManagement: { title: '平台用户', scopeMode: 'platform', allowResetPassword: true },
  watchSession: false,
  prefetchPermissions: false,
  adminBypass: true,
}
const portalApp: MarschatApp = createMarschatApp(portalLike)
const _portalKey: string = portalApp.config.tokenKeys.accessTokenKey

/** 场景 4：纯函数 API 的签名。 */
const _ctx: string = normalizeContextPath('/kb/')
const _keys = deriveTokenKeys('marschat-kbweb', 'kb_')
const _path: string = toRouterPath({ contextPath: '/kb' }, '/kb/dashboard')
const _resolved = resolveAppConfig(
  { appId: 'marschat-kbweb' },
  { contextPath: '/kb', apiBase: '/kb/api', clientId: 'marschat-kbweb' },
  'https://kb.marschat.online',
)
const _redirectUri: string = _resolved.redirectUri

/** 场景 5：外壳可独立于 createMarschatApp 使用（只想要布局的场景）。 */
const _standaloneShell = createMarschatShell({
  router: fakeRouter,
  menus: [],
  permissions: {
    issuer: 'https://auth.marschat.online',
    clientId: 'marschat-demo',
    getToken: () => null,
    adminBypass: true,
  },
  title: '演示系统',
})

/** 防止「未使用变量」噪音：把结果汇总成一个导出。 */
export const typeContractOk = {
  _config, _issuer, _redirect, _usersPath, _mode, _tokenKey, _clientId,
  _shell, _shell2, _portalKey, _ctx, _keys, _path, _redirectUri, _standaloneShell,
}
