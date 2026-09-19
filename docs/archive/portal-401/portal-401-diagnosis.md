# portal 并发同账号「401 被踢」— 只读根因诊断

| 项 | 值 |
|---|---|
| 任务 | #7（只读根因诊断） |
| 执行人 | 架构师 高见远（software-architect） |
| 约束 | **只读**：未改任何代码 / 配置 / 数据库，未重启任何服务，未触发任何流水线 |
| 诊断对象 | portal（`main.marschat.online/portal`）两个浏览器并发**同账号**登录后其一被硬踢回登录页 |
| 上游证据 | `verify/multisession/`（QA 严过关 的回归报告与全部诊断日志） |
| 产出 | 本文件 |

## 源码快照（读源码时的 commit，按主理人要求记录）

| 仓库 | 本地路径 | HEAD | 说明 |
|---|---|---|---|
| devtools（portal 前后端所在） | `D:\huliang\java\ideaworkspace\devtools` | **`83aad09`** `83aad09612940994befcf1cdad6a6591102eacc7`（2026-09-18 09:25:39 +0800，Element Plus 中文包修复） | **本报告所有 portal 前后端 file:line 以此快照为准** |
| auth-center | `D:\huliang\java\ideaworkspace\auth-center` | **`f12cf28`** `f12cf2898aa74b7ae03ca53c9923f8715c70f3ec`（2026-09-18 12:35:46 +0800，`feat: IdP 登录页新增「返回应用独立登录页」入口（GET /login-context）`） | 该 HEAD **已包含 D1 提交**（见 §6①）；D1 与本次 401 诊断**无关**，本报告**未**把 D1 当作既有逻辑 |
| marschat-components（共享组件库） | `D:\huliang\java\ideaworkspace\marschat-components` | （读文件快照）`@marschat/auth-components@0.8.8`、`common-core`、`auth-core` | 见 §2 的 `GlobalExceptionHandler` / `RequirePermissionInterceptor` |

> ⚠️ 本文严格区分 **【已证实】**（有源码 file:line 或实测证据文件支撑）与 **【未证/假设】**（推理，需实验定格）。QA 报告里的"任何 API 返回 401"这一表述在代码层面**不精确**，见 §2 F2/F3。

---

## 0. TL;DR

1. **【已证实】硬踢只由"真 HTTP 401"触发，不由"业务 401"触发。** portal 前端 `request.ts` 的**成功分支**把 `body.code!==200` 当普通业务错误 `reject`（不跳转）；只有**错误分支**的 `error.response.status === 401`（真 HTTP 状态码）才会 `clearSession()` + 硬跳 `/portal/login?reauth=1`。→ F1。
2. **【已证实】portal-server 全仓唯一能产出"真 HTTP 401"的位置只有 `JwtInterceptor`**（`SC_UNAUTHORIZED` 全仓仅此一处）。其余"401"要么是 `BusinessException(401)` → **HTTP 200** 体 `{code:401}`，要么是权限不足 `@RequirePermission` → **HTTP 403**。→ F2/F3/F4。
3. ⇒ **触发硬踢的那次请求，一定是"没带合法 `portal_token`"**：要么 `Authorization` 头缺失，要么 token 不能被 portal 的 HS256 密钥验签 / `iss`≠`marschat-portal`。**"合法且存在的 portal_token 不可能被 JwtInterceptor 拒"**。→ F5。
4. **【已证实】触发条件是"两个浏览器 + 同账号 + 至少一次页面 reload"**，**与 70s 空闲 / 60s 权限缓存 TTL 无关**（WAIT=0 也 FAIL、WAIT=70 也 PASS；无 reload 的 80s 时间线全程 0 个 4xx）。→ F6。
5. **【已证实】只在 portal 复现**：kb-web / infra-monitor 同矩阵 S1–S4 全过。差异在**前端会话续期实现**：portal 是「BFF + 自签 HS256 + **被动 401 硬跳**」，kb-web 是「auth-center RS256 + 主动 `/auth/session` 探针 + **refresh/静默重授权重试**」。→ F7。
6. **【已证实】同账号两个 portal 会话唯一共享的服务端状态是 `AuthCenterService.refreshTokens`**（`Map<Long,String>`，**以 portal 用户 id 为键的进程内单槽**）——这是"为什么必须**同账号**"的唯一账号级耦合点。→ F8。
7. **【未证/假设】** "服务端因并发同账号而返回 401"的**最后一环**（具体是哪个请求、为何该请求没带合法 token）**目前没有一条实测证据**：QA 自己的 no-reload 诊断记录了 **0 个 4xx**，而失败的那几次**从未导出网络明细**。→ §3（Q2）给出定格实验。
8. **【建议】** 最小正确修法 = **portal 前端对齐 kb-web 的续期语义（不再无脑硬跳）+ portal 后端收敛 `refreshTokens` 共享槽 + 补 401 观测日志**；**不建议**为此动 auth-center（12 应用枢纽）。→ §4（Q3）。

---

## 1. 任务与问题复述

主理人给定的事实与待答问题：

- **现象**：portal 两个浏览器并发登录**同一账号**后，其一被硬踢回登录页；**仅 portal 复现**；**仅"一 SSO + 一独立"混合通道**在早期表述中被标为 FAIL（实测更宽，见 §2 F6/F9）。
- **Q1（最关键）**：服务端到底为什么返回 401？**为什么"混合通道"才触发、同通道不触发？**（含 file:line）
- **Q2**：判定 QA 结论的可信度，并给出**判别性实验**设计。
- **Q3**：最小正确修法方向 + 改动面清单。
- **顺带确认**：① Fix A（IdP 返回入口）在 auth-center 侧我是否实施过；② Fix B 的 `fixed="right"` 是否为仓库既有、随本次重建首次部署。

