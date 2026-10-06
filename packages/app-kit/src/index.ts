/**
 * `@marschat/app-kit` —— MarsChat 应用接入装配层。
 *
 * **一句话接入**：新增应用只需引入本包 + 写少量配置，即可获得
 * 统一登录（SSO / 账密 / 邮箱码 / 忘记密码）、统一鉴权（RBAC 三层同源）、
 * 单点登出联动、以及「本系统用户」管理页。
 *
 * <pre>
 * // main.ts —— 全部前端接入代码
 * import { createMarschatApp } from '@marschat/app-kit'
 *
 * const app = createApp(App)
 * const marschat = createMarschatApp({ appId: 'marschat-xxx', router, menus: myMenus })
 * marschat.install(app)
 * app.use(pinia); app.use(ElementPlus); app.mount('#app')
 * marschat.bootstrap()
 * </pre>
 *
 * 配套后端（auth-core 自动装配，同样只需配置）：
 * <pre>
 * marschat:
 *   bff:
 *     enabled: true
 *     client-id: marschat-xxx
 * </pre>
 * + 一份 `bff-whitelist.yml`。
 */
export { createMarschatApp, readRuntimeConfig } from './createMarschatApp'
export { createMarschatShell, SHELL_CSS } from './shell'
export type { ShellOptions } from './shell'

export {
  resolveAppConfig,
  normalizeContextPath,
  baseFragment,
  deriveTokenKeys,
  mergeTokenKeys,
  appUrl,
  toRouterPath,
  DEFAULTS,
  DEFAULT_WHITE_LIST_PATHS,
} from './config'

export type {
  RuntimeConfig,
  ResolvedAppConfig,
  TokenKeys,
  SessionMode,
  AppOptionsInput,
} from './config'

export type {
  MarschatApp,
  MarschatAppOptions,
  RouterLike,
  RouteLike,
  RouteRecordLike,
  LoginPageOptions,
  UserManagementOptions,
} from './types'
