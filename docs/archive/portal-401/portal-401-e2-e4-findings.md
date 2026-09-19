# portal 401 · E2 / E4-E4b 只读实验实测结果（新增证据，不改定稿结论）

| 项 | 值 |
|---|---|
| 对应 | 主理人授权：**E2（最高优先）+ E4 + E4b**（口径 = `portal-401-diagnosis.md §4.2` 原文） |
| 执行人 | 架构师 高见远（software-architect） |
| 性质 | **纯只读**：未改任何代码/配置/数据；未重启；未触发流水线；未写 QA 目录 |
| 执行环境 | mykng `192.168.31.105`（Debian13）；chromium 150 headless + 原生 CDP；工作目录 **`/root/diag-401/`**；CDP 端口 **9601/9602**（QA 用 9487 段，隔离） |
| 与定稿关系 | **不修改** `portal-401-diagnosis.md` 任何结论；本文是新增实测证据 |

---

## 0. TL;DR（三条硬结果）

1. **【E2】报告 §4.2 口径的 E2（A/B 重登 → 只 reload A → reload 前抓包）在实测中【未复现】任何真 401**：**9/9 有效轮次全部 `NO401`**，A 全程在线、B 全程未被触碰。⇒ **C1（无 Bearer 的前端 token 窗口）在本场景下不可复现**。
2. **【E4b】但真 401 确实发生过**：portal-server 日志近 24h 内 **`拒绝跨应用 token`（`iss`/`typ` 不匹配分支）命中 4 次**，**全部落在 `uri=/portal/api/sys/system/all`**（09:19:08 / 09:51:57 / 10:53:29 / 10:57:57）。**⇒ "服务端真 401 的最后一环"由服务端锚点闭合：发射分支 = `iss/typ` 不匹配，而非"无 Bearer"。**
3. **【E4/密钥比对】历史成因"与 infra-monitor 共用密钥"已被证伪**：portal / infra / gateway 三把 HS256 密钥 **互不相同**（密钥分离已落地）。⇒ 那 4 次 401 的 token **不是 infra 的**；其确切来源**仍未定**（日志不记录 token 的 iss/typ，需 E0 —— 未授权）。

---

## 1. E2 实测（口径 = 报告 §4.2 原文）

**方法**：`A 登录(legacy) → B 登录(同账号; legacy 或 sso) → 只 reload A，B 全程不动`；
**抓包在 reload 之前即开启**（`Network.enable` 常开，`Network.requestWillBeSent` **额外捕获 `request.headers.Authorization`** —— 这正是 QA 的 `cdp.py` 遗漏之处，也是他们"抓不到 401"的直接原因）；
判据：401 且无 Authorization→C1；401 且 `iss≠marschat-portal`→C2；无 401 却落回调页→C3。

| 变体 | 有效轮次 | 结果 | A 落点 | B |
|---|---|---|---|---|
| `legacy-legacy`（=报告 E2 / 矩阵 S2 通道） | **6/6** | **ALL `NO401`** | 恒 `…/portal/`，`token:true`，`kind:legacy`，无 `?reauth=1`、无 callback | 全程未变 |
| `sso-legacy`（=矩阵 S3/S4 通道） | 3/3（第 3 轮因 SSO 按钮未渲染作废，非服务端 401） | **ALL `NO401`** | 同上 | 全程未变 |

**首轮冒烟**（N=2, legacy-legacy）亦 2/2 `NO401`。

**判读**：
- **"重登 + reload"本身不产生真 401**；带合法 `portal_token` 的请求经 `JwtInterceptor` **必然放行**（与报告 F5 一致）。
- ⇒ 报告 §3.3 的 **C1 前提不成立**（本场景），且 **F8 共享槽竞态产出的不是真 401**（F8 只经 `callAsUser` 返回 HTTP **200** + `code:401`）——实测与之自洽。

**证据文件**（mykng `/root/diag-401/evidence/`）：
`e2v2-legacy.log`、`e2v2-mixed.log`、`e2v2-legacy-legacy.json`、`e2v2-sso-legacy.json`、`e2-smoke.log`（v1）。脚本：`/root/diag-401/scripts/e2.py`、`e2v2.py`（v2 抗"实例被外部杀死"：被杀即重启并记 `died`）。

