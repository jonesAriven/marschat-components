# 平台状态与遗留待办（STATUS）

> **定位**：本文是统一认证平台**「进行中 / 未决 / 待办」的唯一权威**。接手者**先读本文**，再按需回看 `README.md`（现行设计）与 ADR（决策史）。
> **配套**：`README.md`（设计 · 接入 · 使用运维）· `CONFIG-REFERENCE.md`（配置项与环境变量全表）· `TROUBLESHOOTING.md`（故障排查）。
> **时效**：截至 **2026-10-07**。本文为**活文档**——每次落地/拍板后**当场更新本表**，不要在 ADR 或历史快照里另开一份待办。
> ⚠️ **来源与去向**：本表由 `PHASE12-SUMMARY`（R4/R5/R6）· `PHASE12-PROGRESS` · `ADR-2026-09-16 §7` · `ADR-2026-09-15` · README §6 汇总裁剪而来；**上述文档中的待办条目自此仅作历史证据，一律以本表为准**。
> ⚠️ 本表**不含任何口令 / secret 明文** —— 凭据一律见 Vaultwarden（`vault.marschat.online:8222`）或 infrastructure-map 技能。

---

## 0. 当前状态速览

| 项 | 值 |
|---|---|
| 版本基线 | `@marschat/app-kit` **0.1.4**（已发布 Nexus npm-hosted）｜ `@marschat/auth-components` **0.8.8**（⚠️ UMD 产物自报 0.8.7，见 T-LOW-3）｜ `@marschat/frontend-common` 0.3.5 ｜ `com.marschat:auth-core` **2.2.0**（已发布 Nexus maven-releases）｜ `com.marschat:common-core` 1.1.6 |
| 六应用接入 | portal / activecode / kb-web / cosmic-studio / kb-ops / infra-monitor —— **登录页 · SSO · 统一鉴权 · 权限体系 · 用户统一管理 全部接入** |
| 认证真源 | auth-center（`:8085`）唯一；账密真源归一**六应用全部完成**（kb-web 经 kb-gateway 直转中心；kb-ops 无账密入口） |
| 权限模型 | 三层（Identity / Membership / Entitlement）已下沉到 API；strict 默认最小权限全站生效 |
| **配置化接入（Phase 13）** | **5/6 应用已迁移并上线**：kb-ops · infra-monitor · kb-web · cosmic-studio · portal（前端+后端 BFF）。剩 **activecode**（无构建 UMD 静态页，不适用 app-kit，见 T-ENG-5） |
| **接入成本（2026-10-07 实测）** | 前端 **1100~2300 行手写胶水 → 30~66 行声明式装配**（`marschat.ts`）；后端 **472~1106 行手写 Controller → 0 行 Java + 一份 YAML**（`bff-whitelist.yml`）。本轮三应用**净删 573 行**手写接入代码 |
| 最近验证 | **2026-10-08**：① **Phase 13 部署上线**（#838 / #121 / #839 / #840 四流水线全绿，一次只跑一条）+ **产物级四层验证** + **真浏览器走操作路径截图**；② **T-ENG-8 登出清理上线**（#841 / #842）四重验证；③ **T-ENG-9 P0 热修上线**（#843）—— hutool 签名器并发缺陷，混发实验 **120 次 0 失败**（修复前 5/60），真浏览器 **7/7 PASS** | |
| 未闭合阻断项 | **0 个 P0**。剩余集中在「需拍板 2 项」+「发版后确认 1 项（T-ENG-7 存量 admin 授权）」+「低优先技术债」 |

---

## 1. ⏳ 待办总表（唯一权威）

### 1.1 🔴 需良哥拍板（阻塞后续，共 4 项）

| # | 事项 | 现状 / 选项 | 风险提示 |
|---|---|---|---|
| **T-DEC-1** | **F1 三处共享 JWT 密钥轮换** | auth-center / kb-gateway / kb-ops **共用同一对称密钥**（kb-ops 经 `MARSCHAT_AUTH_SECRET`），且为弱默认样式 → HS384 业务令牌可穿网关 legacy 验签环。方案已出：**阶段 1** 下游改 JWKS 公钥验签（共享面 3→1）→ **阶段 2** auth-center 双密钥过渡轮换 | **两阶段顺序不可颠倒**；阶段 1 会令 legacy HS 会话 401（需重登一次）。建议低峰期先抓一次线上流量确认无 HS 发签方 |
| **T-DEC-2** | **3.2-B 令牌分离** | 现状「应用令牌 = 中心令牌」，中心凭据落浏览器 localStorage。3.2-A 同源化已完成；B 需网关自签应用令牌 + Redis 持中心令牌 | 三种验签并存，**影响 kb-web / kb-ops 全部 API**。建议列为 Phase 13 专项，**第一版只覆盖 `/kb/api/admin/**`** |
| **T-DEC-3** | **auto-git-sync 处置** | `/etc/cron.d/auto-git-sync` 每 10 分钟 `git add -A` + commit + `pull --rebase` + push。**已两次干扰施工**（抢跑提交） | 选项：停用 / 保留但排除本项目 / 维持现状。**本机 `.git` refs 落盘异常时，推送类操作应走服务器** |
| **T-DEC-4** | **auth-center `715b41e` 是否推** | 该提交为 `clients.yml` 补 cosmic `menu-report-secret` 一行（env-only） | 推送会触发**枢纽重建**（12 应用依赖，预计无运行时变化）。建议随下次正常发版带上 |

