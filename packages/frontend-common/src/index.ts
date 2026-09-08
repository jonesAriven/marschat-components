/**
 * @marschat/frontend-common
 * 
 * MarsChat 前端公共工具包
 * 整合了 @marschat/request 和通用工具函数
 */

// 请求相关 (从 @marschat/request v0.1.0 迁移并增强)
export { createRequest, createLocalStorageTokenStore } from './request'
export type { CreateRequestOptions, TokenStore } from './request'

// 拦截器
export { createAuthInterceptor } from './interceptors/authInterceptor'
export { createErrorInterceptor } from './interceptors/errorInterceptor'

// Composables
export { usePagination } from './composables/usePagination'
export { useLoading } from './composables/useLoading'

// 工具函数
export { formatDateTime } from './utils/format'
export { storage } from './utils/storage'

// 类型导出
export type { RequestClient, AxiosRequestConfig, RequestOptions } from './types'
export type { PaginatedResponse, PaginationParams } from './types/pagination'
