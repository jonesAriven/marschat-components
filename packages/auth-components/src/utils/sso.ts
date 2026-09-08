/**
 * SSO (OIDC) 核心工具函数
 * 封装完整的 authorization_code + PKCE 流程
 */

import type { SsoConfig, OidcTokenResponse } from '../types'
import { generateVerifier, generateChallenge, generateState, base64UrlEncode } from './pkce'
import { setToken, setRefreshToken, setTokenKind } from './token'

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
