/**
 * `@marschat/app-kit` 对外类型 —— 应用接入的唯一契约面。
 */
import type { AppOptionsInput, ResolvedAppConfig, RuntimeConfig, SessionMode, TokenKeys } from './config'
import type { ShellOptions } from './shell'
import type { SsoClient, UsePermissionsOptions } from '@marschat/auth-components'
import type { createRequest } from '@marschat/frontend-common'
import type { Component } from 'vue'

export type { AppOptionsInput, ResolvedAppConfig, RuntimeConfig, SessionMode, TokenKeys }

/**
 * 路由实例的结构性最小契约。
 *
 * 刻意**不 import `vue-router`**：一是避免给接入方增加 peer 依赖，二是让本包在非 Vue 环境也能编译。
 *
 * ⚠️ 方法签名**刻意放宽到 `any`**：vue-router 的 `Router` 带重载（`addRoute(parentName, route)`）
 * 与更严格的参数类型（`RouteLocationNormalized` / `RouteRecordRaw`），
 * 手写精确结构类型会导致 `Router` **不可赋值**（实测：kb-ops 迁移时报
 * `TS2322: Type 'Router' is not assignable to type 'RouterLike'`）。
 * 本包只用到这几个方法的「存在性」与调用，不做参数级约束，故放宽是正确取舍。
 */
export interface RouterLike {
  /** 注册全局前置守卫（vue-router 的 `beforeEach`）。 */
  beforeEach(guard: (...args: any[]) => unknown): unknown
  /** 注册路由（vue-router 的 `addRoute`，含 `(parentName, route)` 重载）。 */
  addRoute(...args: any[]): unknown
  /** 跳转（vue-router 的 `replace`）。 */
  replace(to: any): unknown
  /** 当前路由（vue-router 的 `currentRoute`，`Ref` 结构）。 */
  currentRoute?: { value?: { path?: string; fullPath?: string } }
}

/** 路由对象最小契约（守卫回调入参）。 */
export interface RouteLike {
  path: string
  fullPath?: string
  query?: Record<string, unknown>
  meta?: Record<string, unknown>
}

/** 路由记录最小契约（`addRoute` 入参）。 */
export interface RouteRecordLike {
  path: string
  name?: string
  component?: unknown
  meta?: Record<string, unknown>
}

/** 登录页外观与文案（透传 `@marschat/auth-components` 的 LoginPageConfig）。 */
export interface LoginPageOptions {
  /** 应用标题（品牌区主标题） */
  title?: string
  /** 品牌区副标题 */
  subtitle?: string
  /** 主题色 */
  color?: string
  /** 品牌图标名（Element Plus 图标） */
  icon?: string
  /** 布局：split / centered */
  layout?: 'split' | 'centered'
  /** 是否显示账密登录（纯 SSO 应用传 false） */
  showLocalLogin?: boolean
  /** 是否显示忘记密码 */
  showForgotPassword?: boolean
  /** 是否显示邮箱验证码登录 */
  showMailLogin?: boolean
  /** 品牌区底部文字 */
  footerText?: string
  /** 其余 LoginPageConfig 字段原样透传 */
  [key: string]: unknown
}

/** 用户管理页选项（透传 `@marschat/auth-components` 的 UserManagementConfig）。 */
export interface UserManagementOptions {
  /** 页面标题，默认「本系统用户」 */
  title?: string
  /** 副标题 */
  subtitle?: string
  /** 作用域：默认 `app`（只读本系统成员）；`platform` = 中心平台管理台 */
  scopeMode?: 'app' | 'platform'
  /** 数据源基址（同源 BFF）。默认 `${contextPath}/api/admin/users` */
  baseUrl?: string
  /** 角色选项 */
  roles?: Array<{ value: string; label: string }>
  /** 只读模式 */
  readonly?: boolean
  /** 是否允许删除 */
  allowDelete?: boolean
  /** 是否允许重置密码（应用侧应保持 false —— 口令是全局身份属性） */
  allowResetPassword?: boolean
  /** 当前用户 id / 用户名（自我保护：不允许删自己） */
  currentUserId?: number | string | null
  currentUsername?: string | null
  /** 其余 UserManagementConfig 字段原样透传 */
  [key: string]: unknown
}

/** `createMarschatApp` 入参。 */
export interface MarschatAppOptions extends AppOptionsInput {
  /** 路由实例（必填）。 */
  router: RouterLike
  /**
   * 本应用菜单定义 —— **唯一必须手写的业务数据**。
   * 声明式数据，不是代码逻辑；由 `useMenus` 按权限过滤后喂给侧边栏。
   */
  menus?: unknown[]
  /** 运行时配置；缺省自动读 `public/app-config.json`。 */
  runtime?: RuntimeConfig
  /** 当前站点 origin；缺省 `window.location.origin`。 */
  origin?: string
  /** 登录页外观（可选）。 */
  loginPage?: LoginPageOptions
  /** 用户管理页（可选；`usersPath: false` 时忽略）。 */
  userManagement?: UserManagementOptions
  /** 是否自动注册 `/login` `/sso-callback` `/users` 路由，默认 true。 */
  autoRoutes?: boolean
  /** 是否在挂载后预取权限点，默认 true。 */
  prefetchPermissions?: boolean
  /** 是否在挂载后启动会话监视（SLO 联动），默认 true。 */
  watchSession?: boolean
  /** 挂载后跳转的目标（登录成功落地页）；缺省 `homePath`。 */
  afterLoginRedirect?: string
}

/** `createMarschatApp` 返回值 —— 应用侧后续可用的全部句柄。 */
export interface MarschatApp {
  /** 派生后的最终配置（排查「配置到底生效了没」时的唯一依据）。 */
  config: ResolvedAppConfig
  /** SSO 客户端（`login` / `handleCallback` / `renew` / `logout` / `watchSession` / `decodeClaims`）。 */
  sso: SsoClient
  /** 统一请求实例（业务 `request` + 认证 `authRequest`，已带 401 续期分流）。 */
  request: ReturnType<typeof createRequest>
  /** 权限选项（直接喂给 `usePermissions` / `useMenus`，三层同源）。 */
  permissions: UsePermissionsOptions
  /** 挂载到 Vue 应用（**必须**在 `app.mount()` 前调用）。 */
  install(app: unknown): void
  /** 挂载后启动：会话监视 + 权限预取（幂等）。 */
  bootstrap(): void
  /**
   * 创建共享应用外壳（侧边栏 + 顶栏 + 内容区）。
   * 宿主：`<component :is="marschat.createShell()" />`，消除各应用自写 MainLayout 的复制粘贴。
   */
  createShell(overrides?: Partial<Omit<ShellOptions, 'router' | 'menus' | 'permissions'>>): Component
}
