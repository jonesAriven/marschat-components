# 缺陷独立登记：portal 并发同账号 · 混合通道下门户 shadow 会话被收敛

| 项 | 值 |
|---|---|
| 缺陷标题 | **portal 并发同账号 · 混合通道下门户 shadow 会话被收敛** |
| 登记人 | 架构师 高见远（software-architect） |
| 来源 | 定稿诊断 `verify/design/portal-401-diagnosis.md` §F9 链路 B（S3/S4 独立拆分） |
| 关系 | **与 S2「真 HTTP 401 硬踢」是两条不同链路**；S2 由 **D-1 + D-2** 覆盖，本缺陷**独立跟踪**，不由 D-1/D-2 闭合 |
| 严重级 | 高（用户可见：SSO 会话被踢回登录页 / 卡在回调页） |
| 状态 | 待主理人确认（含一项证据待提供，见 §5） |
| 约束 | 只读登记；未改任何代码/配置/数据 |

---

## 1. 现象

portal 两个浏览器**并发登录同一账号**时，其一失败并被"踢"回登录页或卡住。**仅 portal 复现**，kb-web / infra-monitor 同矩阵全过。

## 2. 触发条件（实测）

| 维度 | 值 |
|---|---|
| 账号 | **同一账号**（admin），两浏览器 |
| 通道 | **混合通道**：一为 **SSO（OIDC）**、一为 **独立/legacy（账密）** |
| 页面事件 | **至少一次 reload / 回跳**（no-reload 稳态不失败） |
| 通道组合对照 | SSO+SSO（S1）PASS；混合（S3/S4）FAIL；异账号（S5）PASS |

## 3. 失败落点（两类，本缺陷指"链路 B"）

| 用例 | A | B | 失败方落点 | 链路 |
|---|---|---|---|---|
| S2 | indep | indep | A → `/portal/login?reauth=1`（`token_present:false`） | **链路 A：真 HTTP 401 硬踢**（D-1/D-2 覆盖） |
| **S3** | **sso** | indep | A → `/portal/auth/callback?code=…&state=…` | **链路 B（本缺陷）** |
| **S4** | indep | **sso** | B → T0 即 offline，T1 仍在回调页 | **链路 B（本缺陷）** |

**链路 B 特征（与真 401 的关键区别）**：落点是 **SSO 回调页**且 `token_present:false`，**不需要一次真 401 即可到达**。与 `portal/src/main.ts:58-69` 的**身份一致性守卫**路径吻合：`sessionWatcher` 探到 IdP 会话仍 `authenticated=true`，但 `probe.username ≠ userStore.authUid` → `onIdentityMismatch` → `window.location.href = bffAuthorizeUrl(...)`（`main.ts:65-67`）→ 授权 → 回调 → `ssoExchange` 未成功 → 停在回调错误态（`SsoCallbackView.vue:43-47`）。

## 4. 与 D-1 / D-2 的关系（必须写清）

| 项 | 说明 |
|---|---|
| D-1（前端 401 续期语义） | 治**链路 A** 的可见症状（真 401 硬踢）。**不覆盖链路 B**（链路 B 无真 401）。 |
| D-2（后端共享 refresh 槽收敛） | 治 F8 的账号级共享槽竞态（同账号耦合点）。**是链路 B 的必要非充分条件**——它使"混合通道 + 同账号"成为唯一可复现组合，但链路 B 的最后一跳（守卫误判）**不由 D-2 直接闭合**。 |
| 结论 | **本缺陷需在 D-1/D-2 上线后单独验证**；若 S3/S4 仍 FAIL，则确证"守卫链路"是独立根因，须单独立项（见 §6 建议）。 |

## 5. 证据包（本工作区实际可核验）

| 证据 | 位置 | 说明 |
|---|---|---|
| 失败矩阵 | `verify/multisession/evidence/appmatrix-portal.json` | portal S1 PASS / **S2/S3/S4 FAIL** / S5 PASS，含失败方落点 |
| 复跑原始日志 | `verify/multisession/evidence/rerun3.log` | 矩阵 S1–S4 复跑；portal 失败方 URL 与 `token_present` |
| 分用例矩阵 | `verify/multisession/evidence/matrix-S3-S4.json`、`matrix-S1.json`、`matrix-S5-S6.json` | S3/S4 分项 |
| 稳态边界 | `verify/multisession/evidence/diag401.log` | **no-reload 60s pump：A/B 均 0 个 4xx** ⇒ 支撑"稳态不自发 401"（**注意：本文件不含 401 正样本**） |
| 双通道单会话回归 | `verify/multisession/evidence/reg-2ch.log` | 6 应用 SSO/独立**单会话**登录全 PASS（**非并发样本**；portal-indep 记 `uid: None`） |
| 源码锚点 | `main.ts:58-69`、`utils/sso.ts:61-67`、`SsoCallbackView.vue:43-47`、`stores/user.ts:11/30/59` | 守卫链路 file:line |

### ⚠️ 证据缺口（须主理人澄清）

裁定第 3 项要求附 **`Z-7`（"20 次重放 19 次 `code=401`"）**。经全工作区检索（pattern `Z-?7`）**无任何命中文件**；且现有 `diag401.log` 的内容恰是 **0 个 4xx**（与"19/20 = 401"相反）。可能来源：QA 在 mykng `/root/qa-ms/`（`reg_2ch.py` 的产物目录）生成、未落回本工作区。

**请主理人提供 `Z-7` 的实际文件/路径**；在拿到之前，本登记**不引用** `Z-7`，以免把"0 个 4xx 的稳态证据"误标为"401 正样本"。

## 6. 建议处置

| # | 建议 | 性质 |
|---|---|---|
| 1 | **本缺陷独立登记**（已完成），与 S2/链路 A 分开跟踪 | 立项 |
| 2 | D-1/D-2 上线后**复跑 S3/S4 x10**；若仍 FAIL → 确认守卫链路为独立根因 | 验证 |
| 3 | 若确认：修法方向 = 身份一致性守卫的**误判收敛**（`probe.username` 与 `authUid` 的口径对齐；`probe.authenticated=true` 但身份未变时**不触发**重授权） | 待立项 |
| 4 | 补一门**判别性实验**（定稿诊断 §4.2 **E3**）：抓 `/auth/session` 响应体与 `POST /auth/sso/exchange` 响应体，断定是"守卫直接跳走"还是"exchange 失败停在回调页" | 实验 |

---

*本文仅为缺陷登记，未改动任何代码、配置或线上数据。*
