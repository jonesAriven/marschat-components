/**
 * 跨应用授权矩阵数据源适配器（Authorization Matrix Client）
 *
 * `CrossAppAuthPanel.vue` 只负责「长什么样」，本文件负责「数据从哪来」，
 * 写法与 `utils/accountMapping.ts` 的 `createAccountMappingClient` 对齐：
 * issuer 注入 → Bearer 鉴权 → 统一 Result 信封解包 → `AuthorizationMatrixError` 报错。
 *
 * ## 为什么需要它
 * 此前「哪些账号有哪些系统的权限」只能**逐个应用进、逐个用户点**，没有横向总览。
 * 本数据源把「用户 × 应用 × 角色」压成一张矩阵：行=用户，列=应用，单元格=角色集合。
 *
 * 后端契约（auth-center `AdminAuthzMatrixController`，2026-09-14 核实）：
 * ```
 * GET  {admin}/authorization-matrix?keyword=&page=&size=
 *      → Result<{total,page,size,clients:[{clientId,name}],records:[{userId,username,nickname,
 *               email,globalRole,status,apps:{<clientId>:[{id,code,name}]}}]}>
 * GET  {admin}/roles                                        → Result<[Role]>（平台 + 各 client 级）
 * GET  {admin}/users/{userId}/client-roles?client=<id>      → Result<[roleId]>
 * PUT  {admin}/users/{userId}/client-roles?client=<id>  body {"roleIds":[...]} → Result
 * ```
 * 统一返回包装：`{ code:200, message:'success', data:<T>, traceId }`。
 *
 * ⚠️ `/admin/roles` 由 `JdbcTemplate.queryForList` 直出，字段是 **snake_case**（client_id），
 *    与 `/admin/permissions`、`/admin/mappings` 同源 —— 读取时做双键兼容（见 `roleClientId()`）。
 */

/** 矩阵列（一个应用） */
export interface MatrixClientRef {
  clientId: string
  name: string
}

/** 单元格里的一个角色 */
export interface MatrixRole {
  id: number
  code: string
  name: string
}

/** 矩阵行（一个用户） */
export interface MatrixUserRow {
  userId: number
  username: string
  nickname?: string | null
  email?: string | null
  /** 全局角色（platform scope：superadmin / admin / user） */
  globalRole?: string | null
  status?: number | null
  /** clientId → 该用户在该应用的角色集合（未出现的 client 视为未授权） */
  apps: Record<string, MatrixRole[]>
}

/** 矩阵查询结果 */
export interface AuthorizationMatrixResult {
  total: number
  page: number
  size: number
  clients: MatrixClientRef[]
  records: MatrixUserRow[]
}

/** 查询参数 */
export interface MatrixQuery {
  /** 关键字（username / email / nickname 模糊） */
  keyword?: string
  page?: number
  size?: number
}

/** `/admin/roles` 返回的角色（兼容 snake_case / camelCase 两种键） */
export interface MatrixRoleDef {
  id: number
  code: string
  name: string
  scope?: string
  clientId?: string
  client_id?: string
}

/** 跨应用授权矩阵数据源接口 */
export interface AuthorizationMatrixClient {
  matrix(query?: MatrixQuery): Promise<AuthorizationMatrixResult>
  /** 全部角色（平台 + 各 client 级），调用方按 scope/clientId 过滤 */
  listRoles(): Promise<MatrixRoleDef[]>
  /** 某用户在某应用的角色 id 集合 */
  userClientRoles(userId: number | string, clientId: string): Promise<number[]>
  /** 全量覆盖某用户在某应用的角色绑定 */
  assignUserClientRoles(userId: number | string, clientId: string, roleIds: number[]): Promise<void>
}

/** 跨应用授权矩阵接口错误（面板据此给出可读提示） */
export class AuthorizationMatrixError extends Error {
  /** HTTP 状态码（0 表示未拿到响应，如网络异常） */
  readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'AuthorizationMatrixError'
    this.status = status
  }
}

