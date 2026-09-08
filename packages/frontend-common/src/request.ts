/**
 * 请求工厂和 Token 存储实现
 * 基于 @marschat/request v0.1.0 迁移并增强
 * 
 * SSO Cookie 模式支持：
 * - 自动检测 Token 来源（Cookie / localStorage）
 * - SSO 模式下使用 credentials: 'include' 携带跨域 Cookie
 * - Legacy 模式下继续使用 Authorization header
 */

import axios from 'axios'
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { getToken, getTokenSource, isOidcToken, refreshOidcToken, clearTokens } from '@marschat/auth-components/utils/token'
import type { SsoConfig } from '@marschat/auth-components/types'

export interface TokenStore {
  getToken(): string | null
  setToken(token: string): void
  getRefreshToken(): string | null
  setRefreshToken(token: string): void
  removeToken(): void
  removeRefreshToken(): void
}

/**
 * 创建 localStorage Token 存储（Legacy 模式）
 */
export function createLocalStorageTokenStore(prefix: string = 'app'): TokenStore {
  const ACCESS_TOKEN_KEY = `${prefix}_access_token`
  const REFRESH_TOKEN_KEY = `${prefix}_refresh_token`

  return {
    getToken: () => localStorage.getItem(ACCESS_TOKEN_KEY) || null,
    setToken: (token: string) => localStorage.setItem(ACCESS_TOKEN_KEY, token),
    getRefreshToken: () => localStorage.getItem(REFRESH_TOKEN_KEY) || null,
    setRefreshToken: (token: string) => localStorage.setItem(REFRESH_TOKEN_KEY, token),
    removeToken: () => localStorage.removeItem(ACCESS_TOKEN_KEY),
    removeRefreshToken: () => localStorage.removeItem(REFRESH_TOKEN_KEY),
  }
}

/**
 * 创建 SSO Cookie Token 存储（SSO 模式）
 * 实际读取的是 Cookie，但提供统一的接口
 */
export function createSsoCookieTokenStore(): TokenStore {
  // 这里使用 auth-components 的 token 工具函数
  // 它们已经实现了 Cookie 优先、localStorage 降级的逻辑
  return {
    getToken: () => getToken(),
    setToken: (token: string) => {
      // SSO 模式下，token 主要由后端通过 Set-Cookie 设置
      // 前端也写入 localStorage 作为备份
      import('@marschat/auth-components/utils/token').then(({ setToken: set }) => {
        set(token)
      })
    },
    getRefreshToken: () => {
      // 动态导入避免循环依赖
      try {
        return require('@marschat/auth-components/utils/token').getRefreshToken()
      } catch {
        return null
      }
    },
    setRefreshToken: (token: string) => {
      try {
        require('@marschat/auth-components/utils/token').setRefreshToken(token)
      } catch {
        // ignore
      }
    },
    removeToken: () => {
      try {
        require('@marschat/auth-components/utils/token').removeToken()
      } catch {
        // ignore
      }
    },
    removeRefreshToken: () => {
      try {
        require('@marschat/auth-components/utils/token').removeRefreshToken()
      } catch {
        // ignore
      }
    },
  }
}

export interface CreateRequestOptions {
  /** API 基础地址 */
  baseURL?: string
  /** 认证 API 基础地址（可能不同于业务 API） */
  authBaseURL?: string
  /** Token 存储 */
  tokenStore?: TokenStore
  /** SSO 配置（用于 OIDC token 刷新） */
  ssoConfig?: SsoConfig
  /** 是否强制使用 SSO Cookie 模式 */
  useSsoCookie?: boolean
  /** 请求/响应拦截器 */
  interceptors?: {
    request?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig
    response?: (response: AxiosResponse) => AxiosResponse
    error?: (error: any) => any
  }
  /** 错误处理 */
  onError?: (message: string, error: any, isAxiosError: boolean) => void
  /** 未授权处理 */
  onUnauthorized?: () => void | Promise<void>
  /** 白名单路径（不触发错误） */
  whiteListPaths?: string[] | ((url: string) => boolean)
  /** 成功响应处理（可在各应用自定义） */
  onSuccess?: (response: AxiosResponse) => any
}

