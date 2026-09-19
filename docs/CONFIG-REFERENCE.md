# 配置项与接入常量参考（CONFIG-REFERENCE）

> **定位**：统一认证平台的**配置真源、字段语义、环境变量、端点、数据库表、域名端口**全表。接入新应用或排查配置时先查本文，不要去 ADR / 快照里翻。
> **配套**：`README.md`（设计 · 接入 · 使用运维）· `STATUS.md`（未决项与待办）· `TROUBLESHOOTING.md`（故障排查）。
> **时效**：截至 **2026-09-19**。apps-registry 与 client 表以 `devtools/apps-registry.yml` 为准，改动后请同步本表。
> 🔴 **本表不含任何口令 / secret 明文** —— 只写**字段与取值方式**，值一律见 Vaultwarden（`vault.marschat.online:8222`）或部署机 env。

---

## 1. 配置真源总览（哪些是手工编辑点）

| 文件 | 作用 | 是否手工编辑 |
|---|---|---|
| `devtools/apps-registry.yml` | **平台应用注册单一真源**（OIDC 客户端 + 前端运行时配置） | ✅ **唯一手工编辑点** |
| `auth-center/src/main/resources/clients.yml` | OIDC 客户端 L1 种子（供 `ClientsYmlLoader` 幂等写入 `sys_app_client`） | ❌ **AUTO-GENERATED，禁改** |
| 各前端 `public/app-config.json` | 运行时配置（contextPath / apiBase / issuer / clientId） | ❌ **AUTO-GENERATED，禁改** |
| `<应用>/src/main/resources/menu-registry.yml` | 菜单与 api 权限点上报定义（classpath） | ✅ 应用自己维护 |
| `devtools/mykng/module-registry.yml` | 模块注册表（SSOT） | ✅ |

```bash
# 改完 apps-registry.yml 必跑（产物 ① clients.yml ② 各前端 app-config.json）
cd devtools && python scripts/gen-from-registry.py
# auth-center 需重启使 clients.yml 生效（属枢纽，注意爆炸半径）
```

---

## 2. `apps-registry.yml` 字段全表

### 2.1 `defaults` 段（未被 client 覆盖时生效）

| 字段 | 默认值 | 说明 |
|---|---|---|
| `auth.scopes` | `[openid, profile]` | OIDC scope |
| `auth.grant-types` | `[authorization_code, refresh_token]` | 授权类型 |
| `auth.access-token-ttl-minutes` | `30` | access_token 有效期 |
| `auth.refresh-token-ttl-days` | `7` | refresh_token 有效期（public client 实际不发） |
| `auth.reuse-refresh-tokens` | `false` | 是否复用 refresh_token |
| `auth.require-consent` | `false` | 是否要求用户同意页 |

### 2.2 `apps[]` 条目的字段

| 字段 | 必填 | 语义 / 取值 |
|---|---|---|
| `client-id` | ✅ | **权限点前缀**，全局唯一；如 `marschat-kbweb`、`cosmic-studio`（**非** `marschat-` 前缀也允许，如 cosmic） |
| `name` | ✅ | 显示名 |
| `type` | ✅ | `public`（SPA，走 PKCE）｜`confidential`（有机密后端，BASIC + secret） |
| `secret` | confidential 必填 | 写法 `${ENV_NAME:默认值}` —— **推荐 env-only**（`${ENV_NAME:}`），避免凭据入 git |
| `menu-report-secret` | 需上报权限点的应用必填 | 菜单/账号上报凭据（`X-Client-Secret`），48 位十六进制；写法同上。**应用侧经 env 注入同值** |
| `auth.redirect-uris` | ✅ | **三环境都要登记**：公网域名 + 内网 IP + localhost。⚠️ 路径须与 nginx 实际一致，静态页应用需带扩展名（如 `sso-callback.html`） |
| `auth.post-logout-redirect-uris` | ✅ | 登出回跳地址 |
| `frontend.entry` | ✅ | 应用入口 URL |
| `frontend.context-path` | ✅ | 部署前缀（如 `/kb`）；根部署为 `/` |
| `frontend.api-base` | 视应用 | 前端 API 前缀。⚠️ **必须与 mykng nginx 的 `location` 一致**（历史踩坑：`/ops/ops-api`、`/infra/infra-api` 均为死路径） |
| `frontend.auth-api-base` | 可选 | 认证类接口前缀（当与 `api-base` 不同时显式声明） |