> ⚠️ 执行期冲突登记：v1 于 13:04 在 iter2 被 `websockets ConnectionClosedError` 中断，**根因是 QA 脚本里的全局 `pkill -9 -x chromium` 连带杀掉本实验实例**（v2 已改为被杀即重启，9/9 有效）。已就此直接与 QA 协调（改用按端口/PID 限定）。

---

## 2. E4 / E4b 实测（只读 `docker logs`）

### 2.1 portal-server：真 401 锚点（`拒绝跨应用 token`）

```
count = 4   （近 24h）
09:19:08.317 uri=/portal/api/sys/system/all  签发方/类型不匹配（iss/typ）
09:51:57.559 uri=/portal/api/sys/system/all
10:53:29.368 uri=/portal/api/sys/system/all
10:57:57.423 uri=/portal/api/sys/system/all
```
- 该 WARN 由 `JwtInterceptor.java:42` 打出：**验签通过但 `isIssuedByPortal()` 为假**（`JwtUtil.java:143-152`：要求 `iss==marschat-portal` 且 `typ==portal`）。
- 时间戳落在 QA 矩阵/诊断的运行窗内；URI 是 portal 启动即打的系统列表（受保护路径 `/api/sys/**`）。
- **`未登录` 计数 = 0**：**注意**——"无 Bearer / 验签失败"分支**当前不打日志**（`JwtInterceptor.java:57` → `writeUnauthorized` 无 log），故 count=0 **不能**说明该分支没发生；它只是**不可观测**。这正是报告 Q3 方向 D-3 与 E0 的动机。

### 2.2 portal-server：`AuthCenterService`（D-2 路径实况）

```
03:33:29 / 04:45:53 / 08:46:57  auth-center token 请求失败: 400 {"error":"invalid_grant"}
08:46:57                        SSO 会话已失效，请重新统一登录
```
- 证实 `refreshAccessToken` 的失败→`refreshTokens.remove(userId)` 链路**在真实运行中触发过**（`AuthCenterService.java:132`）——即 **F8 的"共享槽被清空"确有发生**；D-2 的目标语义（仅"中心明确拒绝"才清槽）针对的正是这条。

### 2.3 auth-center（旁证，非本次目标）
- 存在 `refresh_token` 表 + `SsoCookieUtil` 写 `sso_refresh_token` Cookie（domain=marschat.online，maxAge=604800s）。
- 见 `kb-web` SSO 回调 `error=invalid_request: code_challenge`（QA 造 URL 缺 PKCE），与 portal 401 **无关**。

---

## 3. 密钥分离核验（只读，值已 redact）

| 容器 | `JWT_SECRET`/`PORTAL_JWT_SECRET` sha256（前 12 位） | 说明 |
|---|---|---|
| **portal-server** | `95dbcb714d52…` | `PORTAL_JWT_SECRET` |
| infra-monitor | `1579449c2525…` | 与 portal **不同** |
| kb-gateway | `92712b1a3014…` | 与二者**都不同** |
| kb-ops | `e3b0c44298fc…`（= 空串 sha256） | 该容器 `JWT_SECRET` 为**空** |

**⇒ 结论**：`portal` 与 `infra` 的密钥**已分离**，报告 F2 注释里"轮换前共用密钥"的历史成因**对本次 4 次 401 不成立**。
⇒ 那 4 次 401 的 token **是"能用 portal 当前密钥验过签、但 iss/typ 不是 portal 期望值"** —— 由于**只有 portal-server 用该密钥签发且始终写 iss/typ**，其确切来源**无法由日志判定**（须 E0 记录 token 的 iss/typ，未授权）。

---

## 4. 测试 profile 的 token 版图（只读扫描 `/root/qa-ms` + `/root/diag-401`）

