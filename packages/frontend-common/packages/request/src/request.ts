/**
 * 请求工厂和 Token 存储实现
 * 基于 @marschat/request v0.1.0 迁移并增强
 */

import axios from 'axios'
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig, RawAxiosRequestConfig } from 'axios'

export interface TokenStore {
  getToken(): string | null
  setToken(token: string): void
  getRefreshToken(): string | null
  setRefreshToken(token: string): void
  removeToken(): void
  removeRefreshToken(): void
}

/**
 * 创建 localStorage Token 存储
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

export interface CreateRequestOptions {
  /** API 基础地址 */
  baseURL?: string
  /** 认证 API 基础地址（可能不同于业务 API） */
  authBaseURL?: string
  /** Token 存储 */
  tokenStore?: TokenStore
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
 */
export function createRequest(options: CreateRequestOptions = {}): {
  const {
    baseURL = '/api',
    authBaseURL = '/auth-api',
    tokenStore = createLocalStorageTokenStore(),
    whiteListPaths: ['/login', '/register', '/refresh', '/health'],
    onError: (msg) => console.error('[request]', error),
    onUnauthorized: () => { 
      // 默认：清除 token 并跳转登录
      options.tokenStore?.removeToken()
      window.location.href = '/login' 
    },
    ...options
  } = options

  const instance: AxiosInstance = axios.create({
    baseURL,
    timeout: 15000,
  })

  // 请求拦截器：自动附加 token
  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const token = options.tokenStore?.getToken()
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    }
  )

  // 响应拦截器：统一错误处理
  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      // 成功回调
      if (options.onSuccess) {
        const result = options.onSuccess(response)
        if (result !== undefined) return result
      }

      // 错误处理
      if (response.data) {
        const data = response.data as any
        // 判断是否为标准错误格式 { code, message }
        if (typeof data === 'object' && data.code !== undefined && data.code !== 0 && data.code !== 200) {
          const msg = data.message || '请求失败'
          if (options.onError) options.onError(msg, data, false)
          return Promise.reject(new Error(msg))
        }
      }

      return response
    }
  )

  // 错误拦截器
  instance.interceptors.response.use(
    (error: any) => {
      if (!error.response) {
        if (options.onError) options.onError(error.message || '网络错误', error, false)
        return Promise.reject(error)
      }
      
      const status = error.response?.status
      
      // 401 未授权
      if (status === 401) {
        if (options.onUnauthorized) {
          const result = options.onUnauthorized()
          if (result instanceof Promise) return result
        }
        return Promise.reject(error)
      }
      
      // 其他 HTTP 错误
      const msg = error.response?.data?.message || error.message || `HTTP ${status}`
      if (options.onError) options.onError(msg, error, true)
      return Promise.reject(error)
    }
  )

  return instance as RequestClient
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

// 扩展实例，添加便捷方法
;(instance as any).getToken = () => options.tokenStore?.getToken() ?? null
;(instance as any).setToken = (token: string) => options.tokenStore?.setToken(token)
;(instance as any).getRefreshToken = () => options.tokenStore?.getRefreshToken() ?? null
;(instance as any).clearTokens = () => {
  options.tokenStore?.removeToken()
  options.tokenStore?.removeRefreshToken()
}

export type { CreateRequestOptions, TokenStore, RequestClient }
