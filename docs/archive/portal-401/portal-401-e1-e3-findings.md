# portal 并发同账号 401 —— E1 / E3 只读实验结论（附录）

> 归属：架构师（software-architect）｜执行机：mykng(192.168.31.105)｜工作目录：`/root/diag-401/`
> 时间：2026-09-18 13:33–13:48 CST｜口径：`verify/design/portal-401-diagnosis.md` §4.2 **E1 / E3 原文定义**
> 授权：主理人「更正我编造的引用，授权真实 E0/E2 口径」——E1 ✅、E3 ✅；**只读**，不改代码/配置、不重启、不触发流水线。
> 与主诊断的关系：本文是 `portal-401-diagnosis.md`（结论已冻结）与 `portal-401-e2-e4-findings.md` 的**补充证据**，不推翻其结论。

---

## 0. TL;DR

| 实验 | 结果 | 一句话 |
|------|------|--------|
| **E3（身份守卫判别，S3/S4）** | ✅ 有效（0 died） | **S3 失败时 `/portal/api/auth/sso/exchange` 根本没被发出**，浏览器停在 `/portal/auth/callback?code&state`；同时 `/auth/session` 仍返回 `authenticated:true, username:"1"` ⇒ **与 401 无关、与 `consumeState` 400 无关**，落在守卫/回调链路（F9 链路 B）。 |
| **E1（真并发 vs 同 profile 多 tab）** | ⚠️ 仅试点（N=1/组，且 indep 组被污染） | 同 profile 双 tab **未**被踢（token 轮换但 tab1 读共享新 token）；indep 组 B 侧登录失败、数据不可用 ⇒ **不足以判定**，需要 N≥10 重跑才能下结论。 |

**对 D-1/D-2 的影响**：E3 进一步坐实"硬踢/落登录页"的主因是**非 401 的守卫链路**；E2 已证 9/9 无 401。**"共享槽踩踏(F8)"是否是真凶仍未被直接证实**（E5 未授权）——**D-1/D-2 仍是正确的承接位**（D-1 覆盖非 401 的静默重授权；D-2 收敛槽失败分类），但**根因定格（F8 vs 守卫）宜在 D-1/D-2 落地后由 E0 采样日志闭环**。

---

## 1. 方法论与 harness 修正（本轮新增，价值独立于结论）

在 mykng 用 headless chromium + CDP 驱动（复用 QA 的 `cdp.py`），端口 9601/9602/9603，**与 QA 的 9487 及 QA 脚本的 `pkill -9 -x chromium` 冲突**——本实验的清理一律按 **profile 路径**作用域（`pkill -f "user-data-dir=/root/diag-401/profiles"`），不触碰 `/root/qa-ms/profiles`。

### 1.1 修正的两个 harness 缺陷（【已证实】）

1. **`Network.getResponseBody` 作用域错误（-32601 / -32000）**
   - 现象：E3/E3b 抓 exchange 响应体时一律报
     `{'code': -32601, 'message': "'Network.getResponseBody' wasn't found"}`。
   - 根因：命令被发到 **browser 作用域**（`session=None`），而 `requestId` 属于**页面 session**。
   - 修正（E3c）：`b._send_session("Network.getResponseBody", {"requestId": rid}, b.session)`。
   - ⇒ **这直接解释了此前"E3 抓不到 body"**，也说明 QA 的 `cdp.py::session_bodies()` 存在**同类缺陷**（`self.body(rid)` 走 browser 作用域）——**建议 QA 侧同步修**。
2. **SSO 入口按钮偶发落空**
   - 现象：登录页刚加载时 `list_buttons()` 可能瞬时为空 ⇒ 回退默认文案 `统一认证登录（SSO）` ⇒ `click_text` 精确匹配必失败（E3b 的 S4-02、以及更早 E2-mixed 都栽在这）。
   - 修正（E3c）：轮询等待 SSO 入口（`"SSO" in t or "统一认证" in t`）出现后再点，最多 15s。
   - 效果：E3c **0 died**（此前 E3 6/6 died、E3b 2/4 died）。

### 1.2 实验脚本（mykng `/root/diag-401/scripts/`）
`e1.py`（E1）｜`e3.py`/`e3b.py`/`e3c.py`（E3 三版，e3c 为修正终版）｜`e2v2.py`（E2，含 `BrowserHdr` 头捕获）｜`cdp.py`
runner：`/root/diag-401/run_e13.sh`（E1+E3b）、`/root/diag-401/run_e3c.sh`（E3c）；口令取自 QA 既有 fixture（`export QAPWD=<REDACTED-PWD>`，见 `qa-ms/scripts/diag_matrix_variants.sh:8`），未新增任何凭证。