### 1.2 🟠 需发版工程

| # | 事项 | 工作量 / 依赖 |
|---|---|---|
| **T-ENG-1** | **应用台 Membership API path 化** | 状态（6 应用）仍走旧端点 `GET /admin/users?client=<id>`、`PUT /admin/users/{uid}/client-roles?client=<id>` —— `?client=` 是**查询参数，不是权限边界**。中心 path 化端点**已就绪**，应用侧需改：`packages/auth-components/src/utils/userAdmin.ts`（扩展 `createMemberAdminClient`）+ 6 个宿主页 baseUrl + **activecode 手写页 `members.html`**（无构建、手工改、易漏）。旧端点标 `@Deprecated` 但**保留作回滚路径**，两版可并存一个发版周期 |
| **T-ENG-2** | ✅ **已闭合（2026-10-05）** 发布 `@marschat/app-kit` + `auth-core@2.2.0` 到 Nexus | 已发布并核验：`@marschat/app-kit` **已发至 0.1.4**（latest；0.1.0→0.1.1→0.1.2→0.1.3→0.1.4，后四版均为迁移过程中发现的问题修复）· `com.marschat:auth-core` **2.2.0**（maven-releases，jar+pom+sources+校验和齐）。**后续组件改动需再发版** |
| **T-ENG-3** | ✅ **5/6 应用迁移完成并上线（2026-10-07）** —— 本轮收官 | **kb-ops · infra-monitor · kb-web · cosmic-studio · portal 全部完成并上线**。本轮三应用合计**净删 573 行**手写接入代码：kb-web −258 · cosmic −54 · portal −261（前端）+ 后端手写 Java −190。四流水线全绿（#838 / #121 / #839 / #840，**一次只跑一条**）。**接入成本实测：前端 1100~2300 行手写胶水 → 30~66 行声明式装配；后端 472~1106 行手写 Controller → 0 行 Java + 一份 YAML。** 剩 **activecode**（前端无构建 UMD，不适用 app-kit，见 T-ENG-5） |
| **T-ENG-3a** | ✅ **kb-ops 试点迁移完成（待发版部署）** | 删手写 `AdminProxyController`（266 行）+ 3 个前端适配层（263 行）；新增 `bff-whitelist.yml` + `src/marschat.ts` 一行装配。本地验证：前端类型错误 28→27（新增项已消除）· 前端构建 EXIT=0 · 后端编译/打包 EXIT=0 · jar 含 `auth-core-2.2.0` + `bff-whitelist.yml` · **白名单等价性 34/34 通过**。✅ **已上线**（流水线 #833/#834 success；容器 `Started in 19.273s`；jar 含 `auth-core-2.2.0` + `bff-whitelist.yml`，**BFF 日志「已加载 9 条规则」**；前端 entry 09:35、旧适配层符号 0）。**L4 真浏览器**：落 `/ops/dashboard`、`kb_ops_access_token` 938 字符、16 项菜单、**用户管理页渲染出真实数据**（截图已核）。**记录见 `kb-ops/docs/PHASE13-配置化接入迁移记录.md`** |
| **T-ENG-3b** | ✅ **infra-monitor 迁移完成（待发版部署）** | 删手写后端 3 个类共 **461 行**（`AdminProxyController` 295 + `CenterSessionStore` 71 + `LocalAccountReporter` 95）→ 新增 `MarschatBffConfig`（约 50 行，两个扩展 Bean）+ `bff-whitelist.yml`（5 条）；删前端 3 个适配层 264 行。**首次验证 `credential-mode: auto`（双会话）与 `BffAccountSource` SPI**。本地验证：类型检查**不崩**、5 个错误全为存量（迁移零新增）· 前端构建 EXIT=0 · 后端编译/打包 EXIT=0 · jar 含 `auth-core-2.2.0` + `bff-whitelist.yml` · **白名单等价性 29/29 通过**（含「未登记面板端点必须拒绝」的差异点）。✅ **已上线**（流水线 #835/#836 success；`Started in 11.474s`；**BFF 日志「已加载 5 条规则」+「账号上报成功：1 个本地账号已登记」**；前端 entry 09:38、旧适配层符号 0）。**L4 真浏览器**：落 `/infra/dashboard`、`infra_access_token` 942 字符、6 项菜单、**用户管理页渲染出真实数据**。**记录见 `infra-monitor/docs/PHASE13-配置化接入迁移记录.md`** |
| **T-ENG-3c** | ✅ **activecode 后端迁移完成（前端不可迁，见下）** | 删手写后端 3 个类共 **472 行**（`AdminProxyController` 297 + `CenterSessionStore` 71 + `LocalAccountReporter` 104）→ 新增 `MarschatBffConfig`（约 90 行）+ `bff-whitelist.yml`（5 条）。**本轮唯一「首次引入 auth-core」的应用**：需 `spring.autoconfigure.exclude` **4 条**（`AuthJwt` 会启动失败 / `AuthWeb` / `Authz` 重复拦截 / `MenuReport` 重复上报）+ **自定义 `BffCredentialResolver`**（本应用无 Spring Security，用户名在 HttpSession 而非 `getUserPrincipal()`）。本地验证：编译/打包 EXIT=0 · jar 含 `auth-core-2.2.0` + `bff-whitelist.yml` · **白名单等价性 29/29** · **自动装配覆盖率 6/6 有处置**。✅ **已上线**（流水线 #837 success；`Started in 7.235s`；**BFF 日志「已加载 5 条规则」+「账号上报成功：3 个本地账号已登记」**；**菜单上报命中数 = 1 → `MenuReportAutoConfig` 排除生效、无重复上报**）。**L4 真浏览器**：落 `/activecode/main.html`（原生页无侧边栏属正常）。**记录见 `active-manager/docs/PHASE13-配置化接入迁移记录.md`** |
| **T-ENG-3d** | ✅ **kb-web 迁移完成并上线（2026-10-07）** | 删 3 个前端适配层共 **258 行**（`utils/sso.ts` 130 + `permissions.ts` 92 + `token.ts` 36）→ `src/marschat.ts`（54 行）+ `config.ts` 重写（41→188）。**踩中并修掉一个既存缺陷**：`utils/errorReporter.ts` 用的是**相对路径** `from "./token"`，按 `@/utils/...` 扫会漏（第 9 个引用文件）。验证：类型错误 27→**24（全为存量，改动行零新增）** · 构建 EXIT=0 · 旧适配层符号清零 · `--frozen-lockfile` EXIT=0。✅ **已上线**（#838 SUCCESS 234s）· **产物级**：线上入口 `index-BRwFFODT.js` 含 `homePath:"/dashboard"`（本轮 F-1 才新增的字段）⇒ 确为新包 |
| **T-ENG-3e** | ✅ **cosmic-studio 迁移完成并上线（2026-10-07）** | 删 `utils/permissions.js`（81 行）+ `utils/sso.js` 瘦身（213→206）→ `src/marschat.js`（103 行）+ `config.js`（149 行）。**保留 `buildWatcherOptions` 的手写 JWT 解码**（组件库 `decodeClaims` 对 cosmic 两段式 token 必败）；**保留本地 `TOKEN_KIND_KEY` 常量**（`removeTokenKind` 在 auth-components 的 `index.ts` **未 re-export**、产物符号计数 0 ⇒ 组件库并未导出它）。顺带落实 T-LOW-18：`tsconfig.check.json`（`checkJs`）+ `vue-shim.d.ts` + `npm run typecheck`（EXIT=0）。⚠️ **`.js` 里不能用 `as const`/`satisfies`**（TS 语法糖）⇒ 须用 JSDoc `@type`。✅ **已上线**（#121 SUCCESS 277s，**push 自动触发** —— 该仓 `.woodpecker.yml` 为 `event:[push,manual]` 且触发源是 GitHub，**必须双推**）· 产物级：入口 `index-BoSMdXZq.js` 含 `permissionsIssuer`（0.1.4 新增能力） |
| **T-ENG-3f** | ✅ **portal 前后端迁移完成并上线（2026-10-07）** | 前端删 2 个适配层 **261 行** → `marschat.ts`（66 行）+ `config/session.ts`（163 行）；后端删 `proxyAdminCenter`（`/admin/**` 全通配）+ `LocalAccountReporter`（111 行）→ `bff-whitelist.yml`（**15 条**）+ `MarschatPortalBffConfig` + `PortalAdminGateInterceptor`（**三道闸**）。**迁移中修掉两个由删除引入的缺陷**：① **越权**（删方法时连删两道 admin 闸，`/admin/**` 只剩「已登录」一道门）② **resolver 返回 username 当凭据**（`javap` 证实返回值直接进 `Authorization` 头 ⇒ 必然全 401）。最终三道闸：本地 role(403) → `hasSsoSession` 前置(401) → 中心权限点(401)，superadmin 恒放行。验证：`mvn clean package` EXIT=0 · **VerifyBff 58/58**（含 8 条闸门静态契约，**变异测试自证有效**：`if(true)` 短路与丢弃返回值两个变异体均被抓）· jar 三项齐备。✅ **已上线**（#839 后端 145s + #840 前端 90s）· **BFF 日志「已加载 15 条规则」**逐条与设计一致 · **「[账号上报] 成功：16 个本地账号已登记」**（auth-core 公共上报器已接管被删的 LocalAccountReporter）· 管理面无 token → **401**（`portal_jwt_reject reason=NO_BEARER`，证明进了闸门链路而非 404/500）|
| **T-ENG-4** | 🟡 **`menus.ts` 由 `menu-registry.yml` 生成** | 菜单目前双份手写（后端 yml 15 节点 ↔ 前端 `createKbMenus()` 15 节点），靠「严格对齐、禁止改名」的注释约束 = 靠人自觉。需定方向（建议 yml 为真源 → 生成 ts）后加生成步骤 + 门禁比对 |
| **T-ENG-5** | 🟠 **无构建应用（UMD）的「配置化接入」路径不存在** | activecode 是纯静态页（无 `package.json`/打包器/`vue-router`）⇒ **`@marschat/app-kit` 完全不适用**。其前端接入面**仍是手写**：`sso.js` **418 行** + 6 个 HTML 各自处理会话 + `members.html` 手写用户管理。**不是实现缺陷，是路径缺失** —— 需新增 UMD 版装配层（`createMarschatUmdApp` + 页面级会话守卫 + 页面模板 + `UserManagementPanel` 的 UMD 出口）。建议 **Phase 14 评估**，优先级低于把 3 个已迁 SPA 铺开。⚠️ 另：UMD 产物自报 `version="0.8.7"` 与 `VENDORED.md` 的 0.8.8 戳不一致（`T-LOW-3` 仍未闭合） |

