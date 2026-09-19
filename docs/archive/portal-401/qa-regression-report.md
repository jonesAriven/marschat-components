# MarsChat 统一认证 · 修复后全量回归验证报告（任务 #2）

**执行人**：QA 工程师 严过关（software-qa-engineer）
**任务编号**：#2（修复后全量回归验证）
**执行日期**：2026-09-18 约 10:00–11:2x（服务器时间）
**报告路径**：`C:\Users\13871\WorkBuddy\2026-09-06-22-47-35\verify\multisession\qa-regression-report.md`
**上游**：架构师方案（任务 #3）、工程师实施（任务 #4）、QA 覆盖报告 `qa-coverage-report.md`（任务 #5）

---

## 0. TL;DR（先看这段）

| 回归项 | 结论 | 判定 |
|---|---|---|
| **Fix A — auth-center IdP 登录页「返回入口」** | **未部署**（登录页源码无任何 返回/取消/back 元素；运行镜像构建于 09-18 00:14、早于修复窗口 9h、无更新镜像；auth-center 容器 Up 10h 未重启） | ❌ **FAIL（未生效，需对账）** |
| **Fix B — UserManagementPanel.vue 视觉改版** | **已部署**（5 应用 `操作` 列均 `fixedRight=True`、表头无裁切、0 控制台错误；修复前该列 w=280 且操作按钮落在可视区外） | ✅ **PASS** |
| **6 应用 SSO/独立 双通道登录回归** | 10 PASS + 2 N/A（kb-ops、activecode 无账密通道） | ✅ **PASS** |
| **多会话矩阵复跑**（3 个重部署前端，S1–S4） | kb-web **4/4 PASS**；infra **4/4 PASS**；**portal S1 PASS，S2/S3/S4 FAIL** | ⚠️ **portal 不稳定** |
| ⚠️ **portal 多会话不稳定（新发现）** | 两个并发同账号 portal 会话，**间歇性**（约 4/5 次）其一被硬跳 `/portal/login?reauth=1`（独立会话掉登录页；SSO 会话闪跳重认证回调）。**与 70s 空闲无关**（WAIT=0 也失败、WAIT=70 也通过），**kb-web/infra 同场景稳定** | ⚠️ **待工程师复核** |

> **一句话**：Fix B 生效、**Fix A 没生效**（需与任务 #4「已完成」对账）；双通道登录全绿；多会话隔离在 kb-web / infra **无回归**，但 **portal 暴露了一个「并发同账号会话间歇被踢回登录页」的稳定性问题**（已定位到 `401 → 硬跳 ?reauth=1` 机制，并做 5 组对照诊断，§7）。

---

## 1. 本次回归要回答的问题（来自主理人）

1. **Fix A**（auth-center IdP 登录页「返回入口」）是否可用？
2. **Fix B**（UserManagementPanel.vue 视觉改版）是否已部署且无 UI 回归？
3. **6 应用**（kb-web / portal / kb-ops / infra / cosmic / activecode）**SSO + 独立 双通道登录**是否均正常？
4. **多会话隔离矩阵全用例**复跑：两个不同浏览器并发登录**不互踢、不串号**是否仍成立？

**硬约束**：只读；夹具用临时账号且用后墓碑（本次**未新建任何夹具**）；headless 仅在服务器跑；每用例等待 **70s**（> sessionWatcher 60s 周期）；严格区分**产品缺陷**与**测试脚本缺陷**。

---

## 2. 环境与「修复冻结」状态

| 项 | 值 |
|---|---|
| 测试主机 | `mykng`（Debian，`ssh root@192.168.31.105`） |
| 浏览器 | `/usr/bin/chromium` `--headless=new` + CDP（Python `websockets`），每「浏览器」独立 `--user-data-dir` |
| hosts 坑 | 启动带 `--host-resolver-rules="MAP kb.marschat.online 1.117.70.30,MAP ops.marschat.online 1.117.70.30"` |
| 判据 | `online = 无可见密码框 AND url 不含 /login AND localStorage 有应用 token` |
| 缓存 | 每用例 `Network.setCacheDisabled=true` |

