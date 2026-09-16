# MarsChat 统一认证平台手册（设计 · 接入 · 使用运维）

> **本文是统一认证平台的唯一权威文档**，合并并取代本目录原有 7 份零散文档（见文末附录《文档沿革》）。
> 受众：新建自研系统的接入者、平台组件维护者、运维值班。
> 权威演进全记录：`devtools/docs/adr/ADR-2026-09-10-平台重构Phase0清死代码.md`（§26-§37，本文与其口径一致，冲突时以 ADR 最新章节为准）。
>
> **版本基线（2026-09-16 Phase 12 进行中，全部为线上实测态）**
> `@marschat/auth-components` **0.8.8**（0.8.8 = app 作用域身份只读，D-3 收口；已发布 Nexus npm-hosted）｜ `@marschat/frontend-common` 0.3.5 ｜ `com.marschat:auth-core` **2.1.6** ｜ `com.marschat:common-core` 1.1.6
> 6 应用（portal / activecode / kb-web / cosmic / kb-ops / infra-monitor）的**登录页、SSO、统一鉴权、权限体系**全部接入。
>
> 📋 **Phase 12 进度交接快照**：`docs/PHASE12-PROGRESS-2026-09-16.md`（已完成/关键坑/未完成待办，接手先读）。
>
> ⚠️ **Phase 11 修正**：Phase 10 曾写「初衷达成」，全量复核后发现**独立账密**这条路径此前仍是各应用本地校验（身份与口令分裂）。现已定型为「账密唯一真源在认证中心，应用 BFF 转发」（见 §6.0）：
> ✅ 已落地：portal · infra-monitor · activecode · cosmic
> ⬜ 待办：kb-web / kb-ops / kb-gateway（爆炸半径最大，需单独立项）
> 详见 `devtools/docs/adr/ADR-2026-09-15-Phase11-统一登录与用户管理收敛.md`。

---

# 第一篇 设计

## 1. 总体架构

```
浏览器
  │ ①无本地票 → 跳 auth.marschat.online /oauth2/authorize（OIDC authorization_code + PKCE）
  │ ②IdP 会话 Cookie（Domain=marschat.online; Secure）存在 → 静默 302 回 <app>/sso-callback?code=
  │ ③前端 code 换票（RS256）→ 存各自 localStorage（token_kind=oidc）→ 进入业务页
  ▼
各应用前端（SPA / 静态页）──Bearer RS256──▶ 各应用后端 / 网关
  │                                          ├─ 验签：auth-core OidcTokenVerifier（JWKS，内网拉取，TTL 10min）
  │                                          ├─ 鉴权：@RequirePermission 或 网关 PermissionAuthzFilter
  │                                          └─ 权限来源：auth-center /auth/permissions（60s 缓存，R10 fail-open）
  ▼
auth-center（:8085，唯一身份与授权真源）
  ├─ SAS：OIDC 签发（RS256，access_token exp=30min）
  ├─ 业务 API：自签 HS384（/auth/login、/auth/mail-login、/admin/** 等）
  ├─ 权限点库 sys_permission（menu+api，含 is_public）· 角色 sys_role（platform/client 双作用域）
  └─ 账号映射 app_account_mapping（本地账号 ↔ 中心身份，自动认领）
```

## 2. 组件全景（4 包，2 生态）

| 包 | 生态 | 干什么 | 谁消费 |
|---|---|---|---|
| `@marschat/auth-components` | npm | 认证 UI（LoginPage/LoginPanel/SsoCallbackView/用户管理面板×4/PermissionGate）+ SSO client（PKCE/静默免登/静默续期/会话监视）+ token 存储 + usePermissions/useMenus | 所有前端 |
| `@marschat/frontend-common` | npm | createRequest（401 静默续期拦截器）、createAuthGuard 路由守卫、TokenStore、SidebarMenu | 所有前端 |
| `com.marschat:auth-core` | Maven | TokenProvider(HS256)、OidcTokenVerifier(RS256/JWKS)、@MarsUser、@RequirePermission、MenuRegistryReporter、Feign 透传 | 所有 Java 后端 |
| `com.marschat:common-core` | Maven | Result/异常体系/MyBatis-Plus 自动配置/链路 trace | 所有 Java 后端 |

- 源：Nexus `nexus.marschat.online`（npm-*/maven-releases）；仓库：Gitee `jonesAriven/marschat-components`（monorepo）
- **无构建前端**（纯静态页）用 UMD 产物 `marschat-auth-core.umd.js`（同步脚本 `devtools/woodScript/sync-auth-core-umd.sh`，版本戳 `VENDORED-auth-core-umd.md`，0.8.6 sha256 `fe949f00…`）

## 3. 令牌与信任域（三种令牌，务必分清）

