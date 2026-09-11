/**
 * Token 管理工具
 * 统一管理 access_token / refresh_token 的存取
 * 
 * SSO 模式下：
 * - 写入：由 auth-center 后端通过 Set-Cookie 设置 HttpOnly Cookie
 * - 读取：前端可读取非 HttpOnly Cookie 或从后端 API 获取
 * - 降级：localStorage（各系统独立 key）
 */

import type { TokenKind, OidcClaims } from '../types'

/** 默认配置 */
const DEFAULT_CONFIG = {
  accessTokenKey: 'auth_access_token',
  refreshTokenKey: 'auth_refresh_token',
  tokenKindKey: 'auth_token_kind',
  /**
   * id_token 存储键。
   *
   * ★ 为什么必须存：OIDC RP-Initiated Logout 要求 `id_token_hint`，
   *   而 SAS 的 /connect/logout 不给 hint 直接 400（实测 2026-09-11）。
   *   授权码换票时返回的 id_token 必须留住，登出时原样带回去，
   *   IdP 才能定位到要销毁哪个会话。
   */
  idTokenKey: 'auth_id_token',
}

/**
 * Cookie 配置 - SSO 跨域共享
 * 
 * 注意：前端 JavaScript 无法设置 HttpOnly Cookie
 * 因此 SSO Token 的 Cookie 应由后端 (auth-center) 通过 Set-Cookie 响应头设置
 * 前端设置的 Cookie 用于：
 * 1. 开发环境调试
 * 2. 非 SSO 模式的跨域 token 共享（安全性较低）
 */
const COOKIE_CONFIG = {
  /**
   * ★ 是否允许**前端 JS 写 Cookie**。默认 `false`（2026-09-11 起）。
   *
   * 为什么默认关：`sso_access_token` / `sso_refresh_token` 是 **auth-center 后端写的 HttpOnly Cookie**
   * （Domain=marschat.online）。前端若也往 `Domain=.marschat.online` 写同名 Cookie，浏览器会
   * **同时存在两份同名 Cookie**，后端读取时可能拿到前端那份（非 HttpOnly、可被 XSS 偷），
   * 且两份的过期时间/内容可能不一致 —— 属于"自己给自己埋雷"。
   *
   * 因此默认只写 localStorage；确有"非 SSO 模式跨域调试"需求时，由应用显式 `initTokenConfig({ cookie: { enabled: true } })` 打开。
   */
  enabled: false,
  /** SSO Access Token Cookie 名称（与后端一致） */
  accessTokenName: 'sso_access_token',
  /** SSO Refresh Token Cookie 名称 */
  refreshTokenName: 'sso_refresh_token',
  /** Cookie 域名 - 覆盖所有子域 */
  domain: '.marschat.online',
  /** Cookie 路径 */
  path: '/',
  /** 是否使用安全连接 */
  secure: true,
  /** SameSite 策略 */
  sameSite: 'Lax' as const,
  /** 过期时间（秒） */
  maxAge: 7200, // 2 小时
}

let config = { ...DEFAULT_CONFIG }

/**
 * 初始化 Token 配置（各应用应在入口处调用）
 * 
 * @example
 * ```ts
 * import { initTokenConfig } from '@marschat/auth-components'
 * 
 * initTokenConfig({
 *   accessTokenKey: 'kb_access_token',
 *   cookie: {
 *     domain: '.marschat.online',
 *     // 开发环境可关闭 secure
 *     secure: import.meta.env.PROD,
 *   }
 * })
 * ```
 */
export interface InitTokenConfigOptions {
  accessTokenKey?: string
  refreshTokenKey?: string
  tokenKindKey?: string
  idTokenKey?: string
  cookie?: {
    /** 是否允许前端 JS 写 Cookie，默认 false（见 COOKIE_CONFIG.enabled 说明） */
    enabled?: boolean
    domain?: string
    path?: string
    secure?: boolean
    sameSite?: string
    maxAge?: number
    accessTokenName?: string
    refreshTokenName?: string
  }
}

export function initTokenConfig(options: InitTokenConfigOptions = {}): void {
  if (options?.cookie) {
    Object.assign(COOKIE_CONFIG, options.cookie)
  }
  config = { ...DEFAULT_CONFIG, ...options }
}

// ========== Cookie 操作 ==========

/**
 * 设置 Cookie（前端版本，非 HttpOnly）
 * 
 * ⚠️ 安全提示：
 * - 此方法设置的 Cookie 可被 JavaScript 读取，存在 XSS 风险
 * - 生产环境应依赖后端 Set-Cookie 设置 HttpOnly Cookie
 * - 此方法主要用于开发环境和降级场景
 */
function setCookie(name: string, value: string, options?: Partial<typeof COOKIE_CONFIG>): void {
  const opts = { ...COOKIE_CONFIG, ...options }
  let cookieStr = `${name}=${encodeURIComponent(value)}`
  cookieStr += `; Domain=${opts.domain}`
  cookieStr += `; Path=${opts.path}`
  if (opts.secure) cookieStr += '; Secure'
  cookieStr += `; SameSite=${opts.sameSite}`
  cookieStr += `; Max-Age=${opts.maxAge}`
  document.cookie = cookieStr
}