| **T-ENG-7** | 🟢 **portal 权限普查已完成（2026-10-08 只读实测）：现实影响为零，机制缺口仍在** | 三条实测结论：① 中心权限点 `api:admin` **确实存在**（`marschat_auth.sys_permission` id=**2493**，client_id=`marschat-portal`）⇒ 推翻此前「表里根本没有这个权限点」的判断；② 唯一持有者 = 角色 id **36**（`marschat-portal` / code=`admin`），唯一被授权用户 = `user_id 1`（`admin` / superadmin）⇒ **非超管的 admin 必卡第③道闸**；③ portal 侧活跃 `role=admin` 仅 **3 个且全部是测试账号**（`p9g3adm`·`p9g3adm2`·`p13test_admin`），三者中心影子账号均 `deleted=1` 且**无** portal 角色绑定 ⇒ **无真实业务管理员受影响**。⇒ **待拍板**：是否给 `role=admin` 补中心授权（属**生产授权变更**，需人工确认后执行）；在此之前，新建的本地 admin 仍会 401 |
| **T-ENG-9** | ✅ **P0 已修复上线（2026-10-08）：hutool `JWTSigner` 非线程安全 → 登录成功后偶发 401** | 症状：登录成功 → 紧随的业务请求**偶发真 401**（`reason=BAD_SIGNATURE`）→ 前端硬踢回登录页，**重试即愈**。四步证伪定位：① token 指纹与登录响应**一致**（排除客户端拿错）② 纯验签串行 20 + 并发 60 **0 失败**（排除密钥/过期）③ **外部重算 HMAC 与被拒 token 自带签名一致** ⇒ 🔑 **token 合法、服务端自己算错** ④ 混发实验（6 登录 + 6 业务 ×10 轮）**5/60（≈8%）失败**，纯读对照组 0 ⇒ 差异只在「有无并发 sign」。**根因**：hutool `JWTUtil.verify` 是「用同一个 signer 重签再比对」，而 `HMacJWTSigner` 内部 `Mac` **有状态、非线程安全** ⇒ 签与验交错时中间态互相踩踏。**修复**：`JwtUtil` 改 `ThreadLocal<JWTSigner>`（提交 `bd83f1d0`，流水线 #843）。**验证**：同实验 `ROUNDS=20`/120 次 ⇒ **失败 0**；真浏览器 **7/7 PASS**。**普查**：全仓仅 portal 用 hutool JWT，其余（infra / kb-* / auth-center）走 **jjwt**（`SecretKey` 不可变）⇒ 不受影响。**顺带闭合 §8.6 悬案**：TROUBLESHOOTING §8.6「portal 自签 token 逻辑上不可能触发该分支」**已被推翻**（当年用反编译证伪跑时问题，路径错误），真因即本节。**详见 `TROUBLESHOOTING.md` §9** |
| **T-ENG-8** | ✅ **portal 账密管理员凭据链（已修复、已上线、已四重验证）** | 本轮**纠正了一个错误结论**：此前判定「账密管理员调管理面必然 401 属架构必然」，实测证明**错** —— 中心的 `AuthServiceImpl.login:93-95` 与 SSO 换票**走同一个 `jwtTokenProvider`**，`JwtAuthenticationFilter:50-58` 也明确接受 legacy 分支，即**账密登录本来就返回一把能直调 `/admin/**` 的 access_token**；此前 401 的真因是 portal **没把它留下来**。✅ **已修**：新增 `loginAccessTokens` 池 + `resolveAccessToken()` 按渠道自动取 + 账密/邮箱码登录时各存一次。⚠️ **两池不可合并** —— `refreshTokens` 存的是 refresh_token，混用会「拿 access_token 当 refresh_token 去换」必然失败。**真机已验证**：账密 admin/superadmin 访问管理面 **HTTP 200**（真实用户列表）· 普通 user → **403**（第①道闸）。✅ **2026-10-08 已补齐（待上线复验）**：修复前是**双重缺失** —— 后端 `/api/auth/logout` **空实现** + 前端 `userStore.logout()` **根本没调它**（`api/auth.ts` 里的 `logout()` 是死代码）⇒ 用户点了退出，服务端手里那枚可直调 `/admin/**` 的中心 access_token **原封不动**。已补齐四步链路：① 取中心 access_token（`resolveAccessToken`）→ ② 中心 `POST /auth/logout` 拉黑（`revokeAccessToken` 写 `jwt_blacklist`）→ ③ 清本进程两池（`clearUserCredentials`，**无论 ② 成败**）→ ④ 客户端清 localStorage + SLO。全程 **best-effort**（吊销失败只 WARN，**绝不阻断登出**），并把 `/auth/logout` 加入 401 白名单，避免 401 分支抢先 `clearSession` 与 SLO 抢导航。✅ **2026-10-08 已上线并四重验证**（#841 portal-server / #842 portal-web）：① **真实 HTTP 端到端** —— 登出前管理端点 200 → `POST /auth/logout` 200 → **同一枚 token 再调管理端点 401**「无统一认证会话，请使用统一认证登录」（正是第②道闸，证明服务端凭据池已清空）→ 重新登录 200（凭据可重建，非永久锁死）；② **服务端日志** `登出：服务端凭据已清理 userId=1 hadToken=true revoked=true`（revoked=true ⇒ 中心已拉黑）；③ **中心 `jwt_blacklist` 4 → 5 条**（新增 max_id=22，expire_at 与本次登出时刻吻合）；④ **真浏览器走完整路径** —— `/portal/` → 账密登录（`portal_token_kind=legacy`）→ `/portal/users` 渲染 **2 行真实数据** → 用户菜单「退出登录」→ 确认 → 回登录页 → **localStorage 全空**。⚠️ 排查期间另发现「部署窗口后 ~9 分钟内登录偶发 401(BAD_SIGNATURE)」瞬态现象（3 次失败后 5/5 稳定通过），**已如实登记**于 `portal/docs/PHASE13-配置化接入迁移记录.md` §9，机制未证实，不粉饰 |