---

## 2. E3 结论（身份守卫判别，针对 S3/S4）

### 2.1 变体定义（§4.2 原文）
- **S3** = A(S **SSO**) / B(legacy)，失败方 A，`reload A`；
- **S4** = A(legacy) / B(**SSO**)，失败方 B，`reload B`。

### 2.2 结果（E3c，N=2/变体，0 died）

| 变体 | iter | prepA | prepB | target | reload 后落点 | token | kind | **exchange 是否发出** |
|------|------|-------|-------|--------|--------------|-------|------|----------------------|
| S3 | 1 | T | T | A | `/portal/` | true | oidc | —（无需，PASS） |
| S3 | **2** | F | T | A | **`/portal/auth/callback?code=…&state=…`** | **false** | null | **❌ 未发出** |
| S4 | 1 | T | T | B | `/portal/` | true | oidc | —（PASS） |
| S4 | 2 | T | F | B | `/portal/admin` | true | oidc | —（PASS） |

**汇总**：S3 = **1 FAIL / 2**；S4 = **0 FAIL / 2**；died=0。

### 2.3 判据落地（对照 §4.2 E3 的三条判据）

| §4.2 判据 | 本次观测 | 判定 |
|-----------|----------|------|
| exchange 返回 `code:400 "SSO 状态无效或已过期"` ⇒ `consumeState` 单次性/竞态 | **未观测到**（失败时 exchange 根本没发出；此前 E3b 的 S3 里 exchange 曾返回 **200**） | ❌ 排除（本次口径下） |
| exchange **根本没被发出** ⇒ 守卫直接 `bffAuthorizeUrl` 跳走（`main.ts:65-67`） | **S3-02 命中**：落 `/portal/auth/callback`、token=false、`/sso/exchange` 缺席 | ✅ **命中** |
| `/auth/session` 体（`{authenticated, username}`）与 `localStorage.portal_auth_uid` 比对 | **PASS 用例**：`/auth/session` = `{"code":200,"data":{"authenticated":true,"username":"1"}}`，`auth_uid="1"` **一致** | ✅ 一致 |

### 2.4 【已证实】
1. S3 失败时 **`/portal/api/auth/sso/exchange` 未出现在捕获集**（`e3c.json` S3-02.net 仅含 `/auth/session`×2）——**不是** `consumeState` 400 分支。
2. 失败时浏览器**停在 `/portal/auth/callback?code=…&state=…`**，`portal_token=null`、`kind=null`（即回调组件未完成落 token）。
3. **`/auth/session`（SLO 探针）在 SSO 侧失败期间仍 `authenticated:true, username:"1"`** ⇒ **IdP 会话并未失效**；`probe.username` 返回的是 `sub`（`"1"`），非本地登录名 `admin`——与主诊断报告 §3 的观察一致。
4. **全程无 `/portal/api/**` 返回 401**（E3c `after` 无 `hard_kick`，net 无 401）⇒ S3 的失败**与硬踢 401 不是同一条链路**。

### 2.5 【推测（未定格）】
- S3 的**具体触发时序**（为何"姊妹是 legacy"时 SSO 侧才会失败）仍未定格：E3b 与 E3c 两次 S3 失败形态**不一致**（E3b：exchange 200 后落 `/portal/login`；E3c：exchange 缺席、停在 callback）⇒ 强烈提示是**竞态/守卫链路**而非确定性 401。
- 是否等价于主诊断 **F9 链路 B / 身份守卫**：**高度一致但未直接采样守卫分支**（需 E0 采样日志才能断言）。
- **S4 与旧矩阵的出入**：`portal-401-diagnosis.md` 记 S4（B→T0 即 offline）为失败，本轮 S4 **2/2 PASS**。可能因 **09:29 portal-web(D1) 重建**改变了行为，或旧记录为抖动。⇒ **列为待澄清项**，不建议据此改写主报告。

---

## 3. E1 结论（真并发 vs 同 profile 多 tab）——仅试点，不下结论

### 3.1 结果（N=1/组）

| 变体 | 观测 | 判定 |
|------|------|------|
| **a 独立 profile** | `a_login`：`/portal/` token=true（A 登录成功）→ `B_login`：`/portal/login` **token=false（B 登录失败）** → `a_before`：A 变为 `/portal/login` token=false → `a_after`（reload A）：**`https://auth.marschat.online/login.html`** token=false；`/portal/api` **401=0** | **数据被污染**，不可用 |
| **b 同 profile 双 tab** | `t1_login` `/portal/` token=true → tab2 再登录 → `token_changed=true` → `t1_after`（reload tab1）：**`/portal/` token=true kind=legacy**；401=0；**未被踢** | 双 tab **未失败** |