---

## 3. 已注册 client 全表（10 个 · 2026-09-19 核对 `apps-registry.yml`）

| client-id | 类型 | 入口 | context-path | api-base | 备注 |
|---|---|---|---|---|---|
| `marschat-portal` | confidential | `https://main.marschat.online/portal/` | `/portal` | `/portal/api` | 平台门户 + **中心管理台寄生处**（`/portal/admin`） |
| `marschat-kbweb` | public | `https://kb.marschat.online/kb/` | `/kb` | `/kb/api` | 知识库前端；**改密经 kb-gateway 代理到中心 = 正确范式** |
| `marschat-kbops` | public | `https://kb.marschat.online/ops/` | `/ops` | `/ops-api`（+ `auth-api-base: /ops/auth-api`） | **无账密入口**（`showLocalLogin:false`） |
| `marschat-inframon` | public | `https://monitor.marschat.online/infra/` | `/infra` | `/infra/api`（`auth-api-base` 同值） | host 网络部署；忘记密码借道 kb-gateway（见 `STATUS.md` T-LOW-8） |
| `marschat-activecode` | public | `https://tools.marschat.online/activecode/` | `/activecode` | — | **唯一无构建静态页应用**（UMD 方案）；回调带 `.html` 后缀 |
| `cosmic-studio` | public | `https://cosmic.marschat.online/` | `/` | — | 根路径部署；`menu-report-secret` 已 env-only |
| `marschat-memory` | public | `https://memory.marschat.online/` | — | — | 记忆提炼面板（工具类） |
| `marschat-tokenhub` | public | `https://tokenhub.marschat.online/` | — | — | 原生 generic_oidc，回调为内置地址；**当前 0 权限点**（见 `STATUS.md` T-LOW-9） |
| `frp-manager` | public | `https://frp.marschat.online/` | — | — | 工具类 |
| `p3-probe-client` | public | `https://p3-probe.marschat.online/` | — | — | 测试应用（Phase 3 验收用，全程零 Java 改动） |

> **六应用**（portal / activecode / kb-web / cosmic-studio / kb-ops / infra-monitor）为**紧密接入**对象；其余为工具/测试类。

---

## 4. `menu-registry.yml`（权限点上报）

```yaml
client: marschat-<应用>        # 必须与 apps-registry 的 client-id 一致
menus:
  - key: dashboard             # = sys_permission.code，前端 permCode 严格对齐，禁改名
    title: 总览看板
    path: /dashboard
    order: 1
    public: true               # ⚠️ strict 下普通用户的唯一落地页，全应用至多 1 个
  - key: users
    title: 用户管理
    path: /users
    min-role: admin            # 可选角色门槛
apis:                          # ⚠️ api 点任何模式都不自动授予
  - key: xxx:write
    title: xxx 写操作
```

**规则**：
1. **每应用至多 1 个 `public: true`** —— portal **有意为 0**（需在文件内注释说明）；activecode 以 `index` 为唯一 public。
2. 上报链路：`PUT /internal/clients/{id}/menus` / `PUT /admin/clients/{id}/menus` → `sys_permission(type=menu|api)` 全量覆盖 upsert（未上报者 status=0）。
3. 凭据缺失时**只 WARN 不阻断**启动 —— 故"没报错"不代表上报成功，须核对中心 `configured`。
4. 新增 api 点后：**应用管理员由中心幂等加法补齐**（实测 kb-ops 新点后 28/28），但**普通用户永不自动授予** → 上线新写闸门前必须确认使用者已显式授权，否则「点了就报错」。

---

## 5. 环境变量清单

