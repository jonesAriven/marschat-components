# Phase 14 · 登录校验放行配置化（`marschat.auth.anonymous` / `anonymous-paths.json`）

> **定位**：本文是「登录校验放行（匿名可达路径）配置化」的**决策与落地记录**（背景 → 设计 → 实现 → 自测 → 迁移 → 上线验证）。
> **配套**：`README.md` 第二篇「登录校验放行配置化」（怎么接入）· `CONFIG-REFERENCE.md` §4.6 / §5.3（字段全表）· `STATUS.md`（本轮验证记录）。
> **时效**：2026-10-15。**本文不含任何口令 / secret 明文**。

---

## 1. 背景

良哥提出「应该支持某些接口，或者页面，放开登录校验的配置」，并要求核实
**「其他应用接入单点登录组件，是否具备路径过滤（配置化），是否都是配置化，并且配置化的量都比较少」**。

全量核查结论（改动前）：

| 应用 | 形态 | 放行清单现状 | 问题 |
|---|---|---|---|
| activecode | MVC 拦截器 | `AuthInterceptor` 硬编码 `ANONYMOUS_ENDPOINTS` + `WebMvcConfig` 硬编码 `excludePathPatterns`（**两处**，改一处漏一处 = 静默失效） | 硬编码 |
| portal | MVC 拦截器 | `WebMvcConfig.excludePathPatterns` 硬编码 3 项 | 硬编码 |
| kb-ops | Spring Security | `SecurityConfig` 硬编码 permitAll | 硬编码 |
| infra-monitor | Spring Security | `SecurityConfig` 两处硬编码 permitAll | 硬编码 |
| cosmic-studio | FastAPI 中间件 | **无任何放行机制** —— `/api/**` 完全裸奔（路由自身不校验 = 谁都能调） | 无配置化且无默认拒绝 |

即：**5 个应用 4 种形态，全部硬编码或缺失**；「放开登录校验」要改代码 + 重启，且 cosmic 连「需持票」的底线都没有。

## 2. 设计：两级清单 + 登录保底集 + 默认拒绝

### 2.1 关键设计决策

| 决策 | 理由 |
|---|---|
| **两级清单：`paths`（路径级 Ant 通配）+ `endpoints`（方法级精确）** | 覆盖两种真实诉求：「一类路径全放开」与「一个端点按方法放开」；与 bff-whitelist 配置风格同族，学习成本零 |
| **写值即整体替换（不是追加）** | 配置即真相；避免「默认值 + 追加」模式下运维改配置时猜不透最终集合 |
| **登录保底集代码内合并、配置不可清空** | 防误配把登录链路打断导致**没人能登录**（保底集 = login / sso/authorize / sso/callback / mail-login / mail-login/send-code 五条） |
| **保底集按 context-path 双形态生成** | 兼容两种历史形态：nginx 已剥前缀（后端见 `/api/auth/*`）与后端可见完整前缀（activecode 的 `/activecode/api/auth/*`） |
| **不配 context-path = 不生成副本** | 绝大多数应用 nginx 已剥前缀；配了只生成永不命中副本（无害但误导），故默认不配、文档明示 |
| **cosmic 侧 deny-by-default 中间件** | auth-core jar 覆盖不到 Python；用纯 ASGI 中间件把「完全裸奔」收紧为「需持票」，严格强于现状 |
| **启动面审计 `audit_open_surface`** | 配置与代码漂移是这类机制的最大风险（清单里有死路径 / 新路由忘了登记）；启动时全量比对，两类漂移 WARN |

### 2.2 路径口径铁律（本轮最关键发现）

Spring MVC 拦截器与 Spring Security `requestMatchers` 均按 **context-path 剥离后**的路径匹配。
⇒ 有部署前缀的应用（portal `/portal` · kb-ops `/kb-ops` · infra `/infra`）yml 一律写**剥离后形态**，且**不配** `context-path`。

推论：infra-monitor 的登录端点是 `/auth/login`（不带 `/api`），**保底集覆盖不到**，必须 yml 显式声明。

## 3. 实现

