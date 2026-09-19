# MarsChat 统一认证 · 多会话矩阵「应用覆盖补齐」+ S8 同源跨应用 + D2 文案实测

**执行人**：QA 工程师 严过关（software-qa-engineer）
**任务编号**：#5（任务 #1 的第二阶段）
**执行日期**：2026-09-18 08:5x–09:5x（服务器时间）
**报告路径**：`C:\Users\13871\WorkBuddy\2026-09-06-22-47-35\verify\multisession\qa-coverage-report.md`
**上游**：第一阶段报告 `qa-multisession-report.md`（S1–S7 主矩阵，主测应用 kb-web）

---

## 0. TL;DR（先看这段）

| 结论 | 判定 |
|---|---|
| **A. 逐应用多会话隔离矩阵（portal / kb-ops / infra / cosmic 新跑；kb-web 沿用第一阶段）** | ✅ **全部 PASS**。「两个不同浏览器并发登录同一账号不互踢、不串号」在 **5 个应用上全部成立**（kb-ops 因无账密登录，仅 2 例适用）。本阶段新跑 **20 个用例位（4 应用 × 5）= 17 PASS + 3 N/A + 0 FAIL**。 |
| **B. S8 同源跨应用（kb-web ↔ kb-ops，同域 `kb.marschat.online`）** | ✅ **两应用键名零交集、互不覆盖**（S8a/S8c PASS）。⚠️ S8b 复现第一阶段 P2-1：**共享 IdP 会话被另一账号覆盖后，另一个页签静默切换身份**（kb-web admin → qa-ms-c1）。 |
| **C. D2 分页/空态文案** | ⚠️ **工程师判断部分不符，且被测前端在本阶段执行期间被重新部署（移动靶）**。08:43 快照：portal/infra=英文（与判断一致）、**kb-web 实测已是中文（与判断不一致）**、kb-ops/cosmic=中文；**09:29–09:35 三个前端容器被重新部署后，09:41–09:50 复测 5 个应用分页文案全部为中文**。 |
| 🔴 P1-1 跨应用复现 | **独立登录（legacy）会话不启动 sessionWatcher，在 portal / infra / cosmic 三个应用上全部复现**（oidc 会话 2 次探针 / legacy 会话 0 次，同一用例内对照）。 |
| 产品缺陷（新） | 0 条**全新** P0/P1；本阶段主要验证性结论 + 1 条流程性告警（测试期间代码被改动）。 |
| 测试脚本缺陷（新） | 6 条（T-10…T-15，**已单列**，勿误读为产品问题）；其中 T-13/T-14 一度产生「产品缺陷」形态的假信号。 |

> **⚠️ 本阶段最重要的方法论告警（请主理人裁决）**：本阶段执行期间，`portal-web`（09:29:38）、`kb-web`（09:32:49）、`infra-monitor-web`（09:34:40）三个前端容器被**重新部署**（工程师正在实施修复，任务 #4 in progress）。因此任何**前端**结论（P1-1、D2）都是「某一时刻的快照」，**必须在工程师修复冻结后重测**；而**后端 SSO/OIDC 会话行为**（本矩阵的核心）不受影响（`auth-center` 未重启，Up 10h）。

---

## 1. 本阶段要解决的覆盖缺口（来自主理人核实）

第一阶段 `verify/multisession/evidence/` 下全部矩阵 JSON 的实测证据**只落在 `kb.marschat.online`（kb-web）**。本阶段补齐：

| 项 | 内容 | 状态 |
|---|---|---|
| **A** | 对 portal / kb-ops / infra-monitor / cosmic-studio **逐应用**跑 S1–S5 双 profile 隔离矩阵 | §3 ✅ |
| **B** | **S8 同源跨应用冲突**（kb-web 与 kb-ops 同域）：S8a 独立+SSO 异账号 / S8b 双 SSO 异账号（IdP 覆盖）/ S8c localStorage 键名账目 | §4 ✅ |
| **C** | **D2 分页/空态文案实测**，核验工程师判断 | §5 ✅ |

**硬约束（全程遵守）**：只读；夹具用临时账号且用后墓碑；headless 仅在服务器跑；每用例等待 **70s**（> sessionWatcher 60s 周期）；严格区分**产品缺陷**与**测试脚本缺陷**。

---

## 2. 环境与口径