export interface CreateAuthorizationMatrixClientOptions {
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
 * 创建跨应用授权矩阵数据源。
 *
 * @example
 * ```ts
 * const client = createAuthorizationMatrixClient({
 *   issuer: 'https://auth.marschat.online',
 *   getToken: () => getToken(),
 * })
 * const { clients, records, total } = await client.matrix({ page: 1, size: 20 })
 * ```
 */
export function createAuthorizationMatrixClient(
  options: CreateAuthorizationMatrixClientOptions
): AuthorizationMatrixClient {
  const issuer = (options.issuer || '').replace(/\/+$/, '')
  if (!issuer) {
    throw new AuthorizationMatrixError(
      '[marschat-auth] createAuthorizationMatrixClient 缺少 issuer'
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
      throw new AuthorizationMatrixError(
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
      throw new AuthorizationMatrixError(
        res.status === 401 ? '登录已过期，请重新登录' : '当前账号无权限执行统一授权',
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
      throw new AuthorizationMatrixError(
        payload?.message || `请求失败(HTTP ${res.status})`,
        res.status
      )
    }

    // 解包统一返回格式 {code, message, data}
    if (payload && typeof payload === 'object' && 'code' in payload) {
      if (payload.code !== 200 && payload.code !== 0) {
        throw new AuthorizationMatrixError(
          payload.message || `操作失败(code ${payload.code})`,
          res.status
        )
      }
      return payload.data as T
    }
    return payload as T
  }

  return {
    matrix(query: MatrixQuery = {}): Promise<AuthorizationMatrixResult> {
      return request<AuthorizationMatrixResult>('/authorization-matrix', {
        method: 'GET',
        query: {
          keyword: query.keyword,
          page: query.page ?? 1,
          size: query.size ?? 20,
        },
      }).then((r) => ({
        total: r?.total ?? 0,
        page: r?.page ?? query.page ?? 1,
        size: r?.size ?? query.size ?? 20,
        clients: r?.clients ?? [],
        records: (r?.records ?? []).map((row) => ({ ...row, apps: row?.apps ?? {} })),
      }))
    },

    listRoles(): Promise<MatrixRoleDef[]> {
      return request<MatrixRoleDef[]>('/roles', { method: 'GET' }).then((r) => r ?? [])
    },

    userClientRoles(userId: number | string, clientId: string): Promise<number[]> {
      return request<number[]>(`/users/${encodeURIComponent(String(userId))}/client-roles`, {
        method: 'GET',
        query: { client: clientId },
      }).then((r) => r ?? [])
    },

    assignUserClientRoles(
      userId: number | string,
      clientId: string,
      roleIds: number[]
    ): Promise<void> {
      return request<void>(`/users/${encodeURIComponent(String(userId))}/client-roles`, {
        method: 'PUT',
        query: { client: clientId },
        body: { roleIds },
      })
    },
  }
}

/** 读取角色的 client 归属（`/admin/roles` 直出 snake_case，做双键兼容） */
export function roleClientId(role: MatrixRoleDef): string | undefined {
  return role.clientId ?? role.client_id
}

/** 跨应用授权矩阵面板配置（`CrossAppAuthPanel.vue` 的 props.config） */
export interface AuthorizationMatrixConfig {
  /** 数据源（必填） */
  client: AuthorizationMatrixClient
  /** 标题，默认「跨应用授权」 */
  title?: string
  /** 副标题 / 说明文案 */
  subtitle?: string
  /** client_id → 友好展示名（表头），如 `{ 'marschat-kbops': '运维后台' }` */
  clientLabels?: Record<string, string>
  /** 每页条数，默认 20 */
  pageSize?: number
  /** 只读模式：矩阵只展示，单元格不可点开编辑 */
  readonly?: boolean
  /** 是否可点击单元格编辑，默认 `true` */
  allowEdit?: boolean
}