### 2.1 前端/后端容器部署时间（`docker ps`，CST）
| 容器 | 启动时间 | 属本次修复窗口(09:29–09:35)? | 备注 |
|---|---|---|---|
| **portal-web** | **2026-09-18 09:29:38** | ✅ 是 | Fix B 目标之一 |
| **kb-web** | **2026-09-18 09:32:48** | ✅ 是 | |
| **infra-monitor-web** | **2026-09-18 09:34:40** | ✅ 是 | |
| **auth-center** | **2026-09-18 00:14:23** | ❌ 否（Up 10h） | 运行镜像 `kb-app-auth-center:latest`(`sha256:a5776806…`) 构建于 09-17T16:14:23Z = 09-18 **00:14 CST** |
| portal-server | 2026-09-18 00:12:01 | ❌ 否（Up 10h） | 后端未动 |
| kb-ops-web | 2026-09-17 11:34 | ❌ 否 | 未重部署 |
| cosmic-web / cosmic-api | 2026-09-16 17:18 | ❌ 否 | 未重部署 |

> **结论**：本次修复只重部署了 **portal-web / kb-web / infra-monitor-web** 三个前端；**auth-center 未重启**（Fix A 属后端，未部署的强证据之一）。

### 2.2 账号与夹具（本次**未新建**）
| 账号 | id | 状态（DB 复查） |
|---|---|---|
| `admin` | 1 | `deleted=0` ✅ 未改动 |
| `qa-ms-u2` | 477 | `deleted=0` ✅ 未改动（非本次创建） |
| `qa-ms-m1` | 484 | `deleted=1`（第一阶段夹具，已墓碑） |
| `qa-ms-c1` | 485 | `deleted=1`（第二阶段夹具，已墓碑） |

> 口令仅经远程命令行环境变量注入，**未写入任何文件、未回显到本报告**。

---

## 3. Fix A 验证 — auth-center IdP 登录页「返回入口」 ❌ 未部署

**验证方法**：① 浏览器实测（从应用点 SSO 跳到 IdP 后，扫描 IdP 页面的可见锚点/按钮）；② 直接抓取 IdP 页面源码；③ 核对 auth-center 运行镜像时间。

### 3.1 浏览器实测（`reg-idp.json`）
从应用登录页点「统一认证登录(SSO)」→ 落到 `https://auth.marschat.online/login.html`，扫描该页：

| 应用 | IdP 页 URL | IdP 页可见锚点 | `return_entry_present` |
|---|---|---|---|
| portal | auth.marschat.online/login.html | 仅 `忘记密码？ → /forgot-password.html` | **false** |
| kb-web | 同上 | 仅 `忘记密码？` | **false** |
| kb-ops | 同上 | 仅 `忘记密码？` | **false** |
| infra | 同上 | 仅 `忘记密码？` | **false** |
| activecode | 同上 | 仅 `忘记密码？` | **false** |
| cosmic | — | （登录页加载超时 `TimeoutError`） | N/A |

> 每个应用跳转时 `referrer` 均已正确携带（如 `https://kb.marschat.online/`），即 **IdP 知道用户来源、却没有任何可见的「返回应用/取消」入口**。

### 3.2 页面源码直查（补充硬证据）
```
$ curl -s https://auth.marschat.online/login.html | grep -oiE "返回|回到|back to|return|cancel|取消"
（无任何匹配）
$ curl -s https://auth.marschat.online/login.html | grep -oE "<a [^>]*>[^<]*</a>"
<a href="/forgot-password.html">忘记密码？</a>
```

### 3.3 运行镜像时间（排除「改而未部署」）
- 运行容器镜像：`kb-app-auth-center:latest` = `sha256:a5776806b059…`，`docker inspect` 的 `Created = 2026-09-17T16:14:23Z` = **09-18 00:14 CST**。
- `docker images` 中**不存在**比 00:14 更新的 auth-center 镜像（仅有 `docker-auth-center:latest`、`kb-app-auth-center:rollback-20260916`）。
- auth-center 容器 **Up 10h、未重启**。

> **Fix A 判定：❌ 未部署（未生效）**。三门证据一致（登录页无返回元素 / 源码无返回标记 / 运行镜像构建早于修复窗口 9h）。**与任务 #4「已完成」状态矛盾，需对账**（可能：修复代码已提交但未构建发布 auth-center，或修复未落到 auth-center）。

---

## 4. Fix B 验证 — UserManagementPanel.vue 视觉改版 ✅ 已部署