---

## 2. 事实基座（已证实，附 file:line / 证据文件）

### F1 【已证实】portal 前端：**只有真 HTTP 401 才硬跳**，业务码 401 不跳

文件：`devtools/portal/src/api/request.ts`

```ts
// 成功分支（HTTP 2xx）—— 业务码判定，绝不跳转
(res) => {
  const result = response.data
  if (result && result.code === 200) return result.data
  return Promise.reject(new Error(result?.message || '请求失败'))   // ← 业务 401 走这里：只 reject
},
// 错误分支（HTTP 4xx/5xx）—— 只有这里会硬跳
(error) => {
  const userStore = useUserStore()
  if (error.response?.status === 401) {          // ← :48 真 HTTP 状态码
    userStore.clearSession()                     // ← :53
    ElMessage.error('登录已过期，正在重新认证…')
    window.location.href = '/portal/login?reauth=1'  // ← :56 硬跳
  } else {
    ElMessage.error(error.response?.data?.message || error.message || '请求失败')
  }
  return Promise.reject(error)
}
```

**推论 A**：`?reauth=1` 只能由 `request.ts:56` 产生 ⇒ 失败浏览器 URL 里出现 `?reauth=1`（S2 的 A，见 F9）**就是"确实发生了一次真 HTTP 401"的硬证据**（业务 401 不产生该标记；`?slo=1` 由会话监视器产生，语义不同）。

**推论 B**：QA 报告 §7.2 "**任何 API 返回 401** → 硬跳"**表述不精确**——它把"HTTP 200 体内 `code:401`"也算进去了，而后者在 portal 前端**不会**硬跳。这直接决定了下一条。

### F2 【已证实】业务异常 401 → **HTTP 200**（不是 HTTP 401）

文件：`marschat-components/java/common-core/src/main/java/com/marschat/common/exception/GlobalExceptionHandler.java:34-38`

```java
@ExceptionHandler(BusinessException.class)      // ← 注意：没有 @ResponseStatus
public Result<?> handleBusiness(BusinessException e, HttpServletRequest req) {
    log.warn("业务异常 [{}]: {}", req.getRequestURI(), e.getMessage());
    return Result.fail(e.getCode(), e.getMessage()).withTraceId(MDC.get("traceId"));
}
```

对比：同类里 `MethodArgumentNotValidException`/`NoResourceFoundException`/`HttpMessageNotReadableException` 等都带 `@ResponseStatus(...)`（:41/:59/:81），**唯独 `handleBusiness` 没有**。

**后果（关键）**：portal-server 里这些"401"全部是 **HTTP 200 + `{"code":401,...}`**，**不触发硬踢**：

| 位置 | 代码 | 实际 HTTP 状态 |
|---|---|---|
| `AuthCenterService.callAsUser` 无 SSO 会话 | `AuthCenterService.java:260-262` 返回 `ProxyResult(401,"无统一认证会话")` → `SsoController.toResult`（`SsoController.java:279-293`）抛 `BusinessException(401)` | **200** |
| `AuthController.userinfo` 无有效 token | `AuthController.java:185` `throw new BusinessException(401, "未登录或登录已过期")` | **200** |
| `NotLoginException`（common-core 专用 401 异常） | `NotLoginException.java:6-9` extends `BusinessException(401,…)` | **200** |

### F3 【已证实】接口级鉴权失败 → **HTTP 403**（不是 401）

文件：`marschat-components/java/auth-core/src/main/java/com/marschat/auth/authz/RequirePermissionInterceptor.java:46-49`

```java
response.setStatus(HttpServletResponse.SC_FORBIDDEN);   // 403，不是 401
response.getWriter().write("{\"code\":403,\"message\":\"当前账号无权限执行此操作\",\"data\":null}");
```

portal 侧实现 `PortalPermissionChecker.java:98-102` 在"无 SSO 会话（fail-closed）"时返回 `false` → 由上面的拦截器统一出 **403**。⇒ 权限问题**不可能**造成硬踢。

### F4 【已证实】portal-server **唯一**的真 HTTP 401 发射点 = `JwtInterceptor`

- 全仓 `SC_UNAUTHORIZED` 仅一处：`devtools/portal/portal-server/src/main/java/com/kb/portal/config/JwtInterceptor.java:62`
- 注册范围：`config/WebMvcConfig.java:16-25`

```java
registry.addInterceptor(jwtInterceptor)
    .addPathPatterns("/api/sys/**", "/api/auth/userinfo", "/api/auth/logout",
                     "/api/auth/change-password", "/api/auth/permissions", "/api/admin/**")
    .excludePathPatterns("/api/auth/login", "/api/auth/sso/**", "/actuator/**");
```

```java
// JwtInterceptor.preHandle
if (authHeader != null && authHeader.startsWith("Bearer ")) {
    String token = authHeader.substring(7);
    if (jwtUtil.validateToken(token)) {
        if (!jwtUtil.isIssuedByPortal(token)) {           // ← :41 归属性校验
            log.warn("拒绝跨应用 token：uri={} …", request.getRequestURI());   // ← :42 服务端可观测锚点
            writeUnauthorized(response, "token 签发方不合法，请重新登录");      // ← :44
            return false;
        }
        … return true;
    }
}
writeUnauthorized(response, "未登录或登录已过期");          // ← :57 无 Bearer / 验签失败
return false;
```

