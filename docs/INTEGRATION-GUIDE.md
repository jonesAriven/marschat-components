# 自建系统接入统一认证与公共组件指南

> **受众**: 未来在 marschat 生态新建的前后端系统（Vue3 SPA + Spring Boot 3 / Java 21）
> **目标**: 从零接入「统一登录（SSO 免登 + 独立登录 + 邮箱码）/ 统一鉴权（RBAC 三层同源）/ 用户统一管理 / 账号映射」
> **状态**: 2026-09-14 终态（Phase 9 收官 + 全量回归 + 两项修复验收后），与 6 个现网应用的实际接入口径一致
> **本文不覆盖**: auth-center 本身的开发与部署（见 devtools/docs/adr/ADR-2026-09-10）

---

## 0. 组件全景（4 个包，2 个生态）

| 包 | 生态 | 当前版本 | 干什么 | 谁消费 |
|---|---|---|---|---|
| `@marschat/auth-components` | npm | 0.8.5 | 认证 UI（LoginPanel/SsoCallbackView/用户管理面板×4/PermissionGate）+ SSO client（PKCE/静默免登/静默续期/会话监视）+ token 存储 + RBAC composables（usePermissions/useMenus） | 所有前端 |
| `@marschat/frontend-common` | npm | 0.3.5 | `createRequest` axios 封装、`createAuthGuard` 路由守卫、`createLocalStorageTokenStore`、usePagination/useLoading、SidebarMenu | 所有前端 |
| `com.marschat:auth-core` | Maven | 2.x | Java 认证：`TokenProvider`(HS256)、`OidcTokenVerifier`(RS256/JWKS)、`@MarsUser LoginUser`、`@RequirePermission` 接口级鉴权、`MenuRegistryReporter` 菜单上报、Feign 透传 | 所有 Java 后端 |
| `com.marschat:common-core` | Maven | 1.x | Result 统一返回 / 异常体系 / MyBatis-Plus 自动配置（分页+自动填充）/ 链路 trace / 事件 | 所有 Java 后端 |

- **npm 源**: Nexus `https://nexus.marschat.online/repository/npm-*/`
- **Maven 源**: Nexus `https://nexus.marschat.online/repository/maven-releases/`
- **仓库**: Gitee `jonesAriven/marschat-components`（monorepo：packages/ 前端 + java/ 后端）

---

## 1. 接入总览（一次 SSO 免登的完整链路）

```
浏览器打开 https://<app>.marschat.online/
  └─ 前端无本地 token → 跳 auth-center /oauth2/authorize (OIDC authorization_code + PKCE)
       └─ IdP 会话 Cookie (Domain=marschat.online) 存在 → 静默 302 回 <app>/sso-callback?code=...
            └─ SsoCallbackView: code 换 token(RS256) → initTokenConfig 约定的 localStorage 落库
                 └─ router.replace(target)  ← ⚠️ target 必须是 router 内部路径（见坑 #1）
后端收到 API 请求 (Bearer RS256 token)
  └─ JwtAuthFilter: JwtUtil.parseUsername = HS256 自签失败 → OidcTokenVerifier.verify (JWKS, TTL 10min)
       └─ 认证成功 → SecurityContext；失败/过期 → 必须 401（见坑 #2）→ 前端 401 拦截器静默重授权
```

---

## 2. Level 0：把新应用注册进平台（约 10 分钟，全程不改 auth-center Java）

**唯一真源 = `devtools/apps-registry.yml`**。新应用 = 加一段 + 跑生成器 + auth-center 重启：

```yaml
  - client-id: marschat-<新应用>          # 权限点前缀，全局唯一
    name: <中文名>
    type: public                          # 前端 SPA 用 public(PKCE)；有机密后端用 confidential
    menu-report-secret: ${<APP>_MENU_REPORT_SECRET:<48位十六进制>}   # 菜单/账号上报凭据
    auth:
      redirect-uris:                      # 公网 + 内网 + localhost 三个环境都登记
        - https://<app>.marschat.online/<ctx>/sso-callback
      post-logout-redirect-uris:
        - https://<app>.marschat.online/<ctx>/login
    frontend:
      entry: https://<app>.marschat.online/<ctx>/
      context-path: /<ctx>
      api-base: /<ctx>/api
```

然后：

