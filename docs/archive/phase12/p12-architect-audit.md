# Phase 12 · 统一认证平台全量复核报告（架构师视角）

- **评审人**：software-architect（架构师）
- **日期**：2026-09-16
- **范围**：6 个自研应用（portal / activecode / kb-web / kb-ops / infra-monitor / cosmic）+ 公共组件 + 认证中心
- **方法**：**只信代码与配置，不信任任何历史结论**（手册/README、Phase 10/11 ADR 的结论一律按"待证"处理）
- **约束**：本轮未修改任何代码；报告中不出现任何明文密码/secret

---

## 0. 一句话结论

> **Phase 11 的"账密真源归一"确实落地了（D1-D5 全部成立），但收口质量参差不齐：**
> **4 个 P0 缺陷未闭环**（portal 免登短路未修、cosmic 权限点上报仍未生效、activecode 完全没有接口闸门、kb-web/kb-ops 用户管理仍直连中心且把中心管理凭据存在浏览器）；
> **"权限统一管理"与"用户统一管理"两个初衷在 cosmic 上仍未真正达成**；
> **两类用户管理菜单的职责切分方向正确，但边界只在 UI 层（组件参数 scope），没有下沉到 API/BFF 层，存在 5 处可越权或易误操作的缺口。**

---

# A. 接入完成度矩阵（12 项 × 6 应用）

图例：✅ 成立 ｜ ⚠️ 部分成立/有隐患 ｜ ❌ 不成立 ｜ N/A 不适用

| # | 检查项 | portal | activecode | kb-web | kb-ops | infra-monitor | cosmic |
|---|---|---|---|---|---|---|---|
| ① | 登录页用公共组件 LoginPage/UMD | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ② | 独立账密转发中心 `/auth/login` | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| ③ | 邮箱验证码接中心 `/auth/mail-login/*` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ④ | 忘记密码接中心 `/auth/forgot-password` + `/reset-password` | ⚠️ | ✅ | ✅ | ⚠️ | ⚠️ | ❌ |
| ⑤ | SSO（OIDC PKCE）+ sso-callback 页 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ⑥ | 权限点上报（menu-registry + Reporter） | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| ⑦ | 有且仅有一个 `public: true` 菜单 | ⚠️ 0 个 | ✅ | ✅ | ✅ | ✅ | ✅ |
| ⑧ | 应用侧「本系统用户」菜单 | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ |
| ⑨ | 接口级权限闸门 | ✅ | ❌ | ✅ | ⚠️ | ✅ | ⚠️ |
| ⑩ | `startSessionWatcher` 加 `isOidcToken()` 判据 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| ⑪ | 无 `*_reauth_once` 一次性重授权短路 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ⑫ | 组件版本 ≥ 0.8.7 | ✅ | ❌ 0.8.6 | ✅ | ✅ | ✅ | ✅ |

**汇总**：❌ 5 处，⚠️ 9 处。

---

## A.1 逐项证据

### ① 登录页公共组件（6/6 ✅）

| 应用 | 证据 |
|---|---|
| portal | `devtools/portal/src/views/LoginView.vue:2` `<LoginPage>`，`:14` `import { LoginPage } from '@marschat/auth-components'` |
| activecode | `devtools/active-manager/activation-code-server/src/main/resources/static/activecode/login.html`（引用 `marschat-auth-core.umd.js`，无构建形态走 UMD） |
| kb-web | `devtools/mykng/kb-web/src/views/login/LoginView.vue:5,123` |
| kb-ops | `devtools/kb-ops/kb-ops-web/src/views/login/LoginView.vue`（`LoginPage`） |
| infra-monitor | `devtools/infra-monitor/infra-monitor-web/src/views/login/LoginView.vue:2,17` |
| cosmic | `cosmic-studio/frontend/src/views/Login.vue:3,16` |

### ② 独立账密是否转发 auth-center `/auth/login`（关键项）

| 应用 | 判定 | 证据 |
|---|---|---|
| portal | ✅ | `portal-server/.../controller/AuthController.java:44-57` —— `authCenterService.loginAsUser(username, password)`；异常→`BusinessException(503,"认证中心不可达")`（fail-closed，无本地回退）。本地 `sys_user` 已降级影子（`:99-139` 自动建档，密码字段随机占位） |
| infra-monitor | ✅ | `infra-monitor-server/.../controller/AuthController.java:92-117` —— `authCenterPost("/auth/login", ...)`；`:113-116` catch → `503`。原硬编码单管理员已停用 |
| activecode | ✅ | `activation-code-server/.../controller/AuthController.java:81-100` —— `proxyAjax("/auth/login", ...)`；`:94-99` 不可达→503，账密错→统一文案。本地 `admin_user` 降级影子，密码随机占位（`:131-135`） |
| cosmic | ✅ | `cosmic-studio/app/routers/auth.py:244-279` —— `_auth_center_post("/auth/login", ...)`；`app/auth.py:30-33` 明确「本地口令体系已整体下线，`hash_password`/`verify_password` 已删除」 |
| kb-web | ✅（但形态特殊，见下） | 应用无自有后端；`kb-gateway/src/main/resources/application.yml:83-88` 路由 `Path=/kb/api/auth/**` → `lb://auth-center`，`StripPrefix=2` → 直达中心 `/auth/login`。与 ADR D8 更正一致 |
| kb-ops | N/A | 后端无 `AuthController`（全仓 `**/AuthController.java` 仅 4 处：portal / infra / activecode / myfrp），无账密入口 |

**⚠️ kb-web 的形态隐患**：`kb-web/src/stores/user.ts:18-23` 把中心返回的 `data.accessToken` 直接 `setToken()` 并 `setTokenKind('legacy')` —— 即**浏览器 localStorage 里存的是 auth-center 的业务令牌（可执行 `/admin/**`），而不是应用自签会话**。这与手册 §3「三种令牌」的口径不符，且把"平台级管理凭据"暴露在浏览器（详见 P0-4）。

### ③ 邮箱验证码登录（6/6 ✅）

