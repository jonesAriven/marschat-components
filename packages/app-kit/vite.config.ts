import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MarsChatAppKit',
      formats: ['es', 'umd'],
      fileName: (format) =>
        format === 'es' ? 'marschat-app-kit.es.js' : 'marschat-app-kit.umd.cjs',
    },
    rollupOptions: {
      // 全部运行时依赖保持外部：接入方项目里已有一份，重复打包会造成
      // 「同一份令牌状态被两套模块实例持有」这类最难查的 bug。
      external: [
        'vue',
        'element-plus',
        'element-plus/icons-vue',
        '@marschat/auth-components',
        '@marschat/frontend-common',
      ],
      output: {
        globals: {
          vue: 'Vue',
          'element-plus': 'elementPlus',
          '@marschat/auth-components': 'MarsChatAuthComponents',
          '@marschat/frontend-common': 'MarsChatFrontendCommon',
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
