import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'MarsChatAuthComponents',
      formats: ['es', 'umd'],
      fileName: (format) => format === 'es' ? 'marschat-auth-components.es.js' : 'marschat-auth-components.umd.cjs',
    },
    rollupOptions: {
      external: ['vue', 'element-plus', 'element-plus/icons-vue'],
      output: {
        globals: {
          vue: 'Vue',
          'element-plus': 'elementPlus',
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
