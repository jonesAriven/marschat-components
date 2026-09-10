import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'

/**
 * lib 模式默认把 CSS 抽成 dist/style.css，但不会在 JS 里 import 它
 * → 使用方不手动引样式，组件就是「裸」的（0.2.0 各应用正是这个坑）。
 * 这里在 ES 产物顶部自动补一行 import './style.css'，做到开箱即用。
 */
function injectStyleImport(): Plugin {
  return {
    name: 'inject-style-import',
    apply: 'build',
    closeBundle() {
      const file = resolve(__dirname, 'dist/marschat-auth-components.es.js')
      let code = readFileSync(file, 'utf8')
      if (!code.includes("import './style.css'")) {
        code = `import './style.css';\n${code}`
        writeFileSync(file, code)
      }
    },
  }
}

export default defineConfig({
  plugins: [vue(), injectStyleImport()],
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
