<template>
  <el-dialog
    :model-value="visible"
    :title="dialogTitle"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <p class="umo-hint">
      取消勾选即为「<b>减法</b>」：该用户在本应用看不到该菜单；未配置时跟随角色默认。
    </p>
    <p class="umo-sub">
      只能在本用户<b>角色已授权的菜单</b>范围内做减法，<b>永不越权新增</b>。
      灰色（不可勾选）的菜单表示角色层尚未授权，需先到「角色与菜单授权」里配置。
    </p>

    <div v-loading="loading" class="umo-summary">
      <el-tag size="small" type="info" effect="plain">可配置菜单 {{ grantedShort.size }}</el-tag>
      <el-tag size="small" :type="denyCount > 0 ? 'danger' : 'success'" effect="plain">
        当前减法 {{ denyCount }}
      </el-tag>
      <el-tag size="small" type="warning" effect="plain">角色 {{ roleIds.length }}</el-tag>
    </div>

    <div class="umo-tree-wrap">
      <el-tree
        v-if="treeData.length"
        ref="treeRef"
        :data="treeData"
        show-checkbox
        node-key="code"
        :props="treeProps"
        default-expand-all
        @check="onTreeCheck"
      />
      <div v-else-if="!loading" class="umo-empty">
        {{ emptyText }}
      </div>
    </div>

    <p v-if="message" class="umo-message">{{ message }}</p>

    <template #footer>
      <el-button
        :disabled="loading || saving || !grantedShort.size"
        :loading="resetting"
        @click="resetToRoleDefault"
      >
        重置为角色默认
      </el-button>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button
        type="primary"
        :disabled="loading || !grantedShort.size"
        :loading="saving"
        @click="save"
      >
        保存
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
/**
 * 用户级菜单权限面板（G1 · 用户级菜单减法）。
 *
 * 数据面走 `utils/userMenuOverride.ts` 的 `UserMenuOverrideClient`（同仓风格：
 * 数据源适配器与视图分离，宿主注入 issuer + token）。
 *
 * ## 交互语义
 * - 勾选状态 = 「角色已授权菜单」中**未被 deny** 的项；
 * - 🔴 只渲染该用户在本应用**角色已授权菜单的并集**（client-roles → 各角色
 *   permission-codes 求并集 → 与该应用 menu 权限点求交）；角色未授权的菜单
 *   `disabled` + 提示「需先在角色层授权」；
 * - 保存 = 把「被取消勾选的菜单全码」作为 deny 集 `PUT` 上去（全量覆盖）；
 * - 「重置为角色默认」= `PUT {"codes":[]}`（清空该用户在本应用的全部减法）。
 *
 * 保存后受 auth-core / 前端 usePermissions 60s 缓存影响，最迟 1 分钟生效。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  UserMenuOverrideError,
  type MenuPermissionNode,
  type UserMenuOverrideConfig,
} from '../utils/userMenuOverride'

/** 树节点（node-key = 菜单短码；full code = `${clientId}:menu:${code}`） */
interface TreeNode {
  code: string
  label: string
  /** true = 角色层未授权，只读展示，不可勾选 */
  disabled: boolean
  children?: TreeNode[]
}

const props = defineProps<{
  /** 对话框可见性 */
  visible: boolean
  /** 面板配置（含数据源 / 应用 / 被配置用户） */
  config: UserMenuOverrideConfig
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  /** 保存成功（含「重置为角色默认」），回传当前 deny 数量 */
  (e: 'saved', deniedCount: number): void
}>()

/** el-tree 的 props 映射：disabled 由节点字段驱动（角色未授权 → 不可勾选） */
const treeProps = { label: 'label', children: 'children', disabled: 'disabled' }

const dialogTitle = computed(
  () =>
    `${props.config.title || '菜单权限'} — ${props.config.username} @ ${
      props.config.appName || props.config.clientId
    }`
)

const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const message = ref('')
const treeRef = ref()
const treeData = ref<TreeNode[]>([])
/** 角色已授权菜单短码集合（= 上限） */
const grantedShort = ref<Set<string>>(new Set())
/** 当前 deny 短码集合（服务端回显） */
const deniedShort = ref<Set<string>>(new Set())
/** 角色 id（仅用于概览展示） */
const roleIds = ref<number[]>([])
/** 实时 deny 计数（随勾选变化） */
const denyCount = ref(0)

const emptyText = computed(() => {
  if (roleIds.value.length === 0) {
    return '该用户在本应用暂无角色，无可用菜单。请先到「跨应用授权」或行内「应用角色」为TA分配本应用角色。'
  }
  return '该应用尚无上报菜单，或角色未授权任何菜单（应用侧启用 menu.report 后启动时自动上报）。'
})

function errMsg(e: unknown): string {
  if (e instanceof UserMenuOverrideError) return e.message
  if (e instanceof Error) return e.message
  return '操作失败'
}

/** full code（`client:type:code`）→ 短码（`code`，允许 code 内含冒号） */
function shortOf(full: string): string {
  return full.split(':').slice(2).join(':')
}

