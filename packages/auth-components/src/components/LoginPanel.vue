<template>
  <div class="auth-login-panel" :style="{ '--accent': config.color || '#409eff' }">
    <!-- 登录模式 -->
    <template v-if="!isForgotPassword">
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
          <a class="forgot-link" @click.prevent="startForgotPassword">
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
    </template>

    <!-- 忘记密码模式 -->
    <template v-else>
      <div class="login-header">
        <h2 class="login-title">{{ labels.forgotPasswordTitle }}</h2>
        <p class="login-subtitle">{{ forgotStepLabels[forgotStep] }}</p>
      </div>

      <!-- 步骤1: 输入邮箱 -->
      <el-form
        v-if="forgotStep === 'email'"
        ref="emailFormRef"
        :model="forgotForm"
        :rules="emailRules"
        label-width="0"
        size="large"
        @keyup.enter="handleSendCode"
      >
        <el-form-item prop="email">
          <el-input
            v-model="forgotForm.email"
            :placeholder="labels.emailPlaceholder"
            :prefix-icon="Message"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="codeSending"
            class="login-btn"
            @click="handleSendCode"
          >
            {{ labels.sendCodeText }}
          </el-button>
        </el-form-item>
        <div class="back-to-login">
          <a @click.prevent="cancelForgotPassword">{{ labels.backToLoginText }}</a>
        </div>
      </el-form>

      <!-- 步骤2: 输入验证码 -->
      <el-form
        v-else-if="forgotStep === 'verify'"
        ref="verifyFormRef"
        :model="forgotForm"
        :rules="codeRules"
        label-width="0"
        size="large"
        @keyup.enter="handleVerifyCode"
      >
        <el-form-item prop="code">
          <div class="code-input-wrapper">
            <el-input
              v-model="forgotForm.code"
              :placeholder="labels.codePlaceholder"
              :prefix-icon="Key"
              maxlength="6"
            />
            <el-button
              type="primary"
              :disabled="countdown > 0"
              :loading="codeSending"
              class="resend-btn"
              @click="handleResendCode"
            >
              {{ countdown > 0 ? `${countdown}s` : labels.resendCodeText }}
            </el-button>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="verifying"
            class="login-btn"
            @click="handleVerifyCode"
          >
            {{ labels.verifyCodeText }}
          </el-button>
        </el-form-item>
        <div class="back-to-login">
          <a @click.prevent="cancelForgotPassword">{{ labels.backToLoginText }}</a>
        </div>
      </el-form>

      <!-- 步骤3: 重置密码 -->
      <el-form
        v-else-if="forgotStep === 'reset'"
        ref="resetFormRef"
        :model="forgotForm"
        :rules="passwordRules"
        label-width="0"
        size="large"
        @keyup.enter="handleResetPassword"
      >
        <el-form-item prop="newPassword">
          <el-input
            v-model="forgotForm.newPassword"
            type="password"
            :placeholder="labels.newPasswordPlaceholder"
            :prefix-icon="Lock"
            show-password
          />
        </el-form-item>
        <el-form-item prop="confirmPassword">
          <el-input
            v-model="forgotForm.confirmPassword"
            type="password"
            :placeholder="labels.confirmPasswordPlaceholder"
            :prefix-icon="Lock"
            show-password
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="resetting"
            class="login-btn"
            @click="handleResetPassword"
          >
            {{ labels.resetPasswordText }}
          </el-button>
        </el-form-item>
        <div class="back-to-login">
          <a @click.prevent="cancelForgotPassword">{{ labels.backToLoginText }}</a>
        </div>
      </el-form>

      <!-- 步骤4: 成功 -->
      <div v-else-if="forgotStep === 'success'" class="success-container">
        <el-icon :size="64" color="#67c23a"><CircleCheckFilled /></el-icon>
        <p class="success-text">{{ labels.passwordResetSuccessText }}</p>
        <el-button type="primary" class="login-btn" @click="cancelForgotPassword">
          {{ labels.backToLoginText }}
        </el-button>
      </div>
    </template>

    <!-- 错误提示 -->
    <div v-if="error" class="error-msg">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { User, Lock, Connection, Message, Key, CircleCheckFilled } from '@element-plus/icons-vue'
import type {
  LoginPanelConfig,
  LoginPanelLabels,
  ForgotPasswordStep,
  SendCodeResponse,
} from '../types'
import { startSsoLogin } from '../utils/sso'

