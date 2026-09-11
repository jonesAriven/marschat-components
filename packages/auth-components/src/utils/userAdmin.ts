/**
 * 用户管理数据源适配器（User Admin Client）
 *
 * `UserManagementPanel.vue` 只负责「长什么样」，本文件负责「数据从哪来」。
 * 这样同一份面板可以挂在两种后端接入方式上，而 UI 一行不改：
 *
 * | 应用 | 资源基址（baseUrl） | 鉴权 |
 * | ---- | ----------------- | ---- |
 * | iportal | `/portal/api/admin/users`（portal-server BFF 代理） | 门户 token |
 * | kb-web / kb-ops / infra-monitor / activecode | `https://auth.marschat.online/admin/users` | auth-center 签发的 OIDC access_token |
 * | cosmic-studio | 后续按「映射接入」再加一种 client，无需改面板 | — |
 *
 * 后端契约（`auth-center` AdminUserController，2026-08-xx 核实）：
 * ```
 * GET    {base}?realmId=&keyword=&page=1&size=20  → Result<PageResult<User>>
 * POST   {base}                                   ← {username,password,role,nickname,email,realmId}
 * PUT    {base}/{id}                              ← {role,status,nickname,email}
 * DELETE {base}/{id}
 * PUT    {base}/{id}/password                     ← {newPassword}
 * ```
 * 统一返回包装：`{ code:200, message:'success', data:<T>, traceId }`。
 */

/** 用户条目（与 auth-center `User` 实体字段对齐） */
export interface AdminUserItem {
  id: number
  username: string
  nickname?: string | null
  email?: string | null
  phone?: string | null
  role?: string | null
  /** 1=启用 0=禁用 */
  status?: number | null
  realmId?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

/** 列表查询参数 */
export interface UserPageQuery {
  page?: number
  size?: number
  /** 关键字（username / email / nickname 模糊） */
  keyword?: string
  realmId?: string
}

/** 分页结果（与 common-core `PageResult` 对齐） */
export interface UserPageResult {
  list: AdminUserItem[]
  total: number
  page: number
  size: number
}

/** 新建用户入参 */
export interface CreateUserPayload {
  username: string
  password: string
  role?: string
  nickname?: string
  email?: string
  realmId?: string
}

/** 更新用户入参（仅传需要改的字段） */
export interface UpdateUserPayload {
  role?: string
  status?: number
  nickname?: string
  email?: string
}

/**
 * 用户管理数据源接口。
 *
 * 面板只依赖这 5 个方法；任何应用只要实现它，就能复用同一份管理界面
 * （这正是「cosmic 以后用映射关系接入」的落点：写一个 adapter 即可）。
 */
export interface UserAdminClient {
  list(query?: UserPageQuery): Promise<UserPageResult>
  create(payload: CreateUserPayload): Promise<AdminUserItem>
  update(id: number | string, payload: UpdateUserPayload): Promise<AdminUserItem>
  remove(id: number | string): Promise<void>
  resetPassword(id: number | string, newPassword: string): Promise<void>
}

/** 用户管理接口错误（面板据此给出可读提示） */
export class UserAdminError extends Error {
  /** HTTP 状态码（0 表示未拿到响应，如网络异常） */
  readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'UserAdminError'
    this.status = status
  }
}

export interface CreateUserAdminClientOptions {
  /**
   * 「用户管理资源」的基址，**到集合为止**，不含 `/users` 之外的层级。
   * @example 'https://auth.marschat.online/admin/users' / '/portal/api/admin/users'
   */
  baseUrl: string
  /**
   * 取当前 access_token 的函数。缺省读组件库 token 存储。
   * 该 token 会被放进 `Authorization: Bearer <token>`。
   */
  getToken?: () => string | null
  /**
   * 401（登录已过期）时的回调，由应用注入「静默重授权」：
   * 直连应用传 `() => renewByReauthorize()`（renew 默认回当前页），
   * BFF 应用传跳自家 authorize 端点。回调触发后面板提示「正在重新登录」，
   * 跳转回来后 `onMounted(load)` 自然重载列表。未注入时维持旧行为（仅 toast）。
   */
  onUnauthorized?: () => void
  /** 自定义 fetch（便于测试注入或复用应用已配置的实例） */
  fetchImpl?: typeof fetch
  /** 单请求超时（毫秒），默认 15000 */
  timeoutMs?: number
}

/**
 * 创建用户管理数据源。
 *
 * @example 直连 auth-center（4 个应用用这种）
 * ```ts
 * const client = createUserAdminClient({
 *   baseUrl: 'https://auth.marschat.online/admin/users',
 * })
 * ```
 *
 * @example portal 走自家 BFF 代理
 * ```ts
 * const client = createUserAdminClient({ baseUrl: '/portal/api/admin/users' })
 * ```
 */
