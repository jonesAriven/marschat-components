# D1 上线后浏览器验证报告（V-A2 ~ V-A9）

- **验证人**：QA（Edward）
- **验证时间**：2026-09-18 13:04–13:31（CST，实测）
- **被测发布**：`auth-center` 分支 `main`，commit `f12cf2898aa74b7ae03ca53c9923f8715c70f3ec`
  - 运行时身份：容器 `auth-center`，镜像 `kb-app-auth-center`（build `2026-09-18 12:45:15 CST`），容器自 `12:45:29 CST` Up
  - 生效佐证：线上 `/login.html` 已含 `#backLink`；`/login-context` 返回 200（见 V-A1）
- **方法**：mykng（192.168.31.105）headless chromium + 原生 CDP（Node 24 `WebSocket`），**只读**（未建账号、未改代码/配置、未触发流水线）
- **基准文档**：`verify/design/architect-fix-plan.md` §2.6（用例定义）/ §2.4 A-5（returnTo 期望表）
- **断言合规**（README 四铁律）：① 精确匹配 `<button>` 全等文本 `登 录`；② 真实鼠标事件打在 `getBoundingClientRect()` 中心；③ 成功判据=落点 URL + 接口状态码 + 页面特征，不凭单点；④ **每用例前 `resetBuf()` 重置 console/network 缓冲**；`#backLink` 读数要求连续 3 次采样一致（不单点采样）
- **隔离**：每应用独立 `--user-data-dir` profile = 各自独立浏览器；`--host-resolver-rules` 把 `kb/ops.marschat.online` 钉到公网入口 `1.117.70.30`（绕开 mykng 本机 hosts 到 127.0.0.1 的旧钉法）
- **关键前提（PKCE）**：`clients.yml` 实读确认**仅 `marschat-portal` 为 confidential**，其余 6 个 client 均为 `public` → Spring Authorization Server 对 public client **强制 PKCE**。故除 portal 外，authorize URL 均带 `code_challenge=<S256>&code_challenge_method=S256`（否则 SAS 直接回 `sso-callback?error=invalid_request`）。

---

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| 6 应用 × V-A2/V-A3/V-A4/V-A6/V-A7 | **30/30 PASS** ✅ |
| V-A5（直连 login.html） | **PASS** ✅ |
| V-A9（tokenhub 非 SPA） | **PASS** ✅ |
| V-A8（多标签边界） | **符合登记预期**（R3 已知限制，不作失败）✅ |
| V-A1（端点liveness，补充） | **PASS** ✅ |
| **「新增返回入口后，原有 SSO 登录主链路是否完好」** | **完好（无回归）** ✅ |

**一句话**：D1 的只读 `GET /login-context` + `login.html` 返回入口**六应用全部按 §2.4 A-5 期望逐字命中**，且**主链路（直接账密登录自动续跑授权流）6/6 无破坏**；两处边界（tokenhub、多标签）行为与设计预期一致。

---

## 2. 六应用 × 用例矩阵

| 应用 | client_id | V-A2 构造authorize→落login.html+#backLink | V-A3 reload链接仍在 | V-A4 错口令→?error+双可见 | V-A6 点返回→停应用登录页 | V-A7 主链路→callback?code&state=v1 |
|---|---|---|---|---|---|---|
| portal | `marschat-portal` | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |
| kb-web | `marschat-kbweb` | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |
| kb-ops | `marschat-kbops` | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |
| infra-monitor | `marschat-inframon` | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |
| activecode | `marschat-activecode` | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |
| cosmic-studio | `cosmic-studio` | **PASS** | **PASS** | **PASS** | **PASS** | **PASS** |

**逐用例实测要点**（全部来自 CDP 实读，非合成）：

- **V-A2**：6 应用 authorize 均落 `https://auth.marschat.online/login.html`；`#backLink` `display:inline-flex`、`visible:true`、`stable:true`（3 次采样一致）；`appName` 与 clients.yml `name` 一致；`/login-context` 响应 **HTTP 200**。
- **V-A3**：`Page.reload{ignoreCache:true}` 后 `#backLink` 仍在且 `href` 不变 → 证明 SavedRequest 在登录页停留期间**未被中间请求消耗**（F4/R4 前提成立）。
- **V-A4**：6/6 提交错口令后 URL 均含 `?error`；`#err` `shown:true` `visible:true` 文本 `用户名或密码错误，请重试`；`#backLink` **同时可见**且 `href` 正确 —— 这正是用户最需要返回入口的时刻。
- **V-A6**：点击 `#backLink`（真实鼠标事件）后落点为**各应用自身登录页**，URL 含 `/login` 且**无 `auth.marschat.online`**（未被弹回 IdP）；页面含账密/登录表单。
  - ⚠️ 备注：kb-ops 落点 `/ops/login` 在抓取时刻 **无 `input[type=password]`**（该页登录卡片默认「账号/验证码」模式，含 `#username` 与 `登 录` 按钮）。**停靠应用登录页、未被弹回 IdP 的判据成立**，此为该页自身设计呈现差异，非 D1 缺陷。
