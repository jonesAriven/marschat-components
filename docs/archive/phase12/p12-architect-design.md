# Phase 12 第二阶段 · 设计规格（架构师）

> 版本：2026-09-16 · 角色：software-architect · 状态：设计规格（本轮不改代码）
> 依据：`p12-architect-audit.md`（第一轮复核）+ 本轮对 auth-center / 6 应用的源码实测
> 约束：本文不含任何明文口令 / secret；所有结论均附 `文件:行号` 证据。

---

## 0. 结论速览（先看这个）

| # | 结论 | 严重度 |
|---|---|---|
| C1 | **「应用管理员」这一角色在服务端根本不存在**。auth-center 所有 `/admin/**` 端点类级只有 `@PreAuthorize("hasRole('ADMIN')")`（平台管理员）。`client=xxx` 只是**查询过滤参数**，不是权限边界。所谓「平台管理员 vs 应用管理员」目前**纯 UI 约定**（`scope.mode='app'` 藏按钮），服务端零区分。 | 🔴 P0 |
| C2 | 推论：**能打开任一应用「本系统用户」页的人，必然是平台管理员**，因此天然能 `DELETE /admin/users/{id}`、`PUT /admin/users/{id}/password` 操全平台用户。「应用侧只能管本系统」是错觉。 | 🔴 P0 |
| C3 | 应用 BFF 多为**前缀全透传** `/admin/**`（activecode/cosmic/infra/infra-monitor），中心每加一个 `/admin` 端点，应用侧零改动即可触达 —— 边界只会越来越松。 | 🔴 P0 |
| C4 | P0-4 根因与 C1/C2 同源：kb-web/kb-ops 的「应用令牌」**就是**中心令牌（登录路由 `/kb/api/auth/** → lb://auth-center`），所以它既能调本应用 API，也能调中心 `/admin/**`。 | 🟠 P1 |
| C5 | P0-3：activecode `WebMvcConfig` 把 `POST /activation/generate`、`POST /activation/verify`、`GET /config/default-expire` **整个排除出鉴权**（匿名）；其余 6 个写接口**只验登录、不验权限**。 | 🔴 P0 |

**修复主线**：把「身份 / 成员 / 授权」三层**下沉到 API**（第 1 节），这是 C1–C4 的**共同根因**，一处修复覆盖全部；P0-3 是 activecode 单点补闸门（第 4 节）。

---

## 一、三层权限 API 落地规格

### 1.1 现状诊断（证据）

**① 平台管理员判据 = DB `user.role`，服务端权威、不可伪造**

- `auth-center/.../security/JwtAuthenticationFilter.java:50-85`：先验签（HS256 legacy 或 RS256 OIDC `jwtDecoder.decode`）→ 取 `principal=uid`（`:60` / `:70-74`）→ `userDetailsService.loadUserByUsername(principal)`（`:82`）→ 由 DB 现查角色注入 `ROLE_ADMIN`。
- `auth-center/.../controller/AdminUserController.java:22`：`@PreAuthorize("hasRole('ADMIN')")`（**类级**，覆盖全部 5 个端点）。
- `auth-center/.../controller/AdminRoleController.java:25`、`AdminAuthzMatrixController.java:52`、`AdminAppClientController.java`、`AdminAccountMappingController.java`、`AdminAuthzPolicyController.java`：**同一鉴权面，同一条规则**。

> ✅ 结论：平台管理员判定**不能**靠 token claim 伪造（claim 里的 role 不参与 authority 构造，authority 一律 DB 现查）。这条是好的，保留。

**② 但「应用管理员」判据完全缺失**

- `AdminUserController.java:41-51`：`list()` 的 `client` 参数只决定调 `listForAdminScoped(client,...)` 还是 `listForAdmin(...)` —— **同一端点、同一权限**，只是过滤范围不同。
- `AdminRoleController.java:83-107`：`/users/{userId}/client-roles?client=` 的 `client` 同样只是参数；无任何「调用者是否有资格改这个 client」的校验。
- 全仓 `grep`「应用管理员 / appAdmin / isAppAdmin」→ **0 命中**。

> 🔴 结论：**服务端没有「应用管理员」这个人**。有 `ROLE_ADMIN` 就能改任意 client 的任意用户；没有 `ROLE_ADMIN` 就连自己应用的用户列表都看不到（因为列表端点也要 `ROLE_ADMIN`）。「应用侧只读、平台侧可写」在服务端从未成立。

**③ 应用 BFF 的透传面过宽**

- `active-manager/.../controller/AdminProxyController.java:76`：`@RequestMapping("/activecode/api/admin/**")` —— **前缀全透传**，注释（`:48-49`）明说「中心每新增一个 `/admin/**` 端点，消费方零改动即可用」。即：应用的**任意**登录用户（持有自己中心 token）经此代理可触达**全部** `/admin/**`。
- `cosmic-studio/app/routers/auth.py:565-659`：`_center_proxy` 逐端点声明了 `PUT /users/{id}`、`PUT /users/{id}/password`、`DELETE /users/{id}`，门槛只有 `require_permission("api:admin:write", min_role="admin")`（本地 admin + 中心 api 点）—— **同样的越权面**：cosmic 的 app admin 能删/改/重置任意中心用户的密码。
- 二者都「不复制平台角色判定、原样透传状态码」（`AdminProxyController.java:43-45`），所以**中心不收紧，应用侧就永久敞开**。

**④ 已有的、可复用的资产（别重造）**

| 资产 | 位置 | 用途 |
|---|---|---|
| `listForAdminScoped(client, ...)` | `UserService`（被 `AdminUserController.java:48` 调用） | 成员层「列本系统用户」现成实现 |
| `assignUserClientRoles(userId, client, roleIds, operatorId)` | `PermissionService`（被 `AdminRoleController.java:102` 调用） | 成员层「加人 / 移出本系统」现成实现，**已含审计留痕**（`:88-94` 注释） |
| `userClientRoleIds(userId, client)` | `PermissionService`（`AdminRoleController.java:85`） | 成员层「查角色绑定」 |
| `computeForUser(userId, client)` | `PermissionService`（`PermissionController.java:42`） | 判「是否应用管理员」的原料 |
| 操作审计 `OperationLogService` | `OperationLogController` `/auth/log/list` | 审计日志**已存在**，action 例 `user.remove_from_app`、`user.client_roles` |
| 应用注册表 `sys_app_client` | `AdminAuthzMatrixController.java:65-66` | 列「全部应用」现成 SQL |