export function createUserAdminClient(options: CreateUserAdminClientOptions): UserAdminClient {
  const base = (options.baseUrl || '').replace(/\/+$/, '')
  if (!base) {
    throw new UserAdminError('[marschat-auth] createUserAdminClient 缺少 baseUrl')
  }
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000

  async function request<T>(
    path: string,
    init: { method: string; body?: unknown; query?: Record<string, unknown> }
  ): Promise<T> {
    const url = new URL(`${base}${path}`, window.location.origin)
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
      throw new UserAdminError(
        e instanceof Error && e.name === 'AbortError' ? '请求超时，请稍后重试' : '网络异常，请检查连接',
        0
      )
    } finally {
      clearTimeout(timer)
    }

    if (res.status === 401 || res.status === 403) {
      if (res.status === 401 && options.onUnauthorized) {
        // 401 = 本地 token 失效但 IdP 会话可能仍在：交给应用做静默重授权，
        // 跳转回来后页面重新挂载自然重载。先标记再抛，让面板把提示从 error 降为 warning。
        try {
          options.onUnauthorized()
        } catch {
          /* 注入的回调异常不掩盖原始 401 */
        }
      }
      throw new UserAdminError(
        res.status === 401 ? '登录已过期，请重新登录' : '当前账号无权限管理用户',
        res.status
      )
    }

    // 无响应体（204 等）
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
      throw new UserAdminError(payload?.message || `请求失败(HTTP ${res.status})`, res.status)
    }

    // 解包统一返回格式 {code, message, data}
    if (payload && typeof payload === 'object' && 'code' in payload) {
      if (payload.code !== 200) {
        throw new UserAdminError(payload.message || `操作失败(code ${payload.code})`, res.status)
      }
      return payload.data as T
    }
    return payload as T
  }

  return {
    list(query: UserPageQuery = {}): Promise<UserPageResult> {
      return request<UserPageResult>('', {
        method: 'GET',
        query: {
          realmId: query.realmId,
          keyword: query.keyword,
          page: query.page ?? 1,
          size: query.size ?? 20,
        },
      }).then((r) => ({
        list: r?.list ?? [],
        total: r?.total ?? 0,
        page: r?.page ?? query.page ?? 1,
        size: r?.size ?? query.size ?? 20,
      }))
    },

    create(payload: CreateUserPayload): Promise<AdminUserItem> {
      return request<AdminUserItem>('', { method: 'POST', body: payload })
    },

    update(id: number | string, payload: UpdateUserPayload): Promise<AdminUserItem> {
      return request<AdminUserItem>(`/${id}`, { method: 'PUT', body: payload })
    },

    remove(id: number | string): Promise<void> {
      return request<void>(`/${id}`, { method: 'DELETE' })
    },

    resetPassword(id: number | string, newPassword: string): Promise<void> {
      return request<void>(`/${id}/password`, { method: 'PUT', body: { newPassword } })
    },
  }
}

/** 用户管理面板配置（`UserManagementPanel.vue` 的 props.config） */
export interface UserManagementConfig {
  /** 数据源（必填） */
  client: UserAdminClient
  /** 标题，默认「用户管理」 */
  title?: string
  /** 副标题 / 说明文案 */
  subtitle?: string
  /**
   * 角色选项（值 → 展示名）。默认 `[{admin,管理员},{user,普通用户}]`。
   * 各应用可按自身语义覆盖（例如 cosmic 的 viewer/editor/admin）。
   */
  roles?: Array<{ value: string; label: string }>
  /**
   * 当前登录用户的 id —— 用于**自我保护**：不允许删除或禁用自己。
   * 传入后，对应行的删除按钮会置灰并提示。
   */
  currentUserId?: number | string | null
  /**
   * 当前登录用户名 —— `currentUserId` 的补充判据。
   *
   * 适用场景：BFF 机密客户端（如 portal）的 token 里没有 `uid`，只有用户名，
   * 此时用用户名匹配同样能实现"不能删自己"的保护。两者任一命中即视为本人。
   */
  currentUsername?: string | null
  /** 只读模式：只展示列表，不出现任何写操作按钮 */
  readonly?: boolean
  /** 是否允许删除用户，默认 `true` */
  allowDelete?: boolean
  /** 是否允许重置密码，默认 `true` */
  allowResetPassword?: boolean
  /** 创建 / 编辑时是否可改角色，默认 `true` */
  allowEditRole?: boolean
  /** 每页条数，默认 10 */
  pageSize?: number
  /** realm 过滤（多账号池场景） */
  realmId?: string
  /** 新建用户时的默认角色，默认取 `roles[0]` 之外的最后一个（通常是最低权限） */
  defaultRole?: string
}
