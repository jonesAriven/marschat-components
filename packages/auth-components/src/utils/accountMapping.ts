/**
 * 账号映射数据源适配器（Account Mapping Client）
 *
 * 统一身份 ↔ 各系统本地账号的映射关系由 auth-center 维护，
 * `AccountMappingPanel.vue` 只负责「长什么样」，本文件负责「数据从哪来」，
 * 写法与 `utils/userAdmin.ts` 的 `createUserAdminClient` 对齐：
 * issuer 注入 → Bearer 鉴权 → 统一 Result 信封解包 → `AccountMappingError` 报错。
 *
 * 后端契约（auth-center `AdminAccountMappingController`，2026-09-14 核实）：
 * ```
 * GET  {admin}/mappings?client=&userId=&keyword=&page=&size=  → Result<{total,page,size,records:[...]}>
 * GET  {admin}/mappings/summary                               → Result<[{client_id,total,linked,pending}]>
 * GET  {admin}/users/{userId}/mappings                        → Result<[{id,client_id,local_account,local_display_name,source,status,linked_at,last_seen_at}]>
 * POST {admin}/mappings/{mappingId}/bind    body {"userId":148} → Result<{bound:1}>
 * POST {admin}/mappings/{mappingId}/unbind                   → Result<{unbound:1}>
 * GET  {admin}/users?keyword=&page=&size=                     → Result<PageResult<User>>（绑定弹窗搜索中心用户）
 * ```
 * 统一返回包装：`{ code:200, message:'success', data:<T>, traceId }`。
 *
 * ⚠️ 列表/概览由 `JdbcTemplate.queryForList` 直出，字段是 **snake_case**（client_id / user_id /
 *    local_account …），与 `/admin/roles`、`/admin/permissions` 同源，不要按 camelCase 取值。
 */

/** 单条账号映射记录（`GET /admin/mappings` 的 records[]） */
export interface AccountMappingItem {
  id: number
  /** 应用 client_id（如 marschat-portal / cosmic-studio） */
  client_id: string
  /** 应用侧本地账号标识 */
  local_account: string
  /** 应用侧显示名（可选） */
  local_display_name?: string | null
  /** 中心统一用户 id；null = 未认领（待绑定） */
  user_id?: number | null
  /** 中心用户名（LEFT JOIN user.username，未认领为 null） */
  platform_username?: string | null
  /** 中心用户昵称 */
  platform_nickname?: string | null
  /** 中心用户邮箱 */
  platform_email?: string | null
  /** 中心用户角色 */
  platform_role?: string | null
  /** 映射来源：report=应用上报 / auto=自动认领 / manual=手工绑定 */
  source?: string | null
  /** 1=有效 0=已失效（应用已删除该账号） */
  status?: number | null
  /** 认领时间 */
  linked_at?: string | null
  /** 最近一次应用上报时间 */
  last_seen_at?: string | null
}

/** 「某个中心用户在各系统的账号」条目（`GET /admin/users/{userId}/mappings`） */
export interface AccountMappingUserItem {
  id: number
  client_id: string
  local_account: string
  local_display_name?: string | null
  source?: string | null
  status?: number | null
  linked_at?: string | null
  last_seen_at?: string | null
}

/** 覆盖概览条目（`GET /admin/mappings/summary`） */
export interface AccountMappingSummaryItem {
  client_id: string
  /** 该应用登记的账号总数 */
  total: number
  /** 已认领（已绑定中心用户）数 */
  linked: number
  /** 待绑定（未认领）数 */
  pending: number
}

/** 列表查询参数 */
export interface MappingPageQuery {
  /** 按应用过滤 */
  client?: string
  /** 按中心用户过滤 */
  userId?: number | string
  /** 关键字（local_account / local_display_name / platform username 模糊） */
  keyword?: string
  page?: number
  size?: number
}

/** 分页结果（后端自定义 Map，非 common-core PageResult） */
export interface MappingPageResult {
  total: number
  page: number
  size: number
  records: AccountMappingItem[]
}

/**
 * 账号映射数据源接口。
 *
 * 面板只依赖这 5 个方法；任何应用只要实现它，就能复用同一份管理界面。
 */
