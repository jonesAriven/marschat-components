# 笔三 · portal-server 401/拒绝路径采样日志规格（E0 落地版）

> 归属：架构师｜**服务对象：D-2（portal-server）**，随 D-2 **同一次发布**，**不单独部署/不单独重启**
> 状态：规格（待工程师按仓库实际行号实施）｜口径来源：`portal-401-diagnosis.md` §4.2 E0，经主理人追加授权项修订
> ⚠️ 本 addendum **不改 D-1 段**（D-1 只动 portal-web，已由工程师开工）。

---

## 0. 目的（一句话）

把"硬踢 401 / 拒绝跨应用 token"从**只能看到 HTTP 状态**，升级为**服务端可断言的失败原因**，从而一次性定格 **F8（共享槽踩踏）** vs **身份守卫/混合通道**——这是当前唯一缺失的那根线。

---

## 1. 授权边界（主理人裁定，硬约束）

| 项 | 规则 |
|----|------|
| 允许记录 | `uri`、**有无 Authorization**、实际 `iss`、`typ`、`alg`、失败原因分类、**`sha256(token)` 前 8 位十六进制** |
| **严禁记录** | **原始 token**；**任何可读前缀**（如"token 首 12 字符"——**原 §4.2 E0 的"首 12 字符"写法作废，一律以 sha256 指纹替代**） |
| 级别 | **WARN**；**仅拒绝时**打印；**禁止逐请求 INFO**（避免日志暴涨） |
| 发布 | 随 **D-2** 同发；**不单独部署、不重启** |
| 覆盖 | **必须同时补 `JwtInterceptor` 里当前"不打日志"的那条 401 分支**（`writeUnauthorized("未登录或登录已过期")`，即报告所指 `JwtInterceptor.java:57` 一带）——**这才是真缺口**；只补 `拒绝跨应用 token`（`:42`）不够 |

### 1.1 为什么"覆盖 :57 分支"是重点
- 现状：`拒绝跨应用 token`（iss/typ 不符）**已有 WARN**；但 **"无 Bearer / 验签失败"** 走的 `writeUnauthorized(...,"未登录或登录已过期")` **当前完全不打日志**。
- 后果：`docker logs | grep 未登录` 计数为 0 **只代表该分支无日志**，**不代表未发生** ⇒ 这是**可观测性缺口**，不是"没发生"的证据。

### 1.2 为什么用 `sha256(token)` 前 8 位
- 不可逆、输入高熵 ⇒ 不泄露凭证本体、也不是"可读前缀"；
- 却能**把"客户端 CDP 抓到的 token"与"服务端拒绝的 token"对上**——正是 E2/E4b 缺的那根关联线。
- 实现：`sha256(token).hexdigest()[:8]`；对同一 token 稳定，可用于跨端比对。

---

## 2. 埋点位置（**行号已按当前在跑 jar 反编译核对**）

> 核对方法（只读）：`docker cp portal-server:/app/portal-server.jar` → 提取 `BOOT-INF/classes/com/kb/portal/{config/JwtInterceptor,util/JwtUtil,config/WebMvcConfig}.class` → `javap -p -c -l` 读 **LineNumberTable**。
> 核对对象 = **当前在跑镜像（`kb-app-portal-server:latest`，build `2026-09-18T00:11:55+08`）**，非 `/opt/portal-server`（那是 7 月的旧部署目录，**已废弃、不反映现状**）。

### 2.1 `JwtInterceptor.java` —— **实测行号**
| 行 | 代码（实测） | 说明 |
|----|--------------|------|
| 36–39 | `getHeader("Authorization")` → null 判 → `startsWith("Bearer")` → `substring(7)` | 取 token |
| **41** | `jwtUtil.validateToken(token)` | `false` ⇒ 跳 **57** |
| **42** | `log.warn("拒绝跨应用 token：uri={} 签名可验但签发方/类型不匹配（疑似其他应用签发或轮换前的老 token）", uri)` | **既有 WARN —— 就是这里追加字段** |
| 43 | `uri` 实参 | — |
| **44** | `writeUnauthorized(response, "token 签发方不合法，请重新登录")` | iss/typ 不符时的 401 响应体文案 |
| 47–53 | `setAttribute(userId/username/role)` | 放行前 |
| **57** | `writeUnauthorized(response, "未登录或登录已过期")` | **当前完全不打日志的 401 分支（真缺口）** |
| 62–65 | `writeUnauthorized(...)` 方法体（`setStatus(401)` / `setContentType` / `writer.write`） | — |

> ⚠️ **重要修正**：原规格提到的"`:61-65` 分支"实为 **`writeUnauthorized` 方法体(62-65)**；**要补日志的 401 分支是 `:57`**。两者不是一回事，实施时别搞混。
> 且 `:42` 的 `{}` 占位符**只有 uri 一个实参** ⇒ 该 WARN **永远不含任何 token 信息**（原样证实"硬编码、看不到 iss/typ"）。

### 2.2 `JwtUtil.java` —— **实测行号**（供工程师定位）
| 行 | 方法 | 关键语义（实测） |
|----|------|------------------|
| 64–70 | 构造器 | `signer = JWTSignerUtil.hs256(secret.utf8)`；`expireTime = expireHours*3600*1000`；**`issuer = blank? "marschat-portal" : issuer`** |
| 80–94 | `validateSecret` | 拒绝 null/blank；**拒绝历史共享密钥 `<REDACTED-LEGACY-JWT-SECRET>`**；要求 **≥32 字节** |
| 101–113 | `generateToken(userId,username,role?)` | payload：`userId/username/**iss=issuer**/**typ="portal"**/role?/exp=now+expireTime/iat`；HS256 签名 |
| 118–132 | `parseToken` | `JWTUtil.verify(token,signer)` 且解析；**有 exp 且已过期→null；无 exp→接受**（漏洞面） |
| 184 | `validateToken` | `parseToken(token)!=null` |
| **144–152** | `isIssuedByPortal` | `jwt=parseToken; iss=getPayload("iss"); typ=getPayload("typ"); return iss!=null && issuer.equals(iss) && **typ!=null** && "portal".equals(typ)` |