**⇒ 能触发硬踢的请求集合被收窄为**：`/api/sys/**`、`/api/auth/userinfo`、`/api/auth/logout`、`/api/auth/change-password`、`/api/auth/permissions`、`/api/admin/**`，且该请求在发出时 `Authorization` **缺失 / 不可验签 / 签发方非 portal**。

> 注意 `/api/auth/sso/**`（含 `sso/authorize`、`sso/exchange`）**被排除** ⇒ 回调页的换票请求**不可能** 401；若它失败只会抛异常让回调页停在错误态（见 F9 第二类落点）。

### F5 【已证实】合法且存在的 `portal_token` 不会被 `JwtInterceptor` 拒绝

文件：`devtools/portal/portal-server/src/main/java/com/kb/portal/util/JwtUtil.java`

- HS256；密钥来自 `portal.jwt.secret`（env `PORTAL_JWT_SECRET`），**无默认值**，`validateSecret()`（:79-94）对"缺失 / 命中已泄露共享密钥 / <32 字节"启动即抛。
- 签发写入 `iss=marschat-portal`、`typ=portal`（:96-114）；`isIssuedByPortal()` 比对二者（:143-152）。
- 有效期 24h（`portal.jwt.expire-hours:24`）。

**⇒ 结论**：对"本地持有 portal_token 的正常请求"，`JwtInterceptor` **必然放行**。因此那次真 401 只可能是：
**(i) `Authorization` 头根本没带**（前端 store token 为空却仍发 axios 请求），或
**(ii) 带了 token 但不可验签 / `iss` 非 `marschat-portal`**（异应用 token、或密钥轮换前的老 token）。

这两者在代码路径上都**不是"服务端主动使会话失效"**——portal 侧是**纯无状态**（无会话表、无 refresh 轮换、无 tokenVersion）。

### F6 【已证实】触发条件：两个浏览器 + 同账号 + **至少一次页面 reload**；与空闲/缓存 TTL 无关

证据文件：`verify/multisession/evidence/{rerun3.log, diag401.log, diag_timeline.log, diag_variants.log, portal-s2-diag.log}`，来自 QA 报告 §7.3 的 5 组对照。

| 实验 | 是否含页面 reload | 结果 |
|---|---|---|
| `rerun3.log` 标准矩阵 S2（login→login→T0 双 refresh→70s→T1 双 refresh） | **是** | **FAIL**（A→reauth） |
| `diag_matrix_variants.sh` S2 **WAIT=0** | **是** | **FAIL**（A 在 T0 即 offline） |
| `diag_matrix_variants.sh` S2 **WAIT=70** | **是** | **PASS** |
| `diag_portal_401.py` login→login→pump 60s | **否** | PASS（**0 个 4xx**） |
| `diag_portal_timeline.py` login→login→pump 80s 每 5s 采样 | **否** | PASS（**全程 0 个 4xx**） |
| `diag_portal_reload.py` login(A)→reload(A)→login(B)→reload(A)→reload(B) | 是 | PASS（单次样本） |

**⇒ 两条硬结论**：
1. **"不含 reload 的诊断 0 个 4xx"** ⇒ 稳态（纯空闲）**不会**自发产生 401；失败与"页面生命周期事件（reload / 回跳）"绑定。
2. **WAIT=0 也 FAIL、WAIT=70 也 PASS** ⇒ QA 报告 §7.4① 与 §7.2 里"60s 权限缓存 TTL 失效竞态"的嫌疑**被其自身实验证伪**，不能作为根因。

### F7 【已证实】只在 portal 复现，差异在"前端续期实现"

`rerun3.log`：kb-web 4/4 PASS、infra 4/4 PASS、**portal S1 PASS / S2 FAIL / S3 FAIL / S4 FAIL**。

| 维度 | portal | kb-web（`devtools/mykng/kb-web/src/api/index.ts:98-162`） |
|---|---|---|
| 会话 token | **自签 HS256** `portal_token`（BFF 换票） | auth-center **RS256** access token |
| 401 处理 | 无白名单、无 `_retry`、无 refresh → **直接清会话硬跳** | 白名单 → `isOidcToken()` 静默重授权 / refresh 轮换 → `_retry` 重放并发请求 → 失败才 `router.push('/login')` |
| SLO 探测 | **运行期不发** `/auth/session` 探针（仅 `isOidcToken()` 时起 `sessionWatcher`） | 主动探针 + 身份一致性守卫 |

**⇒** 若同一"服务端/时序"异常发生在 kb-web，其前端会**静默自愈**（`renewByReauthorize` 秒回新 code），用户无感；在 portal 则**一次 401 即硬踢**。⇒ **"只有 portal 表现为被踢"部分源于前端策略差异，而不是"只有 portal 服务端会 401"**。

### F8 【已证实】同账号两会话唯一共享的服务端状态：`AuthCenterService.refreshTokens`

文件：`devtools/portal/portal-server/src/main/java/com/kb/portal/service/AuthCenterService.java`

```java
/** portal 用户 id -> refresh_token */
private final Map<Long, String> refreshTokens = new ConcurrentHashMap<>();   // ← :66 以【账号】为键、进程内单槽
```