### 1.3 🟡 需协同执行（必须与另一动作同窗口）

| # | 事项 | 为什么必须同窗口 |
|---|---|---|
| **T-SYN-1** | **apps-registry 明文 secret 默认值改 env-only** | `apps-registry.yml` 中 portal client secret 与 kbweb / inframon / activecode 的 `menu-report-secret` **仍是明文默认值**（cosmic 已是 env-only 写法，照抄即可）。⚠️ **改前必须确认部署机已注入同名 env**，否则 portal 客户端密文失效 / 上报静默降级；且改 `clients.yml` 会**触发 auth-center 枢纽重建** |

### 1.4 🔵 低优先 / 技术债

| # | 事项 | 说明 |
|---|---|---|
| **T-LOW-1** | admin 自助重置密码仍走**明文邮件** | 建议改中心令牌重置 / 模板化，移除明文邮件 |
| **T-LOW-2** | 中心凭据暂存**进程内存** | 应用侧 `CenterSessionStore` / `_oidc_tokens` 等 → 应用重启即 401、多副本不共享。建议迁 Redis 或共享存储 |
| **T-LOW-3** | **UMD 版本戳与产物不一致** | `VENDORED-auth-core-umd.md` 标 0.8.8，产物自报 `version="0.8.7"`（发版只改戳未重建）。功能无差异。下次发版**强制重建 UMD**，或给 `sync-auth-core-umd.sh` 加「戳 == 产物内常量」门禁 |
| **T-LOW-4** | CI 未 wiring UMD 同步 | `woodScript/ci/build-active-manager.sh` 从未调用 `sync-auth-core-umd.sh` → 靠人工记得。建议加同步步骤或漂移检测 |
| **T-LOW-5** | cosmic `/admin` 路由语义撞车 | 路由 `path:'admin'` 同时承载「LLM 配置」与「本系统用户」；建议改名 `members` 并拆分路由（影响直达链接 / menu-registry / nginx） |
| **T-LOW-6** | OIDC 径无 `tv` 版本校验 | RS256 径不校验 token 版本 → 删/停用后旧 token 在有效期内仍可用（改造前即存在） |
| **T-LOW-7** | 应用侧「移出本系统」可被超管例外绕过 | 建议加显式拒绝名单 / 停用能力 |
| **T-LOW-8** | infra 忘记密码借道 kb-gateway | mykng 不可用则 infra 无法自助改密 → 建议 infra nginx 增直连 auth-center 的 `/auth-api/` 路由 |
| **T-LOW-9** | `sys_app_client` 含 0 权限点客户端 | `marschat-tokenhub`（0 权限点）/ `marschat-memory` / `frp-manager` / `p3-probe-client` —— 待确认清理或补齐 |
| **T-LOW-10** | kb-ops 平台级页签归属待定 | 「菜单授权」页签已加 `isPlatformAdmin` 守卫（保入口）；另一选项是整体迁至 portal 中心台 |
| **T-LOW-11** | **用户管理页视觉 16 项待排期** | 元素级清单：操作列 5 个 link 按钮、色语义重叠、三套外壳主题、低对比度（未授权态约 2.3:1）、框中框等。清单见 `archive/portal-401/architect-fix-plan.md` §3.2 |
| **T-LOW-12** | portal 共享槽修复（原"修复件②"）未做、且已降级 | `AuthCenterService.refreshTokens` = 进程内 `Map<Long,String>`、**键=userId 单槽、无锁** → 产 `invalid_grant`。但它是 **HTTP 200 + `code:401`（不硬踢）** ⇒ 已判定为硬踢症状的**红鲱鱼**，待 E0 的 `reason` 分布出来再定是否值得修 |
| **T-LOW-13** | activecode 本地账号体系与中心收敛仍有差距 | 其本地仍存 `AdminUser` 表 + 自研 SHA-256 加盐 + 弱默认口令；后端**未引 auth-core**（前端 SSO 已用内联 UMD 组件）。与「账密真源归一」目标尚有距离。**注**：T-ENG-3 迁移时它会第一次引入 auth-core，可顺带收敛 |
| **T-LOW-14** | **`SidebarMenu` 长期零引用**（Phase 13 审计发现） | `@marschat/frontend-common` 导出 `SidebarMenu` 但**全仓 0 引用**；各应用自写 `MainLayout.vue`（kb-web 675 / kb-ops 307 / infra 280 行）→ 三套外壳 → `T-LOW-11` 的 16 项视觉债。**已提供解法**：`@marschat/app-kit` 的 `createShell()`。待 T-ENG-3 迁移时一并切换 |
| **T-LOW-15** | **`sso.ts` 兼容转发壳固化** | 各应用 `sso.ts` 16 个导出 / 126~168 行，多为「保持旧调用名不变」的转发别名（含 1 处 `@deprecated`）。属迁移期正确取舍但被固化。建议随 T-ENG-3 迁移时一并删除，勿再新增别名。**kb-ops 已删除**（其 `sso.ts`/`permissions.ts`/`token.ts` 三份共 263 行已移除） |
| **T-LOW-16** | 🔴 **各应用需自查「`createRequest` 的 `hooks` 参数被静默忽略」** | `frontend-common@0.3.5` 的 `CreateRequestOptions` **无 `hooks` 字段**（已发布产物 `grep -c hooks dist/*.js` = **0**）。凡按 `createRequest({ hooks: { onError, onUnauthorized } })` 写的应用，**两个回调全部失效**，落到默认 `onUnauthorized = clearTokens() + location.href='/login'` → OIDC 静默续期分流成死代码。**kb-ops 已修**（迁移时发现）；**需逐应用 grep 自查**（`grep -rn "hooks:" --include=*.ts`） |
| **T-LOW-17** | 🔴 **各应用需自查「SecurityConfig 显式 401 entry point」** | kb-ops 此前缺失 → 未携带 token 返 **403**、无效 token 返 **401**，同一语义两种状态码；前端 401 拦截器遇 403 不续期不跳登录 → 页面假死。README Level 4 检查清单 C 组已列为必检项，但**当时只写进文档没进门禁**。**kb-ops 已补**；infra-monitor **本就有**（2026-09-14 已修）→ 剩余 4 应用随 T-ENG-3 迁移时逐一体检 |
| **T-LOW-18** | 🔴 **各前端 tsconfig 的 `@marschat/*` 源码别名会把组件库源码拉进类型检查，并可能让 `vue-tsc` 内部崩溃** | infra-monitor 实测 `Error: Debug Failure. No error for last overload signature`，**完全无法类型检查**。二分确认：**触发源在 `auth-components` 源码**（只加回该别名即崩）；但别名是**必要非充分**条件（portal 有同样别名却不崩）。修复 = **移除源码别名**，三个 `@marschat/*` 统一从 node_modules 解析（infra 已修，5 个错误全为存量）。**`devtools/portal/tsconfig.json` 同样有这两条别名，建议随其迁移一并移除**。⚠️ 另需排查：应用是否把 `typecheck` 接进 CI —— 目前 `build` 脚本普遍只有 `vite build`，**不做类型检查**，所以这类问题能长期潜伏 |