const props = defineProps<{
  config: LoginPanelConfig
}>()

const emit = defineEmits<{
  (e: 'login', credentials: { username: string; password: string }): void
  (e: 'sso-login'): void
  (e: 'password-reset'): void
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
  // 忘记密码相关文案
  forgotPasswordTitle: '忘记密码',
  emailPlaceholder: '请输入注册邮箱',
  sendCodeText: '发送验证码',
  codePlaceholder: '请输入验证码',
  resendCodeText: '重新发送',
  verifyCodeText: '验证',
  newPasswordPlaceholder: '请输入新密码',
  confirmPasswordPlaceholder: '请再次输入新密码',
  resetPasswordText: '重置密码',
  passwordResetSuccessText: '密码重置成功！请使用新密码登录',
  backToLoginText: '返回登录',
}

/** 合并默认文案和自定义文案 */
const labels = computed<Required<LoginPanelLabels>>(() => ({
  ...defaultLabels,
  ...props.config.labels,
}))

/** 忘记密码步骤提示 */
const forgotStepLabels: Record<ForgotPasswordStep, string> = {
  email: '请输入您的注册邮箱，我们将发送验证码',
  verify: '验证码已发送，请查收邮件',
  reset: '请设置您的新密码',
  success: '',
}

// ========== 登录表单 ==========
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

// ========== 忘记密码状态 ==========
const isForgotPassword = ref(false)
const forgotStep = ref<ForgotPasswordStep>('email')
const emailFormRef = ref<FormInstance>()
const verifyFormRef = ref<FormInstance>()
const resetFormRef = ref<FormInstance>()
const codeSending = ref(false)
const verifying = ref(false)
const resetting = ref(false)
const countdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null

const forgotForm = reactive({
  email: '',
  code: '',
  newPassword: '',
  confirmPassword: '',
})

const emailRules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' },
  ],
}

const codeRules: FormRules = {
  code: [
    { required: true, message: '请输入验证码', trigger: 'blur' },
    { len: 6, message: '验证码为6位数字', trigger: 'blur' },
  ],
}

const validateConfirmPassword = (_rule: any, value: string, callback: any) => {
  if (value !== forgotForm.newPassword) {
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const passwordRules: FormRules = {
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, max: 32, message: '密码长度为6-32位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' },
  ],
}

// ========== 登录方法 ==========
async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  error.value = null

  try {
    if (props.config.onLogin) {
      // 组件托管模式：onLogin 成功才弹成功提示，失败走 catch
      await props.config.onLogin({ username: form.username, password: form.password })
      ElMessage.success(labels.value.successMessage)
    }
    // 事件模式：结果由应用自行处理（emit 无法等待，不能代弹成功提示，
    // 否则应用侧登录失败时会出现「登录成功 + 登录失败」双 toast 的假象）
    emit('login', { username: form.username, password: form.password })
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

// ========== 忘记密码方法 ==========
function startForgotPassword() {
  isForgotPassword.value = true
  forgotStep.value = 'email'
  error.value = null
  // 重置表单
  forgotForm.email = ''
  forgotForm.code = ''
  forgotForm.newPassword = ''
  forgotForm.confirmPassword = ''
}

function cancelForgotPassword() {
  isForgotPassword.value = false
  forgotStep.value = 'email'
  error.value = null
  stopCountdown()
}

async function handleSendCode() {
  const valid = await emailFormRef.value?.validate().catch(() => false)
  if (!valid) return

  codeSending.value = true
  error.value = null

  try {
    let response: SendCodeResponse
    if (props.config.onSendCode) {
      response = await props.config.onSendCode(forgotForm.email)
    } else {
      // 默认实现：调用 auth-center 接口
      response = await defaultSendCode(forgotForm.email)
    }

    if (response.success) {
      ElMessage.success('验证码已发送')
      forgotStep.value = 'verify'
      startCountdown(response.expiresIn || 60)
    } else {
      error.value = response.message || '发送验证码失败'
    }
  } catch (e: any) {
    error.value = e?.message || '发送验证码失败'
  } finally {
    codeSending.value = false
  }
}

async function handleResendCode() {
  await handleSendCode()
}

async function handleVerifyCode() {
  const valid = await verifyFormRef.value?.validate().catch(() => false)
  if (!valid) return

  verifying.value = true
  error.value = null

  try {
    let isValid = false
    if (props.config.onVerifyCode) {
      isValid = await props.config.onVerifyCode(forgotForm.email, forgotForm.code)
    } else {
      // 默认实现：调用 auth-center 接口
      isValid = await defaultVerifyCode(forgotForm.email, forgotForm.code)
    }

    if (isValid) {
      forgotStep.value = 'reset'
    } else {
      error.value = '验证码错误或已过期'
    }
  } catch (e: any) {
    error.value = e?.message || '验证失败'
  } finally {
    verifying.value = false
  }
}

async function handleResetPassword() {
  const valid = await resetFormRef.value?.validate().catch(() => false)
  if (!valid) return

  resetting.value = true
  error.value = null

  try {
    if (props.config.onResetPassword) {
      await props.config.onResetPassword({
        email: forgotForm.email,
        code: forgotForm.code,
        newPassword: forgotForm.newPassword,
      })
    } else {
      // 默认实现：调用 auth-center 接口
      await defaultResetPassword({
        email: forgotForm.email,
        code: forgotForm.code,
        newPassword: forgotForm.newPassword,
      })
    }

    forgotStep.value = 'success'
    emit('password-reset')
    ElMessage.success(labels.value.passwordResetSuccessText)
  } catch (e: any) {
    error.value = e?.message || '重置密码失败'
  } finally {
    resetting.value = false
  }
}

// ========== 倒计时 ==========
function startCountdown(seconds: number) {
  countdown.value = seconds
  stopCountdown()
  countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      stopCountdown()
    }
  }, 1000)
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  countdown.value = 0
}

