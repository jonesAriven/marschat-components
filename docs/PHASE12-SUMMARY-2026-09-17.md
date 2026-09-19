# Phase 12 统一认证与权限治理 · 收口汇总（截至 2026-09-17）

> **文档性质**：Phase 12 **全量收口总结 + 剩余项交接**。合并前序三轮（R1 三层权限 API / R2 前端 0.8.8 + BFF 收窄 / R3 kb-web·kb-ops 同源化）成果，并附 **2026-09-17 本轮线上实测核验证据**。
> ⏳ **时效声明（2026-09-19 追加）**：本文是 **2026-09-17 的阶段性快照**，其「剩余项 / 待办」结论**已吸收进 `docs/STATUS.md`**。**查最新待办一律看 `STATUS.md`**；本文仅作历史证据与推演细节留存（勿单独引用其待办条目）。
> **权威演进**：`devtools/docs/adr/ADR-2026-09-16-Phase12-统一认证权限治理.md`（冲突时以其为准）；进度快照：`docs/PHASE12-PROGRESS-2026-09-16.md`。
> **口径铁律**：本文所有结论均为**线上实测 / 源码实读**，标注 `⚠️` 者为未验证或需决策；**不含任何口令 / secret 明文**。

---

## 0. 结论速览

| # | 结论 |
|---|---|
| 1 | **Phase 12 四根支柱已全部落地并上线**：三层权限 API（服务端真正区分「应用管理员 ≠ 平台管理员」）、共享组件 app 作用域越权入口收口（0.8.8）、各应用 BFF 白名单收窄、kb-web / kb-ops `/admin` 调用同源化。 |
| 2 | **本轮（09-17）线上复核实测通过**：4 个前端全部在服 0.8.8 产物；kb-gateway 三条 `kb-admin-proxy` 路由在位；kb-ops BFF 类在位；探针账号**已全部墓碑**（活跃用户仅 admin + p10x 两个常驻账号）。 |
| 3 | **仓库同步健康**：`devtools` Gitee / GitHub `dev` = `acee7d1e`（一致）；`marschat-components` Gitee / GitHub `main` = `7053a0ae`（一致）。 |
| 4 | 🔴 **新发现（本轮）**：`marschat-auth-core.umd.js` 内 `version = "0.8.7"`，而 `VENDORED-auth-core-umd.md` 已标注 `0.8.8`——**UMD 未按 0.8.8 重新构建，只改了版本戳**，破坏「版本/大小/sha256 三对齐」。 |
| 5 | **剩余项集中在 3 类**：① 权限下沉的**第二层**（应用台 path 化 Membership API、kb-ops 假闸门整改）；② 4 项**待良哥拍板**（F1 密钥轮换 / 3.2-B 令牌分离 / auto-git-sync 处置 / auth-center 715b41e 推送）；③ 低危收口（BFF 重复 client 参数、apps-registry 明文 secret 默认值、文档漂移、cosmic 路由改名）。 |
| 6 | **R4 收口（09-17 下午）已落地**：BFF 重复 `client` 参数（HPP）加固 ×3、kb-ops「菜单授权」页修复（R3 遗留坏功能）、kb-ops 菜单授权页签守卫、portal 0-public 注释。提交 `1061d2d`，流水线 #811/#812/#814/#815 全 SUCCESS；已闭合 §4 的 P2-1 / P1-3 / P2-5，并把 P2-9 / P2-10 结案。详见 §10。 |
| 7 | **R5 收口（09-17 晚）已落地**：kb-ops「假闸门」整改（10 个 Controller 补 25 个 api 写点 + SyncController 补闸门）+ 浏览器级 E2E A~F 全通过 + 已认证端到端（R3 遗留）闭合。提交 `88aa2c3`，流水线 #816 SUCCESS。详见 §11。 |

---

## 1. Phase 12 目标与达成度（逐条对账）

| # | 目标 | 达成度 | 关键证据 |
|---|---|---|---|
| 1 | **服务端三层权限 API**：平台管理员 / 应用管理员 / 应用级 Entitlement | ✅ 已完成 | auth-center `f139ea0`（#60）；`PermissionService#isAppAdmin`（口径 = 本 client 持 `api:admin:write`）+ `AppAuthzEvaluator` + `AdminClientMemberController`（path 化，client 钉进 path） |
| 2 | **D-7 受限读端点**（加人候选）+ **R8 自锁** | ✅ 已完成 | `d77b322` + `abcc7b6` + `d3152b5`（#61/#62/#63），实测 **23/23 ALL GREEN**；`member-candidates` 五条硬约束（3 字段 / 只列未加入 / keyword≥2 / size≤20 / 写审计） |
| 3 | **共享组件 app 作用域越权入口（一处改 6 应用）** | ✅ 已完成 | `@marschat/auth-components@0.8.8`（`fb5c920` + merge `9908fba`，Nexus shasum `5e99372a`）：app 作用域隐藏「新建用户」「重置密码」，「编辑」改**只读视图**、状态开关隐藏；附修 `devDependencies` 缺 `sass` 的静默构建失败 |
| 4 | **各应用 BFF 白名单收窄** | ✅ 已完成 | activecode / infra-monitor `b081268`（#799/#800）前缀全透传 → 白名单默认拒绝；R2 再收回 `POST/PUT /admin/users`（`d964692`）；cosmic 删 4 条高危透传（`1adefa3` #119 + `6a73c0a` #120） |
| 5 | **kb-web / kb-ops `/admin` 调用同源化（3.2-A）** | ✅ 已完成 | `6bd545c`（#807 kb-web / #808 kb-ops-web / #809 kb-gateway / #810 kb-ops，严格串行全 SUCCESS）；kb-ops 新增 `AdminProxyController`，kb-gateway 增 3 条白名单路由 |
| 6 | **两类用户管理菜单**（中心台管人 / 应用台管关系） | ✅ 已落地（UX 已收口，API 层下一轮） | 组件 0.8.8 已按 D-3 裁剪；kb-ops 账号映射页签加 `isPlatformAdmin` 守卫 |
| 7 | **P0 级缺陷**（portal 免登短路 / cosmic 上报配置 / activecode 闸门+匿名洞） | ✅ 全部修复 | `27ca74d`（#798）· `1e833b1` · `019f25d`/`e4b1d0b`/`ffda9f7`（#796/#797） |
| 8 | 权限治理第二层（Membership path 化 / kb-ops 假闸门 / 审计 / 令牌分离） | ⏳ 未完 | 见 §4 / §5 |
| 9 | F1 密钥共享轮换 | ⏳ 方案已出，待拍板 | `p12-f1-jwt-rotation-plan.md`（并在 `acee7d1e` 订正为**三处**共用：auth-center / kb-gateway / kb-ops） |

