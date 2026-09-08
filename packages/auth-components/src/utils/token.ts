/**
 * Token 管理工具
 * 统一管理 access_token / refresh_token 的存取
 */

import type { TokenKind, OidcClaims } from '../types'

/** 默认配置 */
const DEFAULT_CONFIG = {
  accessTokenKey: 'auth_access_token',
  refreshTokenKey: 'auth_refresh_token',
  tokenKindKey: 'auth_token_kind',
}

let config = { ...DEFAULT_CONFIG }

/**
 * 初始化 Token 配置（各应用应在入口处调用）
 */
export function initTokenConfig(options: {
  accessTokenKey?: string
  refreshTokenKey?: string
  tokenKindKey?: string
} = {}): void {
  config = { ...DEFAULT_CONFIG, ...options }
}

/** 获取 Access Token */
export function getToken(): string | null {
  return localStorage.getItem(config.accessTokenKey)
}

/** 设置 Access Token */
export function setToken(token: string): void {
  localStorage.setItem(config.accessTokenKey, token)
}

/** 移除 Access Token */
export function removeToken(): void {
  localStorage.removeItem(config.accessTokenKey)
}

/** 获取 Refresh Token */
export function getRefreshToken(): string | null {
  return localStorage.getItem(config.refreshTokenKey)
}

/** 设置 Refresh Token */
export function setRefreshToken(token: string): void {
  localStorage.setItem(config.refreshTokenKey, token)
}

/** 移除 Refresh Token */
export function removeRefreshToken(): void {
  localStorage.removeItem(config.refreshTokenKey)
}

/** 清除所有 Token */
export function clearTokens(): void {
  removeToken()
  removeRefreshToken()
  removeTokenKind()
}

/** 获取 Token 类型 */
export function getTokenKind(): TokenKind {
  return (localStorage.getItem(config.tokenKindKey) as TokenKind) || 'legacy'
}

/** 设置 Token 类型 */
export function setTokenKind(kind: TokenKind): void {
  localStorage.setItem(config.tokenKindKey, kind)
}

/** 移除 Token 类型 */
export function removeTokenKind(): void {
  localStorage.removeItem(config.tokenKindKey)
}

/** 是否为 OIDC Token */
export function isOidcToken(): boolean {
  return getTokenKind() === 'oidc'
}

/**
 * 从 RS256 access_token 解析 JWT claims
 * 注意：这不验证签名，仅用于提取用户信息
 */
export function decodeOidcClaims(token: string): OidcClaims {
  try {
    const payload = token.split('.')[1]
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    )
    return JSON.parse(json)
  } catch {
    return {}
  }
}
