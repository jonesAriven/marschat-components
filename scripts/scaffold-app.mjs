#!/usr/bin/env node
/**
 * 接入脚手架 —— 为**新增应用**生成「引入组件 + 少量配置即可接入登录与用户管理」的骨架。
 *
 * 用法：
 *   node scripts/scaffold-app.mjs --app-id marschat-demo --context-path /demo --out ./tmp/demo
 *
 * 生成物（前端 4 个文件 + 后端 2 个文件，全部是**配置与薄装配**，无业务逻辑）：
 *   <out>/src/main.ts                     一行装配（createMarschatApp）
 *   <out>/src/menus.ts                    菜单定义（唯一的业务数据）
 *   <out>/src/App.vue                     共享外壳（marschat.createShell）
 *   <out>/public/app-config.json          运行时配置占位（正式由 gen-from-registry.py 生成）
 *   <out>/backend/bff-whitelist.yml       后端 BFF 白名单（默认拒绝）
 *   <out>/backend/application-snippet.yml 后端配置片段
 *   <out>/README.md                       下一步清单
 *
 * 设计原则：生成的是**声明式配置 + 一行调用**，不是可复制的实现代码 ——
 * 这样「接入质量」不再取决于抄得全不全（历史事故：kb-web / infra 的 permissions.ts 双前缀漂移）。
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
      out[key] = val
    }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const appId = args['app-id']
if (!appId) {
  console.error('缺少 --app-id（应为 apps-registry.yml 的 client-id，如 marschat-demo）')
  process.exit(1)
}

const contextPath = (() => {
  let p = (args['context-path'] ?? `/${appId.replace(/^marschat-/, '')}`).trim()
  if (!p.startsWith('/')) p = '/' + p
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)
  return p
})()
const appName = args.name ?? appId
const outDir = resolve(args.out ?? `./scaffold-out/${appId}`)
const tokenPrefix = args['token-prefix'] ?? `${appId.replace(/^marschat-/, '').replace(/[^a-zA-Z0-9]+/g, '_')}_`
const base = contextPath === '/' ? '' : contextPath

function write(rel, content) {
  const file = join(outDir, rel)
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file) && args.force !== 'true') {
    console.log(`  跳过（已存在，加 --force 覆盖）：${rel}`)
    return
  }
  writeFileSync(file, content, 'utf8')
  console.log(`  ✓ ${rel}`)
}

console.log(`\n生成应用接入骨架：${appId}`)
console.log(`  部署前缀 ${contextPath}   输出目录 ${outDir}\n`)

write('src/marschat.ts', `/**
 * 应用接入实例 —— 单独成模块，便于 App.vue 取用共享外壳（避免全局挂载的隐式耦合）。
 */
import { createMarschatApp } from '@marschat/app-kit'
import router from './router'
import { menus } from './menus'

export const marschat = createMarschatApp({
  appId: '${appId}',
  router,
  menus,
  // 存量应用迁移时传入旧令牌键前缀，保证老用户登录态不丢：
  tokenKeyPrefix: '${tokenPrefix}',
})
`)

write('src/main.ts', `/**
 * 应用入口 —— 接入统一登录与用户管理的**全部前端代码**。
 * 其余（运行时配置 / 令牌 / SSO / 401 续期 / 路由守卫 / 会话监视 / 权限预取）由 app-kit 负责。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import App from './App.vue'
import { marschat } from './marschat'

const app = createApp(App)

app.use(createPinia())
marschat.install(app)          // 内部按正确顺序挂 router（守卫已先注册）
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')

marschat.bootstrap()           // 会话监视 + 权限预取
`)

write('src/menus.ts', `/**
 * 菜单定义 —— 本应用**唯一必须手写的业务数据**。
 * key 必须与后端 menu-registry.yml 的 key 严格一致（前端渲染 + 权限点对齐）。
 */
import type { MenuItemDef } from '@marschat/auth-components'

export const menus: MenuItemDef[] = [
  { key: 'dashboard', title: '工作台', icon: 'Grid', path: '/dashboard', order: 1, skipPerm: true },
  { key: 'users', title: '本系统用户', icon: 'UserFilled', path: '/users', order: 2 },
]
`)

write('src/App.vue', `<script setup lang="ts">
import { marschat } from './marschat'

