# Phase 12 统一认证收口 · 进度交接快照（2026-09-16 18:00）

> **交接目的**：本会话（2026-09-16 全天）完成了 Phase 12 的主体攻坚。本文档汇总「已完成 / 关键认知 / 未完成」，
> 供下一轮会话或他人接手时快速恢复上下文。权威设计文档见文末「文档索引」。
> 铁律：**前序结论先复核再执行**——本文档的「已验证」条目附带了验证方法，接手后如需依赖请复跑。

---

## 1. 项目背景（30 秒版）

- **统一认证平台**：auth-center = SSO/OIDC 签发方 + 用户/权限真源；6 个自研应用接入：
  portal / activecode / kb-web / kb-ops / infra-monitor / cosmic-studio。
- **Phase 12 目标**：① 服务端落地「三层权限 API」（平台管理员 / 应用管理员 / 应用级 Entitlement）；
  ② 修共享组件 app 作用域越权入口（一处改 6 应用）；③ 各应用 BFF 白名单收窄；
  ④ 两类用户管理菜单 UX（中心台管人 / 应用台管关系）。
- **核心根因**（已修复，见 §2）：服务端原本不存在「应用管理员」角色，`/admin/**` 类级只有
  `hasRole('ADMIN')`；共享组件在 `scope.mode='app'` 下仍渲染只有中心台该有的按钮。

---

## 2. 今日已完成（全部已部署 + 实测）

### 2.1 auth-center · 三层权限 API 地基（`f139ea0`，CI repo4 #60）

- `AdminClientMemberController`（path 化成员端点）+ `AppAuthzEvaluator`（应用管理员判定，fail-closed）
  + `SecurityUtils.hasRoleAdmin`（平台管理员，DB 现查注入不可伪造）。
- 实测：平台管理员 200 / 普通用户 403 / 应用管理员本应用 200 且删平台用户 403 / 跨 client 403。
- 详见 `C:\Users\13871\WorkBuddy\2026-09-16-01-25-17\docs\p12-authcenter-3layer.md`（§6 有增补批全记录）。

### 2.2 auth-center · D-7 受限读端点 + R8 自锁（`d77b322`→`abcc7b6`→`d3152b5`，CI #61/#62/#63）

| 能力 | 说明 |
|---|---|
| `GET /admin/clients/{cid}/member-candidates` | 加人候选搜索：仅回 userId/username/nickname、只列未加入者、keyword≥2、size clamp≤20、写审计 |
| `GET /admin/clients/{cid}/roles` | 列本应用角色；与 `POST`（平台管理员建角色）**同名不同权** |
| R8 自锁保护 | removeMember/assignRoles 前置判定：变更将使应用再无 `api:admin:write` 持有者时，应用管理员 409 拒绝、平台管理员放行 + WARN 审计（`user.remove_last_app_admin`）；计数与 isAppAdmin 同口径，异常 fail-closed |

- 实测 **23/23 ALL GREEN**（脚本 `/root/p12_d7r8_test.py`，一次性 client `p12-r8-test` 已清理）。
- 登录主链路零回归（login / refresh / mail-login / OIDC 全 200）。
- 回滚镜像 `kb-app-auth-center:rollback-20260916` 保留。

### 2.3 marschat-components · 0.8.8 发版（commit `fb5c920` + merge `9908fba`，双端已推齐）

- **D-3 收口**（`UserManagementPanel.vue`，app 作用域）：
  - 「新建用户」隐藏（人属平台，应用台加人只走「添加已有用户」）；
  - 「重置密码」隐藏；
  - 「编辑」改**只读视图**：昵称/邮箱 disabled、状态开关隐藏、无确定按钮、`submitForm` 防御 return。
- **🔴 构建根因修复**：4 个组件 `lang="scss"` 但 `sass` 从未进 devDependencies（传递依赖消失即静默失败），
  真错误被 vite closeBundle 的 ENOENT **掩盖**。已补 `sass@^1.77.0`。
- 双远端分叉收敛：gitee（4 docs）与 github（SSO 0.8.6）merge 为 `9908fba` 后双推。
- **发版**：`@marschat/auth-components@0.8.8` → Nexus npm-hosted（shasum `5e99372a`），npm-public 已可见。
- 发版流程：node:20 容器（Nexus 镜像 192.168.31.105:8083/node:20-alpine）内 build + npm pack
  → tgz 拉回本机 → 本机 `npm publish`（`~/.npmrc` 已有 npm-hosted 认证，**勿新增凭据落盘**）。

### 2.4 cosmic-studio · 阶段 B（`6a73c0a`，CI repo3 #120）