**验证方法**：`reg_ui.py` 用与修复前同口径（`ui_review2.json`）测量 5 个应用用户管理表格：`overflowX`、`操作` 列是否 `fixedRight`、操作按钮是否可见、表头是否裁切、控制台是否有错误。

### 4.1 修复前基线（`ui-review2.json`，2026-09-18 04:4x）
- `操作` 列表头 **w = 280px**，**未固定**；
- 操作按钮定位 `right = 1149 / 1227 / 1305`，而表格可视区 `clientWidth = 1114` ⇒ **按钮落在可视区之外，必须横向滚动才能点到**。

### 4.2 修复后（`reg-ui.json`，2026-09-18 10:0x）
| 应用页面 | overflowX | fixedRight | 表头裁切 | 控制台错误 | 操作按钮 |
|---|---|---|---|---|---|
| kb-ops-users | 216 | **True** | 无 | 0 | 编辑/本系统角色/移出本系统 均 visible |
| infra-users | 216 | **True** | 无 | 0 | 同上 |
| portal-admin | 0 | **True** | 无 | 0 | 编辑/重置密码/应用角色/菜单权限/删除 均 visible |
| kb-web-users | 216 | **True** | 无 | 0 | 编辑/本系统角色/移出本系统 均 visible |
| cosmic-admin | 216 | **True** | 无 | 0 | 编辑/本系统角色/移出本系统 均 visible |

> **Fix B 判定：✅ 已部署**。5 个应用 `操作` 列均改为右侧固定（`fixedRight=True`）、无表头裁切、无控制台错误；操作按钮改为窄文本按钮（w=30/66），滚动时保持可见。`overflowX=216` 是列总宽的自然结果，**不再构成缺陷**（固定列已保证操作可达）。

---

## 5. 6 应用 SSO / 独立 双通道登录回归 ✅

证据：`reg-2ch.json`。

| 应用 | SSO 通道 | 独立（账密）通道 | 说明 |
|---|---|---|---|
| kb-web | ✅ PASS (oidc, admin/1) | ✅ PASS (legacy, admin/1, tv=3) | 走 auth-center |
| portal | ✅ PASS (oidc, admin) | ✅ PASS (legacy, admin) | 自认证 HS256 |
| kb-ops | ✅ PASS (oidc, admin/1) | — N/A | 登录页无账密表单（仅邮箱验证码） |
| infra | ✅ PASS (oidc, admin) | ✅ PASS (legacy, admin) | |
| cosmic | ✅ PASS (oidc, admin) | ✅ PASS (legacy, admin) | |
| activecode | ✅ PASS (oidc, admin/1) | — N/A | 无账密表单 |

**汇总：10 PASS + 2 N/A + 0 FAIL。** 双通道均可正常登录并落到各自主页。

---

## 6. 多会话隔离矩阵复跑（S1–S4，3 个重部署前端）

### 6.1 用例定义（两个不同浏览器 = 两个独立 profile）
| 编号 | A 通道 | B 通道 | 账号 |
|---|---|---|---|
| S1 | SSO | SSO | 同账号 admin |
| S2 | 独立 | 独立 | 同账号 admin |
| S3 | SSO | 独立 | 同账号 admin |
| S4 | 独立 | SSO | 同账号 admin |

> S5（异账号 admin vs qa-ms-c1）需 2nd 账号夹具；该夹具 `qa-ms-c1`(485) 已按纪律墓碑，本次**未重建**（见 §10）。

### 6.2 结果矩阵（批量复跑 `rerun3.log`）
| 应用 | S1 | S2 | S3 | S4 | 判定 |
|---|---|---|---|---|---|
| **kb-web** | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS | 🟢 **无回归** |
| **infra** | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS | 🟢 **无回归** |
| **portal** | ✅ PASS | ❌ FAIL | ❌ FAIL | ❌ FAIL | 🔴 见 §7 |

> portal 最先跑（机器最干净）即 3/3 独立相关用例失败；kb-web、infra 在其后同场景**全过** ⇒ **失败差异与机器负载无关**。