/**
 * 统一请求实例工厂
 * 
 * @example
 * ```ts
 * // SSO 模式（自动检测）
 * const api = createRequest({
 *   baseURL: '/api',
 *   ssoConfig: {
 *     issuer: 'https://auth.marschat.online',
 *     clientId: 'kb-web',
 *     redirectUri: `${window.location.origin}/login`,
 *   }
 * })
 * ```
 */
export function createRequest(options: CreateRequestOptions = {}): RequestClient {
  const {
    baseURL = '/api',
    authBaseURL = '/auth-api',
    tokenStore = createLocalStorageTokenStore(),
    ssoConfig,
    useSsoCookie,
    whiteListPaths: ['/login', '/register', '/refresh', '/health'],
    onError: (msg: string, error: any) => console.error('[request]', error),
    onUnauthorized: () => { 
      // 默认：清除 token 并跳转登录
      clearTokens()
      window.location.href = '/login' 
    },
    ...restOptions
  } = options

  const instance: AxiosInstance = axios.create({
    baseURL,
    timeout: 15000,
    // SSO 模式：允许跨域携带 Cookie
    withCredentials: useSsoCookie ?? (getTokenSource() === 'cookie'),
  })

  // 请求拦截器：自动附加 token
  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      // 先调用自定义拦截器
      if (restOptions.interceptors?.request) {
        config = restOptions.interceptors.request(config)
      }

      // 判断是否使用 SSO Cookie 模式
      const isSsoMode = useSsoCookie ?? (getTokenSource() === 'cookie')
      
      if (!isSsoMode) {
        // Legacy 模式：使用 Authorization header
        const token = tokenStore?.getToken() || getToken()
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
      }
      // SSO 模式：Cookie 会自动携带（withCredentials: true），无需手动设置 header
      
      return config
    }
  )

  // 响应拦截器：统一错误处理 + OIDC token 刷新
  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      // 成功回调
      if (restOptions.onSuccess) {
        const result = restOptions.onSuccess(response)
        if (result !== undefined) return result
      }

      // 错误处理
      if (response.data) {
        const data = response.data as any
        // 判断是否为标准错误格式 { code, message }
        if (typeof data === 'object' && data.code !== undefined && data.code !== 0 && data.code !== 200) {
          const msg = data.message || '请求失败'
          if (onError) onError(msg, data, false)
          return Promise.reject(new Error(msg))
        }
      }

      return response
    }
  )

  // 错误拦截器
  instance.interceptors.response.use(
    undefined, // 使用上面的成功处理器
    async (error: any) => {
      if (!error.response) {
        if (onError) onError(error.message || '网络错误', error, false)
        return Promise.reject(error)
      }
      
      const status = error.response?.status
      
      // 401 未授权 - 尝试刷新 OIDC token
      if (status === 401) {
        if (isOidcToken() && ssoConfig) {
          try {
            await refreshOidcToken(ssoConfig)
            // 重放请求
            return instance(error.config)
          } catch {
            // 刷新失败
            if (onUnauthorized) {
              const result = onUnauthorized()
              if (result instanceof Promise) return result
            } else {
              clearTokens()
              window.location.href = '/login'
            }
          }
        } else {
          // 非 OIDC 的 401
          if (onUnauthorized) {
            const result = onUnauthorized()
            if (result instanceof Promise) return result
          } else {
            clearTokens()
            window.location.href = '/login'
          }
        }
        return Promise.reject(error)
      }
      
      // 其他 HTTP 错误
      const msg = error.response?.data?.message || error.message || `HTTP ${status}`
      if (onError) onError(msg, error, true)
      return Promise.reject(error)
    }
  )

  // 扩展实例，添加便捷方法
  const client = instance as any as RequestClient
  client.getToken = () => tokenStore?.getToken() ?? getToken()
  client.setToken = (token: string) => tokenStore?.setToken(token)
  client.getRefreshToken = () => tokenStore?.getRefreshToken() ?? null
  client.clearTokens = () => {
    tokenStore?.removeToken()
    tokenStore?.removeRefreshToken()
  }

  return client
}

/** RequestClient 类型 - 增强版 AxiosInstance */
export interface RequestClient extends AxiosInstance {
  /** 获取当前 token */
  getToken(): string | null
  /** 设置 token */
  setToken(token: string): void
  /** 获取 refresh token */
  getRefreshToken(): string | null
  /** 清除所有 token */
  clearTokens(): void
}

export type { CreateRequestOptions, TokenStore, RequestClient }