| 应用 | 证据 |
|---|---|
| portal | `portal-server/.../controller/SsoController.java:92` `@PostMapping("/auth/mail-login")`，BFF 转发中心 |
| infra-monitor | `AuthController.java:120`（send-code）、`:144`（登录），均 `authCenterPost("/auth/mail-login...")` |
| activecode | `AuthController.java:318`、`357`；白名单 `config/WebMvcConfig.java:46-49` |
| kb-web | `kb-web/src/views/login/LoginView.vue:103` `/kb/api/auth/mail-login`；网关白名单 `application.yml:178-179` |
| kb-ops | `kb-ops-web/src/views/login/LoginView.vue:64` `/ops/auth-api/mail-login` |
| cosmic | `app/routers/auth.py:464`、`480`，BFF 代理 + 自动建影子 |

### ④ 忘记密码（1 ❌ / 3 ⚠️）

| 应用 | 判定 | 证据 |
|---|---|---|
| activecode | ✅ | `AuthController.java:328`（forgot-password）、`:338`（reset-password），均 `proxyJson` 转发中心 |
| kb-web | ✅ | `authApiBase: '/kb/api/auth'`（`LoginView.vue:27`）；网关白名单 `application.yml:173-174` |
| portal | ⚠️ | `LoginView.vue:40` `authApiBase: '/portal/auth-api'`；但 **portal-server 内没有任何 `/auth/forgot-password` / `/reset-password` 的代理或处理端点**（全仓 grep 仅命中 activecode 与网关）。功能完全依赖 nginx 是否把 `/portal/auth-api/` 反代到中心/网关 —— **代码侧无从保证，需线上实测确认** |
| infra-monitor | ⚠️ | `LoginView.vue:40` `authApiBase: '/kb/api/auth'` —— **infra 域的忘记密码借道 kb-gateway**（跨主机、跨应用依赖）。一旦 mykng 主机/网关不可用，infra 用户无法自助改密。且 AuthController 注释 `:36` 直认「前端直连 `/kb/api/auth/forgot-password`（经 kb-gateway → auth-center）」 |
| kb-ops | ⚠️ | 全仓 grep `forgot-password` 未命中 kb-ops-web 源码；`LoginView.vue` 只实现了 mail-login。作为纯 SSO 应用（`showLocalLogin:false`）可辩护，但**登录页是否隐藏"忘记密码"入口需在真浏览器确认**（若显示而后端无路由＝死链接） |
| cosmic | ❌ | `Login.vue:36` `authApiBase: '/auth-api'`，注释称「nginx /auth-api/ → kb-gateway → auth-center」，但：① cosmic 后端**无** forgot-password/reset-password 代理端点（`app/routers/auth.py` 无此路由）；② `handlePasswordReset()`（`:127-130`）**只弹「如需重置密码，请联系系统管理员」**；③ 同样跨应用依赖 kb-gateway。→  Cosmic 的"忘记密码"实际不可自助闭环 |

### ⑤ SSO + sso-callback（6/6 ✅）

- portal：`src/views/SsoCallbackView.vue`（BFF 机密客户端，回调 `/auth/callback`，`router/index.ts:21`）
- infra / kb-web / kb-ops：各自 `src/views/sso/SsoCallbackView.vue` + `/{ctx}/sso-callback`
- cosmic：`frontend/src/views/SsoCallback.vue` + `router.js:11`
- activecode：`static/activecode/sso-callback.html`（`menu-registry.yml:6` 注明为匿名页）
- 网关侧：`kb-gateway/application.yml:233-236` OIDC issuer + 内网 JWKS 双验签配置齐全

### ⑥ 权限点上报（1 ❌）

| 应用 | 判定 | 证据 |
|---|---|---|
| portal | ✅ | `portal-server/src/main/resources/menu-registry.yml`（client `marschat-portal`，2 menu + 3 api） |
| infra-monitor | ✅ | `infra-monitor-server/src/main/resources/menu-registry.yml`（6 menu + 7 api） |
| kb-web | ✅ | 由 kb-gateway 代报：`kb-gateway/src/main/resources/menu-registry.yml`（15 menu + 10 api）；`application.yml:238-248` `marschat.menu.report` |
| kb-ops | ✅ | `kb-ops/src/main/resources/menu-registry.yml`（15 menu + 3 api） |
| activecode | ✅ | `activation-code-server/src/main/resources/menu-registry.yml`（8 menu + 6 api）+ 本地等价实现 `config/MenuRegistryReporter.java`（未引 auth-core） |
| cosmic | ❌ | `app/menu_report.py:47` `REPORT_SECRET = os.getenv("MENU_REPORT_SECRET","")`；`:89-91` 空则**直接 return 并 WARN**；`docker-compose.yml:23` `MENU_REPORT_SECRET: ${COSMIC_MENU_REPORT_SECRET:-}`（**默认空**）；且 `devtools/apps-registry.yml:128-139` 的 `cosmic-studio` 条目**根本没有 `menu-report-secret` 字段**（对比 `:45/:86/:113` kbweb/inframon/activecode 都有）。→ **D7 未修，cosmic 的权限点实际上报仍被跳过**，中心侧无 cosmic 的 menu/api 权限点可授 → `configured=false` → R10 全放行 |

> 附带：`apps-registry.yml` 中 **portal 条目也没有 `menu-report-secret` 段**（`:21-37`）。portal 的菜单/账号上报是否生效取决于部署环境是否注入 `MARSCHAT_MENU_REPORT_SECRET`，**无法从代码证真**，建议一并实测。

### ⑦ `public: true` 数量（1 ⚠️）

| 应用 | public 数 | 证据 |
|---|---|---|
| infra-monitor | 1（`dashboard`） | `menu-registry.yml:18` |
| kb-web | 1（`dashboard`） | `kb-gateway/menu-registry.yml:17` |
| kb-ops | 1（`dashboard`） | `menu-registry.yml:15` |
| activecode | 1（`index`） | `menu-registry.yml:20` |
| cosmic | 1 | `app/routers/studio.py:232` `"public": True`，由 `menu_report._registry_yaml:77-78` 转成 YAML |
| portal | **0** | `portal-server/src/main/resources/menu-registry.yml` 两个菜单（manage/users）均未标 public |

