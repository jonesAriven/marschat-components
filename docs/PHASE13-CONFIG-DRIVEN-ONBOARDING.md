# Phase 13 · 配置化接入（三处配置 + 一行装配）

> **定位**：本文是「应用接入架构」的**决策与落地记录**（背景 → 审计 → 设计 → 实现 → 自测 → 迁移）。
> **配套**：`README.md` 第二篇（怎么接入）· `CONFIG-REFERENCE.md` §4.5/§5.1（配置字段全表）· `STATUS.md`（待办 `T-ENG-2`/`T-ENG-3`）。
> **时效**：2026-10-07（§5 迁移路线已收官：5/6 应用上线）。**本文不含任何口令 / secret 明文**。

---

## 1. 背景：一次架构审计

良哥提出「团队技术能力需要提升、需要代码质量把控」，并要求核实
**「应用接入是否满足引入公共前后端组件 + 少量配置化即可接入」**。

审计方法：文档通读 + 源码逐文件核对（含 diff 比对、全仓引用检索、行数实测），结论均有命令取证。

### 1.1 结论：**不满足** —— 能力已组件化，接入面未收敛

| 应用 | 前端接入胶水 | 后端接入胶水 | 合计 |
|---|---|---|---|
| portal | 8 文件 / 1064 行 | 4 类 / 1106 行 | **2170** |
| kb-web | 7 / 1235 | — | **1235+** |
| kb-ops | 8 / 948 | 2 / 304 | **1252** |
| infra-monitor | 7 / 791 | 6 / 746 | **1537** |
| activecode | — | 3 / 472 | **472+** |

即：**新增一个应用仍需手写约 1100 ~ 2300 行胶水**，其中 60% 以上是同构复制粘贴。

### 1.2 六个架构缺口

| # | 缺口 | 关键证据 |
|---|---|---|
| 1 | 🔴 **后端 BFF 三件套未公共化，三份实现行为已分叉** | `auth-core` 17 个源文件**零 BFF 能力**；`AdminProxyController` ×3（297/295/266 行）；`CenterSessionStore` ×2（**除 package 行外逐字节相同**）；`LocalAccountReporter` ×3；`SecurityConfig` ×6 手写。**最严重**：同一「代理中心 `/admin/**`」语义，kb-ops 透传调用者 `Authorization`，infra 走 `resolveCenterToken()` 换票 → **安全边界不由架构保证，由"当时抄的是哪一份"决定** |
| 2 | 🔴 **前端 Shell 未收敛** | `frontend-common` 导出 `SidebarMenu` 但**全仓 0 引用**（死代码）；各应用自写 `MainLayout.vue`（675 / 307 / 280 行）→ 三套外壳 → `T-LOW-11` 的 16 项视觉债 |
| 3 | 🟠 **菜单双份定义靠人工对齐** | `menu-registry.yml`（15 menu + 10 api）↔ `menus.ts`（`createKbMenus()` 15 节点），yml 注释自述「严格对齐、禁止改名」= 靠承诺不靠机制 |
| 4 | 🟠 **兼容转发壳被固化成架构** | 各应用 `sso.ts` **16 个导出 / 126~168 行**，多为保持旧调用名的别名；组件库已 33 导出 → 双层 API 面 |
| 5 | 🟠 **无脚手架** | `scripts/` 只有 `build-all.ps1` + `push-all.ps1`，零 scaffold；接入靠「照抄 infra-monitor」。**已出事故**：kb-web / infra 的 `permissions.ts` 曾带 `/kb/kb/dashboard` 双前缀（2026-09-14 实测），kb-ops 修好后**未被推广**，因为推广机制是「人记得改」 |
| 6 | 🟡 **portal 与其余 5 应用不同构** | `portal_token` 非约定键 / BFF 换票 / 会话监视必须显式注入（否则永不发探针）/ `oidc` vs `legacy` 双会话语义（否则账密会话活不过 3 秒） |

---

## 2. 设计：三处配置 + 一行装配