> 三层拆分**不需要新表**，只要在既有 Service 上加一个「是不是本应用管理员」的判据 + 一组 path 化端点。

---

### 1.2 三层定义与判据

```
┌── Identity 层（身份）──────── 仅平台管理员 (ROLE_ADMIN)
│     管：人是否存在、口令、全局角色、停用/删除墓碑、账号映射、跨应用总览
│
├── Membership 层（成员）──── 应用管理员 (本 client 的 api:admin:write)
│     管：谁在本系统、在本系统什么角色、移出本系统
│
└── Entitlement 层（授权）
      ├ 平台级：角色 → 权限点（角色授权矩阵）……… 仅平台管理员
      └ 应用级：用户 → 应用角色 / 菜单减法 …………… 应用管理员（限本 client）
```

**关键原则：client_id 从 URL path 取，不从 body/query 取。** 只要 client 是「参数」，应用 A 的管理员改 `client=B` 就能越界；把它钉进 path 并在服务端强制注入，越界在路由层就不成立。

---

### 1.3 Identity 层（Identity）—— 仅平台管理员

判据：`@PreAuthorize("hasRole('ADMIN')")`（现状即此，**保持**）。
authority 来源：`JwtAuthenticationFilter` → `userDetailsService` → DB `user.role`（见 1.1①）。

| method | path | 入参 | 返回 | 权限点 | 现状 |
|---|---|---|---|---|---|
| GET | `/admin/users` | `realmId,keyword,page,size`（**不带 client**） | `PageResult<User>` | `hasRole('ADMIN')` | 已有（`AdminUserController.java:40`） |
| POST | `/admin/users` | `{username,password,role,nickname,email,realmId}` | `User` | `hasRole('ADMIN')` | 已有（`:53`） |
| PUT | `/admin/users/{userId}` | `{role,status,nickname,email}` | `User` | `hasRole('ADMIN')` | 已有（`:61`） |
| DELETE | `/admin/users/{userId}` | — | `Void`（墓碑） | `hasRole('ADMIN')` | 已有（`:68`） |
| PUT | `/admin/users/{userId}/password` | `{newPassword}` | `Void` | `hasRole('ADMIN')` | 已有（`:74`） |
| GET | `/admin/authorization-matrix` | `keyword,page,size` | 用户×应用矩阵 | `hasRole('ADMIN')` | 已有（`AdminAuthzMatrixController.java:57`） |
| GET | `/admin/mappings` | `clientId,userId,keyword,page,size` | 映射分页 | `hasRole('ADMIN')` | 已有 |
| GET | `/admin/mappings/summary` | — | 覆盖概览 | `hasRole('ADMIN')` | 已有 |
| GET | `/admin/users/{userId}/mappings` | — | 按人聚合各系统映射 | `hasRole('ADMIN')` | 已有 |
| POST | `/admin/mappings/{mappingId}/bind` | `{userId}` | — | `hasRole('ADMIN')` | 已有 |
| POST | `/admin/mappings/{mappingId}/unbind` | — | — | `hasRole('ADMIN')` | 已有 |
| PUT/GET | `/admin/clients/{clientId}/menus` | `{menusYaml}` | — | `hasRole('ADMIN')` | 已有（`AdminAppClientController.java:34,46`） |
| GET/PUT | `/admin/roles/{roleId}/permission-codes` | `{codes}` | — | `hasRole('ADMIN')` | 已有（**平台级角色授权**） |
| GET | `/admin/roles` | — | 角色清单 | `hasRole('ADMIN')` | 已有 |
| GET | `/admin/authz/policy` `/impact` `POST /migrate` `/restore-legacy` | — | — | `hasRole('ADMIN')` | 已有（`AdminAuthzPolicyController`） |

**改动点：无**（Identity 层现状即设计）。唯一要求是 **应用 BFF 必须停止透传本层端点**（见 1.7）。

---

### 1.4 Membership 层（Membership）—— 应用管理员可写

**新增判据（服务端如何认定"应用管理员"）**

推荐落在 `PermissionService`（`auth-center/.../service/PermissionService.java`）新增方法：

```
boolean isAppAdmin(long userId, String clientId)
```

判据口径（两选一，建议 **A**）：
- **A（推荐，复用已有权限点）**：该用户在该 client 下持有 `api:admin:write` 权限点。
  - 原料即 `computeForUser(userId, clientId)`（`PermissionController.java:42` 已在用）返回的 `permissions` 集合；
  - 与 cosmic BFF 现有门槛口径一致（`cosmic-studio/app/routers/auth.py:544` `require_permission("api:admin:write", min_role="admin")`），**语义已存在，无需新概念**。
- B：该用户在 `sys_user_role` 中持有 client 级 role `code='admin'`。口径更硬但需保证每个应用都有 `admin` 角色。

**闸门实现（放哪）**

新建 `auth-center/.../security/AppAuthzEvaluator.java`（Spring Bean，命名 `appAuthz`），供 SpEL 调用：

```
@Component("appAuthz")
public class AppAuthzEvaluator {
    // 调用者 uid 从 SecurityContext（JwtAuthenticationFilter 已设）取
    public boolean isAppAdmin(Authentication auth, String clientId) {
        Long uid = Long.parseLong(auth.getName());
        if (SecurityUtils.hasRoleAdmin(auth)) return true;   // 平台管理员天然可管任意应用
        return permissionService.isAppAdmin(uid, clientId);
    }
}
```

**新增端点（path 化，client_id 服务端强制注入）**

