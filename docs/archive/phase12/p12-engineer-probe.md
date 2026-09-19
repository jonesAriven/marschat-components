# Phase 12 线上实测核验报告（工程师 probe）

- 执行人：software-engineer
- 时间：2026-09-16
- 原则：**不信任文档结论，只信实测**。所有结论均附证据命令与关键输出片段。
- 环境：Windows 主机（Bash 不可用，全部走 PowerShell）；远程 `ssh root@192.168.31.105`（mykng）。
- 临时产物目录：`C:\Users\13871\WorkBuddy\2026-09-16-01-25-17\tmp\`（前缀 `_e2_`）。
- 本报告**不含任何密码 / secret 明文**（JWT、MySQL 口令、client_secret、menu-report-secret 一律只给长度或 sha256）。

---

## 0. 结论速览

| # | 结论 | 等级 |
|---|------|------|
| 1 | **activecode 线上 UMD 仍是 0.8.6**，组件库 dist 已构建 0.8.7 但**未同步**进 active-manager 内联副本 | 🟡 落后（实际影响≈0） |
| 2 | 5 个 SPA（portal/kb-web/kb-ops/infra/cosmic）锁文件均锁定 0.8.7，部署时间晚于 0.8.7 发布时间 → **推定线上为 0.8.7**；但产物被 minify 且无版本字面量，**无法字节级证明** | 🟢 推定一致 |
| 3 | **F1 确认成立**：auth-center 与 kb-gateway 的 `JWT_SECRET` **完全相同**（长度 58，sha256 一致） | 🔴 P2 |
| 4 | 认证中心数据真源健康：42 用户 / 超管在且启用 / superadmin 角色在 / 10 客户端 / 6 接入应用权限点均 >0 / 映射 18 行 / **点号脏数据 0 行** | 🟢 |
| 5 | 未推送改动：marschat-components → github **落后 4 个 commit**；另有 2 处未提交改动（组件库 0.8.7 版本号 + UserManagementPanel）+ devtools ADR 未提交 | 🟡 待确认后推 |
| 6 | 本地 `node_modules` 陈旧（portal 0.8.5，kb-web/kb-ops/infra 0.8.4）——**仅是本地开发/排障陷阱，非线上问题** | ⚪ 提示 |

---

## A. 线上真实版本核验

### A.1 核验方法（为什么不能只看 app-config.json）

1. 拉取入口 `index.html` → 解析其中 `<script type="module">` 与 `modulepreload` 的 JS chunk 列表；
2. 下载全部 chunk 到本地 → 用正则搜版本戳；
3. activecode（非 SPA，静态 HTML + 内联 UMD）单独走「下载线上 UMD → 与本地内联副本逐字节比对 + 读 `version` 字面量」。

**关键发现：ESM 产物里没有版本字面量。**
组件库只有在 UMD 构建里注入版本常量：

```
packages/auth-components/vite.umd.config.ts:22:  __AUTH_CORE_VERSION__: JSON.stringify(pkg.version)
packages/auth-components/src/umd.ts:65:          typeof __AUTH_CORE_VERSION__ === 'string' ? __AUTH_CORE_VERSION__ : '0.0.0-dev'
```

而该常量只在 `umd.ts` 入口被引用，SPA 走 ESM 入口会被 tree-shake 掉。实测：本地 `dist/marschat-auth-components.es.js` 与 `dist/marschat-auth-components.umd.cjs` 搜 `0.8.[0-9]` **均 0 命中**，只有 `dist/marschat-auth-core.umd.js` 命中 `0.8.7`（1 次）。
→ **SPA 侧不可能拿到版本字面量**；sourcemap 也不可用（5 个应用里 4 个 `.map` 返回 404，infra 的 `.map` 只有 818 字节、无有效 sources）。

### A.2 各应用入口与产物抓取结果

| 应用 | 入口 URL | HTTP | 主 chunk | chunk 字节 |
|---|---|---|---|---|
| portal | `https://main.marschat.online/portal/` | 200 | `/portal/assets/index-BDv3lk3i.js` | 1,179,807 |
| kb-web | `https://kb.marschat.online/kb/` | 200 | `/kb/s/assets/index-B--smYy1.js` | 1,182,682 |
| kb-ops | `https://kb.marschat.online/ops/` | 200 | `/ops/assets/index-Dr8wJC5t.js` | 103,721 |
| infra | `https://monitor.marschat.online/infra/` | 200 | `/infra/assets-v2/index-CavmfA9Y.js` | 1,157,063 |
| cosmic | `https://cosmic.marschat.online/` | 200 | `/assets/index-CALdKnyw.js` | 1,271,954 |
| activecode | `https://tools.marschat.online/activecode/login.html` | 200 | `/activecode/marschat-auth-core.umd.js` | 30,426 |