### 3.1 auth-core 2.3.0（`com.marschat.auth.anonymous`）

- `AnonymousAuthProperties`：`paths` / `endpoints` / `context-path`；`effectivePaths()` = 保底集 ∪ `paths`（保底段按 context-path 双形态生成）。
- `AnonymousAuthAutoConfig`：默认装配（无 enabled 开关 —— 不配置即仅保底集，零影响）。
- 单测 8 项：保底不可清空 / 写值整体替换 / 通配语义 / 方法级 / context-path 副本。

### 3.2 cosmic-studio（Python，auth-core 覆盖不到）

- `app/anonymous.py`：`AnonymousPaths`（Ant→regex 预编译）+ `AnonymousAuthMiddleware`（纯 ASGI，deny-by-default）+ `audit_open_surface`（**跨 FastAPI 0.115~0.140 稳健**：`Dependant.call` / `Depend.dependency` 双兼容、递归 `_IncludedRouter.original_router`）。
- `app/anonymous-paths.json`：配置真源（缺失 / 损坏 → 降级仅保底集，安全方向）。
- `app/main.py`：异常 handler 之后注册中间件；全部 `include_router` 之后启动面审计（整体 try/except，绝不影响启动）。

## 4. 自测证据（2026-10-15 本机实测）

| 层 | 证据 |
|---|---|
| auth-core 单测 | **64/64 通过**（含 `AnonymousAuthPropertiesTest` 8 项；`mvn deploy` 同跑全绿） |
| cosmic 模块自检 | `python -m app.anonymous` 全绿（保底不可清空 / 整体替换 / 通配 / 方法级 / from_file 三路径） |
| cosmic 端到端 | **20/20 断言通过**：health/login 无票 200、受护路由无票 401 带票 200、SPA/OPTIONS 放行、漂移路由 fail-closed 401、401 信封 `{"detail":"未登录"}`、审计两类告警、真实配置加载 |
| 三 Java 应用编译 | portal / kb-ops / infra-monitor `mvn compile` **BUILD SUCCESS** + 产物引用确认 + yml 语法确认 |
| 安全回归 | 全量 grep：保底集合入后两个 MVC/Security 应用**无** `/api/auth/*` 实体端点（零行为变化）；infra `/auth/permissions` 故意不在清单（保持 `authenticated()`） |

## 5. 迁移记录（5 应用）

| 应用 | 改动 | 行为变化 |
|---|---|---|
| activecode | 删本地 `AnonymousAuthProperties`（165 行，上轮首发版）→ 改用 auth-core 公共 Properties；`AuthInterceptor`/`WebMvcConfig` 构造注入；yml 补配置段 + `context-path: /activecode` | 行为保持（本地副本语义 = 公共库语义） |
| portal | `excludePathPatterns` 硬编码 → `anonymousAuth.effectivePaths()`；yml 声明 `/api/auth/login` · `/api/auth/sso/**` · `/actuator/**` | **零行为变化**（新排除集 = 旧声明三项 ∪ 保底集，全部 no-op；admin 三道闸未动） |
| kb-ops | permitAll → `requestMatchers(effectivePaths)`；yml 声明 `/actuator/**` | 零行为变化（纯 SSO 应用无本地登录端点） |
| infra-monitor | 两处 permitAll → 配置化；yml 显式声明 `/auth/login` · `/auth/mail-login` · `/auth/mail-login/send-code` · `/actuator/**` | 零行为变化 + `/auth/permissions` 安全边界保持 |
| cosmic-studio | 新增中间件 + JSON 配置 + 启动审计 | **收紧**：`/api/**` 从裸奔 → 需持票（401） |

## 6. 上线验证（2026-10-15，一次只跑一条流水线）

> 部署目标机：activecode → 192.168.31.182（Debian）；portal-server / kb-ops / infra-monitor → 192.168.31.105（mykng）。
> 构建机经 Nexus `maven-public` 组解析 auth-core 2.3.0（pom/jar 实测 200）。