```
新增应用
├── 配置 ×3（全部声明式，手工编辑点仅此三处）
│   ├── apps-registry.yml      已有 ✅
│   ├── menu-registry.yml      已有 ✅
│   └── bff-whitelist.yml      新增 ⬅（默认拒绝，未登记即 404）
├── 前端装配 ×1
│   └── createMarschatApp({ appId, router, menus })   ← 唯一必须手写的业务数据是 menus
└── 后端装配 ×1
    └── marschat.bff.enabled=true                     ← 打开即装配管理代理
```

### 2.1 关键设计决策

| 决策 | 理由 |
|---|---|
| **装配层独立成包 `@marschat/app-kit`** | 不把 axios / vue-router 拖进 `auth-components`（其 `client.ts` 刻意零依赖，供 UMD 静态页使用）；不污染 `frontend-common`（它是通用工具层）。装配层是上层组合，独立最干净 |
| **决策逻辑抽成纯函数 `config.ts`（零 import）** | 「配置优先级 / 路径拼接 / 令牌键派生」是最容易出错也最容易被复制粘贴搞歪的部分。纯函数 → 可零依赖单测（51 项），且不依赖 Vue/axios |
| **BFF 凭据策略从「代码」变「配置」** | 三份实现的分叉本质是**同一语义的三种策略**。收敛为 `credential-mode` 三态（passthrough / session-store / auto），行为差异变成显式选择而非历史巧合 |
| **白名单外置为 yml** | 30 行硬编码 Java → 声明式清单。新增中心端点=改配置，不是改 3 份 Java |
| **`enabled` 默认 false** | 灰度安全：未迁移的应用行为**完全不变**；回滚只需设回 false |
| **Bean 名统一加 `marschatBff` 前缀** | 历史教训：`@ConditionalOnMissingBean` **只按类型匹配**，挡不住「异类型同名」→ `BeanDefinitionOverrideException` 启动 crash-loop（见共享知识 §`java-backend-gotchas`） |
| **`clientId` 只从 URL path 取** | 只要 client 是参数，改 `client=B` 就能越界。故 `client-in-path: true` 校验路径段 |

---

## 3. 实现

### 3.1 后端：`auth-core@2.2.0` · `com.marschat.auth.bff`

| 类 | 职责 |
|---|---|
| `BffProperties` | `marschat.bff.*` 配置绑定（含 `CredentialMode` 枚举） |
| `BffWhitelistRule` | 单条规则：方法 + 路径模式（`{x}` / `{clientId}` / `*` / `**`）+ 作用域校验 |
| `BffWhitelist` | 规则集合，**默认拒绝** |
| `BffWhitelistLoader` | 读 `bff-whitelist.yml`；文件缺失 = 空白名单 = 全拒（fail-closed） |
| `CenterSessionStore` / `InMemoryCenterSessionStore` | 中心令牌服务端暂存（取代 2 份逐字节相同的副本） |
| `BffCredentialResolver` / `DefaultBffCredentialResolver` | 凭据解析三模式（取代 3 份分叉实现） |
| `BffLocalTokenClassifier` | SPI：判断 token 是否本应用自签（供 `auto` 模式） |
| `MarschatBffAdminProxyController` | 通用代理：白名单 → 凭据 → 转发（状态码/响应体原样透传） |
| `BffAccountSource` / `MarschatBffAccountReporter` | 本地账号上报 SPI + 公共上报器（取代 3 份 95~111 行） |
| `MarschatBffAutoConfig` | 条件装配，注册进 `AutoConfiguration.imports` |

**自测发现的真实缺陷（已修）**：白名单原先只读 `request.getQueryString()`，
若 `client` 参数从表单体等来源进入则**漏判作用域**（校验所见 ≠ 转发所得）。
改为取 `request.getParameterValues("client")`（真实容器里已合并查询串与表单体），
并补 3 条单测锁定。**这是本次自测最有价值的产出之一。**

### 3.2 前端：`@marschat/app-kit`（首发 0.1.0，**当前 0.1.4**）