| method | path | 入参 | 返回 | 鉴权 | 落库调用（复用已有） |
|---|---|---|---|---|---|
| GET | `/admin/clients/{clientId}/members` | `keyword,page,size` | `PageResult<User>`（含 `appRoles`） | `@PreAuthorize("@appAuthz.isAppAdmin(authentication,#clientId)")` | `userService.listForAdminScoped(#clientId,...)` |
| POST | `/admin/clients/{clientId}/members` | `{userId, roleIds:[...]}` | `{bound:n}` | 同上 | `permissionService.assignUserClientRoles(#userId, #clientId, #roleIds, operatorId)` |
| DELETE | `/admin/clients/{clientId}/members/{userId}` | — | `{bound:0}` | 同上 | `assignUserClientRoles(#userId, #clientId, Set.of(), operatorId)`（空集＝移出本系统） |
| GET | `/admin/clients/{clientId}/member-candidates` | `keyword`（**必填**）、`page`、`size` | `PageResult<Candidate>`（**只回 `userId/username/nickname` 3 字段**） | 同上 | **只列尚未加入本 client 的用户**；读 `user` 排除已绑本 client `sys_user_role` 者；**写审计**（`OperationLogService`） |

> 🔴 **`member-candidates` 的五条硬约束（D-7，缺一不可 —— 这是对 D-1「Identity 仅平台管理员」的*唯一*最小化例外）**：
> ① **只返回 `userId / username / nickname`**，**禁** `email / role / status`；② **只列尚未加入本 client 的用户**；③ `keyword` **必填且 ≥2 字符**（防全量拉取）；④ `size` 服务端 **clamp ≤20**；⑤ **每次调用写审计**。
> 口径边界：Identity 层的「管理**写**」（建/停用/改密/删身份、改全局角色）**仍仅平台管理员** —— 本端点**只读、不符权**。

**「强制注入 client_id」的实现要点**：
1. `clientId` 只存在于 `@PathVariable`，**不接收** body 或 query 里的 `client`（若历史 body 带 `client`，服务端**忽略并覆盖**为 path 值）。
2. `AppAuthzEvaluator.isAppAdmin` 校验的 clientId 与 Service 落库用的 clientId **必须是同一个 `#clientId` 变量**（同一次方法调用，杜绝「鉴权用一个、落库用另一个」）。
3. 应用 BFF 透传时把 `clientId` 拼进 path（而不是 query），例如 kb-web 的 `baseUrl` 应为 `/kb/api/admin/clients/marschat-kbweb/members`。

---

### 1.5 Entitlement 层（授权）

| 子层 | method | path | 鉴权 | 说明 |
|---|---|---|---|---|
| 平台级 | GET/PUT | `/admin/roles/{roleId}/permission-codes` | `hasRole('ADMIN')` | 角色→权限点，**保持仅平台** |
| 平台级 | POST | `/admin/clients/{clientId}/roles` | `hasRole('ADMIN')` | 建应用级角色（**保持仅平台**，避免应用自造角色提权） |
| 应用级（**只读**） | GET | `/admin/clients/{clientId}/roles` | `@appAuthz.isAppAdmin(authentication,#clientId)` | **只读本 client 的角色清单**（供加人弹窗选角色）；**不暴露全局角色表**（D-7） |
| 应用级 | GET | `/admin/clients/{clientId}/users/{userId}/roles` | `@appAuthz.isAppAdmin(auth,#clientId)` | 查某人在本系统的角色（path 化） |
| 应用级 | PUT | `/admin/clients/{clientId}/users/{userId}/roles` | 同上 | 绑/解本系统角色（`roleIds=[]`＝移出） |
| 应用级 | GET/PUT | `/admin/clients/{clientId}/users/{userId}/menu-overrides` | 同上 | 菜单减法（只减不加） |

> ⚠️ **只读 vs 可写的分界**：应用管理员对**权限点**只能「在平台已授予角色的范围内做减法」（menu-overrides），**不能**给角色新增权限点（那是平台级的 `roles/{roleId}/permission-codes`）。这条是防应用管理员自我提权的关键，务必在评审时确认。

> 🔴 **同名不同权（易被后人改错，务必看这里）**：`/admin/clients/{clientId}/roles` 的 **GET 与 POST 是两个权限口径**——
> - **POST**（**建**角色）：`hasRole('ADMIN')` —— **仅平台管理员**（防应用自造角色提权）；
> - **GET**（**读**本 client 角色清单）：`@appAuthz.isAppAdmin(authentication,#clientId)` —— 应用管理员**可读，但只限本 client**（D-7）。
>
> 二者**路径完全相同、方法不同、鉴权不同**。实现时**不要**把类级 `hasRole('ADMIN')` 套到 GET 上（会让加人弹窗拿不到角色而 403），**也不要**把 `@appAuthz` 套到 POST 上（会给应用自造角色提权的口子）。

---

### 1.6 闸门放哪：统一放 auth-center（推荐）

**推荐：统一放 auth-center 的 Controller（`@PreAuthorize`），应用 BFF 只做「透传 + 收窄白名单」。**

理由：
1. 现有全部管理端点已在 auth-center 的 `@PreAuthorize` 面（1.1①），判定所需数据（`sys_user_role`/`sys_permission`/`sys_role`）全在中心库，**应用侧没有**；
2. `AdminProxyController.java:43-45` 已确立「应用侧不复制平台角色判定，避免两处真源」的取舍 —— 沿用，别在 6 个应用里各抄一份；
3. 应用 BFF 强行做鉴权＝6 份重复实现，改一处漏 5 处（历史教训见 `kb-web/src/utils/token.ts:8-10` 注释）。