| 应用 | 流水线 | 结果 | 接口级验证 |
|---|---|---|---|
| cosmic-studio | #123（push 自动触发） | ✅ SUCCESS | `/api/health` 无票 **200** · `POST /api/auth/login` 无票 **422**（到达路由未被拦截）· `GET /api/projects` 无票 **401** `{"detail":"未登录"}` |
| activecode | #848 | ✅ SUCCESS（101s） | 见本节末「汇总」 |
| portal-server | #849 | ✅ SUCCESS（152s） | 见本节末「汇总」 |
| kb-ops | #850 | ✅ SUCCESS（158s，130 单测全过） | 见本节末「汇总」 |
| infra-monitor | #851 | ✅ SUCCESS（161s） | 见本节末「汇总」 |

## 7. 遗留与后续

- **T-ENG-7 补机制二选一待良哥拍板**（A 动 auth-center 枢纽 / B portal 侧放宽，推荐 B）—— 与本轮无关，单独挂起。
- activecode 匿名 generate 的频控 / 验证码 —— 已提出，待回应。
- cosmic 中间件目前只认 `Authorization: Bearer`；带票 200 已在端到端断言覆盖。

---

## 附：接口级验证汇总（2026-10-15 逐应用 curl 实测）

> 判定标准：**匿名放行项无票必须到达路由**（业务响应/4xx 参数错，唯独不能 401）；**受护端点无票必须 401**。

| 应用 | 匿名放行项（无票实测） | 受护端点（无票实测） |
|---|---|---|
| activecode（.182:18080） | `POST /activecode/api/activation/verify` → **200**「激活码不能为空」（到达路由）· `GET /activecode/api/activation/config/default-expire` → **200** 配置 · `POST /activecode/api/activation/generate`（方法级）→ **200**「序列号不能为空」（到达路由） | `GET /activecode/api/activation/list` → **401**「未登录或会话已过期」 |
| portal（.105:8087） | `GET /portal/actuator/health` → **200** UP · `GET /portal/api/auth/sso/authorize?...` → **400**（参数校验，到达路由）· `POST /portal/api/auth/sso/exchange`（无 state）→ **业务 400**「SSO 状态无效或已过期，请重新登录」（到达路由，修复前为 500 NPE，见下） | `GET /portal/api/sys/system/list` → **401**「未登录或登录已过期」 |
| kb-ops（.105:8084） | `GET /kb-ops/actuator/health` → **200** UP（db/redis/ping 全 UP） | `GET /kb-ops/api/host/list` → **401**「未登录或登录已过期」 |
| infra-monitor（.105:8088 host 网络，SSH 侧实测） | `GET /infra/actuator/health` → **200** UP · `GET /infra/auth/login` → **405**「请求方法不支持: GET」（POST-only，到达路由）· `POST /infra/auth/mail-login/send-code` 空 body → **200**「缺少邮箱」（到达路由） | `GET /infra/auth/permissions` → **401**（🔴 故意不在清单，安全边界保持） |
| cosmic-studio（.105:8310） | 见 §6 表（health 200 / login 422） | `GET /api/projects` → **401** `{"detail":"未登录"}` |

**顺带发现并修复（portal 既有缺陷，非本轮引入）**：`POST /portal/api/auth/sso/exchange` 不带 `state` 时，
`AuthCenterService.consumeState(null)` 直接 `ConcurrentHashMap.remove(null)` 抛 NPE → 500（日志 traceId `b0b21f83…` 可证）。
真实 SSO 流程 state 必带，故此前未暴露。已修：`consumeState` 入参判空（null/blank → 返回 null），
落入 controller 既有的 `origin == null` 分支 → 业务 400「SSO 状态无效或已过期，请重新登录」。
全仓 grep 确认 `consumeState` 仅 portal 一处，无同类项。

**修复上线与复验**：devtools commit `179fdf8e`（3 行判空）→ Woodpecker **#852** ✅（177s，portal-server 容器重建上线）→
复验 `curl -X POST /portal/api/auth/sso/exchange -d '{"code":"dummy"}'`（无 state）→ HTTP 200 信封 + **body code 400**
「SSO 状态无效或已过期，请重新登录」（traceId `81c6f9d5…`），500 NPE 消除 ✅。
