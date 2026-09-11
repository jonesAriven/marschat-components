import { defineConfig } from 'vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

/**
 * 独立构建：框架无关的认证 SDK（UMD 单文件）
 *
 * 产物 `dist/marschat-auth-core.umd.js` 是**自包含**的：
 * 不 external 任何依赖（连 vue 都不需要），可直接被静态 HTML 用
 * `<script src="...">` 引入，暴露全局 `window.MarschatAuth`。
 *
 * 目标用户：activation-code 这类「有后端、无前端构建链」的应用。
 *
 * 用法：pnpm --filter @marschat/auth-components build:umd
 */
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8')
) as { version: string }

export default defineConfig({
  define: {
    __AUTH_CORE_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false, // 不能清空 —— ES 产物与 d.ts 由主构建产出
    lib: {
      entry: resolve(__dirname, 'src/umd.ts'),
      name: 'MarschatAuth',
      formats: ['umd'],
      fileName: () => 'marschat-auth-core.umd.js',
    },
    // 什么都不 external：保证单文件自包含、零依赖
    rollupOptions: {
      external: [],
      output: {
        // 强制 named 导出模式 —— 否则 <script> 用户要写 MarschatAuth.default.createSsoClient(...)
        exports: 'named',
      },
    },
    // 静态页直接读源码，保留可读性便于线上排障
    minify: false,
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