---

## 2. 本轮（2026-09-17）线上实测核验（新证据）

> 核验主机：`ssh root@192.168.31.105`（mykng，免密）。命令与输出摘要均为本轮实跑。

### 2.1 各前端产物确为 0.8.8（4/4）

判据 = 组件 0.8.8 在 app 作用域只读视图引入的独有文案「用户信息（只读）」（QA 已用 Nexus tarball 差分证明 0.8.7 命中 0 / 0.8.8 命中 2，判据成立）。

| 容器 | 当前在服 chunk | 命中 |
|---|---|---|
| portal-web | `/portal/assets/index-BR-0YBai.js` | ✅ |
| kb-web | `/kb/s/assets/index-DhdUAR2C.js` | ✅ |
| kb-ops-web | `/ops/assets/index-fA7CZjN2.js` | ✅ |
| infra-monitor-web | `/infra/assets-v2/index-DgttdD5G.js` | ✅ |

> ⚠️ 卫生项：`portal/ops/infra` webroot 内仍残留旧 chunk 与 `*.bak` 目录（旧 0.8.7 构建）。已确认 `.bak` 内外网 **404 不可达**，无暴露风险，属磁盘卫生问题。

### 2.2 kb-gateway 同源化路由在位

`mykng/kb-gateway/src/main/resources/application.yml:115-136`：

| 路由 id | Path | Method | 去向 |
|---|---|---|---|
| `kb-admin-proxy-read` | `/kb/api/admin/users`、`/kb/api/admin/users/*`、`/kb/api/admin/roles` | GET | `lb://auth-center`（StripPrefix=2） |
| `kb-admin-proxy-scoped` | `/kb/api/admin/users/*/client-roles`、`.../menu-overrides` | GET,PUT | 同上 |
| `kb-admin-proxy-clients` | `/kb/api/admin/clients/marschat-kbweb/**` | — | 同上 |

kb-ops 侧 `kb-ops/src/main/java/com/kb/ops/controller/AdminProxyController.java`（12,072 B）在位。

### 2.3 R3 前端改动确已落盘（服务器工作副本实读）

| 文件 | 行 | 内容 |
|---|---|---|
| `kb-ops/kb-ops-web/src/views/users/UsersView.vue` | L10 | `<el-tab-pane label="账号映射" name="mappings" lazy v-if="isPlatformAdmin">` ✅ |
| 同上 | L60 | `const isPlatformAdmin = claims?.role === 'superadmin'` |
| 同上 | L47/78/86/100/111 | baseUrl / issuer 全部改用 `API_BASE_URL`（不再跨域直连中心）✅ |
| `mykng/kb-web/src/views/settings/UsersView.vue` | L26 / L52 | `` `${API_BASE_URL}/admin/users` `` / `baseUrl: API_BASE_URL` ✅ |

> ⚠️ **未闭合**：kb-ops `UsersView.vue:8`「**菜单授权**」页签（`MenuPermissionPanel`）**仍无 `isPlatformAdmin` 守卫**——R3 只守了账号映射页签。见 §4 P1-4。

### 2.4 中心库探针 / 测试账号：**已全部墓碑，无需清理**

```
活跃用户（deleted=0）总数 = 2   →  id=1 admin（平台超管） + id=302 p10x（常驻低权回归账号，文档指定保留）
全部 p12* / probe* 探针账号 deleted=1（已墓碑）：
  p12bff_probe(351) ✓  p12probe(309) ✓  p12pb…(316) ✓  probeuser(148) ✓
  p12_appadmin(337) ✓  p12_normal(330) ✓  p12_victim(344) ✓  p12_d7_*(14 个) ✓  p12dbg1bbd72(386) ✓
```

⇒ 进度文档 §4 #8「探针账号清理」**已实际完成**，无遗留待办。

### 2.5 容器时间线（与流水线对应）

| 容器 | CreatedAt | 对应 |
|---|---|---|
| portal-web | 2026-09-17 00:23 | R2 #801 |
| infra-monitor-web | 2026-09-17 00:32 | R2 #804 |
| infra-monitor | 2026-09-17 00:36 | R2 #806 |
| kb-ops-web | 2026-09-17 03:23 | R3 #808 |
| kb-ops | 2026-09-17 03:29 | R3 #810 |
| auth-center | 2026-09-16 14:56 | 三层 API 增补批（#61/#62/#63） |

### 2.6 仓库同步状态

| 仓库 | Gitee | GitHub | 判定 |
|---|---|---|---|
| `devtools`（dev） | `acee7d1e` | `acee7d1e` | ✅ 一致 |
| `marschat-components`（main） | `7053a0ae` | `7053a0ae` | ✅ 一致 |

> 注：本会话早期一次性读取曾见到 GitHub `dev=6bd545c`（落后 1），复测已为 `acee7d1e`，**当前无分叉**。历史教训仍成立：判断同步**必须 `ls-remote` 对远端取真实 tip**，不能看本地 tracking 引用。

### 2.7 🔴 新发现：UMD 版本戳与产物内容不一致

| 对象 | 值 |
|---|---|
| 线上 `https://tools.marschat.online/activecode/marschat-auth-core.umd.js` | `version = "0.8.7"` |
| 仓库内联副本 sha256 | `be44ea0a2d1666c7be460185e7b526116573b657a9a7a4fe05d0ac8cef903249` |
| 组件仓 dist sha256 | 同上（**逐字节一致**） |
| `active-manager/docs/VENDORED-auth-core-umd.md:10` | `\| 版本 \| \`0.8.8\` \|` |