/** 由权限点明细构建菜单树（只取 type=menu 且 status=1；parent_id snake_case 双键兼容） */
function buildTree(perms: MenuPermissionNode[], granted: Set<string>): TreeNode[] {
  const menu = perms.filter((p) => p.type === 'menu' && p.status === 1 && p.code)
  const items = menu
    .map((p) => ({ ...p, pid: p.parent_id ?? p.parentId ?? null }))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id - b.id)

  const byParent = new Map<number | null, typeof items>()
  for (const p of items) {
    const key = p.pid
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(p)
  }

  const toTree = (nodes: typeof items): TreeNode[] =>
    nodes.map((n) => {
      const kids = byParent.get(n.id) || []
      const node: TreeNode = {
        code: n.code,
        label: n.name || n.code,
        disabled: !granted.has(n.code),
      }
      if (kids.length) node.children = toTree(kids)
      return node
    })

  // 根节点 = parent_id 为空，或父节点不在菜单集合中（避免孤儿节点被吞掉）
  const ids = new Set(items.map((p) => p.id))
  const roots = items.filter((p) => p.pid === null || !ids.has(p.pid as number))
  return toTree(roots)
}

/**
 * 收集「角色已授权子图里的叶子」短码 —— 即：自身已授权、且没有任何已授权子节点。
 *
 * 用它做初始勾选：只勾这些节点，父节点交由 el-tree 推导（全选/半选）。
 * 这样即便某个已授权父菜单下**全部子菜单都未授权**，父菜单本身也会被勾上
 * （否则会被误计入 deny，等于「越权做减法」）。
 */
function collectGrantedLeaves(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    const kids = n.children || []
    const grantedKids = kids.filter((c) => !c.disabled)
    if (!n.disabled && grantedKids.length === 0) acc.push(n.code)
    if (kids.length) collectGrantedLeaves(kids, acc)
  }
  return acc
}

/** 读取当前「被保留」的短码（勾选 + 半选）；父节点半选表示其下仍有可见子菜单 */
function keptShort(): Set<string> {
  const tree = treeRef.value
  if (!tree) return new Set()
  const checked = (tree.getCheckedKeys() as Array<string | number>).map(String)
  const half = (tree.getHalfCheckedKeys() as Array<string | number>).map(String)
  return new Set([...checked, ...half])
}

/** 当前应写入的 deny 短码 = 上限 − 保留 */
function computeDeniedShort(): string[] {
  const kept = keptShort()
  const denied: string[] = []
  for (const c of grantedShort.value) if (!kept.has(c)) denied.push(c)
  return denied
}

function refreshDenyCount(): void {
  denyCount.value = computeDeniedShort().length
}

function onTreeCheck(): void {
  refreshDenyCount()
}

async function load(): Promise<void> {
  loading.value = true
  message.value = ''
  const { client, clientId, userId } = props.config
  try {
    const [perms, roleIdList, deniedCodes] = await Promise.all([
      client.listMenuPermissions(clientId),
      client.userClientRoles(userId, clientId),
      client.list(userId, clientId),
    ])
    const roleCodeArrays = await Promise.all(
      roleIdList.map((rid) => client.rolePermissionCodes(rid))
    )

    // 角色已授权菜单全码并集（只取本应用的 menu 权限点）→ 截成短码集合
    const prefix = `${clientId}:menu:`
    const granted = new Set<string>()
    for (const codes of roleCodeArrays) {
      for (const c of codes) if (c.startsWith(prefix)) granted.add(shortOf(c))
    }

    roleIds.value = roleIdList
    grantedShort.value = granted
    deniedShort.value = new Set(
      deniedCodes.filter((c) => c.startsWith(prefix)).map(shortOf)
    )

    treeData.value = buildTree(perms, granted)

    // 勾选 = 已授权且未被 deny 的「已授权叶子」；父节点由 el-tree 推导
    await nextTick()
    const initialChecked = collectGrantedLeaves(treeData.value).filter(
      (c) => !deniedShort.value.has(c)
    )
    treeRef.value?.setCheckedKeys(initialChecked, false)
    refreshDenyCount()
  } catch (e) {
    message.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

function applyRoleDefault(): void {
  const allChecked = collectGrantedLeaves(treeData.value)
  treeRef.value?.setCheckedKeys(allChecked, false)
  denyCount.value = 0
}

async function save(): Promise<void> {
  saving.value = true
  message.value = ''
  const { client, clientId, userId } = props.config
  const denied = computeDeniedShort().map((c) => `${clientId}:menu:${c}`)
  try {
    const n = await client.save(userId, clientId, denied)
    deniedShort.value = new Set(computeDeniedShort())
    denyCount.value = denied.length
    message.value = `已保存：${n} 个菜单对本用户不可见（最迟 60 秒生效）`
    emit('saved', n)
  } catch (e) {
    message.value = errMsg(e)
  } finally {
    saving.value = false
  }
}

async function resetToRoleDefault(): Promise<void> {
  resetting.value = true
  message.value = ''
  const { client, clientId, userId } = props.config
  try {
    await client.save(userId, clientId, [])
    deniedShort.value = new Set()
    applyRoleDefault()
    message.value = '已重置：跟随角色默认（清空本用户的全部菜单减法）'
    emit('saved', 0)
  } catch (e) {
    message.value = errMsg(e)
  } finally {
    resetting.value = false
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) void load()
  }
)

onMounted(() => {
  if (props.visible) void load()
})
</script>

<style scoped>
.umo-hint {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.6;
}
.umo-sub {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.6;
}
.umo-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  margin-bottom: 10px;
}
.umo-tree-wrap {
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 6px;
  padding: 8px 4px;
}
.umo-empty {
  color: var(--el-text-color-secondary, #909399);
  font-size: 13px;
  padding: 28px 12px;
  text-align: center;
  line-height: 1.7;
}
.umo-message {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
}
</style>