export interface AccountMappingClient {
  listMappings(query?: MappingPageQuery): Promise<MappingPageResult>
  summary(): Promise<AccountMappingSummaryItem[]>
  listByUser(userId: number | string): Promise<AccountMappingUserItem[]>
  /** 手工绑定：返回受影响行数（通常 1） */
  bind(mappingId: number | string, userId: number | string): Promise<number>
  /** 解绑：返回受影响行数（通常 1） */
  unbind(mappingId: number | string): Promise<number>
}

/** 账号映射接口错误（面板据此给出可读提示） */
export class AccountMappingError extends Error {
  /** HTTP 状态码（0 表示未拿到响应，如网络异常） */
  readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'AccountMappingError'
    this.status = status
  }
}

export interface CreateAccountMappingClientOptions {
  /**
   * auth-center 根地址（OIDC issuer，如 `https://auth.marschat.online`）。
   * 客户端内部拼 `${issuer}/admin/...`，因此**不要**带 `/admin` 后缀。
   */
  issuer: string
  /**
   * 取当前 access_token 的函数。缺省取组件库 token 存储（`utils/token` 的 `getToken`）。
   * 该 token 会被放进 `Authorization: Bearer <token>`。
   */
  getToken?: () => string | null
  /**
   * 401（登录已过期）时的回调，由应用注入「静默重授权」。
   * 未注入时仅由面板 toast 提示。
   */
  onUnauthorized?: () => void
  /** 自定义 fetch（便于测试注入或复用应用已配置的实例） */
  fetchImpl?: typeof fetch
  /** 单请求超时（毫秒），默认 15000 */
  timeoutMs?: number
}

/** 中心用户选项（绑定弹窗搜索用） */
export interface CenterUserOption {
  id: number | string
  username: string
  nickname?: string | null
  email?: string | null
}

/**
 * 创建账号映射数据源。
 *
 * @example 直连 auth-center
 * ```ts
 * const client = createAccountMappingClient({
 *   issuer: 'https://auth.marschat.online',
 *   getToken: () => getToken(),
 * })
 * const { records, total } = await client.listMappings({ client: 'marschat-portal', page: 1, size: 20 })
 * ```
 */