- portal 为 0 是**有意为之**（文件头部注释：portal 是卡片式门户，侧边栏非权限驱动；`/admin` 平台台刻意不登记）。可接受，但手册 §5 的同一句话「portal/activecode 无 public 菜单」中 **activecode 部分已过期**（现为 1 个 public）——文档漂移。
- **建议**：portal 的 0 public 应在 menu-registry 里写一行显式注释说明"本应用无受管落地页，故 0 个 public"，否则后来者会误判为漏配。

### ⑧ 应用侧「本系统用户」菜单（3 ⚠️）

| 应用 | 判定 | 证据 |
|---|---|---|
| portal | ✅ | 路由 `/users`（`router/index.ts:45-48`，`requiresAdmin` + `perm menu:users`）；`views/UsersView.vue:52` `scope: { mode: 'app', clientId: 'marschat-portal' }`；数据源走 BFF `/portal/api/admin/users`（`:42`） |
| infra-monitor | ✅ | `views/users/UsersView.vue` + `infra-monitor-server/.../controller/AdminProxyController.java:58`（D14 已修，BFF 代理） |
| activecode | ✅ | `static/activecode/members.html:106`（＋添加已有用户）、`:246`（本系统角色）、`:247`（移出本系统）；**无「重置密码」、无「删除」**；后端 `controller/AdminProxyController.java` |
| kb-web | ⚠️ | 页面存在（`views/settings/UsersView.vue`，scope app ✅），但①`menu-registry.yml:67` 登记的 path 是 `/users`，实际路由是 `/settings/users`（`router/index.ts:128`）——**菜单路径与路由不一致**；②数据源**前端直连中心**（见 P0-4） |
| kb-ops | ⚠️ | 页面存在且 scope app ✅，但①**数据源前端直连中心**；②页签里塞了 `MenuPermissionPanel` 和 `AccountMappingPanel` 两个**平台级**面板（`UsersView.vue:7-12, 80-121`）——与 D-2「应用侧只看本系统」直接冲突 |
| cosmic | ⚠️ | 页面是 `/admin`（`Admin.vue`），scope app ✅、BFF 代理 ✅，但**路由名 `/admin` 与「平台管理台」语义撞车**（cosmic 的 `/admin` 里同时有 LLM 配置和"本系统用户"），极易被误认成平台级管理台 |

### ⑨ 接口级权限闸门（1 ❌ / 2 ⚠️）

| 应用 | 判定 | 证据 |
|---|---|---|
| portal | ✅ | `config/PortalPermissionChecker.java` + `config/AuthzConfig.java`；`menu-registry.yml:52-58` 3 个 api 点（`admin` / `system:write` / `system:credentials`，其中 `system:credentials` 是针对"凭据明文读取"P1 修复新增） |
| infra-monitor | ✅ | `config/InfraPermissionChecker.java`（继承 `PermissionChecker`，fail-open 显式 false）+ 7 处 `@RequirePermission("api:...")`（`CredentialController:80/111/151`、`InfraItemController:55/61/67`、`ImportExportController:34`） |
| kb-web | ✅ | 网关收口形态 B：`kb-gateway/filter/PermissionAuthzFilter.java`；`application.yml:197-229` `authz.enabled=true`、**`fail-open: false`**、10 条写路径规则 |
| kb-ops | ⚠️ **假闸门** | 除 `HostController` 用了 `api:hosts:create/update/delete`（`:36/42/48`）外，**其余 10 个 Controller 全是类级 `@RequirePermission("menu:xxx")`**（`CredentialController:16` `menu:credentials`、`PortController:16` `menu:ports`、`ServiceController:16`、`DomainController:16`、`DependencyController:16`、`KnowledgeController:16`、`ImportController:29`、`DeploymentController:16`、`ConflictController:16`、`DashboardController:16`）。而 `menu-registry.yml:80-86` 的 apis 段只声明了 hosts 三点 → **给某人开「端口管理」菜单＝同时给了端口写权限**。这正是手册 §5 与 `authz.py:15-22` 反复警告的"拿 menu 点当写闸门＝假闸门" |
| cosmic | ⚠️ | `app/authz.py:100-117` `require_permission` = 本地角色门槛 AND 中心权限点（叠加不放松，设计正确）；但 `:89-91` 拿不到中心身份/中心不可达 → `verdict=None` → **降级放行**（`authz.py:8-9` 自陈）。而 cosmic 的中心令牌是**进程内存 `_oidc_tokens`**（`routers/auth.py:221`），重启即空 → 长时间处于降级放行 |
| activecode | ❌ | `menu-registry.yml:60-72` 已上报 6 个 api 点（`code:generate` 等），但**后端无任何权限判定实现**：全仓 grep activecode 无 `@RequirePermission`、无 `PermissionChecker`、无自定义 Filter（未引 auth-core）。→ 权限点只是"登记了"，**没有任何闸门消费它**，"权限统一管理"对 activecode 形同虚设 |

### ⑩ 会话监视器 `isOidcToken()` 判据（1 ⚠️）

| 应用 | 判定 | 证据 |
|---|---|---|
| portal | ✅ | `src/main.ts:57` `if (isOidcToken()) { startSessionWatcher({...}) }`（`stores/user.ts:24` `initTokenConfig({ tokenKindKey: 'portal_token_kind' })`，故无参版可读到正确键） |
| infra-monitor | ✅ | `src/main.ts:49` `if (isOidcToken(bootToken))` |
| kb-web | ✅ | `src/main.ts:58` |
| kb-ops | ✅ | `src/main.ts:46` |
| cosmic | ✅ | `frontend/src/main.js:70` `if (isOidcSession())`（`utils/sso.js:61` → `isOidcToken()`） |
| activecode | ⚠️ | 无构建静态页，未发现 `startSessionWatcher` 调用点，但 UMD 内置 `sessionWatcher`（`marschat-auth-core.umd.js` 含 `reauth=1` 跳转逻辑）。**需实测确认 activecode 是否会在账密会话下被误杀**；`sso.js:328` 存在 `?reauth=1` 跳转，说明走的是组件默认行为 |

