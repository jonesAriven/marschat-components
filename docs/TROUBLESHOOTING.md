# 排查手册 · 统一认证平台（症状 → 定位 → 根因）

> 配套：`README.md`（权威手册：设计 / 接入 / 使用运维）· `STATUS.md`（未决项与待办）· `CONFIG-REFERENCE.md`（配置项与环境变量全表）
> **用法**：按「症状」检索 → 按「定位路径」逐跳验证 → 对号「根因」。**禁止跳步猜根因**（铁律 `trace_terminal`）。
> 本文不含任何口令 / secret 明文；凭据见 Vaultwarden（`vault.marschat.online`）或 infrastructure-map 技能。

---

## 0. 30 秒决策树

```
问题在「登录」还是「登录后」？
├─ 登录前（跳转/免登/表单）  → §1
├─ 登录后（菜单/按钮/接口）  → §2
├─ 「我改了但没生效」        → §3（产物与部署）
└─ 「偶发、重试一次就好了」   → §9（并发 / 共享可变状态）  ← 最容易被误判成"环境问题"
再有就是「数据/配置」与「授权」→ §4
无论哪类，动手前先跑 §5 取证命令集拿事实，不要凭印象
```
> 🔴 **先看这句**：若「多个应用同时炸」且「IdP 页面能开、口令能过但换码 500」、
>  或有 `(1290 …read-only…)` 字样 —— **去 §10，10 秒查 `@@super_read_only` 即可定性**，
>  不要在组件代码里找根因（2026-10-18 六应用 SSO 全线 500 的翻车记录）。

**三条铁律前置**：
1. **区分「没生效」与「没部署」** —— 先看线上产物，再看代码（坑 #24）。
2. **区分「产品缺陷」与「测试脚本缺陷」** —— 本文档记录了我们自己踩过的 5 次误判（§6），动手改产品前先排除。
3. **判定口径要写死**（例：403＋业务文案＝闸门拦下；404＝路径不存在；200＝已穿过闸门）。

---

## 1. 登录类

### 1.1 登录页空白 / 不渲染

| 项 | 内容 |
|---|---|
| **定位** | ① 浏览器 Console 是否有 JS 报错；② `body.innerHTML` 是否为空；③ 该应用 `public/app-config.json` 能否取到 |
| **常见根因** | ① `app-config.json` 里有 `//` 注释横幅未剥离 → 运行时配置 parse 失败（坑 #4）；② 运行时 `apiBase` 指向不可达地址；③ 组件版本与宿主不匹配 |
| **命令** | `curl -s https://<app>/<ctx>/app-config.json \| head` |
| **修复方向** | 确认 config.ts 先剥 `//` 再 parse；核对 `apps-registry.yml → gen-from-registry.py` 派生值 |

### 1.2 免登失效（明明 IdP 会话还在，却要求重新输密码）

| 项 | 内容 |
|---|---|
| **定位** | ① 先确认 **是用真 SSO 径**（不是应用内账密登录）；② 检查登录页是否存在 `*_reauth_once` 一次性短路标记；③ 清空 localStorage 后重试 |
| **常见根因** | ① **登录页做了「一次性重授权标记」短路**，标记只在失败分支清除 → 成功分支残留后永久短路（坑 #28，portal / cosmic 都踩过）；② 用持久 profile 测试造成假阳性（坑 #27） |
| **命令** | 浏览器 Console：`Object.keys(sessionStorage).filter(k=>k.includes('reauth'))` 应为空 |
| **修复方向** | 删掉一次性短路，**进登录页必探一次 IdP 会话** |

### 1.3 401 后被弹回登录页 / 页面假死

| 项 | 内容 |
|---|---|
| **定位** | ① Network 看 401 响应的来源；② 判断 token 类型是否 OIDC（`token_kind=oidc`） |
| **常见根因** | ① **后端 SecurityConfig 没显式 401 entry point** → 过期 token 返回 403，前端 401 拦截器**永不触发** → 页面假死（坑 #2，最容易漏）；② 401 分流**先判 refresh_token 再判 OIDC** → OIDC 用户被弹回登录页（坑 #3）；③ 续期回跳传了 `location.pathname`（含部署前缀）→ `/app/app/...` 404（坑 #1） |
| **命令** | `curl -s -o /dev/null -w '%{http_code}' <受保护接口>`（无 token）→ 期望 **401**，若为 403 即命中本节 |
| **修复方向** | SecurityConfig 显式 `.authenticationEntryPoint(... res.sendError(401))`；401 分流先 `isOidcToken()`；续期传 **router 内部路径** |

### 1.4 点 SSO 后跳转 404 / 白页

| 项 | 内容 |
|---|---|
| **定位** | ① 看 `redirect_uri` 是否在 `apps-registry.yml` 登记（三环境：公网 / 内网 / localhost）；② 看 `sso-callback` 路由是否存在 |
| **常见根因** | ① redirect_uri 未登记 → IdP 拒绝；② `window.__MARSCHAT_APP_BASE__` 未设 → 公共库跳登录拼到域名根 404（坑 #6）；③ IdP Cookie 域是 `marschat.online` → **内网 IP 直连无静默免登**（坑 #11，属预期非缺陷） |
| **命令** | `python scripts/gen-from-registry.py` 后核对产物 `clients.yml` / `app-config.json` |

### 1.5 「忘记密码」点了没反应

| 项 | 内容 |
|---|---|
| **定位** | 确认点的是**叶子元素** `a.forgot-link`（不是父 `div.forgot-line`）|
| **根因** | 组件把 `@click.prevent="startForgotPassword"` 绑在 `<a>` 上；自动化脚本若点到父 div（事件只向上冒泡）会**无反应**。**这是测试脚本缺陷，不是产品缺陷**（§6-②） |
| **命令** | Console：`document.querySelector('a.forgot-link').click()` → 应切到「忘记密码 / 请输入您的注册邮箱」 |

---

### 1.6 SSO 回调后提示「统一认证登录失败 / username 与 token 不一致」

| 项 | 内容 |
|---|---|
| **症状** | 点「统一认证登录」→ IdP 登录成功 → 回跳应用 `sso-callback` → 红框 `SSO 登录后端失败: username 与 token 不一致` |
| **定位** | ① 解码两个令牌的声明（浏览器 Console）：`JSON.parse(atob(token.split('.')[1]))`；② 对比「前端将要送出的 username」与「后端将要取的 tokenUsername」是否同源；③ 带会话打 `/api/auth/session` 看最终身份 |
| **根因（2026-09-17 实测，缺陷 D1）** | 中心 SAS 令牌 **`sub` 是用户 ID**（实测 `"1"`）、**`username` 才是登录名**（实测 `"admin"`），且 **id_token 不签发 `username`/`preferred_username`/`unique_name`**（只有 sub）。前端 `activecode/sso.js` 从 **id_token** 取 `preferred_username ‖ unique_name ‖ sub` → 只能拿到 `sub`（`"1"`）；后端 `/sso-login` 从 **access_token** 取 `username`（`"admin"`）→ 必然不等。F2 修复只改了后端没改前端 ⇒ **契约漂移** |
| **口令** | **凡「按用户名认身份」的逻辑，必须从 access_token 取 `username` 声明，绝不用 `sub`（那是 uid）** |
| **修复范式（已落地，其它应用可照抄）** | ① 前端与后端**同序同名**取 `username → preferred_username → sub`；② 后端**身份一律以验签令牌声明为准**，请求体 username 降级为客户端自述 —— 不一致记 WARN 不阻断。硬校验并不增加安全性（会话主体本就来自验签令牌），却会把「客户端取错字段」放大成「整条 SSO 通道不可用」 |
| **验证** | `GET /activecode/api/auth/session`（带会话）→ 期望 `{"username":"admin","success":true}`；`localStorage.activecode_sso_user` 应为 `admin`（修复前是 `"1"`） |

### 1.7 改密「显示成功」但别的应用还是老口令（身份分裂）

| 项 | 内容 |
|---|---|
| **症状** | 在某应用改密 → 提示「修改成功」，但用新口令登其它应用失败；用**旧**口令登其它应用反而成功 |
| **定位** | ① 该应用的改密端点改的是**哪里**：本地影子表（缺陷）还是中心（正确）；② 改完立刻用新旧两个口令分别打**中心** `/auth/login` 对比 |
| **根因（2026-09-18 实测）** | portal / activecode 的本地改密端点做的是「本地 salt/bcrypt 比对 + 改本地影子表」，**中心口令纹丝不动** ⇒ 同一用户名两套口令 |
| **现状** | **已修**：两端点下线为 **410 Gone** + 引导走中心；portal 下拉改「重置密码（走统一认证）」 |
| **正确范式** | kb-web：`PUT /kb/api/user/password` → kb-gateway `application.yml:86` 的 `/kb/api/user/**` 路由 → 中心，实测真改中心口令 |
| ⚠️ **排查纪律** | 改密端点是**会真改口令的写操作**。定位时优先用「错误旧口令应被拒」的**负例**；确需正例必须**先备还原路径**并在事后复核中心登录恢复（本轮踩中过一次） |

### 1.8 每个应用 Console 都有「Failed to load resource: 404」

| 项 | 内容 |
|---|---|
| **症状** | 六应用 SSO 流程各带一条 404，文本里**没有 URL** |
| **定位** | `Log.entryAdded` 只给文本。必须配合 `Network.responseReceived` 抓 URL —— 本轮抓到真身是 `https://auth.marschat.online/favicon.ico`（浏览器停 IdP 登录页时自动请求） |
| **根因** | 该路径落 auth-center 链3 的 `anyRequest().authenticated()` → 直连 8085 实测 403，经公网入口回落 404 |
| **现状** | **已修（三处联动）**：① auth-center 链3 `permitAll("/favicon.ico")` ② `static/favicon.ico` ③ **边缘 nginx** 补 `location = /favicon.ico` 精确匹配反代 |
| **坑** | 只做完 ①② 公网仍是 404 —— 该站点末尾 `location / { return 404; }`，未登记路径一律顶回。**排查要追到最末端节点**（`trace_terminal`） |

---

## 2. 权限类

### 2.1 登录后侧边栏一片空白

| 项 | 内容 |
|---|---|
| **定位** | ① 中心 `sys_permission` 是否有该 client 的点；② `sys_app_client.last_sync_at` 是否推进；③ 该应用是否有且仅有 1 个 `public: true` 菜单 |
| **根因** | **切 strict 前没上报 public 落地页** → strict 默认最小权限下普通用户拿不到任何菜单（坑 #17，每应用必须有且仅 1 个 public，portal 例外=0） |
| **命令** | `SELECT client_id,SUM(type='menu'),SUM(type='api'),SUM(is_public) FROM sys_permission GROUP BY client_id;` |

### 2.2 管理员菜单（如「用户管理」）整块消失

| 项 | 内容 |
|---|---|
| **根因** | 账密登录改走中心后，**本地 token 没带上中心返回的 `role`** → 前端 `isAdmin` 判定失效（坑 #21） |
| **定位** | 登录响应里 `data.user.role` 是否被写进本地会话；前端 `userStore.isAdmin` 是否为 true |

### 2.3 按钮点了报 403 / 404

| 现象 | 判定 | 根因 |
|---|---|---|
| **403** ＋ 业务文案 | 闸门拦下 | 该用户缺对应 `api:*` 权限点（**api 点任何模式都不自动授予**，坑 #17）；或跨 client 越界被中心挡 |
| **404** ＋「接口不存在」 | BFF 白名单拒绝 | 应用 BFF 是**白名单默认拒绝**（R2/R3 收窄后）→ 中心新端点若未登记即 404 |
| **404** 但中心直连同路径 200 | 确认是 BFF 所为 | 对照：直打中心同路径 |

> 口诀：**403＝你没权限；404＝这条路没开**。BFF 的 404 响应体固定 `{"code":404,"message":"接口不存在","data":null}`（**无 traceId**）；中心自有 404 带 `traceId`。

### 2.4 应用管理员点不动某页（例：kb-ops「菜单授权」）