- **V-A7**：6/6 在 V-A2 页面直接账密登录（`admin`/凭据）后**自动续跑授权流**，落 `…<回调>?code=…&state=v1`，`saved_request_survived:true`。**未观察到 `/portal/login?reauth=1`**（即 portal 并发 401 现象在本轮隔离登录上下文中未复现）。

---

## 3. returnTo 实测 vs §2.4 A-5 期望（逐字比对）

`#backLink` 的 `href` 与 `text` 均为 DOM `getAttribute('href')` / `innerText` 实读：

| 应用 | §2.4 A-5 **期望 returnTo** | 实测 `#backLink` href | 逐字一致 | 实测文案（`clientName` 逐字） |
|---|---|---|---|---|
| portal | `https://main.marschat.online/portal/login` | `https://main.marschat.online/portal/login` | **✅** | `← 返回「MarsChat Portal」登录页` |
| kb-web | `https://kb.marschat.online/kb/login` | `https://kb.marschat.online/kb/login` | **✅** | `← 返回「MarsChat KB Web (SPA)」登录页` |
| kb-ops | `https://kb.marschat.online/ops/login` | `https://kb.marschat.online/ops/login` | **✅** | `← 返回「MarsChat KB Ops (SPA)」登录页` |
| infra-monitor | `https://monitor.marschat.online/infra/login` | `https://monitor.marschat.online/infra/login` | **✅** | `← 返回「MarsChat Infra Monitor (SPA)」登录页` |
| activecode | `https://tools.marschat.online/activecode/login.html` | `https://tools.marschat.online/activecode/login.html` | **✅** | `← 返回「MarsChat ActiveCode (SPA)」登录页` |
| cosmic-studio | `https://cosmic.marschat.online/login` | `https://cosmic.marschat.online/login` | **✅** | `← 返回「MarsChat COSMIC Studio」登录页` |

**6/6 逐字命中**，含两处易错点均正确：
- kb-ops 与 kb-web **同 origin 靠前缀区分**（`/ops` vs `/kb`）→ 分别得到 `/ops/login`、`/kb/login`，未串台。
- activecode **保留 `.html` 后缀**（`/activecode/login.html`）。

---

## 4. 独立用例（V-A5 / V-A9 / V-A8 / V-A1）

### V-A5 直连 `/login.html`（新 profile，无 SavedRequest）— **PASS** ✅
- **本次实际访问 URL（可追溯）**：`https://auth.marschat.online/login.html`（无 SavedRequest）
- 落点 `https://auth.marschat.online/login.html`
- `#backLink`：`present:true` 但 `hidden:true` / `display:none` / `visible:false`（元素在但**不可见**）
- console 错误：`[]`；失败请求：`[]` → **无新增报错**
- 截图：`shots/d1-va59/VA5-direct.png`（干净登录页，无返回链接）

### V-A9 tokenhub（非 SPA）走 SSO — **PASS** ✅
- **本次实际访问 URL（可追溯，2026-09-18 补录重跑）**：

  ```
  https://auth.marschat.online/oauth2/authorize?client_id=marschat-tokenhub
    &redirect_uri=https%3A%2F%2Ftokenhub.marschat.online%2Fapi%2Fadmin%2Fauth%2Foauth%2Fcallback
    &response_type=code&scope=openid%20profile&state=v1
    &code_challenge=KDIDduBivIBAoBakLwzFHxD5cW7JzGNOzQoOdigxKKU&code_challenge_method=S256
  ```
- 落点 `https://auth.marschat.online/login.html`；`#backLink` `hidden:true` / `display:none` / `href:null` → **不显示返回链接**（深路径 `/api/admin/auth/oauth` 被 A-5 规则拒绝 → returnTo=null）
- console 错误：`[]` → 无报错
- 截图：`shots/d1-va59/VA9-tokenhub.png`
- 证据字段：`attemptedUrl` / `clientId` / `redirectUri`（见 `evidence/d1-result-va59.json`）——**与 V-A5 的可区分性已建立**（V-A5 的 `attemptedUrl` 是裸 `login.html`，V-A9 的是带 `client_id` + 深 `redirect_uri` + PKCE 的 authorize URL）

