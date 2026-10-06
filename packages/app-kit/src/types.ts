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
  /**
   * 🔴 **权限查询基址**（`fetchPermissions` 用的 issuer），缺省等于 `issuer`。
   *
   * 存在的唯一理由：门户类应用（portal / cosmic-studio）的权限点由**自家后端 BFF 代理**
   * 从 auth-center 取，浏览器**不能**直连 auth-center —— 直连会因缺 CORS/凭据 401，
   * 而权限层是 fail-open 的：401 → `configured=false` → **权限体系静默全放行**
   * （表现为「菜单全出来、按钮全可点」，且不报任何错）。
   * 因此这类应用必须把 `permissionsIssuer` 指向同源代理（通常 `${apiBase}`）。
   *
   * ⚠️ **绝对不要**为了绕过本项而把 BFF 基址塞进 `issuer`：
   * `issuer` 同时被 `ssoConfig.issuer` 消费（OIDC 发现 + 换票 + 会话探针），
   * 改它会把 SSO 客户端指向自家代理 → **静默免登与 SLO 联动全部失效且不报错**。
   * 两个字段必须分开：身份走中心（`issuer`），权限走代理（`permissionsIssuer`）。
   */
  permissionsIssuer?: string
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
  /**
   * 🔴 **清理「令牌四键之外」的应用自管会话残留**（登出/ 401 / 会话丢失时调用）。
   *
   * 装配层的 `removeToken()` 只删令牌四键（access / refresh / kind / id），
   * 组件库的 `clearLocalAuth()` 另删一个**硬编码**的 `auth_user`。
   * 存量应用的自管键（如 portal 的 `portal_user` / `portal_role` / `portal_auth_uid`）
   * **不在其中** ⇒ 登出后这些键**仍留在 localStorage**。
   *
   * 🔴 为什么这不只是「不干净」而是**安全问题**：`portal_role` 承载 `isAdmin` 判定。
   * 登出未清 → 下一个打开该应用的人（共用浏览器 / 公共机）在**尚未登录**时，
   * 若有代码读该键渲染管理员菜单，即为**权限信息泄漏**（前端 gate 被绕过）。
   *
   * 在此传入清理函数即可（幂等要求：**重复调用必须安全**，三条清理路径都会调它）：
   * <pre>
   * clearExtraAuth: () =&gt; {
   *   localStorage.removeItem('portal_user')
   *   localStorage.removeItem('portal_role')
   *   localStorage.removeItem('portal_auth_uid')
   * }
   * </pre>
   */
  clearExtraAuth?: () => void
  /**
   * 是否在挂载后启动会话监视（SLO 联动），默认 true。
   *
   * 🔴 **只对「纯 OIDC 单模应用」保持默认不传。**
   *
   * 判据含 `sessionMode === 'oidc'`（`createMarschatApp.ts` 的bootstrap 闸门），
   * 而 `sessionMode` 是**应用级常量** —— 它表达不了「同一应用内两种会话模式并存」的
   * **双模应用**（账密 `legacy` + SSO `oidc` 并存，如 kb-web / portal）。
   *
   * 🔴 **双模应用传函数式判据**：`watchSession: () => isOidcToken()`。
   * 组件库的 `getTokenKind()` 在**键缺失时回落 `'legacy'`**，故账密会话天然判false，
   * 只有浏览器侧真走过 OIDC 授权跳转的会话才返回 true —— 这正是「该不该被监视」的判据。
   * 若沿用布尔 `true`，监视器会去探 auth-center `/auth/session`（IdP 会话），
   * 而账密会话在浏览器侧**根本没有 IdP 会话** → 探针恒 false →
   * **3 秒后把在线用户误踢回 `?slo=1`**（2026-09-15kb-web / portal 实测事故，坑 #5 同源）。
   *
   * ⚠️ 反向坑：**纯 BFF 单模应用不要传函数**，让 `sessionMode` 闸门自然拦住；
   * 传 `false` 也会平白丢掉SLO 联动。判据是「**是否纯 oidc**」，不是「是否用 BFF」。
   */
  watchSession?: boolean | (() => boolean)
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
