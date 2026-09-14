<template>
  <div class="marschat-authz-matrix">
    <el-card shadow="never" class="matrix-card">
      <template #header>
        <div class="matrix-header">
          <div class="matrix-heading">
            <h3 class="matrix-title">{{ cfg.title }}</h3>
            <p v-if="cfg.subtitle" class="matrix-subtitle">{{ cfg.subtitle }}</p>
          </div>
          <div class="matrix-toolbar">
            <el-input
              v-model="keyword"
              class="matrix-search"
              placeholder="搜索用户名 / 邮箱 / 昵称"
              clearable
              @keyup.enter="reload"
              @clear="reload"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
            <el-button :loading="loading" @click="reload">查询</el-button>
          </div>
        </div>
      </template>

      <el-table v-loading="loading" :data="rows" row-key="userId" stripe border>
        <el-table-column prop="username" label="用户" min-width="150" fixed>
          <template #default="{ row }">
            <span class="cell-user">{{ row.username }}</span>
            <span v-if="row.nickname" class="cell-nick">（{{ row.nickname }}）</span>
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
        <el-table-column label="全局角色" width="110">
          <template #default="{ row }">
            <el-tag :type="globalRoleTagType(row.globalRole)" size="small">
              {{ globalRoleLabel(row.globalRole) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 0 ? 'danger' : 'success'" size="small" effect="plain">
              {{ row.status === 0 ? '禁用' : '启用' }}
            </el-tag>
          </template>
        </el-table-column>

        <!-- 动态列：每个应用一列（新增应用零前端改动） -->
        <el-table-column
          v-for="c in clients"
          :key="c.clientId"
          :label="clientLabel(c)"
          width="170"
          align="center"
        >
          <template #default="{ row }">
            <div
              class="cell-roles"
              :class="{ clickable: canEdit }"
              :title="canEdit ? '点击分配该用户在此应用的角色' : ''"
              @click="canEdit && openCell(row, c.clientId)"
            >
              <template v-if="cellRoles(row, c.clientId).length">
                <el-tag
                  v-for="r in cellRoles(row, c.clientId)"
                  :key="r.id"
                  class="cell-role-tag"
                  size="small"
                  type="success"
                  effect="light"
                >
                  {{ r.name || r.code }}
                </el-tag>
              </template>
              <span v-else-if="hasMapping(row, c.clientId)" class="cell-empty">—</span>
              <span v-else class="cell-none">未授权</span>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="matrix-footer">
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

    <!-- 单元格编辑：某用户在某应用的角色 -->
    <el-dialog
      v-model="cellVisible"
      :title="`分配角色 — ${cellUser?.username || ''} @ ${clientLabelById(cellClientId)}`"
      width="480px"
      :close-on-click-modal="false"
    >
      <p class="cell-hint">
        该用户在此应用内拥有的角色（决定其可见菜单与可调用接口）。<b>取消全部勾选 = 移出该应用。</b>
        保存后最迟 60 秒生效。
      </p>

      <div v-loading="cellLoading" class="cell-role-list">
        <el-checkbox
          v-for="r in clientRoleOptions"
          :key="r.id"
          v-model="r.checked"
          class="cell-role-item"
        >
          {{ r.name || r.code }}
          <span class="cell-role-code">{{ r.code }}</span>
        </el-checkbox>
        <el-empty
          v-if="!clientRoleOptions.length && !cellLoading"
          :image-size="60"
          description="该应用暂无 client 级角色，请先在「角色与菜单授权」中创建"
        />
      </div>

      <template #footer>
        <el-button @click="cellVisible = false">取消</el-button>
        <el-button type="primary" :loading="cellSaving" @click="saveCell">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * 跨应用授权矩阵面板（Phase 8 · 中心侧核心新能力）
 *
 * ## 解决什么问题
 * 良哥的初衷之一是「**哪些账号有哪些系统的权限**」。此前只能逐应用进、逐用户点，
 * 没有任何一处可以横向对比。本面板把「用户 × 应用 × 角色」压成一张矩阵：
 * 纵向是用户，横向是各应用，单元格是该用户在该系统的角色 —— 一屏看全，点击即改。
 *
 * ## 用法
 * ```vue
 * <CrossAppAuthPanel :config="{
 *   client: createAuthorizationMatrixClient({ issuer, getToken }),
 *   title: '跨应用授权',
 * }" />
 * ```
 *
 * ## 渲染要点
 * - **列是动态的**：由后端 `clients[]` 驱动（`sys_app_client` 中启用的应用），
 *   新增应用无需改前端。
 * - 单元格三态：有角色 → 绿色 tag；无角色但仍是本系统成员（服务端标记） → `—`；从未授权 → 灰色「未授权」。
 * - 只读模式（`readonly` / `allowEdit:false`）下单元格不可点。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import type {
  AuthorizationMatrixConfig,
  MatrixClientRef,
  MatrixRole,
  MatrixRoleDef,
  MatrixUserRow,
} from '../utils/authorizationMatrix'
import { AuthorizationMatrixError, roleClientId } from '../utils/authorizationMatrix'

const props = defineProps<{
  config: AuthorizationMatrixConfig
}>()

const cfg = computed(() => props.config)
const canEdit = computed(() => cfg.value.readonly !== true && cfg.value.allowEdit !== false)

// ---------------- 矩阵列表 ----------------
const rows = ref<MatrixUserRow[]>([])
const clients = ref<MatrixClientRef[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(props.config.pageSize ?? 20)
const keyword = ref('')
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await cfg.value.client.matrix({
      keyword: keyword.value.trim() || undefined,
      page: page.value,
      size: pageSize.value,
    })
    rows.value = res.records
    clients.value = res.clients
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

onMounted(load)

// ---------------- 单元格展示 ----------------
function cellRoles(row: MatrixUserRow, clientId: string): MatrixRole[] {
  return row.apps?.[clientId] ?? []
}

/** 该用户在矩阵里出现过（服务端返回了该 client 的键）→ 视为本系统成员 */
function hasMapping(row: MatrixUserRow, clientId: string): boolean {
  return Object.prototype.hasOwnProperty.call(row.apps ?? {}, clientId)
}

function clientLabel(c: MatrixClientRef): string {
  return cfg.value.clientLabels?.[c.clientId] ?? c.name ?? c.clientId
}

function clientLabelById(clientId: string): string {
  const hit = clients.value.find((c) => c.clientId === clientId)
  return hit ? clientLabel(hit) : clientId
}

function globalRoleLabel(role?: string | null): string {
  if (!role) return '—'
  if (role === 'superadmin') return '超级管理员'
  if (role === 'admin') return '管理员'
  if (role === 'user') return '普通用户'
  return role
}

function globalRoleTagType(role?: string | null): 'danger' | 'warning' | 'info' {
  if (role === 'superadmin' || role === 'admin') return 'danger'
  return 'info'
}

function errMsg(e: unknown): string {
  if (e instanceof AuthorizationMatrixError) return e.message
  if (e instanceof Error) return e.message
  return '操作失败'
}

// ---------------- 单元格编辑 ----------------
interface RoleOption extends MatrixRoleDef {
  checked: boolean
}

const cellVisible = ref(false)
const cellLoading = ref(false)
const cellSaving = ref(false)
const cellUser = ref<MatrixUserRow | null>(null)
const cellClientId = ref('')
const cellOptions = ref<RoleOption[]>([])

/** 当前应用的 client 级角色选项 */
const clientRoleOptions = computed(() => cellOptions.value)

async function openCell(row: MatrixUserRow, clientId: string): Promise<void> {
  cellUser.value = row
  cellClientId.value = clientId
  cellVisible.value = true
  cellLoading.value = true
  cellOptions.value = []
  try {
    const [allRoles, boundIds] = await Promise.all([
      cfg.value.client.listRoles(),
      cfg.value.client.userClientRoles(row.userId, clientId),
    ])
    cellOptions.value = allRoles
      .filter((r) => r.scope === 'client' && roleClientId(r) === clientId)
      .map((r) => ({ ...r, checked: boundIds.includes(r.id) }))
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    cellLoading.value = false
  }
}

async function saveCell(): Promise<void> {
  if (!cellUser.value) return
  cellSaving.value = true
  try {
    const roleIds = cellOptions.value.filter((r) => r.checked).map((r) => r.id)
    await cfg.value.client.assignUserClientRoles(cellUser.value.userId, cellClientId.value, roleIds)
    ElMessage.success(
      roleIds.length ? `已保存：${roleIds.length} 个角色（最迟 60 秒生效）` : '已移出该应用'
    )
    cellVisible.value = false
    void load()
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    cellSaving.value = false
  }
}

// 供宿主在数据变更后手动刷新
defineExpose({ reload: load, reloadToFirstPage: reload })
</script>

<style scoped>
.marschat-authz-matrix {
  width: 100%;
}
.matrix-card {
  border-radius: 8px;
}
.matrix-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.matrix-heading {
  min-width: 0;
}
.matrix-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.matrix-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.matrix-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.matrix-search {
  width: 240px;
}
.matrix-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
.cell-user {
  font-weight: 500;
}
.cell-nick {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.cell-roles {
  min-height: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: center;
  align-items: center;
  border-radius: 4px;
  padding: 2px 4px;
  transition: background 0.15s ease;
}
.cell-roles.clickable {
  cursor: pointer;
}
.cell-roles.clickable:hover {
  background: var(--el-color-primary-light-9, #ecf5ff);
}
.cell-role-tag {
  margin: 0;
}
.cell-empty {
  color: var(--el-text-color-secondary);
}
.cell-none {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}
.cell-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}
.cell-role-list {
  min-height: 80px;
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cell-role-item {
  display: flex;
  align-items: center;
}
.cell-role-code {
  margin-left: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