### 1.5 ⚪ 待观察（**不臆断为缺陷**）

| # | 现象 | 处置 |
|---|---|---|
| **T-OBS-1** | kb-web 一次 `[api] 请求失败`、infra 一次 401 console 报错 | 专项复跑 **3 轮 0 命中** → 登记待观察；再次出现需带完整请求上下文与时间点上报 |
| **T-OBS-2** | 邮箱验证码**闭环**未验 | 已验证「发送 + 60s 频控 + 错误文案」；真收码闭环需真实邮箱，未执行 |
| **T-OBS-3** | portal S3/S4「身份守卫链路」缺陷（链路 B） | 与硬踢 401 **是两条不同链路**（已独立登记）：现象为停在 `/portal/auth/callback?code=…`、`POST .../sso/exchange` **未被发出**、**全程 0 个 `/portal/api/**` 401**。待 D-1/D-2 落地后单独复验 |
| **T-OBS-4** | E0 后验基线尚未采集 | E0 结构化采样日志**已上线并实测落点正确**；但三条 headless 自验按**冻结令**暂缓（制造真 401 会在生产日志留痕、污染后验基线）。解冻后统一跑，用于定格 `reason` 分布 —— 这是闭合 portal 401 归因的**唯一剩余手段** |

### 1.6 📁 文档 / 资产整理（2026-09-19 新登记）