| 动作 | 位置 | 说明 |
|---|---|---|
| 写入 | `storeRefreshToken` `:137-141`（调用点 `SsoController.java:71`，**仅 SSO exchange 路径**） | legacy 登录**不写**（`AuthController.login` 全程不碰 `refreshTokens`）；邮箱码登录也不写（`SsoController.java:70` 注释） |
| 读取/消费 | `refreshAccessToken` `:118-135` | 被 `callAsUser`（`:259-272`，`/auth/permissions`）与 `callAdmin`（`:209-243`，`/admin/**`）调用 |
| **删除（共享槽被清空）** | `:132`（refresh 失败）与 `:222`（SSO 身份反复 401） | **任一会话失败即把该账号的槽清空，影响另一会话** |

**⇒ 这是"为什么必须**同账号**"的唯一账号级耦合点**（数据模型上确实存在"两个会话同 `userId` 分桶 → 竞态"的结构性缺陷，与 QA 报告 §7.4① 的直觉一致）。**但见 §3 的诚实边界：它本身产出的不是"真 HTTP 401"。**

### F9 【已证实】失败浏览器有两类落点，分别指向两条不同链路

证据：`rerun3.log` / `appmatrix-portal.json`

| 用例 | A | B | 失败方落点 |
|---|---|---|---|
| S2 | indep/admin | indep/admin | **A → `/portal/login?reauth=1`**（`token_present:false`） |
| S3 | **sso**/admin | indep/admin | **A → `/portal/auth/callback?code=…&state=…`**（`token_present:false`） |
| S4 | indep/admin | **sso**/admin | **B → T0 即 offline**；T1 仍在 `/portal/auth/callback?code=…` |
| S1 | sso/admin | sso/admin | PASS（A/B 各 2 次 `/auth/session` 探针，均 200） |
| S5 | sso/admin | **sso/qa-ms-c1（异账号）** | PASS |

**链路 A（有真 401，直接证明）**：`S2 的 A`（**legacy** 会话）落到 `?reauth=1` ⇒ 它在某个受保护端点收到**真 HTTP 401**（F1 推论 A）。
**链路 B（无 401 也能到达）**：`S3 的 A` / `S4 的 B` 落在回调页且 `token_present:false` ⇒ 与 `main.ts:58-69` 的**身份一致性守卫**路径吻合：`sessionWatcher` 探到 `authenticated=true` 但 `probe.username ≠ userStore.authUid` → `onIdentityMismatch` → `window.location.href = bffAuthorizeUrl(...)`（`main.ts:65-67`）→ authorize → 回调 → `ssoExchange` 未成功 → 停在错误态（`SsoCallbackView.vue:43-47`）。

> ⚠️ **S1 与 S3 的对照很关键**：两者失败方都是 SSO、账号都是 admin，唯一差别是**姊妹会话的通道**（S1 姊妹也是 SSO；S3 姊妹是 legacy）。若身份守卫是主因，则必须解释"姊妹是 legacy 时 `probe.username` 才会变"。**该点目前没有实测数据**（`/auth/session` 的 body 未被采集）→ 见 §3 实验 E2/E3。

---

## 3. Q1 — 服务端到底为什么返回 401？（含 file:line）

### 3.1 已证实的因果骨架

```
                     ┌─ 一个受保护端点 /api/sys|auth|admin/** 的请求
                     │  在发出时 Authorization 缺失 或 portal_token 不可验签
                     ▼
       JwtInterceptor  writeUnauthorized  ⇒ HTTP 401          【唯一 401 发射点：WebMvcConfig.java:16-25 → JwtInterceptor.java:57/61-65】
                     ▼
  request.ts 错误分支 error.response.status===401   ⇒ clearSession() + location='/portal/login?reauth=1'
                     │                                   【request.ts:48/53/56】
                     ▼
  LoginView.onMounted → bootstrapLoginPage()          【LoginView.vue:83-100 → utils/sso.ts:61-67】
       ├─ 无 IdP 会话（legacy 会话） → 显示登录框 → 用户看到"被踢"（S2 的 A）
       └─ 有 IdP 会话（SSO 会话）   → 静默免登 → authorize → /portal/auth/callback?code=…
                                           → ssoExchange 失败 → 停在回调错误态（S3 的 A / S4 的 B）
```

**逐条 file:line**：

| 环节 | 文件:行 | 事实 |
|---|---|---|
| ① 唯一 401 发射点 | `portal-server/config/JwtInterceptor.java:57`、`61-65` | `response.setStatus(SC_UNAUTHORIZED)` + 体 `{code:401}` |
| ① 拦截范围 | `portal-server/config/WebMvcConfig.java:16-25` | `/api/sys/**`、`/api/auth/userinfo|logout|change-password|permissions`、`/api/admin/**`；**排除** `/api/auth/login`、`/api/auth/sso/**` |
| ① 判定条件 | `JwtInterceptor.java:36-58` + `util/JwtUtil.java:79-152` | 无 Bearer / 验签失败 / `iss`≠`marschat-portal` → 401；合法 token 必放行（无会话表、无 tv、无轮换） |
| ② 硬踢 | `portal/src/api/request.ts:48`、`53`、`56` | 真 401 → 清会话 + 硬跳 `?reauth=1` |
| ③ 二次落点（SSO） | `portal/src/main.ts:58-69`（守卫）、`portal/src/utils/sso.ts:61-67`、`portal/src/views/LoginView.vue:83-100`、`portal/src/views/SsoCallbackView.vue:43-47` | 有 IdP 会话 → authorize → 回调换票失败即停在回调页 |
| ✗ 排除：业务 401 | `common-core/…/GlobalExceptionHandler.java:34-38` | `BusinessException(401)` → **HTTP 200**，不硬跳 |
| ✗ 排除：权限不足 | `auth-core/…/RequirePermissionInterceptor.java:46-49` | → **HTTP 403**，不硬踢 |
| ✗ 排除：`/auth/permissions` 无会话 | `AuthCenterService.java:260-262` → `SsoController.java:279-293` | → `BusinessException(401)` → **HTTP 200**，不硬踢 |
| ✗ 排除：token 过期 | `JwtUtil.java:64`（`expire-hours:24`） | 24h，与"数秒内被踢"无关 |