chunk 内公共库指纹 `__MARSCHAT_APP_BASE__` 全部命中（portal 2 / kb-web 2 / kb-ops 3 / infra 2 / cosmic 1），可证明公共库 ≥ 0.8.3（appBase 机制是 0.8.3/0.3.4 引入的）。

### A.3 版本核验结论表

| 应用 | 本地声明版本 | 线上实际版本 | 是否一致 | 证据强度 |
|---|---|---|---|---|
| portal | `^0.8.7`（pkg）／`0.8.7`（pnpm-lock，integrity `sha512-IMeCcSxx…WxLA==`） | ≥0.8.3（产物指纹）；构建于 0.8.7 发布之后 | ✅ 推定一致 | 中（锁文件 + 部署时间） |
| kb-web | `^0.8.7`／`0.8.7` | 同上 | ✅ 推定一致 | 中 |
| kb-ops | `^0.8.7`／`0.8.7` | 同上 | ✅ 推定一致 | 中 |
| infra | `^0.8.7`／`0.8.7` | 同上 | ✅ 推定一致 | 中 |
| cosmic | `^0.8.7`／`0.8.7`（package-lock 锁定，resolved 指向 Nexus 0.8.7 tgz） | 同上 | ✅ 推定一致 | 中 |
| **activecode** | 内联 UMD：本地副本 **0.8.6**（`docs/VENDORED-auth-core-umd.md` 记 0.8.6）；组件库 dist 已 **0.8.7** | **0.8.6**（产物内 `const version = "0.8.6"`） | ❌ **落后** | **强（字节级）** |

#### activecode 落后 —— 字节级证据

```
线上  https://tools.marschat.online/activecode/marschat-auth-core.umd.js
      sha256 = fe949f007dd9be82b5fc84819ff863d2e0bbb0cbc85955001d3a22616f006c44
      size   = 30426
      内容   : const version = "0.8.6";

本地内联副本  devtools/active-manager/activation-code-server/src/main/resources/static/activecode/marschat-auth-core.umd.js
      sha256 = fe949f007dd9be82b5fc84819ff863d2e0bbb0cbc85955001d3a22616f006c44   ← 与线上逐字节相同
      内容   : const version = "0.8.6";

组件库新产物  marschat-components/packages/auth-components/dist/marschat-auth-core.umd.js
      sha256 = be44ea0a2d1666c7be460185e7b526116573b657a9a7a4fe05d0ac8cef903249   ← 与线上不同
      size   = 30426（同尺寸，仅版本号与少量字节变了）
      内容   : const version = "0.8.7";
      构建时间 2026-09-15 21:48
```

**注意**：线上 `Last-Modified = Tue, 15 Sep 2026 15:50:38 GMT`（= 北京 09-15 23:50），**晚于** 0.8.7 发布（13:49Z）。
即 activecode 是在 0.8.7 已发布之后重新部署的，但部署的仍是 0.8.6 —— 说明 `sync-auth-core-umd.sh` 这次**没有跑**，不是"部署时序"问题。

**影响评估（低）**：0.8.6 → 0.8.7 的唯一改动是 `UserManagementPanel.vue` 在**应用作用域**下隐藏「重置密码」按钮（`v-if="cfg.allowResetPassword !== false && !isAppScope"`）＋ 注释。activecode 是手写静态 HTML + 原生 JS，不使用该 Vue 面板 → **实际业务影响 ≈ 0**。但流程上属于"文档口径（0.8.6）与线上一致、组件库已前进到 0.8.7"的不同步，建议择机同步。

#### activecode 部署在哪台机