| # | 事项 | 现状 |
|---|---|---|
| **T-DOC-1** | ✅ **已完成（2026-09-19）** | 散落文档已全量审计并归档 —— **22 份**复制进 `docs/archive/`（6 份 p12 设计规格 + 13 份 portal 401 专项 + 2 份 Phase 11 复盘 + 1 份 activecode UMD 机制），其中 2 份含明文凭据者**已脱敏**。索引与「未归档清单（去冗余依据）」见 `docs/archive/README.md`。⚠️ **只复制未移动**（源会话工作区可能仍活跃） |
| **T-DOC-3** | 🔴 **明文凭据文件待处置**（本次审计发现） | `devtools/账密清单_审核用.md`（5.7KB，**未被 git 跟踪** ✅）含**全栈明文凭据**：SSH 口令 / MySQL root / Nacos·MinIO·MeiliSearch·MongoDB 口令 / `JWT_SECRET` / `CRYPTO_AES_KEY` / `MEILI_MASTER_KEY` / Vaultwarden ADMIN_TOKEN。文件自带「审核后删除」字样。**建议：凭据入 Vaultwarden 后删除该文件**。另 `devtools/active-manager/docs/v2/{deploy,usage}.md` 亦含明文口令，建议一并清理 |
| **T-DOC-4** | auth-center 仓自带 ADR 索引过期 | `auth-center/docs/adr/INDEX.md` 声明 AUTO-GENERATED，但生成脚本已不存在；仅 2 条 2026-09-08 条目，**缺 Phase 11/12 权威 ADR**，且仍指向已并入 `ADR-2026-09-10 §38` 的旧文件。建议删除或改为指向 `devtools/docs/adr/INDEX.md` |
| **T-DOC-5** | 跨仓文档口径冲突 | `config-as-code/docs/adr/adr-2026-01-09-marschat-components-monorepo.md` 的「6 应用」口径与现行不一致（含 `tokenhub`、漏 `cosmic-studio`）。建议加交叉链接并订正 |
| **T-REG-1** | **回归脚本散落、未版本化** | 散在 3 个会话工作区的 `verify/` 目录（详见 README 第三篇 §4 表）。历史 `wb_p10_*.py` 一批**已随工作区清理丢失**。建议收敛为仓库内单一 `verify/` 入口 + README 用法说明 |
| **T-DOC-2** | 文档漂移已批量修正（本轮） | 已修：README 重复 §6.1、缺失「第二篇」标题、`sys_user`→`user`、F1 密钥处数（2→3）、Phase 11 过时待办、UMD 版本口径、`verify/phase10` 断链引用；ADR INDEX 状态订正 + 超长单元格瘦身 + 补登文档地图。**历史文档内仍有零星 `sys_user` 写法，属历史快照不改** |