### V-A8 同一浏览器两标签 portal / kb-ops — **符合 R3 登记预期（不作失败）** ✅
- 先开 tab1=portal → 显示 `← 返回「MarsChat Portal」登录页`
- 后开 tab2=kb-ops → 显示 `← 返回「MarsChat KB Ops (SPA)」登录页`
- 回读 tab1（reload 后）→ 显示 `← 返回「MarsChat KB Ops (SPA)」登录页`
- **结论**：两标签都显示**后开那个**的应用名 → 与 §2.7 **R3** 描述完全一致（SavedRequest 为 session 级单例，LIFO 覆盖）。**登记为已知限制，不作为失败**。

### V-A1 端点 liveness（补充，只读）— **PASS** ✅
```
$ curl -s -w '%{http_code}' https://auth.marschat.online/login-context
{"code":200,"message":"success","data":null,"traceId":"f97dca6c3e9d4c9e8cfd7db5810f9fae"}
HTTP=200
```
- 无 SavedRequest 时返回 **HTTP 200 + `data:null`**（**不是 403/404**），与 §2.6 V-A1 期望逐字一致。
- 直连 `http://100.93.36.113:8085/login-context` 亦 200（后端直连可达）。

---

## 5. 回答 team-lead 核心问题

> **「新增返回入口后，原有 SSO 登录主链路是否完好？」**

**完好，无回归。** 依据：

1. **主链路 V-A7 6/6 PASS**：六个应用在带返回入口的登录页上直接账密登录，**仍自动续跑 OAuth 授权流**，落 `<应用回调>?code=…&state=v1`，`saved_request_survived:true`。返回入口的渲染/点击**没有消耗或污染** SavedRequest。
2. **无 SavedRequest 场景零污染（V-A5/V-A9）**：直连登录页与 tokenhub 非 SPA 场景下，返回入口**不可见**、console **零报错** —— 新增能力是 fail-soft 的（端点异常/无上下文时静默隐藏）。
3. **契约面未变**：D1 仅新增 1 个 `permitAll` 只读端点 + `login.html` 前端渲染，**未改任何既有端点/鉴权边界**；V-A6 落点均为应用登录页、未出现被弹回 IdP 或空白页。
4. **未观察到并发 401 复发**：本轮 V-A7 **未出现** `/portal/login?reauth=1`（portal 并发 401 属另一工作流范围，本轮隔离登录上下文未触发）。

---

## 6. 测试代码缺陷与修正（透明记录）

- **现象**：首轮全量运行中，V-A5 / V-A9 报 `{"error":"Assignment to constant variable."}`。
- **定性**：**测试脚本自身缺陷**（`const rec = {}` 后被重新赋值 `rec = {...}`），**非被测源码缺陷** → 按路由规则由 QA 自修。
- **修正**：两处 `const rec` → `let rec`，重跑 `D1ONLY=VA5,VA9`，**均 PASS**。
- **影响面**：仅 V-A5 / V-A9 两个独立块；6 应用矩阵块未受影响（其 `rec` 从未被重新赋值），首轮矩阵结果有效。
- 之后为保护全量结果，子集重跑输出到独立目录 `/root/d1-evidence-va59`，未覆盖 `/root/d1-evidence`。

---

## 7. 观察 / 待留意（非失败）

1. **kb-ops V-A7 出现第二次回调**：nav 序列为 `login.html → /ops/sso-callback?code=…&state=v1 → /ops/sso-callback?code=…&state=<SPA自生成state> → /ops/dashboard`。
   - 首回调 `state=v1`（我方注入）已满足 V-A7 判据（`saved_request_survived:true`）；SPA 因 `state` 非其 sessionStorage 内自生成值而**重新发起一次自己的授权流**并最终落 `/ops/dashboard`（登录成功）。
   - **判定为测试注入态产物，非缺陷**（真实用户由 SPA 自行发起授权，其自有 state 与之一致，不会二次发起）。其余 5 应用无此现象。
2. **portal V-A7 终态停在 callback URL**：本用例判据只要求「到达 `…/callback?code=…&state=v1`」，已满足；SPA 侧 code 交换由应用自身完成，非 D1 契约面，未纳入本轮断言。
3. **kb-ops 应用登录页无 `input[type=password]`**（见 §2 备注）——应用页设计差异，建议由应用侧确认是否符合预期，与 D1 无关。

---

## 8. 证据清单（可复核）

