/**
 * 用户级菜单减法数据源适配器（User Menu Override Client）
 *
 * `UserMenuOverridePanel.vue` 只负责「长什么样」，本文件负责「数据从哪来」，
 * 写法与 `utils/authorizationMatrix.ts` 的 `createAuthorizationMatrixClient` 对齐：
 * issuer 注入 → Bearer 鉴权 → 统一 Result 信封解包 → `UserMenuOverrideError` 报错。
 *
 * ## 语义（G1 · 角色级=上限，用户级只减不加）
 * 角色级授权（`sys_role_permission`）决定「这个用户在这个应用**最多**能看到哪些菜单」；
 * 用户级 override（`sys_user_menu_override`，action=deny）只能在这条上限线**之下做减法**，
 * 把某个菜单从该用户的可见集合里去掉，**永远不能新增**。
 *
 * 后端契约（auth-center `AdminRoleController` / `PermissionService`，2026-09-14 核实）：
 * ```
 * GET  {admin}/users/{userId}/menu-overrides?client=<clientId>
 *      → Result<Set<String>>   被 deny 的菜单**全码**，形如 `marschat-kbops:menu:ports`
 * PUT  {admin}/users/{userId}/menu-overrides?client=<clientId>
 *      body {"codes":["<全码>", ...]} → Result<{denied:n}>  **全量覆盖** deny 集
 *      （码必须是该 client 的有效 menu 权限点全码，否则 400）
 * GET  {admin}/permissions?client=<clientId>
 *      → Result<List<Map>>  该应用权限点明细（含失效），字段 snake_case：
 *                           id, type, code, name, parent_id, sort, status
 * GET  {admin}/users/{userId}/client-roles?client=<clientId>
 *      → Result<Set<Long>>  该用户在该应用的 client 级角色 id
 * GET  {admin}/roles/{roleId}/permission-codes
 *      → Result<Set<String>> 角色已授权全码（client:type:code）
 * ```
 * 统一返回包装：`{ code:200, message:'success', data:<T>, traceId }`。
 *
 * ⚠️ `/admin/permissions`、`/admin/roles` 由 `JdbcTemplate.queryForList` 直出，字段是
 *    **snake_case**（`parent_id` / `client_id`），与 `/admin/roles` 同源，读取时做双键兼容。
 */

/** 应用权限点明细条目（`GET /admin/permissions` 直出，snake_case） */
export interface MenuPermissionNode {
  id: number
  /** 权限点类型：`menu` | `api` */
  type: string
  /** 短码（不含 `client:type:` 前缀），如 `ports` */
  code: string
  name: string
  parentId?: number | null
  /** `/admin/permissions` 直出 snake_case 键（双键兼容，勿只读 camelCase） */
  parent_id?: number | null
  sort?: number | null
  /** 1=有效 0=已失效 */
  status: number
}

/**
 * 用户菜单减法数据源接口。
 *
 * 面板只依赖这 5 个方法；`list`/`save` 是核心读写，另 3 个方法用于**计算角色上限**
 * （把「角色已授权菜单的并集」渲染成面板上的可勾选范围）。
 */
export interface UserMenuOverrideClient {
  /** 该用户在本应用被 deny 的菜单全码集合（回显用） */
  list(userId: number | string, clientId: string): Promise<string[]>
  /**
   * 全量覆盖该用户在本应用的 deny 集。
   * @returns 服务端实际落库的 deny 数量
   */
  save(userId: number | string, clientId: string, codes: string[]): Promise<number>
  /** 本应用的权限点明细（含失效，调用方按 type/status 过滤） */
  listMenuPermissions(clientId: string): Promise<MenuPermissionNode[]>
  /** 该用户在本应用的 client 级角色 id 集合 */
  userClientRoles(userId: number | string, clientId: string): Promise<number[]>
  /** 某角色已授权的权限全码集合（`client:type:code`） */
  rolePermissionCodes(roleId: number | string): Promise<string[]>
}

/** 用户菜单减法接口错误（面板据此给出可读提示） */
export class UserMenuOverrideError extends Error {
  /** HTTP 状态码（0 表示未拿到响应，如网络异常） */
  readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'UserMenuOverrideError'
    this.status = status
  }
}

export interface CreateUserMenuOverrideClientOptions {
  /**
   * auth-center 根地址（OIDC issuer，如 `https://auth.marschat.online`，
   * 或 BFF 根如 `/portal/api`）。客户端内部拼 `${issuer}/admin/...`，
   * 因此**不要**带 `/admin` 后缀。
   */
  issuer: string
  /** 取当前 access_token 的函数；缺省取组件库 token 存储 */
  getToken?: () => string | null
  /** 401（登录已过期）时的回调，由应用注入「静默重授权」 */
  onUnauthorized?: () => void
  /** 自定义 fetch（便于测试注入或复用应用已配置的实例） */
  fetchImpl?: typeof fetch
  /** 单请求超时（毫秒），默认 15000 */
  timeoutMs?: number
}

