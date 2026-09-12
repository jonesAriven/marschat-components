<script setup lang="ts">
/**
 * <SidebarMenu>（Phase 2 · frontend-common）
 *
 * 统一侧边栏渲染组件（**纯展示**）：输入已按权限过滤好的菜单元数据。
 * 权限过滤由 @marschat/auth-components 的 useMenus 完成（三层同源：
 * 守卫/菜单/接口消费同一份权限集合），本组件只做「渲染」，
 * 并保持 frontend-common 对 auth-components 零依赖的分层边界。
 *
 * 菜单定义**留应用侧**（2026-09-10 拍板），本组件不做菜单管理。
 */
import { computed } from 'vue'

export interface SidebarMenuItem {
  /** 菜单 key。 */
  key: string
  title: string
  icon?: string
  /** el-menu 的 index（通常是路由 path）。 */
  path?: string
  /** 分组标题（有值 = 分组头）。 */
  group?: string
  order?: number
  children?: SidebarMenuItem[]
}

const props = defineProps<{
  /** 已按权限过滤好的菜单（useMenus().visibleMenus）。 */
  menus: SidebarMenuItem[]
  /** 当前激活路由 path。 */
  active?: string
}>()

const emit = defineEmits<{
  (e: 'select', item: SidebarMenuItem): void
}>()

const groups = computed(() => {
  const out: { name: string; items: SidebarMenuItem[] }[] = []
  for (const m of props.menus) {
    const g = m.group || ''
    let bucket = out.find((x) => x.name === g)
    if (!bucket) {
      bucket = { name: g, items: [] }
      out.push(bucket)
    }
    bucket.items.push(m)
  }
  return out
})

const onSelect = (index: string) => {
  const find = (list: SidebarMenuItem[]): SidebarMenuItem | null => {
    for (const m of list) {
      if (m.path === index || m.key === index) return m
      if (m.children) {
        const hit = find(m.children)
        if (hit) return hit
      }
    }
    return null
  }
  const item = find(props.menus)
  if (item) emit('select', item)
}
</script>

<template>
  <el-menu class="marschat-sidebar-menu" :default-active="active" @select="onSelect">
    <template v-for="g in groups" :key="g.name || '_root'">
      <div v-if="g.name" class="menu-group-title">{{ g.name }}</div>
      <template v-for="m in g.items" :key="m.key">
        <el-sub-menu v-if="m.children && m.children.length" :index="m.key">
          <template #title>
            <span>{{ m.title }}</span>
          </template>
          <el-menu-item v-for="c in m.children" :key="c.key" :index="c.path || c.key">
            {{ c.title }}
          </el-menu-item>
        </el-sub-menu>
        <el-menu-item v-else :index="m.path || m.key">
          <span>{{ m.title }}</span>
        </el-menu-item>
      </template>
    </template>
  </el-menu>
</template>

<style scoped>
.marschat-sidebar-menu {
  border-right: none;
}
.menu-group-title {
  padding: 12px 20px 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
