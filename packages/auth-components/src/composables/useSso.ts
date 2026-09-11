/**
 * useSso - SSO 组合式函数
 * 提供 SSO 登录状态管理和操作方法
 */

import { ref, computed } from 'vue'
import type { SsoConfig, AuthState, SessionProbeResult, SloOptions } from '../types'
import {
  startSsoLogin,
  handleSsoCallback,
  refreshOidcToken,
  buildSsoAuthorizeUrl,
  probeIdpSession,
  silentSignIn,
  ssoLogout,
  renewByReauthorize,
  clearLocalAuth,
} from '../utils/sso'
import {
  isOidcToken,
  clearTokens,
  getTokenKind,
  decodeOidcClaims,
  getToken,
  getRefreshToken,
} from '../utils/token'

export function useSso(config: SsoConfig) {
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** 当前认证状态 */
  const authState = computed<AuthState>(() => ({
    isAuthenticated: !!getToken(),
    username: localStorage.getItem('auth_user'),
    tokenKind: getTokenKind(),
    loading: loading.value,
    error: error.value,
  }))

  /**
   * 发起 SSO 登录
   * @param redirect 登录成功后的跳转目标
   */
  async function login(redirect?: string) {
    loading.value = true
    error.value = null

    try {
      await startSsoLogin(config, redirect)
      // 不会到达这里，因为会跳转
    } catch (e: any) {
      error.value = e?.message || 'SSO 登录发起失败'
      loading.value = false
      throw e
    }
  }

  /**
   * 处理 SSO 回调（在回调页面调用）
   * @param searchParams URLSearchParams，默认使用当前 location.search
   * @returns 应跳转的目标路径
   */
  async function callback(searchParams?: URLSearchParams): Promise<string> {
    loading.value = true
    error.value = null

    try {
      const redirect = await handleSsoCallback(config, searchParams)
      
      // 解析并存储用户信息
      const token = localStorage.getItem(
        config.tokenKeyPrefix ? `${config.tokenKeyPrefix}_access_token` : 'auth_access_token'
      )
      if (token) {
        const claims = decodeOidcClaims(token)
        localStorage.setItem('auth_user', claims.username || claims.preferred_username || claims.sub || '')
      }

      return redirect
    } catch (e: any) {
      error.value = e?.message || 'SSO 回调处理失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * 刷新 OIDC Token
   *
   * ⚠️ 方案 A（2026-09-11 起）：auth-center 对 public client 不签发 refresh_token，
   * 所以本地根本没有 refresh_token 可刷 —— 直接走「静默重授权」，
   * IdP 会话还在就秒回新 token，用户无感；会话没了会落登录页（本来也必须重登）。
   */
  async function refreshToken(): Promise<void> {
    if (!getRefreshToken()) {
      // 无 refresh_token：静默重授权（不会返回）
      await renewByReauthorize(config, `${window.location.pathname}${window.location.search}`)
      return
    }
    try {
      await refreshOidcToken(config)
    } catch (e: any) {
      clearTokens()
      error.value = e?.message || 'Token 刷新失败'
      throw e
    }
  }

  /**
   * 会话探针：查询 auth-center 侧是否仍有有效 IdP 会话。
   * 用于登录页静默免登判断、以及"是否还有全局登录态"的自检。
   */
  async function probeSession(): Promise<SessionProbeResult> {
    return probeIdpSession(config)
  }

  /**
   * 静默免登：有 IdP 会话则直接跳授权（不返回）；无会话返回 false。
   */
  async function trySilentSignIn(redirect?: string): Promise<boolean> {
    return silentSignIn(config, redirect)
  }

  /**
   * 统一登出（SLO）：销毁 IdP 会话 + 清本地凭据，然后回跳登录页。
   *
   * ⚠️ 与旧的 `logout()` 不同：`logout()` 只清本地，IdP 会话还在，
   * 下次访问会被**静默免登直接登回去**，看起来"登不掉"。要真正登出请用本方法。
   */
  function sloLogout(options: SloOptions = {}): void {
    ssoLogout(config, options)
  }

  /**
   * 构建完整的 SSO 授权 URL
   * 用于 Portal 面板等需要外部链接的场景
   */
  function getAuthorizeUrl(): string {
    return buildSsoAuthorizeUrl(config)
  }

  /**
   * 登出（仅清除本地认证状态，**不销毁 IdP 会话**）
   *
   * @deprecated 请改用 {@link sloLogout} 做真正的单点登出。
   *             本方法保留给「只清本地、不动全局登录态」的极少数场景。
   */
  function logout(): void {
    clearLocalAuth()
    error.value = null
  }

  /**
   * 清除错误
   */
  function clearError() {
    error.value = null
  }

  return {
    // 状态
    loading,
    error,
    authState,

    // 方法
    login,
    callback,
    refreshToken,
    getAuthorizeUrl,
    logout,
    clearError,

    // 紧密型接入（Phase 6）
    probeSession,
    trySilentSignIn,
    sloLogout,

    // 工具
    isOidc: isOidcToken,
  }
}
