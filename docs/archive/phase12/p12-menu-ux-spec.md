# Phase 12 · 「两类菜单」前端改动规格（文件:行号 级）

- **版本**：2026-09-16 · **角色**：software-architect · **状态**：设计规格（**本轮只出文档，不改任何代码**）
- **依据**：设计规格 `p12-architect-design.md` §2（两类菜单功能规格）＋ 本轮源码实测（各节附 `文件:行号`）
- **上游决策**：`ADR-2026-09-16-Phase12-统一认证权限治理.md` D-1（三层权限 API）/ D-2（client 钉 path）/ D-3（两类菜单）
- **约束**：不含任何明文口令 / secret；结论均附 `文件:行号`；不确定项一律标 **「待确认」** 并说明原因
- **路径约定**：`devtools/` = `D:\huliang\java\ideaworkspace\devtools\`；`cosmic-studio/`、`marschat-components/` 为同级仓库

---

## 0. 结论速览

全平台共 **7 个用户管理页面**（portal 一个应用里有两个）。定性：

| # | 页面 | 文件 | **定性** | scope |
|---|---|---|---|---|
| **A** | portal「统一认证中心」 | `devtools/portal/src/views/AdminConsoleView.vue` | **中心台**（管人） | `platform` |
| **B** | portal「门户用户」 | `devtools/portal/src/views/UsersView.vue` | **应用台**（管关系） | `app/marschat-portal` |
| **C** | kb-web「本系统用户」 | `devtools/mykng/kb-web/src/views/settings/UsersView.vue` | **应用台** | `app/marschat-kbweb` |
| **D** | kb-ops「用户」 | `devtools/kb-ops/kb-ops-web/src/views/users/UsersView.vue` | **应用台（当前混入 2 个平台级页签，须拆出）** | `app/marschat-kbops` |
| **E** | cosmic 用户管理 | `cosmic-studio/frontend/src/views/Admin.vue` | **应用台（路由名 `/admin` 与「平台管理台」撞车）** | `app/cosmic-studio` |
| **F** | infra「本系统用户」 | `devtools/infra-monitor/infra-monitor-web/src/views/users/UsersView.vue` | **应用台（参考实现，已同源 BFF）** | `app/marschat-inframon` |
| **G** | activecode「本系统用户」 | `devtools/active-manager/activation-code-server/src/main/resources/static/activecode/members.html` | **应用台（手写静态页，无构建）** | `app/marschat-activecode` |

- **中心台 1 个（A）**；**应用台 6 个（B–G）**。
- **待确认共 5 项**（§8）：① 应用台「读平台池 / 读全部角色」的授权口径（最关键）；② kb-ops 拆页签的下游影响；③ cosmic 路由改名与 LLM 配置是否拆分；④ `appRoles.baseUrl` 语义不统一；⑤ 审计 P2-6「kb-web 菜单路径不一致」疑为误判。
- **本轮新发现（审计未列，均在共享组件层，影响全部 6 应用）**：见 §2.0 —— app 作用域仍可「新建平台身份」「改全局状态（禁用）」「编辑身份字段」，均为 D-3 违规。

---

## 1. 两层结构：先改共享组件，再改宿主页

**所有应用台的行为差异都在共享组件里**，宿主页只是「薄包装」（各页注释自陈：`UsersView.vue:11`、`kb-web/.../UsersView.vue:11`、`infra/.../UsersView.vue:11`）。

```
marschat-components/packages/auth-components/src/
├── components/UserManagementPanel.vue   ← 列表/列/按钮的全部作用域逻辑（§2.0 主战场）
├── components/UserMenuOverridePanel.vue ← 菜单减法（应用级 Entitlement）
├── utils/userAdmin.ts                   ← 用户管理数据源契约（list/create/update/remove/resetPassword）
├── utils/authorizationMatrix.ts         ← 跨应用矩阵数据源（中心台反向视图的落点）
└── components/{CrossAppAuthPanel,AccountPermissionPanel,MenuPermissionPanel}.vue  ← 仅中心台
```

> **改一处、6 应用生效**：凡涉及「应用台该不该有某按钮」的改动，**必须改组件**，不要在各宿主页各写一份（历史教训见 `kb-web/src/utils/token.ts:8-10` 注释）。

---

## 2. 逐页面规格

### 2.0 共享组件 `UserManagementPanel.vue`（**最高优先级，影响全部 6 个应用台**）

> **✅ 状态（2026-09-16 16:55）：已实现并发版 `@marschat/auth-components@0.8.8`**（Nexus npm-hosted，shasum 5e99372a；commit `fb5c920` + merge `9908fba` 双端收敛）。
> 落地内容 = 本节全部三处裁剪，且「编辑」按钮按 §8-4 建议落地为**只读视图**（app 作用域：昵称/邮箱 disabled、状态开关隐藏、无确定按钮、`submitForm` 纵深防御 return）。
> 附带 fix：`devDependencies` 补 `sass`（4 组件 `lang="scss"` 但依赖从未声明，此前靠传递依赖侥幸构建，真错误曾被 closeBundle ENOENT 掩盖）。
> **后续连锁**：6 应用升 `^0.8.8` → cosmic/infra 阶段 B 删 `admin_create_user`/`admin_update_user`；各应用宿主页回归（状态开关消失属预期变更）。

- **页面定性**：公共组件（无独立定性），承载两类菜单 UI 差异。
- **现状调用面（作用域驱动的关键行）**

| 文件:行号 | 元素 | 现状（app 作用域下） | 合规性 |
|---|---|---|---|
| `UserManagementPanel.vue:24` | 「新建用户」按钮 | `v-if="!cfg.readonly"` → **app 作用域仍渲染** | 🔴 违反 D-3（应用台不创建人） |
| `:26` | 「添加已有用户」按钮 | `v-if="!cfg.readonly && isAppScope"` → 仅 app | ✅ 正确 |
| `:51-67` | 「本系统角色」列 | 仅 app | ✅ 正确 |
| `:80` | 「编辑」按钮 | 无条件渲染（app 也渲染） | 🟠 打开的表单含身份字段（见 `:183/:188`） |
| `:87` | 「重置密码」按钮 | `... && !isAppScope` → app 隐藏 | ✅ 正确 |
| `:123-132` | 「移出本系统」按钮 | 仅 app，`isSelf` 置灰 | ✅ 正确 |
| `:134-143` | 「删除」按钮 | `v-else-if="cfg.allowDelete !== false"` → app 隐藏 | ✅ 正确 |
| `:183` | 表单「角色」（全局） | `... && !isAppScope` → app 隐藏 | ✅ 正确 |
| `:188-190` | 表单「状态」开关 | `v-if="editing"` → **app 作用域也渲染** | 🔴 违反 D-3（停用是全局动作） |
| `:660-663` | app 新建后 `joinAppForNewUser` | 新建平台身份并自动入本系统 | 🔴 违反 D-3 |

- **目标调用面**：不变（仍由 `scope.mode` 驱动），但补三处作用域裁剪（下表）。
- **要删除的 UI 元素（app 作用域下）**

| 元素 | 所在行 | 改法 | 删掉后的空位如何补 |
|---|---|---|---|
| 「新建用户」按钮 | `:24` | `v-if="!cfg.readonly"` → `v-if="!cfg.readonly && !isAppScope"` | 右上工具条保留「查询」+「添加已有用户」；可在 `subtitle` 提示「新增人请在统一认证中心，或点『添加已有用户』」 |
| 表单「状态」开关 | `:188` | `v-if="editing"` → `v-if="editing && !isAppScope"` | 无（状态是全局属性，应用台不展示可改项） |
| 「编辑」按钮（app） | `:80` | 见下「待确认 §8-4」——建议 app 作用域改为**只读身份字段**（昵称/邮箱是否可自助改，需产品定） | 若移除，操作列保留「本系统角色 / 菜单权限 / 移出本系统」 |

- **要新增的 UI 元素**
  - （Phase 13，非本轮）app 作用域「**邀请成员**」按钮（`POST /admin/clients/<id>/invitations`，字段 email + roleIds，**不填口令**）。
- **空态 / 错误态文案**：见 §7 统一表。
- **风险**：组件为 6 应用共用 —— 上述三处裁剪会**同时改变 6 个应用台**的行为，必须整体回归（尤其 `:188` 状态开关，可能有用户习惯依赖）。

---

### 2.A portal「统一认证中心」= **中心台**（`AdminConsoleView.vue`）

| 项 | 内容 |
|---|---|
| **页面定性** | **中心台（管人）**。路由 `/portal/admin`（`portal/src/router/index.ts:57-61`，`requiresAdmin`，**刻意不登记 menu-registry**）。入口：`portal/src/layouts/MainLayout.vue:30-38` 顶栏「统一认证中心」按钮 + `:47-51` 下拉项。 |
| **现状调用面** | ① `:19` `UserManagementPanel`（`userConfig.scope = {mode:'platform'}`，`:128`）→ `createUserAdminClient({baseUrl:'${BFF}/admin/users'})`（`:120`）：`GET/POST /admin/users`、`PUT/DELETE /admin/users/{id}`、`PUT /admin/users/{id}/password`。<br>② `:23` `CrossAppAuthPanel`（`:158-168`）→ `createAuthorizationMatrixClient({issuer:BFF})` → `GET /admin/authorization-matrix`、`GET /admin/roles`、`GET|PUT /admin/users/{id}/client-roles`（契约见 `authorizationMatrix.ts:12-20`）。<br>③ `:27` `AccountMappingPanel`（`:171-187`）→ `/admin/mappings*`。<br>④ `:40` `MenuPermissionPanel`（`:191-202`）→ `/admin/roles/{roleId}/permission-codes`、`/admin/clients/{id}/menus`。<br>⑤ `:101-108` `APPS` 数组（6 个 clientId **硬编码**）。 |
| **目标调用面** | **保持现状**（中心台 = Identity 层 + Entitlement 平台级，已符合 D-1）。可选增强见「新增」。 |
| **要删除的 UI 元素** | **无**（中心台保留全部能力）。 |
| **要新增的 UI 元素** | ① 授权矩阵「平台管理员」灰底标记（设计 §2.3-1：对 `globalRole in (superadmin,admin)` 的行补 `"__implicit"` 标记）；② **「应用 × 用户」反向视图**（见 §5）；③（P1-9 可选）「有效权限」只读溯源抽屉。 |
| **空态 / 错误态文案** | 列表空：「暂无用户」；403：「当前账号无平台管理权限，请联系超级管理员」；404：「接口不存在（版本可能不一致），请刷新后重试」。 |
| **风险** | `APPS`(`:101-108`) 与 `apps-registry.yml`（单一真源）**双真源漂移**：新增/改名应用时两处会不一致（P2）；建议改为运行时读 `app-config.json` 或矩阵接口返回的 `clients[]`（`authorizationMatrix.ts:58` 已返回）。 |

---

### 2.B portal「门户用户」= **应用台**（`portal/src/views/UsersView.vue`）

| 项 | 内容 |
|---|---|
| **页面定性** | **应用台（管关系）**。路由 `/portal/users`（`router/index.ts:44-49`，`requiresAdmin` + `perm menu:users`）；menu-registry `portal-server/src/main/resources/menu-registry.yml:31-34`（key `users`「门户用户」）。 |
| **现状调用面** | `:3` `UserManagementPanel`；`:42` `baseUrl:'/portal/api/admin/users'`（**BFF 同源 ✅**，开发态 `/api/admin/users`）；`:52` `scope:{mode:'app',clientId:'marschat-portal'}`；`:64-71` `appRoles.baseUrl=BFF`；`:74-82` `menuOverrides`（→「菜单权限」按钮）。全链路：浏览器 → `portal-server`（前缀透传 `/admin/**`）→ auth-center。 |
| **目标调用面** | `client.list` → `GET /admin/clients/marschat-portal/members`；`client-roles` → `PUT /admin/clients/marschat-portal/users/{uid}/roles`；「移出本系统」→ `DELETE /admin/clients/marschat-portal/members/{uid}`；`menu-overrides` → path 化（§6 总表）。BFF 只需把 `<id>` 拼进 path。 |
| **要删除的 UI 元素** | 「新建用户」按钮（组件 `:24`，app 隐藏——本页自动生效，无需改本文件）。 |
| **要新增的 UI 元素** | 无（「添加已有用户」已由组件 `:26` 提供）。 |
| **空态 / 错误态文案** | 见 §7（应用台口径）。 |
| **风险** | 依赖组件先支持 **path 化端点**：现 `createUserAdminClient` 只拼 `${base}` + `/{id}`（`userAdmin.ts:242-275`），**没有** `clients/{id}/members` 形状 → 需要契约扩展或新 `createMemberAdminClient`（**待确认 §8-1/§8-4**）。 |

---

### 2.C kb-web「本系统用户」= **应用台**（`kb-web/src/views/settings/UsersView.vue`）

| 项 | 内容 |
|---|---|
| **页面定性** | **应用台**。路由 `mykng/kb-web/src/router/index.ts:128-131`（`path:'users'`，`perm menu:users`）。 |
| **现状调用面** | `:3` `UserManagementPanel`；`:26` `baseUrl:'https://auth.marschat.online/admin/users'` 🔴 **硬编码公网域名跨域直连**；`:40` `scope:{mode:'app',clientId:OIDC_CLIENT_ID}`（`OIDC_CLIENT_ID` 缺省 `marschat-kbweb`，`kb-web/src/config.ts:40`）；`:51-56` `appRoles.baseUrl:'https://auth.marschat.online'` 🔴；**无 `menuOverrides`**（故无「菜单权限」按钮）；`:33-34` `currentUserId` 取自 OIDC claims。 |
| **目标调用面** | **P0-4-A 同源化（第一步，低风险）**：`:26` → `` `${API_BASE_URL}/admin/users` ``（`API_BASE_URL='/kb/api'`）；`:52` → `baseUrl: API_BASE_URL`。同时在 `kb-gateway/src/main/resources/application.yml` 新增路由 `Path=/kb/api/admin/**` → `lb://auth-center`（`StripPrefix=2`），**逐条**白名单断言，勿用通配（设计 §3.2-A-2）。第二步再 path 化（§6）。 |
| **要删除的 UI 元素** | ① 「新建用户」按钮（组件 `:24`）；② 两处跨域绝对地址（`:26`/`:52`，改为相对路径后浏览器不再出现 `auth.marschat.online/admin/**` 请求）。 |
| **要新增的 UI 元素** | 无（`appRoles` 已配 → 有「本系统角色」按钮；未配 `menuOverrides` → 无「菜单权限」，如需减菜单权限需补配）。 |
| **空态 / 错误态文案** | 见 §7。 |
| **风险** | 需 kb-gateway 新增路由（属枢纽，须走 `appmap.py impact`）；「添加已有用户」要读平台池 → **待确认 §8-1**；P2-6 的「菜单路径 vs 路由」**疑为审计误判** → **待确认 §8-5**。 |

---

### 2.D kb-ops「用户」= **应用台（当前混入 2 个平台级页签）**（`kb-ops-web/src/views/users/UsersView.vue`）

| 项 | 内容 |
|---|---|
| **页面定性** | **应用台**（主），但当前页内含**两个平台级面板**，与 D-3「应用侧看不到别的系统」直接冲突。路由 `kb-ops-web/src/router/index.ts:105-108`（`path:'users'`）。 |
| **现状调用面** | `:5` `UserManagementPanel`（`config.scope = {mode:'app',clientId:SSO_CONFIG.clientId}`，`:61`；`SSO_CONFIG.clientId` 缺省 `marschat-kbops`，`kb-ops-web/src/config.ts:38`）；`:47` `baseUrl:'${OIDC_ISSUER}/admin/users'` 🔴 跨域直连；`:72-77` `appRoles.baseUrl=OIDC_ISSUER` 🔴。<br>**平台级（须拆出）**：`:8` `MenuPermissionPanel`（`:80-86`，→ `/admin/roles/{id}/permission-codes`、`/admin/clients/{id}/menus`）；`:11` `AccountMappingPanel`（`:100-121`，→ `/admin/mappings*`，且 `clientLabels` 列全 6 应用、`defaultClient` 只是默认过滤而非硬边界）。 |
| **目标调用面** | 应用台部分同 §2.B/§2.C（同源 + path 化）。两个平台级页签 → **迁到 portal 中心台**（A 已有对应页签）。 |
| **要删除的 UI 元素** | ① 页签「菜单授权」`el-tab-pane`（`:7-9`，含 `menuPermConfig` `:80-86`）；② 页签「账号映射」`el-tab-pane`（`:10-12`，含 `mappingConfig` `:100-121`）。**删后空位**：外层 `el-tabs`（`:3-13`）只剩「用户」一页 → 去掉 `el-tabs`，直接渲染 `<UserManagementPanel :config="config" />`；`import` 中移除 `MenuPermissionPanel`/`AccountMappingPanel`/`createAccountMapping*`/`MenuPermissionConfig`/`AccountMappingConfig`（`:26-38`）。 |
| **要新增的 UI 元素** | 无。 |
| **空态 / 错误态文案** | 见 §7。 |
| **风险** | 🔴 删除页签需确认无其它入口依赖（否则运维人员会失去入口）→ **待确认 §8-2**；`defaultClient` 只是过滤（`authorizationMatrix.ts` 无 client 硬边界概念）—— 拆走后应用台不再有跨系统视图，符合 D-3。 |

---

### 2.E cosmic 用户管理 = **应用台（路由名撞车）**（`cosmic-studio/frontend/src/views/Admin.vue`）

| 项 | 内容 |
|---|---|
| **页面定性** | **应用台**。但路由名为 `/admin`（`cosmic-studio/frontend/src/router.js`），与「平台管理台」语义撞车；同页还混有 **LLM 配置**（`:3-24`）。 |
| **现状调用面** | `:33` `UserManagementPanel`；`:68` `baseUrl:'/api/admin/users'`（**自家 BFF 同源 ✅**，经 cosmic-api 代理，注释 `:65-66` 明示「绝无服务账号兜底」）；`:79` `scope:{mode:'app',clientId:SSO_CONFIG.clientId}`（`cosmic-studio/frontend/src/utils/sso.js:72` = `cosmic-studio`）；`:93-97` `appRoles.baseUrl:'/api'`；`:3-24` + `:47-62` LLM 配置（`/studio/llm-config`）。 |
| **目标调用面** | 同源已达标；path 化见 §6。 |
| **要删除的 UI 元素** | ① 「新建用户」按钮（组件 `:24`）；② （建议）把 **LLM 配置** 从本页拆出到独立路由（本页语义应只有「本系统用户」）——**待确认 §8-3**。 |
| **要新增的 UI 元素** | 无。 |
| **空态 / 错误态文案** | 见 §7。 |
| **风险** | 🔴 路由 `/admin` 改名（P2-7，建议 `/members`）会影响：直达链接、菜单 registry 的 path、nginx location（**待确认 §8-3**）。 |

---

### 2.F infra「本系统用户」= **应用台（参考实现）**（`infra-monitor-web/src/views/users/UsersView.vue`）

| 项 | 内容 |
|---|---|
| **页面定性** | **应用台**。路由 `infra-monitor/infra-monitor-web/src/router/index.ts:67-70`（`path:'users'`，`perm menu:users`）。**6 个应用台中唯一已同源 BFF 者**。 |
| **现状调用面** | `:3` `UserManagementPanel`；`:35` `baseUrl:'${API_BASE_URL}/api/admin/users'`（**BFF 同源 ✅**）；`:48` `scope:{mode:'app',clientId:'marschat-inframon'}`；`:68-73` `appRoles.baseUrl:'${API_BASE_URL}/api'`。 |
| **目标调用面** | path 化见 §6；保持「两层 `/api`」约定（`:28-34` 注释：nginx `location /infra/api/` 会剥一层）。 |
| **要删除的 UI 元素** | 「新建用户」按钮（组件 `:24`）。 |
| **要新增的 UI 元素** | 无。 |
| **空态 / 错误态文案** | 见 §7。 |
| **风险** | ⚠️ 两层 `/api`（`:35` vs `:69`）**不是笔误**，勿"修"成一层（`:28-34`/`:60-67` 注释记录了 2026-09-15 两次线上 404 实测）。 |

---

### 2.G activecode「本系统用户」= **应用台（手写静态页）**（`activecode/members.html`）

| 项 | 内容 |
|---|---|
| **页面定性** | **应用台**。无构建静态页（原生 JS），不走公共组件。 |
| **现状调用面** | `:169` `CLIENT_ID='marschat-activecode'`；`:170` `API='/activecode/api/admin'`（自家 BFF）；端点：列成员 `GET /users?client=...`（`:216`）、读角色 `GET /roles`（`:260`）、查绑定 `GET /users/{id}/client-roles?client=`（`:274`）、绑角色 `PUT /users/{id}/client-roles?client=`（`:290`）、移出 `PUT ...{roleIds:[]}`（`:302`）、成员池 `GET /users?client=...&size=200`（`:320`）、平台池 `GET /users?size=200`（`:325`）、批量加人循环 `PUT`（`:356-359`）。 |
| **目标调用面** | path 化：`GET /admin/clients/marschat-activecode/members`、`PUT /admin/clients/marschat-activecode/users/{id}/roles`、`DELETE /admin/clients/marschat-activecode/members/{id}`（§6）。 |
| **要删除的 UI 元素** | **无** —— 本页**已是目标形态**（只有「添加已有用户」`:106`、「本系统角色」`:246`、「移出本系统」`:247`；**无「新建」、无「删除」、无「重置密码」**）。 |
| **要新增的 UI 元素** | 无。 |
| **空态 / 错误态文案** | `:230`「本系统暂无用户」、`:331`「没有可加入的用户」—— 与 §7 统一口径基本一致，可保留。 |
| **风险** | 手写页与组件**并行演进**：组件改作用域裁剪时本页不受影响（无组件依赖），但 path 化端点变更需**单独手改**本页，易漏 → 建议在 ADR/手册登记「无构建应用」的同步清单。 |

---

## 3. 「应用台加个人」完整动线（用户诉求最关心的交互）

> 现成实现：组件 `UserManagementPanel.vue:709-813`（Vue 版）与 `activecode/members.html:309-365`（原生版）已实现，**逻辑正确但走的是 `?client=` 旧端点**，需随 §6 改 path。

**动线 A：添加已有用户（首选）**
1. **入口**：「本系统用户」页右上「＋ 添加已有用户」（组件 `:26`；activecode `:106`）。
2. **弹窗字段**：搜索框（username/email/nickname）+ 候选结果表格（多选，`el-table type=selection`）+ 「成员状态」列（已加入/未加入）。
3. **校验规则**：
   - 未勾选 → 「加入本系统」按钮 `disabled`（组件 `:308`）；
   - 已在本系统者 → 结果行置灰不可勾（组件 `:294-301`/`:771-773`；activecode `:326`）；
   - 本应用无 client 级角色 → 阻断并提示（组件 `:791-793`；activecode `:355`）。
4. **默认角色（安全关键）**：取**最低权限**角色 —— 优先 `code==='user'`，其次任意非 `admin`，最后兜底（组件 `:733-745`；activecode `:338-345`）。⚠️ 注释 `:725-732` 记录了「原先取 `mine[0]` 导致『加个人默认给管理员』」的历史缺陷，勿回退。
5. **落库调用**：`POST /admin/clients/<clientId>/members { userId, roleIds:[默认角色] }`（目标形状；现状为循环 `PUT /admin/users/{uid}/client-roles?client=<id>`，组件 `:798-803` / activecode `:356-359`）。服务端 `assignUserClientRoles` 写 `sys_user_role` + 审计 `user.client_roles`。
6. **成功反馈**：`已加入 N 个用户（最迟 60 秒生效）`（组件 `:804`；activecode `:361`「已加入本系统 N 人」）。
7. **失败反馈**（按中心 message 原样透传，见 §7）。

**动线 B：邀请新建（Phase 13 预留，本轮不做）**：字段 = 邮箱 + 本系统角色（**不填口令**）；落库 `POST /admin/clients/<id>/invitations {email, roleIds}` → 中心发邀请邮件 → 被邀者自助设密码 → 自动入本系统。**现在只需预留按钮位与接口形状**，避免未来改成员层签名。

---

## 4. 平台管理员的「这人能进哪些系统」**反向视图**

- **落在哪个页面**：portal 中心台 `AdminConsoleView.vue`「跨应用授权」页签（`:22-24`，组件 `CrossAppAuthPanel`）。
- **现状**：矩阵是**用户出发**（行=用户，列=应用，`CrossAppAuthPanel.vue:28-83`；动态列由后端 `clients[]` 驱动 `:52-53`）。**缺「按应用反查人」**。
- **数据来自哪个已有接口**：`GET /admin/authorization-matrix?keyword&page&size`（`authorizationMatrix.ts:227-242`；后端 `AdminAuthzMatrixController`）。响应已含 `records[].apps{<clientId>:[roles]}` 与 `clients[{clientId,name}]`（`authorizationMatrix.ts:14-16,54-60`）——**反向视图无需新接口**，只需前端转置渲染，或加一个「按应用筛选」视图：
  - **最小改动**：加「视图切换」开关（用户→应用 / 应用→用户），前者复用现有渲染，后者把 `records` 按 `clientId` 分组、以「应用」为行、「用户+本系统角色」为列。数据源不变。
  - **大列表分页**：当某应用成员很多时，用 `GET /admin/clients/{clientId}/members?page&size`（D-1 规划的 Membership 只读端点）单应用翻页。
- **另一处缺口（设计 §2.3-1）**：矩阵只列 `scope='client'` 的角色绑定，**平台超管的「隐含进入权」不体现** → 后端对 `globalRole in (superadmin,admin)` 的行补 `"__implicit"` 标记，前端渲染灰底「超管」。
- **定性**：属**中心台**能力，仅平台管理员可见（`/portal/admin` 本地 `requiresAdmin` + 中心 `@PreAuthorize`）。

---

## 5. clientId 对照表（真值照抄 `devtools/apps-registry.yml`，未推测）

| 应用 | clientId | 来源（apps-registry.yml 行） | 前端取用点 |
|---|---|---|---|
| 门户 Portal | `marschat-portal` | `:21` | `portal/.../UsersView.vue:52`、`AdminConsoleView.vue:102` |
| 知识库 kb-web | `marschat-kbweb` | `:39` | `kb-web/src/config.ts:40`（`OIDC_CLIENT_ID` 缺省） |
| 运维后台 kb-ops | `marschat-kbops` | `:60` | `kb-ops-web/src/config.ts:38`（`OIDC_CLIENT_ID` 缺省） |
| 基础设施监控 | `marschat-inframon` | `:80` | `infra-monitor-web/.../UsersView.vue:48` |
| 激活码系统 | `marschat-activecode` | `:106` | `activecode/members.html:169` |
| COSMIC 度量表 | `cosmic-studio` | `:128` | `cosmic-studio/frontend/src/utils/sso.js:72` |

> ⚠️ 非「六应用」的注册项（`marschat-memory` `:160`、`marschat-tokenhub` `:170`、`frp-manager` `:181`、`p3-probe-client` `:193`）**不在本规格范围**；其中 `frp-manager` 有半接入登录页（见审计 C7），是否需要「本系统用户」页 **待确认**（未列入 §8，因不属「有用户管理页的应用」）。

---

## 6. 接口迁移对照表（现状 `?client=` → 目标 path 化）

| 语义 | 现状（组件/页面实际调用，附 `文件:行号`） | 目标（D-1/D-2 path 化） | 可达层 |
|---|---|---|---|
| 列本系统成员 | `GET {base}?client=<id>&page&size&keyword`（`userAdmin.ts:243-251`；`members.html:216`） | `GET /admin/clients/<id>/members?page&size&keyword` | Membership |
| 查某人在本系统角色 | `GET /admin/users/{uid}/client-roles?client=<id>`（`UserManagementPanel.vue:502`；`members.html:274`） | `GET /admin/clients/<id>/users/{uid}/roles` | Membership |
| 绑/解本系统角色 | `PUT /admin/users/{uid}/client-roles?client=<id>` body `{roleIds}`（`:521`；`:290`/`:357`） | `PUT /admin/clients/<id>/users/{uid}/roles` body `{roleIds}` | Membership |
| 移出本系统 | `PUT .../client-roles?client=<id>` body `{roleIds:[]}`（`:696`；`:302`） | `DELETE /admin/clients/<id>/members/{uid}` | Membership |
| 加人（批量） | 循环 `PUT .../client-roles`（`:798-803`；`:356-359`） | `POST /admin/clients/<id>/members {userId, roleIds}` | Membership |
| 菜单减法 | `UserMenuOverridePanel`（`:390-406`）→ `menu-overrides?client=` | `PUT /admin/clients/<id>/users/{uid}/menu-overrides` | Entitlement（应用级） |
| **平台身份池（加人候选）** | `GET /admin/users?...`（**不带 client**，`:754`；`members.html:325`） | **待确认 §8-1** | Identity（平台级） |
| **全部角色（供选）** | `GET /admin/roles`（`authorizationMatrix.ts:245`；`members.html:260`） | **待确认 §8-1** | 平台级 |
| 新建平台身份 | `POST /admin/users`（`userAdmin.ts:261`） | **中心台专有**（应用台移除入口） | Identity |
| 编辑（全局角色/状态） | `PUT /admin/users/{id}`（`:265`） | **中心台专有** | Identity |
| 重置密码 | `PUT /admin/users/{id}/password`（`:273`） | **中心台专有** | Identity |
| 删除身份 | `DELETE /admin/users/{id}`（`:269`） | **中心台专有** | Identity |

---

## 7. 空态 / 错误态文案总表（逐条给具体文案）

**空态**

| 场景 | 现状 | 目标文案（应用台 / 中心台） |
|---|---|---|
| 列表无数据 | 组件无空态（`el-table` 默认「暂无数据」）；activecode `:230`「本系统暂无用户」 | 应用台：**「本系统暂无用户」** + 副文案**「点击右上角『添加已有用户』把已有账号加入本系统」**；中心台：**「暂无用户」** |
| 搜索无结果 | 同上 | **「没有找到匹配的用户，换个关键词试试」** |
| 加人候选空 | 组件 `:235-237` 是**角色**空态；成员候选空在 `:327`（activecode「没有可加入的用户」） | **「没有可加入的用户（平台无匹配账号，或都已在系统中）」** |
| 本应用无 client 级角色 | 组件 `:792`「本应用暂无 client 级角色，请先在『统一认证中心 → 角色与菜单授权』创建角色」 | 保留 |

**错误态（403 与 404 必须不同文案）**

| HTTP | 现状 | 目标文案 | 备注 |
|---|---|---|---|
| 401 | 组件 `:441` warning**「登录状态已过期，正在重新登录…」**；`userAdmin.ts:209`「登录已过期，请重新登录」 | 保留 | 触发 `onUnauthorized` 静默重授权 |
| **403** | `userAdmin.ts:209`「当前账号无权限管理用户」 | **「你没有本系统的用户管理权限，请联系平台管理员」** | 语义=**无权限**（本应用未持有 `api:admin:write`） |
| **404** | 无专门分支 → 落到 `userAdmin.ts:228` `payload?.message || '请求失败(HTTP 404)'` | **「请求的资源不存在（可能版本不一致，请刷新后重试）」**；若中心/BFF 能区分「成员不存在」→ **「该用户不在本系统，请刷新列表后重试」** | 语义=**不存在**（端点或资源） |
| 400/409 | 无 | **「该用户已在『本系统为管理员』，请直接编辑其角色」** | 加人时角色冲突 |
| 5xx/超时 | `userAdmin.ts:191`「请求超时，请稍后重试」/「网络异常，请检查连接」 | 保留 | — |

> **为何要区分 403/404**：应用台把 404 合理化为「已在别处处理」，而 403 是真权限问题；混用会让管理员把「我没权限」误读为「系统 bug」，或反之。要求 **BFF 不得把中心的 403 改写为 404/500**（沿用 `AdminProxyController` 原样透传口径）。

---

## 8. 待确认（不确定的地方，说清为什么）

| # | 事项 | 为什么不确定 | 影响面 |
|---|---|---|---|
| **1** 🔴 | **应用台「读平台池 / 读全部角色」的授权口径** | 「添加已有用户」动线**必须**读 Identity 层数据（`GET /admin/users` 不带 client、`GET /admin/roles`），但 D-1 把 Identity 定为**平台管理员专有**。二者冲突。现状代码（`UserManagementPanel.vue:710-713` 注释）**默认直接读平台池**。方案：(a) Membership 层新开「成员候选搜索」端点（只回受限字段）；(b) 允许应用管理员**受限读** `/admin/users`+`/admin/roles`。**权衡**=「应用管理员能否看到全平台用户名/邮箱」的信息面 vs「加人动线可用」。**建议走 (a)**，但需 ADR 追加决策。 | 全部 6 个应用台的加人动线 |
| **2** | **kb-ops 拆走两个页签的下游影响** | 删除「菜单授权」「账号映射」页签前，需确认无其它入口/书签/文档引用；kb-ops 的 menu 权限点是否只在中心台维护。 | kb-ops 运维用户 |
| **3** | **cosmic 路由 `/admin` 改名 + LLM 配置是否拆页** | 改名影响直达链接、菜单 registry path、nginx；LLM 配置与用户管理同页是否属刻意设计，未知。 | cosmic |
| **4** | **`appRoles.baseUrl` 语义不统一** | infra 注释（`:60-67`）说它是「**中心根**，组件再拼 `/admin`」，kb-web 写的是 `https://auth.marschat.online`（同语义），portal 写的是 BFF 根。path 化后统一为「BFF 根 + path」时，需确认每个 BFF 都实现了 `/admin/roles` 代理。 | 组件契约 |
| **5** | **审计 P2-6「kb-web 菜单路径 `/users` vs 实际 `/settings/users`」** | 源码显示路由 `path:'users'`（`kb-web/src/router/index.ts:128`）与 `settings`（`:120`）是**同级**，实际路由应为 `/{ctx}/users`；`views/settings/` 只是**文件目录**归属。**疑为审计把目录当路由**。需前端确认（含 router base 与父路由链）。 | kb-web 菜单可达性 |

---

## 9. 风险汇总

| # | 风险 | 等级 | 说明 |
|---|---|---|---|
| 1 | 共享组件改动波及 **全部 6 个应用台** | 🟠 | `:24`「新建用户」、`:188`「状态」开关的裁剪同时改变 6 应用行为，须整体回归 |
| 2 | app 作用域仍可「新建平台身份」 | 🔴 | 组件 `:24` + `:660`，违反 D-3；**改前**应用管理员可造全局身份 |
| 3 | app 作用域仍可「改全局状态（禁用）」 | 🔴 | 组件 `:188`（`v-if="editing"`），违反 D-3「停用属平台」 |
| 4 | kb-web / kb-ops 跨域直连中心 | 🔴 | `:26`/`:52`、`:47`/`:73` 硬编码 `auth.marschat.online` → P0-4-A 修复 |
| 5 | kb-ops 页内含平台级面板 | 🔴 | `:8`/`:11` → D-3 冲突 |
| 6 | cosmic 路由 `/admin` 语义撞车 | 🟡 | 与「平台管理台」混淆（P2-7） |
| 7 | `APPS`/`clientLabels` 双真源漂移 | 🟡 | `AdminConsoleView.vue:101-108`、`kb-ops-.../UsersView.vue:110-117`、`AccountMappingPanel` 各有一份硬编码应用名 |
| 8 | path 化依赖组件契约扩展 | 🟠 | `createUserAdminClient` 现无 `members` 形状 → 需新 client 或扩展（§8-1/§8-4） |
| 9 | 无构建应用（activecode）易漏改 | 🟡 | 手写页与组件并行演进，path 化需单独手改 |
| 10 | 两层 `/api`（infra）被误"修" | 🟡 | `:35`/`:69` 是 nginx 剥层约定，改一层即线上 404 |

---

## 附：本轮取证文件清单（供复核）

- 共享组件：`marschat-components/packages/auth-components/src/components/UserManagementPanel.vue`、`CrossAppAuthPanel.vue`、`src/utils/userAdmin.ts`、`src/utils/authorizationMatrix.ts`
- portal：`src/views/AdminConsoleView.vue`、`src/views/UsersView.vue`、`src/router/index.ts`、`src/layouts/MainLayout.vue`、`portal-server/src/main/resources/menu-registry.yml`
- kb-web：`mykng/kb-web/src/views/settings/UsersView.vue`、`src/config.ts`、`src/router/index.ts`
- kb-ops：`kb-ops/kb-ops-web/src/views/users/UsersView.vue`、`src/config.ts`、`src/router/index.ts`
- cosmic：`cosmic-studio/frontend/src/views/Admin.vue`、`src/utils/sso.js`
- infra：`infra-monitor/infra-monitor-web/src/views/users/UsersView.vue`、`src/router/index.ts`
- activecode：`active-manager/activation-code-server/src/main/resources/static/activecode/members.html`
- 真源：`devtools/apps-registry.yml`

> 本轮**未改任何代码文件**、**未 commit / push**。所有结论基于本机源码实读；涉及线上行为的判断（如 kb-ops 页签是否有其它入口）已标「待确认」，未代替产品/前端拍板。
