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
        <el-table-column label="角色" width="110">
          <template #default="{ row }">
            <el-tag :type="roleTagType(row.role)" size="small">{{ roleLabel(row.role) }}</el-tag>
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
        <el-table-column v-if="!cfg.readonly" label="操作" width="240" fixed="right">
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
              v-if="cfg.allowDelete !== false"
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
        <el-form-item v-if="cfg.allowEditRole !== false" label="角色" prop="role">
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
  /** 数据被修改（新增/编辑/删除/重置密码成功）后触发，便于宿主刷新自身状态 */
  (e: 'changed', action: 'create' | 'update' | 'delete' | 'resetPassword'): void
}>()

const cfg = computed(() => props.config)

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
    })
    rows.value = res.list
    total.value = res.total
  } catch (e) {
    ElMessage.error(errMsg(e))
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
      await props.config.client.create({
        username: form.username.trim(),
        password: form.password,
        role: form.role || undefined,
        nickname: form.nickname || undefined,
        email: form.email || undefined,
        realmId: props.config.realmId,
      })
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
</style>