| 项 | 值 |
|---|---|
| 测试主机 | `mykng`（Debian，`ssh root@192.168.31.105`） |
| 浏览器 | `/usr/bin/chromium` `--headless=new` + CDP（Python `websockets`） |
| 隔离 | 每个"浏览器"一个独立 `--user-data-dir` profile = 两个不同浏览器 |
| 缓存 | 全程 `Network.setCacheDisabled=true` |
| 探针周期 | `sessionWatcher` = 60s → 每用例等待 **70s** |
| hosts 坑 | `/etc/hosts` 钉 `kb.marschat.online`/`ops.marschat.online` → 127.0.0.1 ⇒ 启动带 `--host-resolver-rules="MAP kb.marschat.online 1.117.70.30,MAP ops.marschat.online 1.117.70.30"` |
| 「在线」判据 | `online = 无可见密码框 AND url 不含 /login AND localStorage 有应用 token`；身份解码应用自持 token / LS |

### 2.1 账号与夹具
| 账号 | id | 用途 | 状态 |
|---|---|---|---|
| `admin` | 1 | 平台超管，同账号会话主体 | 未改动 |
| `qa-ms-c1` | 485 | 本阶段第二账号（异账号用例） | 用后墓碑（§7） |
| `qa-ms-m1` | 484 | 第一阶段第二账号 | 已墓碑 |

> 口令仅通过远程命令行环境变量注入，**未写入任何文件、未回显到本报告**。

### 2.2 各应用「独立登录（账密）」可用性（决定用例可跑性）
| 应用 | 登录页 | 独立登录（账密） | 说明 |
|---|---|---|---|
| kb-web | `kb.marschat.online/kb/login` | ✅ | 走 auth-center（HS384 + `tv`） |
| portal | `main.marschat.online/portal/login` | ✅ | 自认证 HS256 |
| **kb-ops** | `kb.marschat.online/ops/login` | ❌ **无账密表单（仅邮箱验证码）** | 含独立登录的 S2/S3/S4 **N/A** |
| infra | `monitor.marschat.online/infra/login` | ✅ | infra 自后端 |
| cosmic | `cosmic.marschat.online/login` | ✅ | cosmic 自后端 |
| activecode | `tools.marschat.online/activecode/login.html` | — | 无「用户管理」页，不属本阶段范围（其 SSO 集成**已确认存在**） |

---

## 3. A. 逐应用多会话隔离矩阵（S1–S5）

### 3.1 用例定义（逐条列出通道组合，避免编号歧义）
| 编号 | A 通道 | B 通道 | 账号 | 检验点 |
|---|---|---|---|---|
| **S1** | SSO | SSO | 同账号 admin | 双浏览器并发 SSO 同账号 → 是否互踢 |
| **S2** | 独立 | 独立 | 同账号 admin | 双浏览器并发独立登录同账号 → 是否互踢 |
| **S3** | SSO | 独立 | 同账号 admin | 混合通道（A 先 SSO） |
| **S4** | 独立 | SSO | 同账号 admin | 混合通道（镜像） |
| **S5** | SSO | SSO | admin vs `qa-ms-c1` | 异账号 → 是否串号 |

> 主理人口径 S1/S5 均为「双 SSO」，其中 **S1 覆盖「同账号」、S5 补「异账号串号」检查**，避免与 S1 完全重复。
> 流程：A 登录 → B 登录 → T0（双判）→ 等 70s（跨探针周期）→ T1（双判身份）。
> 证据：`evidence/appmatrix-{portal,kb-ops,infra,cosmic}.json`；截图 `shots/<case>{A,B}-final.png`。

### 3.2 结果矩阵（应用 × 用例）
| 应用 \ 用例 | S1 | S2 | S3 | S4 | S5 | 备注 |
|---|---|---|---|---|---|---|
| **kb-web**（第一阶段，编号另见报告一） | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS | 第一阶段已覆盖同构组合；S6/S7 另见报告一 |
| **portal** | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS | 含 1 次 S5 误报 ERROR（脚本 T-14，重跑 PASS） |
| **kb-ops** | ✅ PASS | — N/A | — N/A | — N/A | ✅ PASS | 无账密登录 ⇒ S2/S3/S4 N/A |
| **infra** | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS | 含 2 次误报（脚本 T-13/T-14，修复后重跑全 PASS） |
| **cosmic** | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS | — |

**汇总：本阶段新跑 20 个用例位（4 应用 × 5）= 17 PASS + 3 N/A + 0 FAIL。**

### 3.3 逐用例实测明细（身份 / token 类型 / 探针次数）
`token_kind`：`oidc`=SSO 通道，`legacy`=独立账密通道；probe=`sessionWatcher` 在 70s 窗口内 `/auth/session` 次数。