**与现有 `@RequirePermission` / `PermissionAuthzFilter` 的关系**：
- 二者是**应用侧**闸门（kb-gateway `PermissionAuthzFilter` 管「这个 token 有没有写这个资源的权限点」），属于**业务资源级**鉴权；
- 本层是**管理面**鉴权（「这个人有没有资格管这个应用的用户」），继续留在中心 `@PreAuthorize`；
- 两者不重叠：`api:admin:write` 权限点**同时**被两者消费 —— `PermissionAuthzFilter` 用它拦业务写接口，`AppAuthzEvaluator` 用它判应用管理员。**同一权限点、两处消费，是设计一致的，不是重复。**

---

### 1.7 存量兼容：迁移步骤（核心，工程师按序做）

**Step 1｜放宽两个既有端点（向后兼容，不破坏在用调用）**
- `AdminRoleController.java:95` `PUT /admin/users/{userId}/client-roles?client=` → 注解改为
  `@PreAuthorize("hasRole('ADMIN') or @appAuthz.isAppAdmin(authentication,#client)")`
- `AdminRoleController.java:118` `PUT /admin/users/{userId}/menu-overrides?client=` → 同上一行口径
- **保留** `?client=` 参数（存量调用方在传），但服务端与鉴权用同一变量。
- 迁移完成后（应用全部切到 path 化端点），可标记为 `@Deprecated`，**不物理删除**（保留回滚路径）。

**Step 2｜新增 path 化端点（1.4）**，两版端点并存一个发版周期。

**Step 3｜应用 BFF 白名单收窄（防越权的关键）**
- `active-manager/.../AdminProxyController.java:76`：`/activecode/api/admin/**` 全透传 → 改为**白名单**，只放行：
  `/admin/clients/marschat-activecode/members**`、`/admin/clients/marschat-activecode/member-candidates**`、
  `/admin/clients/marschat-activecode/roles`（**本 client 只读角色**，D-7）、`/admin/clients/marschat-activecode/users/**`、
  `/admin/users/{id}/client-roles?client=marschat-activecode`、`.../menu-overrides?client=marschat-activecode`。
  其余（`/admin/users` POST/DELETE、`/admin/users/{id}/password`、`/admin/mappings/**`、`/admin/roles/**`【**全局**角色表，注意与上行的 `/admin/clients/{cid}/roles` 区分】）**一律 404**。
  ⚠️ **白名单务必包含 D-7 的两个新端点**（`member-candidates`、`clients/{cid}/roles`），否则前端改造完成后会被本应用自己的白名单挡下（403/404）。**该要求对 cosmic / infra-monitor / kb-ops / kb-web 的应用侧白名单同样适用**（见下方各条）。
- `cosmic-studio/app/routers/auth.py:565-659` `_center_proxy`：**删除** `admin_create_user`(`:616`)、`admin_update_user`(`:644`)、`admin_reset_password`(`:650`)、`admin_delete_user`(`:657`) 这四个透传；保留 list/client-roles，改为 path 化转发。
- infra-monitor 的 `AdminProxyController`（同类全透传）：同 activecode 口径收窄。
- kb-ops / kb-web：见第 3 节（同时收窄 + 同源化）。

**Step 4｜回归**：对每个应用用「非平台管理员的应用管理员」token 实测 —— 能管本系统成员 ✅；`DELETE /admin/users/{id}` 应得 403 ✅。

---

## 二、两类用户管理菜单：功能规格 + UX

> 用户原话：「每个系统是不是应该有自己的用户管理菜单，然后统一认证登录系统是不是也应该有个用户管理菜单。这两个菜单功能应该是不同的…如何设计好，如何设计更符合使用习惯、更健全、功能扩展性更强」

### 2.0 一句话设计主张

**中心台管「人」，应用台管「关系」。**
- 中心「统一认证中心 → 统一用户」＝**人的档案 + 平台级授权**（创建、停用、删、改密、跨应用矩阵、账号映射）。
- 应用「本系统用户」＝**人与本应用的关系**（有没有账号、在本系统什么角色、在本系统看得到哪些菜单）。
- **应用台不创建人**（人属于平台）；要加人＝「邀请已有用户」或「添加已有用户」。

### 2.1 功能对照表（行=功能项，格=有/无+交互形态）

| 功能项 | 中心平台管理台（scope=platform） | 应用「本系统用户」（scope=app） |
|---|---|---|
| 查看用户 | ✅ 全平台列表（`GET /admin/users` 不带 client） | ✅ 只列本系统相关用户（`.../members`，服务端 `listForAdminScoped` 强制过滤） |
| 搜索 | ✅ username/email/nickname | ✅ 同（范围限本系统） |
| 新建用户 | ✅ 表单：username/password/全局 role/nickname/email | ❌ **无**（改为「添加已有用户」/「邀请」） |
| 邀请 | ✅ 可按邮箱发邀请（**预留**） | ✅ 主力动线（见 2.2） |
| 「添加已有用户」 | ✅ 全平台搜索后直接建 | ✅ 搜中心已有用户 → 绑本系统角色 |
| 停用 / 启用 | ✅ 全局 status（`PUT /admin/users/{id}` status） | ❌ 无（停用是全局动作，属平台） |
| 移出本系统 | ✅ 经矩阵改绑（清空 client 角色） | ✅ 主力（`DELETE .../members/{userId}`，等价清空 client 角色） |
| 重置密码 | ✅（`PUT /admin/users/{id}/password`） | ❌ 无（口令属身份层） |
| 删除（墓碑） | ✅（`DELETE /admin/users/{id}`） | ❌ 无 |
| 全局角色绑定 | ✅ 改 `user.role` | ❌ 无 |
| 应用角色绑定 | ✅ 跨应用矩阵单元格改绑 | ✅ 主力（本系统 roles，`roleIds` 覆盖） |
| 建应用角色 | ✅（`POST /admin/clients/{clientId}/roles`） | ❌ 无（防应用自造角色提权） |
| 菜单授权 | ✅ 角色→权限点（平台级） | ✅ 仅**减法**（menu-overrides，在平台已授范围内扣除） |
| 账号映射 | ✅ 全量 + 手工认领/解绑 | ⚠️ 只读本应用映射（可看不可绑，绑定归平台） |
| 跨应用总览 | ✅ 授权矩阵（行=人，列=应用） | ❌ 无 |
| 审计日志 | ✅ `GET /auth/log/list`（全局） | ⚠️ 只读本应用相关（按 resourceType/client 过滤） |
| 改自己资料/密码 | ✅ `PUT /user/profile` `/user/password` | ✅ 同（个人中心，非管理面） |