### ⑪ `*_reauth_once` 一次性重授权短路（1 ❌）

| 应用 | 判定 | 证据 |
|---|---|---|
| **portal** | ❌ **仍未修** | `devtools/portal/src/views/LoginView.vue:26` `const REAUTH_FLAG = 'portal_reauth_once'`；`:86-96` 完整保留短路逻辑（命中标记 → `removeItem` → `probing=false` → **不发探针直接渲染登录框**；仅在失败分支 `:96` 清除）。ADR D16 写「portal 存在同一缺陷，**已派修**」，但**代码未落地** |
| cosmic | ✅ | `frontend/src/views/Login.vue:70-81` 明确注释「不做 `?reauth=1` 一次性短路（2026-09-15 移除）」，`onMounted` 无标记分支 |
| infra / kb-web / kb-ops | ✅ | `LoginView.vue` 的 `onMounted` 均无 reauth 标记分支 |
| activecode | ✅ | 无 `_reauth_once` 标记（`login.html:189` 仅为注释） |

### ⑫ 组件版本 ≥ 0.8.7（1 ❌）

| 应用 | package.json | 实际安装/产物 | 判定 |
|---|---|---|---|
| portal | `^0.8.7`（`portal/package.json:14`） | 未见本地 node_modules | ✅（声明） |
| kb-web | `^0.8.7`（`mykng/kb-web/package.json:14`） | — | ✅（声明） |
| kb-ops | `^0.8.7`（`kb-ops/kb-ops-web/package.json:14`） | — | ✅（声明） |
| infra-monitor | `^0.8.7`（`infra-monitor-web/package.json:14`） | 本地 `node_modules/@marschat/auth-components/package.json:3` = **0.8.4**（陈旧锁文件） | ⚠️ 声明 OK，本地目录陈旧；CI 是否装到 0.8.7 需看 lock |
| cosmic | `^0.8.7`（`frontend/package.json:12`） | `node_modules/.../package.json:3` = **0.8.7** | ✅ |
| activecode | — | `static/activecode/marschat-auth-core.umd.js:841` `const version = "0.8.6"`；`docs/VENDORED-auth-core-umd.md:10` `0.8.6` | ❌ **0.8.6** |

> 手册头部仍写「版本基线 `@marschat/auth-components` **0.8.6**」，而 5 个 SPA 已升 0.8.7 —— 文档漂移。
> activecode UMD 未升 0.8.7 的实际影响：0.8.7 的关键变更是「app 作用域隐藏重置密码」。activecode 的 members.html 是手写页（本身就没有重置密码按钮），故**当前影响为 0**；但版本不一致会让后续组件升级继续漏掉它。

---

# B. 两类用户管理菜单设计评审

## B.1 结论先行

**Phase 11 的 D-2 职责切分（A 管身份 / B 管成员）方向正确，是业界 IAM 的标准二分法（Identity Lifecycle vs Entitlement Assignment），不建议推翻。**

但当前实现有**一个根本性缺陷**：

> **这个切分只存在于 UI 层（组件参数 `scope.mode='app'`），没有下沉到 API / BFF 层。**
> 于是"应用侧不能删人、不能重置密码"只是**按钮被隐藏**（`UserManagementPanel.vue:87` `v-if="cfg.allowResetPassword !== false && !isAppScope"`、`:122-143` app 作用域只出「移出本系统」），
> 而**底层的平台级写端点依然对应用侧敞开**（cosmic BFF 直接暴露 `DELETE /admin/users/{id}` 与 `PUT /admin/users/{id}/password`，见 `routers/auth.py:650-659`）。

**正确做法**：把"成员（Membership）"提升为独立的一级 API 对象，让应用在 API 层面**根本没有**删除身份/重置密码的入口，而不是靠前端藏按钮。

## B.2 回答用户的 5 个问题

### 问题 1：职责切分是否成立？有没有更好的切法？

**成立，但建议升级为三层模型：**

```
现状（两层，切在 UI 参数）：
  UserManagementPanel(scope=platform)  ─┐
                                        ├─ 同一批 /admin/users 端点，靠 scope 参数区分
  UserManagementPanel(scope=app)      ─┘

建议（三层，切在 API 边界）：
  ① 身份层 Identity   /admin/users/**        —— 仅平台管理台可写（创建/停用/改密码/删除墓碑）
  ② 成员层 Membership /admin/clients/{cid}/members/** —— 应用管理台可写（加入/移出/绑解角色）
  ③ 授权层 Entitlement /admin/permissions/**  —— 中心授权面板（角色×权限点、用户级减法）
```

好处：
- **越权在 API 层被堵死**，UI 隐藏变成第二道而非唯一一道防线
- 应用侧 BFF 只需代理 `/members/**`，天然带 client 绑定，不可能误操作他应用的用户
- 「添加已有用户到本系统」= `POST /admin/clients/{cid}/members {userId}`，语义清晰
- 「移出本系统」= `DELETE /admin/clients/{cid}/members/{userId}`，与"删除身份"彻底解耦
- 未来加"用户组"时，members 主体扩展为 `{type: user|group, id}` 即可，面板不动

### 问题 2：从使用习惯看，还差什么？

**应用管理员的心智（"给我的系统加个人"）缺三样：**

| 缺口 | 现状 | 建议 |
|---|---|---|
| **邀请制** | 只能「新建用户」（=建全局身份，越权）或「添加已有用户」（要翻页找人） | 应用侧主按钮改为「**邀请成员**」：填邮箱 → 中心生成一次性邀请链接/码 → 对方自助设密码与昵称 → 自动成为本系统成员。这才是"加个人"的自然形态 |
| **搜索/筛选能力弱** | 「添加已有用户」对话框只有 keyword 搜索 + 翻页 | 支持按邮箱/用户名/昵称模糊 + 按"已在/不在本系统"过滤 + 最近添加 |
| **批量操作** | 无 | 「批量加入」「批量移出」「批量改角色」—— 新应用接入时一次拉 10 个人是常态 |