| 模块 | 职责 |
|---|---|
| `config.ts` | **纯函数**：`resolveAppConfig` / `normalizeContextPath` / `deriveTokenKeys` / `toRouterPath` / `appUrl` |
| `createMarschatApp.ts` | 一行装配：base 声明 → 令牌键 → SSO client → 统一请求 + 401 分流 → 路由守卫 → 路由注册 → 会话监视 + 权限预取 |
| `shell.ts` | `createMarschatShell()` 共享外壳（侧边栏 + 顶栏 + 内容区），**让 `SidebarMenu` 复活** |
| `types.ts` | 对外契约；`RouterLike` 结构性类型 → **不依赖 vue-router** |

**`toRouterPath` 是历史事故的根治点**：`/kb/kb/dashboard` 双前缀 404 的成因是
「router 已带部署前缀，却又把含前缀的 `pathname` 传给它」。该函数统一剥离，并有单测锁定
（含「不得误伤同前缀兄弟路径 `/kb` vs `/kbitem`」这类边界）。

### 3.3 脚手架

`scripts/scaffold-app.mjs` —— 一条命令生成前端 4 文件 + 后端 2 文件 + 接入清单。
生成的是**声明式配置 + 一行调用**，不是可复制的实现代码 —— 这样「接入质量」不再取决于抄得全不全。

---

## 4. 自测证据（2026-10-05 本机实测）

### 后端（`java/auth-core`）