- DNS：`tools/main/kb/cosmic/monitor/nexus.marschat.online` 全部解析到 `1.117.70.30`（公网入口），看不出源站。
- `devtools/apps-registry.yml` 里 activecode 的 redirect-uris 含 `http://192.168.31.182:18080/activecode/...`。
- 实测 `http://192.168.31.182:18080/activecode/login.html` → **200**（与线上同长度 25218）；`http://192.168.31.105:18080/...` → 404。
- **结论：active-manager 部署在 `192.168.31.182:18080`，不在 mykng（192.168.31.105）。**

### A.4 部署时间线（UTC）

| 产物 | Last-Modified (UTC) | 北京时间 |
|---|---|---|
| activecode UMD（0.8.6） | 09-15 15:50:38 | 09-15 23:50 |
| infra index.js | 09-15 16:03:41 | 09-16 00:03 |
| cosmic index.js | 09-15 16:11:45 | 09-16 00:11 |
| kb-web index.js | 09-15 16:18:42 | 09-16 00:18 |
| kb-ops index.js | 09-15 16:21:13 | 09-16 00:21 |
| portal index.js | 09-15 16:22:40 | 09-16 00:22 |

Nexus 发布时间：`@marschat/auth-components@0.8.7` = **2026-09-15T13:49:35.451Z**（= 北京 21:49，与本地 dist 构建时间 21:48 吻合）。
→ 5 个 SPA 的部署时间均在 0.8.7 发布**之后**，具备吃到 0.8.7 的时序条件。

### A.5 关于 `VENDORED-auth-core-umd.md`

- 线上 `https://tools.marschat.online/activecode/VENDORED-auth-core-umd.md` → **404**
- 线上 `https://tools.marschat.online/activecode/docs/VENDORED-auth-core-umd.md` → **404**
- 线上 `https://tools.marschat.online/VENDORED-auth-core-umd.md` → 200，但 Content-Type 是 `text/html`，内容是「激活码生成」页面（nginx 回退页），**不是该文档**
- → 该文档线上不可达；改用**直接比对 UMD 产物**（见 A.3），证据更强。

---

## B. 认证中心数据真源核验

执行方式：把远程脚本通过 `ssh … "bash -s"` 喂给 mykng，MySQL 口令在远端脚本内从容器 env 取出、用完即弃，**从不落到任何文件**。

```bash
P=$(docker exec platform-mysql-1 env | grep '^MYSQL_ROOT_PASSWORD=' | cut -d= -f2-)
q() { docker exec platform-mysql-1 mysql -uroot -p"$P" --default-character-set=utf8mb4 --table --force marschat_auth -e "$1"; }
```

> ⚠️ **表名纠正**：ADR/任务书里写的 `sys_user` **不存在**。真源用户表叫 **`user`**（另有 `user_identity`）。
> `marschat_auth` 全部表：`app_account_mapping / jwt_blacklist / oauth2_authorization / oauth2_authorization_consent / oauth2_registered_client / operation_log / ops_api_token / refresh_token / sys_app_client / sys_error_log / sys_permission / sys_request_log / sys_role / sys_role_composite / sys_role_permission / sys_user_menu_override / sys_user_role / user / user_identity`

### B.1 用户（`user`）

- 总行数：**42**
- 超管 `marschat@163.com`：**存在且启用**（`id=1, username=admin, status=1`，创建于 2026-07-13 19:07:51）

```
+----+----------+------------------+--------+---------------------+
| id | username | email            | status | created_at          |
+----+----------+------------------+--------+---------------------+
|  1 | admin    | marschat@163.com |      1 | 2026-07-13 19:07:51 |
+----+----------+------------------+--------+---------------------+
```

- 超管角色（`sys_user_role` ⋈ `sys_role`）：

| role_id | code | name | client_id |
|---|---|---|---|
| 1 | admin | 平台管理员 | NULL |
| 8 | user | 普通用户 | NULL |
| 36 | admin | 应用管理员 | marschat-portal |
| 50 | admin | 应用管理员 | cosmic-studio |
| 64 | admin | 应用管理员 | marschat-inframon |
| 78 | admin | 应用管理员 | marschat-kbops |
| 92 | admin | 应用管理员 | marschat-kbweb |
| 106 | admin | 应用管理员 | marschat-activecode |
| 134 | **superadmin** | 超级管理员 | NULL |

