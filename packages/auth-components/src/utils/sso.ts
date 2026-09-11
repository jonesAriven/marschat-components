/**
 * SSO (OIDC) 核心工具函数
 * 封装完整的 authorization_code + PKCE 流程
 */

import type { SsoConfig, OidcTokenResponse, SessionProbeResult, SloOptions } from '../types'
import { generateVerifier, generateChallenge, generateState, base64UrlEncode } from './pkce'
import {
  setToken,
  setRefreshToken,
  setIdToken,
  getIdToken,
  getToken,
  getRefreshToken,
  setTokenKind,
  clearTokens,
} from './token'

// Session Storage keys
const SESSION_KEYS = {
  state: 'auth_sso_state',
  verifier: 'auth_sso_verifier',
  redirect: 'auth_sso_redirect',
}

/**
 * 发起 SSO 登录
 * 跳转到 OIDC 授权端点
 */
export async function startSsoLogin(
  config: SsoConfig,
  redirect: string = '/dashboard'
): Promise<never> {
  const state = generateState()
  const verifier = generateVerifier()
  const challenge = await generateChallenge(verifier)

  // 存储到 sessionStorage
  sessionStorage.setItem(SESSION_KEYS.state, state)
  sessionStorage.setItem(SESSION_KEYS.verifier, verifier)
  sessionStorage.setItem(SESSION_KEYS.redirect, redirect)

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scope || 'openid profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  // 跳转到授权端点（不返回）
  window.location.assign(`${config.issuer}/oauth2/authorize?${params.toString()}`)
  
  // TypeScript 需要 return 类型，但实际不会执行到这里
  return new Promise<never>(() => {})
}

/**
 * 处理 SSO 回调
 * 用 code + code_verifier 换取 token
 * @returns 应跳转的目标路径
 */
export async function handleSsoCallback(
  config: SsoConfig,
  searchParams: URLSearchParams = new URLSearchParams(window.location.search)
): Promise<string> {
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) {
    throw new Error(`统一认证拒绝: ${searchParams.get('error_description') || error}`)
  }
  if (!code) {
    throw new Error('授权回调缺少 code')
  }

  // 验证 state
  const savedState = sessionStorage.getItem(SESSION_KEYS.state)
  const verifier = sessionStorage.getItem(SESSION_KEYS.verifier)
  if (!savedState || savedState !== state) {
    throw new Error('state 校验失败，请重新发起登录')
  }
  if (!verifier) {
    throw new Error('PKCE 凭据丢失，请重新发起登录')
  }

  // 换取 token
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  })

  const res = await fetch(`${config.issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`换取令牌失败(HTTP ${res.status}): ${detail.slice(0, 120)}`)
  }

  const data = (await res.json()) as OidcTokenResponse

  // 清理 session 存储
  sessionStorage.removeItem(SESSION_KEYS.state)
  sessionStorage.removeItem(SESSION_KEYS.verifier)
  const target = sessionStorage.getItem(SESSION_KEYS.redirect) || '/dashboard'
  sessionStorage.removeItem(SESSION_KEYS.redirect)

  // 存储 token
  setTokenKind('oidc')
  setToken(data.access_token)
  if (data.refresh_token) {
    setRefreshToken(data.refresh_token)
  }
  // ★ id_token 必须留存：统一登出（SLO）要作为 id_token_hint 回传，
  //   否则 SAS /connect/logout 直接 400，登录态根本登不掉（2026-09-11 实测）
  if (data.id_token) {
    setIdToken(data.id_token)
  }

  return target
}

/**
 * OIDC Token 静默续期
 * 用于 401 时自动刷新
 */
export async function refreshOidcToken(config: SsoConfig): Promise<void> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    throw new Error('无 refresh_token')
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
  })

  const res = await fetch(`${config.issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    throw new Error(`OIDC 续期失败(HTTP ${res.status})`)
  }

  const data = (await res.json()) as OidcTokenResponse
  setToken(data.access_token)
  if (data.refresh_token) {
    setRefreshToken(data.refresh_token)
  }
}

/**
 * 构建完整的 SSO 授权 URL（用于 Portal 面板的 SSO 按钮）
 */
export function buildSsoAuthorizeUrl(config: SsoConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scope || 'openid profile',
  })
  return `${config.issuer}/oauth2/authorize?${params.toString()}`
}

// ==========================================================================
// 紧密型接入能力（Phase 6）：会话探针 / 静默免登 / 统一登出 / 静默续期
//
// 设计背景（2026-09-11）：
// - SAS 3.2.5 对 public client（client_authentication_methods=none）**不签发
//   refresh_token**（带 offline_access 会被拒 invalid_scope）→ 前端不存在
//   refresh_token 可刷，传统"静默续期"是死代码。
// - 因此续期改走「静默重授权」：IdP 会话还在时 /oauth2/authorize 会瞬间 302 回带
//   code，用户无感；会话没了才会落登录页（此时本来就必须重新登录）。
// - 会话存在性判断**不能读 sso_access_token Cookie**：该 Cookie 是 HttpOnly（JS 读不到），
//   且 OIDC 授权流根本不写它（只有 /auth/login 独立登录才写）。唯一可靠判据是
//   问服务端 /auth/session（它读的是服务端 Security 上下文）。
// ==========================================================================