### 3.2 【已证实】
- **同 profile 双 tab（共享 localStorage）在本实验下未被踢**：tab2 重登换发新 token 后，tab1 reload 读到的是**共享 localStorage 里的新 token**，`kind` 仍 `legacy`，401=0。
- 独立 profile 组的 **B 侧 legacy 登录失败**（`/portal/login` token=false），使该组**无法作为"两个独立会话"的干净对照**。

### 3.3 【推测 / 待澄清】
- 按 §4.2 E1 判据（"仅 a 失败 ⇒ 跨浏览器并发；b 也失败 ⇒ 共享 localStorage 相关"）：本试点更像"**与共享 localStorage 无关**"，**但 a 组污染 + N=1**，**不足以判定**。
- 需要：**N≥10/组**、且 **B 侧登录成功**（加断言门槛：只有 A/B 两侧都 `token=true` 的迭代才计入）才能给结论。

---

## 4. 对修复方案（D-1/D-2）与待决事项的影响

1. **D-1/D-2 承接位不变**：E3 证明"落登录页/落回调"主因是**非 401 的守卫/回调链路**，而 D-1 正是把前端 401 分支拆成"OIDC→静默重授权 / legacy→登录页"，D-2 收敛服务端槽失败分类。E3 不构成对 D-1/D-2 的否定。
2. **"硬踢 401" 的真凶仍需 E0 才能定格**：E2 9/9 无 401 + E4b 唯一真 401 是 `iss/typ` 不符 ⇒ **硬踢更像"token 归属/混合通道"问题而非"共享槽"**。**F8(共享槽)未被直接证实**，E5 未授权。⇒ **建议**：E0（JwtInterceptor 采样日志：uri+有无 Authorization+token 前 12 字符+失败原因）**并入 D-1/D-2 的 portal-server 发版**一次性闭环，避免再来一轮只读实验。
3. **可观测性缺口确认**（支撑 E0）：`writeUnauthorized("未登录或登录已过期")` 分支**当前不打日志**，故"未登录"计数为 0 只代表该分支无日志，不代表未发生。
4. **给 QA 的衍生发现**：`qa-ms/scripts/cdp.py::session_bodies()` 同样把 `getResponseBody` 发到 browser 作用域 ⇒ **其抓到的 `/auth/session` 体可能一直是空的**（同类 -32601）。建议 QA 侧修正后复核历史结论。

---

## 5. 证据文件索引（mykng）

| 文件 | 内容 |
|------|------|
| `/root/diag-401/evidence/e1.json` | E1 原始结果（indep/same 各 1 次） |
| `/root/diag-401/evidence/e3b.json` | E3b 原始结果（S3-02 见 exchange 200；2 died） |
| `/root/diag-401/evidence/e3c.json` | **E3 修正终版结果（0 died，含 body）** |
| `/root/diag-401/run_e13.out`、`run_e3c.out` | 运行器整段日志 |
| `/root/diag-401/scripts/{e1,e3b,e3c}.py`、`run_e13.sh`、`run_e3c.sh` | 可复跑脚本 |

本机副本：`verify/_e2/{e1,e3b,e3c}.py`、`verify/_e1e3b.json.txt`、`verify/_e3c.json.txt`、`verify/_e1e3b*.txt`。

---

## 6. 复现命令

```bash
# 在 mykng
export QAPWD=<REDACTED-PWD>
cd /root/diag-401/scripts
N=10 python3 -u e1.py     # E1（建议 N>=10 且加"两侧皆 token=true"断言）
N=2  python3 -u e3c.py    # E3（修正终版）
```

---

## 7. 未决 / 交主理人

| # | 事项 | 我的建议 |
|---|------|----------|
| Q1 | E1 是否补跑 N≥10 以给 S2 一个干净判定 | 建议**补跑**，但优先级低于把 D-1/D-2 推向落地；也可在 D-1/D-2 落地后作为回归顺带做 |
| Q2 | E0（JwtInterceptor 采样日志）是否并入 D-1/D-2 发版 | 建议**并入**——否则"硬踢真凶(F8 vs 守卫)"永远只有推测 |
| Q3 | S4 与旧矩阵结论出入（本轮 2/2 PASS） | **不据此改主报告**，登记为待澄清；若要定格需固定版本重跑旧矩阵 S4 |
| Q4 | QA `cdp.py::session_bodies()` 同类缺陷 | 建议 QA 修正后复核其历史"抓不到 body"类结论 |
