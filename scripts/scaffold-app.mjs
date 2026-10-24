#!/usr/bin/env node
/**
 * 接入脚手架 —— 为**新增应用**生成「引入组件 + 少量配置即可接入登录与用户管理」的骨架。
 *
 * 用法：
 *   node scripts/scaffold-app.mjs --app-id marschat-demo --context-path /demo --out ./tmp/demo
 *
 * 生成物（前端 7 个文件 + 后端 3 个文件，全部是**配置与薄装配**，无业务逻辑）：
 *   <out>/src/marschat.ts                 一行装配（createMarschatApp）
 *   <out>/src/main.ts                     应用入口（install + bootstrap 顺序）
 *   <out>/src/router.ts                   最小路由（含 homePath 落地页，缺它会静默空白页）
 *   <out>/src/views/Dashboard.vue          落地页占位组件
 *   <out>/src/menus.ts                    菜单定义（唯一的业务数据）
 *   <out>/src/App.vue                     共享外壳（marschat.createShell）
 *   <out>/public/app-config.json          运行时配置占位（正式由 gen-from-registry.py 生成）
 *   <out>/backend/bff-whitelist.yml       后端 BFF 白名单（默认拒绝）
 *   <out>/backend/menu-registry.yml       菜单 / api 权限点上报（strict 下缺它菜单全空）
 *   <out>/backend/application-snippet.yml 后端配置片段（OIDC / 上报 / BFF / 登录放行）
 *   <out>/README.md                       下一步清单
 *
 * 生成后会跑一遍**自检门禁**（`verifyScaffold`）：逐项断言关键字段确实写进了产物，
 * 任一缺失即 exit 1 —— 防「脚手架自己漂移」导致新应用照抄出一份坏配置（历史事故：
 * 漏 `watchSession` ⇒ 双模应用 3 秒误踢；漏 `homePath` ⇒ 静默空白页）。
 *
 * 设计原则：生成的是**声明式配置 + 一行调用**，不是可复制的实现代码 ——
 * 这样「接入质量」不再取决于抄得全不全（历史事故：kb-web / infra 的 permissions.ts 双前缀漂移）。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// 已知 flag 白名单：未知 flag 一律报错退出，防止「转抄笔误静默回落默认值」
// （实测教训：把 --out 写成 --out-dir 时旧实现静默忽略，产物落到默认目录，
//  接入方拿着空目录排查半天 —— 与「配置漂移不报错」同型的静默失效）。
const KNOWN_FLAGS = ['app-id', 'context-path', 'out', 'name', 'token-prefix']

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (!KNOWN_FLAGS.includes(key)) {
        console.error(`未知参数 ${a}（已知参数：${KNOWN_FLAGS.map(f => '--' + f).join(' / ')}）`)
        console.error('拼错参数会静默回落默认值导致产物落错目录，已阻止；请核对后重试。')
        process.exit(1)
      }
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
 *
 * 这是本应用**唯一**的「接入代码」：全部选项都是声明式配置，没有业务逻辑。
 * 字段语义见 marschat-components/docs/CONFIG-REFERENCE.md §5.2。
 */
import { createMarschatApp } from '@marschat/app-kit'
import { isOidcToken } from '@marschat/auth-components'
import router from './router'
import { menus } from './menus'