| 变量 | 侧 | 作用 | 注意 |
|---|---|---|---|
| `MARSCHAT_MENU_REPORT_SECRET` | 应用 | 菜单/账号上报凭据（须与 registry 同值） | 缺省时上报静默降级（fail-soft） |
| `{PORTAL_CLIENT_SECRET, KBWEB_MENU_REPORT_SECRET, INFRAMON_MENU_REPORT_SECRET, ACTIVECODE_MENU_REPORT_SECRET, COSMIC_MENU_REPORT_SECRET}` | 部署机 | registry 中 `${ENV:默认}` 的注入源 | **改 registry 为 env-only 前必须确认已注入**（`STATUS.md` T-SYN-1） |
| `MARSCHAT_AUTHZ_MODE` | auth-center | `legacy` \| `strict`（默认最小权限开关） | **全平台回滚开关**：设 `legacy` 重启即复原，幂等可逆 |
| `KB_GATEWAY_AUTHZ_ENABLED` | kb-gateway | 网关接口级闸门总开关 | 应急关闭闸门用 |
| `JWT_SECRET` | 各应用后端 | 应用自身会话签名 | **每应用独立**（≥64B 随机，禁弱默认样式）；⚠️ 当前 auth-center / kb-gateway 仍共享（F1，见 `STATUS.md` T-DEC-1） |
| `MARSCHAT_AUTH_SECRET` | kb-ops | 上项在 kb-ops 的等价变量 | 与上项**同值**（即 F1 的第三处） |
| `INFRA_ADMIN_PASS` | infra-monitor | 管理口令（已外置） | — |
| `MENU_REPORT_SECRET` | cosmic-studio compose | 映射自 `COSMIC_MENU_REPORT_SECRET` | — |

> 🔴 铁律：**任何文档 / 仓库不得出现明文 secret**。一律写"见 Vaultwarden 或 infrastructure-map 技能"。

---

## 6. 端点全表

### 6.1 认证类（浏览器 / 应用 BFF 可达）

| 端点 | 算法 | 用途 |
|---|---|---|
| `/oauth2/authorize`、`/oauth2/jwks` | RS256 | OIDC 授权 / JWKS（JWKS 走**内网**） |
| `POST /auth/login` | HS384 | 账密校验（**唯一校验方**：应用 BFF 转发到此） |
| `POST /auth/refresh`、`/auth/mail-login`、`/auth/mail-login/send-code` | HS384 | 续期 / 邮箱验证码（6 位、Redis 一次性、60s 频控） |
| `POST /auth/forgot-password`、`/auth/reset-password` | HS384 | 忘记密码四步状态机（中心侧**防枚举恒成功**） |
| `/auth/slo`（带 `id_token_hint`） | — | 统一登出，销毁 IdP 会话 |
| `/auth/session` | — | SLO 会话探针（**公开 CORS 是设计内**，非违规直连） |
| `GET /auth/permissions?client=` | HS384 | 权限点查询（60s 缓存，R10 fail-open） |

> ⚠️ 业务 `/auth/**` **不在公网 `auth.marschat.online` 暴露**（实测 404），仅经应用 BFF / 网关或内网 `:8085`。
> ⚠️ auth-center 全端点 **HTTP 恒 200**，判定必须看 `body.code`。

### 6.2 管理类 —— 三层权限 API（Phase 12 终态）