**问题**：0.8.7 → 0.8.8 发版时**只改了 `VENDORED.md` 的版本戳，未重新构建 UMD**（R2 报告 §4 也记录了「UMD 内容未变」）。导致 `VENDORED.md` 声明 0.8.8、而产物自报 `0.8.7` —— **版本溯源链断裂**（坑 #13「版本/大小/sha256 三对齐」被破坏）。

**影响**：低。0.8.7→0.8.8 的差异全在 Vue 组件（`UserManagementPanel.vue`），UMD 入口（框架无关）不含该组件；activecode 是手写静态页，不使用 Vue 面板。**功能无差异，属溯源/流程缺陷。**

**建议**：下一次组件发版时**强制重建 UMD**（`pnpm build` 会产出），再跑 `sync-auth-core-umd.sh`；或为 `sync-auth-core-umd.sh` 增加「版本戳必须等于产物内 `version` 常量」的校验门禁。

---

## 3. 已完成清单（提交 / 流水线 / 落点，总表）

| 批次 | 内容 | 提交 | 流水线 |
|---|---|---|---|
| P0-1 | portal 免登短路 `portal_reauth_once` 移除 | `27ca74d` | #798 ✅ |
| P0-2 | cosmic `menu-report-secret` 配置真源补齐 | `27ca74d` / `1e833b1` | — |
| P0-3 | activecode 接口权限闸门 + 匿名洞修复（含注册 `PermissionInterceptor`） | `019f25d` → `e4b1d0b` → `ffda9f7` | #796 / #797 ✅ |
| R1 | auth-center 三层权限 API 地基 | `f139ea0` | #60 ✅ |
| R1b | D-7 受限读端点 + R8 自锁（23/23 GREEN） | `d77b322` / `abcc7b6` / `d3152b5` | #61 / #62 / #63 ✅ |
| D-3 | 共享组件 0.8.8（app 作用域收口）+ `sass` 依赖修复 | `fb5c920` + merge `9908fba` | 发 Nexus npm-hosted（shasum `5e99372a`） |
| 收窄 | activecode / infra-monitor BFF 白名单（默认拒绝） | `b081268` | #799 / #800 ✅ |
| 收窄 | cosmic 中心透传四删二（reset_password / delete_user） | `1adefa3` | #119 ✅ |
| R2 | 4 前端升 0.8.8 + 2 BFF 移出 create/update + UMD 版本戳 | `d964692` | #801~#806 ✅（QA 独立验证 PASS） |
| R3 | kb-web / kb-ops `/admin` 同源化 | `6bd545c` | #807~#810 ✅ |
| 文档 | Phase 12 ADR 入库 + Phase 11 ADR 纠偏 + INDEX 补登 | `7f6bfc9` | — |
| 订正 | F1 订正为「三处共用对称密钥（+ kb-ops via `MARSCHAT_AUTH_SECRET`）」 | `acee7d1e` | — |

---

## 4. 剩余项总表（按优先级，含 file:line 与改法）

### 4.1 🔴 P1（下一轮主线）

#### P1-1 · 应用台「成员层」path 化（Membership API 前端接入）
- **现状**：应用台（6 个）仍走旧端点 `GET /admin/users?client=<id>`、`PUT /admin/users/{uid}/client-roles?client=<id>`（`?client=` 是**查询参数**，不是权限边界）。
- **目标**（ADR D-1/D-2 已定）：改用 path 化端点
  | 语义 | 目标端点 |
  |---|---|
  | 列本系统成员 | `GET /admin/clients/<id>/members` |
  | 查/绑/解本系统角色 | `GET|PUT /admin/clients/<id>/users/{uid}/roles` |
  | 移出本系统 | `DELETE /admin/clients/<id>/members/{uid}` |
  | 加人（批量） | `POST /admin/clients/<id>/members {userId, roleIds}` |
  | 菜单减法 | `PUT /admin/clients/<id>/users/{uid}/menu-overrides` |
- **改动面**：`packages/auth-components/src/utils/userAdmin.ts`（`createUserAdminClient` 现无 `members` 形状 → 需扩展或新增 `createMemberAdminClient`）+ 各应用宿主页 baseUrl 拼接 + activecode 手写页 `members.html`（`:216/260/274/290/302/320/325/356`，无构建、需手工改，易漏）。
- **依赖**：无需重启（中心端点已在 `f139ea0`/`d77b322` 落地）；应用侧需各发一次版。
- **风险**：中。旧 `?client=` 端点已标 `@Deprecated` 但**保留作回滚路径**，两版可并存一个发版周期。

#### P1-2 · kb-ops「假闸门」整改（类级 `menu:*` → 方法级 `api:*`）
- **现状（源码实读）**：13 个 Controller 中
  - **HostController** 已是正确形态（类级 `menu:hosts` + 方法级 `api:hosts:create/update/delete`，L36/42/48）；
  - **10 个 Controller 仅类级 `menu:*`**（Service/Port/Credential/Domain/Dependency/Deployment/Conflict/Knowledge/Import/Dashboard）→ **给某人开菜单 = 同时给了写权限**（手册 §5 明令的「假闸门」）；
  - **OperationLogController、SyncController 完全无权限注解**，其中 `SyncController.java:19 syncFromIntelligence` 是**无闸门的写接口**；
  - `menu-registry.yml` 的 `apis:` 段（L80-85）**只声明 3 个点**（全是 `hosts:*`）。
- **改法**：新增 **24 个 api 点**（`services/ports/credentials/domains/dependencies` × create·update·delete = 15，`deployments:create`、`conflicts:detect|resolve`、`knowledge` ×3、`import:exec|csv`、`dashboard:refresh`），逐方法挂 `@RequirePermission("api:<key>")`。
- **⚠️ 上线注意**：strict 默认最小权限下 **api 点不自动授予** → 上线后**所有用户写权限即刻失效**，须管理员在中心补授权。**必须与授权操作同窗口执行**，否则视为「点了就报错」。
- **文件**：`kb-ops/src/main/java/com/kb/ops/controller/*.java`（10 个文件）、`kb-ops/src/main/resources/menu-registry.yml`。