**平台管理员的心智（"这人能进哪些系统"）缺两样：**

| 缺口 | 现状 | 建议 |
|---|---|---|
| **只有「用户 × 应用」一个方向** | `CrossAppAuthPanel` 是用户出发 | 补**反向视图「应用 × 用户」**：从某个系统出发看"它里面都有谁、各自什么角色"。运维排障时 80% 是从系统出发的 |
| **缺"有效权限溯源"** | 只能看角色绑定，看不到最终效果 | 加一个「**这人在这个系统里实际能看什么、能干什么**」的只读抽屉：角色 → 权限点 → 菜单，叠加 `sys_user_menu_override` 减法后的**最终有效权限**。权限系统最难的就是"为什么他能看到/不能看到"，没有溯源就只能靠猜 |

**两端共同缺**：

- **变更历史/审计**：谁在什么时候把谁加进了哪个系统、改了什么角色——现在完全没有。这是权限系统最基础的可运维性要求。
- **影响预览与撤销**：删除（墓碑）不可逆、移出本系统无 undo。高危操作应有「确认 + 影响面预览 + N 秒内可撤销」。

### 问题 3：从健全性看，越权/误操作风险有没有堵住？

**没有全部堵住，列出 6 处：**

| # | 风险 | 严重度 | 证据/说明 |
|---|---|---|---|
| R1 | **应用侧 BFF 未做 client 强绑定** | 🔴 | `cosmic-studio/app/routers/auth.py:616-659` 的 `POST/PUT/DELETE /admin/users/**` **不带任何 client 参数**，仅靠 `require_permission("api:admin:write", min_role="admin")`（**cosmic 本地角色**）把关。目前只靠"中心用自己的 token 再判一次"兜底 —— 缺纵深防御 |
| R2 | **应用侧「新建用户」= 创建平台身份** | 🔴 | `UserManagementPanel` 在 app 作用域仍有「新建」按钮，将 `POST /admin/users`（建全局身份）。**这与 D-2 表格里「应用侧：❌ 不删身份」的精神直接矛盾**（表左下角却又写「新建用户 ✅ 委托中心建」—— 设计自相矛盾）。应用管理员应只有「邀请」和「添加已有用户」 |
| R3 | **「移出本系统」语义可被绕过** | 🟠 | 移出 = 解绑本应用角色。但 activecode 的「超管例外」（`AuthController.java:442-446`，平台 admin 直接映射本地管理员）与 cosmic 的「平台超管强制 admin」（`routers/auth.py:163-176`）意味着：**平台超管被"移出"后仍可凭身份重新进入**。UI 上显示"已移出"是语义欺骗。需要"显式拒绝名单/停用"能力 |
| R4 | **自我保护只在前端** | 🟠 | 组件靠 `currentUserId`/`currentUsername` 置灰按钮（`:126-139`）。BFF 代理层**无服务端自我保护** → 绕过 UI 直接调接口可以把自己移出本系统、把最后一个管理员移除 → **系统锁死**。且该保护依赖 token 里有 `uid`/username（portal 无 uid 用 username；infra 旧 token 无 uid，D13 已修但仍属脆弱依赖） |
| R5 | **中心凭据存进程内存** | 🟠 | infra `service/CenterSessionStore.java`、cosmic `routers/auth.py:221` `_oidc_tokens = {}`、activecode `CenterSessionStore` 都是 **JVM/进程内 Map**。应用重启 / 多副本 / 滚动发布 → 应用侧用户管理立即 401（"无统一认证会话"）。这是 D14 修完之后新引入的**可用性单点** |
| R6 | **平台管理台仅靠本地 `requiresAdmin` 开门** | 🟡 | `portal/src/router/index.ts:57-60`（`/admin` 只有 `requiresAdmin: true`，无中心权限点）、`:78` `requiresAdmin && !userStore.isAdmin`。portal 本地影子表的 role 决定能否打开**平台级**管理台。虽然实际操作会被中心 403，但"能打开、能看到全平台用户列表（读）"本身就是信息泄露面 |

### 问题 4：从扩展性看，现有切分要不要改？

**切分本身不用改，但 API 契约必须先升级（否则每个新维度都要在 UI 层打补丁）：**

| 未来能力 | 需要中心加什么 | 应用侧面板要动吗 | 前提 |
|---|---|---|---|
| **用户组 / 部门** | `sys_group`、`sys_group_member`、`sys_group_role`（组可直接挂 client 级角色） | 只加一个「用户 / 用户组」Tab，成员列表主体扩展为 `{type,id}` | **必须先有 Membership API**（members 主体支持 `type=user\|group`） |
| **数据行级权限** | `sys_permission` 增加 `type='data'` + 策略表达式；应用传上下文求值 | **完全不动**（与 menu/api 点正交） | 无 |
| **邀请制** | `sys_invitation`（邮箱、token、目标 client、初始角色、过期）+ 匿名自助注册端点 | 加一个「邀请」按钮 + 待接受列表 | **必须先有 Membership API**（接受邀请 = `POST /members`） |
| **审计日志** | `sys_admin_audit(actor, target, action, before, after, client, ip, ua)`；所有 `/admin/**` 写操作落库 | 两个面板各加一个「变更历史」抽屉 | 无 |

**判断**：B.1 建议的三层 API 拆分是这四项扩展的**共同前置**。换句话说，**现在不做，将来每加一项都要在 UI 层补一次洞**。

### 问题 5：具体改进项清单（P0 / P1 / P2）

#### 🔴 P0（本轮必修）