| 证据 | 路径 |
|---|---|
| 全量结果 JSON（6 应用 + V-A8） | `verify/multisession/evidence/d1-result.json` |
| V-A5/V-A9 子集结果 JSON（含 `attemptedUrl` 可追溯字段，2026-09-18 重跑） | `verify/multisession/evidence/d1-result-va59.json` |
| 6 应用 V-A2 截图 | `verify/multisession/shots/d1-full/VA2-{portal,kbweb,kbops,infra,activecode,cosmic}.png` |
| 6 应用 V-A4 截图（错误态+返回链接） | `verify/multisession/shots/d1-full/VA4-*.png` |
| 6 应用 V-A6 截图（返回落点） | `verify/multisession/shots/d1-full/VA6-*.png` |
| 6 应用 V-A7 截图（主链路） | `verify/multisession/shots/d1-full/VA7-*.png` |
| V-A5 / V-A9 截图 | `verify/multisession/shots/d1-va59/VA5-direct.png`、`VA9-tokenhub.png` |
| 验证脚本（可复跑） | `verify/multisession/scripts/d1_verify.mjs`（mykng `/root/d1_verify.mjs`） |
| 原始日志 | `verify/multisession/tmp/full_run.txt`、`va59.txt`、`va1.txt` |

**复跑命令**（只读）：
```bash
# 全量
D1PWD=<口令> node d1_verify.mjs /root/d1-evidence
# 子集（如 V-A5/V-A9）
D1PWD=<口令> D1ONLY=VA5,VA9 node d1_verify.mjs /root/d1-evidence-va59
```

---

## 9. 路由决策

- **Send To: NoOne** —— D1 功能验证 6 应用全部按基准命中，主链路无回归；无源码缺陷需回流 Engineer。
- 已知限制（R3 多标签覆盖）已在 §4 V-A8 登记，符合设计预期。
- 本轮唯一缺陷为 QA 测试脚本自身（§6），已自修并复验通过。

---

## 10. 结项后修订记录（team-lead 复核反馈闭环，2026-09-18）

D1 验收通过并关闭后，team-lead 提出 4 项收尾，已全部落地：

| # | 事项 | 处置 | 落地位置 |
|---|---|---|---|
| 1 | PKCE 前提"沉淀进脚本注释，别让后人重踩" | 已写进 `d1_verify.mjs` 的 `PUBLIC_CIDS` 上方注释，显式点名历史症状 `invalid_request: code_challenge` | `verify/multisession/scripts/d1_verify.mjs`（`PUBLIC_CIDS` 定义前） |
| 2a | 全局 `pkill -9 -x chromium` → 按 PID/`--user-data-dir`/端口限定 | **已改**。4 个脚本的 5 处全局 kill 全部改为 `for p in $(pgrep -f "user-data-dir=/root/qa-ms/profiles/<TAG>"); do kill -9 "$p"; done`（`rg2`/`rgp`/`rgm`/qa-ms 根）；同步安装到运行副本 `/root/qa-ms/scripts/`（改前已备份 `/root/qa-ms/.bak-d1scoped-20260918/`），`bash -n` 全过 | `rerun_3apps.sh:11,16`、`diag_portal_s2.sh:12`、`diag_matrix_variants.sh:11`、`after_batch_diag.sh:8`（本地 + mykng 双份） |
| 2b | `cdp.py` 补 `request.headers.Authorization`（只存前 12 字符）+ `responseReceived.status`，且在导航前 `Network.enable` | **已改** `requestWillBeSent` 分支新增 `authorization: auth[:12]`（`Authorization`/`authorization` 兼容），并在 `responseReceived` 记录里回填同字段；`status` 与"导航前 `Network.enable`"**原本已具备**（`_connect()` 在 attach 时即 enable，先于任何 `goto`）。已过 `python3 -m py_compile`，同步到 `/root/qa-ms/scripts/cdp.py` | `verify/multisession/scripts/cdp.py` `_event()`（`ResponseReceived` / `requestWillBeSent` 两分支）+ 模块 docstring |
| 3 | V-A5/V-A9 证据不可追溯 | **已改并重跑**：两条用例的 `rec` 新增 `attemptedUrl`（V-A9 另含 `clientId`/`redirectUri`/`note`）；重跑 `D1ONLY=VA5,VA9` 均 PASS，`evidence/d1-result-va59.json` 已刷新 | 见 §4；旧版本另存 mykng `/root/d1-evidence-va59-v1` |
| 4 | `verify/multisession/` 根目录 ~70 个 `_*.txt` 垃圾 | **已清理**：78 个 `_*` 文件（77 `.txt` + 1 `.html`）全部移入 `verify/multisession/tmp/legacy-root/`；根目录现仅剩 4 个 `qa-*.md` 报告 | `verify/multisession/tmp/legacy-root/` |

> 2a 的**执行期背景**：该全局 kill 曾于 13:04 连带杀掉架构师 `/root/diag-401` 的 E2b 实验实例（见 `design/portal-401-e2-e4-findings.md` 冲突登记）；本次按 profile 锁 PID 后，二者可安全并行。
> 待命：按 team-lead 指令，**暂不再跑 portal 并发矩阵**（避免与架构师 E2b 抢资源 / 污染日志关联）；D-1/D-2 修复发布后由本人以 fresh-eyes 做独立验证。