#### P1-3 · kb-ops 用户页瘦身（拆平台级页签）
- **现状**：`kb-ops/kb-ops-web/src/views/users/UsersView.vue`
  - `:10`「账号映射」页签 → R3 已加 `v-if="isPlatformAdmin"` ✅
  - `:7-8`「**菜单授权**」页签（`MenuPermissionPanel`，走 `/admin/roles/{id}/permission-codes`、`/admin/clients/{id}/menus`）→ **仍无守卫** ❌，属平台级能力挂在应用台
- **改法（择一，需产品定）**：(a) 与账号映射同口径加 `v-if="isPlatformAdmin"`（最小改动，保留入口）；(b) 整体迁到 portal 中心台并删除本页签。
- **下游确认**：删除前需确认无书签/文档依赖（ADR 待办 #11）。

#### P1-4 · 本地「修改密码」端点下线（P1-8）
- **现状**：口令真源已归中心，但本地端点仍在做**无意义的本地口令比对**：
  - `active-manager/.../controller/AuthController.java:227` `@PostMapping("/change-password")`（L241-242 本地 `hashPassword` 比对）
  - `portal/portal-server/.../controller/AuthController.java:146`（L160 `passwordUtil.matches`、L164-165 直改 `sys_user.password`）
- **改法**：改为 410 Gone + 引导走中心「忘记密码」或中心管理台重置；**严禁**改回本地比对。（F4 遗留，见 README §6）

#### P1-5 · E2E 场景 B~F 补测 + 已认证端到端验收
- **现状**：`p12-browser-e2e.md` 仅场景 A（SSO 免登 5/5）完成；**B~F 因配额中断未执行**：
  B 各应用独立登录 / C 邮箱码+忘记密码闭环 / D 错误提示文案 / E P0-1 回归（连续两次 401 仍免登）/ F P0-3 回归（匿名 401、无权限 403）。
- **R3 遗留**：kb-web / kb-ops **已认证**端到端未验（平台管理员「账号映射」tab 显隐、BFF 带 token 时 POST/PUT → 404）。
- **判据**（R3 §五）：需良哥用真实账号走一遍，或提供测试账号后补验。

#### P1-6 · 服务端自我保护 / 审计日志 / 凭据共享存储 / 反向视图（P1-5~P1-9，排期）
- 服务端拒绝「移除自己」「移除最后一个应用管理员」（R8 已在中心实现 ✅；应用 BFF 侧仍无纵深防御）；
- `/admin/**` 写操作落 `sys_admin_audit` + 两个面板「变更历史」抽屉；
- 中心凭据暂存从**进程内存**（infra `CenterSessionStore`、cosmic `_oidc_tokens`、activecode）改为可共享存储 → 消除「应用重启即 401」；
- 中心台补「应用 × 用户」反向视图 + 「有效权限」只读溯源抽屉。

### 4.2 🟠 待良哥拍板（4 项，阻塞后续）

| # | 事项 | 现状 / 选项 |
|---|---|---|
| **D-1** | **F1 共享 JWT 密钥轮换** | 实测**三处共用**（auth-center / kb-gateway / kb-ops，长度 58、sha256 同值，且为「明文默认样式」）。**方案已出**（`p12-f1-jwt-rotation-plan.md`）：阶段 1 下游改 JWKS 公钥验签（共享面 3→1），阶段 2 auth-center 双密钥过渡轮换。**两阶段顺序不可颠倒**。影响：阶段 1 会令 legacy HS 会话 401（需重登一次）。 |
| **D-2** | **3.2-B 令牌分离** | 现状「应用令牌 = 中心令牌」，中心凭据落浏览器 localStorage。3.2-A 同源化已完成；B 需网关自签应用令牌 + Redis 持中心令牌，**三种验签并存、影响 kb-web/kb-ops 全部 API**。建议列为 Phase 13 专项，**第一版只覆盖 `/kb/api/admin/**`**。 |
| **D-3** | **auto-git-sync 处置** | `/etc/cron.d/auto-git-sync` 每 10 分钟 `git add -A` + commit + `pull --rebase` + push（gitee）。已两次干扰施工（R2 抢跑 `2370e19`）。选项：停用 / 保留但排除本项目 / 保留现状。**未改长期开关**。 |
| **D-4** | **auth-center `715b41e` 是否推** | `clients.yml` 补 cosmic `menu-report-secret` 一行（env-only）。推会触发枢纽重建（预计无运行时变化）。建议随下次正常发版带上。 |

### 4.3 🟡 P2（技术债 / 打磨，本会话已定位到行）