```bash
cd devtools && python scripts/gen-from-registry.py
# 产物① auth-center/src/main/resources/clients.yml（OIDC 客户端种子，重启 auth-center 生效）
# 产物② 各前端 public/app-config.json（运行时配置；新应用的由部署脚本落到 dist）
```

给容器注入 `MARSCHAT_MENU_REPORT_SECRET`（与 registry 中同值，mykng `.env`）。

---

## 3. Level 1：最小接入（SSO 登录 + API 带 token）

### 3.1 前端（照抄 infra-monitor-web 的薄适配层，4 个文件）

```
src/
├── config.ts        # R6 运行时配置（唯一派生点）
├── utils/token.ts   # initTokenConfig 薄适配
├── utils/sso.ts     # createSsoClient 薄适配
├── utils/request.ts # axios + 401 静默续期拦截器
├── views/login/LoginView.vue        # 用组件 LoginPage / bootstrapLoginPage
├── views/sso/SsoCallbackView.vue    # code 换票 + router.replace(target)
└── main.ts                          # 挂载顺序见下
```

**config.ts**（优先级：运行时 app-config.json > 编译期 env > 默认）：

```ts
let runtime: Record<string, string> = {}
try {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', `${import.meta.env.BASE_URL}app-config.json`, false)  // 同步 XHR
  xhr.send(null)
  if (xhr.status === 200) {
    // ⚠️ 坑 #4：gen-from-registry 产物首行是 // 注释横幅，必须剥掉再 parse
    runtime = JSON.parse(xhr.responseText.replace(/^\s*\/\/.*$/gm, ''))
  }
} catch { /* 回落 env/默认 */ }
export const CONTEXT_PATH = runtime.contextPath ?? '/<ctx>'
export const API_BASE_URL = runtime.apiBase ?? '/<ctx>/api'
export const OIDC_ISSUER = runtime.issuer ?? 'https://auth.marschat.online'
export const OIDC_CLIENT_ID = runtime.clientId ?? 'marschat-<新应用>'
export const OIDC_REDIRECT_URI = `${window.location.origin}${CONTEXT_PATH}/sso-callback`
```

**utils/token.ts**：

```ts
import { initTokenConfig } from '@marschat/auth-components'
initTokenConfig({
  accessTokenKey: '<app>_access_token',   // localStorage 键前缀自定，勿与既有应用撞
  refreshTokenKey: '<app>_refresh_token',
  tokenKindKey: '<app>_token_kind',       // 'oidc' | 'legacy'，401 分流靠它
  idTokenKey: '<app>_id_token',           // SLO 用作 id_token_hint
})
export * from '@marschat/auth-components' // getToken/setToken/isOidcToken/... 原样转发
```

**utils/sso.ts**（⚠️ 坑 #12：必须**包一层绑定配置**再导出，组件裸函数签名是 `(config, redirect?, opts?)`，直接再导出会把 redirect 当 config → 静默失效且不报错）：

```ts
import { createSsoClient } from '@marschat/auth-components'
import { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_REDIRECT_URI, CONTEXT_PATH } from '@/config'
export const SSO_CONFIG = {
  issuer: OIDC_ISSUER, clientId: OIDC_CLIENT_ID, redirectUri: OIDC_REDIRECT_URI,
  scope: 'openid profile',
  loginUrl: `${window.location.origin}${CONTEXT_PATH}/login`,
  silentLogin: true,                      // 进登录页先探 IdP 会话，有则免密进入
}
export const sso = createSsoClient(SSO_CONFIG)
// 绑定式转发（签名与调用点严格对齐）：
export const bootstrapLoginPage = (redirect?: string, opts?: { force?: boolean }) => sso.bootstrapLoginPage(redirect, opts)
export const renewByReauthorize = (redirect?: string) => sso.renew(redirect)
export const ssoLogout = (options?: SloOptions) => { stopSessionWatcher(); sso.logout(options) }
export function startSessionWatcher(options?: SessionWatcherOptions) { /* 单例 + getLocalIdentity 身份守卫，抄 infra sso.ts:96 */ }
```

**utils/request.ts**（401 静默续期，⚠️ 坑 #1/#3 两处顺序铁律）：

