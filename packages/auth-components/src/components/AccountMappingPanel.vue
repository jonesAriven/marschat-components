<template>
  <div class="acct-map-panel">
    <!-- ── 概览卡片（点卡片=按应用过滤）── -->
    <div class="acct-map-head">
      <h3 class="acct-map-title">{{ config.title || '账号映射' }}</h3>
      <p v-if="config.subtitle" class="acct-map-subtitle">{{ config.subtitle }}</p>
    </div>

    <div class="acct-map-cards">
      <div
        class="acct-map-card"
        :class="{ active: !clientFilter }"
        @click="pickClient('')"
      >
        <span class="card-label">全部应用</span>
        <strong class="card-num">{{ totals.total }}</strong>
        <span class="card-sub">
          已认领 {{ totals.linked }} · 待绑定
          <em :class="{ warn: totals.pending > 0 }">{{ totals.pending }}</em>
        </span>
      </div>
      <div
        v-for="s in summary"
        :key="s.client_id"
        class="acct-map-card"
        :class="{ active: clientFilter === s.client_id }"
        @click="pickClient(s.client_id)"
      >
        <span class="card-label">{{ clientLabel(s.client_id) }}</span>
        <strong class="card-num">{{ s.total }}</strong>
        <span class="card-sub">
          已认领 {{ s.linked }} · 待绑定
          <em :class="{ warn: s.pending > 0 }">{{ s.pending }}</em>
        </span>
      </div>
    </div>

    <!-- ── 筛选 ── -->
    <div class="acct-map-toolbar">
      <el-select
        v-model="clientFilter"
        placeholder="全部应用"
        clearable
        style="width: 220px"
        @change="reload(1)"
      >
        <el-option
          v-for="s in summary"
          :key="s.client_id"
          :label="clientLabel(s.client_id)"
          :value="s.client_id"
        />
      </el-select>
      <el-input
        v-model="keyword"
        placeholder="按本地账号 / 中心用户名搜索"
        clearable
        style="width: 260px"
        @keyup.enter="reload(1)"
        @clear="reload(1)"
      />
      <el-button type="primary" :loading="loading" @click="reload(1)">查询</el-button>
      <el-button :disabled="loading" @click="resetFilter">重置</el-button>
      <span class="spacer" />
      <el-button :loading="loading" @click="refreshAll">刷新</el-button>
    </div>

    <!-- ── 列表 ── -->
    <el-table v-loading="loading" :data="rows" size="default" border>
      <el-table-column label="应用" min-width="150">
        <template #default="{ row }">{{ clientLabel(row.client_id) }}</template>
      </el-table-column>
      <el-table-column label="本地账号" min-width="150">
        <template #default="{ row }">
          <span>{{ row.local_account }}</span>
          <el-tag v-if="row.local_display_name" size="small" type="info" class="ml6">
            {{ row.local_display_name }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="中心统一身份" min-width="190">
        <template #default="{ row }">
          <template v-if="row.user_id">
            <el-tag size="small" type="success">已认领</el-tag>
            <span class="ml6">{{ row.platform_username || ('#' + row.user_id) }}</span>
            <span v-if="row.platform_email" class="dim">（{{ row.platform_email }}）</span>
          </template>
          <el-tag v-else size="small" type="warning">待绑定</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="110">
        <template #default="{ row }">{{ sourceLabel(row.source) }}</template>
      </el-table-column>
      <el-table-column label="最近上报" width="170">
        <template #default="{ row }">{{ row.last_seen_at || '—' }}</template>
      </el-table-column>
      <el-table-column v-if="!config.readonly" label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="config.allowBind !== false"
            link
            type="primary"
            @click="openBind(row)"
          >{{ row.user_id ? '改绑' : '绑定' }}</el-button>
          <el-button
            v-if="config.allowUnbind !== false && row.user_id"
            link
            type="danger"
            @click="doUnbind(row)"
          >解绑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="acct-map-pager"
      layout="total, prev, pager, next, sizes"
      :total="total"
      :current-page="page"
      :page-size="pageSize"
      :page-sizes="[10, 20, 50]"
      @current-change="onPageChange"
      @size-change="onSizeChange"
    />

    <!-- ── 绑定弹窗 ── -->
    <el-dialog v-model="bindVisible" title="绑定中心统一身份" width="480px">
      <p class="bind-tip">
        将 <strong>{{ current?.client_id }}</strong> 的本地账号
        <strong>{{ current?.local_account }}</strong> 认领到中心用户。
      </p>
      <el-form label-width="100px">
        <el-form-item v-if="config.searchUsers" label="搜索用户">
          <el-select
            v-model="pickedUserId"
            filterable
            remote
            clearable
            reserve-keyword
            placeholder="输入用户名 / 邮箱搜索"
            :remote-method="searchUsers"
            :loading="searching"
            style="width: 100%"
          >
            <el-option
              v-for="u in userOptions"
              :key="u.id"
              :label="`${u.username}${u.nickname ? ' (' + u.nickname + ')' : ''}`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="中心用户ID">
          <el-input v-model="manualUserId" placeholder="直接填中心用户 id，如 148" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bindVisible = false">取消</el-button>
        <el-button type="primary" :loading="binding" @click="doBind">确定绑定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  AccountMappingConfig,
  AccountMappingItem,
  AccountMappingSummaryItem,
  CenterUserOption,
} from '../utils/accountMapping'
import { AccountMappingError } from '../utils/accountMapping'

