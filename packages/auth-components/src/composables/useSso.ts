/**
 * useSso - SSO 组合式函数
 * 提供 SSO 登录状态管理和操作方法
 */

import { ref, computed } from 'vue'
import type { SsoConfig, AuthState } from '../types'
import { startSsoLogin, handleSsoCallback, refreshOidcToken, buildSsoAuthorizeUrl } from '../utils/sso'
import { isOidcToken, clearTokens, getTokenKind, decodeOidcClaims, getToken } from '../utils/token'

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
   */
  async function refreshToken(): Promise<void> {
    try {
      await refreshOidcToken(config)
    } catch (e: any) {
      // 刷新失败，清除 token
      clearTokens()
      error.value = e?.message || 'Token 刷新失败'
      throw e
    }
  }

  /**
   * 构建完整的 SSO 授权 URL
   * 用于 Portal 面板等需要外部链接的场景
   */
  function getAuthorizeUrl(): string {
    return buildSsoAuthorizeUrl(config)
  }

  /**
   * 登出（清除所有认证状态）
   */
  function logout(): void {
    clearTokens()
    localStorage.removeItem('auth_user')
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
    
    // 工具
    isOidc: isOidcToken,
  }
}
