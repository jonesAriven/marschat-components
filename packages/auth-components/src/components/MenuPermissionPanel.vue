<template>
  <div class="mp-panel">
    <div class="mp-header">
      <div>
        <h3 class="mp-title">{{ config.title || '菜单授权' }}</h3>
        <p v-if="subtitle" class="mp-subtitle">{{ subtitle }}</p>
      </div>
      <el-button type="primary" :loading="saving" :disabled="!selectedRole" @click="save">
        保存授权
      </el-button>
    </div>

    <div class="mp-body">
      <aside class="mp-roles">
        <div class="mp-aside-title">角色</div>
        <div
          v-for="r in visibleRoles"
          :key="r.id"
          class="mp-role"
          :class="{ active: selectedRole === r.id }"
          @click="selectRole(r.id)"
        >
          <span class="mp-role-name">{{ r.name }}</span>
          <el-tag size="small" :type="r.scope === 'platform' ? 'warning' : 'info'">
            {{ r.scope === 'platform' ? '平台' : '应用' }}
          </el-tag>
        </div>
        <div v-if="!visibleRoles.length && !loadingRoles" class="mp-empty">暂无角色</div>
      </aside>

      <section class="mp-tree">
        <div class="mp-aside-title">应用菜单（client: {{ config.clientId }}）</div>
        <el-tree
          v-if="treeData.length"
          ref="treeRef"
          :data="treeData"
          show-checkbox
          node-key="code"
          :props="{ label: 'label', children: 'children' }"
          default-expand-all
        />
        <div v-else class="mp-empty">
          {{ loadingTree ? '加载中…' : '该应用尚无上报菜单（应用侧启用 menu.report 后启动时自动上报）' }}
        </div>
      </section>
    </div>

    <p v-if="message" class="mp-message">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 菜单授权面板（Phase 4 · 双视角第一版：「角色 × 应用菜单」）。
 *
 * 数据面直连 auth-center /admin（Bearer 由宿主注入 getToken）：
 *   GET  /roles                      角色列表
 *   GET  /permissions?client=<id>    应用权限点（含失效，仅渲染 status=1）
 *   GET  /roles/{id}/permission-codes    回显
 *   PUT  /roles/{id}/permission-codes    全量覆盖保存（全码 client:type:code）
 *
 * 授权语义（menu-permission-management-plan §六）：角色级=上限；保存后权限下发
 * 受 auth-core PermissionChecker / 前端 usePermissions 60s 缓存影响，最迟 1 分钟生效。
 */
import { computed, onMounted, ref } from 'vue'

export interface MenuPermissionConfig {
  /** auth-center 根（如 https://auth.marschat.online）——面板拼 /admin/... */
  baseUrl: string
  /** 返回当前 Bearer token（不含 "Bearer " 前缀） */
  getToken: () => string | null
  /** 应用 client_id（如 marschat-kbops） */
  clientId: string
  title?: string
  subtitle?: string
  /** 401 回调（宿主做静默重授权） */
  onUnauthorized?: () => void
}

interface RoleItem {
  id: number
  scope: string
  clientId: string | null
  code: string
  name: string
}

interface PermNode {
  id: number
  code: string
  name: string
  parentId: number | null
  sort: number
  status: number
}

interface TreeItem {
  code: string
  label: string
  children?: TreeItem[]
}

const props = defineProps<{ config: MenuPermissionConfig }>()

const root = computed(() => props.config.baseUrl.replace(/\/+$/, '') + '/admin')
const subtitle = computed(
  () => props.config.subtitle || '按角色勾选可见菜单；保存后最迟 60 秒在应用侧生效（权限缓存 TTL）',
)

const roles = ref<RoleItem[]>([])
const selectedRole = ref<number | null>(null)
const saving = ref(false)
const loadingRoles = ref(false)
const loadingTree = ref(false)
const message = ref('')
const treeRef = ref()
const treeData = ref<TreeItem[]>([])
/** 应用全部 menu 权限点（含失效），code -> node */
const permMap = ref<Map<string, PermNode>>(new Map())

/** 只展示 platform 级角色 + 本应用 client 级角色 */
const visibleRoles = computed(() =>
  roles.value.filter((r) => r.scope === 'platform' || r.clientId === props.config.clientId),
)