| Method | Path | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/admin/clients/{cid}/members` | 应用管理员 | 列本系统成员（响应 `{list,total,page,size}`，**不是 records**） |
| POST | `/admin/clients/{cid}/members` | 应用管理员 | 加人 `{userId, roleIds}` |
| DELETE | `/admin/clients/{cid}/members/{uid}` | 应用管理员 | **移出本系统**（不是删身份） |
| GET | `/admin/clients/{cid}/member-candidates` | 应用管理员 | 加人候选：只回 `userId`/`username`/`nickname`、只列未加入、`keyword`≥2、`size`≤20、写审计 |
| GET | `/admin/clients/{cid}/roles` | 应用管理员 | **只读**本 client 角色清单 |
| POST | `/admin/clients/{cid}/roles` | **平台管理员** | 建应用角色（同路径**不同权**，防应用自造角色提权） |
| GET/PUT | `/admin/clients/{cid}/users/{uid}/roles` | 应用管理员 | 查 / 绑本系统角色 |
| GET/PUT | `/admin/clients/{cid}/users/{uid}/menu-overrides` | 应用管理员 | 菜单**减法**（只减不加） |
| — | `/admin/users**`、`/admin/mappings**`、`/admin/roles/{id}/permission-codes`、`/admin/authorization-matrix` | **平台管理员** | Identity / 平台级 Entitlement |
| PUT | `/admin/users/{uid}/client-roles?client=` | `hasRole('ADMIN')` 或应用管理员 | ⚠️ `@Deprecated`，**保留作回滚路径** |
| PUT | `/internal/clients/{id}/menus`、`/internal/clients/{id}/accounts` | `X-Client-Secret` | 权限点 / 账号上报（**不在公网白名单**，走内网） |

**关键原则**：`clientId` **只从 URL path 取**，不从 body / query 取 —— 只要 client 是参数，改 `client=B` 就能越界。

### 6.3 授权策略运维（Bearer 超管，`auth-center:8085`）

| 端点 | 用途 |
|---|---|
| `GET /admin/authz/policy` | 当前模式与各应用生效模式、public 菜单数 |
| `GET /admin/authz/impact?client=x&mode=strict` | 影响面**预演**（只读） |
| `POST /admin/authz/migrate?client=x[&force=true]` | 立即收敛 |
| `POST /admin/authz/restore-legacy?client=x` | 单应用回滚 |

---

## 7. 数据库真源表（库 `marschat_auth`）

| 表 | 作用 |
|---|---|
| **`user`** | **身份唯一真源** —— ⚠️ 表名就是 `user`，**不是 `sys_user`**（历史文档长期误写）；软删位是 `deleted`（**非** `status`），查询必须 `deleted=0` |
| `user_identity` | 身份扩展（邮箱等） |
| `sys_permission` | 权限点库（`type=menu`\|`api`，含 `is_public`） |
| `sys_role` | 角色（`scope=platform` \| `client` 双作用域） |
| `sys_role_permission` | 角色 → 权限点 |
| `sys_user_role` | 用户 → 角色（含 `granted_by`） |
| `sys_role_composite` | 角色继承（递归展开，防环深度 8） |
| `sys_app_client` | 注册的 OIDC client（含 `client_secret`、`last_sync_at`） |
| `app_account_mapping` | 本地账号 ↔ 中心身份映射（`UNIQUE(client_id, local_account)`，自动认领） |
| `sys_user_menu_override` | 用户级菜单**减法**（60s 缓存生效） |
| `operation_log` | 审计（user_id / username / action / resource_type / resource_id / detail / ip） |

> ⚠️ 已删死表：`user_credential`、`api_token`（勿再引用）。旧库 `kb_auth` 保留作回滚，观察期后删。

---

## 8. 域名 / 端口 / 地址

| 项 | 值 |
|---|---|
| OIDC issuer | `https://auth.marschat.online`（**逐字一致**，写错则全部 token 验不过） |
| auth-center 内网 | `192.168.31.105:8085` |
| 公网唯一入口 | 腾讯云 2 号 `1.117.70.30` |
| mykng（主开发运维机） | `192.168.31.105` |
| activecode 宿主 | `192.168.31.182:18080`（**不在 mykng**） |
| infra-monitor | `127.0.0.1:8088`（host 网络） |
| cosmic-studio | `192.168.31.105:8310` |
| Nexus | `192.168.31.105:8083`（Docker）/ `:8081`（npm、maven） |
| Woodpecker | `https://woodci.marschat.online` |
| 应用域名 | `main.` (portal) · `kb.` (kb-web `/kb/`、kb-ops `/ops/`) · `monitor.` (infra `/infra/`) · `cosmic.` · `tools.` (activecode `/activecode/`) · `memory.` · `tokenhub.` · `frp.`（均 `*.marschat.online`） |
| IdP 会话 Cookie 域 | `marschat.online` —— **内网 IP 直连无静默免登**（设计使然，非缺陷） |

---

## 9. 快速自检清单（配置改完必跑）

```bash
# 生成器是否跑过
cd devtools && python scripts/gen-from-registry.py

# 中心权限点是否已配置（configured=true 才说明上报生效）
curl -s http://192.168.31.105:8085/auth/permissions?client=<client-id>

# 应用产物是否真上线（不能只看流水线 SUCCESS）
docker exec <web容器> sh -c 'ls /usr/share/nginx/html/assets/ | head'

# 远端 tip 是否真的推上去了
git ls-remote origin <branch>
```

> 判定口径：**403 + 网关文案 = 闸门拦下；400/404/405/200 = 已穿闸门**。