| # | 项 | 位置 | 改法 |
|---|---|---|---|
| P2-1 | **BFF 重复 `client` 参数（HPP）** | activecode `AdminProxyController.java:252-255,258-271`；infra-monitor 同构 `:250-253,256-269` | `queryParam` **取第一个命中即 return**，而 `extractCenterPath` **整串转发** → `?client=own&client=other` 可「首值过校验、整串转发」。**改法**：`clientScopeOk` 发现 `client` 键 >1 次即拒绝（fail-closed），或在转发前**用已校验值重建查询串**。QA 已证中心侧无数据泄漏（低危），但应消除不对称。 |
| P2-2 | **apps-registry 明文 secret 默认值入 git** | `devtools/apps-registry.yml` **L24**（portal client secret）、**L45/L86/L113**（kbweb/inframon/activecode `menu-report-secret`） | 改为 env-only 空默认（照抄 cosmic **L148** 写法 `${COSMIC_MENU_REPORT_SECRET:}`）。**⚠️ 改前须确认部署机已注入同名 env**，否则 portal 客户端密文失效 / 上报静默降级。 |
| P2-3 | **文档漂移** | `marschat-components/docs/README.md` L52（`0.8.6 sha256 fe949f00…`）、L92（`portal/activecode 无 public 菜单`）、L315（`(0.8.6)`） | **本会话已修正**（见 §6）。 |
| P2-4 | **UMD 版本戳不一致** | 见 §2.7 | 下次发版强制重建 UMD 或加校验门禁。 |
| P2-5 | **portal 无 public 菜单需显式注释** | `portal/portal-server/src/main/resources/menu-registry.yml`（59 行，`menus:` 仅 manage/users，无 `public: true`） | 在 `menus:` 段首补一行注释「本应用为卡片式门户 + 平台台寄生，**有意不设 public 落地页**」，固定该决策。 |
| P2-6 | **cosmic `/admin` 路由语义撞车** | `cosmic-studio/frontend/src/router.js:25`（`path:'admin'`，`meta.perm=menu:admin`）；`views/Admin.vue` L4-24（LLM 配置）与 L32 起（本系统用户）同页同权限点 | 建议 `path:'admin'` → `'members'`，并把 LLM 配置拆为独立路由。影响直达链接 / menu-registry path / nginx，需一并改。 |
| P2-7 | **activecode 超管例外归因** | `active-manager/.../AuthController.java:441-446`（`.last("LIMIT 1")`） | **已收敛**为「仅平台超管触发」的受控回退（非越权默认值）。残留问题仅是**所有平台管理员共用同一条本地影子记录**，审计无法区分操作者 → 建议按中心 username 逐条建档。**可降级为 P2。** |
| P2-8 | **infra 忘记密码跨应用依赖** | `infra-monitor-web/src/views/login/LoginView.vue:40` `authApiBase: '/kb/api/auth'` | infra 域借道 kb-gateway，mykng 不可用则 infra 无法自助改密 → 建议 infra nginx 增直连 auth-center 的 `/auth-api/` 路由。 |
| P2-9 | **portal 忘记密码无后端端点** | `portal/src/views/LoginView.vue:37` `authApiBase: '/portal/auth-api'`；实测 `portal-server` **无** forgot-password / reset-password 端点（仅注释命中 `SsoController.java:212`） | 完全依赖 main 域 nginx `/portal/auth-api/` 路由可达 —— **需线上实测取证**后回写 ADR。 |
| P2-10 | **CI UMD 同步未 wiring** | `woodScript/ci/build-active-manager.sh` 从未调用 `sync-auth-core-umd.sh` | 在 mvn 前加同步步骤，或加「漂移检测」步骤（内联副本 ≠ 组件产物即失败）。 |
| P2-11 | **多余客户端 / 0 权限点客户端** | `sys_app_client` 含 `marschat-tokenhub` / `marschat-memory` / `frp-manager` / `p3-probe-client`；其中 `marschat-tokenhub` 在 `sys_permission` **0 权限点** | 待产品/架构确认是否清理 / 是否属接入缺口。 |
| P2-12 | **文档口径订正** | ADR / 任务书多次写 `sys_user` | 真源表名是 **`user`**（另有 `user_identity`）；建议统一文档口径。 |

---

## 5. 风险与已知取舍（登记，非缺陷）

| # | 项 | 说明 |
|---|---|---|
| 1 | 前端守卫 **fail-open** | SSO/权限探针失败时不拦用户（防中心抖动踢人在线用户）；靠**接口层 403 兜底**。**必须登记为已知权衡**。 |
| 2 | 管理页数据接口 **fail-closed** | BFF 拿不到中心凭据 / 中心不可达 → 明确 401/502，**不返回空列表冒充成功**。 |
| 3 | 应用账密登录强依赖中心可用性 | Phase 11 设计取舍：中心故障 → 全平台不可登录（SSO 本就是强依赖，未恶化）。 |
| 4 | cosmic 权限查询 401 → 菜单 fail-open | 中心令牌 30 min 过期窗口内菜单级限制暂失效，写接口硬闸门不受影响。 |
| 5 | 账号上报仅**启动时**执行 | 运行期新建本地账号需重启才登记。 |
| 6 | OIDC 径无 `tv` 版本校验 | `JwtAuthenticationFilter` RS256 径不校验 token 版本（改造前即存在）。 |
| 7 | IdP 会话 Cookie `secure=False` | HTTPS 站点下会话 cookie 未标 Secure，建议 nginx/应用层统一加固。 |
| 8 | 无 `api:admin:write` 权限点的 client **无应用管理员** | 判据依赖该 client 定义该权限点；未定义者只有平台管理员可管（fail-closed），符合最小权限。 |

---

## 6. 本会话（2026-09-17）实际完成动作

| # | 动作 | 结果 |
|---|---|---|
| 1 | 通读两份文档目录（`marschat-components/docs` + WorkBuddy `p12-*` 共 17 份）并建立 Phase 12 全景 | ✅ |
| 2 | 线上实测核验（4 前端 0.8.8 / kb-gateway 路由 / R3 落点 / 探针账号 / 容器时间线 / 仓库同步） | ✅ 见 §2 |
| 3 | devtools GitHub `dev` 同步核验 | ✅ 已与 Gitee 一致（`acee7d1e`），无需镜像 |
| 4 | **修正 `docs/README.md` 三处文档漂移**（P2-3） | ✅ L52 `0.8.6 sha256 fe949f00…` → `0.8.8 sha256 be44ea0a…`；L315 `(0.8.6)` → `(0.8.8)`；L92 「portal/activecode 无 public 菜单」→ 「portal 无 public 菜单（activecode 以 `index` 为唯一 public 落地页）」 |
| 5 | **新增本文档**（Phase 12 收口汇总）并在 README 挂指针 | ✅ |
| 6 | 探针账号清理核查 | ✅ 结论：已全部墓碑，无需操作 |
| 7 | 未决项定位到 `file:line` 并分级 | ✅ 见 §4 |

> **未做（有意保留）**：未改动任何线上服务行为、未触发流水线、未执行生产 DB 写操作、未轮到需拍板/需协同授权的项目（kb-ops api 点授权、F1 轮换、auto-git-sync）。理由：这些项要么需要**决策**，要么需要**与授权操作同窗口执行**（否则立即产生「点了就报错」），不宜单方面推进。

---

## 7. 建议执行路线（给下一轮）