| 项 | 内容 |
|---|---|
| **根因** | 「菜单授权」是**平台级**面板，走 `/admin/permissions`、`/admin/roles/{id}/permission-codes`。R3 收窄 kb-ops BFF 白名单时**漏放行这两条** → 平台管理员也点不动；R4 已补放行 + 前端页签加 `isPlatformAdmin` 守卫 |
| **定位** | 带会话 token：`GET /kb-ops/admin/permissions?client=marschat-kbops` → 期望 200（非 404） |
| **教训** | 白名单收窄必须**先盘点页面真实调用面**，再逐条登记；调用面盘点漏一条＝制造坏功能 |

---

## 3. 「我改了但没生效」类

> 这一类占实际排障时间最多，**必须按顺序排除**，不要跳步。

| # | 检查 | 命令 / 判据 |
|---|---|---|
| 1 | **代码推上去了吗** | `git ls-remote <remote> <branch>` 与本地 HEAD 比对（**不能看 push 无报错**，坑 #25） |
| 2 | **流水线跑了吗** | `python woodScript/check-pipeline.py --repo 1 <编号>`；注意 commit 哈希是否匹配 |
| 3 | **产物更新了吗** | 容器内 `grep -rl "<本次新增的独有文案>" <webroot>`；**流水线 SUCCESS ≠ 产物已更新**（坑 #24，Phase 11 实测：`UsersView` 线上仍是旧 chunk） |
| 4 | **浏览器拿到新产物了吗** | `index.html` 引用的 chunk 名是否变化；必要时硬刷新（前端强缓存） |
| 5 | **容器真重建了吗** | `docker ps --format '{{.Names}}|{{.Status}}|{{.CreatedAt}}'`（`restart` 不换镜像内代码，必须 `up -d --build`） |
| 6 | **后端 jar 换了吗** | `docker cp <c>:<jar> /tmp/x.jar && unzip -p /tmp/x.jar BOOT-INF/classes/<类>.class \| grep -a <新符号>` ← **本轮验证用的硬证据手法** |

**构建失败特例**：`sass` 未进 `devDependencies` 时 `lang="scss"` 组件会**静默失败**且真错误被 vite `closeBundle` 的 ENOENT 掩盖（Phase 12 已修，0.8.8 起补了 `sass`）。见坑 #29。

---

## 4. 数据 / 配置 / 授权类

### 4.1 权限点上报没生效

| 项 | 内容 |
|---|---|
| **定位** | ① `sys_app_client.last_sync_at` 是否推进；② `sys_permission` 是否有该 client 的点；③ **真列名是 `menu_registry_json`**（不是 `menu_json`） |
| **根因** | ① `menu-report-secret` 为空 → Reporter **fail-soft 静默降级**（`WARN` 后直接 return，不上报不报错）；② `apps-registry.yml` 缺 `menu-report-secret` 键（cosmic 曾缺，Phase 12 已补 env-only） |
| **命令** | `docker logs <app> 2>&1 \| grep -i "菜单\|menu.*report"`；`SELECT client_id,status,last_sync_at FROM sys_app_client;` |

### 4.2 授权改了但用户还是看不到菜单

| 项 | 内容 |
|---|---|
| **根因** | 权限缓存 **60s TTL**（前端 `usePermissions` / 后端 `PermissionChecker`）→ 等 1 分钟或重登 |
| **另一类** | 中心 `configured=false`（该 client 未配置任何权限点）→ **R10 fail-open 全放行**，看起来「没限制」 |

### 4.3 应用管理员拿不到后补的 api 点

| 项 | 内容 |
|---|---|
| **根因** | 应用管理员＝本应用全量 menu+api 的**加法补齐**（幂等 NOT EXISTS）。若**先报 menu 后报 api**，且补齐逻辑只跑一次，admin 会永远拿不到后补的 api 点（坑 #18） |
| **命令** | `SELECT r.code,COUNT(*) FROM sys_role_permission rp JOIN sys_permission p ON p.id=rp.permission_id JOIN sys_role r ON r.id=rp.role_id WHERE p.client_id='<cid>' AND p.type='api' GROUP BY r.code;`（应等于该 client api 总数） |
| **本轮实测** | kb-ops 新增 25 个 api 点后，应用管理员 role **自动补齐 28/28** ✅ |

### 4.4 用户删了还能登 / 同名建不回来

| 项 | 内容 |
|---|---|
| **机制** | 用户名删除后有**墓碑**（不可复建，防冒用，坑 #20）→ 回归脚本请用**常驻低权账号**（如 `p10x`），不要用一次性账号名 |

### 4.5 🔴 应用级（client 级）角色**不会自动补齐** —— 「新建管理员卡在第③道闸」的真因

> 2026-10-09 实测定位。与 §4.3（应用管理员**权限点**自动补齐）是**两件事**，别混为一谈。

**症状**：应用里明明把某人设成了管理员，他调管理面却被第③道闸（中心权限点 `api:admin`）挡在门外；查中心 `sys_permission` 权限点**存在**、也被角色持有 —— 就是这个人没有。

**根因（不对称）**：中心 `DatabaseInitializer.seedRbacBase()` **只补平台级**：

| 层级 | 自动补齐 | 依据 | 落库 |
|---|---|---|---|
| **platform 级**（`scope='platform'`） | ✅ 有 | `user.role` 字段 | `sys_user_role(client_id=NULL)` |
| **应用级**（`client_id='marschat-portal'`） | ❌ **完全没有** | —— | 只能人工授予或应用侧申请 |

而应用闸门要的偏偏是**应用级**权限点 ⇒ **平台级有兜底、应用级裸奔**。

**附带事实（2026-10-09 实测，可直接引用）**：
- 中心**活跃用户仅 3 个**：1 × `superadmin`（`admin`/id 1）+ 2 × `user`；**`role='admin'` 活跃用户 = 0** ⇒ 「给 admin 补授权」当前**无对象可补**（`inserted_rows=0`）。
- `marschat-portal` 客户端下全部角色绑定只有 3 条，其中 2 条的用户已 `deleted=1` ⇒ **实际生效的只有 user 1 一条**。
- 应用本地 `role=admin` 的账号，在 `app_account_mapping` 里常是 **`user_id=NULL`（从未认领到中心身份）** ⇒ 它们在中心**根本不存在**，补任何授权都是空操作。

**定位命令**：
```sql
-- ① 有没有 admin 可补（常为空集，先跑这条，别空忙）
SELECT id,username,role FROM user WHERE deleted=0 AND role='admin';
-- ② 某客户端下到底有几条生效的授权
SELECT ur.user_id,u.username,u.deleted,ur.role_id,r.code
FROM sys_user_role ur LEFT JOIN user u ON u.id=ur.user_id LEFT JOIN sys_role r ON r.id=ur.role_id
WHERE ur.client_id='marschat-portal';
-- ③ 本地账号有没有被认领（user_id=NULL ⇒ 中心无身份，补了也白补）
SELECT local_account,user_id,status FROM app_account_mapping WHERE client_id='marschat-portal';
```

**处置**：不要在「已删除 / 未认领」的账号上补授权（制造垃圾数据 + 墓碑不可复建）。要么**补机制**（应用级自动补齐，需动 auth-center 枢纽），要么**应用侧放宽**（把平台 admin 也纳入放行）。两条路都是设计决策，**须拍板后执行**，见 `STATUS.md` T-ENG-7。

**⚠️ 排查纪律**：看到「某人缺权限点」，**先跑①确认有没有活的 admin**，再看是「没授权」还是「这个人压根不在中心」。本次就是在跑完①之后才发现整件事的前提（「有 admin 需要补」）**不成立**。

---

## 5. 取证命令集（复制即用）

```bash
# ── 平台健康 ──
C=http://127.0.0.1:8085
curl -s $C/actuator/health | python3 -m json.tool | head -5
curl -s $C/.well-known/openid-configuration | python3 -c "import sys,json;print(json.load(sys.stdin)['issuer'])"
curl -s -o /dev/null -w 'jwks=%{http_code}\n' $C/oauth2/jwks

# ── 平台内 API 探针（HS384 业务令牌只在内网/应用 BFF 可达；公网 auth 域不暴露 /auth/**）──
curl -s -X POST $C/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"<见Vaultwarden>","password":"<见Vaultwarden>"}' | head -c 120

# ── 数据库 ──
P=$(docker exec platform-mysql-1 env | grep MYSQL_ROOT_PASSWORD | cut -d= -f2-)
Q(){ docker exec platform-mysql-1 mysql -uroot -p"$P" --table marschat_auth -e "$1"; }
Q "SELECT client_id,SUM(type='menu') menu,SUM(type='api') api FROM sys_permission GROUP BY client_id;"
Q "SELECT client_id,status,last_sync_at FROM sys_app_client;"
Q "SELECT COUNT(*) active FROM user WHERE deleted=0;"

# ── 容器与产物 ──
docker ps --format '{{.Names}}|{{.Status}}|{{.CreatedAt}}' | grep -E 'auth-center|kb-|portal|infra|cosmic'
docker exec kb-web sh -c 'grep -oE "assets/index-[A-Za-z0-9_-]+\.js" /usr/share/nginx/html/kb/s/index.html'

# ── 部署产物硬核验（证明「新代码真的上线了」）──
docker cp kb-ops:/app/kb-ops.jar /tmp/x.jar && \
  unzip -p /tmp/x.jar BOOT-INF/classes/com/kb/ops/controller/SyncController.class | grep -a -o 'api:[a-z:]*'

# ── 流水线 ──
cd /root/devtools && python3 woodScript/check-pipeline.py --repo 1        # 最新
python3 woodScript/trigger-pipeline.py <项目名>                            # 触发（一次只跑一条）
```

---

## 6. 已知误判清单（**先怀疑测试，再怀疑产品**）

> 以下 5 次全部是**我们自己测试脚本的缺陷**，被误读成产品问题，登记以免重踩。

| # | 现象 | 真因 | 纠正 |
|---|---|---|---|
| ① | 「忘记密码」点了没反应 | `querySelectorAll('*')` 取文本时命中 `body`，点了个寂寞 | 取**叶子元素**，并按文本长度排序 |
| ② | 同左 | 点中**父 `div`**（宽 342px 的中心空白），而处理器在**子 `<a>`**；事件只向上冒泡 | 用元素**自身 bbox** 派发真实鼠标事件 |
| ③ | Toast 文案抓不到 | 读取时 Toast 已消失 | 注入 `MutationObserver` 累积 |
| ④ | 「A8 邮箱验证码」失败 | 上一轮刚发过**同一邮箱**，命中 60s 频控返回 400 | 用**唯一邮箱**；频控另立用例断言 400 |
| ⑤ | 「未提交改动丢了 / git 说 ahead」 | Windows 侧 `.git/refs` 不落盘 + auto-backup 抢跑 | 判同步**只信 `ls-remote` 对远端取 tip** |
| ⑥ | 把「统一认证登录失败 username 与 token 不一致」当产品缺陷直接猜改 | 先量后判：解码令牌后确认是**前后端契约漂移**（前端取 id_token.sub、后端取 access_token.username）；且同轮排查里我自己的脚本又出了 6 个缺陷 | 见 §1.6；断言前先打印「前端将送的值 vs 后端将取的值」 |
| ⑦ | 某应用报「有 console error（404）」 | 断言在应用之间**没有重置错误缓冲**，把 portal 的 404 记到了 kb-web 头上 | 每个应用断言前 `reset()` |
| ⑧ | cosmic 业务页「特征词不匹配」 | 特征词写成大写 `COSMIC`，实际渲染 `cosmic-studio` | 特征词**从登录后页面真实 innerText 里抄** |
| ⑨ | activecode 免登「没落到 main.html」 | 该应用 SSO 后**按设计**落 `index.html`（公开自助页），`main.html` 才是管理页 | 先读设计的落地路径再写断言 |
| ⑩ | 「点了登录没反应」（同类第 3 次） | 按文本长度排序取到**父节点**（`div.el-form-item` 与内部 `<button>` 文本同长）→ 点父节点无效（事件只向上冒泡） | 精确匹配 `button` **全等文本** + 派发真实鼠标事件到其 bbox 中心 |
| ⑪ | 独立登录「失败」（4 个应用） | 断言写成「**任何** toast 都算失败」，而 toast 正是成功提示「登录成功」 | 成功判据用「落点 URL + 登录接口 200 + 无密码框」，**不要用「无 toast」** |
| ⑫ | portal 特征词不匹配 | 特征词抄自**登录页的营销文案**（「工具看板」），登录后页面是侧边栏文案 | 同 8 |
| ⑬ | 5 应用 × 2 轮共 10 条「跨域直连中心」FAIL | 证据全是 `https://auth.marschat.online/auth/session` —— 这是**设计内的 SLO 会话探针**（auth-center 链2 显式 permitAll + 带凭据 CORS），各应用 `startSessionWatcher` 靠它做登出联动 | 违规判据收窄为「跨域 `/admin/**`」或「跨域提交账密 `/auth/login`」 |
| ⑭ | R3/R4 九条「登出后仍免登」FAIL，看着像 SLO 全崩 | portal「退出登录」在 `el-dropdown-menu` 内，**未展开时不在 DOM** → 脚本返回 `NO-BUTTON`，登出压根没触发 | 先展开下拉再点；并单列「按钮是否命中」断言 |
| ⑮ | 补了「先点触发器」还是打不开下拉 | Element Plus `el-dropdown` 默认 **trigger = hover**，**点击无效** | 改用 `Input.dispatchMouseEvent type=mouseMoved` **悬浮**（先移到别处再移入，产生 mouseenter 迁移） |
| ⑯ | SSO 登录停在登录页不动（第三次踩「点父节点」） | `click_txt` 的 selector 写成 `'button,a,li,span,div'` → 命中**祖先 div**，处理器在子 `button` 上、事件只向上冒泡 | **触发类点击一律只匹配 `button`**（`click_txt(txt,'button')`） |
| ⑰ | 「登出后各应用不再免登」看着全绿，其实不证明任何事 | 前置判据写成 `'…/portal/' in url`，而 `/portal/login` **也含该子串** → 停在登录页被判成 PASS；下游「不再免登」只是「本来就没登录」 | 前置判据收紧为 **无密码框 AND url 不含 `/login` AND localStorage 有 token** |