### 3.2 "为什么同账号才触发" — 可用证据支撑的部分

**唯一账号级共享点 = F8 的 `refreshTokens`（`AuthCenterService.java:66`）**。其结构性缺陷（**结论，非猜测**）：

- 键是 **portal 用户 id**，不是会话/浏览器 ⇒ **同账号的两个会话共用一个槽**；
- 写入只有 SSO 路径（`:137-141`）⇒ **只要该账号有任一 SSO 会话，legacy 姊妹会话也会"长上"一个 SSO 身份**；
- 读取方是**所有会话**的 `/auth/permissions`（`callAsUser`）与 `/admin/**`（`callAdmin`）；
- **失败即 `remove(userId)`**（`:132`、`:222`）⇒ 一个会话的失败会**清空另一个会话依赖的共享槽**；
- 且无任何锁/版本号保护 `refresh` + `remove` 的复合动作 ⇒ 天然竞态 ⇒ 与"**间歇 4/5**"吻合；
- 异账号（S5）不共享槽 ⇒ PASS；同通道 SSO+SSO（S1）两会话都合法 SSO、槽内容一致 ⇒ PASS。**这三条与实测矩阵完全一致。**

**⇒ 因此"同账号 + 混合通道才触发"在结构上被解释为**：SSO 会写入该账号的共享槽、legacy 会话会去消费/可能清空它 —— 这是"混合通道"独有的组合。**这是本次诊断中最可靠的一条根因假设。**

### 3.3 ⚠️ 诚实边界：仍未证实的一环（必须说清）

**F8 的槽踩踏产出的后果是 "HTTP 200 + `code:401`"（`callAsUser` 无会话分支）或 502（`callAsUser` 刷新异常分支），而这两个都【不会】硬跳**（F2）。所以：

- **"服务端为什么返回真 HTTP 401"的最后一环，用现有证据无法闭合**；
- QA 自己的诊断**从未抓到那条 401**：no-reload 变体 `diag401.log` / `diag_timeline.log` 记录 **0 个 4xx**；失败的那几次（`rerun3.log` / `portal-s2-diag.log`）只导出了 URL 与 localStorage，**没有导出网络状态码/请求头**；
- 我用尽 portal-server 全仓扫描，**没有任何**"服务端主动作废 portal 会话"的机制（无会话表、无 tv、无黑名单、无密钥轮换事件）。

**⇒ 最可能的两个候选（都是"客户端侧 token 在某一刻不可用"，需实验区分）**：

| 候选 | 内容 | 支持/反对 |
|---|---|---|
| **C1** | reload 时某 axios 请求在 **store token 尚未就绪 / 已被前序 401 清空** 的窗口发出 ⇒ 无 Bearer ⇒ JwtInterceptor 401 | 支持：F1 推论 A（S2 的 A 确实收到真 401）；反对：`login→login→reload` 的最小脚本（`diag_portal_reload.py`）单次 PASS，说明窗口很窄 |
| **C2** | 某请求带了 **token 但 `iss` 校验失败**（异源/轮换前 token） | 支持：`JwtInterceptor.java:42` 专设 "拒绝跨应用 token" WARN；反对：08-15 起已密钥分离，测试期内无轮换，无实测样本 |
| **C3** | 根本不是我误判的"真 401"，S3/S4 是**身份守卫→静默重授权**链路（F9 链路 B），只有 S2 是真 401 硬踢 | 支持：S3/S4 落点均为回调页（守卫路径特征），且无需 401 即可到达；**注意：这不否定 S2 的真 401** |

**⇒ 结论口径**：**QA 的"401 被踢"结论方向可信（S2 的 `?reauth=1` 是硬证据），但"服务端因并发同账号返回 401"的因果链未闭合**，且 S3/S4 很可能混入了另一条（身份守卫）链路。

---

## 4. Q2 — QA 结论可信度评估 + 判别性实验设计

### 4.1 可信度分级

| QA 结论 | 评级 | 依据 |
|---|---|---|
| 存在硬跳机制 `401 → /portal/login?reauth=1` | ✅ **可信** | `request.ts:48-56` 逐行可验 |
| 失败确实是真 HTTP 401（而非业务码） | ✅ **可信** | `?reauth=1` 仅 `request.ts:56` 产生（F1 推论 A） |
| "与 70s 空闲 / 60s 缓存 TTL 无关" 的排除 | ✅ **可信且方法正确** | `diag_matrix_variants.sh` WAIT=0 FAIL / WAIT=70 PASS 的对照设计正确 |
| "只在 portal" | ✅ **可信** | kb-web / infra 同矩阵同机次全过（`rerun3.log`），且已排除机器负载 |
| "任何 API 返回 401 都硬跳" | ⚠️ **不精确** | 混淆了 HTTP 401 与 HTTP 200 体内的业务 `code:401`（F2）；实际触发面**更窄** |
| "服务端因并发同账号而返回 401（关注 60s 缓存竞态）" | ❌ **未证实（且部分被其自身实验证伪）** | §7.3 自己证伪 TTL；无 reload 变体 0 个 4xx；失败样本**未导出网络**，**无一条 401 被观测到** |
| "触发点与并发登录 + 页面 reload 的时序竞争相关" | ✅ **方向可信**（观测结论） | 全部 PASS/FAIL 样本与"是否 reload"强相关（F6） |
| S3/S4 的问题与 S2 同源 | ⚠️ **存疑** | S3/S4 落点是回调页（F9 链路 B），**可能**是身份守卫链路而非真 401 |

