# 排查手册 · 统一认证平台（症状 → 定位 → 根因）

> 配套：`README.md`（权威手册：设计 / 接入 / 使用运维）· `PHASE12-SUMMARY-2026-09-17.md`（收口汇总）
> **用法**：按「症状」检索 → 按「定位路径」逐跳验证 → 对号「根因」。**禁止跳步猜根因**（铁律 `trace_terminal`）。
> 本文不含任何口令 / secret 明文；凭据见 Vaultwarden（`vault.marschat.online`）或 infrastructure-map 技能。

---

## 0. 30 秒决策树

```
问题在「登录」还是「登录后」？
├─ 登录前（跳转/免登/表单）  → §1
├─ 登录后（菜单/按钮/接口）  → §2
└─ 「我改了但没生效」        → §3（产物与部署）
再有就是「数据/配置」与「授权」→ §4
无论哪类，动手前先跑 §5 取证命令集拿事实，不要凭印象
```

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
| **现状** | **已修**：链3 显式 `permitAll("/favicon.ico")` + `static/favicon.ico` |

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
| ⑭ | R3/R4 九条「登出后仍免登」FAIL，看着像 SLO 全崩 | portal「退出登录」在 `el-dropdown-menu` 内，**未展开时不在 DOM** → 脚本返回 `NO-BUTTON`，登出压根没触发 | 先点 `.user-info`/`.el-dropdown`/`.el-avatar` 展开再点；并单列「按钮是否命中」断言 |

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