> **⇒ 关键推论**：`isIssuedByPortal==false`（即 `:42` 分支）成立的**充要条件**是：**签名在 portal 密钥下可验**（因 `:41` 已过），但 `iss≠issuer` **或 `typ` 缺失/≠"portal"**。**注意 `typ` 缺失也会命中**。

### 2.3 `WebMvcConfig.java` —— **实测拦截范围**
- `addPathPatterns`：`/api/sys/**`、`/api/auth/userinfo`、`/api/auth/logout`、`/api/auth/change-password`、`/api/auth/permissions`、`/api/admin/**`
- `excludePathPatterns`：`/api/auth/login`、`/api/auth/sso/**`、**`/actuator/**`**
> 与冻结报告一致，**新增确认**：`/actuator/**` 亦被排除。

---

## 3. 字段规格（结构化，与现有 logback JSON 对齐）

沿用现有 JSON 日志字段风格（见容器日志样例：`@timestamp/@version/message/logger_name/thread_name/level/traceId/APP_NAME/service`），在 `message` 内或作为附加字段输出：

| 字段 | 取值 | 隐私 |
|------|------|------|
| `event` | `portal_jwt_reject`（固定） | — |
| `reason` | `NO_BEARER` \| `BAD_SIGNATURE` \| `EXPIRED` \| `ISSUER_MISMATCH` \| `TYPE_MISMATCH` | 低 |
| `uri` | 请求 URI（已脱敏，不含 query 里的敏感值） | 低 |
| `has_auth` | `true/false` | 低 |
| `iss` / `typ` / `alg` | 解析所得（无法解析时 `null`） | 低 |
| `token_fp` | `sha256(token).hexdigest()[:8]`；无 token 时 `null` | **合规（不可逆指纹）** |
| `reject_branch` | `interceptor`（L1/L2 命中） | 低 |

### 3.1 样例（示意）

```
WARN portal_jwt_reject reason=NO_BEARER uri=/portal/api/auth/permissions has_auth=false iss=null typ=null alg=null token_fp=null
WARN portal_jwt_reject reason=ISSUER_MISMATCH uri=/portal/api/sys/system/all has_auth=true iss=marschat-infra typ=portal alg=HS256 token_fp=3f9a1c2b
WARN portal_jwt_reject reason=BAD_SIGNATURE uri=/portal/api/sys/system/all has_auth=true iss=marschat-portal typ=portal alg=HS256 token_fp=77de01aa
```

> ⚠️ 注意：**`iss`/`typ` 值本身由服务端解析得出，不是引用现有硬编码文案**。现有 WARN 文案（"疑似其他应用签发或轮换前的老 token"）是**固定字符串**、**不反映真实 iss/typ** —— 这正是必须新增字段的原因。

---

## 4. 判定表（E0 产出后如何定格）

| 观测（L1/L2 汇总） | 结论 |
|--------------------|------|
| `reason=ISSUER_MISMATCH/TYPE_MISMATCH` 且 `iss` 恒为某**非 portal** 值（如 infra/gateway/kb） | **混合通道 token 归属问题**（F7 类）⇒ 与 D-1 的通道拆分一致；**F8 不成立** |
| `token_fp` 与客户端 CDP 抓到的 token **能对上**、且该 token 由 portal 自己签发但 `typ` 缺失/异常 | **签发侧 typ 缺口** ⇒ 定位于 portal token 铸造，而非消费侧 |
| `reason=BAD_SIGNATURE` 占比高 | **密钥不一致**（需再查 `PORTAL_JWT_SECRET` 是否多值/漂移） |
| `reason=NO_BEARER` 有量 | **C1 前端 token 窗口** ⇒ 由 D-1 的前端分支修复承接 |
| 7 次命中里 `token_fp` 各不相同、且**只在测试窗口出现** | 佐证"测试夹具自触发"（见 ⑤ 结论） |

---

## 5. 回滚 / 风险

- 纯日志新增，**无行为变更**；回滚 = 恢复该文件旧版本，随 D-2 正常回滚即可。
- WARN 仅拒绝时触发 ⇒ 量级 ≈ 失败次数（当前 7 次/日），**不会涨日志**。
- **不含任何可读凭证** ⇒ 无日志泄露风险。

---

## 6. 待澄清 / 交主理人

| # | 事项 |
|---|------|
| Qa | ~~行号无法核对~~ **已解决**：mykng 无源码树，但可用 **当前在跑 jar 反编译的 LineNumberTable** 核对（见 §2）；`JwtInterceptor.java:41/42/44/57`、`JwtUtil.java:64-70/80-94/101-113/118-132/144-152/184` **均已实测**。工程师实施时可再与仓库源码对一次 |
| Qb | 若工程师希望**一次到位**，建议顺带把 `reason` 枚举抽成常量类，便于后续告警聚合（非必须） |
| Qc | E0 产出的**首日**建议由我或 QA 拉一次 `docker logs` 汇总 `reason` 分布，回填冻结报告的"待澄清 Q3" |