```ts
request.interceptors.response.use(..., async (error) => {
  if (error.response?.status === 401 && !originalRequest._retry) {
    if (isWhiteList(url)) return Promise.reject(error)
    // ⚠️ 坑 #3：isOidcToken() 判断必须在「有没有 refresh_token」之前——
    //    SAS 不给 public client 发 refresh_token，先判断它会把 OIDC 用户直接弹回登录页
    if (isOidcToken()) {
      originalRequest._retry = true
      await renewByReauthorize(currentSpaPath())   // ⚠️ 坑 #1
      return Promise.reject(error)
    }
    clearTokens(); router.push('/login'); return Promise.reject(error)
  }
  ...
})
// ⚠️ 坑 #1：renew 回跳必须传 **router 内部路径**（剥 CONTEXT_PATH 前缀）。
//    传 location.pathname 原样值（/infra/dashboard）→ sso-callback 的
//    router.replace(base) 再拼一次 → /infra/infra/dashboard 落 404（2026-09-14 换废票实测）。
function currentSpaPath(): string {
  const p = window.location.pathname
  const stripped = p.startsWith(CONTEXT_PATH) ? p.slice(CONTEXT_PATH.length) : p
  return (stripped || '/') + window.location.search
}
```

**main.ts 挂载顺序**（⚠️ 坑 #6）：

```ts
import { CONTEXT_PATH } from '@/config'
window.__MARSCHAT_APP_BASE__ = CONTEXT_PATH   // ⚠️ 坑 #6：公共库跳登录页靠它拼 base，不设会跳到域名根 404
setupAuthGuard(router)                        // ⚠️ 坑 #5：必须在 app.use(router) 之前（先于首次导航拉权限）
app.use(pinia); app.use(router); app.use(ElementPlus); app.mount('#app')
if (getToken()) { startSessionWatcher(); void permissions.ensure() }  // SLO 联动 + 权限预取，失败降级不阻塞
```

### 3.2 后端（Spring Boot 3，照抄 infra-monitor-server 三件套）

**依赖 + 自动装配取舍**（application.yml）：

```yaml
spring:
  autoconfigure:
    exclude:            # ⚠️ 按需排除，全要就都不写；排除理由写注释
      - com.marschat.auth.AuthJwtAutoConfig      # 不要 TokenProvider(HS256 签发) 时排除
      - com.marschat.auth.AuthWebAutoConfig      # 不用 @MarsUser 时排除
      - com.marschat.auth.AuthFeignAutoConfig    # 无 OpenFeign 时排除
      - com.marschat.auth.authz.AuthzAutoConfig  # 不用 @RequirePermission 时排除（Level 2 要用则保留）
marschat:
  oidc:
    issuer: https://auth.marschat.online                        # ⚠️ 坑 #8：必须与签发端一致（公网域名）
    jwks-uri: http://<内网直达 auth-center>:8085/oauth2/jwks     # ⚠️ 坑 #9：JWKS 走内网，不出公网
```

**OidcConfig.java**（排除 AuthJwtAutoConfig 后需手动声明 bean）：

```java
@Configuration
public class OidcConfig {
    @Bean
    public OidcTokenVerifier oidcTokenVerifier() { return new OidcTokenVerifier(); }
}
```

**JwtUtil 双验签**（HS256 自签失败回退 RS256，`auth-core` 统一实现，全平台唯一口径）：

```java
public String parseUsername(String token) {
    Claims claims = tryParseHs256(token);          // legacy 自签
    if (claims == null) claims = oidcTokenVerifier.verify(token);   // OIDC RS256
    return claims == null ? null : claims.get("username", String.class) != null
            ? claims.get("username", String.class) : claims.getSubject();
}
```

**SecurityConfig —— ⚠️ 坑 #2（本指南最重要的一条）**：

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/auth/login", "/auth/mail-login", "/auth/mail-login/send-code").permitAll()
    .anyRequest().authenticated())