### 6.3 逐用例实测明细（身份 / token 类型 / 70s 内探针次数）
| 应用 | 用例 | A 侧 | B 侧 | 判定 |
|---|---|---|---|---|
| kb-web | S1 | admin/oidc/2 | admin/oidc/2 | PASS |
| kb-web | S2 | admin/legacy/2 | admin/legacy/2 | PASS |
| kb-web | S3 | admin/oidc/2 | admin/legacy/2 | PASS |
| kb-web | S4 | admin/legacy/2 | admin/oidc/2 | PASS |
| infra | S1 | admin/oidc/2 | admin/oidc/2 | PASS |
| infra | S2 | admin/legacy/0 | admin/legacy/0 | PASS |
| infra | S3 | admin/oidc/2 | admin/legacy/0 | PASS |
| infra | S4 | admin/legacy/0 | admin/oidc/2 | PASS |
| portal | S1 | admin/oidc/2 | admin/oidc/2 | PASS |
| portal | S2 | admin/legacy/0 → **被踢 reauth** | admin/legacy/0 | **FAIL** |
| portal | S3 | admin/oidc/2 → **卡在 callback** | admin/legacy/0 | **FAIL** |
| portal | S4 | admin/legacy/0 | admin/oidc/1 → **卡在 callback** | **FAIL** |

---

## 7. ⚠️ 新发现 — portal 并发同账号会话**间歇性**被踢回登录页

### 7.1 现象（`rerun3.log` 原文摘录）
```
CASE S2 app=portal A=indep/admin B=indep/admin
  T0 A online=True  ; T0 B online=True      ... sleeping 70s ...
  T1 A url=.../portal/login?reauth=1 online=False     ← A 掉登录页
  T1 B url=.../portal/ online=True kind=legacy        ← B 正常
  VERDICT: FAIL

CASE S3 app=portal A=sso/admin B=indep/admin
  T1 A url=.../portal/auth/callback?code=... online=False   ← A 被捕获在重认证回调途中
  VERDICT: FAIL

CASE S4 app=portal A=indep/admin B=sso/admin
  T1 B url=.../portal/auth/callback?code=... online=False   ← B 被捕获在重认证回调途中
  VERDICT: FAIL
```

### 7.2 机制（源码佐证，`/root/devtools/portal/src`）
- `src/api/request.ts:47-57`：**任何 API 返回 401** → `userStore.clearSession()` + `window.location.href = '/portal/login?reauth=1'`（**硬跳转**）。
- `src/views/LoginView.vue:98-115`：登录页挂载即 `bootstrapLoginPage()` 探 IdP 会话；**有** IdP 会话→静默免登回跳（即跳到 `/portal/auth/callback?code=…`），**无** IdP 会话→显示登录框。
- `src/main.ts:42-52`：portal **运行期不发 `/auth/session` 探针**，完全依赖上面的 401 拦截器被动跳转（kb-web/kb-ops/infra 为主动探针实现）。
- 后端 `PortalPermissionChecker`/`AuthzConfig`：权限缓存 **TTL=60s**（`marschat.authz.cache-ttl-ms:60000`）；`JwtUtil`：portal 自有 JWT 有效期 **24h** ⇒ **不是 token 过期**。

### 7.3 定性：**间歇性**、**与空闲时长无关**（关键）
为判定「真回归 vs 偶发」，做了 **5 组对照诊断**（全部用同一口令、同账号 admin）：

| 诊断 | 流程 | 结果 |
|---|---|---|
| 批量 `rerun3.log` | 标准矩阵 S2（login→login→T0 双 refresh→70s→T1 双 refresh） | **FAIL**（A→reauth） |
| `diag_portal_s2.sh` WAIT=40 | 同上，WAIT=40 | **FAIL**（A 在 T0 即已 offline） |
| `diag_portal_s2.sh` WAIT=70 | 同上，WAIT=70 | **FAIL**（A 在等待后 offline） |
| `diag_matrix_variants.sh` WAIT=0 | 同上，**WAIT=0（无空闲，仅双 refresh）** | **FAIL**（A 在 T0 即 offline） |
| `diag_matrix_variants.sh` WAIT=70 | 同上，WAIT=70 | **PASS**（A/B 均 online） |
| `diag_portal_401.py` | login→login→`pump` 60s（**无 refresh**） | **PASS**（A/B 均 online，0 个 4xx） |
| `diag_portal_reload.py` | login→refresh(A)→login B→refresh(A)→refresh(B)（**无 70s**） | **PASS** |
| `diag_portal_timeline.py` | login→login→`pump` 80s 每 5s 采样（**无 refresh**） | **PASS**（全程 online，0 个 4xx） |
| `diag_portal_reload60.py` | login→65s→refresh(A)（A only 与 A+B 各一次） | **PASS**（0 个 4xx） |