**通用心法**：
- 断言要**有区分度**（例：白名单不能只看「无凭据 401 vs 404」—— 安全过滤器在 controller 之前就返回 401/403，白名单根本没被执行到；要**带真实会话**或**验产物字节码**）。
- 断言要**幂等**（别用固定邮箱/固定账号名做一次性资源）。
- 拿不到证据就说拿不到，**不猜**。

---

## 7. 升级这类问题给谁

| 现象 | 归属 |
|---|---|
| 中心登录主链路（`/auth/login`、`/auth/refresh`、`/auth/mail-login`）异常 | auth-center（枢纽，改前评估爆炸半径 `appmap.py impact auth-center`） |
| 某应用 BFF 404 / 白名单缺项 | 该应用仓库（`AdminProxyController`） |
| 组件交互（按钮/作用域/弹窗） | `marschat-components`（**改一处 6 应用生效**，必须整体回归） |
| 流水线不触发 / 构建失败 | devtools `woodScript/`（先查 `.woodpecker.yml` 的 `when` 闸门与 `DEPLOY_TARGET`） |

---

## 8. portal「被踢回登录页」与登录链路约定陷阱（2026-09-18/19 专项）

> 完整证据、实验记录与未证实边界见 `archive/portal-401/`。本节只留**可操作的排查路径**。
> ⚠️ 代码行号是当时的锚点，代码演进后会位移 —— 以**文件 + 语义**为准。

### 8.1 先分清两条链路（**多数排查弯路源于混淆这两条**）

| 链路 | 触发点 | 现象 | 判据 |
|---|---|---|---|
| **A · 真 401 硬踢** | 前端请求拦截器收到**真 HTTP 401** | 立即清会话 + 跳 `/portal/login?reauth=1` | 有真 401 |
| **B · 身份守卫静默重授权** | `main.ts` 身份守卫发现本地身份与 IdP 不一致 | 停在 `/portal/auth/callback?code=…`，`POST /portal/api/auth/sso/exchange` **根本没发出**，`portal_token=null` | **全程 0 个 `/portal/api/**` 401** |

⇒ 先看 network 里有没有真 401：**没有真 401 就不是链路 A**。

### 8.2 只有「真 401」才会硬踢（关键区分）

| 来源 | HTTP | 是否硬踢 |
|---|---|---|
| 业务异常（`BusinessException(401)`） | **200**，body 里 `code:401` | ❌ 仅 reject，不跳 |
| 权限不足 | **403** | ❌ |
| 后端 `JwtInterceptor` 的 `SC_UNAUTHORIZED` | **真 401** | ✅ 硬跳 |

⇒ 排查时先看 **HTTP status**，别被 body 里的 `code:401` 带走。全平台唯一真 401 发射点 = 后端 `JwtInterceptor`。

### 8.3 可观测性：用 E0 采样日志定格 reason

- 坑：`JwtInterceptor` 的「无 Bearer / 验签失败」分支**原本完全不打日志** → 日志里「未登录」计数为 0 **不能**说明该分支没发生。
- 已补 **E0 结构化采样日志**：`reason ∈ {NO_BEARER, BAD_SIGNATURE, EXPIRED, ISSUER_MISMATCH, TYPE_MISMATCH}`，只记 `sha256(token)` 前 8 位，**严禁记录原始 token**。
- 用法：抓 `portal-server` 日志按 `reason` 分布判断，**不要**再靠猜。

### 8.4 🔴 约定陷阱（**禁止项**）：`GET /auth/session` 的 `username` 实际返回 `sub`

- 该字段取 `auth.getName()`，回的是 **`sub`（用户 ID，如 `"1"`）而非用户名**。
- 组件库身份一致性守卫（`sessionWatcher`）与应用侧 `getLocalIdentity` 注入**正静默依赖这个语义**（**6 个应用全部注入**，非仅 infra）。
- ⇒ **在未同步修改 `getLocalIdentity` 值域之前，不得"善意修正"该字段语义** —— 改了会让所有应用每次探针都判「身份错位」，**集体被踢回登录页**。

### 8.5 另一处已知缺陷（**不是**硬踢的原因，勿误归因）

`AuthCenterService.refreshTokens`：进程内 `Map<Long,String>`，**键 = userId 单槽、无锁**；SSO 路径写入 / legacy 路径消费；刷新失败时把非唯一键（null）当唯一键删除 → 产出 `invalid_grant` + 「SSO 会话已失效」。
⚠️ 但它产出的是 **HTTP 200 + `code:401`（不硬踢）** ⇒ 它是硬踢症状的**红鲱鱼**，不能解释真 401。

### 8.6 🔴 已定位根因（2026-10-08）—— 本节「未证实」状态作废

> **本节原始结论已被推翻，保留原文作为决策史，不要再按它排查。**

| 当时的判断 | 现在的结论 |
|---|---|
| 「portal 自签 token **逻辑上不可能**触发 BAD_SIGNATURE，触发面收窄到『另有进程/构建持同一 secret 但签发规则不同』」 | ❌ **错**。反编译只证明了「签发规则一致」，没证明「验签计算正确」。根因是**验签这个动作本身在并发下会算错**（`HMacJWTSigner` 内部 `Mac` 非线程安全，见 §9）——与密钥、签发规则、是否有第二个进程**全都无关** |
| 「7 次命中与测试窗口一一对齐 ⇒ 高度疑似夹具自触发」 | 部分成立但**归因错了**：并发压测确实更容易命中，但那是因为**并发正是触发条件**，不是夹具污染。真实用户多会话并发也一样会中 |
| 「不能说 portal 有并发被踢缺陷」 | ✅ **现在可以说**：portal 确有并发下被踢的缺陷，**已定位、已修复、已上线验证**（§9） |

**教训（写给自己）**：当年用「反编译证明签发规则一致」就排除了服务端自身的验签问题 —— 这是**拿静态产物去证伪运行时行为**，路径不对。真正把它证伪的是 §9 的③（外部重算 HMAC 与被拒 token 签名一致 ⇒ token 合法、服务端算错）。**跑时问题要用跑时实验证伪。**

**仍成立的边界**：§8.5 的 `refreshTokens` 单槽无锁**依然是红鲱鱼**（它只产 HTTP 200 + `code:401`，不硬踢），不要因为这次翻案就把它也当成根因。

### 8.7 测试方法论（避免自己的测试污染结论）

- **双浏览器多会话矩阵**：两个独立 `--user-data-dir` 视为两台浏览器；用例 S1 双 SSO 同账号 / S2 双独立同账号 / S3 混合 / S4 反向混合 / S5 异账号；每用例**等 70s**（> sessionWatcher 60s）；全程 `Network.setCacheDisabled=true`。
- **CDP `Network.getResponseBody` 必须发往页面 session**（带 `sessionId`）—— 发到 browser 作用域会返回 `-32601`。这是历史上「抓不到响应体」类结论的直接来源。
- **冻结实验**：制造真 401 会在生产日志留痕、污染后验基线 ⇒ 需要干净基线时，先停掉一切并发会话实验。

---

## 9. 🔴 P0：hutool `JWTSigner` 非线程安全 → 登录成功后偶发 401（BAD_SIGNATURE）

> 2026-10-08 定位并修复。**这是 §8 那条悬案的真正根因**（§8.6 已被本节推翻）。
> 症状一句话：**登录明明成功，紧跟着的第一个业务请求偶发真 401，前端硬踢回登录页；重试即愈。**

### 9.1 判定

| 项 | 内容 |
|---|---|
| **症状** | 账密 / SSO 登录成功（拿到 token）→ 紧随其后的业务请求**偶发真 401**；前端 401 拦截器清会话 → 表现成「登录成功又被踢回登录页」。**重试即恢复，不可稳定复现** |
| **判据** | 服务端 E0 采样日志：`portal_jwt_reject reason=BAD_SIGNATURE uri=… token_fp=xxxxxxxx`（见 §8.3）；**不是** `EXPIRED` / `ISSUER_MISMATCH` / `NO_BEARER` |
| **易误判成** | ① 「部署窗口还没生效」（错，重试即愈 ≠ 部署延迟）；② 「密钥不一致」（错，那会 **100% 失败**不会偶发）；③ 「测试夹具自触发」（错，见 §9.3 混发实验的对照组） |

### 9.2 四步证伪（**按顺序做，别跳**）

| # | 实验 | 结果 | 排除了什么 |
|---|---|---|---|
| ① | **token 指纹比对**：客户端收到的 token 与服务端拒绝的 token，`sha256[:8]` 比对 | **一致** | 排除「客户端拿错 / 换了 token / 中途被改写」 |
| ② | **纯验签对照**：同一枚 token 串行 20 次 + 并发 60 次验签 | **0 失败** | 排除「密钥不一致」「token 本身损坏」「时钟/过期」 |
| ③ | **外部重算 HMAC**：用容器内真实 `PORTAL_JWT_SECRET`，在**另一个进程**独立重算被拒 token 的签名，与 token 自带签名比对 | **一致** | 🔑 **决定性证据：token 是合法的，是服务端自己算错了**。到此「密钥 / 签发规则 / 第二个进程」全部出局 |
| ④ | **混发并发实验**：每轮 6 次登录（sign）+ 6 次业务请求（verify）× 10 轮 | **5/60（≈8%）验签失败，全部 BAD_SIGNATURE**；而②的纯 verify 对照组 0 失败 | 🔑 **差异只在「有没有并发的 sign」** ⇒ 根因锁定在「sign 与 verify 共享了可变状态」 |

### 9.3 根因

hutool 的 `JWTUtil.verify(token, signer)` **不是只读验签**，而是**用同一个 `signer` 重新签一遍再比对**。
`JWTSignerUtil.hs256(key)` 返回的 `HMacJWTSigner` 内部持有一个 `javax.crypto.Mac` 实例 —— **`Mac` 有内部中间状态，非线程安全**。

```
线程A（登录，sign）    ：Mac.update(...) → Mac.doFinal()   ┐
线程B（业务，verify）  ：Mac.update(...) → Mac.doFinal()   ┘ 两个 doFinal 之间的 update 互相踩踏
                                                            ⇒ 验签结果与真实签名不符 ⇒ BAD_SIGNATURE
```

⇒ **并发越高、登录与业务请求越密集，命中率越高**；纯读场景永不命中（这解释了为什么压测之外"看起来一直是好的"）。

### 9.4 修复（范式）