- frontend `^0.8.7 → ^0.8.8`（lock 锁定 0.8.8，`npm ci` 可装）；
- 删除 BFF 透传 `admin_create_user` / `admin_update_user` / `AdminUserIn`（零残余引用）。
- 实测（192.168.31.105:8310）：**POST/PUT/DELETE `/api/admin/users*` 全 405**（handler 消失）；
  GET list/roles 401 可达；bundle 含 0.8.8 特征串「用户信息（只读）」；首页 200。
- 此前路线 A（`1adefa3`，#119）已删 reset_password / delete_user 两条。

### 2.5 本会话更早批次（摘要，详见 workspace docs）

| 项 | 结果 |
|---|---|
| portal-server 陈旧容器（P0 根因） | #793 重部署，中心新建用户 5 应用 5/5 可登录 |
| kb-ops 容器陈旧 19h | #794 重部署 |
| activecode 权限闸门 + 匿名洞 | PermissionInterceptor + fail-closed，匿名 POST /generate 200→401 |
| activecode / infra-monitor BFF 白名单收窄 | `b081268`（#799/#800），越权探针 404，create/update 因组件缺陷「压住」（0.8.8 后可移出） |

---

## 3. 🔴 关键认知与坑（接手必读）

1. **auth-center 启动种子**（Phase 7 既有行为）：每次启动对所有启用 client 幂等补建 admin/user 默认角色
   （scope=client），并把 **admin(uid=1) 自动绑为该 client 管理员**。⇒ 计数类逻辑（R8 等）测试前必须先移出
   uid=1 的种子绑定；真实 client 重启后 uid=1 恒为管理员（对权限边界无破坏，uid=1 本就是平台管理员）。
2. **auth-center `Result.fail` 走 HTTP 200 + `body.code`**：409/400 断言必须查 body，不能只看 HTTP status。
3. **webhook 丢失**：push 后 CI 未触发时，API 手动触发 500，**推空提交重触发**最可靠。
4. **Woodpecker repo_id**：1=devtools(dev) / 2=workcheck_python / 3=cosmic-studio(main) / 4=auth-center(main) /
   5=marschat-components(main)。**check-pipeline.py 的位置参数是流水线编号，不是数量**——`--recent 3` 会被
   当成「看 #3」；查最新直接 `--repo N` 不带编号。
5. **触发源**：cosmic-studio 触发源是 **GitHub**（push gitee 不触发），deploy.sh 从 gitee 拉——**两边都要推**。
   auth-center / marschat-components 同理双推。
6. **服务器前端构建统一走容器**：mykng 宿主 node v24 构建 vite5 项目会静默失败（transform 成功但产物不写盘）；
   用 `192.168.31.105:8083/node:20-alpine` 容器挂载构建。容器内 npm install 后 esbuild 的 postinstall 可能被
   allow-scripts 拦（`npm approve-scripts esbuild` + `npm rebuild esbuild`）。
7. **npm 发版凭据**：本机 `~/.npmrc` 已有 npm-hosted 的 `_auth`（域名 + 内网 IP 两份）；服务器上无认证。
   发布路径 = 服务器容器 pack → tgz 拉回本机 → 本机 publish。**禁止把凭据写进任何仓库/文档**。
8. **git 环境坑**：devtools / marschat-components 本地仓 `.git` 写与 refs 落盘受沙箱影响，**git 推送类操作走
   mykng 服务器**（工作克隆：`/root/auth-center-work`、`/root/components-work`、`/root/devtools/cosmic-studio`）；
   cosmic 本地仓（D 盘）实测可正常 pull。
9. **服务器共享产物目录** `/mnt/shared/auth-center-build` 是单例，禁并发部署；Woodpecker 多流水线并发会踩踏
   `sync-ci-scripts`（一次只跑一条）。
10. **凭据零落盘**：GitHub PAT / Nexus 密码只在既有配置文件（服务器 `.git/config`、本机 `~/.npmrc`）里，
    取法见各配置；Vaultwarden（vault.marschat.online:8222）是凭据真源。
11. **探针账号**：auth-center 超管 admin/admin123（测试脚本在用）；测试脚本口令运行时随机生成不落盘。

---

## 4. ⏳ 未完成待办（按优先级）

