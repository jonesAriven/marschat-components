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

// Phase 2：RBAC 路由守卫（权限拉取/判定由应用注入 auth-components 的 usePermissions，保持本包零跨包依赖）
export { createAuthGuard } from './authGuard'
export type { AuthGuardOptions } from './authGuard'
// Phase 2：统一侧边栏渲染（纯展示，输入 useMenus().visibleMenus）
export { default as SidebarMenu } from './components/SidebarMenu.vue'
export type { SidebarMenuItem } from './components/SidebarMenu.vue'

// 类型导出
export type { RequestClient, AxiosRequestConfig, RequestOptions } from './types'
export type { PaginatedResponse, PaginationParams } from './types/pagination'
