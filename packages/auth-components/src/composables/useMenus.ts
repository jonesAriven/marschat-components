/**
 * useMenus（Phase 2 · 菜单按权限渲染）
 *
 * 输入本应用**本地菜单元数据**（菜单定义留应用侧——2026-09-10 拍板 B 方案），
 * 基于权限集合过滤输出。菜单权限点 code 约定 `<client>:menu:<菜单key>`。
 *
 * **R10 默认策略**：应用未配置权限点（configured=false）→ 原样返回全部菜单，
 * 存量应用零波及。个别菜单未在权限点中登记（meta.skipPerm）→ 同样显示。
 */
import { computed, type Ref } from 'vue'
import { usePermissions, fetchPermissions, type UsePermissionsOptions } from './usePermissions'

/** 应用本地菜单元数据（与应用 menu-registry.yml / 常量同构）。 */
export interface MenuItemDef {
  /** 菜单 key（权限点 code；同 client 内唯一）。 */
  key: string
  title: string
  icon?: string
  /** 静态 path；动态 path 场景与 {@link pathFn} 二选一。 */
  path?: string
  /**
   * 动态 path 生成器（kb-web 的 /space/${currentSpace.id} 类场景）。
   * 渲染层 `:index` 取 `pathFn?.() ?? path`；visibleFn 为 false 时整项隐藏。
   */
  pathFn?: () => string
  /** 分组标题（有值 = 分组头）。 */
  group?: string
  order?: number
  /** true = 渲染但隐藏（目录型）。 */
  hidden?: boolean
  /** 跳过权限校验（如工作台/设置等基础项）。 */
  skipPerm?: boolean
  /**
   * 运行时可见性函数（依赖 store 等运行时状态，如「当前空间存在才显示」）。
   * 返回 false = 整项隐藏（与权限过滤正交；skipPerm 不影响本函数）。
   */
  visibleFn?: () => boolean
  /** 运行时禁用（模块健康度类，如 kb-knowledge 不可用）——灰化不禁用隐藏。 */
  disabledFn?: () => boolean
  /** 禁用原因（tooltip 文案），配合 disabledFn。 */
  disabledReasonFn?: () => string
  children?: MenuItemDef[]
}

export function useMenus(opts: UsePermissionsOptions, menus: MenuItemDef[] | Ref<MenuItemDef[]>) {
  const { state, check } = usePermissions(opts)
  const source = computed(() => (Array.isArray(menus) ? menus : menus.value))

  const filterOne = (m: MenuItemDef): MenuItemDef | null => {
    if (m.visibleFn && !m.visibleFn()) {
      return null
    }
    if (m.skipPerm || !state.value.configured) {
      return m
    }
    if (!check(`${opts.clientId}:menu:${m.key}`)) {
      return null
    }
    if (m.children) {
      const children = m.children.map(filterOne).filter((x): x is MenuItemDef => !!x)
      return { ...m, children }
    }
    return m
  }

  const visibleMenus = computed(() =>
    source.value
      .map(filterOne)
      .filter((m): m is MenuItemDef => !!m)
      .filter((m) => !m.hidden || (m.children && m.children.length > 0))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  )

  return {
    visibleMenus,
    configured: computed(() => state.value.configured),
    refresh: () => fetchPermissions(opts, true),
  }
}

// fetchPermissions 从同模块 re-export 便于应用一处 import
export { fetchPermissions } from './usePermissions'
