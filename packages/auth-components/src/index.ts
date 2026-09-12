/**
 * @marschat/auth-components
 * 
 * MarsChat 统一认证公共组件库
 * 提供 SSO 单点登录、独立登录、忘记密码等功能的统一实现
 */

// 组件
export { default as LoginPanel } from './components/LoginPanel.vue'
export { default as LoginPage } from './components/LoginPage.vue'
export { default as SsoCallbackView } from './components/SsoCallbackView.vue'
// Phase 6：统一用户管理面板（一份实现，6 应用按 admin 权限挂载）
export { default as UserManagementPanel } from './components/UserManagementPanel.vue'
// Phase 2：RBAC 权限门
export { default as PermissionGate } from './components/PermissionGate.vue'

// 组合式函数
export { useSso } from './composables/useSso'
export { useAuth } from './composables/useAuth'
// Phase 2：RBAC 权限/菜单组合式函数
export { usePermissions, fetchPermissions, hasPermission } from './composables/usePermissions'
export type { PermissionsState, UsePermissionsOptions } from './composables/usePermissions'
export { useMenus } from './composables/useMenus'
export type { MenuItemDef } from './composables/useMenus'

// 工具函数
export {
  initTokenConfig,
  getToken,
  setToken,
  removeToken,
  getRefreshToken,
  setRefreshToken,
  removeRefreshToken,
  getIdToken,
  setIdToken,
  removeIdToken,
  clearTokens,
  getTokenKind,
  setTokenKind,
  isOidcToken,
  decodeOidcClaims,
} from './utils/token'
export {
  startSsoLogin,
  handleSsoCallback,
  refreshOidcToken,
  buildSsoAuthorizeUrl,
  // 紧密型接入（Phase 6）
  probeIdpSession,
  silentSignIn,
  bootstrapLoginPage,
  buildSloUrl,
  ssoLogout,
  renewByReauthorize,
  clearLocalAuth,
} from './utils/sso'
export { generateVerifier, generateChallenge, generateState, base64UrlEncode } from './utils/pkce'

// Phase 6：会话监视（单点登出跨应用联动）
export { createSessionWatcher, startSessionWatcher } from './utils/sessionWatcher'
export type { SessionWatcher, SessionWatcherOptions } from './utils/sessionWatcher'

// Phase 6：统一用户管理数据源（直连 auth-center 或走应用 BFF 代理）
export { createUserAdminClient, UserAdminError } from './utils/userAdmin'
export type {
  AdminUserItem,
  UserPageQuery,
  UserPageResult,
  CreateUserPayload,
  UpdateUserPayload,
  UserAdminClient,
  UserManagementConfig,
  CreateUserAdminClientOptions,
} from './utils/userAdmin'

// 类型
export type {
  SsoConfig,
  OidcTokenResponse,
  OidcClaims,
  TokenKind,
  LoginPanelConfig,
  AuthState,
  SessionProbeResult,
  SloOptions,
} from './types'

/**
 * 框架无关的认证客户端工厂（与 UMD 单文件版共用同一实现，见 src/client.ts）。
 *
 * 有构建链的 SPA 也可以直接用它，省掉每次重复拼 config 的样板代码：
 * ```ts
 * const sso = createSsoClient({ issuer, clientId, redirectUri, loginUrl })
 * if (await sso.bootstrapLoginPage('/dashboard')) { /* 已跳走 *\/ }
 * ```
 */
export { createSsoClient } from './client'
export type { SsoClient } from './client'