```java
// ❌ 错：单例共享有状态密码学对象
private final JWTSigner signer = JWTSignerUtil.hs256(keyBytes);

// ✅ 对：按线程隔离
private final ThreadLocal<JWTSigner> signerHolder =
        ThreadLocal.withInitial(() -> JWTSignerUtil.hs256(keyBytes));
// 调用处：.sign(signerHolder.get()) / JWTUtil.verify(token, signerHolder.get())
```

落地于 `portal-server/util/JwtUtil.java`（提交 `bd83f1d0`，流水线 #843）。

### 9.5 验证（修复后同一实验）

- 混发并发 `ROUNDS=20`（共 **120** 次业务请求）⇒ **失败 0**（修复前 5/60）。
- 真浏览器验收 **7/7 PASS**：登录成功 → `/portal/users` 渲染 2 行真实数据 → 用户菜单退出 → 回登录页 → localStorage 全空。

### 9.6 影响面普查（2026-10-08 全仓 grep）

| 应用 | JWT 实现 | 是否受影响 |
|---|---|---|
| **portal** | hutool `cn.hutool.jwt.JWTSigner` | ✅ **已修**（`JwtUtil` 唯一持有者；`JwtInterceptor` 不持有 signer，全部经 `JwtUtil` ⇒ 修一处即覆盖） |
| infra-monitor | jjwt `Jwts.builder().signWith(SecretKey)` | ❌ 不受影响（`SecretKey` 不可变、线程安全） |
| kb-gateway / kb-ops / kb-file / … | jjwt | ❌ 不受影响 |
| auth-center | jjwt（Spring Authorization Server） | ❌ 不受影响 |

⇒ 全平台**仅 portal 一处**，已闭环。

### 9.7 ⚠️ 通用禁令（写进新代码审查清单）

1. **禁止把有状态密码学对象当单例共享字段**：`JWTSigner` / `Mac` / `MessageDigest` / `Cipher` / `Signature` —— 一律 `ThreadLocal` 隔离或每次新建。
2. **新接入应用直接用 jjwt**，与其余应用同构；**不要再新引入 hutool JWT**（hutool 其它工具类无此问题，仅 JWT 签名器）。
3. **「偶发 + 并发相关 + 重试即愈」三件套同时出现 ⇒ 先怀疑共享可变状态**，再怀疑密钥 / 时钟 / 部署 / 网络。

### 9.8 排查心法（本节最值钱的部分）

> **「跑时」问题必须用「跑时」实验证伪，不能用静态产物证伪。**

当年 §8.6 用「反编译在跑 jar，证明签发规则恒一致」就宣布「portal 自签 token 逻辑上不可能触发该分支」——这只能证明**签出来的 token 长什么样**，证明不了**验签那一步算得对不对**。真正翻案的是 §9.2 的③：**拿容器内真实密钥在另一个进程独立重算 HMAC**，与被拒 token 自带的签名一比，一致 ⇒ 错在服务端。

配套两条：
- **对照实验优先**（纯读 vs 混读写）——两组只差一个变量，结论才硬。
- **先量后判**：这次是先有 `5/60` 这个可复现的数字，才敢动 `ThreadLocal`；没有数字时宁可登记「未证实」（就像当年 §8.6 做的那样），也不要猜。

---

## 10. 🔴 P0 环境故障：MySQL GR 数据分歧 → 被自动拉起 super_read_only → 六应用 SSO 全线 500

> 2026-10-18 夜实测定位并修复。**症状极具迷惑性：表现是「认证组件全崩」，根因却在数据库集群，与组件代码无关。**

### 10.1 症状

浏览器 IdP 登录页能打开、**口令能提交成功**，但换授权码时 **500 / Whitelabel Error Page**；cosmic 报错更直白：
`(1290, 'The MySQL server is running with the --read-only option so it cannot execute this...')`。

### 10.2 定位三步（按顺序，别跳）

```bash
# ① 先看是不是只读（10 秒定性）
docker exec platform-mysql-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "SELECT @@read_only, @@super_read_only;"
# → 1  1  即为本节

# ② 看集群成员状态 —— 这一步决定后续能不能随便关只读
docker exec platform-mysql-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --table -e \
  "SELECT MEMBER_HOST, MEMBER_PORT, MEMBER_STATE, MEMBER_ROLE
   FROM performance_schema.replication_group_members;"
# → MEMBER_STATE=ERROR（不是 PRIMARY/SECONDARY）才是本节；若是 SECONDARY 说明主库切走了，另案处理

# ③ 看 GR 日志确认根因
docker logs platform-mysql-1 --since 24h 2>&1 | grep -E "MY-011526|MY-011522|MY-011565"
```

本轮日志铁证：
```
[ERROR] [MY-011526] 'This member has more executed transactions than those present in the group.
         Local transactions: …aaaaaaaa-…:1-119190:… > Group transactions: …:1-115258:…'
[ERROR] [MY-011522] 'The member contains transactions not present in the group.
         The member will now exit the group.'
[System] [MY-011373] 'Started auto-rejoin procedure attempt 3 of 3'
[System] [MY-011375] 'Auto-rejoin procedure attempt 3 of 3 finished. Member was not able to join the group.'
[System] [MY-011565] 'Setting super_read_only=ON.'          ← 元凶在这里
```

⇒ **不是磁盘满、不是配置 write(=ON)，是 GR 自己把 super_read_only 拉起来的。**

### 10.3 根因

node1（`192.168.31.105:3306`）相对另两节点（`192.168.31.182:3307/3308`）**多出 3932 个事务**。
GR 认证器拒绝有额外事务的成员入组，auto-rejoin 三次全败后**自动 `super_read_only=ON`**，写量全站拒接。

### 10.4 处置（本轮采用，零数据丢失）

```sql
-- ⚠️ 三个前提，缺一不可：
--   ① 已确认 MEMBER_STATE=ERROR（非 SECONDARY）
--   ② 已确认本节点 GTID 是集群的**超集**（多出来的是真实业务数据）
--   ③ **绝不 bootstrap** —— bootstrap 会造出第二个同名组，导致二次分歧
STOP GROUP_REPLICATION;
SET GLOBAL super_read_only = OFF;
SET GLOBAL read_only = OFF;
SET GLOBAL group_replication_start_on_boot = OFF;   -- 防容器重启后再次自动尝试入组被锁
```

**为什么用退组而不是 bootstrap**：该节点 GTID 是集群超集，退组可直接救活可用性且不丢数据；
bootstrap 会生成组的另一个独立副本，后面两节点归队时谁的数据先进说不清，是雷。

**验证必须看「写」不看「读」** —— `/auth/login` 返回 200 也不算通过（读过 + 验签都能通）：
```bash
# 唯一的硬判据：refresh_token 表能否 INSERT（它正是本轮失败点）
curl -s -X POST http://127.0.0.1:8085/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"…","password":"…"}' | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['code'], bool(d['data'].get('refreshToken')))"
# → 200 True 才算真恢复
docker logs auth-center --since 60s 2>&1 | grep -c '"level":"ERROR"'   # → 0
```

### 10.5 代价与遗留（🔴 待良哥择机处理）

- cluster 退化为**单节点**，冗余临时失效。node2/3 需后续用 clone/xtrabackup 从 node1 重建后归队。
- ⚠️ **运维侧的隐性雷**：`/etc/mysql/conf.d/cluster.cnf:33` 本就写 `group_replication_start_on_boot = OFF`，
  但运行时被**动态改成了 ON**（这正是它会不断 auto-rejoin 的原因）。本轮**已定位根因并拆除**：成因是 **2026-09-07 一次脑裂救援留下的 `SET PERSIST`** —— 它把变量写进容器数据卷的 `/var/lib/mysql/mysqld-auto.cnf`，**不在 git 里**，也因此长期压过了 `cluster.cnf` 的 OFF。配合 mykng 的 `@reboot /root/scripts/docker-restart-all.sh`，**每次主机/容器重启都会重放该配置** ⇒ GR 自动起来 → 因 3932 事务分歧被踢 → 再度自锁只读，**这就是本次故障的可复发链路**。
  ⇒ 排查时若发现「配置与运行时不一致」，**先怀疑有人做过 `SET PERSIST`**（而不是只在脑子里假定是 `SET GLOBAL`），详见下方根治动作。


**根治动作（本轮已执行，务必照做）**：只做 `SET GLOBAL ...=OFF` **没用** —— `SET PERSIST` 会随重启复活。`cluster.cnf` 写了 OFF 却仍为 ON 时，**先查这里**：

```sql
-- ① 看有没有被持久化的变量（这张表平时是空的，容易漏看）
SELECT * FROM performance_schema.persisted_variables;
-- ② 有就拆掉，别只改 runtime
RESET PERSIST IF EXISTS group_replication_start_on_boot;
-- ③ 验证：① 应为空表；数据卷里 /var/lib/mysql/mysqld-auto.cnf 收敛为 {"Version": 2}
```

> ⚠️ **纪律**：临时救援用的 `SET PERSIST` **必须在收尾时 `RESET PERSIST` 撤销**，否则一次救火动作会变成每隔几周复发一次的定时炸弹。疑似源头为 Hermes 的 `mysql-cluster-manager` 技能（`SKILL.md:61` 第 2 步直接建议 `SET PERSIST`），建议给该技能打补丁改为会话级 `SET GLOBAL` + 收尾 `RESET PERSIST`（跨仓，本轮未改，见 `STATUS.md` T-ENG-13）。

### 10.6 排查心法

> **看到「全平台认证 500」不要先怀疑认证组件 —— 先花 10 秒查一下数据库是不是只读。**

这类故障的迷惑性在于：**读路径全好**（IdP 页面能开、口令校验能过），只有**写路径**坏导致 SSO 换码失败；
而 UI 又把底层异常压成一句 Whitelabel。按 `trace_terminal` 铁律追到最末端节点只需一条 SQL，
比去翻组件代码便宜两个数量级。


---

## 11. 从「单节点」恢复为「三节点」（2026-10-19 实战路径）

> 承接 §10。§10 解决的是「先让服务活过来」，本节解决的是「把冗余装回去」。
> ⚠️ 这两件事可以同时成立：服务正常 ≠ 有冗余。

### 11.1 动手前必须确认的 4 件事（跳一条都可能毁数据）

1. **数据方向**：哪个节点是超集？用 `SELECT @@gtid_executed` 逐节点比对。
   ⚠️ **GTID 必须是严格包含关系**才能单向 clone。若两边各自有新事务（**双向分歧**），
   直接 clone 会丢掉一边的写入 —— 那种情况要先抢救，本节路径不适用。
2. **有没有应用是「多地址随机 LB」**：本轮最大的雷 —— `activecode` 的 JDBC 是
   `jdbc:mysql://<三个地址>/tools?loadBalanceStrategy=random`，
   它会在任意节点上写入。既然如此，**孤立节点也可能在接收写入**。
   ⇒ 重建前必须逐表比对行数，确认它没有写到落后节点上。
   本轮证据：node2/3 GTID 未增长、`tools` 库 6 表行数与 node1 逐表一致（390/36/44/3/5/18）
   ⇒ **排除双向分歧，单向分歧成立**，本节路径才可用。
3. **clone 插件与版本**：源与目标都须 `clone` 插件 ACTIVE 且 **版本号完全一致**。
4. **目标主机磁盘**：见 §11.3，这是本轮唯一导致两次失败的真实原因。

### 11.2 执行顺序（串行，不可并行 —— 并行会让组丢 quorum）

```sql
-- ① 目标节点上：先解锁（当过 SECONDARY 的节点会残留 super_read_only=ON，clone 会被 1290 挡住）
SET GLOBAL super_read_only = OFF;
SET GLOBAL read_only = OFF;

-- ② 拆掉旧组（在待重建的节点上）
STOP GROUP_REPLICATION;

-- ③ 数据源节点上：bootstrap 建立新组
SET GLOBAL group_replication_bootstrap_group = ON;
START GROUP_REPLICATION;
SET GLOBAL group_replication_bootstrap_group = OFF;   -- 🔴 必须紧跟关掉，漏关会导致下次重启重复 bootstrap
```