### 2.2 应用管理员「加个人」的动线（具体到弹窗字段/校验/落库）

**动线 A：添加已有用户（首选，命中率最高）**
1. 入口：应用「本系统用户」页右上「+ 添加用户」→ 弹出对话框。
2. 字段：**搜索框**（username/email/nickname）+ 结果列表（单选）+ **本系统角色**（多选，取自 `GET /admin/roles?client=<本应用>` 中 `scope=client` 且属本应用的）。
3. 校验：
   - 未选人 → 禁用「确定」；
   - 角色至少选 1（不选＝加进来啥都干不了，无意义）；
   - 已在列表中的用户 → 结果里置灰标「已在本系统」。
4. 落库：`POST /admin/clients/{clientId}/members {userId, roleIds}` → 服务端 `assignUserClientRoles` → 写 `sys_user_role` + 审计 `user.client_roles`。
5. 成功提示：`已添加「张三」到本系统（角色：运维工程师）`。
6. 失败文案（按中心返回 message 原样透传）：
   - 403 → `你没有本系统的用户管理权限，请联系平台管理员`；
   - 409/400 → `该用户已在「本系统为管理员」，请直接编辑其角色`。

**动线 B：邀请新建（预留，Phase 13+）**
1. 入口：同对话框切到「邀请新用户」页签。
2. 字段：**邮箱** + 本系统角色。**不填口令**（口令由被邀者自设）。
3. 落库：中心 `POST /admin/invitations {email, clientId, roleIds}`（**新表 `invitation`：email, client_id, role_ids, token, status, expires_at**）→ 发邀请邮件 → 被邀者点链接设口令 → 中心建身份 + 自动绑 client 角色。
4. 为何现在就把接口形状定下来：邀请＝「延迟生效的成员创建」，若不预留，未来要么改成员层签名，要么应用各自造邀请，破坏统一。

### 2.3 平台管理员「这人能进哪些系统」的反向视图

**现状**：`AdminAuthzMatrixController`（`/admin/authorization-matrix`）已实现「行=人 × 列=应用」矩阵 —— **基本够用，无需重建**。缺口在两点：

1. **只列 `scope='client'` 的角色绑定**（`AdminAuthzMatrixController.java:98` `WHERE r.scope='client'`），平台超管在各应用的「隐含进入权」（靠超管例外逻辑）**不体现** → 平台管理员看不到「超管其实哪都能进」。**补法**：矩阵响应里对 `globalRole in (superadmin,admin)` 的行，`apps` 补一个 `"__implicit":"平台管理员（全部应用）"` 标记，前端渲染为灰底「超管」。
2. **缺「按应用反查人」**：加 `GET /admin/clients/{clientId}/members?size=all`（1.4 已规划）即可回答「某系统有哪些人」。

**字段与 SQL 思路**（沿用现有实现，不新表）：
- 列：`SELECT client_id, COALESCE(NULLIF(name,''),client_id) FROM sys_app_client WHERE status=1`（`:65`）。
- 行：`SELECT id,username,nickname,email,role AS globalRole,status FROM user WHERE deleted=0 ...`（`:85`）。
- 格：`SELECT ur.user_id, r.client_id, r.id, r.code, r.name FROM sys_user_role ur JOIN sys_role r ON r.id=ur.role_id WHERE r.scope='client' AND r.client_id IS NOT NULL AND ur.user_id IN (...)`（`:96`）。

### 2.4 越权 / 误操作风险清单

| # | 风险 | 堵法 | 落在哪个文件 |
|---|---|---|---|
| R1 | 应用管理员靠 `?client=B` 改到应用 B 的成员 | client_id 钉进 path，鉴权与落库同一变量 | 新增 `AdminClientMemberController.java`（auth-center） |
| R2 | 应用管理员越权调 `DELETE /admin/users/{id}` 删人 | 该端点保持 `hasRole('ADMIN')`；应用 BFF 白名单**不放行** | `AdminUserController.java`（不改）+ `AdminProxyController.java:76`（收窄） |
| R3 | 应用管理员重置他人密码（提权） | 移出应用 BFF 白名单；前端「重置密码」按钮在 `scope.mode='app'` 下**不渲染** | `AdminProxyController.java` + `auth-components/UserManagementPanel.vue` |
| R4 | 应用管理员给角色**新增**权限点自我提权 | 应用级只能发 `menu-overrides`（减法）；`roles/{id}/permission-codes` 仅平台 | `AdminRoleController.java:49`（保持 `hasRole('ADMIN')`） |
| R5 | 应用 BFF 全透传 `/admin/**`，中心加端点即被动放开 | 白名单制（默认拒绝），新增端点须显式登记 | `active-manager/.../AdminProxyController.java`、`cosmic.../auth.py:565+`、infra-monitor 同类 |
| R6 | 删自己不拦 | `currentUserId` 已在组件传入（`kb-web/.../UsersView.vue:34`），中心 `deleteUser` 也校验 | 组件层已有，服务端兜底已有 |
| R7 | 删/停用后旧 token 仍可用 | `JwtAuthenticationFilter.java:62-65` tv 版本校验（legacy）+ `:104-110` 黑名单 —— **已有**，OIDC 径无 tv（⚠️ 已知缺口，登记为权衡） | 无需改，登记 |
| R8 | 应用管理员把本系统最后一个人移除 → 应用无人可管 | 服务端校验「移出后本 client 至少剩 1 个 app admin」 | 新增 `AdminClientMemberController.java` |
| R9 | 邀请链接被转发盗用 | 邀请 token 一次性 + 绑邮箱 + 短期过期（`expires_at`） | Phase 13 邀请表 |
| R10 | 审计缺失（谁加的谁移的查不到） | 复用 `assignUserClientRoles`（已留痕 `user.client_roles`/`user.remove_from_app`） | 无需改，登记口径 |

