import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MarschatFrontendCommon',
      formats: ['es', 'umd'],
      fileName: (format) => format === 'es' ? 'marschat-frontend-common.es.js' : 'marschat-frontend-common.umd.cjs',
    },
    rollupOptions: {
      external: ['vue', 'element-plus', 'axios', '@vueuse/core'],
      output: { globals: { vue: 'Vue' } },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
