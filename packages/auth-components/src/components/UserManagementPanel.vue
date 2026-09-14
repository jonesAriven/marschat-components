<template>
  <div class="marschat-user-mgmt">
    <el-card shadow="never" class="mgmt-card">
      <template #header>
        <div class="mgmt-header">
          <div class="mgmt-heading">
            <h3 class="mgmt-title">{{ cfg.title }}</h3>
            <p v-if="cfg.subtitle" class="mgmt-subtitle">{{ cfg.subtitle }}</p>
          </div>
          <div class="mgmt-toolbar">
            <el-input
              v-model="keyword"
              class="mgmt-search"
              placeholder="搜索用户名 / 邮箱 / 昵称"
              clearable
              @keyup.enter="handleSearch"
              @clear="handleSearch"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-button :loading="loading" @click="handleSearch">查询</el-button>
            <el-button v-if="!cfg.readonly" type="primary" @click="openCreate">新建用户</el-button>
            <!-- 应用作用域：把「已存在但尚未加入本系统」的用户加进来（否则列表被 client 过滤后无从下嘴） -->
            <el-button v-if="!cfg.readonly && isAppScope" @click="openAddExisting">
              添加已有用户
            </el-button>
          </div>
        </div>
      </template>

      <el-table v-loading="loading" :data="rows" row-key="id" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="username" label="用户名" min-width="150">
          <template #default="{ row }">
            <span>{{ row.username }}</span>
            <el-tag v-if="isSelf(row)" class="self-tag" size="small" type="info" effect="plain">
              当前登录
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="nickname" label="昵称" min-width="120" />
        <el-table-column prop="email" label="邮箱" min-width="190" />
        <el-table-column :label="isAppScope ? '全局角色' : '角色'" width="110">
          <template #default="{ row }">
            <el-tag :type="roleTagType(row.role)" size="small">{{ roleLabel(row.role) }}</el-tag>
          </template>
        </el-table-column>
        <!-- 应用作用域：展示该用户在本应用的角色（服务端随列表整页回填，无 N+1） -->
        <el-table-column v-if="isAppScope" label="本系统角色" min-width="150">
          <template #default="{ row }">
            <template v-if="row.appRoles && row.appRoles.length">
              <el-tag
                v-for="r in row.appRoles"
                :key="r.id"
                class="app-role-tag"
                size="small"
                type="success"
                effect="light"
              >
                {{ r.name || r.code }}
              </el-tag>
            </template>
            <span v-else class="muted-text">未分配</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 0 ? 'danger' : 'success'" size="small" effect="plain">
              {{ row.status === 0 ? '禁用' : '启用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column v-if="!cfg.readonly" label="操作" :width="opColumnWidth" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button
              v-if="cfg.allowResetPassword !== false"
              link
              type="warning"
              size="small"
              @click="openReset(row)"
            >
              重置密码
            </el-button>
            <el-button
              v-if="cfg.appRoles"
              link
              type="success"
              size="small"
              @click="openAppRoles(row)"
            >
              {{ isAppScope ? '本系统角色' : '应用角色' }}
            </el-button>
            <!--
              应用作用域下**不提供删除**：删除的是「统一身份」，属中心职责。
              应用侧对应的动作是「移出本系统」= 解绑该用户在本应用的全部角色（身份保留）。
            -->
            <el-button
              v-if="isAppScope"
              link
              type="danger"
              size="small"
              :disabled="isSelf(row)"
              :title="isSelf(row) ? '不能把自己移出当前系统' : ''"
              @click="handleRemoveFromApp(row)"
            >
              移出本系统
            </el-button>
            <el-button
              v-else-if="cfg.allowDelete !== false"
              link
              type="danger"
              size="small"
              :disabled="isSelf(row)"
              :title="isSelf(row) ? '不能删除当前登录账号' : ''"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="mgmt-footer">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @current-change="load"
          @size-change="reload"
        />
      </div>
    </el-card>

    <!-- 新建 / 编辑 -->
    <el-dialog
      v-model="formVisible"
      :title="editing ? '编辑用户' : '新建用户'"
      width="460px"
      :close-on-click-modal="false"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :disabled="editing" placeholder="登录用户名" />
        </el-form-item>
        <el-form-item v-if="!editing" label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="昵称" prop="nickname">
          <el-input v-model="form.nickname" placeholder="显示名（可选）" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="用于找回密码（可选）" />
        </el-form-item>
        <!-- 应用作用域下不允许改「全局角色」：那是统一认证中心的职责 -->
        <el-form-item v-if="cfg.allowEditRole !== false && !isAppScope" label="角色" prop="role">
          <el-select v-model="form.role" style="width: 100%">
            <el-option v-for="r in roleOptions" :key="r.value" :label="r.label" :value="r.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="editing" label="状态" prop="status">
          <el-switch v-model="form.status" :active-value="1" :inactive-value="0" active-text="启用" inactive-text="禁用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码 -->
    <el-dialog v-model="resetVisible" title="重置密码" width="420px" :close-on-click-modal="false">
      <p class="reset-hint">
        为 <b>{{ resetTarget?.username }}</b> 设置新密码（无需原密码，请线下告知本人）。
      </p>
      <el-form ref="resetFormRef" :model="resetForm" :rules="resetRules" label-width="80px">
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="resetForm.newPassword" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitReset">确定</el-button>
      </template>
    </el-dialog>

    <!-- 应用角色绑定（Phase 4 · 用户×系统） -->
    <el-dialog
      v-model="appRolesVisible"
      :title="`应用角色 — ${appRolesTarget?.username || ''}`"
      width="460px"
      :close-on-click-modal="false"
    >
      <p class="reset-hint">
        勾选 <b>{{ cfg.appRoles?.clientId }}</b> 应用内分配给该用户的角色（角色可见菜单由
        「菜单授权」页按角色配置；保存后最迟 60 秒生效）。
      </p>
      <div v-loading="appRolesLoading" class="app-roles-list">
        <el-checkbox
          v-for="r in appRoleOptions"
          :key="r.id"
          v-model="r.checked"
          class="app-role-item"
        >
          {{ r.name || r.code }}
          <span class="app-role-code">{{ r.code }}</span>
        </el-checkbox>
        <div v-if="!appRoleOptions.length && !appRolesLoading" class="app-role-empty">
          该应用暂无 client 级角色（可在授权面板或 API 创建）
        </div>
      </div>
      <template #footer>
        <el-button @click="appRolesVisible = false">取消</el-button>
        <el-button type="primary" :loading="appRolesSaving" @click="saveAppRoles">保存</el-button>
      </template>
    </el-dialog>

    <!-- 添加已有用户（仅应用作用域）：从全平台统一身份池挑选，加入本系统 -->
    <el-dialog
      v-model="addVisible"
      :title="`添加已有用户到「${appDisplayName}」`"
      width="760px"
      :close-on-click-modal="false"
    >
      <p class="reset-hint">
        从<b>全平台统一身份</b>中挑选用户加入本系统（不新建账号）。已在本系统的用户会标记「已加入」且不可重复勾选。
        加入后默认获得角色「<b>{{ defaultAppRoleName || '（本应用暂无 client 级角色）' }}</b>」，可在列表里继续调整。
      </p>
      <div class="add-toolbar">
        <el-input
          v-model="addKeyword"
          placeholder="搜索用户名 / 邮箱 / 昵称"
          clearable
          class="add-search"
          @keyup.enter="loadAddCandidates"
          @clear="loadAddCandidates"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button :loading="addLoading" @click="loadAddCandidates">查询</el-button>
      </div>
      <el-table
        v-loading="addLoading"
        :data="addRows"
        height="320"
        row-key="id"
        @selection-change="onAddSelectionChange"
      >
        <el-table-column type="selection" width="46" :selectable="isAddSelectable" />
        <el-table-column prop="username" label="用户名" min-width="140" />
        <el-table-column prop="nickname" label="昵称" min-width="110" />
        <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
        <el-table-column label="全局角色" width="100">
          <template #default="{ row }">
            <el-tag :type="roleTagType(row.role)" size="small">{{ roleLabel(row.role) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="成员状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="addJoinedIds.has(row.id)" type="info" size="small" effect="plain">
              已加入
            </el-tag>
            <span v-else class="muted-text">未加入</span>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="addSaving"
          :disabled="!addSelectedIds.length"
          @click="submitAddExisting"
        >
          加入本系统（已选 {{ addSelectedIds.length }}）
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import type {
  AdminUserItem,
  UserManagementConfig,
  UserPageResult,
} from '../utils/userAdmin'
import { UserAdminError } from '../utils/userAdmin'

const props = defineProps<{
  config: UserManagementConfig
}>()

const emit = defineEmits<{
  /** 数据被修改（新增/编辑/删除/重置密码/移出本系统成功）后触发，便于宿主刷新自身状态 */
  (
    e: 'changed',
    action: 'create' | 'update' | 'delete' | 'resetPassword' | 'removeFromApp'
  ): void
}>()

const cfg = computed(() => props.config)

// ---------------- 作用域（Phase 8 双作用域用户体系） ----------------
/**
 * 作用域：缺省 `platform`（全平台统一身份），传 `{mode:'app', clientId}` 即「本系统用户」。
 * 见 `utils/userAdmin.ts` 的 `UserAdminScope` 文档表。
 */
const authScope = computed(() => props.config.scope ?? { mode: 'platform' as const })
const isAppScope = computed(() => authScope.value.mode === 'app')
/** 本应用 client_id（仅 app 模式非空） */
const appClientId = computed(() =>
  isAppScope.value ? (authScope.value as { mode: 'app'; clientId: string }).clientId : ''
)
/** 本应用展示名（仅 app 模式，用于文案） */
const appDisplayName = computed(() =>
  isAppScope.value
    ? (authScope.value as { mode: 'app'; clientId: string; appName?: string }).appName || appClientId.value
    : ''
)
/** 操作列宽度随可用按钮数变化（app 模式：编辑/重置密码/本系统角色/移出本系统） */
const opColumnWidth = computed(() => (isAppScope.value ? 280 : props.config.appRoles ? 300 : 240))

/** 默认角色选项：最低权限放最后，新建时默认选它 */
const roleOptions = computed(
  () =>
    props.config.roles ?? [
      { value: 'admin', label: '管理员' },
      { value: 'user', label: '普通用户' },
    ]
)

// ---------------- 列表 ----------------
const rows = ref<AdminUserItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(props.config.pageSize ?? 10)
const keyword = ref('')
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res: UserPageResult = await props.config.client.list({
      page: page.value,
      size: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      realmId: props.config.realmId,
      // 应用作用域：服务端按 client 过滤（只返回与本系统有关的用户），并回填 appRoles
      client: isAppScope.value ? appClientId.value : undefined,
    })
    rows.value = res.list
    total.value = res.total
  } catch (e) {
    if (e instanceof UserAdminError && e.status === 401) {
      // client 注入了 onUnauthorized 时正在跳静默重授权；未注入时也按「会话过期」提示而非报错
      ElMessage.warning('登录状态已过期，正在重新登录…')
    } else {
      ElMessage.error(errMsg(e))
    }
  } finally {
    loading.value = false
  }
}

function reload(): void {
  page.value = 1
  void load()
}

function handleSearch(): void {
  reload()
}

onMounted(load)

// ---------------- 应用角色绑定（Phase 4 · cfg.appRoles 配置后启用） ----------------
interface AppRoleOption {
  id: number
  code: string
  name: string
  checked: boolean
}
const appRolesVisible = ref(false)
const appRolesLoading = ref(false)
const appRolesSaving = ref(false)
const appRolesTarget = ref<AdminUserItem | null>(null)
const appRoleOptions = ref<AppRoleOption[]>([])

function appRolesApi<T>(path: string, init?: RequestInit): Promise<T> {
  const ar = props.config.appRoles!
  const token = ar.getToken() || ''
  return fetch(`${ar.baseUrl.replace(/\/+$/, '')}/admin${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers as Record<string, string>) },
  }).then(async (resp) => {
    if (resp.status === 401) {
      ar.onUnauthorized?.()
      throw new UserAdminError('登录状态已过期', 401)
    }
    const body = await resp.json()
    if (body.code !== 200 && body.code !== 0) {
      throw new UserAdminError(body.message || `HTTP ${resp.status}`, resp.status)
    }
    return body.data as T
  })
}

async function openAppRoles(row: AdminUserItem): Promise<void> {
  appRolesTarget.value = row
  appRolesVisible.value = true
  appRolesLoading.value = true
  appRoleOptions.value = []
  const clientId = props.config.appRoles!.clientId
  try {
    const [allRoles, boundIds] = await Promise.all([
      appRolesApi<Array<Record<string, any>>>('/roles'),
      appRolesApi<number[]>(`/users/${row.id}/client-roles?client=${encodeURIComponent(clientId)}`),
    ])
    // ⚠️ /roles 由 queryForList 直出 snake_case（client_id）——双键兼容（同 0.6.5 parent_id 教训）
    appRoleOptions.value = allRoles
      .filter((r) => r.scope === 'client' && (r.client_id ?? r.clientId) === clientId)
      .map((r) => ({ id: r.id, code: r.code, name: r.name, checked: boundIds.includes(r.id) }))
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    appRolesLoading.value = false
  }
}

async function saveAppRoles(): Promise<void> {
  if (!appRolesTarget.value) return
  appRolesSaving.value = true
  const clientId = props.config.appRoles!.clientId
  try {
    const roleIds = appRoleOptions.value.filter((r) => r.checked).map((r) => r.id)
    await appRolesApi(`/users/${appRolesTarget.value.id}/client-roles?client=${encodeURIComponent(clientId)}`, {
      method: 'PUT',
      body: JSON.stringify({ roleIds }),
    })
    ElMessage.success(`已保存：绑定 ${roleIds.length} 个应用角色（最迟 60 秒生效）`)
    appRolesVisible.value = false
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    appRolesSaving.value = false
  }
}

// ---------------- 展示助手 ----------------
function isSelf(row: AdminUserItem): boolean {
  const selfId = props.config.currentUserId
  if (selfId !== undefined && selfId !== null && String(selfId) !== '') {
    return String(row.id) === String(selfId)
  }
  // 回退判据：BFF 应用（如 portal）的 token 没有 uid，只有用户名
  const selfName = props.config.currentUsername
  if (selfName) return row.username === selfName
  return false
}

function roleLabel(role?: string | null): string {
  if (!role) return '—'
  return roleOptions.value.find((r) => r.value === role)?.label ?? role
}

function roleTagType(role?: string | null): 'danger' | 'warning' | 'info' {
  if (role === 'admin' || role === 'superadmin') return 'danger'
  if (role === 'editor') return 'warning'
  return 'info'
}

function formatTime(v?: string | null): string {
  if (!v) return '—'
  // 后端 LocalDateTime 序列化为 'YYYY-MM-DDTHH:mm:ss' 或带毫秒，统一成 'YYYY-MM-DD HH:mm:ss'
  return String(v).replace('T', ' ').replace(/\.\d+$/, '').slice(0, 19)
}

function errMsg(e: unknown): string {
  if (e instanceof UserAdminError) return e.message
  if (e instanceof Error) return e.message
  return '操作失败'
}

// ---------------- 新建 / 编辑 ----------------
const formVisible = ref(false)
const editing = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const editId = ref<number | string | null>(null)

const form = reactive({
  username: '',
  password: '',
  nickname: '',
  email: '',
  role: '',
  status: 1 as number,
})

const formRules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, max: 64, message: '长度 2~64 位', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
  email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }],
}

function defaultRole(): string {
  if (props.config.defaultRole) return props.config.defaultRole
  // 默认取最后一个（约定：roleOptions 从高到低排列，最后即最低权限）
  return roleOptions.value[roleOptions.value.length - 1]?.value ?? 'user'
}

function openCreate(): void {
  editing.value = false
  editId.value = null
  Object.assign(form, {
    username: '',
    password: '',
    nickname: '',
    email: '',
    role: defaultRole(),
    status: 1,
  })
  formVisible.value = true
  formRef.value?.clearValidate()
}

function openEdit(row: AdminUserItem): void {
  editing.value = true
  editId.value = row.id
  Object.assign(form, {
    username: row.username,
    password: '',
    nickname: row.nickname ?? '',
    email: row.email ?? '',
    role: row.role ?? defaultRole(),
    status: row.status ?? 1,
  })
  formVisible.value = true
  formRef.value?.clearValidate()
}

async function submitForm(): Promise<void> {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return

  submitting.value = true
  try {
    if (editing.value && editId.value !== null) {
      await props.config.client.update(editId.value, {
        role: form.role,
        status: form.status,
        nickname: form.nickname || undefined,
        email: form.email || undefined,
      })
      ElMessage.success('已更新')
      emit('changed', 'update')
    } else {
      const created = await props.config.client.create({
        username: form.username.trim(),
        password: form.password,
        role: form.role || undefined,
        nickname: form.nickname || undefined,
        email: form.email || undefined,
        realmId: props.config.realmId,
      })
      // 应用作用域：新建的统一身份默认加入本系统（授予本应用默认 client 级角色）
      if (isAppScope.value) {
        await joinAppForNewUser(created)
      }
      ElMessage.success('已创建')
      emit('changed', 'create')
    }
    formVisible.value = false
    void load()
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    submitting.value = false
  }
}

// ---------------- 删除 ----------------
/**
 * 移出本系统（仅应用作用域）。
 *
 * 语义：**解绑该用户在本应用的全部 client 级角色**（`roleIds: []`），
 * 统一身份本身保留 —— 这是应用侧能做的最强动作，删除统一身份属中心职责。
 */
async function handleRemoveFromApp(row: AdminUserItem): Promise<void> {
  if (!props.config.appRoles) {
    ElMessage.warning('未配置 appRoles，无法移出本系统')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定把「${row.username}」移出「${appDisplayName.value}」？\n` +
        '该用户将失去在本系统的全部角色（统一身份仍保留，不会影响其它系统）。',
      '移出确认',
      { type: 'warning', confirmButtonText: '移出', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消
  }
  try {
    await appRolesApi(`/users/${row.id}/client-roles?client=${encodeURIComponent(appClientId.value)}`, {
      method: 'PUT',
      body: JSON.stringify({ roleIds: [] }),
    })
    ElMessage.success('已移出本系统（最迟 60 秒生效）')
    emit('changed', 'removeFromApp')
    if (rows.value.length === 1 && page.value > 1) page.value -= 1
    void load()
  } catch (e) {
    ElMessage.error(errMsg(e))
  }
}

// ---------------- 添加已有用户（仅应用作用域） ----------------
/**
 * 解决 app 模式的「鸡生蛋」问题：列表被 `client` 过滤后，只看得到**已在本系统**的人，
 * 管理员无从把「已存在但尚未加入本系统」的用户加进来。
 * 这里从**全平台用户池**（不带 client 的 `/admin/users`）挑选，再落到本应用的 client 级角色。
 */
const addVisible = ref(false)
const addLoading = ref(false)
const addSaving = ref(false)
const addKeyword = ref('')
const addRows = ref<AdminUserItem[]>([])
const addJoinedIds = ref<Set<number>>(new Set())
const addSelectedIds = ref<number[]>([])
const defaultAppRoleId = ref<number | null>(null)
const defaultAppRoleName = ref('')

/**
 * 读取本应用的 client 级角色，选定「加入本系统即授予」的**默认角色**。
 *
 * 🔴 必须取**最低权限**的那个角色。原实现取 `mine[0]`（`/admin/roles` 按 id 升序，
 * 而「应用管理员」是最先创建的角色）→ 等于「把一个人加进系统就默认给他管理员」，
 * **权限过宽**。2026-09-14 由授权审计日志实测发现
 * （`设置用户 probeuser 在应用 marschat-portal 的角色；变更前: 无 → 变更后: admin`）。
 */
async function loadAppRoleDefs(): Promise<void> {
  const all = await appRolesApi<Array<Record<string, any>>>('/roles')
  // ⚠️ /roles 由 queryForList 直出 snake_case（client_id）—— 双键兼容（同 0.6.5 parent_id 教训）
  const mine = all.filter(
    (r) => r.scope === 'client' && (r.client_id ?? r.clientId) === appClientId.value
  )
  const preferred =
    mine.find((r) => r.code === 'user') ?? // 约定：普通用户 = 最低权限（首选）
    mine.find((r) => r.code !== 'admin') ?? // 其次：任何非 admin 的角色
    mine[0] // 兜底：应用只有 admin 一个角色时
  defaultAppRoleId.value = preferred ? Number(preferred.id) : null
  defaultAppRoleName.value = preferred ? String(preferred.name || preferred.code) : ''
}

/** 拉取候选用户（全平台池）+ 本系统当前成员（用于标记「已加入」） */
async function loadAddCandidates(): Promise<void> {
  addLoading.value = true
  try {
    const kw = encodeURIComponent(addKeyword.value.trim())
    const cid = encodeURIComponent(appClientId.value)
    const [pool, members] = await Promise.all([
      appRolesApi<{ list?: AdminUserItem[] }>(`/users?keyword=${kw}&page=1&size=20`),
      appRolesApi<{ list?: AdminUserItem[] }>(`/users?client=${cid}&page=1&size=200`),
    ])
    addRows.value = pool?.list ?? []
    addJoinedIds.value = new Set<number>((members?.list ?? []).map((u) => u.id))
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    addLoading.value = false
  }
}

function onAddSelectionChange(selected: AdminUserItem[]): void {
  addSelectedIds.value = selected.map((r) => r.id)
}

/** 已在本系统的用户不可重复勾选（避免覆盖其既有角色） */
function isAddSelectable(row: AdminUserItem): boolean {
  return !addJoinedIds.value.has(row.id)
}

async function openAddExisting(): Promise<void> {
  addVisible.value = true
  addSelectedIds.value = []
  addRows.value = []
  addKeyword.value = ''
  try {
    await loadAppRoleDefs()
    await loadAddCandidates()
  } catch (e) {
    ElMessage.error(errMsg(e))
  }
}

/** 批量把选中用户加入本系统（授予默认 client 级角色） */
async function submitAddExisting(): Promise<void> {
  if (!props.config.appRoles) return
  if (defaultAppRoleId.value === null) {
    ElMessage.warning('本应用暂无 client 级角色，请先在「统一认证中心 → 角色与菜单授权」创建角色')
    return
  }
  addSaving.value = true
  try {
    const ids = [...addSelectedIds.value]
    for (const uid of ids) {
      await appRolesApi(`/users/${uid}/client-roles?client=${encodeURIComponent(appClientId.value)}`, {
        method: 'PUT',
        body: JSON.stringify({ roleIds: [defaultAppRoleId.value] }),
      })
    }
    ElMessage.success(`已加入 ${ids.length} 个用户（最迟 60 秒生效）`)
    addVisible.value = false
    emit('changed', 'create')
    void load()
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    addSaving.value = false
  }
}

/** 应用作用域下新建统一身份后，自动把它加入本系统（失败不阻断创建结果） */
async function joinAppForNewUser(user: AdminUserItem): Promise<void> {
  if (!props.config.appRoles) return
  try {
    if (defaultAppRoleId.value === null) await loadAppRoleDefs()
    if (defaultAppRoleId.value === null) {
      ElMessage.warning('用户已创建，但本应用暂无 client 级角色，未自动加入本系统')
      return
    }
    await appRolesApi(`/users/${user.id}/client-roles?client=${encodeURIComponent(appClientId.value)}`, {
      method: 'PUT',
      body: JSON.stringify({ roleIds: [defaultAppRoleId.value] }),
    })
  } catch (e) {
    ElMessage.warning(`用户已创建，但加入本系统失败：${errMsg(e)}`)
  }
}

async function handleDelete(row: AdminUserItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除用户「${row.username}」？该操作为软删除，用户将无法再登录。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return // 用户取消
  }
  try {
    await props.config.client.remove(row.id)
    ElMessage.success('已删除')
    emit('changed', 'delete')
    // 删掉当前页最后一条时回退一页，避免停在空页
    if (rows.value.length === 1 && page.value > 1) page.value -= 1
    void load()
  } catch (e) {
    ElMessage.error(errMsg(e))
  }
}

// ---------------- 重置密码 ----------------
const resetVisible = ref(false)
const resetTarget = ref<AdminUserItem | null>(null)
const resetFormRef = ref<FormInstance>()
const resetForm = reactive({ newPassword: '' })
const resetRules: FormRules = {
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
}

function openReset(row: AdminUserItem): void {
  resetTarget.value = row
  resetForm.newPassword = ''
  resetVisible.value = true
  resetFormRef.value?.clearValidate()
}

async function submitReset(): Promise<void> {
  const ok = await resetFormRef.value?.validate().catch(() => false)
  if (!ok || !resetTarget.value) return

  submitting.value = true
  try {
    await props.config.client.resetPassword(resetTarget.value.id, resetForm.newPassword)
    ElMessage.success('密码已重置')
    emit('changed', 'resetPassword')
    resetVisible.value = false
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    submitting.value = false
  }
}

defineExpose({ reload: load, reloadToFirstPage: reload })
</script>

<style scoped>
.marschat-user-mgmt {
  width: 100%;
}
.mgmt-card {
  border-radius: 8px;
}
.mgmt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.mgmt-heading {
  min-width: 0;
}
.mgmt-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.mgmt-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.mgmt-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mgmt-search {
  width: 240px;
}
.self-tag {
  margin-left: 6px;
}
.mgmt-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.reset-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}
.app-roles-list {
  min-height: 80px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.app-role-item {
  display: flex;
  align-items: center;
}
.app-role-code {
  margin-left: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.app-role-empty {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 16px 0;
  text-align: center;
}

/* 应用作用域新增样式（Phase 8） */
.app-role-tag {
  margin: 0 4px 0 0;
}
.muted-text {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}
.add-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.add-search {
  width: 260px;
}
</style>