| 序 | 任务 | 依赖 | 备注 |
|---|---|---|---|
| 1 | **D-1 F1 阶段 1**（下游改 JWKS 验签） | 拍板 | 单独立项；先在低峰期抓一次线上流量确认无 HS 发签方 |
| 2 | **P1-2 kb-ops 假闸门整改 + 中心授权同窗口** | 无 | 纯收益；**必须同步补授权** |
| 3 | **P1-3 kb-ops 菜单授权页签守卫** | 产品定夺 (a)/(b) | 一行 `v-if` 或整体迁移 |
| 4 | **P2-1 BFF 重复 client 加固**（2 文件同构） | 无 | 低危，可与 #2 合并一个发版 |
| 5 | **P1-1 应用台 path 化（Membership API 接入）** | 组件契约扩展 | 需改 `userAdmin.ts` + 6 宿主页 + activecode 手写页 |
| 6 | **P1-5 E2E B~F + 已认证端到端** | 测试账号 | 建议与 #1/#5 之后整体回归 |
| 7 | P2-2 / P2-5 / P2-6 / P2-8 / P2-9 / P2-10 | 各自独立 | 可与上述并行穿插 |

---

## 8. 环境速记与可复核命令

| 项 | 值 |
|---|---|
| mykng | `ssh root@192.168.31.105`（免密） |
| auth-center | `http://192.168.31.105:8085` |
| activecode | `http://192.168.31.182:18080/activecode/`（**不在 mykng**） |
| infra-monitor | `http://127.0.0.1:8088/infra`（host 网络；登录径 `/infra/auth/login`，**不是** `/infra/api/auth/login`） |
| Woodpecker | `https://woodci.marschat.online`（repo_id：1=devtools / 3=cosmic / 4=auth-center / 5=marschat-components） |
| 工作克隆（服务器） | `/root/devtools`（= `acee7d1e`）、`/root/components-work`（= `7053a0ae`）、`/root/auth-center-work`、`/root/devtools/cosmic-studio` |
| MySQL | 容器 `platform-mysql-1`，库 `marschat_auth`；真源用户表名 **`user`** |
| Nexus | `192.168.31.105:8083`（Docker）/ `:8081`（npm 等） |
| 凭据 | 一律见 Vaultwarden（`vault.marschat.online`）或 infrastructure-map 技能；**任何文档不得出现明文** |

```bash
# 前端产物 0.8.8 判据（4 容器）
for c in portal-web kb-web kb-ops-web infra-monitor-web; do
  docker exec "$c" sh -c 'grep -rl "用户信息（只读）" /usr/share/nginx/html | head -1'
done

# 中心库活跃用户（预期 = 2：admin + p10x）
P=$(docker exec platform-mysql-1 env | grep MYSQL_ROOT_PASSWORD | cut -d= -f2-)
docker exec platform-mysql-1 mysql -uroot -p"$P" marschat_auth \
  -e "SELECT COUNT(*) AS active FROM user WHERE deleted=0;"

# 仓库同步（必须对远端取 tip）
git -C /root/devtools ls-remote origin dev; git -C /root/devtools ls-remote $(git -C /root/devtools remote get-url origin) dev
```

---

## 9. 文档索引（Phase 12 全套）

**本仓（marschat-components/docs）**
| 文件 | 内容 |
|---|---|
| `README.md` | 统一认证平台权威手册（设计 / 接入 / 使用运维） |
| `PHASE12-PROGRESS-2026-09-16.md` | Phase 12 进度交接快照（9-16 18:00 视角） |
| **`PHASE12-SUMMARY-2026-09-17.md`** | **本文** —— Phase 12 收口汇总 + 剩余项与决策清单 |
| **`PHASE12-ROUND6-2026-09-18.md`** | R6 多轮浏览器回归（SSO + 独立登录双通道）+ D2/D3 缺陷修复 + 2 条测试误判 |

**workspace 文档（`C:\Users\13871\WorkBuddy\2026-09-16-01-25-17\docs\`）**
| 文件 | 内容 |
|---|---|
| `p12-architect-design.md` / `p12-architect-audit.md` | 设计规格 / 全量复核报告 |
| `p12-authcenter-3layer.md` | 三层权限 API 地基 + D-7/R8 增补批（含实测与回滚） |
| `p12-menu-ux-spec.md` | 两类菜单逐文件前端规格 |
| `p12-bff-narrow.md` / `p12-cosmic-narrow.md` | 各应用 BFF 白名单收窄执行报告 |
| `p12-kbweb-kbops-samesite.md` / `p12-r3-samesite.md` | kb-web·kb-ops 同源化取证 / 实施报告 |
| `p12-r2-workorder.md` / `p12-r2-report.md` / `p12-r2-qa.md` | R2 工单 / 施工报告 / QA 独立验证 |
| `p12-activecode-gate.md` / `p12-engineer-probe.md` / `p12-engineer-fix.md` | activecode 闸门 / 线上核验 / P0 修复 |
| `p12-authcenter-deploy-audit.md` / `p12-browser-e2e.md` / `p12-f1-jwt-rotation-plan.md` | 部署链路调查 / E2E 中期报告 / F1 轮换方案 |

**devtools 仓**：`docs/adr/ADR-2026-09-16-Phase12-统一认证权限治理.md`（权威演进，含 §4.5 纠偏与 §7 待办）

---

---

## 10. 追加 · R4 收口（2026-09-17 下午）

> 本轮只做「**无需决策、可自包含落地、风险可控**」的项。提交 `1061d2d`（devtools `dev`，Gitee + GitHub 双推，`ls-remote` 三方一致）。
> 流水线：**#811 active-manager ✅ / #812 infra-monitor ✅ / #814 kb-ops-web ✅ / #815 kb-ops ✅**。
> （#813 kb-ops-web 首跑在 `sync-ci-scripts` 挂掉——该步会全量重写 CIFS 上的 `/mnt/shared/woodScript`，属瞬时抖动；原号重触发即过。）

### 10.1 已闭合项

| # | 项 | 改动 | 验证证据 |
|---|---|---|---|
| P2-1 | **BFF 重复 `client` 参数（HPP）加固** | 三个 `AdminProxyController`（activecode / infra-monitor / kb-ops）的 `clientScopeOk` 前置 `countParam(query,"client") > 1 → 拒绝`，并新增 `countParam` 工具方法 | **已部署字节码核验**：三容器 jar 内 `AdminProxyController.class` 均命中 `countParam`（infra-monitor / kb-ops 在 mykng；activecode 在 `192.168.31.182`） |
| P1-3 | **kb-ops「菜单授权」页修复（R3 遗留坏功能）** | `kb-ops` BFF 白名单补登 `GET /admin/permissions`（带 `client` 校验）+ `GET|PUT /admin/roles/{id}/permission-codes`；新增常量 `ROLE_PERM_CODES` | 字节码核验命中 `permission-codes`。**根源**：`MenuPermissionPanel` 共调 4 个中心端点，R3 白名单只放行 1 个 → 另 2 个落 404，平台管理员在 kb-ops 也点不动「菜单授权」 |
| P1-3 | **kb-ops 菜单授权页签守卫** | `kb-ops-web` `UsersView.vue` 页签加 `v-if="isPlatformAdmin"`（与账号映射页签同口径，应用管理员不再看到平台级面板） | kb-ops-web 已重建（`index-CtFTTybh.js`） |
| P2-5 | **portal 显式注明「有意不设 public 菜单」** | `portal-server/src/main/resources/menu-registry.yml` 增 3 行注释，防后人误加 `public: true` | 纯注释、零行为；**未部署**（下次自然发版带上） |

### 10.2 本轮判定结案（原 ⚠️ 项）

| # | 原状 | 实测结论 |
|---|---|---|
| P2-9 | portal 忘记密码「代码侧无后端端点、依赖 nginx，无从保证」 | ✅ **线上可用**：`POST https://main.marschat.online/portal/auth-api/forgot-password` → **200**（中心 `code:200`）。链路 = nginx `/portal/auth-api/` **直连 auth-center**，不经 portal-server（故 portal-server 无该端点是设计使然，非缺陷）。 |
| P2-10 | infra 忘记密码跨应用依赖 kb-gateway | ✅ **线上可用**：`POST https://monitor.marschat.online/kb/api/auth/forgot-password` → **200**。但**架构耦合仍在**（借道 mykng/kb-gateway；mykng 不可用则 infra 无法自助改密）→ 仍建议按 P2 加固。 |