→ 平台级 superadmin + 6 个应用级 admin 全部到位，**6 应用一个不缺**。

### B.2 已注册客户端（`sys_app_client`）

共 **10** 个，含 6 个接入应用，全部 `status=1`：

| id | client_id | name |
|---|---|---|
| 1 | marschat-portal | MarsChat Portal |
| 8 | cosmic-studio | MarsChat COSMIC Studio |
| 15 | marschat-inframon | MarsChat Infra Monitor (SPA) |
| 22 | marschat-kbops | MarsChat KB Ops (SPA) |
| 29 | marschat-tokenhub | MarsChat TokenHub |
| 36 | marschat-kbweb | MarsChat KB Web (SPA) |
| 43 | marschat-activecode | MarsChat ActiveCode (SPA) |
| 50 | marschat-memory | MarsChat Memory Extract Panel |
| 57 | frp-manager | MarsChat FRP Manager |
| 127 | p3-probe-client | Phase3 Onboarding Probe |

### B.3 权限点（`sys_permission`）按 client 分组

| client_id | 权限点总数 | menu | api |
|---|---|---|---|
| marschat-portal | 5 | 2 | 3 |
| marschat-kbweb | 25 | 15 | 10 |
| marschat-kbops | 19 | 16 | 3 |
| marschat-inframon | 13 | 6 | 7 |
| cosmic-studio | 19 | 8 | 11 |
| **marschat-activecode** | **14** | 8 | 6 |

→ **6 个应用权限点全部 > 0，activecode（Phase 11 才补的）也有 14 个，验收通过。**

### B.4 账号映射（`app_account_mapping`）

- 总行数：**18**

| client_id | 行数 |
|---|---|
| marschat-portal | 13 |
| cosmic-studio | 3 |
| marschat-activecode | 1 |
| marschat-inframon | 1 |

（kb-web / kb-ops 无映射行——这两个应用走网关直转 + 中心账号，未启用本地账号映射，符合 Phase 11 D8 结论。）

### B.5 遗留脏数据：点号格式权限点

```sql
SELECT COUNT(*) FROM sys_permission WHERE code LIKE '%.%';
-- 结果：0
```

→ **0 行，ADR 里的遗留脏数据已清理干净。** ✅

### B.6 F1：auth-center 与 kb-gateway 是否共享 JWT_SECRET —— **确认共享** 🔴

```bash
A=$(docker inspect auth-center  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^JWT_SECRET=' | cut -d= -f2-)
B=$(docker inspect kb-gateway  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^JWT_SECRET=' | cut -d= -f2-)
```

```
auth-center JWT_SECRET length: 58
kb-gateway  JWT_SECRET length: 58
RESULT: SAME (shared secret -> F1 confirmed)
auth JWT_SECRET sha256: 92712b1a3014caea0df7c79695f32e6e441b515a73c75830da580b4365a6eddd
kbgw JWT_SECRET sha256: 92712b1a3014caea0df7c79695f32e6e441b515a73c75830da580b4365a6eddd
```

→ 两个容器 `JWT_SECRET` 环境变量**完全相同**（值不落盘，仅比对 sha256）。
→ **F1（遗留 🔴P2）判定：成立。** 任一服务的 token 可被对方签名/验签通过，鉴权边界失效。
→ 建议：kb-gateway 改用 auth-center 的 JWKS / 公钥验签，或至少拆分密钥；此项涉及鉴权链路，**不属于"低风险"，本次未动，需单独立项**。

补充：容器 env 键名盘点显示 auth-center 与 kb-gateway 都直接吃 `JWT_SECRET`；auth-center 另有 `MARSCHAT_AUTHZ_MODE` / `MARSCHAT_AUTHZ_STRICT_CLIENTS` / `MYSQL_*` / `NACOS_*`；kb-gateway 另有 `MARSCHAT_MENU_REPORT_SECRET`。

---

## C. 未推送 / 未部署改动盘点

### C.1 marschat-components

- 分支 `main`，remote：`gitee` + `github`
- `git status -sb`：`## main...github/main [ahead 4]`，工作区 2 个已改文件 + 1 个未跟踪