```
[INFO] Tests run: 4,  Failures: 0  -- com.marschat.auth.AuthAutoConfigTest
[INFO] Tests run: 6,  Failures: 0  -- com.marschat.auth.bff.BffWhitelistLoaderTest
[INFO] Tests run: 20, Failures: 0  -- com.marschat.auth.bff.BffWhitelistTest
[INFO] Tests run: 5,  Failures: 0  -- com.marschat.auth.bff.MarschatBffAutoConfigTest
[INFO] Tests run: 7,  Failures: 0  -- com.marschat.auth.bff.webtest.BffWebMvcTest
[INFO] Tests run: 8,  Failures: 0  -- com.marschat.auth.jwt.TokenProviderTest
[INFO] Tests run: 6,  Failures: 0  -- com.marschat.auth.web.MarsUserArgumentResolverTest
[INFO] Tests run: 56, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

新增 **38 项**覆盖：默认拒绝 · 空白名单全拒 · 未配 client-id 全拒 · 方法不匹配拒 ·
`{id}` 占位不跨段 · `**` 多段通配 · 路径越界拒 · 查询参数越界拒 · **HPP 重复键拒** ·
**表单体旁路拒**（自测发现的缺陷）· 平台级写端点拒 · `/internal/**` 永不放行 · 正则元字符转义 ·
YAML 容错 · 自动装配条件（不配置=不装配 / 可选 Bean 条件）· **真实 MVC 链路**（占位解析 / 404 / 401 / 502）。

`mvn package` 产物已核验：jar 内含 13 个 bff 类 + `META-INF/marschat/bff-whitelist.template.yml`
+ `AutoConfiguration.imports` 已含 `MarschatBffAutoConfig`。

### 前端（`packages/app-kit`）

```
配置派生自测：51 通过 / 0 失败（共 51 项）
API 契约类型检查（vue-tsc -p tsconfig.test.json）：EXIT=0
生产构建：dist/marschat-app-kit.es.js 12.58 kB │ gzip: 5.01 kB
         dist/marschat-app-kit.umd.cjs 9.88 kB │ gzip: 4.16 kB
pnpm --filter @marschat/app-kit test：EXIT=0
```

`test/typecheck.ts` 是**契约测试**：把 README/脚手架里的「一行装配」示例写成可编译代码，
一旦 API 变化或文档与实现脱节，类型检查即失败 —— 用机制防止手册再次漂移。

### 脚手架

```
node scripts/scaffold-app.mjs --app-id marschat-demo --context-path /demo --out ./tmp/demo
  ✓ src/marschat.ts  ✓ src/main.ts  ✓ src/menus.ts  ✓ src/App.vue
  ✓ public/app-config.json  ✓ backend/bff-whitelist.yml  ✓ backend/application-snippet.yml  ✓ README.md
```

### 发布（2026-10-05 已落 Nexus）

| 包 | 版本 | 仓库 | 核验 |
|---|---|---|---|
| `com.marschat:auth-core` | **2.2.0** | maven-releases（`192.168.31.105:8081`） | jar + pom + sources + md5/sha1 共 9 个资产 |
| `@marschat/app-kit` | **0.1.4**（latest） | npm-hosted（`nexus.marschat.online`） | 0.1.0 → 0.1.1 → 0.1.2 → **0.1.3**（`tokenKeys` / `permissionsIssuer`）→ **0.1.4**（函数式 `watchSession` / `clearExtraAuth`），后四版均为**迁移过程中发现的问题修复** |

> 0.1.1：`MarschatApp.sso/request/permissions` 从 `unknown` 改为精确类型（迁移方不必强转）。
> 0.1.2：`RouterLike` 方法签名放宽 —— 手写的精确结构类型会让 vue-router 的 `Router`
> **不可赋值**（kb-ops 迁移时实测 `TS2322`）。这是「手写结构性类型」的典型代价。

### 试点迁移：kb-ops（2026-10-05）

选 kb-ops 的理由：纯 SSO（无账密体系）· `credential-mode: passthrough` 与现行为一致 · 迁移面最窄。

| 动作 | 规模 |
|---|---|
| 后端删除手写 `AdminProxyController` | **−266 行** → 一份 60 行 `bff-whitelist.yml` |
| 前端删除 `sso.ts` / `permissions.ts` / `token.ts` | **−263 行** → 一个 30 行 `src/marschat.ts` |
| 前端类型错误 | 28 → 27（新增的 1 个已消除；剩余 27 为存量，在未改动的 view 文件） |
| 前端构建 / 后端编译 / 后端打包 | 全部 EXIT=0 |
| **白名单等价性**（`kb-ops/docs/verify/VerifyBff.java`） | **34 / 34 通过** |

**未改动**：所有业务页、`api/*`、`menus.ts`、路由结构、登录页 UX、用户管理页页签 —— 只迁管道，不动业务。

**迁移中发现并修复两处真实缺陷**（详见 `kb-ops/docs/PHASE13-配置化接入迁移记录.md`）：

1. 🔴 **`createRequest({ hooks: {...} })` 参数被静默忽略** ——
   `frontend-common@0.3.5` 无 `hooks` 字段（产物 `grep -c hooks` = 0），
   两个回调落到默认实现 → 精心写的「OIDC 静默续期」分支**从未执行**，OIDC 会话过期一律硬踢登录页。
   **需逐应用 grep 自查**（`T-LOW-16`）。
2. 🔴 **`SecurityConfig` 缺显式 401 entry point（坑 #2）** —— 未携带 token 返 403、无效 token 返 401，
   前端 401 拦截器遇 403 不续期不跳登录 → 页面假死。README Level 4 检查清单 C 组已列为必检项，
   但**当时只写进文档、没进门禁** → 典型「规范停留在文档」的代价。**需逐应用体检**（`T-LOW-17`）。

> 这两处正好印证 §6 的判断：**接入规范不进门禁，就等于没有规范**。

---

## 5. 迁移路线（存量 6 应用）

| 步 | 动作 | 状态 |
|---|---|---|
| 1 | 发布 `@marschat/app-kit` + `auth-core@2.2.0` 到 Nexus | ✅ **已完成**（0.1.2 / 2.2.0） |
| 2 | 试点 **kb-ops**（纯 SSO、`credential-mode: passthrough`） | ✅ 代码+本地验证完成（白名单 **34/34**） |
| 3 | 第 2 个 **infra-monitor**（双会话、`credential-mode: auto`、host 网络） | ✅ 代码+本地验证完成（白名单 **29/29**） |
| 4 | 第 3 个 **activecode**（无 Security、首次引入 auth-core、无构建前端） | ✅ **后端**完成（白名单 **29/29**）；❌ **前端不可迁**（见下） |
| 5 | 逐个迁移：**kb-web** → **cosmic-studio** | ✅ **已完成并上线**（kb-web −258 行 / cosmic −54 行；流水线 #838 / #121） |
| 6 | `portal` 最后迁移 | ✅ **已完成并上线**（前端 −261 行 + 后端三道闸；流水线 #839 / #840；**注：原计划的 `sessionMode: 'bff'` 经核实是错的** —— portal 是**双模**（账密 + SSO 并存），传 `'bff'` 会让真SSO 会话也失去 SLO 联动；正确做法是默认 `'oidc'` + `watchSession: () => isOidcToken()`） |
| 7 | 迁移完成的应删除自家 `AdminProxyController` / `CenterSessionStore` / `LocalAccountReporter` 与 `sso.ts` 兼容壳（`T-LOW-15`） | kb-ops / infra-monitor / activecode 已完成删除 |

> **逐应用迁移记录**（含实测增删行数、参数陷阱、验证证据）：
> `kb-ops/docs/PHASE13-配置化接入迁移记录.md` · `infra-monitor/docs/…` · `active-manager/docs/…` ·
> `mykng/kb-web/docs/…` · `cosmic-studio/docs/…` · `portal/docs/…`（命名统一为 `PHASE13-配置化接入迁移记录.md`）。
> kb-web / cosmic-studio / portal 三份于 2026-10-08 补齐，与前三个试点同格式。

### 🔴 边界发现：无构建应用（UMD）**没有**配置化接入路径（`T-ENG-5`）

activecode 是**纯静态页**（无 `package.json` / 打包器 / `vue-router`），因此：

| 层 | 状态 |
|---|---|
| 后端接入面 | ✅ 已配置化（472 行手写 → 配置 + 90 行扩展类） |
| 前端接入面 | ❌ **仍是手写**：`sso.js` **418 行** + 6 个 HTML 各自处理会话 + `members.html` 手写用户管理 |

`@marschat/app-kit` 假定「有打包器 + 用 vue-router」，两条 activecode 都不满足。
**这不是实现缺陷，是路径缺失** —— 补上它需要新增 UMD 版装配层
（`createMarschatUmdApp` + 页面级会话守卫 + 页面模板 + `UserManagementPanel` 的 UMD 出口），
建议 Phase 14 评估；**优先级低于把 3 个已迁 SPA 铺开**（1 个无构建应用的手写成本，远小于 5 个 SPA 各写一套）。

### 三个已迁应用的覆盖面（说明试点选择的互补性）

| 维度 | kb-ops | infra-monitor | **activecode** |
|---|---|---|---|
| 鉴权框架 | Spring Security | Spring Security | **无 Security（自有 MVC 拦截器）** |
| 凭据模式 | `passthrough` | `auto`（双会话） | **自定义 `BffCredentialResolver`（HttpSession）** |
| 中心会话存储 | 无 | `CenterSessionStore` | `CenterSessionStore` |
| 账号上报 | 无 | `BffAccountSource` | `BffAccountSource`（`admin_user` 表） |
| 是否已引 auth-core | 是 | 是 | **否 → 本轮首次引入（需 4 条 exclude）** |
| 部署 | 容器 | host 网络 | **独立主机 + 跨主机 LAN 中心地址** |
| 反代层数 | 1 层 | 2 层（剥 `/api`） | 1 层 |
| 白名单宽度 | 9 条 | 5 条 | 5 条 |
| 净删后端代码 | 266 | **461** | **472** |
| 前端 | ✅ 已迁（263 行 → 一行装配） | ✅ 已迁（264 行 → 一行装配） | ❌ **不可迁** |

> **三种形态全部跑通（后端）** —— 这证明「凭据解析做成 SPI + 白名单外置 + `enabled` 默认关」
> 这套设计不是只对「标准 SPA + Spring Security」成立。
> 而 activecode 的**前端**则是这套设计的**明确边界**，已如实登记而非粉饰。

**每应用迁移的固定动作**：

```
① 后端：改写 bff-whitelist.yml（对齐旧 isAllowed）→ 删除手写代理 → 打开 marschat.bff.enabled → pom 升 auth-core 2.2.0
② 前端：新增 src/marschat.ts 一行装配 → 删除 sso/permissions/token 三个适配层 → 引用点重定向 → 加 @marschat/app-kit 依赖
③ 顺手体检：SecurityConfig 显式 401（T-LOW-17）· createRequest 是否误用 hooks（T-LOW-16）
④ 本地验证：类型检查 + 构建 + 打包 + 白名单等价性脚本
⑤ 发版部署 + 真浏览器五通道回归（免登 / 账密 / 401 静默续期 / 闸门三态 / SLO）
```

**顺序不可颠倒**：先发布，再试点，再铺开。`marschat.bff.enabled` 默认 false 是回滚闸门；
⚠️ 但**前端后端必须同版本回滚** —— 前端迁移后已无手写代理，只回后端会让用户管理页 404。

---

## 6. 代码质量把控建议（把规范从文档搬进 CI）

当前接入规范全部写在 README Level 4 的 checklist 里，靠人打勾 = 靠承诺。建议改为门禁：

| 门禁 | 检查内容 | 工具 |
|---|---|---|
| **接入合规检查** | 显式 401 entry point · `issuer` 逐字一致 · `public: true` 菜单 ≤1 · 无本地密码校验 · `bff-whitelist.yml` 存在且非空 | 自研 lint 脚本，纳入各应用流水线 |
| **重复代码门禁** | 应用侧同构文件相似度阈值告警（`sso.ts` / `permissions.ts` / `AdminProxyController`） | `jscpd`（前端）+ `PMD CPD`（后端） |
| **依赖方向门禁** | 禁止应用自建密码体系；禁止绕过公共包直连中心域名 | `ArchUnit`（后端）+ ESLint 自定义规则（前端） |
| **契约测试** | 组件发版时跑 6 应用接入面回归（五通道） | 收敛为仓库内单一入口（`T-REG-1`） |
| **版本三对齐** | `package.json` 约束 + lock + 线上版本戳一致；UMD 版本戳 == 产物内 `version` 常量 | CI 脚本 |

**优先级**：`重复代码门禁` + `接入合规检查` 先上 —— 成本最低，且直接拦住本次审计中已经发生过的两类事故
（漂移缺陷、安全边界分叉）。

---

## 7. 遗留与后续

| # | 事项 | 归属 |
|---|---|---|
| T-ENG-2 | 发布 `app-kit` + `auth-core@2.2.0` | ✅ **已闭合**（app-kit 累计发到 **0.1.4**，auth-core 2.2.0） |
| **T-ENG-7** | 🆕 **portal 存量 admin 账号授权普查** | 本轮恢复中心权限点校验后，普通 `role=admin` 账号会401（中心的 `sys_permission` 表无 `api:admin` 权限点）。**迁移前是放行的** ⇒ 需普查存量 admin 并补授权。见 `STATUS.md` §1.2 |
| **T-ENG-8** | 🆕 **portal 账密凭据链修复** | ✅ 已修并真机验证（账密 admin 访问管理面 200）。⚠️ 遗留：`clearUserCredentials()` 暂无调用方（`/auth/logout` 是空实现），**该端点恢复真实语义时必须接上**，否则登出后服务端残留可用凭据 |
| T-ENG-3 | 6 应用迁移（消除 BFF 安全边界分叉） | `STATUS.md` §1.2 |
| T-ENG-4 | `menus.ts` 由 `menu-registry.yml` 生成（消灭双份定义） | `STATUS.md` §1.2 |
| T-LOW-14 | `SidebarMenu` 死代码 → 已提供 `createShell()` 解法，待迁移切换 | `STATUS.md` §1.4 |
| T-LOW-15 | `sso.ts` 兼容转发壳随迁移删除 | `STATUS.md` §1.4 |
| — | 5 项 CI 门禁落地 | 本文 §6 |

**明确不在本次范围**：F1 密钥轮换（`T-DEC-1`）、3.2-B 令牌分离（`T-DEC-2`）—— 两者均需单独拍板，见 `STATUS.md` §1.1。

---

*记录完毕 · 所有量化数据与测试结论均来自 2026-10-05 本机实测，命令与输出见 §4。*