### 4.2 判别性实验设计（只读，可直接执行）

目标：**把"服务端 401"从假设变成观测**，并分离三条候选链路。全部在 mykng 用 headless chromium + CDP 完成，**不改生产**；**唯一需要的一次写操作**是等主理人批准后临时打开 portal-server 的 DEBUG 日志级别（只读性更高的替代见 E4b）。

**E0（前置，零成本）** — 在 portal-server 侧把 `JwtInterceptor` 的 401 路径补一段**采样日志**（或临时把 `com.kb.portal.config.JwtInterceptor` 日志级别降到 DEBUG）：
- 记录 `uri + 是否带 Authorization + token 首 12 字符 + 校验失败原因（无 Bearer / 验签失败 / iss 不符）`。
- 这是**唯一能"断言"是 JwtInterceptor 的硬证据**（客户端只能看到 status，看不到服务端原因）。
- 若不能改代码：**E4b** 用容器日志里已有的 `log.warn("拒绝跨应用 token：uri={}…")`（`JwtInterceptor.java:42`）作为锚点，但它只覆盖 `iss` 不符分支，不覆盖"无 Bearer"分支（`writeUnauthorized(response,"未登录或登录已过期")` 当前**不打日志**，这正是可观测性缺口 → 见 Q3 方向 3）。

**E1（分离"真并发" vs"同 profile 多 tab"）**：
- 变体 a：两个**独立 profile**（现有矩阵）；变体 b：**同一 profile 两个 tab**（同 localStorage）。
- 判据：若只在 a 失败 ⇒ 是"跨浏览器并发"；若 b 也失败 ⇒ 与"共享 localStorage/本地 token"相关。

**E2（分离"A 自身 token 问题" vs"B 的请求导致"）**——**最关键**：
1. A 登录（legacy）→ B 登录（legacy，同账号）→ **只 reload A**，B 全程不动；
2. 用 CDP `Network.enable` + `Network.requestWillBeSent`（**必须在 reload 前开启**）**落盘 A 的每一次请求**：`url + status + requestHeaders.Authorization(前 12 字符)`；
3. 判据：
 - 若抓到的 401 请求 **`Authorization` 为空** ⇒ 候选 **C1**（前端 token 窗口）；
 - 若带 token 但 `iss≠marschat-portal` ⇒ 候选 **C2**；
 - 若**一条 401 都没有**、A 却仍在回调页 ⇒ 候选 **C3**（身份守卫链路，与 401 无关）。
> 注意：QA 的 `diag_portal_401.py`/`refresh()` **都没在 reload 前开 `Network.requestWillBeSent` 的 header 捕获**，所以看不到发出去的 header —— 这是他们"抓不到 401"的直接原因。

**E3（身份守卫判别，针对 S3/S4）**：
- 在 SSO 回调页注入 hook 抓 `POST /portal/api/auth/sso/exchange` 的**响应体与 HTTP 状态**；
- 同时抓 `/auth/session` 的**响应体**（`{authenticated, username}`），与 `localStorage.portal_auth_uid` 比对；
- 判据：若 `exchange` 返回 `{"code":400,"message":"SSO 状态无效或已过期"}` ⇒ 是 `SsoController.exchange:48-51` 的 `consumeState` 单次性/竞态；若 `exchange` 根本没被发出 ⇒ 是守卫直接 `bffAuthorizeUrl` 跳走（`main.ts:65-67`）。

**E4（服务端侧锚点，与 E0 配合）**：`docker logs kb-app-portal-server`（**只读**）过滤 `JwtInterceptor` 的 WARN 与 `未登录`；同时对照 `auth-center` 日志里 `/oauth2/token` 的 refresh 结果（判断 F8 的槽踩踏是否真的发生）。

**E5（根因定格，需批准的小改+回滚）**：把 `AuthCenterService.refreshTokens` 的键从 `portalUserId` 临时改为 `portalUserId + 会话标识`（或在 `remove` 前加日志）。**若 FAIL 消失 ⇒ 直接证实 F8**。此步属"改动"，**本报告不执行**，仅登记为定格手段。

**E6（复现率控制）**：每个变体至少 10 次，记录 4/5 基线来自 QA；判定用"比例"而非单次。

### 4.3 一句话给主理人

> QA 的失败**现象**与**硬跳机制**是可信的、可复现的方向也找对了（reload + 同账号）；但**"服务端返回 401"这一因果结论目前是假设**，其自研诊断恰好漏在"没抓请求头"这一步。**E0+E2 两个实验（约半小时、纯只读）即可把根因钉死。**

---

## 5. Q3 — 最小正确修法方向 + 改动面清单

### 5.1 修法方向（按"正确性/风险/改动面"排序）

