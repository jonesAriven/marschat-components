/**
 * useAuth - 认证状态管理组合式函数
 * 统一管理登录状态、用户信息、token 刷新
 */

import { ref, computed } from 'vue'
import type { SsoConfig, AuthState, UseAuthOptions } from '../types'
import { getToken, setToken, getRefreshToken, setRefreshToken, clearTokens, getTokenKind, setTokenKind, decodeOidcClaims } from '../utils/token'
import { refreshOidcToken } from '../utils/sso'

export function useAuth(options: UseAuthOptions = {}) {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const user = ref<{ username?: string; [key: string]: any }>({})

  // 从 token 中恢复用户信息
  function restoreUserFromToken() {
    const token = getToken()
    if (token) {
      const kind = getTokenKind()
      if (kind === 'oidc') {
        const claims = decodeOidcClaims(token)
        user.value = {
          username: claims.username || claims.preferred_username || claims.sub,
          email: claims.email,
          ...claims,
        }
      } else {
        // 尝试从 localStorage 恢复
        const savedUser = localStorage.getItem('auth_user')
        if (savedUser) {
          user.value = { username: savedUser }
        }
      }
    }
  }

  // 初始化时尝试恢复用户信息
  restoreUserFromToken()

  /** 认证状态 */
  const authState = computed<AuthState>(() => ({
    isAuthenticated: !!getToken(),
    username: user.value.username || null,
    tokenKind: getTokenKind(),
    loading: loading.value,
    error: error.value,
  }))

  /**
   * 独立登录（用户名/密码）
   */
  async function login(username: string, password: string) {
    loading.value = true
    error.value = null

    try {
      if (!options.loginApi) {
        throw new Error('未配置 loginApi')
      }

      const data = await options.loginApi(username, password)
      
      // 存储 token（假设返回格式为 { accessToken, refreshToken, user }）
      if (data.accessToken || data.access_token || data.token) {
        setToken(data.accessToken || data.access_token || data.token)
        setTokenKind('legacy')
        
        if (data.refreshToken || data.refresh_token) {
          setRefreshToken(data.refreshToken || data.refresh_token)
        }

        // 存储用户信息
        if (data.user) {
          user.value = data.user
          localStorage.setItem('auth_user', data.user.username || '')
        } else if (data.username) {
          user.value = { username: data.username }
          localStorage.setItem('auth_user', data.username)
        }

        if (options.onLoginSuccess) {
          options.onLoginSuccess(data)
        }
      }

      return data
    } catch (e: any) {
      error.value = e?.message || e?.response?.data?.message || '登录失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * 尝试刷新 token（401 时调用）
   */
  async function refreshTokenIfNeeded(): Promise<boolean> {
    const kind = getTokenKind()
    
    // 仅 OIDC token 支持自动刷新
    if (kind === 'oidc' && options.ssoConfig && getRefreshToken()) {
      try {
        await refreshOidcToken(options.ssoConfig)
        restoreUserFromToken()
        return true
      } catch {
        // 刷新失败
      }
    }
    
    return false
  }

  /**
   * 登出
   */
  function logout() {
    clearTokens()
    localStorage.removeItem('auth_user')
    user.value = {}
    error.value = null
    
    if (options.logoutRedirect) {
      window.location.href = options.logoutRedirect
    }
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
    user,
    authState,

    // 方法
    login,
    logout,
    refreshTokenIfNeeded,
    clearError,
    restoreUserFromToken,
  }
}