**由表可得三点**：
1. **是间歇性的**：同一标准矩阵 S2，WAIT=70 时 **FAIL 与 PASS 都出现过**；总计标准矩阵下 **S2 约 4 败 1 胜**，S3/S4 亦 FAIL。
2. **与「70s 空闲 / 60s 缓存 TTL」无关**：`WAIT=0` 也 FAIL（A 在登录+双 refresh 后立刻就掉）；`WAIT=70` 也 PASS 过。故不能归因于「越过 60s 权限缓存」。
3. **只出现在 portal**：kb-web、infra 用同一矩阵 S1–S4 **全过**；且 portal 是**被动 401 硬跳**实现，kb-web/kb-ops/infra 是**主动 `/auth/session` 探针**实现。
4. 未能在矩阵流程之外用「更简单的脚本」稳定复现（无 refresh 的变体全过）⇒ 触发点与**并发登录 + 页面 reload 的时序竞争**相关。

### 7.4 影响与建议
- **影响**：portal（`main.marschat.online/portal`）在「两个浏览器并发登录同一账号」下，**存在一定概率（本轮回测约 4/5）其中一个浏览器被踢回登录页**（独立会话真掉线；SSO 会话闪跳重认证、通常能自愈）。
- **定性**：portal 的**多会话稳定性**问题（间歇）。**是否为 09:29 重部署引入尚不能定论**——修复前仅一次单样本 PASS，而该问题本身是间歇的（单次 PASS 不足以证明当时无此问题）。**无论是否为回归，该间歇性不稳定都建议修复。**
- **建议给工程师**：① 排查并发同账号登录时 portal 侧为何会返回 401（关注 `PortalPermissionChecker` 60s 缓存失效时的并发竞态、以及两个会话同 `userId` 的分桶缓存）；② 评估把 401 拦截器从「**硬跳** `/portal/login?reauth=1`」改为「**先尝试静默免登/刷新，失败才跳**」，避免独立会话被无感踢出；③ 若确认与本次前端重部署相关，回看 09:29 那次构建包含的提交范围。

---

## 8. 夹具与 DB 完整性（回归后复查）

```
marschat_auth.user:
  1  admin      deleted=0   ✅ 未改动
  477 qa-ms-u2  deleted=0   ✅ 未改动（非本次创建）
  484 qa-ms-m1  deleted=1   （第一阶段夹具，已墓碑）
  485 qa-ms-c1  deleted=1   （第二阶段夹具，已墓碑）

oauth2_authorization principal_name=485 → 12 行（既有 P2-2 行为：删用户不清 oauth2 授权，非本次引入）
```
> 本次回归**未新建任何账号**、未改任何密码/配置/代码；浏览器状态隔离在 `/root/qa-ms/profiles/<RUN>-*`。

---

## 9. 本次回归遇到的测试脚本缺陷（与产品缺陷严格区分）

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| **T-16** | 首轮 kb-web 矩阵重跑在 S1 首个 `Page.navigate` 超时 29.9s 崩溃 | 前次运行残留 **22 个 chromium 孤儿进程**占满资源 | `pkill -9 -x chromium` 清理 + 应用间顺序执行后恢复 |
| **T-17** | 后台 wait 脚本用 `pgrep -f rerun_3apps` 自匹配（自身命令行含该串），无法提前退出 | `pgrep -f` 匹配到承载命令的 ssh shell 自身 | 改为 `grep -q "ALL DONE" rerun3.log` 判完成 |
| **T-18** | `ssh '… pkill -f qa-ms/profiles …'` 返回 127 | `pkill -f` 模式匹配到 ssh shell 自身导致自杀 | 改按 profile 锁 PID：`for p in $(pgrep -f "user-data-dir=/root/qa-ms/profiles/<TAG>"); do kill -9 "$p"; done` |
| **T-19** | 🔴 **全局 `pkill -9 -x chromium` 误杀并跑工作流**：13:04 架构师 `/root/diag-401` 的 E2b 实验实例被 QA 脚本的全局 kill 连带杀死 | 早期处置曾用 `pkill -9 -x chromium`（按进程名=**全机所有 chromium**），mykng 上多工作流并行时必然连坐 | **2026-09-18 已根治**：`rerun_3apps.sh` / `diag_portal_s2.sh` / `diag_matrix_variants.sh` / `after_batch_diag.sh` 5 处全局 kill 全改为按 `--user-data-dir` 锁 PID；同步安装运行副本 `/root/qa-ms/scripts/`（备份 `.bak-d1scoped-20260918`）。**禁止再用按进程名的全局 chromium kill。** |