const props = defineProps<{
  config: AccountMappingConfig
}>()

const loading = ref(false)
const rows = ref<AccountMappingItem[]>([])
const summary = ref<AccountMappingSummaryItem[]>([])
const total = ref(0)

const clientFilter = ref(props.config.defaultClient ?? '')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(props.config.pageSize ?? 10)

const totals = computed(() => {
  const t = summary.value.reduce(
    (acc, s) => {
      acc.total += s.total || 0
      acc.linked += s.linked || 0
      acc.pending += s.pending || 0
      return acc
    },
    { total: 0, linked: 0, pending: 0 }
  )
  return t
})

function clientLabel(id: string): string {
  return props.config.clientLabels?.[id] || id
}

function sourceLabel(src?: string | null): string {
  if (src === 'auto') return '自动认领'
  if (src === 'manual') return '手工绑定'
  if (src === 'report') return '应用上报'
  return '—'
}

function errMsg(e: unknown): string {
  if (e instanceof AccountMappingError) return e.message
  return e instanceof Error ? e.message : '操作失败'
}

async function loadSummary() {
  try {
    summary.value = await props.config.client.summary()
  } catch (e) {
    // 概览失败不阻塞列表：仅在列表失败时统一提示，避免双 toast
    summary.value = []
  }
}

async function loadList() {
  loading.value = true
  try {
    const res = await props.config.client.listMappings({
      client: clientFilter.value || undefined,
      keyword: keyword.value || undefined,
      page: page.value,
      size: pageSize.value,
    })
    rows.value = res.records
    total.value = res.total
  } catch (e) {
    ElMessage.error(errMsg(e))
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function reload(toPage = page.value) {
  page.value = toPage
  await loadList()
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadList()])
}

function pickClient(id: string) {
  clientFilter.value = id
  reload(1)
}

function resetFilter() {
  clientFilter.value = ''
  keyword.value = ''
  reload(1)
}

function onPageChange(p: number) {
  page.value = p
  loadList()
}

function onSizeChange(s: number) {
  pageSize.value = s
  reload(1)
}

// ── 绑定 ──
const bindVisible = ref(false)
const binding = ref(false)
const current = ref<AccountMappingItem | null>(null)
const pickedUserId = ref<number | string | null>(null)
const manualUserId = ref('')
const userOptions = ref<CenterUserOption[]>([])
const searching = ref(false)

function openBind(row: AccountMappingItem) {
  current.value = row
  pickedUserId.value = null
  manualUserId.value = ''
  userOptions.value = []
  bindVisible.value = true
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function searchUsers(kw: string) {
  if (!props.config.searchUsers) return
  if (searchTimer) clearTimeout(searchTimer)
  const q = (kw || '').trim()
  if (!q) {
    userOptions.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    searching.value = true
    try {
      userOptions.value = await props.config.searchUsers!(q)
    } catch (e) {
      ElMessage.error(errMsg(e))
    } finally {
      searching.value = false
    }
  }, 300)
}

async function doBind() {
  const uid = pickedUserId.value ?? (manualUserId.value ? Number(manualUserId.value) : null)
  if (uid === null || uid === '' || Number.isNaN(Number(uid))) {
    ElMessage.warning('请选择或填写中心用户 ID')
    return
  }
  if (!current.value) return
  binding.value = true
  try {
    await props.config.client.bind(current.value.id, uid as number)
    ElMessage.success('绑定成功')
    bindVisible.value = false
    await refreshAll()
  } catch (e) {
    ElMessage.error(errMsg(e))
  } finally {
    binding.value = false
  }
}

async function doUnbind(row: AccountMappingItem) {
  try {
    await ElMessageBox.confirm(
      `确定解除「${row.client_id}」本地账号「${row.local_account}」与中心用户的绑定？解除后该账号将回到「待绑定」状态。`,
      '解绑确认',
      { type: 'warning', confirmButtonText: '解绑', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await props.config.client.unbind(row.id)
    ElMessage.success('已解绑')
    await refreshAll()
  } catch (e) {
    ElMessage.error(errMsg(e))
  }
}

onMounted(refreshAll)

defineExpose({ refresh: refreshAll, reload })
</script>

<style scoped lang="scss">
.acct-map-panel {
  padding: 4px 2px;
}

.acct-map-title {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
}

.acct-map-subtitle {
  margin: 0 0 16px;
  font-size: 13px;
  color: #909399;
}

.acct-map-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}

.acct-map-card {
  min-width: 168px;
  padding: 12px 16px;
  border: 1px solid #e8eaee;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;

  &:hover {
    border-color: #c6d4f0;
  }

  &.active {
    border-color: #409eff;
    box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.12);
  }

  .card-label {
    display: block;
    font-size: 12.5px;
    color: #606266;
    margin-bottom: 6px;
  }

  .card-num {
    font-size: 22px;
    font-weight: 700;
    color: #303133;
  }

  .card-sub {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: #909399;

    em {
      font-style: normal;
      color: #67c23a;

      &.warn {
        color: #e6a23c;
        font-weight: 600;
      }
    }
  }
}

.acct-map-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;

  .spacer {
    flex: 1;
  }
}

.acct-map-pager {
  margin-top: 14px;
  justify-content: flex-end;
}

.ml6 {
  margin-left: 6px;
}

.dim {
  color: #909399;
  font-size: 12px;
}

.bind-tip {
  margin: 0 0 14px;
  font-size: 13px;
  color: #606266;
  line-height: 1.7;
}
</style>
