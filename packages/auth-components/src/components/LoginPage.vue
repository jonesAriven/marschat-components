<template>
  <div
    class="auth-login-page"
    :class="[`is-${layout}`, { 'is-dark': isDark }]"
    :style="cssVars"
  >
    <!-- 品牌侧：渐变 + 光晕 + 网格，窄屏自动隐藏 -->
    <aside v-if="layout === 'split'" class="auth-login-page__brand">
      <div class="brand-aurora" aria-hidden="true"></div>
      <div class="brand-grid" aria-hidden="true"></div>

      <div class="brand-body">
        <div class="brand-mark">
          <el-icon :size="26">
            <component :is="config.icon || 'DataAnalysis'" />
          </el-icon>
        </div>
        <h1 class="brand-name">{{ brandName }}</h1>
        <p class="brand-tagline">{{ brandTagline }}</p>

        <ul v-if="highlights.length" class="brand-highlights">
          <li v-for="(h, i) in highlights" :key="i">
            <span class="hl-icon">
              <el-icon :size="16"><component :is="h.icon || 'Check'" /></el-icon>
            </span>
            <span class="hl-text">
              <strong>{{ h.title }}</strong>
              <em v-if="h.desc">{{ h.desc }}</em>
            </span>
          </li>
        </ul>
      </div>

      <div class="brand-foot">
        <span>{{ footerText }}</span>
      </div>
    </aside>

    <!-- 表单侧 -->
    <main class="auth-login-page__main">
      <div class="auth-login-page__card">
        <LoginPanel
          :config="config"
          @login="(c) => emit('login', c)"
          @sso-login="emit('sso-login')"
          @password-reset="emit('password-reset')"
        />
        <slot />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import LoginPanel from './LoginPanel.vue'
import type { LoginPageConfig } from '../types'

const props = withDefaults(
  defineProps<{
    config: LoginPageConfig
    /** 深色模式：auto=跟随系统/html.dark，也可强制 true/false */
    dark?: 'auto' | boolean
  }>(),
  { dark: 'auto' }
)

const emit = defineEmits<{
  (e: 'login', credentials: { username: string; password: string }): void
  (e: 'sso-login'): void
  (e: 'password-reset'): void
}>()

const layout = computed(() => props.config.layout || 'split')
const accent = computed(() => props.config.color || '#3d5af1')

/** 深色判定：显式开关 > html.dark > 系统偏好 */
const systemDark = ref(false)
let mq: MediaQueryList | null = null
const onMqChange = (e: MediaQueryListEvent) => { systemDark.value = e.matches }

onMounted(() => {
  mq = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = mq.matches
  mq.addEventListener('change', onMqChange)
})
onBeforeUnmount(() => mq?.removeEventListener('change', onMqChange))

const isDark = computed(() => {
  if (typeof props.dark === 'boolean') return props.dark
  if (document.documentElement.classList.contains('dark')) return true
  return systemDark.value
})

const cssVars = computed(() => ({
  '--lp-accent': accent.value,
  '--lp-brand-from': props.config.brand?.gradient?.[0] || '#1d2535',
  '--lp-brand-to': props.config.brand?.gradient?.[1] || '#2f3f73',
}))

const brandName = computed(() => props.config.brand?.name || props.config.title)
const brandTagline = computed(
  () => props.config.brand?.tagline || props.config.subtitle || ''
)
const highlights = computed(() => props.config.brand?.highlights || [])
const footerText = computed(
  () => props.config.footerText || '© MarsChat · 统一认证'
)
</script>

<style scoped lang="scss">
.auth-login-page {
  /* 组件自带默认令牌：应用没定义也能独立跑，应用可用同名变量覆盖 */
  --lp-bg: #f5f7fa;
  --lp-surface: #ffffff;
  --lp-text: #1f2430;
  --lp-text-2: #5b6472;
  --lp-text-3: #8d96a5;
  --lp-border: #e8eaee;
  --lp-input-bg: #ffffff;
  --lp-shadow: 0 18px 50px rgba(20, 24, 33, 0.1);

  position: relative;
  min-height: 100vh;
  display: flex;
  background: var(--lp-bg);
  color: var(--lp-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Microsoft YaHei', sans-serif;
  overflow: hidden;
}

/* ---------- 品牌侧 ---------- */
.auth-login-page__brand {
  position: relative;
  flex: 1 1 52%;
  max-width: 640px;
  padding: 56px 56px 32px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: linear-gradient(160deg, var(--lp-brand-from) 0%, var(--lp-brand-to) 100%);
  color: #fff;
  overflow: hidden;
}

.brand-aurora {
  position: absolute;
  inset: -30% -20% auto -20%;
  height: 140%;
  background:
    radial-gradient(42% 38% at 18% 22%, rgba(124, 140, 255, 0.45), transparent 60%),
    radial-gradient(38% 34% at 82% 18%, rgba(64, 224, 208, 0.25), transparent 62%),
    radial-gradient(46% 40% at 62% 88%, rgba(255, 122, 180, 0.2), transparent 64%);
  filter: blur(6px);
  animation: aurora 18s ease-in-out infinite alternate;
  pointer-events: none;
}

.brand-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(80% 70% at 30% 30%, #000 30%, transparent 100%);
  pointer-events: none;
}

.brand-body,
.brand-foot {
  position: relative;
  z-index: 1;
}

.brand-mark {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(6px);
  margin-bottom: 22px;
}

.brand-name {
  margin: 0 0 8px;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1.25;
}

.brand-tagline {
  margin: 0 0 34px;
  font-size: 15px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.72);
  max-width: 22em;
}

