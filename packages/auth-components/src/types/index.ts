/**
 * @marschat/auth-components 类型定义
 */

/** SSO 配置选项 */
export interface SsoConfig {
  /** OIDC Issuer 地址（同时也是 auth-center 基地址，用于 /auth/session、/auth/slo） */
  issuer: string
  /** 客户端 ID */
  clientId: string
  /** 回调地址（完整 URL） */
  redirectUri: string
  /** OAuth2 scope，默认 'openid profile' */
  scope?: string
  /** Token 存储的 localStorage key 前缀 */
  tokenKeyPrefix?: string
  /**
   * 本应用登录页的完整 URL。
   *
   * 用途：
   * 1. 统一登出（SLO）默认回跳地址；
   * 2. 静默免登探测失败时不做事（页面正常显示登录框），成功时跳授权。
   *
   * 必须落在 auth-center 该客户端的 `post_logout_redirect_uris` 白名单内，
   * 否则后端会丢弃该参数并使用默认回跳。
   */
  loginUrl?: string
  /**
   * 是否启用静默免登：进入登录页时若探测到 IdP 会话则自动跳授权，用户无感进入。
   * 默认 true。
   */
  silentLogin?: boolean
  /**
   * 会话探针 / 统一登出端点的基地址，默认取 `issuer`。
   * 仅在 auth-center 与 issuer 不同域时（如内网直连）才需要显式覆盖。
   */
  authCenterBase?: string
}

/** 会话探针结果 */
export interface SessionProbeResult {
  /** auth-center 侧是否已存在有效 IdP 会话 */
  authenticated: boolean
  /** 已登录用户名（未登录为 null） */
  username?: string | null
  /**
   * 探针请求本身是否**成功执行**（HTTP 200 且响应可解析）——「可信度」标记。
   *
   * - `true`  → `authenticated` 可信，可以据此**主动登出**（会话确实没了）
   * - `false` → 网络异常 / 超时 / 非 200 / 响应不可解析，`authenticated` 只是兜底值，
   *             调用方（会话监视器）必须 **fail-safe 保持现状**，绝不能据此把用户踢出去。
   *
   * ★ 为什么必须区分：`probeIdpSession` 为保护登录页不自屏，异常时一律返回
   *   `{authenticated:false}`。若会话监视器不区分「确认无会话」与「探针失败」，
   *   auth-center 抖动一次就会把全平台在线用户集体登出 —— 这是比"登不掉"严重得多的事故。
   */
  ok?: boolean
}

/** 统一登出（SLO）选项 */
export interface SloOptions {
  /**
   * 登出后回跳地址。缺省取 `SsoConfig.loginUrl`。
   * 必须落在该客户端 `post_logout_redirect_uris` 白名单内。
   */
  postLogoutRedirectUri?: string
  /** 透传给 IdP 的 state（原样回到回跳地址） */
  state?: string
  /** id_token_hint；缺省自动从本地存储读取（登录回调时已保存） */
  idTokenHint?: string
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
  /**
   * 用户主键 id。
   *
   * ⚠️ 这是 auth-center 实际签发**独有**的 claim（实测 access_token payload：`sub=1, uid=1, role=admin, realm=kb, username=admin`）。
   * 各应用免 `/auth/me` 直接建会话时用的就是它，所以必须进类型 —— 否则下游只能用 `as any` 绕。
   */
  uid?: string | number
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
  /**
   * 认证接口基地址（相对或绝对 URL），默认 '/kb/api/auth'。
   *
   * 组件会拼接为 `${authApiBase}/forgot-password`（发送验证码）与
   * `${authApiBase}/reset-password`（校验验证码并重置密码）。
   * 各应用需按自己域名的 nginx 路由前缀覆盖，例如：
   * - kb-web        → '/kb/api/auth'
   * - kb-ops        → '/ops/auth-api'
   * - portal        → '/portal/auth-api'
   * - infra-monitor → '/kb/api/auth'
   */
  authApiBase?: string
  /** SSO 配置 */
  ssoConfig?: SsoConfig
  /** 自定义文案（可覆盖所有默认文案） */
  labels?: LoginPanelLabels
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

/** 品牌侧亮点条目 */
export interface LoginBrandHighlight {
  /** Element Plus 图标名（应用需全局注册图标） */
  icon?: string
  title: string
  desc?: string
}

/** 品牌侧配置（LoginPage 左栏） */
export interface LoginBrandConfig {
  /** 品牌名，默认取 config.title */
  name?: string
  /** 品牌标语，默认取 config.subtitle */
  tagline?: string
  /** 亮点列表 */
  highlights?: LoginBrandHighlight[]
  /** 品牌区渐变色 [起始, 结束] */
  gradient?: [string, string]
}

/**
 * 整页登录配置（LoginPage 组件）
 * 继承 LoginPanelConfig，应用只需传配置 + 监听事件
 */
export interface LoginPageConfig extends LoginPanelConfig {
  /** 布局：split=左品牌右表单，centered=居中卡片，默认 split */
  layout?: 'split' | 'centered'
  /** 品牌侧配置 */
  brand?: LoginBrandConfig
  /** 品牌区底部文字 */
  footerText?: string
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

/** useAuth 组合式函数选项 */
export interface UseAuthOptions {
  /** SSO 配置（可选，不配置则禁用 SSO 功能） */
  ssoConfig?: SsoConfig
  /** 登录 API 函数 */
  loginApi?: (username: string, password: string) => Promise<any>
  /** 登录成功后的处理 */
  onLoginSuccess?: (data: any) => void
  /** 登出后的跳转路径 */
  logoutRedirect?: string
}