| count | alg | iss | typ | sub/username |
|---|---|---|---|---|
| 101 | RS256 | https://auth.marschat.online | — | 1 |
| 77 | RS256 | https://auth.marschat.online | — | admin |
| **55** | **HS256** | **marschat-portal** | **portal** | admin |
| **20** | HS384 | — | — | admin |
| 9 / 9 | RS256 | auth.marschat.online | — | qa-ms-m1 / 484 |
| 7 | HS384 | — | — | 1 |
| 6 / 6 | RS256 | auth.marschat.online | — | qa-ms-c1 / 485 |
| **1** | **HS256** | **marschat-portal** | **portal** | qa-ms-c1 |
| … | … | | | |

- **现存 HS256 全部是合法 portal token**（`marschat-portal|portal`）；**未见** HS256-无-iss 的"非法 portal token"。
- HS384（无 iss/typ）= **auth-center legacy** token；RS256 = OIDC token。二者**都不是**触发 WARN 的形态（前者签名算法/密钥不同，后者 alg 不同）。
- ⇒ 触发 WARN 的那个 token **不在现存 profile 里**（很可能已被后续登录覆盖）；即**一次性/瞬态**。

---

## 5. 对报告结论的影响（诚实边界，主理人可据此调整修法范围）

| 报告中的判断 | 本次实测后的状态 |
|---|---|
| "真 401 的最后一环**无法用现有证据闭合**"（§3.3） | **部分更新**：服务端锚点已给出**发射分支 = `iss/typ` 不匹配**（4 次），**但**具体 token 来源仍未定 ⇒ **有观测、未定位**。 |
| C1（前端无 Bearer 窗口）可能是 401 来源 | **未复现**（E2 9/9 无 401）⇒ 本场景下**不是**。 |
| C2（iss 不符 / 轮换前老 token） | **形态被证实存在**（WARN 即此分支）；但"infra 共用密钥"成因**被证伪**；来源待 E0。 |
| C3（S3/S4 = 身份守卫链路，与 401 无关） | **被间接支持**：S3/S4 通道（sso-legacy）在 E2 下亦 0 个真 401。 |
| F8 共享槽是"同账号才触发"的唯一解释（§3.2） | **需要重新评估**：F8 产出的是 HTTP **200**+`code:401`（不硬踢）；而唯一观测到的真 401 是**token 归属**问题 ⇒ **F8 可能是"硬踢"症状的红鲱鱼**。 |
| D-1（前端续期语义）/ D-2（共享槽） | **仍值得做**（D-1 治硬踢可见症状、D-2 治共享槽），但**优先级依据需修正**：硬踢更像**token 归属/陈旧 token**问题，D-1 的"静默重授权"恰能承接这类硬踢。 |

---

## 6. 建议下一步（待主理人定）

1. **E3（已授权，最相关）**：抓 SSO 回调页的 `POST /auth/sso/exchange` 响应体 + `/auth/session` 响应体，与 `portal_auth_uid` 比对 ⇒ 直接定性 S3/S4（C3 是否成立）。
2. **E0**（未授权）：若要把"4 次 iss/typ 401 的来源"钉死，**唯一**手段是落 token 的 iss/typ 到日志；按裁定**并入 D-1/D-2 的 portal-server 那一次发布**做，不单独部署/重启。
3. **修法范围复核**：鉴于"硬踢"更像 **token 归属/陈旧 token** 而非并发共享槽，建议主理人复核 D-1/D-2 的**优先级与充分性**（是否需补"前后端一致地拒绝/清理异源 token"）。

---

## 7. 证据索引

| 位置 | 文件 |
|---|---|
| mykng `/root/diag-401/scripts/` | `e2.py`（v1）、`e2v2.py`（v2 抗杀）、`jwt_scan.py`；`cdp.py`（QA 副本，本地、只读基线） |
| mykng `/root/diag-401/evidence/` | `e2-smoke.log`、`e2v2-legacy.log`、`e2v2-mixed.log`、`e2v2-legacy-legacy.json`、`e2v2-sso-legacy.json` |
| 本工作区 `verify/_e2/` | 上述日志/JSON 的本地副本 + `jwt_scan` 输出 |
| 本工作区 `verify/` | `_e4_logs.txt`（portal-server/auth-center 日志摘录）、`_e4_keys.txt`（密钥 sha256） |

*本文仅为实测证据记录，未改动任何代码、配置或线上数据；定稿诊断 `portal-401-diagnosis.md` 结论保持原样。*