| # | 方向 | 性质 | 为什么这样 |
|---|---|---|---|
| **D-1** | **portal 前端 401 处理对齐 kb-web**：不再"一次 401 即硬跳"，改为「白名单 →（有 IdP 会话）静默重授权 / （legacy）一次刷新 → 失败才跳登录页」，并加 `_retry` | **必修**（治"被踢"这个用户可见症状） | F7 证明"只被踢"是前端策略差异放大的结果；kb-web 已有验证过的实现（`kb-web/src/api/index.ts:98-162`），portal 是唯一异类 |
| **D-2** | **portal 后端收敛共享槽** `AuthCenterService.refreshTokens`：键改为"账号 + 会话"（或至少失败时**不删全局槽**），并把"无 SSO 会话"与"刷新失败"分类返回（现状都塌成 401/502） | **根因收敛**（针对 F8 的结构性缺陷） | F8 是"同账号才有"的唯一解释；不改则竞态仍在，D-1 只是把硬踢变成静默重试（治标） |
| **D-3** | **补 401 观测**：`JwtInterceptor` 的 `writeUnauthorized` 分支加 URI/Bearer 有无/失败原因 WARN；前端 `request.ts` 401 分支先 `console.error({url})` 再跳 | **零风险，先做** | 当前"无 Bearer"分支**零日志**，导致 QA 反复诊断都抓不到；补上后下次复现可自证 |
| **D-4** | （可选）把 portal 的 SLO 探测从"仅在 SSO 会话启动"扩展为"登录即探测 + 身份守卫加日志" | 增强 | F9 链路 B 的身份守卫当前无日志（`main.ts:65-67` 匿名跳转），排查困难 |

### 5.2 改动面清单（文件 × 区块 × 改法 × 发版 × 回归）

| 任务 | 文件 | 区块 | 改法 | 发版路径 | 回归点 |
|---|---|---|---|---|---|
| D-1 | `devtools/portal/src/api/request.ts` | `addResponseInterceptor` 错误分支 `:46-61` | 新增 401 白名单（`/auth/sso/`、`/auth/login`）；`isOidcToken()` → `bootstrapLoginPage`/`renewByReauthorize`；否则读 `portal_refresh`（若无则直接跳）；加 `_retry` 与并发排队 | **portal-web**（Woodpecker，devtools 仓） | 6 应用双通道登录 + 多会话矩阵 S1–S4（x10 次） |
| D-1 | `devtools/portal/src/utils/sso.ts` | `bootstrapLoginPage`/`stopSessionWatcher` | 复用现成导出，无需新增；确认 `reauth=1` 与 `slo=1` 语义在 `LoginView` 一致 | 同上 | 401 后能自动静默免登回原页 |
| D-2 | `devtools/portal/portal-server/src/main/java/com/kb/portal/service/AuthCenterService.java` | `refreshTokens`（`:66`）、`refreshAccessToken`（`:118-135`，尤其 `:132`）、`callAsUser`（`:259-272`）、`callAdmin`（`:209-243`，尤其 `:222`） | 槽键加会话标识（由 `SsoController.exchange` 下发到前端、请求头回传）**或**最小改法：失败只标记不 `remove`，并区分返回码（无会话 404/401-业务；刷新失败 502） | **portal-server**（Woodpecker） | 用户管理/权限下发不回归；同账号两会话各 10 次 reload |
| D-2 | `devtools/portal/portal-server/src/main/java/com/kb/portal/controller/SsoController.java` | `exchange` `:46-79`、`toLoginResponse` `:169-174` | 若要下发会话标识，在此扩展 `LoginResponse` | 同上 | 前端会话标识持久化 |
| D-3 | `devtools/portal/portal-server/.../config/JwtInterceptor.java` | `:57`（无 Bearer 分支）、`:44`（iss 分支） | 两分支加采样 WARN（uri + 是否带 Bearer + 失败原因）；**不打印完整 token** | portal-server | 日志可在容器内 `docker logs` 检索 |
| D-3 | `devtools/portal/src/api/request.ts` | `:48-56` | 跳转前 `console.error('[api] 401 硬跳', {url, hadToken: !!userStore.token})` | portal-web | 复现时 console 可见 |
| D-4 | `devtools/portal/src/main.ts` | `:58-69` | 身份守卫加 `console.warn`（probe.username vs authUid） | portal-web | S3/S4 复现时可见 |

**明确不建议**：
- ❌ **不要为这个问题改 auth-center**（12 直接/12 传递依赖的枢纽）。除非 §4 的 E4 在 auth-center 日志里看到 `oauth2/token` 侧异常（SAS refresh 轮换/tv）。
- ❌ 不要改 nginx；`/portal/api/**` 路径与 header 透传已核实正确（`config-as-code/hosts/mykng/nginx/conf.d/locations/portal.conf:15-39`，无 strip、无 auth_basic）。
- ❌ 不要用"把 24h 有效期调长/缩短"之类的手段掩盖（F5 已证明不是过期问题）。

---

## 6. 顺带确认（主理人点名的两件事）

### ① Fix A（IdP 登录页「返回入口」）在 auth-center 侧我**从未实施**