**远端真实状态（用 `git ls-remote` 直接问远端，不依赖本地 tracking 引用）：**

| 远端 | 远端 main | 本地 HEAD | 状态 |
|---|---|---|---|
| gitee/main | `acb8edd` | `acb8edd` | ✅ 已同步 |
| github/main | `95c4d0b` | `acb8edd` | ❌ **落后 4 个 commit** |

**未推送到 github 的 4 个 commit：**

| sha | 说明 |
|---|---|
| `032fb67` | docs!: 七份零散文档合并为单一权威手册 README.md；补 Phase 10 增量；登记遗留 F1/F2 与测试资产 |
| `74c9ab1` | docs: Phase 11 收口——独立账密统一到认证中心、两类用户管理菜单职责边界、版本基线与文档索引修正 |
| `d413400` | docs: 补 Phase11 接入规范（应用侧用户管理必须经 BFF 代理）与坑 #24-26 |
| `acb8edd` | docs: 补坑 #27-28（免登测试必须用全新 profile；登录页禁做一次性重授权短路） |

（4 个全是 docs，**不含代码改动**。）

**未提交的工作区改动（2 个文件，7 insertions / 2 deletions）：**

1. `packages/auth-components/package.json`：`version 0.8.6 → 0.8.7`
2. `packages/auth-components/src/components/UserManagementPanel.vue`：应用作用域隐藏「重置密码」按钮

```diff
-              v-if="cfg.allowResetPassword !== false"
+              v-if="cfg.allowResetPassword !== false && !isAppScope"
```
（并新增 5 行注释，说明"口令是统一身份的全局属性，改它会影响所有系统登录，属平台级职责"。）

3. 未跟踪文件：`_ls2.txt`（临时文件，建议删掉或加 gitignore）

**C.1 附加问题回答：**

- **0.8.7 是否已 publish 到 Nexus？→ 是。** `dist-tags.latest = 0.8.7`，发布时间 `2026-09-15T13:49:35.451Z`。
- **本地 dist 是否已构建？→ 是。** `packages/auth-components/dist/` 于 2026-09-15 21:48 构建，共 4 个文件：
  `marschat-auth-components.es.js`(157,068) / `marschat-auth-components.umd.cjs`(108,224) / `marschat-auth-core.umd.js`(30,426，内含 `0.8.7`) / `style.css`(16,833)。
- `@marschat/frontend-common` 最新发布 `0.3.5`；本地 dist 构建于 2026-09-13，**未随本次升版**（当前各应用锁定 0.3.5，无缺口）。

### C.2 devtools

- 分支 `dev`（remote：`origin`=gitee，`origin` 另有 github pushurl，`github`=github）
- **远端已同步**：`origin/dev` = `github/dev` = 本地 `59b8bb6`（`git ls-remote` 实测一致）
- 未提交：**1 个文件**
  - `docs/adr/ADR-2026-09-15-Phase11-统一登录与用户管理收敛.md`（+3 行）
- 无未跟踪文件（工作区仅这一条 ` M `）

### C.3 cosmic-studio

- 分支 `main`（remote：`origin`=gitee，`github`=github）
- **远端已同步**：`origin/main` = `github/main` = 本地 `4e022f4`
- 工作区：仅未跟踪目录 `_diag/`，**无已跟踪文件改动**

### C.4 auth-center

- 分支 `main`（remote：`origin`=github，`gitee`=gitee）
- **远端已同步**：`origin/main` = `gitee/main` = 本地 `6212453`
- 工作区：**干净**

### C.5 未推送 / 未提交改动清单（待确认后再推）

| # | 仓库 | 类型 | 内容 | 风险 | 建议 |
|---|---|---|---|---|---|
| 1 | marschat-components | 未推送（github 落后 4） | 4 个 docs commit（`032fb67`…`acb8edd`） | 低 | 推 github（gitee 已有，纯文档同步） |
| 2 | marschat-components | 未提交 | `package.json` 0.8.6→0.8.7 | 中 | 与 #3 一起成一个 commit：`chore(auth-components): 0.8.7` |
| 3 | marschat-components | 未提交 | `UserManagementPanel.vue` 应用作用域隐藏重置密码 | 中 | 同 #2 |
| 4 | marschat-components | 未跟踪 | `_ls2.txt` | 低 | 删除 / 加 .gitignore |
| 5 | devtools | 未提交 | ADR-2026-09-15-Phase11（+3 行） | 低 | 单独 commit 后双推 |