---

## 2. ✅ 近期已闭合（**避免重复开工**）

> 「已完成清单」只保留**最近三轮**，更早见 `ADR-2026-09-10` §12–§37 与 `PHASE12-SUMMARY` §3。

| 轮次 | 闭合项 |
|---|---|
| **Phase 13**（10-05~10-07） | 🆕 **接入架构审计**：实测各应用原需手写 1100~2300 行接入胶水，定位 6 个架构缺口（BFF 三件套未公共化 / Shell 未收敛 / 菜单双份定义 / 兼容壳固化 / 无脚手架 / portal 不同构）｜✅ **公共包**：`auth-core@2.2.0` BFF 自动装配（白名单配置化 + 凭据三模式 + 账号上报 SPI，单测 **74 通过**）+ `@marschat/app-kit` 装配层（`createMarschatApp`/`createShell`，**0.1.3 + 0.1.4** 已发 Nexus）｜✅ **5/6 应用迁移完成并上线**（kb-ops / infra-monitor / kb-web / cosmic-studio / portal）｜✅ **接入成本实测：前端 1100~2300 行 → 30~66 行声明式装配；后端 472~1106 行手写 Controller → 0 行 Java + 一份 YAML**｜✅ **本轮三应用净删 573 行**（kb-web −258 / cosmic −54 / portal −261 + 后端 Java −190）｜✅ **四流水线全绿** + **产物级四层验证**（入口 chunk 与服务器一致 ⇒ 确认非旧包）+ **真浏览器走操作路径截图**（账密登录 → 用户管理页渲染真实数据，CONSOLE=[]）｜✅ **修掉 5 个真缺陷**（全为「不报错、悄悄失效」类）：portal 越权 / resolver 返回 username（javap 证实必全 401）/ `path-prefix` 带 context-path（全 404）/ `setSession` 漏导出（邮箱码登录不可用）/ kb-web 缺 `homePath`（低频白屏）｜✅ **纠正一个错误结论**：账密管理员「必然 401」并非架构必然，而是 portal **没把中心已签发的 access_token 留下来**，已修并真机验证 200｜⏳ 剩余：**activecode 前端**（无构建 UMD，见 T-ENG-5）+ **T-ENG-7 存量 admin 授权普查** |
| **R6**（09-18） | 🔴 **D2 高危**：portal / activecode 本地改密端点**真改本地影子口令**（中心不变 → 身份分裂）→ 已下线 **410 Gone** + 引导走中心（portal 下拉改「重置密码（走统一认证）」）｜🟡 D3：`auth.marschat.online/favicon.ico` 403/404 → 已放行 + 补图标｜🟢 认知订正：**kb-web 改密经 kb-gateway 代理到中心 = 正确范式**（已写入手册 §6.0） |
| **R5**（09-17 晚） | **kb-ops 假闸门整改**：10 个 Controller 补 **25 个 api 写点** + `SyncController` 补闸门，`apis` 段 3 → **28**；实测「**开菜单 ≠ 给写权限**」（只授 menu 时 GET 200 / POST·DELETE 403）｜**E2E A~F 全通过**（SSO 免登 5/5、口令输入总次数 = 1、邮箱码频控、防枚举同文案、免登短路回归、activecode 匿名闸门 401）｜已认证端到端闭合 |
| **R4**（09-17 下午） | BFF 重复 `client` 参数（HPP）加固 ×3｜kb-ops「菜单授权」页修复 + 页签守卫｜portal「有意不设 public 菜单」注释｜结案：portal 忘记密码（nginx 直连中心，线上 200 可用）、infra 忘记密码（可用，但耦合仍在 → T-LOW-8） |
| **P0**（09-16/17） | portal 免登短路移除｜cosmic 上报 secret 配置真源补齐｜activecode 接口闸门 + 匿名洞收敛 |
| **Phase 12 主体** | 三层权限 API（含 D-7 受限读端点 + R8 自锁，实测 23/23）｜auth-components 0.8.8（app 作用域只读）｜各应用 BFF 白名单收窄（默认拒绝）｜kb-web / kb-ops `/admin` 同源化 |
| **Phase 11 主体** | 账密真源归一（六应用）｜双用户管理菜单定型｜D9–D18 全部修复（含 D8 更正：kb 系无需改造）｜`code.generate` 冗余权限点清理 |
| **文档归档**（09-19） | 全量审计「登录 / 用户管理」主题的散落文档：**22 份**归档进 `docs/archive/`（2 份已脱敏）｜`TROUBLESHOOTING` 新增 **§8 portal 401 与登录链路约定陷阱**｜`T-DOC-1` 销账 |