- 我（架构师）在任务 #3 只产出**方案**（`verify/design/architect-fix-plan.md` 推荐方案 c2：新增只读端点 `GET /login-context` + `RedirectAllowList` + SecurityConfig 1 行 matcher + `login.html` 增量），**未写任何代码**。
- **当前 auth-center 仓 HEAD `f12cf28`（2026-09-18 12:35:46）已包含 D1 提交**：`feat(auth-center): IdP 登录页新增「返回应用独立登录页」入口（GET /login-context）`，仓库内已存在 `src/main/java/com/marschat/authcenter/controller/LoginContextController.java` 与 `src/main/java/com/marschat/authcenter/util/RedirectAllowList.java`。⇒ **D1 是工程师（任务 #6）的实施，不是我的。**
- QA 回归（09-18 上半天）判定 Fix A"未生效"**成立**：当时 auth-center 运行镜像构建于 **09-18 00:14**，早于 09:29 修复窗口 9 小时且容器未重启；D1 的提交时间（12:35）更在回归之后。
- **本次诊断未把 D1 当作既有逻辑**：D1 只新增 `LoginContextController` / `RedirectAllowList` / 1 行 matcher / `login.html` 增量，与 `JwtInterceptor`、`AuthCenterService`、`request.ts` **零交集**；我读的 portal 源码快照（devtools `83aad09`）也不含 D1。

### ② Fix B 的 `fixed="right"` 确为**仓库既有**，随本次重建**首次上线**

- `marschat-components/packages/auth-components/src/components/UserManagementPanel.vue:82`：`<el-table-column v-if="!cfg.readonly" label="操作" :width="opColumnWidth" fixed="right">` ⇒ **源码本就带 `fixed="right"`**（非本次新写）。
- `devtools/portal/package.json:14`：`"@marschat/auth-components": "^0.8.8"`；`marschat-components/packages/auth-components/package.json:3`：`"version": "0.8.8"`。
- QA 实测 5 应用 `fixedRight=True`（`reg-ui.json`，见其报告 §4.2）⇒ 该视觉改善是**仓库既有但此前未部署**，**随 09:29 portal-web（及其他 4 个前端）重建首次上线**。**判断成立。**

---

## 7. 附：证据与源码索引

### 7.1 我实读的源码（本次诊断）

| 层 | 文件 |
|---|---|
| portal 前端 | `portal/src/api/request.ts`、`views/LoginView.vue`、`views/SsoCallbackView.vue`、`stores/user.ts`、`stores/system.ts`、`utils/sso.ts`、`utils/permissions.ts`、`main.ts`、`router/index.ts`、`config/runtime.ts`、`layouts/MainLayout.vue`、`App.vue` |
| portal 后端 | `config/JwtInterceptor.java`、`config/WebMvcConfig.java`、`config/AuthzConfig.java`、`config/PortalPermissionChecker.java`、`util/JwtUtil.java`、`controller/AuthController.java`、`controller/SsoController.java`、`controller/PortalSystemController.java`、`controller/HealthCheckController.java`、`service/AuthCenterService.java` |
| 共享库 | `common-core/.../GlobalExceptionHandler.java`、`.../NotLoginException.java`、`.../Result.java`；`auth-core/.../RequirePermissionInterceptor.java` |
| auth-center | `security/JwtAuthenticationFilter.java`、`security/JwtTokenProvider.java`、`service/TokenVersionService.java`、`service/impl/AuthServiceImpl.java`、`controller/AuthController.java` |
| 组件库 | `auth-components/src/components/UserManagementPanel.vue`、`src/composables/usePermissions.ts`、`src/utils/sessionWatcher.ts`、`src/utils/sso.ts` |
| 对照 | `devtools/mykng/kb-web/src/api/index.ts` |
| 部署 | `config-as-code/hosts/mykng/nginx/conf.d/locations/portal.conf`、`hosts/tencent-cloud-2/nginx/sites-available/main.marschat.online` |

### 7.2 QA 证据（本次引用）

`verify/multisession/` 下：`qa-regression-report.md`（§7 为主）、`evidence/{rerun3.log, appmatrix-portal.json, diag401.log, diag_timeline.log, diag_variants.log, portal-s2-diag.log, matrix-S1.json, matrix-S3-S4.json, matrix-S5-S6.json, s7.json, s7b.json}`、`scripts/{run_matrix.py, ms_test.py, diag_portal_401.py, diag_portal_timeline.py, diag_portal_reload.py, diag_portal_s2.sh, diag_matrix_variants.sh, ui_probe.py}`。

### 7.3 本报告产生的附加文件

- `verify/design/_git_devtools.txt`、`verify/design/_git_authcenter.txt`（HEAD 采集，`head` 命令在沙箱内缺失，工作区状态未取到，不影响结论）

---

## 8. 待主理人拍板（≥3 列对比一律入表）

| # | 事项 | 选项 | 我的建议 |
|---|---|---|---|
| Q1 | 是否授权执行 §4.2 的定格实验（E0/E2，约 30 分钟，含一次 portal-server 日志级别调整，可回滚） | (a) 授权；(b) 先只做纯只读 E2/E4b；(c) 暂不 | **(a)**：不抓到那条 401，任何修法都是"治症状" |
| Q2 | 修法范围 | (a) 只做 D-1 前端；(b) D-1 + D-2 后端；(c) D-1+D-2+D-3 | **(b) 起，D-3 必带**：D-1 治可见症状，D-2 治账号级共享槽，D-3 让下次自证 |
| Q3 | 是否把 S3/S4 单列为"身份守卫链路"缺陷（与 401 分开跟踪） | (a) 合并为一个缺陷；(b) 拆分两个 | **(b)**：F9 显示两类落点特征不同，合并会掩盖身份守卫问题 |
| Q4 | 是否允许改 `AuthCenterService.refreshTokens` 键结构（含前端会话标识下发） | (a) 允许；(b) 只允许"失败不删槽"最小改法 | 先 **(b)**（改动面 1 文件、无契约变更），实验证实后再评估 (a) |