function headers(): Record<string, string> {
  const token = props.config.getToken() || ''
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(root.value + path, {
    ...init,
    headers: { ...headers(), ...(init?.headers as Record<string, string>) },
  })
  if (resp.status === 401) {
    props.config.onUnauthorized?.()
    throw new Error('登录态失效')
  }
  const body = await resp.json()
  if (body.code !== 200 && body.code !== 0) {
    throw new Error(body.message || `HTTP ${resp.status}`)
  }
  return body.data as T
}

function buildTree(perms: PermNode[]): TreeItem[] {
  const alive = perms.filter((p) => p.status === 1 && p.code)
  permMap.value = new Map(alive.map((p) => [p.code, p]))
  // ⚠️ /admin/permissions 由 queryForList 直出，键是 snake_case（parent_id）——双写兼容
  const items = [...alive]
    .map((p) => ({ ...p, parentId: (p as any).parent_id ?? p.parentId ?? null }))
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
  const byParent = new Map<number | null, typeof items>()
  for (const p of items) {
    const key = p.parentId
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(p)
  }
  const toTree = (nodes: typeof items): TreeItem[] =>
    nodes.map((n) => {
      const kids = byParent.get(n.id) || []
      const item: TreeItem = { code: n.code, label: n.name || n.code }
      if (kids.length) item.children = toTree(kids)
      return item
    })
  return toTree(byParent.get(null) || [])
}

async function loadRoles() {
  loadingRoles.value = true
  try {
    roles.value = (await api<RoleItem[]>('/roles')) || []
    if (!selectedRole.value && visibleRoles.value.length) {
      // 默认选中平台 user 角色（授权演示最常用）；无则第一个
      const preferred = visibleRoles.value.find((r) => r.scope === 'platform' && r.code === 'user')
      await selectRole((preferred || visibleRoles.value[0]).id)
    }
  } catch (e: any) {
    message.value = e?.message || '加载角色失败'
  } finally {
    loadingRoles.value = false
  }
}

async function loadTree() {
  loadingTree.value = true
  try {
    treeData.value = buildTree((await api<PermNode[]>(`/permissions?client=${encodeURIComponent(props.config.clientId)}`)) || [])
  } catch (e: any) {
    message.value = e?.message || '加载菜单失败'
  } finally {
    loadingTree.value = false
  }
}

async function selectRole(roleId: number) {
  selectedRole.value = roleId
  try {
    const codes = (await api<string[]>(`/roles/${roleId}/permission-codes`)) || []
    // 勾选 = 已绑且在树上的节点；父节点自动半选由 el-tree 处理
    const known = codes.filter((c) => permMap.value.has(c.split(':').slice(2).join(':')))
    treeRef.value?.setCheckedKeys(known, true)
  } catch (e: any) {
    message.value = e?.message || '加载角色授权失败'
  }
}

async function save() {
  if (!selectedRole.value) return
  saving.value = true
  message.value = ''
  try {
    const tree = treeRef.value
    // 全量覆盖 = 勾选 + 半选（组节点必须带，否则组下叶子被授权而组不可见）
    const keys: string[] = [...tree.getCheckedKeys(), ...tree.getHalfCheckedKeys()]
    const body = { codes: keys.map((c) => `${props.config.clientId}:menu:${c}`) }
    const out = await api<{ bound: number }>(`/roles/${selectedRole.value}/permission-codes`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    message.value = `已保存：绑定 ${out.bound} 个菜单权限点（应用侧最迟 60 秒生效）`
  } catch (e: any) {
    message.value = e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadTree().then(loadRoles)
})
</script>

<style scoped>
.mp-panel {
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 8px;
  padding: 16px;
  background: var(--el-bg-color, #fff);
}
.mp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.mp-title {
  margin: 0 0 4px;
  font-size: 16px;
}
.mp-subtitle {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
.mp-body {
  display: flex;
  gap: 16px;
}
.mp-roles {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--el-border-color-lighter, #ebeef5);
  padding-right: 12px;
}
.mp-aside-title {
  font-size: 13px;
  color: var(--el-text-color-secondary, #909399);
  margin-bottom: 8px;
}
.mp-role {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
}
.mp-role:hover {
  background: var(--el-fill-color-light, #f5f7fa);
}
.mp-role.active {
  background: var(--el-color-primary-light-9, #ecf5ff);
}
.mp-role-name {
  font-size: 14px;
}
.mp-tree {
  flex: 1;
  min-height: 240px;
}
.mp-empty {
  color: var(--el-text-color-secondary, #909399);
  font-size: 13px;
  padding: 24px 0;
  text-align: center;
}
.mp-message {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
}
</style>
