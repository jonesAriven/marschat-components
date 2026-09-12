/**
 * createAuthGuard（Phase 2 · frontend-common）
 *
 * 路由守卫工厂：**挂载路由前先拉权限**——修正「先挂路由后拉菜单」的
 * 既有脆弱点（守卫在异步权限加载完成前跑一次、此后不再拦，直输 URL 就穿过了）。
 *
 * 设计：本包对 auth-components **零依赖**——权限拉取/判定由调用方注入
 * （建议传 `@marschat/auth-components` 的 usePermissions 闭包，保证守卫与
 * 菜单/PermissionGate 消费同一份权限状态，三层同源）。
 *
 * 用法：
 * ```ts
 * const perms = usePermissions({ issuer, clientId, getToken })
 * createAuthGuard(router, {
 *   ensure: () => perms.ensure(),
 *   hasPerm: (code) => perms.check(code),
 *   onDeny: (to) => router.replace('/403'),
 * })
 * ```
 *
 * 语义（R10 默认策略）：应用未配置权限点 → 全放行；auth-center 不可达 →
 * ensure 内部按未配置降级（fail-open），守卫不拦。
 */

/**
 * 零依赖路由结构类型（结构兼容 vue-router，避免本包引入 vue-router peer 依赖）。
 */
export interface AuthGuardRoute {
  path: string
  meta?: Record<string, unknown>
}

export interface AuthGuardRouter {
  beforeEach(guard: (to: AuthGuardRoute) => unknown): unknown
}

export interface AuthGuardOptions {
  /** 确保权限集合就绪（含缓存；由 auth-components 的 usePermissions().ensure() 提供）。 */
  ensure: () => Promise<unknown>
  /** 权限点判定（未配置权限点的应用恒 true）。 */
  hasPerm: (code: string) => boolean
  /** 从路由声明权限点的 meta 键名（默认 'perm'）。 */
  permMetaKey?: string
  /** 拒绝时的去向。 */
  onDeny?: (to: AuthGuardRoute) => void
  /** 免检路由路径前缀（默认 [/login, /sso-callback, /auth/, /public]）。 */
  publicPrefixes?: string[]
}

const DEFAULT_PUBLIC = ['/login', '/sso-callback', '/auth/', '/public']

export function createAuthGuard(router: AuthGuardRouter, options: AuthGuardOptions) {
  const publicPrefixes = options.publicPrefixes ?? DEFAULT_PUBLIC
  const isPublic = (to: AuthGuardRoute) =>
    publicPrefixes.some((p) => to.path === p || to.path.startsWith(p))
  const metaKey = options.permMetaKey ?? 'perm'

  router.beforeEach(async (to) => {
    if (isPublic(to)) {
      return true
    }
    const perm = (to.meta?.[metaKey] as string | undefined) ?? undefined
    if (!perm) {
      return true
    }
    try {
      await options.ensure()
    } catch {
      return true // fail-open：拉取异常按放行（ensure 实现内部已降级为未配置语义）
    }
    if (options.hasPerm(perm)) {
      return true
    }
    if (options.onDeny) {
      options.onDeny(to)
    }
    return false
  })
}

/** 已注册守卫的句柄（预留：如需注销）。 */
export interface AuthGuardHandle {
  options: AuthGuardOptions
}
