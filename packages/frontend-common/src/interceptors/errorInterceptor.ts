/**
 * 错误拦截器
 * 统一错误处理和展示
 */

export interface ErrorInterceptorOptions {
  /** 是否显示详细错误（生产环境可关闭） */
  showDetail?: boolean
  /** 自定义错误处理 */
  onError?: (message: string, error: any, isAxiosError?: boolean) => void
  /** ElMessage 调用开关 */
  useElMessage?: boolean
}

/**
 * 创建错误拦截器配置
 */
export function createErrorInterceptor(options: ErrorInterceptorOptions = {}) {
  const { showDetail = true, useElMessage = true, onError } = options

  return {
    async responseError(error: any) {
      const status = error.response?.status
      const data = error.response?.data
      
      let msg = '请求失败'
      if (data) {
        msg = data.message || data.msg || JSON.stringify(data)
      } else if (error.message) {
        msg = error.message
      }

      if (onError) {
        onError(msg, error, error?.isAxiosError || false)
      }
      
      if (useElMessage) {
        // 动态导入避免 SSR 问题
        const { ElMessage } = await import('element-plus')
        ElMessage.error(msg)
      }
      
      return true // 已处理
    }
  }
}
