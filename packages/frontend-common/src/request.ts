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
// Token 工具 - 内联实现避免跨包依赖
// 优先从 Cookie 读取，其次 localStorage
const ACCESS_TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const ID_TOKEN_KEY = 'id_token'

function getCookie(name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

export function getToken(): string | null {
  return getCookie(ACCESS_TOKEN_KEY) || localStorage.getItem(ACCESS_TOKEN_KEY) || null
}

export function getTokenSource(): 'cookie' | 'localStorage' {
  if (getCookie(ACCESS_TOKEN_KEY)) return 'cookie'
  return 'localStorage'
}

export function isOidcToken(): boolean {
  return !!getCookie(ID_TOKEN_KEY) || !!localStorage.getItem(ID_TOKEN_KEY)
}

export async function refreshOidcToken(ssoConfig: any): Promise<void> {
  // OIDC token 刷新逻辑由后端处理
  if (ssoConfig?.issuer) {
    const url = `${ssoConfig.issuer}/oauth2/token`
    const refreshToken = getCookie(REFRESH_TOKEN_KEY) || localStorage.getItem(REFRESH_TOKEN_KEY)
    if (!refreshToken) throw new Error('No refresh token')
    // 实际刷新逻辑在前端层面通常由后端 Set-Cookie 完成
  }
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(ID_TOKEN_KEY)
}

export interface SsoConfig {
  issuer: string
  clientId: string
  redirectUri: string
  scope?: string
}

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
  return {
    getToken: () => getToken(),
    setToken: (token: string) => localStorage.setItem(ACCESS_TOKEN_KEY, token),
    getRefreshToken: () => getCookie(REFRESH_TOKEN_KEY) || localStorage.getItem(REFRESH_TOKEN_KEY) || null,
    setRefreshToken: (token: string) => localStorage.setItem(REFRESH_TOKEN_KEY, token),
    removeToken: () => clearTokens(),
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
export function createRequest(options: CreateRequestOptions = {}): CreateRequestResult {
  const {
    baseURL = '/api',
    authBaseURL = '/auth-api',
    tokenStore = createLocalStorageTokenStore(),
    ssoConfig,
    useSsoCookie,
    whiteListPaths = ['/login', '/register', '/refresh', '/health'],
    onError = (msg: string, error: any) => console.error('[request]', error),
    onUnauthorized = () => {
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

  // ── auth 实例（认证端点专用：/login /logout /refresh /me）──
  // 契约（迁移前各应用 request.ts 的既有语义）：
  //   业务实例 request = 返回完整 AxiosResponse；
  //   auth 实例 authRequest = authBaseURL + Result 解包（拦截器直接 return data.data，
  //   调用方 `authRequest.post('/login') as Promise<LoginResponse>` 直接拿业务对象）。
  // ⚠️ 0.3.2 及之前 createRequest 只建单实例却收 authBaseURL 参数——authRequest
  //   解构恒为 undefined（kb-ops-web 登录报 "reading 'post' of undefined"，0.3.3 根治）。
  const authInstance: AxiosInstance = axios.create({
    baseURL: authBaseURL,
    timeout: 15000,
    withCredentials: useSsoCookie ?? (getTokenSource() === 'cookie'),
  })
  authInstance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const isSsoMode = useSsoCookie ?? (getTokenSource() === 'cookie')
    if (!isSsoMode) {
      const token = tokenStore?.getToken() || getToken()
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
    }
    return config
  })
  authInstance.interceptors.response.use(
    (response: AxiosResponse) => {
      const data = response.data as any
      // Result 封装解包：{code, message, data} → 直接返回 data（业务对象）
      if (typeof data === 'object' && data !== null && 'code' in data) {
        if (data.code === 200 || data.code === 0) {
          return data.data ?? data
        }
        const msg = data.message || '请求失败'
        if (onError) onError(msg, data, false)
        return Promise.reject(new Error(msg))
      }
      // 非 Result 格式：返回 body 本身
      return data
    },
    async (error: any) => {
      const status = error.response?.status
      if (status === 401) {
        if (onUnauthorized) {
          const result = onUnauthorized()
          if (result instanceof Promise) return result
        } else {
          clearTokens()
          window.location.href = '/login'
        }
        return Promise.reject(error)
      }
      const msg = error.response?.data?.message || error.message || `HTTP ${status}`
      if (onError) onError(msg, error, true)
      return Promise.reject(error)
    },
  )
  const authClient = authInstance as any as RequestClient
  authClient.getToken = () => tokenStore?.getToken() ?? getToken()
  authClient.clearTokens = () => {
    tokenStore?.removeToken()
    tokenStore?.removeRefreshToken()
  }

  return { request: client, authRequest: authClient }
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

/**
 * createRequest 返回的双实例（0.3.3 起）。
 * - request：业务实例（baseURL），返回完整 AxiosResponse；
 * - authRequest：认证实例（authBaseURL），Result 解包后直接返回业务对象。
 */
export interface CreateRequestResult {
  request: RequestClient
  authRequest: RequestClient
}