.brand-highlights {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 16px;
  max-width: 380px;

  li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
}

.hl-icon {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff;
}

.hl-text {
  display: flex;
  flex-direction: column;
  gap: 2px;

  strong {
    font-size: 14px;
    font-weight: 600;
  }

  em {
    font-style: normal;
    font-size: 12.5px;
    color: rgba(255, 255, 255, 0.62);
  }
}

.brand-foot {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

/* ---------- 表单侧 ---------- */
.auth-login-page__main {
  flex: 1 1 48%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
}

.auth-login-page__card {
  width: 100%;
  max-width: 408px;
  padding: 34px 32px 30px;
  background: var(--lp-surface);
  border: 1px solid var(--lp-border);
  border-radius: 18px;
  box-shadow: var(--lp-shadow);
  animation: rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* 居中布局（无品牌侧）：整页铺渐变 */
.is-centered {
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, var(--lp-brand-from) 0%, var(--lp-brand-to) 100%);
}

/* ---------- 深色 ---------- */
.is-dark {
  --lp-bg: #14171d;
  --lp-surface: #1b1f27;
  --lp-text: #e6eaf0;
  --lp-text-2: #a3adbd;
  --lp-text-3: #6f7a8a;
  --lp-border: #2c333f;
  --lp-input-bg: #21262f;
  --lp-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
}

/* ---------- 组件内部（LoginPanel）皮肤 ---------- */
.auth-login-page :deep(.auth-login-panel) {
  max-width: none;
  padding: 0;
  background: transparent;
  box-shadow: none;
}

.auth-login-page :deep(.login-icon) {
  width: 52px;
  height: 52px;
  margin-bottom: 12px;
  border-radius: 14px;
}

.auth-login-page :deep(.login-title) {
  font-size: 20px;
  color: var(--lp-text);
}

.auth-login-page :deep(.login-subtitle) {
  color: var(--lp-text-3);
}

.auth-login-page :deep(.login-header) {
  margin-bottom: 24px;
}

.auth-login-page :deep(.el-form-item) {
  margin-bottom: 18px;
}

.auth-login-page :deep(.el-input__wrapper) {
  height: 44px;
  border-radius: 10px;
  background: var(--lp-input-bg);
  box-shadow: 0 0 0 1px var(--lp-border) inset;
  transition: box-shadow 0.16s ease, background-color 0.16s ease;
}

.auth-login-page :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--lp-accent) 45%, transparent) inset;
}

.auth-login-page :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--lp-accent) inset,
    0 0 0 3px color-mix(in srgb, var(--lp-accent) 16%, transparent);
}

.auth-login-page :deep(.el-input__inner) {
  color: var(--lp-text);
  font-size: 14px;
}

/* 主按钮：品牌渐变 + 微交互 */
.auth-login-page :deep(.login-btn) {
  height: 44px;
  margin-top: 2px;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 2px;
  color: #fff;
  background: linear-gradient(
    135deg,
    var(--lp-accent) 0%,
    color-mix(in srgb, var(--lp-accent) 72%, #101433) 100%
  );
  box-shadow: 0 6px 18px color-mix(in srgb, var(--lp-accent) 32%, transparent);
  transition: transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease;
}

.auth-login-page :deep(.login-btn:hover) {
  transform: translateY(-1px);
  filter: brightness(1.06);
  box-shadow: 0 10px 24px color-mix(in srgb, var(--lp-accent) 40%, transparent);
}

.auth-login-page :deep(.login-btn:active) {
  transform: translateY(0);
}

/* SSO 按钮：次级描边，弱化视觉层级 */
.auth-login-page :deep(.sso-btn) {
  height: 42px;
  width: 100%;
  border-radius: 10px;
  font-weight: 500;
  background: transparent;
  color: var(--lp-text-2);
  border: 1px solid var(--lp-border);
  transition: all 0.16s ease;
}

.auth-login-page :deep(.sso-btn:hover) {
  color: var(--lp-accent);
  border-color: color-mix(in srgb, var(--lp-accent) 50%, transparent);
  background: color-mix(in srgb, var(--lp-accent) 7%, transparent);
}

.auth-login-page :deep(.el-divider__text) {
  background: var(--lp-surface);
  color: var(--lp-text-3);
  font-size: 12px;
}

.auth-login-page :deep(.el-divider) {
  border-color: var(--lp-border);
  margin: 20px 0 18px;
}

.auth-login-page :deep(.forgot-link) {
  color: var(--lp-text-2);
  transition: color 0.16s ease;
}

.auth-login-page :deep(.forgot-link:hover) {
  color: var(--lp-accent);
  text-decoration: none;
}

.auth-login-page :deep(.back-to-login a) {
  color: var(--lp-text-3);
}

.auth-login-page :deep(.error-msg) {
  background: color-mix(in srgb, #f56c6c 10%, transparent);
  border-color: color-mix(in srgb, #f56c6c 32%, transparent);
  color: #f56c6c;
}

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .auth-login-page__brand {
    display: none;
  }

  .auth-login-page__main {
    flex: 1;
    background: linear-gradient(160deg, var(--lp-brand-from) 0%, var(--lp-brand-to) 100%);
    padding: 32px 18px;
  }
}

@keyframes aurora {
  0% {
    transform: translate3d(0, 0, 0) scale(1);
  }

  100% {
    transform: translate3d(-3%, 2%, 0) scale(1.08);
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .brand-aurora,
  .auth-login-page__card {
    animation: none;
  }
}
</style>