---

## 3. 已知取舍与风险登记（**设计选择，非缺陷**）

| # | 项 | 说明 |
|---|---|---|
| 1 | 前端守卫 **fail-open** | SSO / 权限探针失败时不拦用户（防中心抖动踢在线用户），靠**接口层 403 兜底** |
| 2 | 管理页数据接口 **fail-closed** | BFF 拿不到中心凭据 / 中心不可达 → 明确 401/502，**不返回空列表冒充成功** |
| 3 | 应用账密登录**强依赖中心可用性** | 中心故障 → 全平台不可登录（SSO 本就是强依赖，未恶化）。**需优先保障中心高可用** |
| 4 | cosmic 权限查询 401 → 菜单 **fail-open** | 中心令牌 30 min 过期窗口内菜单级限制暂失效；**写接口硬闸门不受影响** |
| 5 | 账号上报**仅启动时**执行 | 运行期新建本地账号需重启才登记 |
| 6 | `sendError(401)` 与 `sendError(403)` 的**理由文案不可见** | nginx/Spring 错误页不携带原因，排查需看容器日志 |
| 7 | IdP 会话 Cookie **未标 Secure** | 建议 nginx / 应用层统一加固 |
| 8 | 无 `api:admin:write` 权限点的 client **无应用管理员** | 判据依赖该 client 定义该权限点；未定义者只有平台管理员可管（fail-closed），符合最小权限 |

---

## 4. 关键环境与可复核命令

| 项 | 值 |
|---|---|
| mykng（主开发运维机） | `ssh root@192.168.31.105`（免密） |
| auth-center | `http://192.168.31.105:8085`（health / oidc / login.html） |
| activecode | `http://192.168.31.182:18080/activecode/`（**不在 mykng**） |
| cosmic-studio | `http://192.168.31.105:8310` |
| infra-monitor | `http://127.0.0.1:8088/infra`（host 网络） |
| 公网唯一入口 | 腾讯云 2 号 `1.117.70.30`（其余主机不应有独立公网入方向端口） |
| Woodpecker | `https://woodci.marschat.online`；repo_id：**1**=devtools(dev) / **2**=workcheck_python / **3**=cosmic-studio(main) / **4**=auth-center(main) / **5**=marschat-components(main) |
| 流水线脚本 | mykng `/root/devtools/woodScript/`（`check-pipeline.py --watch N --repo N`；**位置参数是流水线编号，不是数量**） |
| MySQL | 容器 `platform-mysql-1`，库 `marschat_auth`（root 密码见容器 env） |
| 审计表 | `marschat_auth.operation_log`（user_id / username / action / resource_type / resource_id / detail / ip） |
| 服务器工作克隆 | `/root/auth-center-work`、`/root/components-work`、`/root/devtools/cosmic-studio`、`/root/devtools`（woodScript） |
| 凭据真源 | Vaultwarden `vault.marschat.online:8222`（**严禁写入任何文档 / 仓库**） |

**⚠️ 操作红线（沿 ADR-2026-09-10 §13.1 与 §18.7）**：
1. **work_check / workcheck-python 永久禁区** —— 任何改动、配置、数据库、SSO 接入都不得波及。
2. **禁止 `all` 全量触发流水线**（会压垮宿主）；一次只跑一条，避免 `/mnt/shared/auth-center-build` 并发踩踏。
3. **部署脚本退出码不可信** —— 必须独立核验容器状态 + 健康端点 + 流水线历史。
4. **改 auth-center 前先算爆炸半径**（被 12 应用依赖）。
5. **push 后用 `git ls-remote` 核对远端 tip**（本机 `.git` refs 落盘异常，本地 status 不可信）。

---

## 5. 建议执行路线（下一轮）

| 序 | 任务 | 依赖 | 备注 |
|---|---|---|---|
| 1 | **T-SYN-1** apps-registry 明文 secret 改 env-only | 确认部署机已注入 env | 低风险、消除凭据入 git；须接受一次枢纽重建 |
| 2 | **T-ENG-1** 应用台 Membership API path 化 | 组件契约扩展 | 需改组件 + 6 宿主页 + activecode 手写页，是权限边界的**最后一层** |
| 3 | **T-LOW-3 / T-LOW-4** UMD 重建 + CI wiring | 无 | 一次发版顺手做完，消除溯源链断裂 |
| 4 | **T-DOC-1 / T-REG-1** 文档与脚本归档 | 无 | 纯整理，可并行穿插 |
| 5 | **T-DEC-1** F1 密钥轮换 | **拍板** | 单独立项；先在低峰期抓流量确认无 HS 发签方 |
| 6 | **T-DEC-2** 3.2-B 令牌分离 | **拍板** | 建议列为 Phase 13 专项，第一版只覆盖 `/kb/api/admin/**` |

---

*维护约定：本表由「完成即销账、新发现即登记」维护；每次落地后请更新 §1 与 §2，并在 `README.md` 文档地图中保持指针有效。*