```sql
-- ④ 在目标节点上 clone（方向永远是 FROM 数据源）
SET GLOBAL clone_valid_donor_list = '<数据源IP>:<端口>';
CLONE INSTANCE FROM 'root'@'<数据源IP>':<端口> IDENTIFIED BY '<密码>';
```

🔴 **clone 完成后目标实例会自动重启，容器会跟着退出** —— 官方 mysql 镜像的 entrypoint 是脚本、
mysqld **不是 PID 1** ⇒ 必须 `docker start` 把它拉回来。
本轮真实报错：`ERROR 3707 Restart server failed (mysqld is not managed by supervisor)` ——
**此时数据其实已经拷完了**，不要误判成失败去重试。

```sql
-- ⑤ 容器起来后入组
START GROUP_REPLICATION;
```

⚠️ **必须先 `docker start` 并确认容器 Up，再 `START GROUP_REPLICATION`**。

### 11.3 磁盘：本轮唯一让 clone 两次失败的原因

```bash
# 失败长这样
ERROR 1006 (HY000): Can't create database '(null)' (errno: 28 - No space left on device)
```

🔴 **清理被日志占满的空间时，必须 `truncate`，绝对不能 `rm`**：
```bash
: > /path/to/huge.log            # ✅ 立即释放（变稀疏文件）
rm -f /path/to/huge.log          # ❌ 空间不释放！进程还持有 fd
```
判定方法：截断后 **`ls -l` 看大小不变，但 `df` 已释放** —— 这是稀疏文件的正常表现，
**看 `df` 不要看 `ls`**。

本轮元凶：**`hive-metastore` 的 Compactor Initiator 线程死循环**。
它以 **34.7 MB/s 的峰值**往 `/home/root01/hive-compose/logs/hive.log` 里灌，
把 104G 盘吃到 100% 满 ⇒ 直接导致 node2/node3 的 clone 两次失败。
**这是根因，不是环境噪音** —— 集群分裂只是它引发的症状之一。

**日志洪水长这样**（在 hive-metastore 容器日志里）：
```
HikariPool-1 - Connection is closed        ← 连不上 metastore 库，Initiator 每轮都重新撞墙
CompactorThread ... slowdown
loop took 1792366783 seconds               ← 关键指征：循环耗时被算成天文数字
```

**根治动作（一行，立竿见影）**：
```bash
docker restart hive-metastore          # 重连 metastore 库，Initiator 死循环自然终止
```

🔴 **为什么是 restart 而不是直接 truncate 了事**：truncate 只清盘、不清根因 ——
日志会以同样速度涨回来（本轮实测：截断出的 7.6G 只够撑 3.5 分钟）。
restart 顺带**恢复** hive 功能，不是停服避险。

**实测效果（原始字节数，重启前 vs 重启后）**：

| 时点 | 增长 |
|---|---|
| 重启前 | **1,040,194,581 B / 30 秒**（≈ **34.7 MB/s**） |
| 重启后 90 秒 | **403 B / 30 秒** |
| 重启后再复核 | **3,935 B / 120 秒**（≈ **33 B/s**） |

⇒ 降幅约 **1/258 万**，日志洪水消失。

**判定方法（重启后必须实测，别看容器 Up 就收工）**：
```bash
S1=$(stat -c%s /home/root01/hive-compose/logs/hive.log); sleep 30
S2=$(stat -c%s /home/root01/hive-compose/logs/hive.log); echo $((S2-S1))
```
- < 1 MB / 30 秒 ⇒ ✅ 根因已除
- > 100 MB / 30 秒 ⇒ ❌ 重启无效，去查 metastore 库本身的连通性与凭据

⚠️ **测增长率前必须先停掉任何 truncate 兜底循环**，否则测出来的是被反复截断的假数据。

**顺带提醒（别被 `ls` 吓到）**：截断过的 `hive.log` 是**稀疏文件**，
本轮 `ls` 显示 **33.7 GB**，但 `df` 显示磁盘稳定在 **7.3G 可用 / 93%** —— **看 `df` 不要看 `ls`**。
想让它表观大小也恢复正常，得靠 logrotate 轮转重建，不是再 truncate 一次。**本轮未做，留待 logrotate 接入时一并处理**（见 `STATUS.md` T-ENG-15）。

### 11.4 别忘了：`-start_on_boot` 的分节点差异

本轮恢复完发现三节点 `@@group_replication_start_on_boot` **不一致**（node1=0，node2/3=1）：

| 节点 | 配置文件（共享盘） | 实际挂载 | 运行时 |
|---|---|---|---|
| node1 | `cluster.cnf` 写 **OFF** | bind mount 共享盘 | 0 |
| node2/3 | `node2.cnf`/`node3.cnf` 写 **OFF** | **182 本地 my.cnf**（缺该项） | **1**（MySQL 默认值） |

⇒ **共享盘真源对 node2/3 根本没生效**（配置漂移，见 `STATUS.md` T-ENG-14）。

⚠️ **为什么必须统一为 ON**：node1 是所有应用连接的节点。若它重启后不自动入组，
就会变成「孤立但可写」的状态 ⇒ 静默产生分歧 ⇒ 复现 §10 的故障链。
本轮已把 `cluster.cnf:33` 改为 `ON`（备份 `cluster.cnf.bak-20261019-074042`）。

**改配置的三个禁止项**：
- ❌ 不要 `SET PERSIST`（会写进 `mysqld-auto.cnf`，优先级压过 cnf，正是 §10 那颗雷的成因）
- ❌ 不要只 `SET GLOBAL`（重启后会被配置文件覆盖，等于没改）
- ✅ 改**配置文件**，不重启就不影响现网，下次重启自然生效

### 11.5 本轮踩到的其它真实报错

| 报错 | 真因 | 处置 |
|---|---|---|
| `ERROR 1290 --super-read-only` | 当过 SECONDARY 的节点退组后仍残留只读 | clone 前先解锁 |
| `ERROR 3707 ... not managed by supervisor` | 官方镜像 mysqld 非 PID 1 | 数据已拷完，`docker start` 拉回即可 |
| `ERROR 1006 errno 28` | 磁盘满（真因是 hive 日志洪水） | `truncate` 腾空间 + `docker restart hive-metastore` 断根 |
| `Connection is closed` + `loop took 1792366783 seconds` | hive Compactor Initiator 死循环 | `docker restart hive-metastore` |

### 11.6 🔴 排障心法：三节点全 PRIMARY 不是异常

配置真源 `/mnt/shared/platform/mysql/cluster.cnf` 第 29 行明写「Group Replication 多主模式」
（`single_primary_mode=OFF` + `enforce_update_everywhere_checks=ON`）。

⇒ **本集群是故意的多主**，三个节点都显示 `PRIMARY` **是正确的**。
拿「1 PRIMARY + 2 SECONDARY」的直觉去判，会把正常状态误判成故障。
**排障前先确认集群是单主还是多主**（`SELECT @@group_replication_single_primary_mode`）。


---

## 12. 登录类验证：判据、自伤与误区（R10 沉淀）

> 前面 11 节都是「出故障怎么修」，这一节是「**怎么证明登录是好的**」。
> R9 / R10 两轮各踩过一次「看起来失败其实通过」和「看起来失败其实是自己打的」，故单列。

### 12.1 成功判据必须四条，缺一条都可能放过真故障

1. **业务特征词**：落地页渲染出该应用的业务内容（不是停在登录页、不是空白壳）
2. **会话态落盘**：localStorage / Cookie 里有 token
   ⚠️ activecode 是 **`JSESSIONID` Cookie** 承载，localStorage 为空属**已知形态**（`STATUS.md` T-LOW-23），不是失败
3. **OIDC 换票链**：`/oauth2/token` 或 BFF 换票端点返回 200
4. **口令输入次数 == 1**：一轮里若需多次输口令 ⇒ SSO 免登没生效

### 12.2 别用 HTTP 状态码判「登录失败」

错密时**只有 cosmic 返回真 401**；portal / kb-web 是 `200 + code:400`；infra 是 `200 + code:401`；activecode 是 `200 + success:false`（见 `STATUS.md` T-LOW-27）。

⇒ 判成败要看**响应体 + 有没有落会话**，不能只看状态码。
反过来 —— **写断言时若只在 4xx/5xx 才去取响应体，会整片漏掉这四种形态**（R10 第一轮就吃了这个亏）。

### 12.3 `authorize` 那一跳 CDP 观测不到，别硬测

浏览器跳到 IdP 的 `/oauth2/authorize` 是**跨源顶层导航**，CDP 抓不到。
⇒ 换票链闭合改用**服务端举证**：拿浏览器回调里的 `code` 反查中心库

```sql
SELECT principal_name, client_id, issued_at
FROM marschat_auth.oauth2_authorization WHERE <code 相关列> = '<回调里的 code>';
```

R10 用这条做到了 **36 个 code 全部匹配上**（`principal_name=1(admin)`、client 与时间戳逐条对上）。

### 12.4 先剔除自伤，再谈故障

错密负例会**自己制造** 401 / 500 / ERROR 日志。R10 里 auth-center 窗口内 40 条 ERROR **全部**是测试自伤，
traceId 与接口层探针逐条对得上，扣掉后真实 ERROR = 0。

⇒ **统计服务端 ERROR 时，先按 traceId 与自己的探针对齐，否则会把自己的脚印当成故障。**

### 12.5 多主集群的写入连通性要「三节点回读」

只查一个节点不足以证明复制正常。做法：改一条配置 → **三节点分别直连回读** → 还原 → 再三节点回读确认已还原。

R10 在 node1 / node2 / node3 上**各直写一次**，确认三节点都接受写且互相同步
（本集群是多主，三个都显示 `PRIMARY` 是正常状态，见 §11.6）。

### 12.6 看到 404，先问是谁的 404

R10 采到的 7 条 4xx 里：3 条是坑 #41（子路径应用先探 host 根 `app-config.json`）、
2 条是坑 #42（跨域直连 IdP 取权限）、2 条是测试自伤。

另一类容易误判的：**入口层瞬时 404** —— 源站 nginx 全 200、事后 curl 也 200，只有浏览器那一次 404
⇒ 定位到公网入口层（见 `STATUS.md` T-LOW-28）。

⇒ **判 404 先分清：应用侧 / 入口层 / 自己发的。**

---


---


---

## 13. R11 沉淀：入口断言的真源与验证范围边界（2026-10-19）

> 前 12 节是「怎么修」和「怎么证成立」，这一节是「**怎么避免把非缺陷判成缺陷**」。
> R11 的 5 条 FAIL 里有 **0 条真实失败**，剩下全部通往同一个教训：要么入口 URL 转抄错误，要么断言判据过度泛化。

### 13.1 断言用的入口 URL，必须从配置真源取（R11 最大教训）

R11 的任务简报把 activecode 公网入口写成 `https://code.marschat.online/activecode/`、kb-ops 写成 `https://ops.marschat.online/ops/` —— **两个都是转抄上轮报告时的笔误**，结果 QA 严格测出一个「P1 入口契约失败」，白白花了一轮去定性。

🔴 **六应用的公网入口，唯一真源是 `devtools/apps-registry.yml` 的 `frontend.entry`**：

| 应用 | 公网入口（真源值） |
|---|---|
| portal | `https://main.marschat.online/portal/` |
| kb-web | `https://kb.marschat.online/kb/` |
| kb-ops | `https://kb.marschat.online/ops/`（**不是** `ops.marschat.online`） |
| infra-monitor | `https://monitor.marschat.online/infra/` |
| cosmic-studio | `https://cosmic.marschat.online/` |
| activecode | `https://tools.marschat.online/activecode/`（**不是** `code.marschat.online`） |

⇒ **写断言前先 `grep -n "entry:" devtools/apps-registry.yml`**；报错先疑真源勘误，再疑生产。

### 13.2 infra 的 `/api/api` 双前缀是正确实现，不是配置漂移

应用侧 nginx `location /infra/api/` → `proxy_pass .../infra/` **会剥掉一层 `/api`**，所以浏览器必须发 `/infra/api/api/admin/users`。

**自证方法**：请求 `/infra/api/admin/settings/users`，后端回「接口不存在: `/infra/admin/settings/users`」—— 报错里的路径比请求路径**少了一层 `/api`**，这就是剥层的直接证据。

