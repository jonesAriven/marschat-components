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
  mergeTokenKeys,
  toRouterPath,
  normalizeContextPath,
  type MarschatApp,
  type MarschatAppOptions,
  type RouterLike,
  type TokenKeys,
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

/** 场景 6：0.1.3 新增 —— `tokenKeys` 显式覆盖（portal / cosmic-studio 迁移锁定的用法）。
 *
 *  这个场景锁定的是 **README / 脚手架里 portal 与 cosmic-studio 的接入写法**：
 *  `tokenKeys` 必须同时接受「全量四键」与「部分键」（只给非标准的那一个，其余走前缀派生），
 *  并且 `permissionsIssuer` 必须是**可选**字段（缺省时编译通过，行为回落 `issuer`）。
 *  API 一旦改名/改形态（例如把 `tokenKeys` 收窄为必填全量、或把 `permissionsIssuer` 挪进
 *  `ResolvedAppConfig`），本文件即编译失败 —— 迁移方不会拿到「能编译但静默失效」的接入代码。
 */
const explicitKeys: MarschatAppOptions = {
  appId: 'marschat-portal',
  router: fakeRouter,
  contextPath: '/portal',
  tokenKeyPrefix: 'portal_',
  // 只覆盖非标准形态的那一个键：portal 的访问令牌叫 `portal_token` 而非 `portal_access_token`
  tokenKeys: { accessTokenKey: 'portal_token' },
  // 权限查询走自家后端 BFF 代理（同源），与 SSO 的 `issuer`（中心）分开
  permissionsIssuer: '/portal/api',
  sessionMode: 'bff',
  watchSession: false,
}
const explicitKeyApp: MarschatApp = createMarschatApp(explicitKeys)
const _explicitAccessKey: string = explicitKeyApp.config.tokenKeys.accessTokenKey
const _explicitRefreshKey: string = explicitKeyApp.config.tokenKeys.refreshTokenKey

/** 场景 6b：全量四键覆盖 + 省略 `permissionsIssuer`（缺省必须可编译）。 */
const fullOverride: MarschatAppOptions = {
  appId: 'cosmic-studio',
  router: fakeRouter,
  contextPath: '/',
  tokenKeys: {
    accessTokenKey: 'token',
    refreshTokenKey: 'refresh_token',
    tokenKindKey: 'token_kind',
    idTokenKey: 'id_token',
  },
}
const fullOverrideApp: MarschatApp = createMarschatApp(fullOverride)
const _fullAccessKey: string = fullOverrideApp.config.tokenKeys.accessTokenKey
const _mergedKeys: TokenKeys = mergeTokenKeys('cosmic-studio', undefined, { accessTokenKey: 'token' })

/** 场景 7：kb-web 迁移踩坑固化为契约 —— `homePath` 必显式 + 双模才禁`watchSession`。
 *
 *  这两个字段的共性是「**省略不报错、但运行时静默出错**」：
 *  - `homePath` 被守卫 `onDeny` 消费，路径不存在 → 静默空白页；
 *  - `watchSession` 在双模应用里默认true → 3 秒后误踢（2026-09-15 事故）。
 *  写进契约文件后，谁再照抄kb-ops 范本漏传，review 时能立刻看见这两个显式传参。
 */
const kbWebDualMode: MarschatAppOptions = {
  appId: 'marschat-kbweb',
  router: fakeRouter,
  contextPath: '/kb',
  // ① 显式传首页：不依赖 DEFAULTS.homePath（默认值一改就静默 404）
  homePath: '/dashboard',
  // ② 双模应用（账密 legacy + SSO oidc 并存）必须关会话监视，否则 3 秒即被踢回 ?slo=1
  watchSession: false,
  // ③ 令牌键沿用旧前缀（kb-web 存量形态；纯前缀派生即可，无需 tokenKeys 覆盖）
  tokenKeyPrefix: 'kbweb_',
}
const kbWebApp: MarschatApp = createMarschatApp(kbWebDualMode)
const _kbWebHome: string = kbWebApp.config.homePath

/** 场景 7b：纯 BFF 单模应用（portal 形态）—— **保持 `watchSession` 默认不传**，不得抄双模的 false。 */
const portalPureBff: MarschatAppOptions = {
  appId: 'marschat-portal',
  router: fakeRouter,
  sessionMode: 'bff',
  // 纯 BFF 单模：会话监视默认开启是对的（SLO 联动），此处刻意不传 watchSession
  homePath: '/home',
  permissionsIssuer: '/portal/api',
  tokenKeyPrefix: 'portal_',
}
const portalPureBffApp: MarschatApp = createMarschatApp(portalPureBff)
const _portalHome: string = portalPureBffApp.config.homePath

/** 场景 8：双模会话 —— `watchSession` 函数式判据（kb-web / portal 同款形态，0.1.4）。
 *
 *  锁定三件事，任一回归即编译失败：
 *  ① `watchSession` 必须是 `boolean | (() => boolean)` —— 只留boolean 则双模应用无法表达；
 *  ② 布尔形态必须**继续可编译**（0.1.3 存量写法不许被破坏）；
 *  ③ `clearExtraAuth` 钩子必须存在（否则 portal 的 `portal_role` 登出后残留）。
 */
import { isOidcToken } from '@marschat/auth-components'

const dualModeWithPredicate: MarschatAppOptions = {
  appId: 'marschat-portal',
  router: fakeRouter,
  sessionMode: 'bff',
  homePath: '/home',
  tokenKeys: { accessTokenKey: 'portal_token', tokenKindKey: 'portal_token_kind' },
  //① 函数式：按**本次会话**的 token_kind 实时判定（账密 legacy → false，不监视）
  watchSession: () => isOidcToken(),
  // ③ 自管键清理（portal_user / portal_role / portal_auth_uid）
  clearExtraAuth: () => {
    localStorage.removeItem('portal_user')
    localStorage.removeItem('portal_role')
    localStorage.removeItem('portal_auth_uid')
  },
}
const dualModeApp: MarschatApp = createMarschatApp(dualModeWithPredicate)
const _dualHome: string = dualModeApp.config.homePath

/** 场景 8b：布尔形态必须继续可编译（0.1.3 存量写法不许被破坏）。 */
const legacyBooleanForms: MarschatAppOptions[] = [
  { appId: 'marschat-a', router: fakeRouter },                              // 不传
  { appId: 'marschat-b', router: fakeRouter, watchSession: true },          // 显式 true
  { appId: 'marschat-c', router: fakeRouter, watchSession: false },         // 显式 false
]

/** 防止「未使用变量」噪音：把结果汇总成一个导出。 */
export const typeContractOk = {
  _config, _issuer, _redirect, _usersPath, _mode, _tokenKey, _clientId,
  _shell, _shell2, _portalKey, _ctx, _keys, _path, _redirectUri, _standaloneShell,
  _explicitAccessKey, _explicitRefreshKey, _fullAccessKey, _mergedKeys,
  _kbWebHome, _portalHome, _dualHome, legacyBooleanForms,
}