/**
 * 从 Cookie 读取值
 * 
 * ⚠️ 只能读取非 HttpOnly 的 Cookie
 * HttpOnly Cookie 由浏览器自动发送到服务器，但 JS 无法读取
 */
function getCookie(name: string): string | null {
  if (!document.cookie || !document.cookie.includes(name)) return null
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * 删除 Cookie
 */
function deleteCookie(name: string): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${COOKIE_CONFIG.domain}`
}

// ========== 主方法（多层读取策略） ==========

/**
 * 获取 Access Token
 * 
 * 读取优先级：
 * 1. Cookie（SSO 模式，由后端设置或前端降级设置）
 * 2. localStorage（独立登录模式）
 */
export function getToken(): string | null {
  // 1. 尝试从 Cookie 读取（SSO 模式）
  const cookieVal = getCookie(COOKIE_CONFIG.accessTokenName)
  if (cookieVal) return cookieVal
  
  // 2. 降级到 localStorage（独立登录模式）
  return localStorage.getItem(config.accessTokenKey)
}

/**
 * 设置 Access Token
 * 
 * 写入策略：
 * 1. 写入 localStorage（始终写入，作为备份）
 * 2. 尝试写入 Cookie（用于 SSO 跨域共享）
 * 
 * ⚠️ 注意：生产环境的 SSO Token 应由后端通过 Set-Cookie 设置
 * 前端设置的 Cookie 仅用于开发/降级场景
 */
export function setToken(token: string): void {
  // 始终写入 localStorage（主存储）
  localStorage.setItem(config.accessTokenKey, token)

  // Cookie 写入是**可选**的（默认关闭，见 COOKIE_CONFIG.enabled 的说明）
  if (!COOKIE_CONFIG.enabled) return
  try {
    setCookie(COOKIE_CONFIG.accessTokenName, token)
  } catch (e) {
    console.warn('[auth] Failed to set token cookie:', e)
  }
}

/**
 * 移除 Access Token
 */
export function removeToken(): void {
  if (COOKIE_CONFIG.enabled) {
    deleteCookie(COOKIE_CONFIG.accessTokenName)
  }
  localStorage.removeItem(config.accessTokenKey)
}

/**
 * 获取 Refresh Token
 */
export function getRefreshToken(): string | null {
  const cookieVal = getCookie(COOKIE_CONFIG.refreshTokenName)
  if (cookieVal) return cookieVal
  return localStorage.getItem(config.refreshTokenKey)
}

/**
 * 设置 Refresh Token
 */
export function setRefreshToken(token: string): void {
  localStorage.setItem(config.refreshTokenKey, token)
  if (!COOKIE_CONFIG.enabled) return
  try {
    setCookie(COOKIE_CONFIG.refreshTokenName, token)
  } catch (e) {
    console.warn('[auth] Failed to set refresh token cookie:', e)
  }
}

/**
 * 移除 Refresh Token
 */
export function removeRefreshToken(): void {
  if (COOKIE_CONFIG.enabled) {
    deleteCookie(COOKIE_CONFIG.refreshTokenName)
  }
  localStorage.removeItem(config.refreshTokenKey)
}

/**
 * 获取 id_token（OIDC 登出必需的 id_token_hint）
 */
export function getIdToken(): string | null {
  try {
    return localStorage.getItem(config.idTokenKey)
  } catch {
    return null
  }
}

/**
 * 保存 id_token
 *
 * ⚠️ 只在授权码换票成功后调用（见 handleSsoCallback）。
 * 存 localStorage 而非 sessionStorage：SLO 可能发生在另一个标签页/刷新之后。
 */
export function setIdToken(token: string): void {
  if (!token) return
  try {
    localStorage.setItem(config.idTokenKey, token)
  } catch (e) {
    console.warn('[auth] Failed to persist id_token:', e)
  }
}

/** 移除 id_token */
export function removeIdToken(): void {
  try {
    localStorage.removeItem(config.idTokenKey)
  } catch {
    /* ignore */
  }
}

/** 清除所有 Token（含 id_token） */
export function clearTokens(): void {
  removeToken()
  removeRefreshToken()
  removeIdToken()
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

// ========== SSO 相关工具函数 ==========

/**
 * 检查是否存在 SSO Cookie
 * 用于判断用户是否已通过 SSO 登录
 */
export function hasSsoCookie(): boolean {
  return !!getCookie(COOKIE_CONFIG.accessTokenName)
}

/**
 * 获取当前 Token 的来源
 * 用于调试和日志
 */
export function getTokenSource(): 'cookie' | 'localStorage' | 'none' {
  if (getCookie(COOKIE_CONFIG.accessTokenName)) return 'cookie'
  if (localStorage.getItem(config.accessTokenKey)) return 'localStorage'
  return 'none'
}

/**
 * 导出 Cookie 配置（供其他模块使用）
 */
export function getCookieConfig() {
  return { ...COOKIE_CONFIG }
}
