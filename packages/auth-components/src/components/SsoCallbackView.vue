<template>
  <div class="sso-callback" :style="{ background: background || 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)' }">
    <div class="loading-container">
      <el-icon class="loading-icon" :size="48"><Loading /></el-icon>
      <p>{{ loadingText || 'SSO 登录中，请稍候...' }}</p>
    </div>
    <div v-if="error" class="error-box">
      <p>{{ error }}</p>
      <a class="back-link" href="/login">返回登录页</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import type { SsoConfig } from '../types'
import { handleSsoCallback } from '../utils/sso'
import { setToken, getToken, decodeOidcClaims } from '../utils/token'

const props = defineProps<{
  config: SsoConfig
  /** 自定义背景样式 */
  background?: string
  /** 加载提示文字 */
  loadingText?: string
  /** 成功后的回调，返回目标路径 */
  onSuccess?: (redirect: string) => void
  /** 失败后的回调 */
  onError?: (error: Error) => void
}>()

const emit = defineEmits<{
  (e: 'success', redirect: string): void
  (e: 'error', error: Error): void
}>()

const router = useRouter()
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const redirect = await handleSsoCallback(
      props.config,
      new URLSearchParams(window.location.search)
    )

    // 尝试解析用户信息
    const token = getToken()
    if (token) {
      const claims = decodeOidcClaims(token)
      if (claims.username || claims.preferred_username) {
        localStorage.setItem('auth_user', claims.username || claims.preferred_username || '')
      }
    }

    ElMessage.success('SSO 登录成功')
    
    if (props.onSuccess) {
      props.onSuccess(redirect)
    }
    emit('success', redirect)
    
    // 默认行为：跳转到目标页面
    router.push(redirect)
  } catch (e: any) {
    error.value = e?.message || 'SSO 登录失败'
    
    if (props.onError) {
      props.onError(e)
    }
    emit('error', e)
    
    // 3秒后自动跳转回登录页
    setTimeout(() => {
      router.push('/login')
    }, 3000)
  }
})
</script>

<style scoped lang="scss">
.sso-callback {
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-container {
  text-align: center;
  color: #fff;

  .loading-icon {
    animation: spin 1.5s linear infinite;
  }

  p {
    margin-top: 16px;
    font-size: 16px;
  }
}

.error-box {
  margin-top: 24px;
  padding: 20px 28px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  text-align: center;
  color: #dc2626;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);

  p {
    margin: 0 0 12px;
    font-size: 14px;
  }

  .back-link {
    color: var(--accent, #409eff);
    text-decoration: none;
    font-size: 14px;

    &:hover {
      text-decoration: underline;
    }
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
