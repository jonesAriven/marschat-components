<template>
  <div class="auth-login-panel" :style="{ '--accent': config.color || '#409eff' }">
    <div class="login-header">
      <div class="login-icon" v-if="config.icon">
        <el-icon :size="48" :color="config.color || '#409eff'">
          <component :is="typeof config.icon === 'string' ? config.icon : config.icon" />
        </el-icon>
      </div>
      <h2 class="login-title">{{ config.title }}</h2>
      <p v-if="config.subtitle" class="login-subtitle">{{ config.subtitle }}</p>
    </div>

    <!-- 独立登录表单 -->
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="0"
      size="large"
      @keyup.enter="handleLogin"
    >
      <el-form-item prop="username">
        <el-input
          v-model="form.username"
          :placeholder="labels.usernamePlaceholder"
          :prefix-icon="User"
        />
      </el-form-item>
      <el-form-item prop="password">
        <el-input
          v-model="form.password"
          type="password"
          :placeholder="labels.passwordPlaceholder"
          :prefix-icon="Lock"
          show-password
        />
      </el-form-item>

      <!-- 忘记密码链接 -->
      <div v-if="config.showForgotPassword !== false" class="forgot-line">
        <a
          class="forgot-link"
          :href="config.forgotPasswordUrl || 'https://auth.marschat.online/forgot-password.html'"
          target="_blank"
          rel="noopener"
        >
          {{ labels.forgotPasswordText }}
        </a>
      </div>

      <el-form-item>
        <el-button
          type="primary"
          :loading="loading"
          class="login-btn"
          @click="handleLogin"
        >
          {{ labels.loginButtonText }}
        </el-button>
      </el-form-item>
    </el-form>

    <!-- SSO 分隔线与按钮 -->
    <template v-if="config.showSso !== false && config.ssoConfig">
      <el-divider content-position="center">{{ labels.dividerText }}</el-divider>
      <el-button
        type="success"
        class="sso-btn"
        :loading="ssoLoading"
        @click="handleSsoLogin"
      >
        <el-icon><Connection /></el-icon>
        {{ labels.ssoButtonText }}
      </el-button>
    </template>

    <!-- 错误提示 -->
    <div v-if="error" class="error-msg">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { User, Lock, Connection } from '@element-plus/icons-vue'
import type { LoginPanelConfig, LoginPanelLabels } from '../types'
import { startSsoLogin } from '../utils/sso'

const props = defineProps<{
  config: LoginPanelConfig
}>()

const emit = defineEmits<{
  (e: 'login', credentials: { username: string; password: string }): void
  (e: 'sso-login'): void
}>()

/** 默认文案 */
const defaultLabels: Required<LoginPanelLabels> = {
  usernamePlaceholder: '用户名',
  passwordPlaceholder: '密码',
  loginButtonText: '登 录',
  ssoButtonText: '统一认证登录 (SSO)',
  forgotPasswordText: '忘记密码？',
  dividerText: '或',
  successMessage: '登录成功',
  loginFailedMessage: '登录失败，请检查用户名或密码',
  ssoNotConfiguredMessage: 'SSO 未配置',
  ssoFailedMessage: 'SSO 登录发起失败',
}

/** 合并默认文案和自定义文案 */
const labels = computed<Required<LoginPanelLabels>>(() => ({
  ...defaultLabels,
  ...props.config.labels,
}))

const formRef = ref<FormInstance>()
const loading = ref(false)
const ssoLoading = ref(false)
const error = ref<string | null>(null)

const form = reactive({
  username: '',
  password: '',
})

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  error.value = null

  try {
    if (props.config.onLogin) {
      await props.config.onLogin({ username: form.username, password: form.password })
    }
    emit('login', { username: form.username, password: form.password })
    ElMessage.success(labels.value.successMessage)
  } catch (e: any) {
    error.value = e?.message || labels.value.loginFailedMessage
  } finally {
    loading.value = false
  }
}

async function handleSsoLogin() {
  if (!props.config.ssoConfig) {
    error.value = labels.value.ssoNotConfiguredMessage
    return
  }

  ssoLoading.value = true
  error.value = null

  try {
    if (props.config.onSsoLogin) {
      props.config.onSsoLogin()
    } else {
      // 默认 SSO 行为：跳转到授权端点
      await startSsoLogin(props.config.ssoConfig)
    }
    emit('sso-login')
  } catch (e: any) {
    error.value = e?.message || labels.value.ssoFailedMessage
    ssoLoading.value = false
  }
}

// 暴露方法供外部调用
defineExpose({
  setError: (msg: string) => { error.value = msg },
  clearError: () => { error.value = null },
})
</script>

<style scoped lang="scss">
.auth-login-panel {
  width: 100%;
  max-width: 400px;
  padding: 32px 24px;
  background-color: #fff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
}

.login-header {
  text-align: center;
  margin-bottom: 28px;
}

.login-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 14px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-title {
  font-size: 22px;
  font-weight: 700;
  color: #303133;
  margin: 0 0 6px;
}

.login-subtitle {
  font-size: 13px;
  color: #909399;
  margin: 0;
}

.login-btn {
  width: 100%;
}

.sso-btn {
  width: 100%;
}

.forgot-line {
  display: flex;
  justify-content: flex-end;
  margin: -8px 0 14px;
}

.forgot-link {
  font-size: 13px;
  color: var(--accent, #409eff);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.error-msg {
  margin-top: 14px;
  padding: 10px 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #dc2626;
  font-size: 13px;
  text-align: center;
}
</style>
