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

// 组合式函数
export { useSso } from './composables/useSso'
export { useAuth } from './composables/useAuth'

// 工具函数
export { initTokenConfig, getToken, setToken, removeToken, getRefreshToken, setRefreshToken, clearTokens, getTokenKind, setTokenKind, isOidcToken, decodeOidcClaims } from './utils/token'
export { startSsoLogin, handleSsoCallback, refreshOidcToken, buildSsoAuthorizeUrl } from './utils/sso'
export { generateVerifier, generateChallenge, generateState, base64UrlEncode } from './utils/pkce'

// 类型
export type {
  SsoConfig,
  OidcTokenResponse,
  OidcClaims,
  TokenKind,
  LoginPanelConfig,
  AuthState,
} from './types'