### 2.5 扩展性预留（未来加功能时这套切分要不要改）

| 未来能力 | 现有切分是否要改 | 现在就该留的口子 |
|---|---|---|
| **用户组 / 部门** | ❌ 不用改。组＝「一批身份的集合」，属 **Identity 层**；「组在本系统的角色」＝ **Membership 层的批量写**。 | Membership 端点入参预留 `subjectType: user\|group`、`subjectIds:[]`（现在传 `userId` 即可，未来加 `groupId`）。**落库表 `sys_user_role` 未来加 `subject_type` 列**，或新建 `sys_group_role`。 |
| **数据行级权限** | ❌ 不用改。行级权限＝**Entitlement 层的扩展**（在 permission 上挂 `dataScope`）。 | permission 点 code 已是 `client:type:code` 三级，预留 `type=data`（`marschat-kbweb:data:doc_read`）；**接口形状不用动**（仍是「查权限集合」）。 |
| **邀请制** | ❌ 不用改（属 Membership 创建路径的一个变体）。 | Identity 层不新增端点；Membership 层加 `POST .../invitations`，形状见 2.2 动线 B。 |
| **审计日志** | ❌ 不用改。审计＝横向能力，已存在（`OperationLogService`）。 | 所有写 Service 统一走已有留痕口径；应用台只读时按 `resourceType` + client 过滤。 |

> **一句话**：三层切分（身份/成员/授权）对上述四种扩展**都不需要重构**，只需在层内加类型（`subject_type` / `type=data` / `invitation`）。这正是「先切层、后加类型」的价值 —— 反过来说，如果现在不做三层下沉（C1），未来每加一种能力都要在 6 个应用里各改一遍。

---

## 三、P0-4 会话与凭据加固规格（kb-web / kb-ops）

### 3.1 现状（证据）

**① 前端跨域直连中心**
- `kb-web/src/views/settings/UsersView.vue:24-30`：`createUserAdminClient({ baseUrl: 'https://auth.marschat.online/admin/users', getToken: () => getToken(), ... })` —— **硬编码公网域名跨域直连**。
- 同文件 `:51-56`：`appRoles.baseUrl: 'https://auth.marschat.online'`。
- `kb-ops-web/src/views/users/UsersView.vue:46-51`：`baseUrl: `${OIDC_ISSUER}/admin/users``（`OIDC_ISSUER` 默认 = `https://auth.marschat.online`，见 `kb-ops-web/src/config.ts:37`）。
- 同文件 `:72-77`（appRoles）、`:80-86`（菜单授权）、`:94-98`（账号映射）：baseUrl/issuer 全部指向中心公网域名。

**② 落在 localStorage 的是「中心令牌」，而不是独立的应用令牌**
- `kb-web/src/utils/token.ts:13-19`：`initTokenConfig({ accessTokenKey:'kb_access_token', ... })`。
- `kb-web/src/api/auth.ts:5-7`：`login()` 打 `POST /auth/login`（baseURL `/kb/api`）→ 经 `kb-gateway/src/main/resources/application.yml:83-88` 路由 `auth-center`（`Path=/kb/api/auth/**`，`StripPrefix=2`）→ 命中 **auth-center `/auth/login`**。
- `kb-web/src/stores/user.ts:16-24`：把该响应的 `data.accessToken`（即中心业务令牌）`setToken(...)` 落 localStorage。
- **推论**：localStorage 里这把令牌**同时**是本应用 API 的凭据（网关 `JwtAuthFilter` 验签）和中心 `/admin/**` 的凭据（中心 `@PreAuthorize` 按 DB role 判）。
- kb-ops 同构（`kb-ops-web/src/utils/token.ts:14-20` `kb_ops_access_token`；kb-ops 后端无 login 端点，`/ops-api/login` 亦落中心）。

**③ 为什么之前这么写**：`UsersView.vue:11-16` 注释原文「kb-web 持有的本就是 auth-center 签发的 OIDC access_token，因此直接跨域调 `/admin/users`，无需自建后端代理」—— 设计假设是「应用令牌＝中心令牌」，所以省掉了 BFF。

### 3.2 方案（分两步，A 先做、B 需良哥拍板）

#### 3.2-A 同源化：/admin 调用一律走同源 BFF（**立即可做，推荐先做**）

**目标**：浏览器不再跨域直连中心；`/admin` 能力统一经本应用后端转发；为 B 阶段（令牌分离）铺路。

1. **kb-ops 后端新增 BFF**（Servlet，照抄 activecode 范式最省事）
   - 新增 `kb-ops/src/main/java/com/kb/ops/controller/AdminProxyController.java`（包名按 kb-ops 实际结构）。
   - 照抄 `active-manager/.../AdminProxyController.java` 全部要点：
     - 只代理**白名单**（1.7 Step 3）路径，**不**全透传；
     - 用**调用者本人**的中心令牌转发（kb-ops 的 token 即中心令牌，从请求头取），**绝不**服务账号兜底（`AdminProxyController.java:38-40` 血泪）；
     - 拿不到凭据 → 401，让前端走正常重授权（`:80-83`）；
     - 状态码与响应体原样透传（`:101-104`）。
   - 注册前缀：`/ops/ops-api/admin/**`（与 `kb-ops-web/src/config.ts:23` `API_BASE_URL='/ops/ops-api'` 对齐）。