| # | 改进项 | 改哪里 |
|---|---|---|
| **P0-1** | **删除 portal 登录页 `portal_reauth_once` 短路**（D16 声称已派修但代码未落地）→ 与 cosmic `611087d` 同款：进登录页必探一次 IdP 会话 | `devtools/portal/src/views/LoginView.vue:26, 86-96` |
| **P0-2** | **让 cosmic 的权限点上报真正生效**：① `devtools/apps-registry.yml` 的 `cosmic-studio` 段补 `menu-report-secret`（值走 `${COSMIC_MENU_REPORT_SECRET:}`，**禁止写明文**）；② 部署机注入 `COSMIC_MENU_REPORT_SECRET`；③ 上报成功后核验中心 `sys_permission` 出现 `cosmic-studio:*` | `devtools/apps-registry.yml:128-139`、`cosmic-studio/docker-compose.yml:23`、`app/menu_report.py`（加"上报失败升级为 ERROR 并可观测"） |
| **P0-3** | **activecode 补接口闸门**：已上报的 6 个 api 点必须被消费。最省事的做法是在 `WebMvcConfig`/拦截器里加一个本地 `RequirePermission` 等价实现（参考 `kb-gateway/filter/PermissionAuthzFilter.java` 的"只拦写方法+命中规则+fail-open=false"范式），把 `code:generate/delete/batch-delete/alias`、`config:expire/version-check` 挂上 | `active-manager/.../config/`（新增 Filter 或 Interceptor）+ `WebMvcConfig.java` |
| **P0-4** | **kb-web / kb-ops 应用侧用户管理改为 BFF 代理，并停止把中心业务令牌存浏览器**：① 两个 `UsersView.vue` 的 `baseUrl`/`appRoles.baseUrl` 改为相对路径（走各自后端/网关代理 `/admin/**`）；② kb-web 登录改为 BFF 自签会话（或至少中心令牌只落在服务端，参考 infra `AdminProxyController` + `CenterSessionStore`） | `mykng/kb-web/src/views/settings/UsersView.vue:26,52`；`kb-ops/kb-ops-web/src/views/users/UsersView.vue:47,72`；`kb-web/src/stores/user.ts:18-23` |

#### 🟠 P1（下一轮）

| # | 改进项 | 改哪里 |
|---|---|---|
| **P1-1** | **Membership API**：中心新增 `/admin/clients/{clientId}/members`（GET/POST/DELETE）与 `/admin/users/{id}/memberships`，应用侧 BFF 只代理 members 端点 | `auth-center`（新增 Controller/Service）+ `packages/auth-components/src/utils/userAdmin.ts`（新增 `createMemberAdminClient`）+ 6 应用 BFF |
| **P1-2** | **应用侧移除「新建用户」，改为「邀请成员 + 添加已有用户」**；组件 app 作用域隐藏「新建」，新增「邀请」按钮 | `packages/auth-components/src/components/UserManagementPanel.vue`（新建按钮 `:163` 附近 + form 逻辑）、中心新增 invitation 端点 |
| **P1-3** | **kb-ops 假闸门整改**：把 10 个 Controller 的类级 `menu:*` 写闸门改成方法级 `api:*`；`menu-registry.yml` 的 apis 段补齐对应点 | `kb-ops/src/main/java/com/kb/ops/controller/*.java`；`kb-ops/src/main/resources/menu-registry.yml:80-86` |
| **P1-4** | **kb-ops 用户页瘦身**：把 `MenuPermissionPanel` / `AccountMappingPanel` 两个**平台级**面板移出应用页（迁到 portal `/portal/admin`），或降级为「只读 + 强锁 `clientId=marschat-kbops` + 只允许减法」 | `kb-ops/kb-ops-web/src/views/users/UsersView.vue:7-12, 80-121` |
| **P1-5** | **服务端自我保护**：BFF 代理层拒绝「移除自己」「移除最后一个本应用管理员」；返回明确业务错误 | infra `AdminProxyController.java`、activecode `AdminProxyController.java`、cosmic `app/routers/auth.py:595-601`、portal `AuthCenterService.callAdmin` |
| **P1-6** | **审计日志**：中心所有 `/admin/**` 写操作落 `sys_admin_audit`；两个面板都提供「变更历史」抽屉 | `auth-center` + `packages/auth-components`（新增 `AuditDrawer` 或扩展 `UserManagementPanel`） |
| **P1-7** | **中心凭据暂存从进程内存改为可共享存储**（Redis / 加密 Cookie / 应用自签短票 + 服务端 exchange），消除"重启即 401" | infra `service/CenterSessionStore.java`、cosmic `routers/auth.py:221` `_oidc_tokens`、activecode `CenterSessionStore` |
| **P1-8** | **本地「修改密码」端点下线**：改为 410 Gone + 引导走中心「忘记密码」/ 中心管理台重置（F4 遗留，现仍在做无意义的本地比对） | `portal-server/.../AuthController.java:146-168`；`activation-code-server/.../AuthController.java:227-253` |
| **P1-9** | **补齐反向视图与权限溯源**：中心管理台加「应用 × 用户」视图 + 用户「有效权限」只读溯源抽屉 | `packages/auth-components/src/components/CrossAppAuthPanel.vue`（加反向模式）、新增 `EffectivePermissionDrawer.vue` |

#### 🟡 P2（技术债 / 打磨）

