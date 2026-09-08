/**
 * 认证拦截器
 * 处理 401 状态码，尝试 OIDC token 刷新
 */

import { isOidcToken, refreshOidcToken, clearTokens } from '../utils/token'
import type { SsoConfig } from '../types'

export interface AuthInterceptorOptions {
  /** SSO 配置（用于 OIDC token 刷新） */
  ssoConfig?: SsoConfig
  /** 刷新失败后的回调 */
  onRefreshFailed?: () => void | Promise<void>
}

/**
 * 创建认证拦截器配置
 */
export function createAuthInterceptor(options: AuthInterceptorOptions = {}) => {
  const { ssoConfig, onRefreshFailed } = options

  return {
    // 响应拦截器：处理 401 和 OIDC token 刷新
    async responseError(error: any) {
      const status = error.response?.status
      
      if (status === 401 && isOidcToken() && ssoConfig) {
        try {
          await refreshOidcToken(ssoConfig)
          // 成功后重放请求
          return true // 返回 true 表示已处理
        } catch {
          // 刷新失败
          if (onRefreshFailed) {
            await onRefreshFailed()
          } else {
            clearTokens()
            window.location.href = '/login'
          }
        }
      }
      return false // 未处理，交给默认错误处理
    }
  }
}