⇒ 判据**不要**写成「出现 `/api/api` 即 FAIL」；应改成「存在双前缀时后端必须返 200」。对照 portal / kb-web / kb-ops / cosmic 均无双前缀，属各应用 nginx 形态差异，不是组件缺陷。

### 13.3 「先怀疑用例，再怀疑产品」

| FAIL | 表象 | 真因 |
|---|---|---|
| 入口契约 2 条 | 「activecode 入口 404」 | 简报笔误（见 13.1） |
| `/api/api` 双前缀 1 条 | 「基址配置漂移」 | nginx 改写强制（见 13.2） |
| app 作用域可编辑控件 2 条 | 「只读视图没退化，越权风险」 | 选择器取的是全页可见 `input`，把列表页查询框算进去了；限定到可见 `.el-dialog` 后 `editable=0`、标题「用户信息（只读）」、无「确定」按钮 |

⇒ **判据越泛，假阳性越多**：不要用「包含某子串」当 FAIL 条件；改用「限定 DOM 子树 + 变异自测」的两轮法。

### 13.4 判「前端版本」不能用函数名计数

`resolvePermissionsIssuer` / `runtimeConfigCandidates` 是**函数名**，esbuild 顶层 mangling 后会被改名 —— 生产 bundle 里数到 0 **不等于**没升版本（R11 第一轮就差点据此下错结论）。

可靠判据只有两条：

1. **锁文件里的确切版本**（最硬）：`pnpm-lock.yaml` 中 `specifier` 与 `version` 两行。
2. **浏览器实际发出的请求**（次硬）：跨域 `auth.marschat.online/auth/permissions` ⇒ 旧包；同源 `/{ctx}/api/auth/permissions` ⇒ 已升 0.1.6。

R11 实测五应用锁文件分别钉 **0.1.2 / 0.1.2 / 0.1.4 / 0.1.4 / 0.1.4**，而 caret 范围（`^0.1.2` = `>=0.1.2 <0.2.0`）**均已覆盖 0.1.6** ⇒ 卡点在**锁文件**不在版本约束，重解析锁 + 重建即可。

⚠️ 另一条同源教训：**取证前先确认克隆新鲜度** —— mykng 的 `/root/devtools` HEAD 陈旧至 2026-10-04，早于 10-07 的 Phase 13 迁移，从它读到的依赖清单与实际不符。

### 13.5 服务端 ERROR 先归因，再下结论

R11 命中 71 条，逐条归因后**真实故障 0**：68 条是「用户名或密码错误」（本次错密负例自伤）+ 2 条是 `sys/health/check` 响应体含 `5xx` 字样导致的正则误匹配 + 1 条是已知端点不存在（主动探测触发）。

⇒ 统计服务端 ERROR 前，**先按 traceId 与自己的探针对齐**，否则会把自己的脚印当成故障。

### 13.6 「推送 ≠ 生效」的最后一段：devtools 流水线是 manual 触发

0.1.7 落地时实证：`ac0f9b00`（四前端锁文件）双推成功后，devtools 最新流水线**仍是 #852（commit `179fdf8e`）**——一条都没跑。

根因：devtools `.woodpecker.yml` 的触发条件是 `when: event: [manual], branch: [dev]`，**push 到 dev 不触发任何构建**；而 cosmic-studio 是 `event: [push, manual]`，但它的 forge 配的是 **GitHub**，只推 Gitee 同样不触发（必须双推；本机直推 GitHub 偶有断网阻断，必要时从 mykng 代推，详见用户记忆 `topics/infra-ops.md`）。

⇒ 「四段验」（仓库 → Nexus → 应用依赖 + 锁文件 → **线上产物**）的第四段有两个触发陷阱：

| 仓库 | 触发方式 | 陷阱 |
|---|---|---|
| devtools | 仅 `manual` | push 永不触发，必须调 API / UI 手动触发 |
| cosmic-studio | `push` + `manual`，forge = GitHub | 只推 Gitee 不触发，必须双推 |

**防复发动作**：改完锁文件推送后，**必须主动查一次流水线**，确认最新一条的 commit 是自己的：

```bash
curl -s "https://woodci.marschat.online/api/repos/1/pipelines?perPage=3" \
  -H "Authorization: Bearer $WOODPECKER_TOKEN"   # repo 1=devtools 3=cosmic-studio 4=auth-center 5=marschat-components
```

只看 `git log` / 推送回显就下「已上线」结论，是这一轮最容易踩的坑。另外 devtools 的 `sync-ci-scripts` 步骤会 `find /mnt/shared/woodScript -mindepth 1 -delete` 后重写，**多个流水线并发触发会 races**，多目标部署要串行触发（本轮四前端：kb-ops-web → kb-web → infra-monitor-web → portal-web，其中 kb-web 与 ops-web 本身有部署串行依赖）。

### 13.7 0.1.7 的生产确认三判据（R12）

0.1.7 的核心价值不是「会告警」，而是把「静默失效」变成可见。生产侧确认它真的在工作，用三个判据（都在 headless 浏览器里跑，本机零窗口）：

1. **console 零 `[marschat-app-kit]` 告警** —— 0.1.7 铁律是「成功路径零日志、全败才告警且只有一条」。只要任何应用出现**一条**该告警，就说明该应用本次启动的运行时配置**整份没生效**（回落内置默认值），不必再翻 Network 逐条比对。
2. **无跨域 `auth.marschat.online/auth/permissions`** —— 配置读不到才会回落跨域默认基址（坑 #42 / T-ENG-11）。跨域请求出现 ⇒ 判配置失效。⚠️ **唯一例外是 kb-ops**：它的 `MainLayout.vue` 显式用手写 `permOptions`（`issuer` = IdP）绕过 app-kit 句柄，且后端没有同源代理端点 ⇒ 该判据对 kb-ops 恒不成立（3/3 轮复现，见 `STATUS.md` `T-ENG-17`）。其余五应用（portal / kb-web / infra / cosmic / activecode）均通过。
3. **应用自身 contextPath 下 `app-config.json` 返回 200** —— 配置真的取到了。注意探测候选本来就会依次试若干地址（含 host 根），**候选 404 是预期行为**，只有「全败」才告警，所以不要用「有没有 404」判健康，要用「有没有告警」判。

**产物级判据**（不依赖浏览器）：下载在线 entry chunk，查 0.1.7 签名串——

```
个候选地址，全部失败
HTTP 状态非 200（该地址下没有 app-config.json）
已登记在 devtools/apps-registry.yml
运行时配置 app-config.json 未取到，已回落内置默认值
```

esbuild 生产构建会**改写函数名**但不动字符串字面量，所以签名串稳定可查（§13.4 的教训反过来用：不能数函数名，但可以数字符串）。本轮实测：**五应用在线 chunk 均含全部签名** —— portal `main.marschat.online/portal/assets/index-7xfla58k.js`、kb-web `kb.marschat.online/kb/s/assets/index-CZTSAPiD.js`、kb-ops `kb.marschat.online/ops/assets/index-6dfHHtUi.js`、infra `monitor.marschat.online/infra/assets-v2/index-DHJXEVRp.js`、cosmic `cosmic.marschat.online/assets/index-url5nkxf.js`。

---

## 14. 🔴 P0 环境故障：单主模式下 node1 被网络抖动逐出 → 以 SECONDARY 回归 → 六应用 SSO 全线 500（2026-10-20 夜）

> 与 §10（10-18 数据分歧）**并列的第二种集群失效形态**。共同点是「六应用 SSO 全 500」，但**根因与处置都不同** —— 先做 30 秒定性再选路径。

### 14.1 30 秒定性（先跑这条）

```bash
docker exec platform-mysql-1 mysql -uroot -p<密码> -N \
  -e "SELECT @@read_only,@@super_read_only; SELECT MEMBER_HOST,MEMBER_PORT,MEMBER_STATE,MEMBER_ROLE FROM performance_schema.replication_group_members;"
# read_only=1 super_read_only=1        ⇒ 本节点只读
# 且本节点 MEMBER_ROLE=SECONDARY       ⇒ 主漂走了 —— 本节
# 若本节点 MEMBER_STATE=ERROR / 已离组 ⇒ 转 §10 或 MySQL 官方文档 20.5.2
```

> 📌 该集群现在是**单主**模式（2026-10-20 09:10 切换，`performance_schema.persisted_variables` 中 `group_replication_single_primary_mode=ON`）。
> §10 写作时是多主（三节点都显示 `PRIMARY` 曾属正常），**两边的判据不能混用**。

### 14.2 本次实际时序（23:35–23:47 CST）

| 时刻 | 事件 |
|---|---|
| 23:35:16 | node1 同时连不上 node2/node3（`has become unreachable`），74ms 后恢复；但 GR 已判逐出：`Member was expelled from the group due to network failures` |
| 23:35:31 | `Transaction cannot be executed while Group Replication is on ERROR state` + `The server was automatically set into read only mode after an error was detected` ⇒ `super_read_only=ON` |
| 23:36:01–36 | auto-rejoin 第 1 次**成功**并入组（`This server was declared online within the replication group`）⇒ **但身份是 SECONDARY**（主已是 node2） |
| 23:36 起 | 应用侧成片报 `The MySQL server is running with the --super-read-only option ... error code [1290]`，六应用 SSO 全线 **500** |

**为什么这次比 10-18 更隐蔽**：数据库 ping 得通、`docker ps` 全 Up、HTTP 是 500 而不是连不上 —— 从应用视角只能看到「认证坏了」，看不出「你连的那台机器已经不当主了」。

### 14.3 根因（三要素相乘）

1. **网络**：`192.168.31.105 ↔ 192.168.31.182` 一次约 74ms 的抖动（不是断网）
2. **集群模式**：此时已是**单主模式** ⇒ 被逐出的成员回来只能做副本
3. **应用连接**：所有应用数据源指向 `MYSQL_HOST=platform-mysql`（= 105:3306），**没有多地址 failover**（唯一例外：activecode 用三地址 LB）

⇒ **多主模式下「node1 回归 = 恢复可写」；单主模式下「node1 回归 = 仍然只读」** —— 这是切换单主之后新引入的失效形态。

### 14.4 处置（本次采用，零数据丢失）

```bash
# ① 先验三节点 GTID 逐字符相同（不同就不能随便切主，转 §10）
docker exec platform-mysql-1 mysql -uroot -p<密码> -N -e "SELECT @@gtid_executed;"
docker exec platform-mysql-1 mysql -uroot -p<密码> -h 192.168.31.182 -P 3307 -N -e "SELECT @@gtid_executed;"
docker exec platform-mysql-1 mysql -uroot -p<密码> -h 192.168.31.182 -P 3308 -N -e "SELECT @@gtid_executed;"

# ② 在【当前 PRIMARY】上把主迁回 node1（uuid 取 node1 的 @@server_uuid）
docker exec platform-mysql-1 mysql -uroot -p<密码> -h 192.168.31.182 -P 3307 \
  -N -e "SELECT group_replication_set_as_primary('09a2a7b2-7d4c-11f1-9e75-7ac91537f639');"
# 返回：Primary server switched to: <uuid>

# ③ 验证必须「看写」，不能只看容器 Up
curl -s -X POST http://127.0.0.1:8085/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}'
# 出现 refreshToken 才算真恢复
```

⚠️ **不要 bootstrap** —— 会造出第二个同名组（2026-09 已踩过）。GTID 相同 ⇒ 直接 `set_as_primary` 即可。

### 14.5 根子还没除（下次网络抖动会原样复发）

| 待办 | 说明 |
|---|---|
| ① **`SET PERSIST` 周期雷** | `single_primary_mode=ON` 写在数据卷的 `mysqld-auto.cnf`（不在 git、也不在 bind-mount 配置里），重启会重放、也会随数据卷迁移。应 `RESET PERSIST IF EXISTS group_replication_single_primary_mode` 后落到配置真源 `/mnt/shared/platform/mysql/`（并遵守 `T-ENG-14` 的「共享盘 + 182 本地双写」约定） |
| ② **应用侧单点写** | 5/6 应用数据源只指向 105:3306。治本 = 改多地址（照 activecode 的三地址 JDBC）或前面挂 VIP / 代理，属跨仓改造，需单独排期 |
| ③ **缺主动告警** | 目前这种故障**没有任何主动告警**，全靠「用户登不进去」被动发现。建议给 `@@read_only=1` 加一条 Uptime-Kuma / Prometheus 告警 |

