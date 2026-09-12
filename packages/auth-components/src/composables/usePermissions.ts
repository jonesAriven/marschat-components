/**
 * usePermissions（Phase 2 · RBAC 前端能力）
 *
 * 拉取并缓存当前用户在本应用的权限集合（auth-center `GET /auth/permissions`），
 * 供路由守卫、菜单渲染、<PermissionGate> 三处同源消费（三层同源铁律）。
 *
 * **R10 默认策略**：`configured === false`（应用尚未配置任何权限点）→ 一切放行、
 * 菜单全显，存量应用接入本组合式函数后行为不变。
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'

export interface PermissionsState {
  /** 是否已拉取过至少一次。 */
  loaded: boolean
  /** auth-center 侧是否为本应用配置过权限点（false = 未接入权限，全部放行）。 */
  configured: boolean
  /** 平台角色（user.role 语义：admin/user/superadmin）。 */
  platformRoles: string[]
  /** 本应用角色（含 composite 展开）。 */
  roles: string[]
  /** 权限点集合，规范 code `<client>:<type>:<code>`。 */
  permissions: string[]
}

export interface UsePermissionsOptions {
  /** auth-center 基址，如 https://auth.marschat.online */
  issuer: string
  /** 本应用 client_id */
  clientId: string
  /** 取 Bearer token（含过期/自管 token 的应用注入自己的读法） */
  getToken: () => string | null | undefined
  /** 平台超管恒放行（默认 true）。 */
  adminBypass?: boolean
}

const state: PermissionsState = {
  loaded: false,
  configured: false,
  platformRoles: [],
  roles: [],
  permissions: [],
}

/** 模块级共享状态（同一页面多个组件/守卫共用一份拉取结果）。 */
const loading = ref(false)
const stateRef: Ref<PermissionsState> = ref({ ...state })
let lastFetchedAt = 0
let inflight: Promise<void> | null = null

const isAdminRole = (r: string) => r === 'admin' || r === 'superadmin'

/** 拉取权限（60s 内复用缓存；force 跳过缓存）。 */
export async function fetchPermissions(opts: UsePermissionsOptions, force = false): Promise<PermissionsState> {
  if (!force && stateRef.value.loaded && Date.now() - lastFetchedAt < 60_000) {
    return stateRef.value
  }
  if (inflight) {
    return inflight.then(() => stateRef.value)
  }
  inflight = (async () => {
    loading.value = true
    try {
      const token = opts.getToken() || ''
      const res = await fetch(
        `${opts.issuer.replace(/\/+$/, '')}/auth/permissions?client=${encodeURIComponent(opts.clientId)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      )
      const body = await res.json()
      if (body && body.code === 200 && body.data) {
        stateRef.value = {
          loaded: true,
          configured: !!body.data.configured,
          platformRoles: (body.data.platformRoles || []) as string[],
          roles: (body.data.roles || []) as string[],
          permissions: (body.data.permissions || []) as string[],
        }
        lastFetchedAt = Date.now()
      } else {
        // 拉取失败：fail-open——保持/回退到「未配置」语义，绝不把页面打成全 403
        stateRef.value = { ...stateRef.value, loaded: true, configured: false }
      }
    } catch {
      stateRef.value = { ...stateRef.value, loaded: true, configured: false }
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight.then(() => stateRef.value)
}

/**
 * 权限判定。code 支持带或不带 client 前缀；
 * 未配置（configured=false）或平台超管恒放行。
 */
export function hasPermission(opts: UsePermissionsOptions, code: string): boolean {
  const s = stateRef.value
  if (!s.configured) {
    return true
  }
  if (opts.adminBypass !== false && s.platformRoles.some(isAdminRole)) {
    return true
  }
  const full = code.indexOf(':') >= 0 ? code : `${opts.clientId}:${code}`
  return s.permissions.includes(full)
}

/** 响应式只读视图（模板里用）。 */
export function usePermissions(opts: UsePermissionsOptions) {
  const perms = computed(() => stateRef.value.permissions)
  const configured = computed(() => stateRef.value.configured)
  const roles = computed(() => stateRef.value.roles)
  const isPlatformAdmin = computed(() => stateRef.value.platformRoles.some(isAdminRole))
  const check = (code: string) => hasPermission(opts, code)
  return { state: stateRef, perms, configured, roles, isPlatformAdmin, loading, check, refresh: () => fetchPermissions(opts, true), ensure: () => fetchPermissions(opts) }
}