| 令牌 | 算法 | 签发方 | 用途 | 验签方式 |
|---|---|---|---|---|
| **OIDC access_token** | RS256 | auth-center SAS | 应用前端 ↔ 应用后端/网关（`Bearer`） | OidcTokenVerifier（JWKS，issuer+exp 严格校验） |
| **业务令牌** | HS384 | auth-center 自签 | 调 auth-center 业务 API（/auth/permissions、/admin/**、/user/mapping） | 中心自验；**应用不得用 OIDC 验签器验它**（坑 #16） |
| legacy HS256 | HS256 | 各应用自有（如 portal BFF 早期） | 存量兼容 | 应用本地密钥 |

- 存储：各应用 **localStorage 独立键**（`token_kind=oidc`）；跨应用共享靠 **IdP 会话 Cookie**（`Domain=marschat.online`），不是共享 token（早期 Cookie 方案已废弃，见附录沿革）。
- 有效期：OIDC access_token **30 分钟**，无 refresh_token（public client）→ 过期靠**静默重授权**（401 拦截 → authorize 静默回跳）。
- **服务端互调径（如 BFF 代理 mail-login）直接采信中心响应体**（data.user），不做二次验签——那是我们自己向中心内网请求得到的响应（坑 #16）。

## 4. 登录方式（统一登录页 `LoginPage`）

| 方式 | 端点归属 | 说明 |
|---|---|---|
| SSO 免登 | IdP（OIDC+PKCE） | 有 IdP 会话进登录页直接免密进入；`silentLogin: true` |
| 账密（独立登录） | **表单在应用，校验必须转发 auth-center** | ⚠️ **Phase 11 硬约束**：应用保留自己的登录页与独立登录体验，但**不得自建密码体系**——账密一律 BFF 转发中心内网 `/auth/login`，本地表降级为影子（不存密码、不决定身份）。纯 SSO 应用（如 kb-ops）必须 `showLocalLogin:false`，否则渲染必 403 的死表单 |

> **独立登录的正确实现**（Phase 11 定型，违反即视为缺陷）：
> ```
> 应用登录表单（账密）→ 应用后端 BFF → POST 中心内网 /auth/login
>   ← {code, data.user{id, username, role, status, appRoles}}
>   → 收敛本地影子（按中心 username 查，无则自动建档，密码字段随机占位）
>   → 签发应用自身会话
> ```
> - 中心不可达 → **fail-closed** 返回 503「认证中心不可达」，**严禁回退本地密码校验**（回退等于给身份分裂留后门）。
> - 收敛链统一为：**中心验证通过 → 按中心 `username` 找影子 → 无则自动建档 → 否则 403**。禁止「本地同名优先」「未匹配即回退任意本地管理员」这类越权默认值。
> - SSO 侧映射键取 `username` 声明，**不要用 `sub`**（`sub` 是用户 ID，账号映射按 username 认领，坑 #19）。
| 邮箱验证码登录 | auth-center `/auth/mail-login/*` | 6 位码，Redis 一次性（用过即废），60s 发送频控 |
| 忘记密码 | auth-center `/auth/forgot-password` + `/auth/reset-password` | 四步状态机内嵌 LoginPanel；中心侧防枚举恒返回成功 |
| 统一登出 SLO | `/auth/slo`（带 id_token_hint） | 销毁 IdP 会话；各应用 startSessionWatcher 联动请出（60s 探针 + 身份守卫） |

## 5. 统一鉴权模型（RBAC 三层同源 + 默认最小权限）

**权限点两类**：`menu:*`（可见性）与 `api:*`（动作，**默认拒**）。拿 menu 点当写接口闸门＝假闸门（任何拿到菜单者皆可写）。

**strict 默认最小权限（Phase 10 终态）**：
- 平台 user/admin、应用 user 角色**只自动获得 `public: true` 的落地菜单**（每应用至多一个，如看板/工作台）；portal/activecode 无 public 菜单。
- 其余菜单与**全部 api 点**必须管理员在中心显式授权。
- 灰度三步已收官：portal 试点 → 应用上报 public → 全局 strict；一键回滚 `MARSCHAT_AUTHZ_MODE=legacy`（重启即复原，幂等可逆）。
- R10 fail-open：中心侧 `configured=false`（未配置任何权限点）或权限查询失败 → 全放行（枢纽抖动不打死整站）。**已知取舍**：cosmic 服务端 OIDC 缓存 30min 过期后权限查询 401 → 菜单级限制暂失效，写接口仍受硬闸门保护。

**前端三层同源**（同一份权限状态喂三个消费方）：菜单过滤（SidebarMenu）· 路由守卫（createAuthGuard，meta.perm）· 组件门（PermissionGate）。code 一律**全码** `permCode(type,code)`。

**接口级闸门两种形态**：
- 形态 A（有 auth-core 的 Spring 服务）：`@RequirePermission("api:xxx")`，拦截器自动补 client 前缀；平台超管恒放行；fail-open 默认 true，管理面显式配 false。
- 形态 B（无 auth-core / WebFlux 网关）：**网关一处收口**（kb-gateway `PermissionAuthzFilter` 范式）——只拦写方法且命中规则的路径，`fail-open=false`，`configured=false` 放行，token 指纹缓存 60s，平台 admin 放行，其余 403。判定口径：**403+网关文案＝拦下；400/404/405/200＝已穿闸门**。

## 6. 用户统一管理与账号映射

- 中心 `sys_user` 是唯一身份真源；应用本地账号（若有）经 **`LocalAccountReporter` 启动全量上报**至 `/internal/clients/{id}/accounts`（X-Client-Secret），中心按 username **自动认领**（`app_account_mapping`）。
- 应用侧登录收敛链：**本地同名 → 平台超管例外 → 中心账号映射 → 403**（禁止「未匹配即回退任意本地管理员」这类越权默认值）。
- 用户级菜单减法：`sys_user_menu_override`（只能减法，60s 缓存生效）。
- 账号上报仅**启动时**执行（已知边界：运行期新建本地账号不出现，需重启）。
- 已删除用户名有**墓碑机制**（不可复建，防冒用）——测试账号应使用常驻低权账号。

### 6.0 Phase 11 收敛（2026-09-15）：应用本地表一律降级为「影子」

**硬约束**：自研应用**不得自建密码体系**。应用可保留自己的登录页与独立登录体验，但账密校验必须 BFF 转发中心内网 `/auth/login`。

```
应用登录表单（账密）→ 应用后端 BFF → POST 中心内网 /auth/login
  ← {code, data.user{id, username, role, status, appRoles}}
  → 收敛本地影子（按中心 username 查，无则自动建档；口令字段随机占位，不再用于校验）
  → 回填 auth_uid（中心 user.id），与 SSO/JIT 路径保持一致
  → 签发应用自身会话
```

- **收敛链（现行）**：中心验证通过 → 按中心 `username` 找本地影子（回填 `auth_uid`）→ 无则自动建档 → 否则 403。**禁止**「本地同名优先」「未匹配即回退任意本地管理员」这类越权默认值。
- **fail-closed**：中心不可达 → 503「认证中心不可达，请稍后重试」，**严禁回退本地口令比对**（回退等于给身份分裂留后门）。
- **本地表不删除，只降级**：保留用于应用内业务关联（外键、审计），但不再存可用口令、不再决定身份。典型反例：cosmic 的 `chat_mid.user_id` 依赖 `users.id`，删表会让历史数据悬空。
- **修改密码**：一律走中心——登录页「忘记密码」或中心管理台重置。应用本地「修改密码」端点已无真实口令可比，不要再改回本地比对。
- **映射键取 `username` 声明**，不要用 `sub`（`sub` 是用户 ID，坑 #19）。
- **应用侧用户管理页必须经应用后端 BFF 代理**中心 `/admin/**`（用登录时保存的中心 `accessToken` 以**用户本人身份**转发），**禁止**前端直连中心域名，**禁止**用服务账号 token 兜底（提权）。
  - 原因：账密登录会话只有本地 JWT、没有 OIDC token，前端直连中心会 401 → 被静默重授权踢到 IdP，页面整块不可用（Phase 11 实测 D14）。
  - 参考实现：infra-monitor `AdminProxyController` + `CenterSessionStore`；portal `AuthCenterService.callAdmin`。
  - 账密登录成功后，务必把中心返回的 `accessToken` / `refreshToken` / `expiresIn` 一并保存（只取 `data.user` 是不够的）。

### 6.1 两类用户管理菜单（一个管身份、一个管成员）

自研应用**必须同时具备**两类菜单，由同一个 `UserManagementPanel` 以不同 `scope` 渲染，**职责不重叠**：

| 维度 | A · 中心平台管理台（portal `/portal/admin`，`scope=platform`） | B · 各应用本系统用户（各应用 `/users`，`scope=app`） |
|---|---|---|
| 回答的问题 | 平台上有哪些**人** | **谁在我这个系统里**、能干什么 |
| 生命周期 | ✅ 创建 / 启用停用 / 重置密码 / 删除（墓碑） | ❌ 不删身份，只有「移出本系统」 |
| 身份字段 | ✅ 可编辑（用户名/邮箱/昵称/全局角色） | 只读展示 |
| 本系统角色 | 经跨应用授权矩阵间接管 | ✅ 直接绑定/解绑 client 级角色 |
| 跨系统权限 | ✅ 跨应用授权矩阵（用户 × 应用） | ❌ 看不到别的系统 |
| 菜单可见性 | ✅ 全应用 menu+api 权限点授权 | ✅ 仅本系统**减法**（只能减，永不越权新增） |
| 账号映射 | ✅ 统一身份 ↔ 各系统本地账号 | 只读 |
| 新建用户 | ✅ 建即得平台身份 | ✅ 委托中心建 + 自动加入本系统（数据仍落中心） |
| **重置密码** | ✅ 允许（平台级职责） | ❌ **移除**（口令是全局身份属性） |
| **删除** | ✅ 墓碑，用户名不可复建 | ❌ 改为「移出本系统」= 解绑本应用全部角色，身份保留 |

**为什么不合并**：① 身份的生老病死是平台事务，成员的进退是本系统事务，合并会让应用管理员拿到平台级删除权；② 符合各自使用习惯（应用管理员只想"给我的系统加个人"）；③ 未来加"用户组/部门/数据行级权限"只需在中心侧加维度，应用侧面板不动。

**中心管理台为何寄生 portal**：portal 本身是"一个入口掌控所有内部系统"的平台门户，承载平台管理符合定位；新建 `auth-console` 前端要付出应用注册/部署/域名/流水线的长期成本，收益不抵。代价是必须在 UI 与文档上反复标注这是平台级而非 portal 级。

**中心管理台四大页签**：统一用户（全平台身份 CRUD/停用/重置密码）· 跨应用授权（哪些账号有哪些系统）· 账号映射（本地↔中心，自动认领状态）· 角色与菜单授权（menu+api 权限点勾选，改后 60s 内应用侧生效）。

### 6.1 两类用户管理菜单（Phase 11 定型：一个管身份、一个管成员）

自研应用**必须同时具备**下面两类菜单，它们由同一个 `UserManagementPanel` 组件以不同 `scope` 渲染，但**职责不重叠**：

| 维度 | A · 中心平台管理台（portal `/portal/admin`，`scope=platform`） | B · 各应用本系统用户（各应用 `/users`，`scope=app`） |
|---|---|---|
| 回答的问题 | 平台上有哪些**人** | **谁在我这个系统里**、能干什么 |
| 生命周期 | ✅ 创建 / 启用停用 / 重置密码 / 删除（墓碑） | ❌ 不删身份，只有「移出本系统」 |
| 身份字段 | ✅ 可编辑（用户名/邮箱/昵称/全局角色） | 只读展示 |
| 本系统角色 | 经跨应用授权矩阵间接管 | ✅ 直接绑定/解绑 client 级角色 |
| 跨系统权限 | ✅ 跨应用授权矩阵（用户 × 应用） | ❌ 看不到别的系统 |
| 菜单可见性 | ✅ 全应用 menu+api 权限点授权 | ✅ 仅本系统**减法**（只能减，永不越权新增） |
| 账号映射 | ✅ 统一身份 ↔ 各系统本地账号 | 只读 |
| 新建用户 | ✅ 建即得平台身份 | ✅ 委托中心建 + 自动加入本系统（数据仍落中心） |
| **重置密码** | ✅ 允许（平台级职责） | ❌ **移除**（密码是全局身份属性，改它会影响该用户在所有系统的登录） |
| **删除** | ✅ 墓碑，用户名不可复建 | ❌ 改为「移出本系统」= 解绑本应用全部角色，身份保留 |

**为什么不合并**：① 身份的生老病死是平台事务，成员的进退是本系统事务，合并会让应用管理员拿到平台级删除权；② 符合各自使用习惯（应用管理员只想"给我的系统加个人"）；③ 未来加"用户组/部门/数据行级权限"只需在中心侧加维度，应用侧面板不动。

**中心管理台为何寄生 portal**：portal 本身是"一个入口掌控所有内部系统"的平台门户，承载平台管理符合定位；新建 `auth-console` 前端要付出应用注册/部署/域名/流水线的长期成本，收益不抵。代价是必须在 UI 与文档上**反复标注这是平台级而非 portal 级**。

## 7. 密钥域（密钥分离铁律）

- 每应用**独立** `JWT_SECRET`（≥64B 随机，禁 "Your…" 弱默认样式）；infra/portal 已互拒 401 实测。
- `menu-report-secret`（菜单/账号上报）与 client_secret 由 apps-registry 生成，`/internal/**` 不在公网白名单；JWKS 走内网。
- ⚠️ **遗留 F1（P2，待拍板轮换）**：kb-gateway 与 auth-center 共享 JWT_SECRET（指纹实证），中心 HS384 业务令牌可穿过网关 legacy 验签环；影响有界（闸门仍裁决）但密钥泄露半径横跨两域。修复方案见 ADR §37.9。
- 📌 文档铁律：**任何文档不得出现明文密码/secret**，一律写「见 Vaultwarden（vault.marschat.online）或 infrastructure-map 技能」。

---

# 第二篇 接入指南（新应用从零）

> 标准参考实现（薄适配层四件套 + 后端三件套）：`devtools/infra-monitor/infra-monitor-{web,server}`。全程**不改 auth-center Java**。

## Level 0：注册进平台（约 10 分钟）

唯一真源 = `devtools/apps-registry.yml`，加一段：

```yaml
  - client-id: marschat-<新应用>          # 权限点前缀，全局唯一
    name: <中文名>
    type: public                          # SPA 用 public(PKCE)；有机密后端用 confidential
    menu-report-secret: ${<APP>_MENU_REPORT_SECRET:<48位hex>}
    auth:
      redirect-uris:                      # 公网+内网+localhost 三个环境都登记
        - https://<app>.marschat.online/<ctx>/sso-callback
      post-logout-redirect-uris:
        - https://<app>.marschat.online/<ctx>/login
    frontend:
      entry: https://<app>.marschat.online/<ctx>/
      context-path: /<ctx>
      api-base: /<ctx>/api
```

```bash
cd devtools && python scripts/gen-from-registry.py
# 产物① auth-center clients.yml（OIDC 客户端种子，重启生效）② 各前端 public/app-config.json
```
容器注入 `MARSCHAT_MENU_REPORT_SECRET`（与 registry 同值）。**同时**在 `menu-registry.yml` 给落地页标 `public: true`（否则 strict 下普通用户登录一片空白，坑 #17）。

## Level 1：最小接入（SSO + API 带票）

### 前端四件套（Vue3 SPA）

```
src/config.ts         # 运行时配置唯一派生点（读 app-config.json，同步 XHR + 剥 // 横幅）
src/utils/token.ts    # initTokenConfig 薄适配（accessTokenKey/refreshTokenKey/tokenKindKey/idTokenKey）
src/utils/sso.ts      # createSsoClient 薄适配（必须包一层绑定配置再导出，坑 #7）
src/utils/request.ts  # createRequest + 401 静默续期拦截器
src/views/login/LoginView.vue     # <LoginPage :config @login @sso-login @password-reset/>
src/views/sso/SsoCallbackView.vue # code 换票 + router.replace(target)
src/main.ts                       # 挂载顺序见下
```

```ts
// config.ts —— 优先级：app-config.json > env > 默认
export const CONTEXT_PATH  = runtime.contextPath ?? '/<ctx>'
export const API_BASE_URL  = runtime.apiBase ?? '/<ctx>/api'
export const OIDC_ISSUER   = runtime.issuer ?? 'https://auth.marschat.online'
export const OIDC_CLIENT_ID= runtime.clientId ?? 'marschat-<新应用>'
export const OIDC_REDIRECT_URI = `${location.origin}${CONTEXT_PATH}/sso-callback`
```

```ts
// main.ts 挂载顺序（坑 #5/#6）
window.__MARSCHAT_APP_BASE__ = CONTEXT_PATH     // #6 公共库跳登录靠它拼 base
setupAuthGuard(router)                          // #5 必须在 app.use(router) 之前
app.use(pinia); app.use(router); app.use(ElementPlus); app.mount('#app')
if (getToken()) { startSessionWatcher(); void permissions.ensure() }  // SLO 联动+权限预取，失败降级
```

```ts
// request.ts 401 分流（坑 #3/#1）
if (error.response?.status === 401 && !originalRequest._retry) {
  if (isWhiteList(url)) return Promise.reject(error)
  if (isOidcToken()) {                    // #3 先判 OIDC 再看 refresh_token（SAS 不发 refresh_token）
    originalRequest._retry = true
    await renewByReauthorize(currentSpaPath())   // #1 必须传 router 内部路径（剥 CONTEXT_PATH）
    return Promise.reject(error)
  }
  clearTokens(); router.push('/login')
}
```

### 后端三件套（Spring Boot 3 / Java 21）

```yaml
marschat:
  oidc:
    issuer: https://auth.marschat.online                    # #8 与签发端逐字一致
    jwks-uri: http://<内网直达auth-center>:8085/oauth2/jwks  # #9 JWKS 走内网
```

```java
// SecurityConfig —— 坑 #2（最重要）：必须显式 401 entry point，否则默认 403 → 前端拦截器永不触发 → 假死
.authorizeHttpRequests(a -> a.requestMatchers("/auth/login","/auth/mail-login","/auth/mail-login/send-code").permitAll()
                              .anyRequest().authenticated())
.exceptionHandling(e -> e.authenticationEntryPoint((req,res,ex) -> res.sendError(401, "Unauthorized")))
.addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
```
不需要 HS256 签发/@MarsUser/Feign/@RequirePermission 时在 `spring.autoconfigure.exclude` 显式排除并注释理由；排除 AuthJwtAutoConfig 后手动声明 `OidcTokenVerifier` bean。

## Level 2：权限体系

**① 上报（后端 classpath `menu-registry.yml`）**——启动全量覆盖上报，缺凭据 WARN 不阻断：

```yaml
client: marschat-<新应用>
menus:
  - key: dashboard          # = sys_permission.code，前端 permCode 严格对齐，禁改名
    title: 总览看板
    path: /dashboard
    order: 1
    public: true            # ⚠️ strict 默认最小权限下普通用户的唯一落地页（坑 #17），全应用至多一个
  - key: users
    title: 用户管理
    path: /users
    min-role: admin         # 可选角色门槛
apis:                       # ⚠️ api 点任何模式都不自动授予，写接口闸门用
  - key: xxx:write
    title: xxx 写操作
```

**② 前端三层同源**：`permCode('menu','dashboard')` 全码喂 SidebarMenu / 路由 meta.perm / PermissionGate（坑 #10：含冒号原样用，不含才补前缀）。

**③ 后端闸门**：形态 A `@RequirePermission("api:xxx:write")`；形态 B 网关收口（照抄 kb-gateway `PermissionAuthzFilter` + `KbGatewayProperties.Authz` rules，`fail-open:false`，应急开关 env）。

## Level 3：可选能力（全部有现成组件）

| 能力 | 组件 | 参考实现 |
|---|---|---|
| 本系统用户管理页 | UserManagementPanel（client 作用域 3 页签） | kb-ops /ops/users |
| 中心管理台 4 页签 | UserManagementPanel + CrossAppAuthPanel + AccountMappingPanel + MenuPermissionPanel | portal /portal/admin |
| 用户级菜单减法 | UserMenuOverridePanel | portal /portal/admin |
| 账号映射 | LocalAccountReporter + AccountMappingPanel | infra-monitor / cosmic |
| 统一登录页 | LoginPage（品牌/深色/响应式内置，0.3.1 起样式自动注入） | 六应用同一登录壳 |

## 特殊形态 A：无构建静态页接入（activecode 模式）

1. **UMD**：`sync-auth-core-umd.sh` 把 `marschat-auth-core.umd.js`(0.8.6) 同步进应用静态目录，回写 `VENDORED-auth-core-umd.md`（版本/大小/sha256 三对齐，坑 #13 同源）。sso.js 只写薄适配：localStorage 键映射 + 换票后调 BFF。
2. **后端 BFF 代理端点**（转发中心内网 `192.168.31.105:8085`，不暴露 secret）：
   - `POST /api/auth/mail-login/send-code` → 中心 `/auth/mail-login/send-code`
   - `POST /api/auth/mail-login` → 中心 `/auth/mail-login`（**响应体 HS384 + data.user，直接采信身份**，坑 #16）
   - `POST /api/auth/forgot-password` / `reset-password` → 中心同名端点（透传校验结果）
   - `POST /api/auth/sso-login`（body 用 **`username` + `access_token`**，snake_case！）→ OIDC RS256 验签 → 收敛链
3. ⚠️ 坑 #19：SAS 令牌 `sub`=**用户 ID**（用户名在独立 `username` 声明）——映射主体取 `username` 声明，勿用 sub（activecode 现状以 sub 为键，靠超管例外兜底，待修 F2）。

## 踩坑铁律速查（#1-#15 沿革自 Phase 9，#16-#20 为 Phase 10 新增，全部实战血泪）

| # | 铁律 | 后果 |
|---|---|---|
| 1 | renew/onDeny 回跳传 **router 内部路径** | `/app/app/dashboard` 双前缀 404 |
| 2 | SecurityConfig **必须显式 401** entry point | 过期 token 403 → 前端假死 |
| 3 | 401 分流先判 isOidcToken() 再看 refresh_token | OIDC 用户被弹回登录页 |
| 4 | app-config.json 先剥 `//` 横幅再 parse | 运行时配置静默失效 |
| 5 | setupAuthGuard 在 app.use(router) 之前 | 首屏跳过权限判定 |
| 6 | `window.__MARSCHAT_APP_BASE__` 必设 | 跳登录到域名根 404 |
| 7 | sso.ts 薄适配包一层绑定配置，禁裸再导出 | clientId=undefined 静默失效 |
| 8 | issuer 与签发端逐字一致 | 全部 token 验不过 |
| 9 | JWKS 与 /internal/** 走内网 | secret 暴露 / JWKS 拉不到 |
| 10 | 权限 code 传全码 | 半码永不匹配 |
| 11 | IdP Cookie 域 marschat.online → 内网 IP 直连无静默免登 | 本地调试 SSO 失效 |
| 12 | index.html 不进 immutable 缓存；try_files 兜底 | 发版后拿旧入口 |
| 13 | 升级三对齐：package.json 约束+lock+线上版本戳 | 静默回落旧版 |
| 14 | E2E 用 CDP Input.insertText 真实键盘输入 | 受控组件填不上表单 |
| 15 | 查询显式过滤软删位 deleted=0 | 误判数据 |
| **16** | **HS384 业务令牌 ≠ RS256 OIDC**：验 OIDC 的验签器验不了中心业务令牌；服务端互调径直接采信响应体（data.user），映射主体取 `username` 声明 | 「验证码密码都对却验签失败」（activecode 实测踩中） |
| **17** | **切 strict 前必须先上报 public 菜单**（每应用至多 1 个落地页）；api 点任何模式都不自动授予 | 普通用户登录菜单全空 |
| **18** | 应用管理员=本应用全量 menu+api 的**加法补齐**（幂等 NOT EXISTS）；user 角色保留零绑定护栏 | 先报 menu 后报 api 时 admin 永远拿不到后补 api 点（静默失效） |
| **19** | SAS `sub`=用户ID，用户名在 `username` 声明；映射主体禁用 sub | 同名/账号映射永远匹配不上 |
| **20** | 用户名删除后**墓碑不可复建**；测试用常驻低权账号（p10x） | 回归脚本莫名失败 |
| **21** | 账密登录改走中心后，**签发的本地 token 必须带上中心返回的 `role`** | 前端 `isAdmin` 判定失效 → 管理员菜单（如「用户管理」）整块消失，功能不可达 |
| **22** | **应用侧用户管理不得提供「重置密码」**（口令是全局身份属性，改它会影响该用户在所有系统的登录） | 应用管理员可越权改他人在全平台的口令；组件 0.8.7 起 app 作用域已隐藏该按钮 |
| **23** | 应用本地「修改密码」端点在本轮改造后**已无真实口令可比**，必须改为引导用户走中心（忘记密码/中心重置） | 用户看到误导性的「旧密码错误」 |
| **24** | **流水线 SUCCESS ≠ 产物已更新**：前端部署后必须核对线上 chunk 内容（或 bundle hash），不能只看构建成功 | 部署了旧产物 → 功能没生效 → 排查方向被误导（Phase 11 实测：`UsersView` 线上仍是旧 chunk） |
| **25** | **push 后必须用 `git ls-remote <remote> <branch>` 核对远程 tip**，不能只看 push 命令无报错 | 本地有 commit、远程没有 → 流水线构建旧代码，白跑一轮部署（Phase 11 实测） |
| **26** | 应用侧 BFF 代理路径要**按该应用 nginx 的 rewrite 规则**推导（如 infra：nginx `location /infra/api/` → `proxy_pass .../infra/` 会**剥掉一层 `/api`**，故浏览器需请求 `/infra/api/api/admin/users`） | 路径少/多一层 → 404，且回显路径能直接看出被剥了几层 |
| **27** | **测免登必须用全新 profile + 显式清 localStorage**；用持久 profile 会因应用本地残留 token 被守卫弹走而得到**假阳性**（看着像免登） | 误判「免登正常」，掩盖真实缺陷（Phase 11 cosmic 排查初期即因此走弯路） |
| **28** | 登录页**不要做「一次性重授权标记」这类短路**：标记若只在失败分支清除，成功分支残留后会永久短路，导致「IdP 会话活着却不免登」。进登录页应**必探一次** IdP 会话 | cosmic / portal 均因此出现免登失效（`*_reauth_once` 标记） |

---

# 第三篇 使用与运维

## 1. 中心管理台（portal `/portal/admin`，platform 作用域 4 页签）

统一用户（全平台身份 CRUD/停用/重置密码）· 跨应用授权（哪些账号有哪些系统）· 账号映射（本地↔中心，自动认领状态）· 角色与菜单授权（menu+api 权限点勾选，改后 60s 内应用侧生效）。用户级菜单减法在同一页签内（只能减法）。

## 2. 授权策略运维端点（Bearer 超管，auth-center :8085）

| 端点 | 用途 |
|---|---|
| `GET /admin/authz/policy` | 当前模式与各应用生效模式、public 菜单数 |
| `GET /admin/authz/impact?client=x&mode=strict` | 影响面**预演**（只读） |
| `POST /admin/authz/migrate?client=x[&force=true]` | 立即收敛 |
| `POST /admin/authz/restore-legacy?client=x` | 单应用回滚 |

全局回滚：compose `MARSCHAT_AUTHZ_MODE=legacy` 重启 auth-center（会把全量 menu 补回，可逆）。应急关闸门：`KB_GATEWAY_AUTHZ_ENABLED=false`。

## 3. 账号体系

- 平台超管：admin（邮箱 marschat@163.com，platform superadmin + 6 应用 client admin）——账密见 Vaultwarden/infrastructure-map，**严禁写入任何文档**。
- 平台角色 platform（superadmin/admin/user）+ 应用角色 client（admin/user）；应用 admin 由「加法补齐」保持全量（坑 #18）。

## 4. 测试与验收

**上线前清单**：SSO 免登（真浏览器禁缓存）· 独立账密+邮箱码登录 · 负例（错密/无 token 401）· 菜单权限（配置后 60s 生效；未配置 R10 放行）· 接口闸门（200/403/401 三态）· SLO 联动 · **换废票 E2E**（注垃圾 token→重载应恢复，暴露 #1/#2）· 三环境 redirect_uri。

**平台常备测试资产**（`CodeBuddy 工作区 verify/phase10/`，回归口径见 ADR §37.5/.9/.10）：
`wb_p10_regress.py`（A 六应用免登 / B 普通用户菜单收窄）· `wb_p10_d2.py`（身份切换双前缀）· `wb_p10_l3.py`（闸门 4 用例）· `wb_p10_l1.py`（activecode 邮箱码）· `wb_p10_r1_auth.py`（认证矩阵 21 例，含忘记密码全闭环）· `wb_p10_r2_sec.py`（令牌安全 23 例）· `wb_runall.py`（**6 应用并行全站点击巡检**，66 页 0 错误 0 弹窗）· `wb_p10_cap.py`（RS256 捕获）。临时普通账号：`POST /admin/users`（常驻回归账号 p10x，id=302）。

## 5. 组件发版

```bash
cd marschat-components
pnpm build        # 前端两包（vue-tsc+vite）   pnpm build:java   # 后端两包 mvn deploy → Nexus
pnpm publish --filter @marschat/auth-components   #（+ frontend-common；Nexus 代理组缓存加 --prefer-online）
```
应用侧升级按坑 #13 三对齐，再走各应用 Woodpecker 流水线。UMD 同步目前为**人工步骤**（构建舱无 npm）——建议加 CI 门禁比对 VENDORED sha256（ADR §37.7）。

## 6. 已知取舍与遗留（截至 2026-09-15，详见 ADR §37.7/.9）

| # | 项 | 处置 |
|---|---|---|
| F1 🔴P2 | kb-gateway 与 auth-center 共享 JWT_SECRET（"Your…"弱默认样式），HS384 可穿网关 | **待拍板**：网关独立密钥轮换→确认 legacy 发签方消亡→下线双验签第 1 环 |
| F2 ✅ | activecode 以 sub（用户ID）作映射键 | **2026-09-15 已修**：sso-login 改取 `username` 声明（Phase 11） |
| **F3** 🟠 | cosmic 本地 `users` 表仍有存量账号（实测 2 行） | 迁移脚本已产出但**未执行**；执行前应用侧需先上线（否则老用户瞬间登不进）。执行窗口需人工确认 |
| **F4** 🟡 | 应用本地「修改密码」端点失效（本地已无真实密码，比对必失败） | 已知：改密一律走中心——登录页「忘记密码」或中心管理台重置。**不要**再改回本地比对 |
| **F5** 🟡 | 应用账密登录强依赖中心可用性（fail-closed） | 设计取舍：SSO 本来就是强依赖，未恶化；中心故障时全平台不可登录，需优先保障中心高可用 |
| — | cosmic 权限查询 401 → 菜单 fail-open（令牌 30min 过期窗口） | 设计取舍（R10），写接口硬闸门不受影响 |
| — | 账号上报仅启动时执行 | 运行期新增本地账号需重启才登记 |
| — | UMD 同步人工步骤 | 建议 CI 门禁比对 sha256 |
| — | auth-components 库内约 19-29 处 Element Plus 类型报错 | 历史技术债，非接入引入 |

---

## 附录：文档沿革（本文合并取代以下 7 份）

| 原文档 | 归宿 |
|---|---|
| INTEGRATION-GUIDE.md（2026-09-14 权威接入指南） | **全文并入本手册第二篇**，并补 Phase 10 增量（strict/public/api 点/网关闸门/BFF 模式/坑 #16-20） |
| ADR-LOGINPAGE-001.md（LoginPage 决策） | 结论并入第一篇 §4 与第二篇 Level 3（决策细节存 git 历史 + ADR-2026-09-10） |
| ADR-SSO-Cookie-Domain-Sharing.md | **已取代**：共享的是 IdP 会话 Cookie 而非 token Cookie；结论并入 §3，推演存 git 历史 |
| AUTH-CENTER-COOKIE-GUIDE.md / SSO-IMPLEMENTATION-SUMMARY.md / DEPLOYMENT-SUMMARY-2026-01-09.md | 均为 2026-01-09 Cookie 方案时代快照，事项早已完结；存 git 历史 |
| APP-UPGRADE-GUIDE.md（0.1.0 时期升级指南） | 被 Level 0-3 取代 |

> 演进全记录：`devtools/docs/adr/ADR-2026-09-10-平台重构Phase0清死代码.md`（§26-33 六应用接入/双作用域/账号映射 · §34 接入指南落盘 · §35-36 权限默认最小权限/双前缀根治 · §37 收口+扩测+点击巡检）。
> 包内组件级用法（LoginPage/LoginPanel/ForgotPassword 等）以 `packages/*/README.md` 与 `packages/auth-components/*.md` 为准。