// 共享外壳：侧边栏（按权限过滤菜单）+ 顶栏（用户名 / 退出登录）+ 内容区
// 需要换肤时改 CSS 变量即可，不要各自重写外壳结构（历史教训：三套 MainLayout 漂移）
const Shell = marschat.createShell()
</script>

<template>
  <component :is="Shell" />
</template>
`)

write('public/app-config.json', `{
  "_generated": "# 占位文件 —— 正式内容由 devtools: python scripts/gen-from-registry.py 生成，勿手工编辑",
  "clientId": "${appId}",
  "issuer": "https://auth.marschat.online",
  "contextPath": "${contextPath}",
  "apiBase": "${base}/api"
}
`)

write('backend/bff-whitelist.yml', `# 应用侧管理代理白名单（默认拒绝）—— 新增中心端点必须在此显式登记，否则 404。
# 语义与字段说明见 auth-core jar 内 META-INF/marschat/bff-whitelist.template.yml
client-id: ${appId}

rules:
  - path: /admin/clients/{clientId}/**
    client-in-path: true
  - path: /admin/users
    methods: [GET]
    require-client-scope: true
  - path: /admin/users/{id}/client-roles
    methods: [GET, PUT]
    require-client-scope: true
  - path: /admin/users/{id}/menu-overrides
    methods: [GET, PUT]
    require-client-scope: true
  - path: /admin/roles
    methods: [GET]
`)

write('backend/application-snippet.yml', `# 追加到本应用 application.yml —— 后端接入用户管理的**全部配置**
marschat:
  oidc:
    issuer: https://auth.marschat.online           # 与签发端逐字一致
    jwks-uri: http://auth-center:8085/oauth2/jwks  # JWKS 走内网
  menu:
    report:
      enabled: true
      client-id: ${appId}
      issuer: http://auth-center:8085
      report-secret: \${MARSCHAT_MENU_REPORT_SECRET:}
  bff:
    enabled: true                                  # 打开即装配管理代理（白名单见 bff-whitelist.yml）
    client-id: ${appId}
    auth-center-base: http://auth-center:8085
    path-prefix: ${base}/api/admin
    credential-mode: passthrough                   # 纯 SSO 应用用 passthrough；账密换票用 session-store
    report-secret: \${MARSCHAT_MENU_REPORT_SECRET:}
`)

write('README.md', `# ${appName} 接入说明（由 scaffold-app.mjs 生成）

## 1 依赖

\`\`\`bash
pnpm add @marschat/app-kit
\`\`\`
（后端）\`com.marschat:auth-core\` + \`com.marschat:common-core\`。

## 2 注册进平台（唯一手工编辑点）

在 \`devtools/apps-registry.yml\` 增加：

\`\`\`yaml
  - client-id: ${appId}
    name: ${appName}
    type: public
    menu-report-secret: \${${appId.replace(/^marschat-/, '').toUpperCase()}_MENU_REPORT_SECRET:}
    auth:
      redirect-uris:
        - https://<域名>${base}/sso-callback
        - http://localhost:5173${base}/sso-callback
      post-logout-redirect-uris:
        - https://<域名>${base}/login
    frontend:
      entry: https://<域名>${base}/
      context-path: ${contextPath}
      api-base: ${base}/api
\`\`\`

然后：\`cd devtools && python scripts/gen-from-registry.py\`

## 3 后端

把 \`backend/bff-whitelist.yml\` 放到本应用 \`src/main/resources/\`，
把 \`backend/application-snippet.yml\` 的内容并入 \`application.yml\`。

## 4 前端

\`src/main.ts\` 已是一行装配；把 \`src/menus.ts\` 的菜单改成真实菜单，
并在 \`menu-registry.yml\` 里同步同样的 key（两处 key 必须一致）。

## 5 验收清单

- [ ] SSO 免登：口令输入次数 == 1，跨应用免登
- [ ] 账密 / 邮箱码 / 忘记密码三条通道
- [ ] 用户管理页可见且**无**「新建用户 / 重置密码 / 删除身份」（应用侧应只有成员视角）
- [ ] Network 中无跨域直连 auth-center \`/admin/**\` 的请求
- [ ] 接口闸门三态：200 / 403 / 401
- [ ] SLO 联动：别处登出后本应用被请出
`)

console.log(`\n完成。下一步见 ${join(outDir, 'README.md')}\n`)