/** auth-center 基地址（探针 / 登出的落点），默认取 issuer */
function authCenterBase(config: SsoConfig): string {
  return (config.authCenterBase || config.issuer || '').replace(/\/+$/, '')
}

/** 拼接 SSO 回调完成后的落地路径（默认 /dashboard） */
function normalizeRedirect(redirect?: string): string {
  const v = (redirect || '').trim()
  if (!v) return '/dashboard'
  return v.startsWith('/') ? v : `/${v}`
}

/**
 * 会话探针：询问 auth-center「当前浏览器是否已有有效 IdP 会话」。
 *
 * 跨域且需要带上 IdP 的 JSESSIONID，故必须 `credentials: 'include'`；
 * auth-center 侧已按凭据模式配置 CORS（回显具体 Origin，不用 `*`）。
 *
 * ⚠️ 探针失败（网络异常/被 CORS 拦截）一律按「无会话」处理，绝不抛错阻塞登录页，
 * 否则认证中心抖动会连带把 6 个应用的登录页全打成白屏。
 */
export async function probeIdpSession(
  config: SsoConfig,
  options: { timeoutMs?: number } = {}
): Promise<SessionProbeResult> {
  const timeoutMs = options.timeoutMs ?? 4000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${authCenterBase(config)}/auth/session`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) return { authenticated: false }
    const body: any = await res.json().catch(() => null)
    // 兼容 {code,data:{...}} 包裹 与 裸对象两种返回
    const payload = body && typeof body === 'object' && body.data ? body.data : body
    return {
      authenticated: !!payload?.authenticated,
      username: payload?.username ?? null,
    }
  } catch {
    return { authenticated: false }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 静默免登：探测到 IdP 会话就直接跳授权，用户无感进入目标页。
 *
 * @returns 已发起跳转时**不会返回**（页面已导航）；无会话时返回 false，
 *          调用方应正常渲染登录框。
 *
 * ⚠️ 不要用 `prompt=none`：SAS 3.2.5 不支持该参数（实测会直接渲染登录页，
 * 而不是返回 login_required 错误），因此判据改用「探针 + 落登录页即无会话」。
 */
export async function silentSignIn(config: SsoConfig, redirect?: string): Promise<boolean> {
  const probe = await probeIdpSession(config)
  if (!probe.authenticated) {
    return false
  }
  await startSsoLogin(config, normalizeRedirect(redirect))
  return true // 理论不可达：startSsoLogin 会导航离开
}

/**
 * 构建统一登出（SLO）URL。
 *
 * 指向 auth-center 的 `/auth/slo`：它会先清 `sso_access_token`/`sso_refresh_token`
 * 两个跨域 Cookie，再带 `id_token_hint` 跳到 SAS `/connect/logout` 销毁 IdP 会话，
 * 最后回跳到 `post_logout_redirect_uri`。
 */
export function buildSloUrl(config: SsoConfig, options: SloOptions = {}): string {
  const params = new URLSearchParams()
  const hint = options.idTokenHint ?? getIdToken()
  if (hint) params.set('id_token_hint', hint)
  const back = options.postLogoutRedirectUri ?? config.loginUrl
  if (back) params.set('post_logout_redirect_uri', back)
  if (options.state) params.set('state', options.state)
  const qs = params.toString()
  return `${authCenterBase(config)}/auth/slo${qs ? `?${qs}` : ''}`
}

/**
 * 统一登出（SLO）：一次跳转销毁 IdP 会话，并清空本地所有凭据。
 *
 * ⚠️ 顺序很关键：必须先取出 id_token（登出后本地就没了），再清本地，最后跳转。
 *
 * 与旧 `useSso.logout()`（只清本地）的区别：后者不碰 IdP 会话，
 * 下一个应用/下一次静默免登会把你**直接免密登回去**，看起来"登不掉"。
 */
export function ssoLogout(config: SsoConfig, options: SloOptions = {}): void {
  const hint = options.idTokenHint ?? getIdToken() ?? undefined
  const url = buildSloUrl(config, { ...options, idTokenHint: hint })
  clearLocalAuth()
  window.location.assign(url)
}

/**
 * 静默续期（方案 A）：public client 拿不到 refresh_token，
 * 改为「悄悄重跑一次授权」——IdP 会话在则秒回新 code，用户无感。
 *
 * @returns 同样不会返回（已导航离开）
 */
export async function renewByReauthorize(config: SsoConfig, redirect?: string): Promise<never> {
  const target = redirect || `${window.location.pathname}${window.location.search}`
  clearTokens()
  await startSsoLogin(config, target)
  return new Promise<never>(() => {})
}

/**
 * 登录页入口编排：进入登录页时调用一次。
 *
 * - 有 IdP 会话 → 静默免登（不返回）
 * - 无 IdP 会话 → 返回 false，正常显示登录框
 *
 * @param redirect 免登成功后的落地路径
 * @param options.force 为 true 时忽略 `config.silentLogin === false`
 */
export async function bootstrapLoginPage(
  config: SsoConfig,
  redirect?: string,
  options: { force?: boolean } = {}
): Promise<boolean> {
  if (!options.force && config.silentLogin === false) {
    return false
  }
  return silentSignIn(config, redirect)
}

/** 仅清本地凭据（不碰 IdP 会话）。供 ssoLogout / 401 兜底复用 */
export function clearLocalAuth(): void {
  clearTokens()
  try {
    localStorage.removeItem('auth_user')
  } catch {
    /* ignore */
  }
}