export const marschat = createMarschatApp({
  appId: '${appId}',
  router,
  menus,
  // 存量应用迁移时传入旧令牌键前缀，保证老用户登录态不丢：
  tokenKeyPrefix: '${tokenPrefix}',

  // 🔴 下面两项属于「漏了不报错、但功能坏」的必填项（CONFIG-REFERENCE §5.2 已列为必传）：
  //    homePath      —— 守卫 onDeny 落点。缺省 '/dashboard' 只对「首页真叫 /dashboard」的应用成立，
  //                     若 router.ts 里没有该路径 ⇒ 静默停在空白页（不报错、也不重定向）。
  //    watchSession  —— 双模应用（账密 legacy + SSO oidc 并存）必须用函数式判据；
  //                     缺省按纯 OIDC 处理 ⇒ 账密会话重载后 3 秒被会话监视器误踢
  //                     （坑 #47，infra / kb-ops 各踩一次）。
  homePath: '/dashboard',
  watchSession: () => isOidcToken(),

  // permissionsIssuer: '${base}/api',
  //   权限查询基址。0.1.6 起**可省略**：缺省自动指向同源 apiBase（即本应用 BFF 代理）。
  //   只有「权限代理不在 apiBase 下」时才需要显式写，且必须写 apiBase 形态（内部还要拼 /auth/permissions）。
})
`)

write('src/router.ts', `/**
 * 最小路由 —— 只放接入必需的两条（登录后落地页 + 用户管理页）。
 *
 * ⚠️ 为什么脚手架必须生成它：\`createMarschatApp\` 的 \`homePath\` 必须是**本文件里真实存在的路径**。
 *    历史事故：应用只写了业务路由而首页叫 \`/\`，装配层缺省 \`homePath='/dashboard'\` ⇒ 守卫
 *    \`onDeny\` 跳过去匹配不到任何路由 ⇒ **静默空白页**（不报错，最难查的一类）。
 *    \`/users\` 由 app-kit 自动注册（\`autoRoutes\` 默认 true），此处**不要**重复声明。
 */
import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from './views/Dashboard.vue'

export default createRouter({
  history: createWebHistory('${base}'),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/dashboard', name: 'dashboard', component: Dashboard, meta: { perm: '${appId}:menu:dashboard' } },
  ],
})
`)

write('src/views/Dashboard.vue', `<script setup lang="ts">
// 落地页占位 —— 换成真实业务页即可。菜单 key / 路由 meta.perm 必须与后端 menu-registry.yml 对齐。
</script>

<template>
  <div style="padding:24px">
    <h2>工作台</h2>
    <p>接入已完成：统一登录（SSO / 账密 / 邮箱码 / 忘记密码）· 统一鉴权 · 单点登出联动 · 本系统用户管理。</p>
    <p>下一步：把本页替换成真实业务页，并在 <code>menu-registry.yml</code> 与 <code>src/menus.ts</code> 同步菜单 key。</p>
  </div>
</template>
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

write('backend/menu-registry.yml', `# 菜单与 api 权限点上报（classpath，启动全量覆盖上报）
# ⚠️ strict 默认最小权限下：普通用户只自动拿到 public:true 的落地菜单，
#    其余菜单与**全部 api 点**必须管理员在中心显式授权（坑 #17 / #18）。
# key 必须与前端 permCode 严格对齐（前端 menus.ts 与路由 meta.perm 同名），禁改名。
client: ${appId}

menus:
  - key: dashboard            # = sys_permission.code，前端 permCode('menu','dashboard')
    title: 工作台
    path: /dashboard
    order: 1
    public: true              # 🔴 全应用至多 1 个：普通用户登录后的唯一落地页
  - key: users
    title: 本系统用户
    path: /users
    order: 2
    min-role: admin           # 可选角色门槛（应用管理员才可见）

apis:                         # ⚠️ api 点任何模式都不自动授予；写接口闸门用
  - key: demo:write
    title: 示例写操作（替换为真实写点）
`)

