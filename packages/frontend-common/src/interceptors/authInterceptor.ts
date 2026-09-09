/**
 * 认证拦截器
 * 处理 401 状态码，尝试 OIDC token 刷新
 * 
 * SSO 模式增强：
 * - 请求时自动携带 Cookie（credentials: 'include'）
 * - SSO 模式下不再手动设置 Authorization header（依赖 Cookie 自动携带）
 */

import { isOidcToken, refreshOidcToken, clearTokens, getToken, getTokenSource } from '../request'
import type { SsoConfig } from '../request'

export interface AuthInterceptorOptions {
  /** SSO 配置（用于 OIDC token 刷新） */
  ssoConfig?: SsoConfig
  /** 刷新失败后的回调 */
  onRefreshFailed?: () => void | Promise<void>
  /** 是否启用 SSO Cookie 模式（默认自动检测） */
  useSsoCookie?: boolean
}

/**
 * 创建认证拦截器配置
 * 
 * @example
 * ```ts
 * import { createAuthInterceptor } from '@marschat/frontend-common'
 * 
 * const authInterceptor = createAuthInterceptor({
 *   ssoConfig: {
 *     issuer: 'https://auth.marschat.online',
 *     clientId: 'kb-web',
 *     redirectUri: `${window.location.origin}/login`,
 *   },
 *   onRefreshFailed: () => {
 *     window.location.href = '/login'
 *   }
 * })
 * ```
 */
export function createAuthInterceptor(options: AuthInterceptorOptions = {}) {
  const { ssoConfig, onRefreshFailed, useSsoCookie } = options

  return {
    /**
     * 请求拦截器：添加认证信息
     * 
     * SSO Cookie 模式：
     * - 设置 credentials: 'include' 以便跨域携带 Cookie
     * - 不再手动设置 Authorization header（Cookie 会自动携带）
     * 
     * Legacy 模式：
     * - 继续使用 Authorization: Bearer xxx header
     */
    requestHandler(config: any) {
      // 判断是否使用 SSO Cookie 模式
      const isSsoMode = useSsoCookie ?? (getTokenSource() === 'cookie')
      
      if (isSsoMode) {
        // SSO 模式：使用 Cookie 传递 token
        config.credentials = 'include'
        // 不再手动设置 Authorization header，Cookie 会自动携带
        // 但如果后端也支持 Header，可以保留作为降级方案
      } else {
        // Legacy 模式：使用 Authorization header
        const token = getToken()
        if (token) {
          config.headers = config.headers || {}
          config.headers.Authorization = `Bearer ${token}`
        }
      }
      
      return config
    },

    /**
     * 响应拦截器：处理 401 和 OIDC token 刷新
     */
    async responseError(error: any) {
      const status = error.response?.status
      
      if (status === 401 && isOidcToken() && ssoConfig) {
        try {
          await refreshOidcToken(ssoConfig)
          // 成功后重放请求
          return true // 返回 true 表示已处理，应重放请求
        } catch {
          // 刷新失败
          if (onRefreshFailed) {
            await onRefreshFailed()
          } else {
            clearTokens()
            window.location.href = '/login'
          }
        }
      } else if (status === 401) {
        // 非 OIDC 的 401，直接跳转登录
        clearTokens()
        window.location.href = '/login'
      }
      
      return false // 未处理，交给默认错误处理
    }
  }
}

/**
 * 创建适用于 Axios 的请求拦截器
 * 
 * @example
 * ```ts
 * import axios from 'axios'
 * import { createAxiosAuthInterceptor } from '@marschat/frontend-common'
 * 
 * const api = axios.create({ baseURL: '/api' })
 * const authInterceptor = createAxiosAuthInterceptor({ ssoConfig })
 * 
 * api.interceptors.request.use(authInterceptor.requestHandler)
 * api.interceptors.response.use(
 *   (res) => res,
 *   async (error) => {
 *     const shouldRetry = await authInterceptor.responseError(error)
 *     if (shouldRetry) {
 *       // 重放请求
 *       return api(error.config)
 *     }
 *     return Promise.reject(error)
 *   }
 * )
 * ```
 */
export function createAxiosAuthInterceptor(options: AuthInterceptorOptions = {}) {
  return createAuthInterceptor(options)
}