2. **kb-web 后端新增 BFF**（WebFlux 网关，做法不同）
   - `kb-gateway/src/main/resources/application.yml` 新增路由：
     ```
     - id: kb-admin-proxy
       uri: lb://auth-center
       predicates: [ Path=${KB_CONTEXT:/kb}/api/admin/** ]
       filters: [ StripPrefix=2 ]   # /kb/api/admin/... → /admin/...
     ```
     （放 `auth-center` 路由之后、`kb-api-not-found` 之前，注意顺序 —— `application.yml:117-128` 已注明顺序敏感。）
   - 令牌透传：网关默认会带原 `Authorization` 头（浏览器持有的中心令牌）→ 中心可识别。**若后续做 B 阶段**，再在此路由挂自定义 `GatewayFilterFactory` 做「应用令牌 → 中心令牌」的替换（见 3.2-B）。
   - ⚠️ 白名单收窄：WebFlux 下用 `Path` 断言**逐条列**，**不要**用 `/kb/api/admin/**` 通配（那就回到全透传）。
3. **前端改 baseUrl（逐行）**

   | 文件 | 行 | 现值 | 改为 |
   |---|---|---|---|
   | `kb-web/src/views/settings/UsersView.vue` | 26 | `'https://auth.marschat.online/admin/users'` | `` `${API_BASE_URL}/admin/users` ``（`API_BASE_URL='/kb/api'`，从 `@/config` 引入） |
   | 同上 | 52 | `baseUrl: 'https://auth.marschat.online'` | `baseUrl: API_BASE_URL` |
   | `kb-ops-web/src/views/users/UsersView.vue` | 47 | `` `${OIDC_ISSUER}/admin/users` `` | `` `${API_BASE_URL}/admin/users` ``（`API_BASE_URL='/ops/ops-api'`） |
   | 同上 | 73 | `baseUrl: OIDC_ISSUER` | `baseUrl: API_BASE_URL` |
   | 同上 | 81 | `baseUrl: OIDC_ISSUER` | `baseUrl: API_BASE_URL` |
   | 同上 | 95 | `issuer: OIDC_ISSUER` | `issuer: API_BASE_URL` |
4. **回归**：浏览器 DevTools Network 中**不得**再出现对 `auth.marschat.online/admin/**` 的请求（全部应为本域 `/kb/api/admin/**` 或 `/ops/ops-api/admin/**`）。

#### 3.2-B 令牌分离：中心令牌不落 web 存储（**架构级，P1，需拍板**）

现状下「应用令牌就是中心令牌」，**无法只靠改前端把中心令牌从 localStorage 摘掉** —— 那会让本应用 API 全部 401。要真正做到，须让**网关/应用自签一把应用令牌**：

- 登录链路：浏览器 → 网关 `POST /kb/api/auth/login` → 网关转 auth-center → 拿到中心令牌后 **存服务端**（Redis `kb:gw:center-token:{uid}`，TTL=中心 expiresIn）→ 网关用**自有密钥**（`kb.gateway.jwt.secret`，与中心密钥**必须不同**）签发应用令牌返回浏览器。
- 浏览器只存应用令牌 → 调本应用 API（网关验自有密钥）；
- 调 `/kb/api/admin/**` 时，网关的 `CenterTokenRelayFilter` 用 uid 取回中心令牌注入 `Authorization` 再转发。
- **风险/成本（须登记）**：
  1. 网关现在同时支持「中心 HS256 legacy」和「中心 RS256」两种验签（`kb-gateway/.../JwtAuthFilter.java`）——再加「网关自有密钥」＝**三种并存**，验签分流逻辑变复杂，回归面大；
  2. 中心令牌改由 Redis 持有 → 网关多一份状态（现在是纯无状态转发），引入 Redis 故障降级路径；
  3. 影响面：kb-web + kb-ops 全部 API 调用（不只管理页），属枢纽改动，**必须先走 `appmap.py impact` 评估**（kb-gateway 影响 kb-web/kb-ops 全部）；
  4. **建议**：先做 3.2-A（低风险、立竿见影），把 B 列为 Phase 13 专项，且**第一版先只覆盖管理页**（`/kb/api/admin/**` 单路由），不动业务 API。

> **务实建议**：真正把「令牌危险度」降下来的，是第 1 节（让应用管理员**不是**平台管理员）。只要应用管理员不再持有 `ROLE_ADMIN`，localStorage 里那把令牌的破坏力就从「能删全平台用户」降到「能调本应用 API」，3.2-A + 第 1 节组合后，B 的紧迫性显著下降。**先做第 1 节，再评估 B 是否还需要。**

### 3.3 与「中心抖动」的降级策略

沿用审计报告 P1 口径，登记为**已知权衡**：
- **前端守卫 fail-open**：SSO/权限探针失败时**不**拦用户（`kb-web/src/utils/sso.ts:98` 注释「探针异常一律保持现状，fail-safe」），避免中心抖动把在线用户全踢出去；
- **管理页数据接口 fail-closed**：BFF 代理拿不到中心凭据 / 中心不可达 → 明确 401/502（`AdminProxyController.java:80-83,105-108`），不返回空列表冒充成功；
- 登记位置：ADR「已知权衡」段，写明「fail-open 靠接口层 403 兜底」。**这条与 repo-map 已有规则「fail-open 型前端守卫必须登记」一致。**

---

## 四、P0-3 activecode 写接口闸门规格

### 4.1 现状（证据）

`active-manager/.../config/WebMvcConfig.java:34-57` 是全应用**唯一**的鉴权入口（`AuthInterceptor`），但：

**① 三个端点被**整个排除**出鉴权（匿名，`WebMvcConfig.java:50-52`）**
```
"/activecode/api/activation/verify",           ← 校验码（可能有意公开，待确认）
"/activecode/api/activation/generate",         ← 🔴 生成激活码，匿名 = 任何人可造码
"/activecode/api/activation/config/default-expire"  ← 🔴 读默认有效期配置，匿名
```

**② 其余写接口只验「登录」，不验「权限」**
- `AuthInterceptor.java:24-30`：只判 `session.loginUser != null` 就 `return true` —— **无任何角色/权限点判定**。
- 受此保护但仍**无权限闸门**的写接口（`ActivationController.java`）：
  `DELETE /{id}`(`:73`)、`DELETE /batch`(`:79`)、`PUT /{id}/alias`(`:93`)、`PUT /config/default-expire`(`:107`)、`PUT /version-check`(`:120`)。

