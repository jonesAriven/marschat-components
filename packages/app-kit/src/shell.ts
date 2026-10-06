/**
 * 共享应用外壳（AppShell）—— 消灭「每个应用自写一套 MainLayout」的复制粘贴。
 *
 * 背景（Phase 13 审计发现）：`@marschat/frontend-common` 早已导出 `SidebarMenu`，
 * 但**全仓零引用** —— 各应用各自手写侧边栏，长度 675 / 307 / 280 行三套，
 * 导致「三套外壳主题、色语义重叠、低对比度」等 16 项视觉债（STATUS `T-LOW-11`）。
 * 本模块把「外壳」也收敛为组件：应用只提供**菜单数据**，外壳由公共实现负责。
 *
 * 用 TS + `h()` 实现（不写 .vue）：一是让本包保持纯 TS 构建、无需 SFC 工具链，
 * 二是外壳的样式差异本就应通过 CSS 变量统一，而不是靠每应用一份 scoped style 漂移。
 */
import { computed, defineComponent, h, ref, type Component, type VNode } from 'vue'
import { useMenus, getToken, decodeOidcClaims } from '@marschat/auth-components'
import { SidebarMenu } from '@marschat/frontend-common'
import type { RouterLike } from './types'

/** 外壳选项。 */
export interface ShellOptions {
  /** 路由实例（用于菜单点击跳转与高亮当前项）。 */
  router: RouterLike
  /** 菜单定义（业务数据）。 */
  menus: unknown[]
  /** 权限选项（与守卫 / 菜单同一份状态）。 */
  permissions: { issuer: string; clientId: string; getToken: () => string | null; adminBypass: boolean }
  /** 顶栏标题，默认取 clientId。 */
  title?: string
  /** 品牌名（侧边栏顶部），默认同 title。 */
  brand?: string
  /** 退出登录回调（缺省不显示退出按钮）。 */
  onLogout?: () => void
  /** 首页路径（点击品牌回首页）。 */
  homePath?: string
}

/**
 * 创建一个已绑定 router / 菜单 / 权限的**外壳组件**。
 *
 * 宿主用法（`App.vue`）：
 * ```vue
 * <script setup>
 * const Shell = marschat.createShell()
 * </script>
 * <template><component :is="Shell" /></template>
 * ```
 */
export function createMarschatShell(options: ShellOptions): Component {
  const title = options.title ?? options.permissions.clientId
  const brand = options.brand ?? title
  const homePath = options.homePath ?? '/'

  return defineComponent({
    name: 'MarschatAppShell',
    setup(_, { slots }) {
      const { visibleMenus } = useMenus(options.permissions as never, options.menus as never)
      const collapsed = ref(false)

      const currentPath = computed(() => {
        const full = options.router.currentRoute?.value?.path ?? '/'
        return full
      })

      const username = computed(() => {
        const claims = decodeOidcClaims(getToken() || '') as Record<string, unknown>
        return (claims.username || claims.preferred_username || claims.sub || '') as string
      })

      const onSelect = (item: { path?: string; key?: string }) => {
        const target = item.path
        if (target) {
          void options.router.replace(target)
        }
      }

      return () => {
        const children: VNode[] = []

        // ── 侧边栏 ──
        const sidebarChildren: VNode[] = [
          h('div', {
            class: 'marschat-shell__brand',
            onClick: () => void options.router.replace(homePath),
          }, brand),
          h(SidebarMenu as never, {
            menus: visibleMenus.value,
            active: currentPath.value,
            onSelect,
          }),
        ]
        children.push(h('aside', {
          class: ['marschat-shell__aside', collapsed.value ? 'is-collapsed' : ''],
        }, sidebarChildren))

        // ── 主区（顶栏 + 内容）──
        const topbar: (VNode | null)[] = [
          h('button', {
            class: 'marschat-shell__toggle',
            type: 'button',
            'aria-label': '切换侧边栏',
            onClick: () => { collapsed.value = !collapsed.value },
          }, collapsed.value ? '»' : '«'),
          h('span', { class: 'marschat-shell__title' }, title),
          h('span', { class: 'marschat-shell__spacer' }),
          username.value ? h('span', { class: 'marschat-shell__user' }, username.value) : null,
          options.onLogout
            ? h('button', {
                class: 'marschat-shell__logout',
                type: 'button',
                onClick: options.onLogout,
              }, '退出登录')
            : null,
        ]
        const mainChildren: VNode[] = [
          h('header', { class: 'marschat-shell__topbar' }, topbar),
          h('main', { class: 'marschat-shell__content' }, slots.default ? slots.default() : [h('router-view')]),
        ]
        children.push(h('section', { class: 'marschat-shell__main' }, mainChildren))

        return h('div', { class: 'marschat-shell' }, children)
      }
    },
  })
}

/**
 * 外壳基础样式（CSS 变量驱动，主题差异只改变量，不改结构）。
 * 宿主引入一次：`import '@marschat/app-kit/shell.css'` 或直接内联本字符串。
 */
export const SHELL_CSS = `
.marschat-shell{display:flex;height:100vh;overflow:hidden;background:var(--el-bg-color-page,#f5f7fa)}
.marschat-shell__aside{width:220px;flex:0 0 220px;display:flex;flex-direction:column;border-right:1px solid var(--el-border-color-light,#e4e7ed);background:var(--el-bg-color,#fff);transition:width .18s ease,flex-basis .18s ease}
.marschat-shell__aside.is-collapsed{width:64px;flex-basis:64px}
.marschat-shell__brand{padding:18px 20px;font-weight:500;font-size:15px;color:var(--el-text-color-primary,#303133);cursor:pointer;white-space:nowrap;overflow:hidden}
.marschat-shell__main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0}
.marschat-shell__topbar{height:56px;flex:0 0 56px;display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid var(--el-border-color-light,#e4e7ed);background:var(--el-bg-color,#fff)}
.marschat-shell__toggle{border:0;background:transparent;cursor:pointer;font-size:16px;color:var(--el-text-color-secondary,#909399);padding:4px 8px}
.marschat-shell__title{font-size:14px;font-weight:500;color:var(--el-text-color-primary,#303133)}
.marschat-shell__spacer{flex:1 1 auto}
.marschat-shell__user{font-size:13px;color:var(--el-text-color-regular,#606266)}
.marschat-shell__logout{border:1px solid var(--el-border-color,#dcdfe6);background:transparent;border-radius:6px;padding:5px 12px;font-size:13px;cursor:pointer;color:var(--el-text-color-regular,#606266)}
.marschat-shell__content{flex:1 1 auto;overflow:auto;padding:20px}
`
