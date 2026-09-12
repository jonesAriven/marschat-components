<script setup lang="ts">
/**
 * <PermissionGate>（Phase 2 · RBAC 前端能力）
 *
 * 权限点包裹组件：无权限时隐藏 slot（或显示 fallback）。三层同源中的
 * 「组件渲染层」——与路由守卫、@RequirePermission 消费同一份权限集合。
 * 未配置权限点的应用恒显示（R10：行为不变）。
 */
import { computed } from 'vue'
import { usePermissions, type UsePermissionsOptions } from '../composables/usePermissions'

const props = defineProps<{
  /** 权限点 code（可带或不带 client 前缀）。 */
  perm: string
  /** 应用语境（与 usePermissions 相同）。 */
  options: UsePermissionsOptions
  /** 无权限时是否渲染 fallback（默认不渲染）。 */
  showFallback?: boolean
}>()

const { check } = usePermissions(props.options)
const visible = computed(() => check(props.perm))
</script>

<template>
  <slot v-if="visible" />
  <slot v-else-if="showFallback" name="fallback" />
</template>