**③ 权限点已上报但无人消费**
- `menu-registry.yml:60-72` 已上报 6 个 api 点：`code:generate`、`code:delete`、`code:batch-delete`、`code:alias`、`config:expire`、`config:version-check`；
- 全仓 `grep @RequirePermission|PermissionChecker` → **0 命中** → 6 个点**零消费**。

### 4.2 改造清单（照抄 kb-gateway `PermissionAuthzFilter` 范式，适配 MVC）

> ⚠️ **不能直接照抄**：`kb-gateway/.../filter/PermissionAuthzFilter.java` 是 **WebFlux `GlobalFilter`**，activecode 是 **Spring MVC**（`AuthInterceptor implements HandlerInterceptor`）。范式一致（「命中规则的写方法 → 查中心权限点 → 无点则 403 / 中心不可达则 fail-closed」），载体改为 `HandlerInterceptor`。

| # | 新增/改动 | 内容 |
|---|---|---|
| 1 | **新增** `com.jones.activation.config.PermissionInterceptor implements HandlerInterceptor` | `preHandle`：① `OPTIONS` 放行；② 非写方法（GET）放行；③ 按**规则表**匹配 `request.getRequestURI()`；④ 命中则从 `CenterSessionStore` 取**用户本人**中心令牌（无 → 401）；⑤ 调中心 `GET /auth/permissions?client=marschat-activecode` 取 `permissions`；⑥ 不含该权限点 → 403（JSON `{"success":false,"message":"无权限"}`）；⑦ 中心不可达 → **拒绝**（fail-closed）。 |
| 2 | **规则表**（放 `application.yml`，与 kb-gateway `authz.rules` 同构） | `POST /activecode/api/activation/generate → code:generate`；`DELETE /activecode/api/activation/{id} → code:delete`；`DELETE /activecode/api/activation/batch → code:batch-delete`；`PUT /activecode/api/activation/{id}/alias → code:alias`；`PUT /activecode/api/activation/config/default-expire → config:expire`；`PUT /activecode/api/activation/version-check → config:version-check` |
| 3 | **配置项**（`application.yml` 新增 `marschat.authz.*`） | `enabled`（应急开关，false 回到旧行为）、`fail-open: false`（默认拒绝）、`issuer: http://192.168.31.105:8085`（独立主机走宿主 LAN，**禁**公网域名）、`client-id: marschat-activecode`、`cache-ttl-ms: 60000` |
| 4 | **注册**：`WebMvcConfig.java:34-57` | `registry.addInterceptor(permissionInterceptor).addPathPatterns("/activecode/api/**")`（在 `authInterceptor` 之后，保证先登录再判权限） |
| 5 | **修匿名洞**：`WebMvcConfig.java:50-52` | **删除** `/activation/generate` 与 `/activation/config/default-expire` 两行 exclude（让它们至少过 `AuthInterceptor` + `PermissionInterceptor`）。`/activation/verify` **先与产品确认**：若确为对外校验接口（客户端调用）则保留匿名并**登记为已知公开端点**；若为内部工具则一并移出 exclude。 |
| 6 | **失效默认行为** | **拒绝**（`fail-open: false`）—— 与 kb-gateway `application.yml:201` 同口径：「接口=动作，判定不了就不放行动作」。 |

**解析 `menu-registry.yml` 的口径**：复用 `MenuRegistryReporter.java:68-73` 已有的「读 classpath `menu-registry.yml` 原文」方式；api 点 key 即 `sys_permission.code`（全码 `marschat-activecode:<key>`，`menu-registry.yml:56`），判定时比对全码。

**回归**：
- 用「有登录、无 `code:delete` 权限点」的用户 → `DELETE /{id}` 应 403；
- 用「有 `code:generate`」的用户 → `POST /generate` 应 200；
- 中心停掉 → 写接口应 403/502（不是放行）；
- `enabled=false` → 回到旧行为（可回滚）。

---

## 五、落地顺序建议（给工程师的排序）

| 序 | 任务 | 依赖 | 为什么这个顺序 |
|---|---|---|---|
| 1 | **第 1 节 Step 1+2**：auth-center 加 `isAppAdmin` + `AppAuthzEvaluator` + path 化 member 端点；放宽两个既有端点 | 无 | 一切的地基（C1 是 C2/C3/C4 的根因）。改 1 个模块，收益覆盖全部 |
| 2 | **第 1 节 Step 3**：应用 BFF 白名单收窄（activecode / cosmic / infra-monitor） | 1 | 地基好了再拆旧的越权面；**先收窄比先加功能更安全** |
| 3 | **第 4 节**：activecode 权限闸门 + 匿名洞 | 无（可与 1 并行） | 纯收益、零依赖、可独立回归（C5，最容易被利用） |
| 4 | **第 3.2-A 节**：kb-web/kb-ops 同源化（含 kb-ops BFF + kb-gateway 路由） | 1 | 前 3 项稳定后再动前端/网关，避免多面同时回归 |
| 5 | **第 2 节**：两菜单功能与 UX 落地（应用台去「新建/删/停用/改密」按钮，加「添加已有用户」动线；中心台补矩阵超管标记） | 1、2 | 服务端边界立住后，UI 才敢按边界重排 |
| 6 | **第 3.2-B 节**：令牌分离（Phase 13 专项） | 1–4 + 良哥拍板 | 成本最高、影响面最大；第 1 节落地后可能已不紧急 |

---

## 附：本轮**未做**的事（边界声明）

- 未改任何代码（本轮为设计规格）；
- 未逐一运行 auth-center（本轮为静态源码审阅 + 前序实测证据引用）；
- `kb-ops` 后端 login 端点未在 Java 侧找到 → 推断其 `/ops-api/login` 直落 auth-center（与 kb-web 同构），**该点建议工程师实测确认**后再执行 3.2；
- activecode `/activation/verify` 是否应公开，需产品确认（第 4.2 节 #5）。