/**
 * 创建用户级菜单减法数据源。
 *
 * @example
 * ```ts
 * const client = createUserMenuOverrideClient({
 *   issuer: 'https://auth.marschat.online',
 *   getToken: () => getToken(),
 * })
 * const denied = await client.list(148, 'marschat-kbops')       // ['marschat-kbops:menu:ports']
 * await client.save(148, 'marschat-kbops', denied)              // 全量覆盖
 * ```
 */
export function createUserMenuOverrideClient(
  options: CreateUserMenuOverrideClientOptions
): UserMenuOverrideClient {
  const issuer = (options.issuer || '').replace(/\/+$/, '')
  if (!issuer) {
    throw new UserMenuOverrideError(
      '[marschat-auth] createUserMenuOverrideClient 缺少 issuer'
    )
  }
  const admin = `${issuer}/admin`
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000

  async function request<T>(
    path: string,
    init: { method: string; body?: unknown; query?: Record<string, unknown> }
  ): Promise<T> {
    const url = new URL(`${admin}${path}`, window.location.origin)
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
      }
    }

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    const token = options.getToken ? options.getToken() : null
    if (token) headers['Authorization'] = `Bearer ${token}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(url.toString(), {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      throw new UserMenuOverrideError(
        e instanceof Error && e.name === 'AbortError' ? '请求超时，请稍后重试' : '网络异常，请检查连接',
        0
      )
    } finally {
      clearTimeout(timer)
    }

    if (res.status === 401 || res.status === 403) {
      if (res.status === 401 && options.onUnauthorized) {
        try {
          options.onUnauthorized()
        } catch {
          /* 注入的回调异常不掩盖原始 401 */
        }
      }
      throw new UserMenuOverrideError(
        res.status === 401 ? '登录已过期，请重新登录' : '当前账号无权限配置用户菜单权限',
        res.status
      )
    }

    if (res.status === 204) return undefined as T

    const text = await res.text().catch(() => '')
    let payload: any = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
    }

    if (!res.ok) {
      throw new UserMenuOverrideError(
        payload?.message || `请求失败(HTTP ${res.status})`,
        res.status
      )
    }

    // 解包统一返回格式 {code, message, data}
    if (payload && typeof payload === 'object' && 'code' in payload) {
      if (payload.code !== 200 && payload.code !== 0) {
        throw new UserMenuOverrideError(
          payload.message || `操作失败(code ${payload.code})`,
          res.status
        )
      }
      return payload.data as T
    }
    return payload as T
  }

  return {
    list(userId: number | string, clientId: string): Promise<string[]> {
      return request<string[]>(`/users/${encodeURIComponent(String(userId))}/menu-overrides`, {
        method: 'GET',
        query: { client: clientId },
      }).then((r) => r ?? [])
    },

    save(userId: number | string, clientId: string, codes: string[]): Promise<number> {
      return request<{ denied?: number }>(
        `/users/${encodeURIComponent(String(userId))}/menu-overrides`,
        {
          method: 'PUT',
          query: { client: clientId },
          body: { codes },
        }
      ).then((r) => r?.denied ?? codes.length)
    },

    listMenuPermissions(clientId: string): Promise<MenuPermissionNode[]> {
      return request<MenuPermissionNode[]>('/permissions', {
        method: 'GET',
        query: { client: clientId },
      }).then((r) => r ?? [])
    },

    userClientRoles(userId: number | string, clientId: string): Promise<number[]> {
      return request<number[]>(`/users/${encodeURIComponent(String(userId))}/client-roles`, {
        method: 'GET',
        query: { client: clientId },
      }).then((r) => r ?? [])
    },

    rolePermissionCodes(roleId: number | string): Promise<string[]> {
      return request<string[]>(`/roles/${encodeURIComponent(String(roleId))}/permission-codes`, {
        method: 'GET',
      }).then((r) => r ?? [])
    },
  }
}

/** 用户菜单权限面板配置（`UserMenuOverridePanel.vue` 的 props.config） */
export interface UserMenuOverrideConfig {
  /** 数据源（必填） */
  client: UserMenuOverrideClient
  /** 应用 client_id（必填，本应用菜单上限的作用域） */
  clientId: string
  /** 应用展示名（对话框标题），缺省用 clientId */
  appName?: string
  /** 被配置用户的 id */
  userId: number | string
  /** 被配置用户名（对话框标题） */
  username: string
  /** 标题前缀，默认「菜单权限」 */
  title?: string
}