### 10.3 验证口径修正（重要，供复核）

**BFF 白名单不能用「无凭据 401 vs 404」区分**：三个应用的 Spring Security 过滤器在 controller **之前**即返回 401（infra-monitor / activecode）或 403（kb-ops），而白名单判定在 controller 内 —— 未鉴权请求根本到不了白名单。
⇒ 本轮改用**已部署产物字节码核验**（`docker cp` 取出 jar → 抽 `AdminProxyController.class` → grep 新增符号），此为决定性证据。
带会话的**功能级**验证仍需真实账号 → 仍归 §4.1 P1-5。

### 10.4 R4 后仍未做（分类不变）

| 类别 | 项 |
|---|---|
| 需**拍板** | F1 密钥轮换 / 3.2-B 令牌分离 / auto-git-sync 处置 / auth-center `715b41e` 推送 |
| 需**协同**（同窗口） | kb-ops 假闸门整改（24 个 api 点，须与中心授权同时执行，否则立即「点了就报错」）；apps-registry 明文 secret 改 env-only（改 `clients.yml` 会触发 auth-center 枢纽重建） |
| 需**发版工程** | 应用台 Membership API path 化（组件契约 + 6 宿主页 + activecode 手写页） |
| 需**真浏览器 + 真实账号** | E2E 场景 B~F、已认证端到端验收 |
| 低优先 | 本地改密端点下线（P1-4）、cosmic `/admin` 改名、UMD 重建（§2.7）、CI UMD 同步 wiring |

---

## 11. 追加 · R5 收口（2026-09-17 晚）

> 本轮按良哥指示执行「item 2（kb-ops 假闸门整改）+ item 3（E2E B~F 与已认证端到端）」。
> 提交 `88aa2c3`（devtools `dev`，Gitee + GitHub 双推，`ls-remote` 三方一致）；流水线 **#816 kb-ops SUCCESS**。

### 11.1 item 2 · kb-ops「假闸门」整改（已上线 + 功能级验证）

**问题**：10 个 Controller 只有**类级** `@RequirePermission("menu:xxx")` —— 给某人开菜单＝同时给了写权限；`SyncController` 更是**完全无权限注解**（任意登录用户可触发全量同步）。

**改动**（与既合规的 `HostController` 范式完全一致：类级 `menu:*` 保留为访问闸门 + 方法级 `api:*` 作为写闸门）：

| 范围 | 内容 |
|---|---|
| 25 个写点 | `services/ports/credentials/domains/dependencies/knowledge` × create·update·delete（18）、`deployments:create`、`conflicts:detect`·`resolve`、`import:exec`·`csv`、`dashboard:refresh`、**`sync:run`** |
| `SyncController` | 补 `import` + `@RequirePermission("api:sync:run")`（全仓无调用方，零回归） |
| `menu-registry.yml` | `apis` 段 **3 → 28** 个权限点 |

**授权影响与实测（关键）**：

| 项 | 结果 |
|---|---|
| 新增权限点注册 | ✅ 中心 `sys_permission` kb-ops api 点 **3 → 28** |
| 应用管理员加法补齐 | ✅ **role 78（应用管理员）自动获得 28/28**，无遗漏（上线前已实测该机制有效） |
| 活跃用户 | 仅 `admin`(超管) + `p10x`(常驻回归) —— 本次上线实际影响面最小 |
| 超管放行 | `POST /ops/service` → **400**（过闸门落参数校验）、`POST /ops/port` → **500**、`POST /ops/dashboard/snapshot/refresh` → **200** |
| 🔴 **决定性证据** | 只授 `menu:services`、**不授任何 api 点**时：`GET /ops/service/list` → **200**；`POST /ops/service`、`DELETE /ops/service/999999` → **403** ⇒「**开菜单 ≠ 给写权限**」成立 |
| 无闸门写接口已封堵 | 低权用户 `POST /ops/sync/from-intelligence` → **403**（整改前该接口无任何权限注解） |
| 现场还原 | role 15 权限绑定精确还原为空；两个临时探针账号（435/442）已墓碑；活跃用户仍为 2；kb-ops 成员行数回到基线 2 |