// 🔴 必须显式配 401 entry point！不配的话 Spring Security 默认落
//    Http403ForbiddenEntryPoint → 过期/无效 token 返回 403 → 前端 401 拦截器
//    永不触发 → 用户假死（2026-09-14 回归实测）。401=未认证，403=已认证无权限。
.exceptionHandling(e -> e.authenticationEntryPoint(
    (req, res, ex) -> res.sendError(HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized")))
.addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
```

---

## 4. Level 2：权限体系（RBAC 三层同源 + 接口级闸门）

### 4.1 菜单/权限点上报（后端 classpath `menu-registry.yml`）

```yaml
client: marschat-<新应用>
menus:
  - key: dashboard        # = sys_permission.code，前端 permCode('menu','dashboard') 严格对齐，禁改名
    title: 总览看板
    path: /dashboard
    order: 1
  - key: users
    title: 用户管理
    path: /users
    min-role: admin       # 可选：角色门槛
```

application.yml `marschat.menu.report.*` 配置（凭据 = registry 的 menu-report-secret，内网直达 auth-center `:8085`，`/internal/**` 不在公网白名单）。启动时全量覆盖上报，缺失凭据 WARN 不阻断。**账号映射上报**（`marschat.account.report.*`）复用同一 secret。

### 4.2 前端三层同源（菜单过滤 / 路由守卫 / 组件门）

```ts
// utils/permissions.ts —— 三个消费方读同一份权限状态
export const permCode = (type: 'menu' | 'api', code: string) =>
  `${SSO_CONFIG.clientId}:${type}:${code}`
export function setupAuthGuard(router: Router) {
  createAuthGuard(router, {
    ensure: () => permissions.ensure(),
    hasPerm: (code) => permissions.check(code),
    onDeny: () => router.replace('/dashboard'),   // ⚠️ 坑 #1 同类：必须传 router 内路径，不拼 CONTEXT_PATH
  })
}
// 路由 meta.perm 与 PermissionGate 的 perm **必须传全码** permCode('menu','xxx')
// ⚠️ 坑 #10：含冒号的 code 原样使用、不含才补 client 前缀——传半码会与菜单判定码永不匹配
```

**R10 默认策略**：auth-center 侧未给本应用配任何权限点（`configured=false`）→ 全部放行。所以接入后存量行为不变，权限点由上报逐步产生。守卫 ensure 失败 fail-open（枢纽抖动不打死整站）。

### 4.3 后端接口级闸门（`@RequirePermission`，G3/G4 同款）

```java
@RequirePermission("api:admin")     // 拦截器自动补 client 前缀 → marschat-<app>:api:admin
@GetMapping("/admin/users")
public Result<?> list() { ... }
```

- 语义：ANY（默认）/ALL；平台超管恒放行
- **fail-open 默认 true**（auth-center 不可达放行 + WARN）；管理面强安全语义显式配 `marschat.authz.fail-open: false`
- 权限点 type=api 的登记走统一认证中心「角色与菜单授权」页签

---

## 5. Level 3：可选能力（按需取用，全部有现成组件）

| 能力 | 前端组件 | 后端配套 | 参考实现 |
|---|---|---|---|
| 「本系统用户」管理页 | `UserManagementPanel`（client 作用域 3 页签） | 用户 CRUD API | kb-ops `/ops/users` |
| 中心「统一认证中心」4 页签 | `UserManagementPanel` + `CrossAppAuthPanel` + `AccountMappingPanel` + `MenuPermissionPanel`（platform 作用域） | 平台级 API | portal `/portal/admin` |
| 用户级菜单减法 | `UserMenuOverridePanel`（只能减法，60s 缓存生效） | override 读/写 API | portal `/portal/admin` |
| 账号映射（本地账号↔中心身份） | `AccountMappingPanel` | `LocalAccountReporter` 启动上报 + `/user/mapping` 解析 | infra `LocalAccountReporter.java` + cosmic `_resolve_local_user` |
| 跨应用单点登出 | `startSessionWatcher()`（visibility/focus/60s 探针 + 身份一致性守卫） | — | 各前端 main.ts |
| 统一登录页 | `LoginPage` / `LoginPanel`（账密+邮箱码+忘记密码+SSO 按钮） | — | 各前端 LoginView |

---

## 6. 踩坑铁律速查（全部为本平台实战血泪，编号与正文引用一致）

| # | 铁律 | 后果（不守时） |
|---|---|---|
| 1 | renew/onDeny 回跳传 **router 内部路径**（剥 CONTEXT_PATH），不传 location.pathname | `/infra/infra/dashboard` 双前缀 404 |
| 2 | SecurityConfig **必须显式 401** authenticationEntryPoint | 过期 token 返回 403 → 前端拦截器不触发 → 假死 |
| 3 | 401 分流先判 `isOidcToken()` 再看 refresh_token | OIDC 用户被误判弹回登录页，静默续期失效 |
| 4 | app-config.json 先剥 `//` 注释横幅再 JSON.parse | 运行时配置静默失效（回落 env，最难查） |
| 5 | `setupAuthGuard` 在 `app.use(router)` 之前 | 首屏路由跳过权限判定 |
| 6 | `window.__MARSCHAT_APP_BASE__ = CONTEXT_PATH` 必设 | 公共库跳登录跳到域名根 → 404 |
| 7 | sso.ts 薄适配**包一层绑定配置**，禁止直接再导出组件裸函数 | `config.clientId=undefined` 静默失效不报错 |
| 8 | `marschat.oidc.issuer` 必须与签发端逐字一致 | requireIssuer 校验失败，全部 token 验不过 |
| 9 | JWKS 与 `/internal/**` 走内网（compose 服务名或 host 网络 127.0.0.1:8085），不出公网 | secret 暴露 / JWKS 拉不到 |
| 10 | 权限点 code 传**全码** `permCode(type,code)`；含冒号原样使用 | 半码永不匹配，权限静默失效 |
| 11 | IdP 会话 Cookie `Domain=marschat.online; Secure` → **内网 IP 直连无静默免登**（cookie 带不过去） | 本地调试 SSO 静默失效（手动点 SSO 正常） |
| 12 | nginx `try_files $uri =404` 只认常规文件；`index.html` 不许进 immutable 缓存 | 裸目录 URI 404；发版后用户拿旧入口 |
| 13 | 升级公共库必须三对齐：`package.json` 约束 + lock 实锁 + 线上产物版本戳 | 只升 lock 不升约束 → `pnpm install` 重建后静默回落旧版 |
| 14 | SPA 受控组件不响应 JS value 注入；E2E 用 CDP `Input.insertText` 真实键盘输入 | 自动化测试表单永远填不上 |
| 15 | 数据/权限类查询显式过滤软删位 `deleted=0` | 误判出不存在的数据 |

---

## 7. 上线前验收清单（照做，全部有脚本化先例）

- [ ] SSO 免登：已有 IdP 会话 → 打开应用直接落地（真浏览器，**禁缓存**）
- [ ] 独立登录：本地账密登录 + 邮箱验证码登录
- [ ] 负例：错误密码提示明确、不误登录；无 token 访问管理接口 401
- [ ] 菜单/权限：中心配置权限点 → 60s 内应用侧生效（缓存 TTL）；未配置时 R10 全放行
- [ ] 接口闸门：有权限 200 / 无权限 403（文案 grep 定位闸门分支）/ 无 token 401
- [ ] 统一登出：任一应用 SLO → 其他应用下次交互被会话监视器请出
- [ ] **换废票 E2E**：手动注入垃圾 access_token → 重载 → 应回到正常页面（验 401→静默续期全链，能暴露 #1/#2 两类坑）
- [ ] 三环境 redirect_uri：公网 / 内网 IP / localhost 都能回调

## 8. 版本发布流程（组件仓库）

```bash
cd marschat-components
pnpm build        # 前端两包（vue-tsc + vite build）
pnpm build:java   # 后端两包（mvn install → Nexus）
pnpm publish --filter @marschat/auth-components
pnpm publish --filter @marschat/frontend-common
# Java 用 maven-release 或改版本号 mvn deploy（Nexus maven-releases）
```

应用侧升级后按坑 #13 三对齐核对，再走各应用 Woodpecker 流水线部署。

---

## 关联文档

- [APP-UPGRADE-GUIDE.md](./APP-UPGRADE-GUIDE.md)（0.1.0 时期旧版升级指南，历史参考）
- [SSO-IMPLEMENTATION-SUMMARY.md](./SSO-IMPLEMENTATION-SUMMARY.md) / [ADR-SSO-Cookie-Domain-Sharing.md](./ADR-SSO-Cookie-Domain-Sharing.md)
- [auth-components/README.md](../packages/auth-components/README.md) / [frontend-common/README.md](../packages/frontend-common/README.md) / [auth-core/README.md](../java/auth-core/README.md)
- 平台演进全记录: `devtools/docs/adr/ADR-2026-09-10-平台重构Phase0清死代码.md`（§26–§33 六应用接入/双作用域/G3/G4/账号映射/全量回归）
- 标准参考实现（薄适配层四件套 + 后端三件套）: `devtools/infra-monitor/infra-monitor-{web,server}`