export function createAccountMappingClient(
  options: CreateAccountMappingClientOptions
): AccountMappingClient {
  const issuer = (options.issuer || '').replace(/\/+$/, '')
  if (!issuer) {
    throw new AccountMappingError('[marschat-auth] createAccountMappingClient 缺少 issuer')
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
      throw new AccountMappingError(
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
      throw new AccountMappingError(
        res.status === 401 ? '登录已过期，请重新登录' : '当前账号无权限管理账号映射',
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
      throw new AccountMappingError(payload?.message || `请求失败(HTTP ${res.status})`, res.status)
    }

    // 解包统一返回格式 {code, message, data}
    if (payload && typeof payload === 'object' && 'code' in payload) {
      if (payload.code !== 200 && payload.code !== 0) {
        throw new AccountMappingError(payload.message || `操作失败(code ${payload.code})`, res.status)
      }
      return payload.data as T
    }
    return payload as T
  }

  return {
    listMappings(query: MappingPageQuery = {}): Promise<MappingPageResult> {
      return request<MappingPageResult>('/mappings', {
        method: 'GET',
        query: {
          client: query.client,
          userId: query.userId,
          keyword: query.keyword,
          page: query.page ?? 1,
          size: query.size ?? 20,
        },
      }).then((r) => ({
        total: r?.total ?? 0,
        page: r?.page ?? query.page ?? 1,
        size: r?.size ?? query.size ?? 20,
        records: r?.records ?? [],
      }))
    },

    summary(): Promise<AccountMappingSummaryItem[]> {
      return request<AccountMappingSummaryItem[]>('/mappings/summary', { method: 'GET' }).then(
        (r) => r ?? []
      )
    },

    listByUser(userId: number | string): Promise<AccountMappingUserItem[]> {
      return request<AccountMappingUserItem[]>(`/users/${encodeURIComponent(String(userId))}/mappings`, {
        method: 'GET',
      }).then((r) => r ?? [])
    },

    bind(mappingId: number | string, userId: number | string): Promise<number> {
      return request<{ bound?: number }>(`/mappings/${encodeURIComponent(String(mappingId))}/bind`, {
        method: 'POST',
        body: { userId },
      }).then((r) => r?.bound ?? 0)
    },

    unbind(mappingId: number | string): Promise<number> {
      return request<{ unbound?: number }>(`/mappings/${encodeURIComponent(String(mappingId))}/unbind`, {
        method: 'POST',
      }).then((r) => r?.unbound ?? 0)
    },
  }
}

/**
 * 便捷：生成「按关键字搜索中心用户」的函数，供 `AccountMappingPanel` 的绑定弹窗使用。
 *
 * 复用同一 issuer + token，命中 auth-center 既有 `GET /admin/users`（Result<PageResult<User>>）。
 *
 * @example
 * ```ts
 * const client = createAccountMappingClient({ issuer, getToken })
 * const searchUsers = createAccountMappingUserSearch({ issuer, getToken })
 * ```
 */
export function createAccountMappingUserSearch(
  options: CreateAccountMappingClientOptions
): (keyword: string) => Promise<CenterUserOption[]> {
  const issuer = (options.issuer || '').replace(/\/+$/, '')
  if (!issuer) {
    throw new AccountMappingError('[marschat-auth] createAccountMappingUserSearch 缺少 issuer')
  }
  const admin = `${issuer}/admin`
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000

  return async function searchCenterUsers(keyword: string): Promise<CenterUserOption[]> {
    const url = new URL(`${admin}/users`, window.location.origin)
    url.searchParams.set('keyword', keyword ?? '')
    url.searchParams.set('page', '1')
    url.searchParams.set('size', '20')

    const headers: Record<string, string> = { Accept: 'application/json' }
    const token = options.getToken ? options.getToken() : null
    if (token) headers['Authorization'] = `Bearer ${token}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await doFetch(url.toString(), { method: 'GET', headers, signal: controller.signal })
    } catch (e) {
      clearTimeout(timer)
      throw new AccountMappingError(
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
          /* ignore */
        }
      }
      throw new AccountMappingError(
        res.status === 401 ? '登录已过期，请重新登录' : '当前账号无权限搜索用户',
        res.status
      )
    }

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
      throw new AccountMappingError(payload?.message || `请求失败(HTTP ${res.status})`, res.status)
    }

    let data: any = payload
    if (payload && typeof payload === 'object' && 'code' in payload) {
      if (payload.code !== 200 && payload.code !== 0) {
        throw new AccountMappingError(payload.message || `操作失败(code ${payload.code})`, res.status)
      }
      data = payload.data
    }
    // PageResult<User>：{ list, total, page, size }
    const list = data?.list ?? data?.records ?? (Array.isArray(data) ? data : [])
    return (list as any[]).map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname ?? null,
      email: u.email ?? null,
    }))
  }
}

/** 账号映射面板配置（`AccountMappingPanel.vue` 的 props.config） */
export interface AccountMappingConfig {
  /** 数据源（必填） */
  client: AccountMappingClient
  /** 标题，默认「账号映射」 */
  title?: string
  /** 副标题 / 说明文案 */
  subtitle?: string
  /**
   * 绑定弹窗的「按用户名搜索」能力（可选）。
   * 提供后弹窗可切换为搜索选择；未提供时仅支持直接输入中心用户 ID。
   * 可直接用 `createAccountMappingUserSearch({ issuer, getToken })` 注入。
   */
  searchUsers?: (keyword: string) => Promise<CenterUserOption[]>
  /**
   * 应用 client_id → 友好展示名映射，如 `{ 'marschat-portal': '门户系统' }`。
   * 未配置时直接展示 client_id。
   */
  clientLabels?: Record<string, string>
  /** 初始选中的应用（'' = 全部），默认全部 */
  defaultClient?: string
  /** 每页条数，默认 10 */
  pageSize?: number
  /** 只读模式：只展示列表与概览，不出现任何写操作按钮 */
  readonly?: boolean
  /** 是否允许绑定，默认 `true` */
  allowBind?: boolean
  /** 是否允许解绑，默认 `true` */
  allowUnbind?: boolean
}
