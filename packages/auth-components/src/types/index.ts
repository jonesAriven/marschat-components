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

/** 忘记密码步骤 */
export type ForgotPasswordStep = 'email' | 'verify' | 'reset' | 'success'

/** 验证码发送响应 */
export interface SendCodeResponse {
  success: boolean
  message: string
  /** 验证码过期时间（秒） */
  expiresIn?: number
}

/** 密码重置请求 */
export interface ResetPasswordRequest {
  email: string
  code: string
  newPassword: string
}

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
  /** SSO 配置 */
  ssoConfig?: SsoConfig
  /** 独立登录回调 */
  onLogin?: (credentials: { username: string; password: string }) => Promise<void>
  /** SSO 登录回调（可选，默认使用内置逻辑） */
  onSsoLogin?: () => void
  /** 发送验证码回调（忘记密码流程） */
  onSendCode?: (email: string) => Promise<SendCodeResponse>
  /** 验证码验证回调 */
  onVerifyCode?: (email: string, code: string) => Promise<boolean>
  /** 重置密码回调 */
  onResetPassword?: (data: ResetPasswordRequest) => Promise<void>
}

/** 登录面板文案（可自定义） */
export interface LoginPanelLabels {
  /** 用户名输入框占位符 */
  usernamePlaceholder?: string
  /** 密码输入框占位符 */
  passwordPlaceholder?: string
  /** 登录按钮文字 */
  loginButtonText?: string
  /** SSO 按钮文字 */
  ssoButtonText?: string
  /** 忘记密码链接文字 */
  forgotPasswordText?: string
  /** 分隔线文字 */
  dividerText?: string
  /** 登录成功提示 */
  successMessage?: string
  /** 登录失败提示 */
  loginFailedMessage?: string
  /** SSO 未配置提示 */
  ssoNotConfiguredMessage?: string
  /** SSO 失败提示 */
  ssoFailedMessage?: string
  // 忘记密码相关文案
  /** 忘记密码标题 */
  forgotPasswordTitle?: string
  /** 邮箱输入框占位符 */
  emailPlaceholder?: string
  /** 发送验证码按钮文字 */
  sendCodeText?: string
  /** 验证码输入框占位符 */
  codePlaceholder?: string
  /** 重发验证码按钮文字 */
  resendCodeText?: string
  /** 验证按钮文字 */
  verifyCodeText?: string
  /** 新密码输入框占位符 */
  newPasswordPlaceholder?: string
  /** 确认密码输入框占位符 */
  confirmPasswordPlaceholder?: string
  /** 重置密码按钮文字 */
  resetPasswordText?: string
  /** 密码重置成功提示 */
  passwordResetSuccessText?: string
  /** 返回登录链接文字 */
  backToLoginText?: string
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