### 14.6 排查心法

> **多应用同时报认证 500，先花 10 秒查 `SELECT @@read_only`，再翻组件代码。**
> 本平台两次在夜里先翻了一小时组件代码，根因都在数据库集群。
> **分支判据**：`read_only=1` + `MEMBER_ROLE=SECONDARY` ⇒ 本节；`MEMBER_STATE=ERROR` 或已离组 ⇒ §10。

---

## 15. R14 沉淀：测试库两个真缺陷 + 0.1.8 生产验证判据（2026-10-22）

> 本轮（R14）最大的产出不是「测过了」，而是**测出了测试自己的两个缺陷** —— 都已实修进回归库（`mykng:/root/verify/r14/r14_lib.py`），并各配了一轮对照实验防复发。

### 15.1 坑 #45 —— ElMessage toast 3 秒时序伪影（错密「无错误提示」全是误判）

**现象**：C 维度（错密负例）3 个应用 × 2 轮共 6 条 FAIL「错密有错误提示」—— 页面全文里找不到任何错误文案，疑似产品静默失败。

**实证（H 探针，300ms 轮询 DOM）**：三应用的错误 toast **都正常弹出**（kb-web「用户名或密码错误（traceId:…）」、infra/cosmic「用户名或密码错误」）—— 只是 **`ElMessage` toast 默认 3 秒过期**，而旧脚本在提交后约 6-8 秒才取一次全文，toast 早已消失。activecode 的错误是**内联持久渲染**所以能抓到，进一步佐证是渲染形态差异而非产品差异。

**修法**：提交错密后**立即轮询 DOM 5 秒**（`.el-message__content` + `.el-form-item__error` 双选择器），把抓到的文本拼进断言全文。修复后 C 维度复跑 + targeted 补跑**全绿**。

**防复发口径**：凡「 toast / 自动消失的 transient UI」类断言，**必须在动作后实时轮询**，不能「做完动作睡几秒再取快照」。判据先行：先确认该应用的错误渲染形态（toast vs inline），再定抓取策略。

### 15.2 坑 #46 —— headless chromium 的 CDP **不上报页面 console API**（console 断言系统性漏抓）

**现象**：0.1.8 上线后连续三轮（J2/J3/J4）headless 复验，kb-ops 的 `[marschat-app-kit]` 归因告警**一条都抓不到**，而代码路径、产物签名（`http-not-200`/`权限探针失败`/`fail-open` 串全在）、网络层证据（fetchPermissions + diagnose 两次带票请求、调用栈分别落在 chunk 不同位置）全部正常 —— 「告警没输出」与「所有间接证据都表明它应该输出」直接矛盾。

**根因（J6 对照实验一锤定音）**：本环境 headless chromium 的 CDP **不上报页面 console API 调用** —— 页面内手动 `console.warn('X')` / `console.error('X')` 均**无** `Runtime.consoleAPICalled`、**无** `Log.entryAdded`（`Log.entryAdded` 只上报浏览器原生网络错误，如 "Failed to load resource: 404"）。即：**所有依赖 CDP 事件链的 console 断言都在系统性漏抓**，J2-J4 的「零告警」全是假阴性。

**修法（已固化进 `r14_lib.P`）**：

```python
# 注入（每个新 document 生效）：把 console.warn/error 落到 window.__WARN_LOG__
pg.send('Page.addScriptToEvaluateOnNewDocument', source=P.WRAP_JS)
# 取证（不依赖 CDP 事件链）：
pg.warn_log()      # 全量 warn/error
pg.appkit()        # CDP errs + 页面内 WARN_LOG 双源合并
```

**验收（K 轮回归）**：修复后同一路径复跑 kb-ops ⇒ `appkit()` 稳定抓到 `权限探针失败：GET /ops-api/auth/permissions?client=marschat-kbops · HTTP 404 · 后果：fail-open…`，REGRESSION_PASS。

**防复发口径**：**console 类断言（零告警 / 有告警 / 告警内容）一律先 `wrap_console()` 再断言**；单靠 CDP 事件链的「console 干净」结论一律不采信。本轮 J2-J4 的教训：当「代码+产物+网络」三边证据都指向某行为应该发生、而 console 说没有时，**先怀疑抓取链，再怀疑产品**。

### 15.3 0.1.8 的生产验证判据（J 系列方法论）

0.1.8（权限探针失败可归因告警）的生产生效确认，按「三层证据」由轻到重：

1. **产物层（不问浏览器）**：下载在线 entry chunk，查双签名串 `权限探针失败` + `fail-open`；再查诊断链常量 `http-not-200`/`network-error` 都在 bundle 里（证明 classify/warn 被打进产物）。
2. **网络层（不问 console）**：登录后导航一个**带 `meta.perm` 的业务路由**（`/ops/hosts`、`/kb/spaces` 等），用 `performance.getEntriesByType('resource')` 或注入 fetch 包装数 `/auth/permissions` 请求次数与带票状态：**失败路径 = 2 次同 URL**（fetchPermissions + diagnose），**成功路径 = 1 次**；带 `Authorization` 头才说明 `getToken` 通了。
3. **console 层（必须页面内包装，坑 #46）**：`wrap_console()` 后取 `appkit()` —— kb-ops（T-ENG-17 现场）应出现**一条**含 URL + 归因 + fail-open 后果的告警；其余四应用应**零告警**。

⚠️ **两个必踩的时序点**（J2 盲区，各浪费一轮）：

- **只有带 `meta.perm` 的路由才会触发守卫的 `ensure` 链**（`authGuard.ts`：无 `perm` 元数据直接放行，`ensurePermissions` 根本不跑）⇒ 只着陆 dashboard 验证告警**必然空手而归**；必须导航到具体业务路由。
- **登录前 bootstrap 的探针无票**（0.1.8 有意不诊断，防登录页噪音）⇒ 登录前的 401 是**预期行为**，不能当缺陷；判据看「有票之后的探针」。

### 15.4 Docker Hub 拉层 stall 与「龙虾」通道（流水线 #126 失败根因）

cosmic #126 在 API 镜像构建时拉 `python:3.12-slim` 两个层（12MB/30MB）**卡在 0B 十八分钟**，触发 20 分钟命令超时整体失败 —— **非代码问题**。mykng 直连 Docker Hub 受国内网络所阻常有 stall；Nexus 8083 docker 仓需认证、不可匿名代理。

**既定解法（仓库里本来就有，别重新发明）**：`cosmic-studio/scripts/pull-via-lobster.sh <image>` —— 经海外机「龙虾」（Tailscale 100.122.231.95）直连 Docker Hub 拉取后 `docker save | ssh | docker load` 回本机。预拉基础镜像后重触发流水线即过（#127 success）。

**防复发口径**：mykng 上任何「docker pull 长时间 0B」先查是不是基础镜像没预拉；前端流水线（pnpm build + tar + SSH 部署）不构建镜像、不受此影响，可与镜像预拉并行推进。

## 16. R14-L/M 沉淀：双模应用 sessionWatcher 误踢链 + 页面内包装的导航竞态丢失（2026-10-22）

> 本节对应 `STATUS.md` 的 `T-ENG-20`（infra 账密会话被踢回 `/infra/login?slo=1`）—— **根因、修法、复验全链闭环**。

### 16.1 坑 #47 —— 双模应用漏传 `watchSession` ⇒ legacy 账密会话被 sessionWatcher 误踢

**现象（R13 登记、R14-J7 部分观测）**：infra **账密登录**后，任何**全页面加载/重载**都会把用户踢回 `https://monitor.marschat.online/infra/login?slo=1`；SSO 路径不会。J7 曾记录「重载后 bootstrap 权限探针 `hasAuth=false` ⇒ legacy 令牌刷新后取不到」。

**根因（R14-L 静态代码 + 动态取证双重坐实，J7 的「取不到」被证伪——那是后果）**：

1. infra `marschat.ts` **未传 `watchSession`**、`APP_OPTIONS` **未设 `sessionMode`** ⇒ app-kit `config.ts` 缺省 `sessionMode='oidc'` ⇒ `useWatcher = (undefined ?? true) && 'oidc'==='oidc'` = **恒真**（`createMarschatApp.ts` 判据链③）；
2. 账密登录后令牌照落 localStorage（实测 `infra_access_token` 189 字符 HS384 JWT + `infra_token_kind=legacy`）；
3. **全页面重载** ⇒ bootstrap 见 `getToken()` 有值 ⇒ `sso.watchSession()` 启动（`createMarschatApp.ts:393` `if (useWatcher && getToken())`）；
4. watcher **3s 首探** `auth-center /auth/session`（`sessionWatcher.ts` `firstProbeTimer`）；legacy 账密登录**根本没有 IdP 会话**（没走 SAS 授权流）⇒ 探针返 `authenticated:false`；
5. `confirmCount` 缺省 1 ⇒ 一次即判失 ⇒ `clearAuth()` **清掉刚登录的令牌** + `window.location.assign('/infra/login?slo=1')`。

⇒ 三个此前的疑点一次说清：**为何只有重载触发**（SPA 内登录不重启 watcher，登录页 bootstrap 时无票不启动）；**为何 SSO 不触发**（有真 IdP 会话，探针 `authenticated=true username=1`）；**为何 bootstrap 探针无票**（watcher 已先清令牌——J7 记录的「取不到」是**后果非原因**，R14-L 实测重载后 bootstrap 权限探针 `hasAuth=true 200`）。

**R14-L 动态证据（headless + CDP Network 层）**：账密登录 → 重载 → bootstrap 权限探针 `hasAuth=true 200`（t0）→ 3.3s 后 URL 变 `/infra/login?slo=1` 且 localStorage 全清（t0+3.3s，与 3s 首探 + assign 时序吻合）→ login 页再探无票 401（后果闭合）；CDP 层证实 `/auth/session` 探针**确实发出**（200）。SSO 对照：探针 `authenticated:true` 不踢。

**修法（devtools `4dc21f63`，流水线 #865 已部署）**：infra `marschat.ts` 传函数式判据 —— `watchSession: () => isOidcToken()`（app-kit `types.ts` 推荐的双模写法；`isOidcToken()` 读 `infra_token_kind==='oidc'`，legacy 会话天然排除）。portal / kb-web 的等价处置是 `sessionMode:'bff' + watchSession:false`（T-LOW-22）—— **infra 是漏配的双模应用**，本轮补齐。

**复验（R14-M，14/14 全绿）**：账密登录 → 重载 → **不被踢**（URL 停 `/infra/dashboard`）、令牌键仍在、**CDP 层零 `/auth/session` 探针**（watcher 未启动）；SSO 对照 watcher 照常探针、不踢、三键俱在。

**防复发口径**：**双模应用（SSO + 独立账密并存）装配 app-kit 时必须显式传 `watchSession` 函数式判据**（或 `sessionMode:'bff'`）——缺省判据按「纯 OIDC 应用」处理，会把 legacy 会话送进 watcher 误踢链。已在用 app-kit 的应用按 `grep -rn "watchSession" src/marschat.ts` 自查：**没有的双模应用都是雷**。

### 16.2 坑 #46 补丁 —— 页面内 fetch 包装在「探针后立即导航」场景丢记录

**现象**：R14-L 取证时，页面内 fetch 包装抓到了 SSO 模式的 `/auth/session` 探针（`authenticated:true`），却**没抓到**账密模式的同URL探针——而 CDP Network 层证明它确实发出了（200）。

**根因**：`sessionWatcher` 判失后的动作是 `clearAuth()` + `location.assign(...)` —— 探针 fetch 的 `window.__FETCH_LOG__.push(rec)` 写在 `.then` 回调里，**导航在 push 之前发生** ⇒ 页面销毁、记录丢失。SSO 模式探针后不导航，故能抓到。

**修法（判据固化）**：凡「某行为之后可能立即导航」的取证，**必须 CDP Network 层（`P.reqs`/`P.stmap`，浏览器原生域不受页面销毁影响）兜底**，页面内包装只作增益。R14-M 的 M4 断言即按此写：`cdp_sess = [u for u in pg.reqs if '/auth/session' in u]`。