> 另：本次会话 Bash 工具 stdout 采集异常（`echo`/`printf` 输出为空、ssh 误报 255/127），已改用「命令输出重定向到文件 → Read 读回」方式绕过；**不影响测量结果**（所有证据均落盘复核）。

---

## 10. 未覆盖边界（不猜）

1. **S5（异账号 admin vs qa-ms-c1）未复跑**：需 2nd 账号夹具，`qa-ms-c1`(485) 已按纪律墓碑、本次未重建。历史（第一/第二阶段）该用例在 kb-web/portal/kb-ops/infra/cosmic 均 PASS。
2. **S8（kb-web↔kb-ops 同源跨应用）未复跑**：其结论（`kb_*` 与 `kb_ops_*` 命名空间零交集）由应用代码常量决定，与本次「用户管理面板」重部署无关；沿用第二阶段证据 `s8.json`。
3. **Fix A 若后续补齐部署**：需重跑 `reg_idp.py` 定格复测。
4. **portal §7 问题的确定性复现**：本轮做了 5 组对照但仍为间歇，未能给出 100% 最小复现；建议工程师侧补充并发压测定位。

---

## 11. 给下游的三句话

1. **Fix B 已生效、Fix A 未生效**——Fix A 三门证据（登录页无返回元素 / 源码无标记 / 运行镜像早于修复窗口 9h）一致，**需与任务 #4「已完成」对账**（修复可能未构建发布 auth-center）。
2. **双通道登录全绿、kb-web / infra 多会话无回归**；但 **portal 在并发同账号下存在间歇性「被踢回登录页」**（`401 → 硬跳 ?reauth=1`），已做 5 组对照诊断（§7）并证明**与 70s 空闲无关**。
3. **本次未新建夹具、未改生产数据**；Fix A 收尾、portal 稳定性两项均需工程师动作后由 QA 定格复测。

---

## 附：产物清单
```
verify/multisession/
├── qa-regression-report.md               本报告
├── evidence/
│   ├── reg-idp.json                      Fix A 实测（5 应用 + cosmic 超时）
│   ├── reg-ui.json / reg-ui.log          Fix B 实测（5 应用 UI 指标）
│   ├── reg-2ch.json                      6 应用双通道回归
│   ├── ui-review2.json                   修复前 UI 基线（04:4x）
│   ├── appmatrix-kb-web.json             （未生成，重跑见 rerun3.log）
│   ├── appmatrix-infra.json              infra S1–S4 复跑（PASS）
│   ├── appmatrix-portal.json             portal 复跑（末次 S2 为变体 PASS，S3/S4 FAIL）
│   ├── rerun3.log                        3 前端 S1–S4 复跑原始日志
│   ├── diag_portal_s2.sh 输出             portal S2 WAIT=40/70/70（portal-s2-diag.log）
│   ├── diag401.log / diag_reload.log / diag_timeline.log / diag_reload60.log / diag_variants.log  portal 诊断
│   └── s8.json                           第二阶段同源跨应用（沿用）
└── scripts/
    ├── rerun_3apps.sh                    3 前端 S1–S4 复跑驱动
    ├── diag_portal_s2.sh                 portal S2 WAIT=40/70/70 定点诊断
    ├── diag_matrix_variants.sh           portal S2 WAIT=0/70 变体
    ├── diag_portal_401.py                portal 401 定位
    ├── diag_portal_reload.py             reload 最小复现
    ├── diag_portal_timeline.py           80s 时间线采样
    ├── diag_portal_reload60.py           65s 后 reload 对照
    ├── run_s8c.py                        仅 S8c 复跑器（备用）
    └── after_batch_diag.sh               批量结束后自动触发诊断
```