write('backend/application-snippet.yml', `# 追加到本应用 application.yml —— 后端接入的**全部配置**（0 行 Java）
marschat:
  oidc:
    issuer: https://auth.marschat.online           # 与签发端逐字一致（坑 #8）
    jwks-uri: http://auth-center:8085/oauth2/jwks  # JWKS 走内网（坑 #9）
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
  auth:
    anonymous:
      # 🔴 登录校验放行清单（Phase 14 / auth-core 2.3.0）：**写值即整体替换**，
      #    登录保底集 5 条在代码内强制合并、配置不可清空（防误配把登录链路锁死）。
      #    路径口径 = **context-path 剥离后**（坑 #40）：有部署前缀的应用写 \`/api/auth/login\` 这种形态，
      #    且**不要**配 context-path（配错只生成永不命中的副本）。
      #    仅当后端可见完整前缀（如 activecode）才配 context-path。
      paths:
        - /api/auth/login
        - /api/auth/sso/**
        - /actuator/**
      # 登录端点不是 \`/api/auth/*\` 形态时（如 infra 的 \`/auth/login\`），保底集覆盖不到，必须显式声明：
      # endpoints:
      #   - { path: /auth/login, methods: [POST] }
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

## 3 后端（3 份配置，0 行 Java）

把 \`backend/\` 下三个文件按此处置：

| 文件 | 去处 | 作用 |
|---|---|---|
| \`bff-whitelist.yml\` | \`src/main/resources/\` | 管理代理白名单（默认拒绝，未登记即 404） |
| \`menu-registry.yml\` | \`src/main/resources/\` | 菜单 / api 权限点上报（strict 下缺它菜单全空） |
| \`application-snippet.yml\` | 并入 \`application.yml\` | OIDC / 上报 / BFF / **登录放行清单** |

## 4 前端（已可运行，只改业务）

\`src/marschat.ts\` 是**唯一**的接入代码（声明式选项，无逻辑）；
\`src/router.ts\` 里的 \`/dashboard\` 必须与 \`marschat.ts\` 的 \`homePath\` 一致。

把 \`src/menus.ts\` 的菜单改成真实菜单，并在 \`menu-registry.yml\` 里同步同样的 key（两处 key 必须一致）。

## 5 验收清单

- [ ] SSO 免登：口令输入次数 == 1，跨应用免登
- [ ] 账密 / 邮箱码 / 忘记密码三条通道
- [ ] 用户管理页可见且**无**「新建用户 / 重置密码 / 删除身份」（应用侧应只有成员视角）
- [ ] Network 中无跨域直连 auth-center \`/admin/**\` 的请求
- [ ] 登录页（未登录）**零** \`/auth/permissions\` 请求、零 401 控制台报错（app-kit ≥0.1.9）
- [ ] 接口闸门三态：200 / 403 / 401
- [ ] SLO 联动：别处登出后本应用被请出
`)

// ---------------------------------------------------------------------------
// 自检门禁：生成即校验（防「脚手架自己漂移」⇒ 新应用照抄出一份坏配置）
// ---------------------------------------------------------------------------
const REQUIRED = [
  // [文件, 必含片段, 缺失后果]
  ['src/marschat.ts', "homePath: '", '守卫 onDeny 落点缺失 ⇒ 静默空白页'],
  ['src/marschat.ts', 'watchSession: () =>', '双模应用会话监视误判 ⇒ 账密会话 3 秒被踢（坑 #47）'],
  ['src/router.ts', "path: '/dashboard'", 'homePath 指向的路由不存在 ⇒ 静默空白页'],
  ['src/main.ts', 'marschat.install(app)', '守卫注册顺序错 ⇒ 首屏跳过权限判定（坑 #5）'],
  ['src/main.ts', 'marschat.bootstrap()', '会话监视 + 权限预取不会启动'],
  ['backend/menu-registry.yml', 'public: true', 'strict 下普通用户登录菜单全空（坑 #17）'],
  ['backend/application-snippet.yml', 'anonymous:', '登录端点可能被拦 ⇒ 全站登不进（坑 #40）'],
  ['backend/bff-whitelist.yml', 'client-in-path: true', '管理代理越界风险（{clientId} 段未校验）'],
]

/** 去掉注释行（`//` `#` `/*` `*`）—— 否则「注释里提到某字段」会骗过门禁（假阴性）。 */
function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith('//') || t.startsWith('#') || t.startsWith('/*') || t.startsWith('*'))
    })
    .join('\n')
}

function verifyScaffold(dir) {
  console.log('\n自检门禁（注释行不参与判定）：')
  let bad = 0
  for (const [rel, needle, why] of REQUIRED) {
    const file = join(dir, rel)
    let txt = ''
    try {
      txt = stripComments(readFileSync(file, 'utf8'))
    } catch {
      txt = ''
    }
    if (txt.includes(needle)) {
      console.log(`  ✓ ${rel} 含 ${needle}`)
    } else {
      bad++
      console.log(`  ✗ ${rel} 缺 ${needle} —— ${why}`)
    }
  }
  if (bad > 0) {
    console.error(`\n自检失败：${bad} 项缺失。产物不可直接交付，请先修脚手架本身。\n`)
    process.exit(1)
  }
  console.log(`  ✓ 自检通过（${REQUIRED.length}/${REQUIRED.length}）`)
}

verifyScaffold(outDir)

console.log(`\n完成。下一步见 ${join(outDir, 'README.md')}\n`)