> 按指令**未执行任何提交 / 推送 / 流水线触发**，仅整理清单。

---

## D. 其他实测发现（未修，仅记录）

1. **本地 node_modules 陈旧（非线上问题，但会坑排障）**
   - `portal/node_modules/@marschat/auth-components` = **0.8.5**
   - `mykng/kb-web`、`kb-ops/kb-ops-web`、`infra-monitor/infra-monitor-web` = **0.8.4**
   - `cosmic-studio/frontend/node_modules` = 0.8.7（唯一跟上）
   - → 本地跑 dev server 复现问题时，行为会与线上（0.8.7）不一致。排障前先 `pnpm install`。

2. **表名口径不一致**：ADR / 任务书写 `sys_user`，实际是 `user`。建议统一文档口径，避免后人照着错误 SQL 排查。

3. **`VENDORED-auth-core-umd.md` 线上不可达**（见 A.5）；文档说"线上打开控制台执行 `MarschatAuth.version` 即可确认版本"——本轮改用直接下载产物比对，等效且更硬。

4. **activecode 部署位置**：`192.168.31.182:18080`（mykng 上 `docker ps` 无 active-manager 容器，与预期一致）。

5. **多余客户端**：`sys_app_client` 里有 `marschat-tokenhub`、`marschat-memory`、`frp-manager`、`p3-probe-client` 4 个非"6 应用"条目；其中 `p3-probe-client` 是 Phase 3 验收探针，`marschat-memory` / `frp-manager` 已注册但不在本次 6 应用范围——**是否清理请产品/架构确认，本次未动。**

6. **`marschat-tokenhub` 在 `sys_permission` 里 0 权限点**（B.3 表未列出）——该应用未上报权限点。是否属于缺口取决于它是否算"已接入"，本次未判断。

---

## E. 本轮执行的证据命令索引

| 目的 | 命令 / 产物 |
|---|---|
| 4 仓库 git 状态 | `git -C <repo> status -sb / log --oneline -12 / branch -vv`；`_e2_01/02/03` |
| 远端真实 HEAD | `git ls-remote <remote>`；`_e2_04_lsremote.txt` |
| 入口页抓取 | `Invoke-WebRequest` 6 个入口；`_e2_05_entries.txt` + `_e2_entry_*.html` |
| chunk 下载与版本正则 | `_e2_07_verhits.txt` + `_e2_js_*.js` |
| 本地 dist / 各 app 依赖声明 | `_e2_08_localver.txt`、`_e2_11_apps_decl.txt` |
| Nexus 发布版本与时间戳 | `GET /repository/npm-hosted/@marschat%2fauth-components`；`_e2_09_nexus.txt`、`_e2_18_more.txt` |
| activecode UMD 三方比对 | `Get-FileHash -Algorithm SHA256`；`_e2_12_activecode.txt`、`_e2_19_final_check.txt` |
| 容器/env/JWT 比对 | `docker ps`、`docker inspect --format '{{range .Config.Env}}…'`；`_e2_14_remote1.txt` |
| MySQL 真源查询 | `docker exec platform-mysql-1 mysql -uroot -p"$P" marschat_auth -e …`；`_e2_15/16` |
| 资产 Last-Modified / sourcemap | `Invoke-WebRequest -Method Head`；`_e2_17_misc.txt` |
| DNS / 源站定位 | `[System.Net.Dns]::GetHostAddresses` + 直连 182/105 端口；`_e2_17_misc.txt`、`_e2_18_more.txt` |

---

## F. 未做的事（按指令保留）

- 未执行任何 `git commit` / `git push`
- 未触发任何 Woodpecker 流水线（`woodScript/trigger-pipeline.py`）
- 未修改任何代码逻辑、未改线上 nginx、未手动 docker build
- 未触碰 work_check / workcheck 相关服务
- 未把任何口令 / secret 写进产出文件