// ========== 默认 API 调用（可被 onSendCode/onVerifyCode/onResetPassword 覆盖）==========
/**
 * 认证接口基地址默认值。各应用应通过 config.authApiBase 覆盖为自己域名下的 nginx 前缀。
 */
const DEFAULT_AUTH_API_BASE = '/kb/api/auth'

function authApiUrl(path: string): string {
  const base = (props.config.authApiBase || DEFAULT_AUTH_API_BASE).replace(/\/+$/, '')
  return `${base}${path}`
}

/**
 * 统一调用 auth-center 接口并解析 Result 信封：`{code, message, data, traceId}`。
 *
 * ⚠️ 本系统统一约定：**业务异常同样返回 HTTP 200**，真正的错误码在 `body.code`。
 * 因此必须同时校验 `response.ok` 与 `body.code === 200`，只看 HTTP 状态码会把
 * 「验证码错误」这类业务失败误判为成功。
 */
async function callAuthApi<T = unknown>(url: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('网络异常，请稍后重试')
  }

  if (!response.ok) {
    throw new Error(`请求失败（HTTP ${response.status}）`)
  }

  let payload: any
  try {
    payload = await response.json()
  } catch {
    throw new Error('服务响应格式异常')
  }

  if (payload && typeof payload.code === 'number' && payload.code !== 200) {
    throw new Error(payload.message || '操作失败')
  }

  return (payload?.data ?? payload) as T
}

async function defaultSendCode(email: string): Promise<SendCodeResponse> {
  await callAuthApi(authApiUrl('/forgot-password'), { email })
  return { success: true, message: '验证码已发送', expiresIn: 60 }
}

/**
 * 后端（auth-center）**没有独立的验证码预校验端点**，验证码的真实校验发生在
 * `/reset-password` 内部。因此此处仅做本地放行，把验证码带到下一步；
 * 验证码是否正确以最终「重置密码」的返回结果为准。
 */
async function defaultVerifyCode(_email: string, code: string): Promise<boolean> {
  return !!code
}

async function defaultResetPassword(data: { email: string; code: string; newPassword: string }): Promise<void> {
  await callAuthApi(authApiUrl('/reset-password'), data)
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
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.back-to-login {
  text-align: center;
  margin-top: 12px;

  a {
    font-size: 13px;
    color: #909399;
    text-decoration: none;
    cursor: pointer;

    &:hover {
      color: var(--accent, #409eff);
    }
  }
}

.code-input-wrapper {
  display: flex;
  gap: 10px;
  width: 100%;

  .el-input {
    flex: 1;
  }

  .resend-btn {
    width: 120px;
    flex-shrink: 0;
  }
}

.success-container {
  text-align: center;
  padding: 20px 0;

  .success-text {
    margin: 16px 0 24px;
    font-size: 15px;
    color: #606266;
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