| # | 改进项 | 改哪里 |
|---|---|---|
| **P2-1** | **F1 未修**：kb-gateway 与 auth-center 共享弱默认 JWT 密钥，明文硬编码在配置里 | `mykng/kb-gateway/src/main/resources/application.yml:166` → 改 env 注入 + 独立密钥 + 轮换 |
| **P2-2** | **apps-registry.yml 明文 secret 默认值入库**：多个 `menu-report-secret` 与 portal `secret` 都带明文默认（`${ENV:明文}`），违反「任何文档不得出现明文 secret」铁律 | `devtools/apps-registry.yml:24`（portal client secret 弱默认）、`:45`、`:86`、`:113` → 默认值一律改为空，缺值即启动失败 |
| **P2-3** | **activecode UMD 升到 ≥0.8.7** 并同步 `VENDORED-auth-core-umd.md`（版本/大小/sha256 三对齐）；建议加 CI 门禁比对 sha256 | `devtools/woodScript/sync-auth-core-umd.sh`、`active-manager/docs/VENDORED-auth-core-umd.md` |
| **P2-4** | **文档漂移修正**：手册头部版本基线（0.8.6 → 0.8.7）；手册 §5「portal/activecode 无 public 菜单」中 activecode 已改为 1 个 public；ADR D16「portal 已派修」实际未修 | `marschat-components/docs/README.md:8, 90`；`ADR-2026-09-15-Phase11...md:45` |
| **P2-5** | **portal menu-registry 显式注释"本应用 0 个 public"**，避免后来者误判漏配 | `portal-server/src/main/resources/menu-registry.yml` |
| ~~**P2-6**~~ | ✖ **已澄清：非缺陷（2026-09-16 更正，不留假待办）** —— 原判「`menu-registry` 写 `/users`，实际路由 `/settings/users`」**有误**：源码显示 `mykng/kb-web/src/router/index.ts:128` 的路由 `path:'users'` 与 `:120` 的 `settings` **同级**（`settings` 是**叶子路由**、不是带 `children` 的父路由），故实际路由 = `/{ctx}/users`，**与 menu-registry 的 `/users` 一致**；`views/settings/` 只是**文件目录归属**，不是路由层级。误判根因=把文件目录当路由层级。详见 `ADR-2026-09-16-Phase12-统一认证权限治理.md` §4.5 | —（**非缺陷，撤销**） |
| **P2-7** | **cosmic `/admin` 改名**（如 `/members` 或把"本系统用户"拆成独立路由 `/users`），避免与「平台管理台」语义撞车 | `cosmic-studio/frontend/src/router.js`、`views/Admin.vue` |
| **P2-8** | **activecode「超管例外」`LIMIT 1` 归因丢失**：所有平台管理员在 activecode 内共用同一条本地影子记录，审计无法区分操作者。建议按中心 username 逐条建档影子 | `activation-code-server/.../AuthController.java:442-446` |
| **P2-9** | **infra 忘记密码跨应用依赖 kb-gateway**：authApiBase `/kb/api/auth` 让 infra 的自助改密依赖 mykng 主机可用性 | `infra-monitor-web/src/views/login/LoginView.vue:40` + infra nginx 增加直连 auth-center 的 `/auth-api/` 路由 |
| **P2-10** | **portal / kb-ops 的 forgot-password 需线上实测取证**（代码侧无法保证路由可达），结果回写 ADR | 运维侧 + `ADR-2026-09-15 §4.1` 实测表 |

---

# C. 初衷达成度评估

> 判据：**只认代码与配置**。凡是"代码写得出但依赖线上配置/网络"的，一律标 ⚠️ 并注明需实测。

| # | 初衷 | 判定 | 证据与说明 |
|---|---|---|---|
| C1 | **统一登录**（一处登录，处处可进） | ⚠️ **基本达成，1 处缺陷** | ✅ 6/6 应用登录页四要素齐全（①②③⑤）；IdP 会话 Cookie（`Domain=marschat.online`）+ OIDC PKCE 静默免登链路完整；SLO 联动 + `isOidcToken` 判据 5/6 到位。<br>❌ **portal 免登被 `portal_reauth_once` 短路**（`LoginView.vue:26,86-96`）——401 触发过一次后，同标签页内即使 IdP 会话完好也不再发探针，用户看到"免登失效"。这是"统一登录"体感上最直接的破口 |
| C2 | **统一鉴权**（权限判定同源） | ⚠️ **部分达成** | ✅ portal / infra / kb-web 三处真闸门（api 点 + fail-open=false）；cosmic 有叠加判定（但降级放行）。<br>⚠️ **kb-ops 10 个 Controller 仍是 menu 假闸门**；<br>❌ **activecode 有权限点、无闸门**；<br>❌ **cosmic 权限点上报未生效**（P0-2）→ 该应用 `configured=false` → R10 全放行，实际未纳入统一鉴权 |
| C3 | **用户统一管理**（一处建号，全平台可用） | ⚠️ **基本达成，1 处漏网** | ✅ 账密真源归一（② 全绿）；本地用户表全部降级影子（portal 自动建档、infra 移除硬编码管理员、activecode 影子、cosmic `password_hash=''`）；`LocalAccountReporter` 覆盖 portal / infra / activecode，cosmic 有 `report_accounts()`。<br>❌ **cosmic 的账号上报同样因 `MENU_REPORT_SECRET` 为空被跳过**（`menu_report.py:120-122`）→ 影子账号不会自动认领 |
| C4 | **权限统一管理**（权限点与授权集中） | ⚠️ **部分达成** | ✅ `menu-registry.yml` + Reporter 覆盖 5 个应用；中心 `sys_permission`（menu/api 双类型）+ strict 默认最小权限 + 灰度/回滚端点齐备（`GET /admin/authz/policy` 等）。<br>❌ **cosmic 未纳入**（同 C2）；❌ **activecode 的 6 个 api 点无人消费**（同 C2）；⚠️ kb-ops 只上报 3 个 api 点，与实际写端点数量严重不匹配 |
| C5 | **账号映射**（本地账号 ↔ 中心身份） | ⚠️ | ✅ 机制完备：`app_account_mapping` + 启动全量上报 + 按 username 自动认领 + 手工绑定面板；activecode 的 `sub`→`username` 映射键缺陷（F2）已修（`AuthController.java:196-205, 515-521`）。<br>⚠️ cosmic 因 secret 空未上报；kb-web / kb-ops 无本地账号（N/A，合理） |
| C6 | **新应用接入只需"接组件 + 配置"** | ⚠️ **方向对，但离"只需"还差** | ✅ `devtools/apps-registry.yml` 单一真源 + `scripts/gen-from-registry.py` 派生（clients.yml / app-config.json）+ 手册 Level 0-3 分层指南 + 参考实现 infra-monitor。<br>⚠️ 无脚手架/模板仓库：activecode 这种"无构建静态页"形态需要**手写** `MenuRegistryReporter`、`AdminProxyController`、`CenterSessionStore`（因为没有 auth-core）—— 这不是"接组件 + 配置"，是"照抄一遍后端"。建议沉淀 `auth-core-static-starter` 或模板工程 |
| C7 | **非自研系统不可接入** | ✅ **成立** | D-5 明确：非自研系统无法改其代码，不可能让账密/会话走中心；仅当目标系统原生支持 OIDC/SAML/LDAP 时才可能以标准协议对接。<br>⚠️ 但 `apps-registry.yml` 里登记了 `frp-manager`（`:163-172`），而 `myfrp/frontend/src/views/Login.vue:13` 是**硬编码外链** `https://auth.marschat.online/forgot-password.html` —— 属于"半接入"，边界需在新应用接入规范里说清（登记 ≠ 接入完成） |
| C8 | **超管 `marschat@163.com`** | ⚠️ **代码不可证** | 手册 §3 声明「平台超管 admin（邮箱 marschat@163.com，platform superadmin + 6 应用 client admin）」。该事实属**数据面/运维面**，本轮只做代码审计，**无法证真**。建议用一条只读核验脚本（查 `sys_user` + `sys_user_role`）纳入平台常备测试资产 |
| C9 | **三种登录方式齐备**（账密 / 邮箱码 / 忘记密码） | ⚠️ **2 处待实测** | 账密：6/6 ✅（kb-ops N/A）；邮箱码：6/6 ✅。**忘记密码：activecode ✅、kb-web ✅；portal ⚠️（无后端端点，依赖 nginx）；infra ⚠️（借道 kb-gateway）；kb-ops ⚠️（未发现入口）；cosmic ❌（只弹"联系管理员"）** |

