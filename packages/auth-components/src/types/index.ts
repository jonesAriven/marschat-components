/**
 * @marschat/auth-components 类型定义
 */

/** SSO 配置选项 */
export interface SsoConfig {
  /** OIDC Issuer 地址 */
  issuer: string
  /** 客户端 ID */
  clientId: string
  /** 回调地址（完整 URL） */
  redirectUri: string
  /** OAuth2 scope，默认 'openid profile' */
  scope?: string
  /** Token 存储的 localStorage key 前缀 */
  tokenKeyPrefix?: string
}

/** OIDC Token 响应 */
export interface OidcTokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  token_type: string
  expires_in: number
  scope?: string
}

/** JWT Claims */
export interface OidcClaims {
  sub?: string
  username?: string
  preferred_username?: string
  unique_name?: string
  name?: string
  email?: string
  realm?: string
  role?: string
  exp?: number
  iat?: number
}

/** Token 类型 */
export type TokenKind = 'legacy' | 'oidc'

/** 登录面板配置 */
export interface LoginPanelConfig {
  /** 应用名称 */
  title: string
  /** 副标题 */
  subtitle?: string
  /** Logo 图标名（Element Plus 图标）或组件 */
  icon?: string | object
  /** 主题色 */
  color?: string
  /** 是否显示 SSO 按钮，默认 true */
  showSso?: boolean
  /** 是否显示忘记密码链接，默认 true */
  showForgotPassword?: boolean
  /** 忘记密码页面 URL */
  forgotPasswordUrl?: string
  /** SSO 配置 */
  ssoConfig?: SsoConfig
  /** 独立登录回调 */
  onLogin?: (credentials: { username: string; password: string }) => Promise<void>
  /** SSO 登录回调（可选，默认使用内置逻辑） */
  onSsoLogin?: () => void
}

/** 认证状态 */
export interface AuthState {
  /** 是否已登录 */
  isAuthenticated: boolean
  /** 用户名 */
  username: string | null
  /** Token 类型 */
  tokenKind: TokenKind
  /** 是否正在加载 */
  loading: boolean
  /** 错误信息 */
  error: string | null
}