> 附带验证：R1 的 path 化端点 `PUT /admin/clients/{cid}/users/{uid}/roles` 工作正常。

### 11.2 item 3 · 浏览器级 E2E（A~F）+ 已认证端到端

**环境**：mykng `headless chromium + CDP`（Python `websockets` 直连）；因本机 `/etc/hosts` 把 `kb/ops.marschat.online` 钉到 127.0.0.1，用 `--host-resolver-rules` 指向公网入口 `1.117.70.30`，走真实用户路径。

| 场景 | 内容 | 结果 |
|---|---|---|
| **A** | SSO 单点免登：portal 未登录→点 SSO→IdP 登录一次→回跳；再访问 kb-web / kb-ops / infra / cosmic / activecode | ✅ **5/5 全部免登**；**口令输入总次数 = 1**（铁律达标） |
| **B** | 应用登录页独立账密登录（BFF→中心） | ✅ 成功进入 `/portal/` |
| **C1/C2** | 邮箱验证码：发送反馈 + 60s 频控 | ✅ 「验证码已发送」/「**验证码发送过于频繁，请 60 秒后再试**」 |
| **C3** | 忘记密码入口 → 四步找回第 1 步 | ✅ 出现「请输入您的注册邮箱，我们将发送验证码」+ 发送验证码 + 返回登录 |
| **D1/D2** | 错误提示文案 | ✅ 错误口令与**不存在账号返回同一文案「用户名或密码错误」**（正确的防枚举设计） |
| **E** | P0-1 免登短路回归：带 IdP 会话重访登录页 | ✅ 自动免登，无密码框 |
| **F** | P0-3 activecode 匿名闸门回归 | ✅ 匿名 `POST /activation/generate` → **401**；匿名 `GET /config/default-expire` → **401**；自助页「有效期」因被拦未加载 |

**已认证端到端（闭合 §4.1 P1-5 的 R3 遗留）**：

| 验证 | 结果 |
|---|---|
| 真实会话 token 打 kb-ops BFF | `GET /admin/users?client=marschat-kbops` **200**；`/admin/permissions?client=marschat-kbops` **200**、`/admin/roles/78/permission-codes` **200**（R4 新放行生效）；重复 `client` **404**（R4 HPP 生效）；`/admin/authorization-matrix` **404**（未登记仍拒） |
| 浏览器级 · kb-ops `/ops/users` | 页签 `[用户, 菜单授权, 账号映射]` 对超管**全部可见**（R4 守卫不误伤超管）；用户列表正常加载 |
| 浏览器级 · kb-web `/kb/users` | 列表正常加载（R3 同源化端到端成立） |

**未执行 / 边界**：邮箱验证码**闭环**需真实邮箱收码，本轮只验到「发送 + 频控 + 错误文案」；发送到不存在邮箱不会产生真实邮件。

**测试脚本自身 3 次误判（已修正，非产品缺陷，登记以免后人重踩）**：
① `querySelectorAll('*')` 取「忘记密码」时命中 `body` → 点击无效；
② 点中了父 `div`（宽 342px 的中心空白）而事件处理器在**子 `<a>`** 上，且事件只向上冒泡 → 无反应；
③ Toast 抓取时机不对（读取时已消失）→ 改用 `MutationObserver` 后才拿到真实文案。

### 11.3 R5 后仍未做

| 类别 | 项 |
|---|---|
| 需**拍板** | F1 密钥轮换 / 3.2-B 令牌分离 / auto-git-sync 处置 / auth-center `715b41e` 推送 |
| 需**发版工程** | 应用台 Membership API path 化（组件契约 + 6 宿主页 + activecode 手写页） |
| 需**协同** | apps-registry 明文 secret 改 env-only（改 `clients.yml` 会触发 auth-center 枢纽重建） |
| 低优先 | ~~本地改密端点下线（P1-4）~~ **R6 已闭合**、cosmic `/admin` 改名、UMD 重建（§2.7）、CI UMD 同步 wiring |

---

## 12. 追加 · R6 多轮浏览器回归与缺陷修复（2026-09-18 凌晨）

> 详见 **`docs/PHASE12-ROUND6-2026-09-18.md`**（本轮完整证据与误判清单）。摘要：

| # | 项 | 结果 |
|---|---|---|
| 1 | SSO 免登 6/6、深链拦截 6/6、401 静默续期 2/2、登录方式可达性 5/5、独立账密登录 5 应用 × 2 轮全绿 | ✅ |
| 2 | 🔴 **D2 高危**：portal / activecode 本地改密端点**真改本地影子口令**（中心不变 → 身份分裂） | ✅ 已修：端点 410 Gone + portal 下拉改「重置密码（走统一认证）」，提交 `ad356c90` |
| 3 | 🟡 **D3 低危**：`auth.marschat.online/favicon.ico` 403/404，六应用 SSO 全程各一条 console 报错 | ✅ 已修：permitAll + 静态图标，提交 `509c4de` |
| 4 | 🟢 认知订正：kb-web「修改密码」经 kb-gateway 代理到中心，是**正确范式**，应推广 | 已写入手册 §6.0 |
| 5 | 测试脚本误判 ×2（跨域 `/auth/session` 是 SLO 探针；「退出登录」在 Element Plus 下拉内未展开时不在 DOM） | 已登记 `TROUBLESHOOTING.md` §6 ⑬⑭ |
| 6 | kb-web `[api] 请求失败`、infra 一条 401：专项复跑 3 轮 0 命中 | 登记待观察，不臆断 |

> ⚠️ **排查纪律（新增）**：改密端点是**会真改口令的写操作** —— 本轮探测过程中曾真的改掉本地/中心口令，均已还原并复核。定位一律优先用「错误旧口令应被拒」的负例。

*生成：2026-09-17（§1-§11）· 2026-09-18 追加 §12 · 依据：WorkBuddy 会话归档 17 份 + mykng 线上实测 + 源码实读 · 维护人：接手 Phase 12 的下一轮执行者*