### C.10 与 Phase 10 误判的对比（为什么这次的结论可信）

Phase 10 的误判根因是「**只验 UI/链路，不验数据源**」（登录页四要素齐全就判"统一登录达成"，但没查账密在哪儿校验）。
本轮刻意反向取证：

- 不看"有没有按钮"，看**按钮背后的 `baseUrl` 指向谁**（→ 抓出 kb-web / kb-ops 直连中心）
- 不看"有没有 yml"，看 **Reporter 是否真的发出去**（→ 抓出 cosmic secret 为空）
- 不看"有没有权限点"，看**有没有代码消费它**（→ 抓出 activecode 无闸门）
- 不看"ADR 说已修"，看**代码里那行还在不在**（→ 抓出 portal `portal_reauth_once` 未删）
- 不看"package.json 声明"，看**产物里的 `const version`**（→ 抓出 activecode UMD 仍是 0.8.6）

### C.11 一句话给良哥

> **"账密归一"这一仗打赢了，但"权限统一管理"和"用户统一管理"在 cosmic 上还没真正开打（secret 没配，权限点根本没进中心），activecode 的闸门是空架子，kb-web/kb-ops 的用户管理还是直连中心、且把中心管理凭据放在浏览器里。这四件事比继续做新功能更该先收口。**

---

## 附：本轮审计的取证清单（供复核）

已核对的关键文件（按应用）：

- **portal**：`src/main.ts`、`src/views/LoginView.vue`、`src/views/UsersView.vue`、`src/views/AdminConsoleView.vue`、`src/router/index.ts`、`src/stores/user.ts`、`src/utils/sso.ts`、`portal-server/.../controller/AuthController.java`、`.../service/AuthCenterService.java`、`.../config/PortalPermissionChecker.java`、`.../config/AuthzConfig.java`、`.../config/LocalAccountReporter.java`、`src/main/resources/menu-registry.yml`
- **activecode**：`static/activecode/login.html`、`members.html`、`sso.js`、`marschat-auth-core.umd.js`、`.../controller/AuthController.java`、`.../controller/AdminProxyController.java`、`.../config/MenuRegistryReporter.java`、`.../config/LocalAccountReporter.java`、`.../config/WebMvcConfig.java`、`src/main/resources/menu-registry.yml`、`docs/VENDORED-auth-core-umd.md`
- **kb-web / kb-gateway**：`kb-web/src/views/login/LoginView.vue`、`src/views/settings/UsersView.vue`、`src/stores/user.ts`、`src/router/index.ts`、`src/main.ts`、`kb-gateway/src/main/resources/application.yml`、`kb-gateway/src/main/resources/menu-registry.yml`、`kb-gateway/filter/PermissionAuthzFilter.java`
- **kb-ops**：`src/main/resources/menu-registry.yml`、`src/main/java/com/kb/ops/controller/*.java`（14 个 Controller）、`kb-ops-web/src/views/users/UsersView.vue`、`src/views/login/LoginView.vue`、`src/main.ts`
- **infra-monitor**：`infra-monitor-server/.../controller/AuthController.java`、`.../controller/AdminProxyController.java`、`.../config/InfraPermissionChecker.java`、`.../config/AuthzConfig.java`、`.../config/LocalAccountReporter.java`、`src/main/resources/menu-registry.yml`、`infra-monitor-web/src/main.ts`、`src/views/login/LoginView.vue`、`src/views/users/UsersView.vue`
- **cosmic**：`app/auth.py`、`app/authz.py`、`app/menu_report.py`、`app/routers/auth.py`、`app/routers/studio.py`（MENU_REGISTRY）、`frontend/src/main.js`、`frontend/src/views/Login.vue`、`frontend/src/views/Admin.vue`、`docker-compose.yml`、`frontend/package.json`
- **公共组件**：`packages/auth-components/src/components/UserManagementPanel.vue`（按钮与作用域逻辑）、`src/utils/userAdmin.ts`（scope / allowResetPassword / appRoles 契约）、`src/utils/sessionWatcher.ts`
- **平台**：`devtools/apps-registry.yml`、`devtools/docs/adr/ADR-2026-09-15-Phase11-*.md`、`marschat-components/docs/README.md`、`devtools/docs/adr/INDEX.md`

> ⚠️ 本轮**未执行任何线上实测**（纯静态代码与配置审计）。标 ⚠️ 的项（尤其 ④ 忘记密码路由可达性、⑥ portal 菜单上报是否生效、⑩ activecode 会话监视器行为）建议由真浏览器回归脚本取证后回写本表。