| # | 事项 | 依赖/说明 |
|---|---|---|
| 1 | **portal / infra-monitor / kb-web / kb-ops 升 `@marschat/auth-components ^0.8.8`** | 各仓 package.json + lock + 重建部署；升级后按钮消失属预期 |
| 2 | **各 BFF 白名单移出 create/update 透传** | 依赖 #1（按钮消失才无「点了就报错」）；activecode 手写页不受组件影响但需 UMD 同步 0.8.8 |
| 3 | **跨应用真浏览器统一回归** | 等 #1/#2 齐后一次回归更经济（应用台「新建」消失/「编辑」只读属预期）；同时补 E2E 报告 B~F 场景 |
| 4 | **kb-web / kb-ops 3.2-A 实施**（BFF + kb-gateway 路由白名单） | 已解锁：D-7 两端点 + 存量 `?client=` 端点白名单见 `p12-kbweb-kbops-samesite.md`；注意该文档有**路径勘误**（真实路径 `devtools\mykng\kb-web\` 与 `devtools\kb-ops\kb-ops-web\`，规格行号需复核） |
| 5 | **F1 JWT_SECRET 共享轮换方案** | architect-2 未产出；涉全应用 token 失效窗口 |
| 6 | **三份文档入库 devtools 仓**（ADR / 设计规格 / 审计） | `devtools/docs/adr/ADR-2026-09-16-Phase12-统一认证权限治理.md` 已写好（43KB）待 commit |
| 7 | **待良哥拍板**：① kb-ops「账号映射」页定性（a 仅平台管理员可见 / b 迁中心台）；② activecode 公开自助页甲/乙；③ auto-git-sync 是否停用 | 详见 ADR 待办 #11/#12/#13 |
| 8 | `p12bff_probe`(uid 351) 探针账号清理 | BFF 轮负责人自清 |

---

## 5. 环境速记

| 项 | 值 |
|---|---|
| mykng 主机 | `ssh root@192.168.31.105`（免密），生产/开发混合机，操作谨慎 |
| auth-center 线上 | http://192.168.31.105:8085（health/oidc/login.html） |
| cosmic-studio 线上 | http://192.168.31.105:8310（admin / cosmic@2026） |
| Woodpecker | https://woodci.marschat.online（token 在 devtools/woodScript/check-pipeline.py 内置） |
| 流水线脚本 | mykng `/root/devtools/woodScript/`（`check-pipeline.py --watch N --repo N`） |
| MySQL | 容器 `platform-mysql-1`，root 密码见容器 env（`MYSQL_ROOT_PASSWORD`），库 `marschat_auth` |
| 审计表 | `marschat_auth.operation_log`（列：user_id/username/action/resource_type/resource_id/detail/ip） |
| Nexus | 192.168.31.105:8083（Docker）/ :8081（npm 等）；npm-hosted 发版见 §3.7 |
| 工作克隆（服务器） | `/root/auth-center-work`、`/root/components-work`、`/root/devtools/cosmic-studio`、`/root/devtools`（woodScript） |
| 测试脚本（保留复用） | `/root/p12_3layer_test.py`（三层 API）、`/root/p12_d7r8_test.py`（D-7+R8） |

---

## 6. 文档索引（Phase 12 全套）

**workspace 文档**（`C:\Users\13871\WorkBuddy\2026-09-16-01-25-17\docs\`）：

| 文件 | 内容 |
|---|---|
| `p12-authcenter-3layer.md` | 三层权限 API 地基 + D-7/R8 增补批（§6 全记录 + 实测 + 回滚） |
| `p12-architect-design.md` | 设计规格（三层 API + 两类菜单 + Step3 白名单） |
| `p12-architect-audit.md` | 复核报告（5 处不成立项 + P0/P1/P2 清单） |
| `p12-menu-ux-spec.md` | 两类菜单逐文件前端规格（§2.0 已标注 0.8.8 落地状态） |
| `p12-cosmic-narrow.md` | cosmic 收窄路线 A + 阶段 B（已标 ✅） |
| `p12-bff-narrow.md` | activecode/infra BFF 白名单收窄 + 遗留（create/update 压住→0.8.8 后移出） |
| `p12-kbweb-kbops-samesite.md` | kb-web/kb-ops 3.2-A 取证（含路径勘误） |
| `p12-browser-e2e.md` | E2E 场景 A 全过（15 截图）；B~F 未执行 |
| `p12-engineer-probe.md` / `p12-engineer-fix.md` | 工程师核验/修复报告 |
| `p12-authcenter-deploy-audit.md` | auth-center 部署链路只读调查 |

**devtools 仓 ADR**（长期记忆真源）：
`D:\huliang\java\ideaworkspace\devtools\docs\adr\ADR-2026-09-16-Phase12-统一认证权限治理.md`（43KB，待入库 commit）

**本仓**：`docs/README.md` = marschat-components 权威手册（设计/接入/运维）。

---

*生成：WorkBuddy 会话 2026-09-16 18:00 · 交接人可直接从 §4 #1 开始续作。*