| 应用 | 用例 | 判定 | A 侧（身份/类型/探针） | B 侧（身份/类型/探针） |
|---|---|---|---|---|
| portal | S1 | PASS | admin/oidc/2 | admin/oidc/2 |
| portal | S2 | PASS | admin/legacy/**0** | admin/legacy/**0** |
| portal | S3 | PASS | admin/oidc/2 | admin/legacy/**0** |
| portal | S4 | PASS | admin/legacy/**0** | admin/oidc/2 |
| portal | S5 | PASS | admin/oidc/2 | qa-ms-c1/oidc/2 |
| kb-ops | S1 | PASS | admin/oidc/2 | admin/oidc/2 |
| kb-ops | S5 | PASS | admin/oidc/2 | qa-ms-c1/oidc/2 |
| infra | S1 | PASS | admin/oidc/2 | admin/oidc/2 |
| infra | S2 | PASS | admin/legacy/**0** | admin/legacy/**0** |
| infra | S3 | PASS | admin/oidc/2 | admin/legacy/**0** |
| infra | S4 | PASS | admin/legacy/**0** | admin/oidc/2 |
| infra | S5 | PASS | admin/oidc/2 | qa-ms-c1/oidc/2 |
| cosmic | S1 | PASS | admin/oidc/2 | admin/oidc/2 |
| cosmic | S2 | PASS | admin/legacy/**0** | admin/legacy/**0** |
| cosmic | S3 | PASS | admin/oidc/2 | admin/legacy/**0** |
| cosmic | S4 | PASS | admin/legacy/**0** | admin/oidc/2 |
| cosmic | S5 | PASS | admin/oidc/2 | qa-ms-c1/oidc/1 |

### 3.4 核心命题逐应用结论
> 主理人要求逐应用回答「两个不同浏览器并发登录是否互踢」。

| 应用 | 两浏览器并发登录是否互踢？ | 是否串号？ | 依据 |
|---|---|---|---|
| kb-web | **否** | **否** | 第一阶段 S1–S5 全 PASS |
| portal | **否** | **否** | S1–S5 全 PASS |
| kb-ops | **否**（S1/S5） | **否** | S1/S5 PASS；S2/S3/S4 N/A |
| infra | **否** | **否** | S1–S5 全 PASS |
| cosmic | **否** | **否** | S1–S5 全 PASS |

**横向新发现（加强 P1-1）**：在 portal / infra / cosmic **三个应用**的 S2/S3/S4 里，**独立登录（legacy）会话 70s 内 `/auth/session` 探针 = 0 次**，而同用例内 SSO（oidc）会话 = 2 次。⇒ 第一阶段在 kb-web 上发现的 **P1-1（legacy 会话完全不启动 sessionWatcher）在多个应用上稳定复现**，不是 kb-web 个例。

---

## 4. B. S8 同源跨应用冲突（kb-web vs kb-ops，同域 `kb.marschat.online`）

**背景**：kb-web 在 `/kb`、kb-ops 在 `/ops`，**同域名 = 同 origin = 共享同一 localStorage**。第一阶段只测跨浏览器隔离，未测**同源跨应用**是否互相覆盖会话。

证据：`evidence/s8.json`；截图 `shots/s8-{S8a,S8b,S8c}-tab{1,2}.png`。

### 4.1 S8c — localStorage 键名账目（**直接证据**）
流程：清空 localStorage → kb-web SSO admin 登录 → 快照 → 新页签 kb-ops SSO admin 登录 → 快照 → 求键名差集/交集。

```
diff = {
  "only_in_first":  [],                                        // kb-web 的键一个都没丢
  "only_in_second": ["kb_ops_access_token","kb_ops_id_token","kb_ops_token_kind"],
  "intersection":   ["kb_access_token","kb_id_token","kb_token_kind"],  // 两快照共有且未变
  "same_name_diff_value": {}                                   // ★ 无任何同名键被改写
}
```
- 两页签在 70s 后与刷新后**身份均保持** `admin/1`（tab1 kb-web、tab2 kb-ops）。
- **结论**：两应用分处 `kb_*` / `kb_ops_*` **两个命名空间，键名零交集**；后登录的 kb-ops **没有覆盖** kb-web 的任何键。✅

### 4.2 S8a — Tab1 kb-web 独立登录 admin + Tab2 kb-ops SSO `qa-ms-c1`
```
tab1 kb-web  : admin    / sub=1   / legacy(tv=3) / /kb/dashboard    （等待后 + 刷新后均不变）
tab2 kb-ops  : qa-ms-c1 / sub=485 / oidc         / /ops/dashboard
```
- 独立登录 + SSO 混合、异账号，同源共存 **无互相干扰、无串号**。✅

### 4.3 S8b — Tab1 kb-web SSO admin + Tab2 以 `qa-ms-c1` 覆盖共享 IdP 会话后进 kb-ops
```
tab1 kb-web  : admin/1  →（等待 70s 后）→  qa-ms-c1/485      ← ★ 静默切换身份
tab2 kb-ops  : qa-ms-c1/485
刷新 tab1 后 : 仍为 qa-ms-c1/485
```
- **结论**：当共享的 IdP 会话被另一账号覆盖后，同源的 kb-web 页签会在 **≤1 个探针周期（≈60s）内静默切换为另一账号**，无提示、无登出。
- 这是第一阶段 **P2-1 的跨应用版本**（甚至更严重：现在是在**两个不同应用**之间发生）。属**单浏览器 = 单 IdP 身份**的设计约束，但「静默」与「UI 仍显示旧账号头像」两点建议评估。

---

## 5. C. D2 分页 / 空态文案实测

> 核验工程师判断：**「portal、kb-web、infra 英文；kb-ops、cosmic 中文」**。
> ⚠️ 本节测量**跨越了一次前端重新部署**，故给出两个时刻的快照（见 §5.3）。

### 5.1 快照一：08:43（重新部署前）
证据：`evidence/d2-locale.json`

| 应用 | 分页全文（原样） | 实测语言 | 工程师判断 | 吻合 |
|---|---|---|---|---|
| portal-admin | `Total 3 10/page 1 Go to` | **英文** | 英文 | ✅ |
| kb-web-users | `共 1 条 10条/页 1 前往 页` | **中文** | 英文 | ❌ **不符** |
| kb-ops-users | `共 1 条 10条/页 1 前往 页` | **中文** | 中文 | ✅ |
| infra-users | `Total 1 10/page 1 Go to` | **英文** | 英文 | ✅ |
| cosmic-admin | `共 1 条 10条/页 1 前往 页` | **中文** | 中文 | ✅ |

⇒ 4/5 吻合；**kb-web 与判断不符（实测中文）**。

### 5.2 快照二：09:41–09:50（重新部署后，多时点复测）
证据：`evidence/d2-pager.json`（每应用在 t+0 / t+15s / t+35s 三个时点采样，均**无交互**、稳定一致）

| 应用 | t+0s | t+15s | t+35s | 实测语言 |
|---|---|---|---|---|
| portal-admin | `共 4 条 10条/页 1 前往 页` | 同 | 同 | **中文** |
| kb-web-users | `共 1 条 10条/页 1 前往 页` | 同 | 同 | **中文** |
| kb-ops-users | `共 1 条 …` | 同 | 同 | **中文** |
| infra-users | `共 1 条 …` | 同 | 同 | **中文** |
| cosmic-admin | `共 1 条 …` | 同 | 同 | **中文** |

⇒ **重新部署后，5 个应用分页文案全部为中文，且 3 个时点完全稳定**（排除「渲染时序」解释）。

### 5.3 ⚠️ 为什么两个快照不同 —— 前端在本阶段执行期间被重新部署
`docker inspect` 实测各 web 容器启动时间（UTC→CST +8）：

| 容器 | 启动时间（CST） | 是否落在本阶段窗口 |
|---|---|---|
| **portal-web** | **2026-09-18 09:29:38** | ✅ 是 |
| **kb-web** | **2026-09-18 09:32:49** | ✅ 是 |
| **infra-monitor-web** | **2026-09-18 09:34:40** | ✅ 是 |
| kb-ops-web | 2026-09-17 03:34 | 否 |
| cosmic-web | 2026-09-16 09:18 | 否 |

- 快照一（08:43）在**部署前**，快照二（09:41+）在**部署后** ⇒ portal / infra 的英文→中文变化**由重新部署引起**，而非测量误差。
- **结论**：
  1. 工程师判断对 **portal / infra** 的英文描述，**只对 08:43 之前的状态成立**。
  2. **kb-web 在 08:43 就已实测为中文** ⇒ 工程师「kb-web 英文」的判断**至少在本阶段的观测窗口内不成立**（无法排除 kb-web 在更早已被单独部署修复）。
  3. 重新部署后（截至 09:50），**5 应用分页文案已统一为中文**。
- **建议**：这是「移动靶」。请在工程师**修复冻结**后，再由 QA 对分页文案做一次**定格复测**，方能给出最终 D2 结论。

### 5.4 空态文案（未直接观测，标注为推断）
证据：`evidence/d2-empty.json`、`d2-empty-v1.json`
- 尝试在表格搜索框（placeholder `搜索用户名 / 邮箱 / 昵称`）输入不存在关键字并点「查询」以制造空结果，但**实测表格行数未变化、`.el-table__empty-text` 始终为 null** ⇒ 未能直接观测到空态（搜索未生效，脚本问题 T-15）。
- **推断（非直接观测）**：Element Plus 的分页文案与空态文案来自**同一个 locale 包**，故空态语言**跟随分页语言**。按快照二，当前 5 应用的**空态文案应为中文（`暂无数据`）**。
- **未覆盖边界**：空态文案的**直接**证据本轮未取得。

---

## 6. 未覆盖边界（不猜）
1. **kb-ops 独立登录通道**（登录页无账密表单，仅邮箱验证码）⇒ kb-ops 的 S2/S3/S4 **N/A**。
2. **邮箱验证码登录通道**（需真实收件箱）——未覆盖。
3. **主动改密 / 忘记密码**——按纪律禁止探测，未覆盖。
4. **空态文案直接证据**——搜索筛选未生效，未直接取到（见 §5.4）。
5. **并发规模**仅 2 个浏览器实例（符合命题），未做 >2 并发压测。
6. **kb-web 在 08:43 之前**的分页状态无法追溯（容器已被重启覆盖）。

---

## 7. 夹具还原自检
| 项 | 处置 | 结果 | 证据 |
|---|---|---|---|
| 临时账号 `qa-ms-c1`(485) | 经 portal 管理台「删除」墓碑 | ✅ `deleted=1` | 见 `_cleanup` 证据 / DB 复查 §7.1 |
| `admin`(1) | 未改动 | ✅ `deleted=0` | DB 复查 |
| `qa-ms-u2`(477) | **非本次创建，未改动** | ✅ `deleted=0` | DB 复查 |
| 密码 / 配置 / 代码 | 全程未改 | ✅ | 未触碰任何改密端点；未修改任何配置或代码 |
| 浏览器 cookie / localStorage | 全部隔离在 `/root/qa-ms/profiles/<RUN>-*` | ✅ | 不影响真实浏览器 |

### 7.1 DB 复查（清理后，`marschat_auth`）
```
user:           470 v2r8re59e  deleted=1    477 qa-ms-u2   deleted=0（非本次创建，未改动）
                484 qa-ms-m1    deleted=1    485 qa-ms-c1   deleted=1  ← 本次夹具，已墓碑
oauth2_authorization principal_name=485 → 12 行（残留，同报告一 P2-2 既有行为）
sys_user_role user_id=485 → 0
```
- ✅ 本次夹具 `qa-ms-c1`(485) 已墓碑（`deleted=1`）；`admin`(1) / `qa-ms-u2`(477) 未改动。
- ⚠️ 同报告一 **P2-2**：删除用户不清 `oauth2_authorization`，485 残留 **12 行**（既有产品行为，非本次引入）。
- 备注：`cleanup_user.py` 首次执行即完成墓碑；随后 QA 为核对重跑了一次清理脚本，第二次因目标已删除而报 `TARGET NOT FOUND`（属正常，非缺陷）。

---

## 8. 本阶段新增的「测试脚本缺陷」（**与产品缺陷严格区分**）
| # | 缺陷 | 表现 | 根因 | 修复 |
|---|---|---|---|---|
| **T-10** | `Tab` 类缺少 `wait_load/drain/pump/list_buttons` | `run_s8.py` S8c 第二页签登录时崩 `AttributeError: 'Tab' object has no attribute 'wait_load'` | 同浏览器第二页签的 `Tab` 类未实现 Browser 的等待/列举接口 | 给 `Tab` 补齐同名委托方法（`cdp.py`） |
| **T-11** | `APPS` 注册表缺 `kb-ops` | 逐应用矩阵跑 kb-ops 时崩 `KeyError: 'kb-ops'` | `lib_qa.APPS` 未收录 kb-ops | 补 kb-ops 条目（`kb_ops_access_token`/`kb_ops_token_kind`） |
| **T-12** | 一条 ssh 内用 `A & B & C &` 串联多个后台任务 | 仅第一个任务起得来，其余静默不启动 | 非交互 shell 下 `&&` 与 `&` 的优先级/子 shell 语义（`cd X && cmd &` 会把整条 `cd && cmd` 后台化） | 每个后台任务**单独一次 ssh** 启动 |
| **T-13** | infra 身份映射优先取 `sub` | infra SSO 用例被误判 FAIL | `identity_js` 写 `o.sub \|\| o.username`，而 infra access token 的 `sub="1"`（用户 ID）优先于 `username="admin"` | 改为 `o.username \|\| o.sub`，并同时输出 `sub/uid` |
| **T-14** | 登录瞬断导致假 ERROR/假 FAIL | portal S5、infra S1/S2 偶发 `login failed`（空白页 / 输入框未渲染） | SPA 渲染时序 + 并发负载下偶发首屏空白 | ①独立登录前加「等待选择器出现（含一次重载）」；②登录失败时**换新 profile 重试一次**；③结果**逐用例增量落盘**（避免后续崩溃丢结果） |
| **T-15** | 空态探针选错搜索框 | 未制造出空态，`empty_text` 恒为 null | 启发式优先命中了页面的**全局搜索框**（`搜索系统...`/`搜索文件、笔记...`）而非**表格**搜索框 | 改为优先匹配含「用户名/昵称/邮箱」的输入框；本轮仍未生效，列为未覆盖 |

> ⚠️ 上表中 **T-13、T-14 曾一度产生「产品缺陷」形态的假信号**（infra S1–S5 全 FAIL、portal S5 ERROR）。这正是历史上最易误判的一类，**必须与产品缺陷严格区分**。

---

## 9. 产物清单
```
C:\Users\13871\WorkBuddy\2026-09-06-22-47-35\verify\multisession\
├── qa-coverage-report.md                本报告
├── evidence\
│   ├── appmatrix-portal.json            portal S1–S5
│   ├── appmatrix-kb-ops.json            kb-ops S1–S5（S2/S3/S4=N/A）
│   ├── appmatrix-infra.json             infra S1–S5
│   ├── appmatrix-cosmic.json            cosmic S1–S5
│   ├── s8.json                          S8a/S8b/S8c
│   ├── d2-locale.json                   D2 分页（快照一 08:43）
│   ├── d2-pager.json                    D2 分页（快照二 09:41+，多时点）
│   ├── d2-empty.json / d2-empty-v1.json D2 空态（搜索未生效）
│   └── （第一阶段证据：matrix-*.json / s7*.json / referrer.json / ui-review*.json）
├── shots\                               d2b-*-empty.png / s8-*.png / <case>{A,B}-final.png
└── scripts\
    ├── run_app_matrix.py                逐应用矩阵（APP= / ONLY= 切换，含重试与增量落盘）
    ├── run_s8.py                        S8 同源跨应用
    ├── d2_locale.py / d2_pager_probe.py / d2_empty.py   D2 文案
    └── cdp.py / lib_qa.py               驱动与配置（本阶段有修复）
```

### 复跑方式（在 mykng 上）
```bash
cd /root/qa-ms
# 逐应用矩阵（portal / infra / cosmic）：
QAPWD=<admin口令> NEWU=qa-ms-c1 NEWP=<口令> RUN=xx APP=portal WAIT=70 \
  python3 -u scripts/run_app_matrix.py
# kb-ops（S2/S3/S4 自动 N/A）：
... APP=kb-ops ...
# 单用例重跑：
... APP=portal ONLY=S5 ...
# S8：
... RUN=s8 python3 -u scripts/run_s8.py
```
> `RUN=` 必须每次唯一（避免 profile 复用）。

---

## 10. 给下游的三句话
1. **多会话隔离的结论在 5 个应用上一致成立**：两个不同浏览器并发登录同一账号**不互踢、不串号**（本阶段新跑 17 PASS / 3 N/A / 0 FAIL），后端 SSO 行为不受前端部署影响。
2. **P1-1（legacy 会话不启动 sessionWatcher）跨应用复现**：portal/infra/cosmic 全部 0 探针 —— 修共享库一处即可覆盖多应用。
3. **本阶段是「移动靶」**：前端容器在测试期间被重新部署，`kb-web` 分页文案与工程师判断不符，且部署后 5 应用分页文案已统一为中文 —— **请在修复冻结后重测 D2 与 P1-1**，再定最终结论。