**防复发口径**：与坑 #46 合成完整口径 —— **console 类断言靠页面内包装（CDP 不报 console API）；网络类断言靠 CDP Network 层（页面内包装怕导航竞态）**；两层互不替代。

### 16.3 坑 #47 R15 延伸 —— kb-ops 第二例：邮箱验证码登录会话被误踢（比 infra 更隐蔽）

**发现路径**：R15 按 16.1 防复发口径做双模应用 `watchSession` 普查（`grep -rn "watchSession" src/marschat.ts`）：portal / kb-web / cosmic 均显式 `watchSession:false`（cosmic 在 `main.js` 内按 `isOidcSession()` 分流）、infra 已修 ⇒ **kb-ops 是第二例漏配**（未传 `watchSession` 且未设 `sessionMode`，与 infra 修复前完全同构）。

**为何 kb-ops 更隐蔽**：kb-ops 登录页 `showLocalLogin=false`（后端无本地登录端点 `/kb-ops/login` 必 403），表面是「纯 SSO 应用」；但 `showMailLogin=true` —— **邮箱验证码登录**走 auth-center `/auth/mail-login`（`AuthServiceImpl.loginByMail`：只签发 JWT + 写 sso cookie，**不建 Spring Security 会话**；`/auth/session` 判据是 SecurityContext，见 `AuthController.session` 注释）⇒ 该会话探针恒 `authenticated:false`；且 `LoginView.onMailLogin` 成功后 `window.location.replace(...)` **硬跳转** ⇒ bootstrap 必带票重跑 ⇒ watcher 必启动 ⇒ 3s 后必被踢 ⇒ **修复前每次邮箱登录 3 秒后被踢回 `/ops/login?slo=1`**（用户表现为「登录成功闪一下就被踢」，无限重试）。此前未暴露只因测试库无邮箱登录用例（坑 #45 家族：没测的路径不报错）。

**修法（devtools `73c312ec`，流水线 #866 已部署）**：与 infra 同款 —— `watchSession: () => isOidcToken()`；邮箱登录只 `setToken` 不设 `token_kind` ⇒ `isOidcToken()` 返 false ⇒ watcher 不启动；SSO 流经 `sso.ts:121 setTokenKind('oidc')` 不受影响。

**复验（R15-N，15/15 全绿）**：qa 账号（`qa-ms-u2@example.com`）邮箱登录（发码 → Redis 取码 → 填码真流程）→ 硬跳转落 `/ops/dashboard` → 13s 观测窗**不被踢**、令牌键在、**CDP 层登录后零新 `/auth/session` 探针**；SSO 对照 `token_kind=oidc`、watcher 照常探针不回归。

**顺带两个调查记录**：① `e2e_admin@test.local` 在 `marschat_auth.user` 已 `deleted=1`（软删，MyBatis-Plus 逻辑删除过滤 ⇒ 邮箱登录报「邮箱未绑定账号」）—— 邮箱登录类用例须用未删+启用+已绑邮箱账号；② **`marschat_auth` 才是 auth-center 真源库，`kb_auth` 是遗留库**（两者都有 `user` 表，查错库会得出完全错误的结论）。

## 17. R15 沉淀：同源权限代理三要素 + 遗留 fetchPermissions 跨域陷阱（T-ENG-17 全链，2026-10-22）

> 本节对应 `STATUS.md` 的 `T-ENG-17`（kb-ops 权限链双通道断裂）—— **根因、修法、复验全链闭环（坑 #48）**。

### 17.1 坑 #48 —— 同源权限探针需要「部署栈路由」就位；应用侧遗留 `fetchPermissions` 是跨域暗线

**现象**：kb-ops 登录后导航业务路由，app-kit 权限探针 `GET /ops-api/auth/permissions?client=marschat-kbops` 返 **404** ⇒ `configured=false` ⇒ **fail-open 静默全放行**（0.1.8 归因告警让失效自证，但根因未断）；R12 另记录「跨域直连 `auth.marschat.online/auth/permissions` 恒 403」而 R14 实测同 URL 返 200 —— 两轮观测矛盾。

**根因（两层，R15 定位）**：

1. **部署层缺路由** —— app-kit ≥0.1.3 的同源策略（`resolvePermissionsIssuer`：IdP 与站点不同源 ⇒ 探针 = `apiBase + /auth/permissions`）**要求部署栈把 `{apiBase}/auth/**` 路由到认证中心**：kb-web 有（kb-gateway `/kb/api/auth/**`）、infra 有（nginx `/infra/api/auth/**`）、**唯 kb-ops 缺** —— 宿主 nginx `/etc/nginx/conf.d/locations/ops.conf` 把 `/ops-api/` 整体代理给自家后端（context-path `/kb-ops`，无 `/auth/permissions` 端点）⇒ 带票 404（无票先被 Spring Security 拦成 401）。
2. **前端遗留跨域暗线** —— `MainLayout.vue` 的 `onMounted` 仍活跃调 `fetchPermissions(permOptions)`（infra/kb-web 同处**只 import 未调用**，唯独 kb-ops 在调），`permOptions.issuer = APP_CONFIG.issuer`（跨域 IdP）。该调用与 app-kit 预取**共享 60s 模块级缓存**：登录页预取无票 401 不预热 ⇒ SPA 登录后 MainLayout 挂载时缓存冷 ⇒ 这一发即**跨域直连中心**（R15-O 实测抓到）。R12「恒 403」/R14「200」的矛盾由此解释 —— 取决于票据类型与 CORS 放行时机；**中心一旦收紧 CORS 即静默 fail-open**（正是 R11 T-ENG-11 的原始形态）。

**修法（两处，当日闭环）**：

1. 宿主 nginx 新增 `location /ops-api/auth/ → proxy_pass 127.0.0.1:8090/kb/api/auth/`（与既有 `/ops/auth-api/` **同上游**，零新增端点暴露面 —— 同样的网关 auth 路由本就经 `/ops/auth-api/` 公开可达；`nginx -t` + 热 reload；改动前备份 `ops.conf.bak-20261022-teng17`）。**未走**「kb-ops 后端补 BFF 代理端点」方案：走网关与 kb-web 同路、零后端改动、无服务身份兜底语义风险。
2. kb-ops `permOptions.issuer` 改 `APP_CONFIG.apiBase`（devtools `a7f08302` + 流水线 #867）—— 与 app-kit 缺省策略同路，跨域暗线切除；SSO 客户端 issuer 不变（换票仍必须在中心发生）。

**复验（R15-O/P，headless 真浏览器，全绿）**：探针**同源 200 + `configured=true` + 权限点数组**（qa 仅 `marschat-kbops:menu:dashboard`）；**零跨域 `/auth/permissions`**（邮箱 + SSO 冷缓存双流，CDP 层实证 cross=[]）；**零 `[marschat-app-kit]` 告警**；**权限真正生效** —— qa 账号侧边菜单**仅「看板」**（修复前 fail-open 全量渲染）；业务端点无回归（`/ops-api/ops/dashboard` 200、越权 `/ops-api/ops/host/list` 403 = 正确执行）；SPA 200。

**防复发口径（同源权限代理三要素，缺一即 fail-open）**：① **组件侧**：`permissionsIssuer`/缺省策略走同源 `apiBase`（app-kit ≥0.1.3 已内建）；② **部署侧**：`{apiBase}/auth/**` 必须路由到认证中心（新增/改造应用时与前端 apiBase 同步设计，**别忘了 nginx/gateway 这一层**）；③ **应用侧**：`grep -rn "fetchPermissions(permOptions)" src/` —— MainLayout 等遗留活跃调用点的 `permOptions.issuer` 必须同源（共享 60s 缓存会让它在前端无感时补发跨域请求）。**验收判据**：登录后 CDP 层 `/auth/permissions` 请求**零跨域**、带票 200、`configured=true`、非超管账号菜单按权限点收窄。

---

## §18 · 坑 #49：PyMySQL 无原生多地址 —— GR 集群应用层 failover 自建三件套（R16）

**现象**：R13 故障（GR 主库从 105 漂到 182:3307）时六应用 SSO 全线 500（`error code [1290] super-read-only`）。R14/R15 排查发现 Java 侧 8 服务早已是 Connector/J 三地址 failover（`loadBalanceStrategy=random&failOverReadOnly=false`，auth-center 线上日志实证 `FailoverConnectionProxy`），**唯独 cosmic-api（Python/PyMySQL）仍是 `DB_HOST` 单地址 105:3306** —— 主漂移后它的写全部 1290，是应用侧最后一个单点。

**根因**：PyMySQL/MySQLdb **没有** Connector/J 那样的多地址负载均衡与 failover（SQLAlchemy 也不支持 host 列表），单 `host=` 参数直连，连不上就是连不上、连到从库就是连到从库（GR 单主模式下从库连接成功、写才报错）。

**修法（cosmic-studio `275d600`，R16）**——应用层自建三件套：

1. **候选枚举**：`config.py` 新增 `DB_HOSTS`（逗号分隔 `host:port`），`DB_HOST` 单地址保留作 dev 兼容；compose env 配三成员全枚举。
2. **建连候选 + 落点标记**：`connect(db, exclude=None)` 按候选逐个 `pymysql.connect`，成功即在连接上打 `conn._mc_host = (host, port)`；全部失败抛最后一个异常。
3. **写时 1290 自愈**：`execute`/`executemany` 捕获异常后判 `_is_super_readonly_err`（str 含 `1290`/`super-read-only`），自动把当前落点加入 `excluded` 换候选重连重试（有界：最多试完候选）；`tx` 入口先 `SELECT @@super_read_only`，抽到 SECONDARY 直接换节点，保证事务全程在 PRIMARY（**事务中途不换节点**——跨节点事务上下文必丢，中途 1290 直接抛给调用方）。

**实测（R16-T，cosmic-api 容器内真集群 6/6）**：T0 基准（105=PRIMARY，182:3307/3308=SECONDARY）· T1 读 · **T2 写自愈（候选从库打头，182:3307→3308→105 连续切换落 PRIMARY）** · T3 tx 可写探测 · T4 首位不可达节点跳过 · T5 单地址兼容。R16-U 浏览器 9/9（登录/业务页/Console 零错/零 5xx/零 CORS）；服务端 15min 日志零 1290。

**踩过并修掉的三个实现坑（复现同类改造时直接避开）**：

- **重试边界差一**：`len(excluded) < len(DB_HOSTS) - 1` 会在「还剩最后一个候选」时误判为无候选可试直接 raise——必须是 `< len(DB_HOSTS)`。
- **`_acquire` 池路径必须过 exclude**：换节点重试时若只给「新建连接」路径传 exclude，连接池里**落在被排除节点的旧连接会被原样取出复用**，重试打回同一个从库无限失败。池取到连接后也要判 `_mc_host in exclude` 并丢弃。
- **`finally` 与 `continue` 的交互**：`try/except/finally` 里 `continue` 后 finally 照样执行——坏连接必须先 `_discard`（close 且 `open=False`），finally 据此跳过归还；成功路径的 `_release` 要么放 `return` 前，要么靠 finally + open 检查，**别写 try 里 return、finally 外又跟一行不可达的 `_release`**（连接静默泄漏）。

**顺带的测试环境教训**：mykng 上连续多轮 headless chromium 不退出会累积（实测 32 进程/9G 内存）导致新实例 `chromium not ready`；排查先 `ps aux | grep -c 'chromi[u]m'` + `free -m`，`pkill -f 'user-data-dir=<profile>'` 精准清（**模式串带方括号防自伤**）。另：`launch_retry` 会真起 chromium 且占用同名 profile 的 Singleton 锁——单线跑验证不要先调它再 `newpage` 同 profile，直接唯一 profile 名（带时间戳）即可。

**防复发口径**：① 新应用接 GR 集群时，**无论语言**先回答「数据源是否单地址」——Java 用 Connector/J 三地址 + `failOverReadOnly=false`，Python 用本坑三件套（或 ProxySQL/MySQL Router，但那要动部署栈需单独拍板）；② 验收判据 = **候选列表首位故意配成 SECONDARY/不可达地址**，读正常、写自动落 PRIMARY（真集群实测，不是单测 mock）；③ 数据库侧 `single_primary_mode` 复发雷（SET PERSIST 写进数据卷）不在本坑范围，属 T-ENG-19 待良哥拍板项。
