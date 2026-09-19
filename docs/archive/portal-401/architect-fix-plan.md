# MarsChat 统一认证平台 · 两缺陷修复方案（架构师方案稿）

> **状态：待用户拍板。本文只出方案，不落任何代码/配置/数据改动。**
> 作者：高见远（架构师）｜日期：2026-09-18
> 取证环境：mykng `192.168.31.105`，**headless chromium 150 + 原生 CDP**（未占用用户本机桌面）
> 本文不含任何明文口令 / secret（凭据一律见 Vaultwarden 或 infrastructure-map 技能）

---

## 1. 背景与范围

### 1.1 平台现状基线（实读源码 + 线上实测确认）

| 项 | 值 | 来源 |
|---|---|---|
| IdP / 身份真源 | `auth-center`（`auth.marschat.online`，容器 :8085） | `SecurityConfig.java`、nginx 站点 |
| 登录页 | **静态文件** `auth-center/src/main/resources/static/login.html`（74 行，内联 CSS + 一段读 `?error`/`?logout` 的脚本） | 实读 |
| 入口点 | 链1 `LoginUrlAuthenticationEntryPoint("/login.html")` | `SecurityConfig.java:63-65` |
| 共享组件 | `@marschat/auth-components` **0.8.8** | `package.json` |
| Spring Security | 6.2.4（Spring Boot 3.2.5） | `pom.xml` + `javap` 校验 jar |
| auth-center 下游 | **12 个直接依赖**（appmap impact） | `shared/app-map/appmap.py` |
| auth-center 部署 | Woodpecker **repo_id=4**，push main 自动跑；**禁止手动 SSH 部署** | `.woodpecker.yml` |
| 公网边缘 | `auth.marschat.online` = 腾讯云2号 nginx，**白名单式反代 + 末尾 `location / { return 404; }`** | `config-as-code/hosts/tencent-cloud-2/nginx/sites-available/auth.marschat.online` |

### 1.2 关键事实（本轮新取证，直接决定方案取舍）

| # | 事实 | 取证方式 |
|---|---|---|
| **F1** | IdP 登录页上 `document.referrer` **只有 origin，没有路径**：从 `/portal/login` 出发 → `https://main.marschat.online/`；从 `/ops/login` 出发 → `https://kb.marschat.online/` | CDP 实测 + 响应头 `referrer-policy: strict-origin-when-cross-origin` |
| **F2** | `kb-web`（`/kb`）与 `kb-ops`（`/ops`）**同 origin** `https://kb.marschat.online` → 仅凭 referrer **无法区分**这两个应用 | 实测 referrer 值 + `clients.yml` |
| **F3** | 原始 authorize 参数**确实存在 session 的 SavedRequest 里**：在 `/login.html` 提交账密后，浏览器被自动续跑授权流，落在 `.../portal/auth/callback?code=...&state=evidence1` | CDP 实测（`cdp-shot.mjs`） |
| **F4** | **SavedRequest 不会被后续普通请求"吃掉"**：在登录页上先后发出 `GET /auth/session`（200）与 `GET /login-context`（403，未实现）两次同源请求后，再提交登录，**仍能续跑授权流拿到 code** | `savedreq-probe.mjs` → `saved_request_survived: true` |
| **F5** | 边缘 nginx 对 `/login` 是**前缀匹配**（`location /login { proxy_pass … }`），因此 `/login-context` 这类新路径**无需改 nginx 即可公网可达**（实测 403 = 已到 auth-center 链3，而非 404） | nginx 站点实读 + `curl` 探针（`/login-context`→403，`/zzz-probe`→404） |
| **F6** | `SavedRequest` 的读取 API 在 6.2.4 可用：`HttpSessionRequestCache#getRequest(req,res)` → `SavedRequest#getRedirectUrl()/getParameterMap()`；但 `SAVED_REQUEST` 常量**已非 public**，只能用字面量兜底 | `javap -cp spring-security-web-6.2.4.jar` |
| **F7** | `UserManagementPanel` 的**真实宿主是 5 个 SPA**（portal×2 视图 / kb-ops / kb-web / infra-monitor / cosmic-studio），**not 6**；activecode 只用 UMD 逻辑层（`createUserAdminClient`），自绘 HTML，**不含 Vue 组件** | 全仓 grep + `umd.ts` 注释实读 |
| **F8** | 各宿主品牌色不同：kb-web `#c9a96e`（金棕，且有 `html.dark`）、kb-ops/infra `#409eff`、portal/cosmic 用 EP 默认 `#409eff`；而 IdP 登录页写死 `#2563eb` | grep `--el-color-primary` + CDP 读计算值 |

### 1.3 范围

- **缺陷 A**：IdP 统一认证登录页缺「返回独立登录页」入口 → 方案对比 + 推荐 + 代码骨架 + 发版 + 验证 + 回滚。
- **缺陷 B**：`UserManagementPanel` 视觉改版 → 元素级问题清单 + 改版方案 + 改动清单 + 发版链路 + 回归清单。
- **不做**：不改任何代码/配置/线上数据；不改鉴权边界；不新增破坏性批量写能力（见 §5 Q5）。

---

## 2. 缺陷 A：IdP 登录页没有「返回独立登录页」入口

### 2.1 现象与根因

**现象**：应用登录页点「统一认证登录（SSO）」→ 302 到 `https://auth.marschat.online/login.html` → 页面上只有「忘记密码？」一个链接，**没有任何回到原应用登录页的入口**。CDP 实测该页链接全集：

```
A: 页面链接清单 = ["忘记密码？ -> /forgot-password.html"]
```

**根因（两层）**：

1. **信息不在地址栏**：`/login.html` 的 URL 不含 `client_id` / `redirect_uri` / `state`。它们被 Spring Security 的 `ExceptionTranslationFilter` 存进了 session 的 `SPRING_SECURITY_SAVED_REQUEST`（F3 实证）。
2. **静态页拿不到服务端会话**：`login.html` 是 classpath 静态资源，没有服务端渲染环节，纯前端无法读取 SavedRequest。

### 2.2 候选方案对比

> 评价维度按主理人要求逐项对齐；「精度」= 能否定位到**返回哪个应用的登录页**。

| 方案 | 拿到什么信息 | 精度 | 失效场景 | 改 6 应用？ | 组件发版？ | 对 auth-center 枢纽的爆炸半径 | 回滚路径 |
|---|---|---|---|---|---|---|---|
| **(a) 纯前端 `document.referrer`** | 来源页 origin（**仅 origin**，F1 实证） | ❌ **origin 级，且 kb-web/kb-ops 不可区分（F2）** | 直连/书签→空（可接受）；**kb 双应用必然取错**；跨站来源→空 | 否 | 否 | **零**（只改静态页） | 改回 login.html 即可 |
| **(b) 应用侧回写 `Domain=.marschat.online` Cookie** | 应用登录页**完整 URL（含 contextPath）** | ✅ 精确 | Cookie 过期窗内直连 IdP 会显示**上次那个应用**（Max-Age 短可缓解）；多标签最后一次写入覆盖 | **是**（5 SPA + UMD 同步 → 实际 6 处） | **是**（`sso.ts` → 发 Nexus → 5 应用升级 + UMD 重同步给 activecode） | **零**（不动 auth-center） | 组件回退旧版 + 应用回滚构建 |
| **(c) 后端接管 `GET /login.html` 动态渲染** | SavedRequest → client_id + redirect_uri | ✅ 精确（含环境：内网/LAN/localhost） | 无 SavedRequest（直连/书签）→ 无入口；多标签覆盖 | 否 | 否 | **中高**：把静态资源改为 MVC 端点，需处理 content-type/缓存/`loginPage` 语义；一旦回归会**打断 12 应用 SSO 主链路** | revert 提交（重建+部署 3~5 min） |
| **(c2) 后端新增 `GET /login-context` JSON**（推荐） | 同上 | ✅ 精确（同上） | 同上 | 否 | 否 | **低**：新增 1 个只读端点 + 链2 matcher 加 1 个路径；**不改任何既有方法**，静态页保持静态；前端失败静默降级 | revert 提交；**最快缓解 = 只回滚 `login.html` 一个文件**（Java 端点留着无害） |
| **(c1) 扩展既有 `GET /auth/session`** | 同上（复用 F4 结论） | ✅ 精确 | 同上 | 否 | 否 | **低-中**：零文件新增、零 SecurityConfig 改动，但**污染一条被 6 应用会话监视器 + QA 回归断言依赖的热契约** | revert |
| **(d) 自定义 `AuthenticationEntryPoint` 带参重定向** | entry point 里读 SavedRequest，302 到 `/login.html?return_to=…` | ✅ 精确 | 失败登录后 `formLogin` 会跳到 `/login.html?error`，**参数丢失**（需 sessionStorage 兜底） | 否 | 否 | **高**：改的是**链1（OIDC 端点链）**的 entry point，写错即 12 应用全域 SSO 挂掉 | revert |

**补充说明（排除项）**

- **(e) `history.back()`**：从应用登录页同标签跳转时确实能回退（302 不产生历史条目），但新标签/书签场景会**退出站点或落到任意外站**——比没有按钮更糟，故仅作「无可推导上下文时」的**不采用**项。
- **(f) 只看 `redirect_uri` 的 origin**：等价于 (a) 的精度上限，被 F2 否决。

### 2.3 推荐方案与理由

> **推荐 (c2)：新增只读端点 `GET /login-context`，静态页异步取用后渲染返回入口。**

**理由（按权重排序）**

1. **唯一能在 kb 双应用场景下给出正确结果的低成本方案**。F2 证明 referrer 路线在 `kb.marschat.online` 上必然错一半，这是**用户可感知的硬缺陷**，不能用。
2. **爆炸半径可控且符合"枢纽"纪律**。与 (c) 相比，(c2) **不把静态资源改成动态端点**——这是 (c) 最大的隐性风险（content-type / 缓存头 / `loginPage("/login.html")` 语义 / `x-frame-options` 等一整套都要重新验证）。我们只**新增**一个出参为 JSON 的只读端点，且**不改动 `AuthController` 里任何既有方法**（含被 `/auth/slo` 依赖的 `isAllowedRedirect` 私有实现——宁可复制也不重构枢纽关键路径）。
3. **失败即降级，不污染登录主链路**。前端 `fetch` 失败 / 返回空 → 不渲染按钮，登录流程与今天**逐字节一致**。这意味着**上线风险 ≈ 零**。
4. **不做组件发版**。相比 (b)，避免「Nexus 发版 + 6 处升级 + 各应用流水线」的线性协调成本，也不会因某个应用漏升级造成行为分裂（平台最忌讳）。
5. **F4 已实证技术前提成立**：SavedRequest 在登录页停留期间不会被中间请求消耗。**上线前需按 §2.6 V-A1~V-A8 复验该前提。**
6. **F5 已实证公网可达无需改 nginx**（`/login` 前缀匹配）。这消除了本方案唯一的部署耦合。

**已否决的方案及一句话理由**

- (a)：kb 双应用不可区分（F2），精度不足。
- (b)：精度够，但要付 6 处升级 + 发版的代价，且**收益只与 (c2) 持平**——同样的多标签失效、同样的直连失效，却多了发版链路风险。
- (c)：功能等价但把静态页变动态，**在 12 应用依赖的枢纽上把"低风险增量"变成"高风险改造"**。
- (c1)：会把「应用上下文」泄露给 6 个应用的会话监视器调用方，并让 QA 既有断言面变复杂；**收益（少一个文件）远小于代价（热契约变脏）**。列为备选（见 §5 Q1）。
- (d)：动链1 entry point，风险与收益严重不匹配。

### 2.4 具体改法（可直接照做）

#### A-1 新增 `auth-center/src/main/java/com/marschat/authcenter/controller/LoginContextController.java`

> 约定：**类级无 `@RequestMapping`**，方法映射为 `@GetMapping("/login-context")`（**必须**落在 `/login` 前缀下，见 F5）。

```java
package com.marschat.authcenter.controller;

import com.marschat.authcenter.util.RedirectAllowList;
import com.marschat.common.result.Result;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.web.savedrequest.HttpSessionRequestCache;
import org.springframework.security.web.savedrequest.SavedRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * IdP 登录页上下文（缺陷 A）——让**静态** login.html 能渲染「返回 &lt;应用&gt; 登录页」入口。
 *
 * <p>背景：应用跳 SSO → 302 /login.html，地址栏**不含** client_id/redirect_uri；
 * 原始 authorize 参数只存在于 session 的 SavedRequest 里（静态页读不到）。
 * 本端点把它解析为「该应用的独立登录页 URL」并返回。
 *
 * <p>契约（**只读、无副作用**）：成功 → {@code {code:200,data:{clientId,appName,returnTo}}}；
 * 任何解析不出/不在白名单/异常 → {@code {code:200,data:null}}（前端隐藏入口）。
 * **绝不抛错**：本端点异常不得影响登录流程。
 *
 * <p>安全：returnTo 出处是 **服务端 SavedRequest + 已注册客户端白名单**，
 * 且再经 {@link RedirectAllowList} 校验，不存在开放重定向。
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class LoginContextController {

    /**
     * HttpSessionRequestCache 的会话属性名。Spring Security 6.x 起该常量不再 public，
     * 故用字面量（属性名本身自 3.x 未变）作为兜底读取路径。
     */
    private static final String SAVED_REQUEST_ATTR = "SPRING_SECURITY_SAVED_REQUEST";
    /** 只有 OIDC 授权入口才需要"返回应用登录页"，其它 SavedRequest 一律忽略 */
    private static final String AUTHORIZE_SUFFIX = "/oauth2/authorize";
    /** SAS 回调路径后缀（用于反推应用部署前缀） */
    private static final String[] CALLBACK_SUFFIXES = {"/sso-callback.html", "/sso-callback", "/auth/callback"};

    private final RegisteredClientRepository registeredClientRepository;

    @GetMapping("/login-context")
    public Result<Map<String, Object>> loginContext(HttpServletRequest request, HttpServletResponse response) {
        try {
            SavedRequest saved = readSavedRequest(request, response);
            if (saved == null) {
                return Result.ok(null);
            }
            String redirectUrl = saved.getRedirectUrl();
            if (redirectUrl == null || !redirectUrl.contains(AUTHORIZE_SUFFIX)) {
                return Result.ok(null);
            }
            String clientId = param(saved, "client_id");
            if (clientId == null || clientId.isBlank()) {
                return Result.ok(null);
            }
            RegisteredClient client = registeredClientRepository.findByClientId(clientId);
            if (client == null) {
                return Result.ok(null);
            }
            String returnTo = resolveReturnTo(client, param(saved, "redirect_uri"));
            if (returnTo == null || !RedirectAllowList.isAllowed(returnTo)) {
                return Result.ok(null);
            }
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("clientId", client.getClientId());
            data.put("appName", client.getClientName());
            data.put("returnTo", returnTo);
            return Result.ok(data);
        } catch (Exception e) {
            // 降级：不显示返回入口；登录流程完全不受影响
            log.warn("登录页上下文解析失败（降级为不显示返回入口）: {}", e.getMessage());
            return Result.ok(null);
        }
    }

    /** 优先走 HttpSessionRequestCache（类型安全）；失败/为空再直读会话属性兜底。 */
    private static SavedRequest readSavedRequest(HttpServletRequest req, HttpServletResponse res) {
        try {
            SavedRequest sr = new HttpSessionRequestCache().getRequest(req, res);
            if (sr != null) {
                return sr;
            }
        } catch (Exception ignore) {
            // 落到下面的字面量读取
        }
        HttpSession session = req.getSession(false);
        Object attr = session == null ? null : session.getAttribute(SAVED_REQUEST_ATTR);
        return attr instanceof SavedRequest sr ? sr : null;
    }

    /** 取 SavedRequest 参数：优先 parameterMap，兜底解析 redirectUrl 的 query。 */
    private static String param(SavedRequest sr, String name) {
        try {
            Map<String, String[]> pm = sr.getParameterMap();
            if (pm != null) {
                String[] v = pm.get(name);
                if (v != null && v.length > 0 && v[0] != null && !v[0].isBlank()) {
                    return v[0];
                }
            }
        } catch (Exception ignore) {
            // 落兜底
        }
        return queryParam(sr.getRedirectUrl(), name);
    }

    /**
     * 由 SavedRequest 推导「应用独立登录页」：
     * ① redirect_uri 反推该应用部署前缀（/ops/sso-callback → /ops）；
     * ② 优先取该客户端 post-logout 白名单里「同 origin 且 path 以该前缀开头」的那条
     *    —— 按平台约定它就是应用登录页（portal→/portal/login、kbweb→/kb/login、
     *    kbops→/ops/login、inframon→/infra/login、activecode→/activecode/login.html）；
     * ③ 否则回落 `origin + 前缀 + /login`（仅当前缀至多一段，防 tokenhub 这类深路径误推）。
     */
    private static String resolveReturnTo(RegisteredClient client, String rawRedirectUri) {
        URI ru = parse(rawRedirectUri);
        if (ru == null || ru.getHost() == null) {
            return null;
        }
        String origin = originOf(ru);
        String prefix = stripCallbackSuffix(ru.getPath());
        if (prefix == null) {
            return null;
        }
        // ① 注册表优先（能拿到 activecode 的 .html 后缀等特例）
        for (URI cand : client.getPostLogoutRedirectUris()) {
            if (origin.equals(originOf(cand))
                    && cand.getPath() != null
                    && cand.getPath().startsWith(prefix)) {
                return cand.toString();
            }
        }
        // ② 约定兜底：一次部署前缀（/kb、/ops、/infra、/portal…）或空前缀（cosmic）
        if (prefix.isEmpty() || prefix.indexOf('/', 1) < 0) {
            return origin + prefix + "/login";
        }
        return null;
    }

    private static String originOf(URI u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        String authority = u.getAuthority() == null ? "" : u.getAuthority().toLowerCase();
        return scheme + "://" + authority;
    }

    /** '/ops/sso-callback' → '/ops'；'/portal/auth/callback' → '/portal'；'/sso-callback' → ''；识别不出 → null */
    private static String stripCallbackSuffix(String path) {
        if (path == null) {
            return null;
        }
        for (String suffix : CALLBACK_SUFFIXES) {
            if (path.endsWith(suffix)) {
                return path.substring(0, path.length() - suffix.length());
            }
        }
        return null;
    }

    private static URI parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return URI.create(raw.trim());
        } catch (Exception e) {
            return null;
        }
    }

    private static String queryParam(String url, String name) {
        if (url == null) {
            return null;
        }
        int q = url.indexOf('?');
        if (q < 0) {
            return null;
        }
        for (String kv : url.substring(q + 1).split("&")) {
            int eq = kv.indexOf('=');
            if (eq > 0 && kv.substring(0, eq).equals(name)) {
                return URLDecoder.decode(kv.substring(eq + 1), StandardCharsets.UTF_8);
            }
        }
        return null;
    }
}
```

#### A-2 新增 `auth-center/src/main/java/com/marschat/authcenter/util/RedirectAllowList.java`

把 `AuthController#isAllowedRedirect` 的**判据原样抽出**为公共工具，供新端点复用。

> ⚠️ **刻意不改 `AuthController`**：它同样被 `/auth/slo`（12 应用登出主链路）使用，为一个装饰性功能去重构枢纽关键路径不划算。两个实现短期共存，`AuthController` 侧加一行 `// TODO` 注明收敛点即可（属可选清理，**不属本方案**）。

```java
package com.marschat.authcenter.util;

/**
 * 回跳地址白名单：本平台域名（*.marschat.online）+ 本机/内网开发地址。
 * 判据与 AuthController#isAllowedRedirect 保持一致（见该类注释）。
 */
public final class RedirectAllowList {

    private RedirectAllowList() {
    }

    public static boolean isAllowed(String uri) {
        // ⚠️ 实现原样照抄 AuthController#isAllowedRedirect（第 263~299 行）：
        //   scheme ∈ {http,https}；host 非空；
        //   host == marschat.online 或 endswith(".marschat.online") → true；
        //   host ∈ {localhost,127.0.0.1,::1,[::1]} → true；
        //   RFC1918（10/8、192.168/16、172.16/12）→ true；
        //   其余 false；解析异常 false。
        // 照抄后补一条单测：RedirectAllowListTest（复用 AuthController 现有用例口径）。
        throw new UnsupportedOperationException("照抄 AuthController#isAllowedRedirect 实现");
    }
}
```

#### A-3 修改 `auth-center/src/main/java/com/marschat/authcenter/config/SecurityConfig.java`（**唯一一行**）

链2 `loginPageSecurityFilterChain` 的 `securityMatcher` 加一个路径（`authorizeHttpRequests` 已是 `anyRequest().permitAll()`，无需再动）：

```java
// 第 114 行
.securityMatcher("/login", "/login.html", "/forgot-password.html", "/error",
        "/auth/session", "/auth/slo",
        "/login-context")   // ← 新增（缺陷 A）：IdP 登录页上下文，须挂有会话的链上
```

> **为什么必须加**：不加则落链3（`anyRequest().authenticated()`）→ 403，前端拿不到数据（实测 `GET /login-context` = 403）。
> **为什么安全**：只是把**一个新路径**纳入链2；链2 对 `anyRequest()` 本就 `permitAll()`，不改变任何既有路径的归属与鉴权。

#### A-4 修改 `auth-center/src/main/resources/static/login.html`

**① `<body>` 内 `.card` 顶部加返回位**（放在 `.brand` 之前）：

```html
  <div class="card">
    <!-- 缺陷 A：仅当本次授权来自某应用时显示（由 /login-context 判定） -->
    <a id="backLink" class="back-link" rel="nofollow" hidden>← 返回登录页</a>

    <div class="brand">
```

**② `<style>` 追加**（注意必须有 `[hidden]` 覆盖，否则 `display:inline-flex` 会压掉 `hidden`）：

```css
    .back-link { display: inline-flex; align-items: center; gap: 4px; font-size: 13px;
                 color: var(--brand); text-decoration: none; margin-bottom: 18px; }
    .back-link:hover { text-decoration: underline; }
    .back-link[hidden] { display: none; }
```

**③ `<script>` 追加**（放在既有 `?error`/`?logout` 逻辑之后）：

```js
    // ===== 缺陷 A：向 IdP 询问「本次授权来自哪个应用」，据此渲染「返回 <应用> 登录页」 =====
    (function () {
      var KEY = 'marschat_login_ctx';
      function render(d) {
        var a = document.getElementById('backLink');
        if (!a) return;
        if (!d || !d.returnTo) { a.hidden = true; return; }
        a.href = d.returnTo;
        a.textContent = '← 返回「' + (d.appName || '应用') + '」登录页';
        a.hidden = false;
      }
      // 先渲染上次结果（登录失败会 302 回 /login.html?error，避免按钮闪一下再出现）
      try { render(JSON.parse(sessionStorage.getItem(KEY) || 'null')); } catch (e) { /* ignore */ }
      // 同一会话内客户端缓存：SavedRequest 在本次会话中不变
      fetch('/login-context', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (b) {
          var d = b && b.code === 200 ? b.data : null;
          try { sessionStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
          render(d);
        })
        .catch(function () { /* 静默降级：无返回入口，绝不影响登录 */ });
    })();
```

> ⚠️ 额外注意：`sessionStorage` 的值是**上一次**的结果，因此**必须**在 fetch 回来后覆盖渲染；不要用缓存短路 fetch。
> ⚠️ 不要把 `client_id` / `redirect_uri` 写进 URL —— 会破坏 `formLogin` 的 `?error` 约定，也让地址栏泄露应用信息。

#### A-5 各应用期望返回值（验收基准表，全部来自 `clients.yml` 实读）

| client_id | SavedRequest 里的 redirect_uri（公网） | **期望 returnTo** | 命中分支 |
|---|---|---|---|
| `marschat-portal` | `https://main.marschat.online/portal/auth/callback` | `https://main.marschat.online/portal/login` | ① 注册表（同 origin+`/portal`） |
| `marschat-kbweb` | `https://kb.marschat.online/kb/sso-callback` | `https://kb.marschat.online/kb/login` | ① |
| `marschat-kbops` | `https://kb.marschat.online/ops/sso-callback` | `https://kb.marschat.online/ops/login` | ①（**与 kbweb 同 origin，靠前缀区分**） |
| `marschat-inframon` | `https://monitor.marschat.online/infra/sso-callback` | `https://monitor.marschat.online/infra/login` | ① |
| `marschat-activecode` | `https://tools.marschat.online/activecode/sso-callback.html` | `https://tools.marschat.online/activecode/login.html` | ①（**保留 `.html`**） |
| `cosmic-studio` | `https://cosmic.marschat.online/sso-callback` | `https://cosmic.marschat.online/login` | ② 兜底（该 client 的 post-logout 白名单为空） |
| `marschat-portal`（本地） | `http://localhost:5173/auth/callback` | `http://localhost:5173/login` | ①（注册表里那条 `/login`） |
| `marschat-kbops`（内网） | `http://192.168.31.105/ops/sso-callback` | `http://192.168.31.105/ops/login` | ①（**环境保真**） |
| `marschat-tokenhub` | `…/api/admin/auth/oauth/callback` | `null`（不显示按钮） | 前缀 `/api/admin/auth/oauth` 深于一段 → 拒绝 |
| 直连/书签 `/login.html` | 无 SavedRequest | `null` | — |

> cosmic 那条走②兜底，若想「显式化」，可在 `apps-registry.yml` 给 `cosmic-studio` 补 `auth.post-logout-redirect-uris: [https://cosmic.marschat.online/login]` 并重跑 `gen-from-registry.py`（**数据改动，可选，非必需**）。

### 2.5 发版与部署路径

| 顺序 | 仓库 | 动作 | 门禁 |
|---|---|---|---|
| 1 | `auth-center`（main） | 新增 2 个 Java 文件 + 改 `SecurityConfig.java` 1 行 + 改 `static/login.html`；**先 `git pull --rebase` 再双推 Gitee + GitHub**（坑 #25：push 被拒必须查远端 tip，禁 force） | 本地 `mvn -DskipTests package` 通过 |
| 2 | Woodpecker repo_id=4 | push main 自动触发（`build` → `deploy`；含**流水线互斥锁**）→ 部署脚本自带 **8085 健康检查** | 只跑一条；**禁止手动 SSH 部署** |
| 3 | 线上核验 | ① jar 内 `BOOT-INF/classes/static/login.html` 含 `backLink`；② jar 内有 `LoginContextController.class`；③ `curl -s -o /dev/null -w '%{http_code}' https://auth.marschat.online/login-context` = **200** | 坑 #24：**不得只看流水线 SUCCESS** |
| 4 | （可选硬化）`config-as-code` | 在 `hosts/tencent-cloud-2/nginx/sites-available/auth.marschat.online` 增 `location = /login-context { proxy_pass http://100.93.36.113:8085; …与 /auth/session 同样的 5 行 proxy_set_header… }`，然后 `sync/push-to-host.sh tencent-cloud-2`（带 `nginx -t` 门禁 + 失败回滚） | 当前 `/login` 前缀已可直达（F5），此步只是**把隐式依赖变显式**，不做也不影响功能 |

**为什么改 Java 对 12 个下游是安全的**：本方案**不修改任何既有端点/契约/鉴权边界**，只新增 1 个 `permitAll` 只读端点 + 1 行 matcher。下游应用的运行时行为（SSO、401 续期、SLO、BFF）**不受任何影响**；唯一"契约面"是 `Result` 包裹的 JSON，仅被 login.html 消费。

### 2.6 验证方法（可执行）

| # | 用例 | 判据 |
|---|---|---|
| **V-A1** | 无 SavedRequest：`curl -s https://auth.marschat.online/login-context` | HTTP 200，body `{"code":200,...,"data":null}`（**不是 403/404**） |
| **V-A2** | 六应用逐个（CDP，每应用**独立 profile**）：构造 `https://auth.marschat.online/oauth2/authorize?client_id=<X>&redirect_uri=<公网回调>&response_type=code&scope=openid%20profile&state=v1` | 落 `/login.html`；`#backLink` 可见且 `href` **逐字等于** §2.4 A-5 期望表；`appName` 为该 client 的 `clientName` |
| **V-A3** | 在 V-A2 页面上 `Page.reload` | 链接仍在（F4 已证的 SavedRequest 存活） |
| **V-A4** | 输错口令提交 → 回 `/login.html?error` | ①「用户名或密码错误」可见；② **返回链接同时可见**（这是用户最需要它的时刻） |
| **V-A5** | 直连 `https://auth.marschat.online/login.html`（新 profile） | 无返回链接；console **无新增报错**（对齐坑 #37：必须抓 `Network.responseReceived` 的 URL 再定性） |
| **V-A6** | V-A2 后点「返回」 | 落到 `<app>/<ctx>/login`，**停在登录页**（有账密表单、`/login` 在 URL 里），**不被弹回 IdP**（`/auth/session` 此时 `authenticated:false`） |
| **V-A7** | **主链路回归**：V-A2 页面直接账密登录 | 仍自动续跑授权流，落 `…/sso-callback?code=…&state=v1`（`saved_request_survived` 必须为 true） |
| **V-A8** | 边界登记：同一浏览器两标签分别开 portal/kb-ops 的 SSO | 两标签都显示**后开那个**的应用名 —— **登记为已知限制**（见 §2.7 R3），**不作为失败** |
| **V-A9** | tokenhub（非 SPA）走 SSO | `/login.html` **不显示**返回链接；无报错 |

> 可复用本轮已落盘的脚本：`verify/design/shots/cdp-shot.mjs`、`referee-probe.mjs`、`savedreq-probe.mjs`（均在 mykng `/root/` 有一份）。
> 断言仍须遵守 README 的**四条铁律**：只精确匹配 `<button>` 全等文本 + 真实鼠标事件打在 bbox 中心；成功判据用「落点 URL + 接口状态码 + 无密码框」；每个应用断言前重置 console/网络缓冲；特征词从真实 `innerText` 抄。

### 2.7 风险与回滚

| # | 风险 | 等级 | 缓解 / 回滚 |
|---|---|---|---|
| R1 | 端点异常影响登录页 | 低 | 端点整体 try/catch → `data:null`；前端 `fetch().catch` 静默降级；**登录流程零依赖** |
| R2 | `SecurityConfig` matcher 误伤既有路径 | 极低 | 只增一个**新**路径；code review 盯这一行；回滚 = revert |
| R3 | **多标签覆盖**：SavedRequest 是 session 级单例，两标签开两个应用的 SSO 时返回链接只对后者正确 | 中（**已存在**的限制） | 属 Spring Security `HttpSessionRequestCache` 固有语义（当前"登录后落到哪个应用"也是同一限制）；**登记进 `docs/TROUBLESHOOTING.md` 的"已知边界"**，不隐藏 |
| R4 | F4 的"SavedRequest 不被消耗"是**未文档化依赖** | 中 | ①已实测；②上线前 V-A3/V-A7 **必须复验**；③若未来 Spring 升级改变行为 → 端点返回 `null`，**功能静默消失而非报错**（fail-soft） |
| R5 | 依赖边缘 nginx 的 `/login` **前缀**匹配（F5） | 低 | 已在方案里显式指出；§2.5 步骤 4 提供显式 location 硬化；建议在 nginx 站点注释里补一句"`/login` 前缀被 login.html / login-context 共用" |
| R6 | 应用登录页存在静默免登，点「返回」后被自动弹走 | 低-中 | 仅当**已有 IdP 会话**时才会（此时用户本来也不会停在 IdP 登录页）；V-A6 覆盖无会话场景。若用户仍觉得绕，见 §5 Q3 |
| **回滚** | — | — | **最快（< 1 min，零 Java）**：只 revert `login.html` → 前端不再请求，入口消失，Java 端点留着无害。<br>**完整**：`git revert` 整笔提交 → 走流水线 #4（≈3~5 min）。<br>**无数据变更需回滚**（全程只读）。 |

---

## 3. 缺陷 B：用户管理页视觉改版

### 3.1 取证与约束复核

**已实读产物**：`packages/auth-components/src/components/UserManagementPanel.vue`（993 行全文）。

**宿主实测（CDP，截图见 `shots/`）**

| 宿主 | 作用域 | 操作列渲染宽 | 操作列按钮 | 截图 |
|---|---|---|---|---|
| portal `/portal/admin` | platform | **360px** | 编辑 / 重置密码 / 应用角色 / 菜单权限 / 删除 | `B1-portal-admin-users.png` |
| kb-ops `/ops/users` | app | **280px** | 编辑 / 本系统角色 / 移出本系统 | `B2-kbops-users.png` |
| kb-web `/kb/users` | app | **280px** | 编辑 / 本系统角色 / 移出本系统（**金色品牌 `#c9a96e`**） | `C2-kbweb-users.png` |
| kb-ops 只读弹窗 | app | — | 标题「用户信息（只读）」/ **3 个置灰输入框** / footer 仅「取消」 | `C3-kbops-readonly-dialog.png` |

**列宽实测合计**：portal ≈ **1318px**、kb-ops ≈ **1330px** → 1366×768 笔记本（内容区 ≈1156px）**必然横向滚动**。

**共享/发版约束（不可违反）**

- 组件是 npm 包：**改一处 → 5 个 SPA 宿主生效**；发版 = 打 Nexus 新版本 + 各宿主升级 + 各自流水线（详细链路见 §3.4）。
- **不得破坏 props / 事件契约**：`cfg`（`UserManagementConfig`）、`scope`（platform/app）、`readonly`、`appRoles`、`allowResetPassword`、`allowEditRole`、`allowDelete`、`menuOverrides.clientId`、`currentUserId/currentUsername`、`pageSize`、`realmId`、`defaultRole`、`roles`；`emit('changed', action)` 的 5 个动作取值不变；`defineExpose({reload, reloadToFirstPage})` 不变。
- **不得改变行为语义**：app 作用域无「新建用户」「重置密码」；app 作用域「编辑」= 只读视图（无确定按钮）；「重置密码」仅 platform；用户级菜单权限**只减不加**。
- 已用 Element Plus，**不引入新 UI 框架**；本方案**不需要任何新依赖**（隐藏列用 `window.matchMedia`，操作收纳用已有的 `el-dropdown`）。
- 列表页铁律：**选择类操作与批量操作必须 UI 分区**，禁止二合一按钮；工具栏固定三区（筛选查询 → 选择 → 批量操作）。

### 3.2 视觉问题清单（元素级，指到行号）

| # | 位置 | 问题 | 证据 |
|---|---|---|---|
| **V1** | `:82-149` 操作列 | 平台作用域一行塞 **5 个** `el-button link size="small"`，**无分隔**；色值却各不相同（primary / warning / success / primary / danger）。「应用角色」用 `type="success"` 绿表达"成功"语义 **错误**（它只是打开弹窗）。 | B1 截图；实测按钮宽 30/54/54/54/30 |
| **V2** | `:388-393 opColumnWidth` | 列宽靠 JS 硬编码累加（`isAppScope?280:240` + `appRoles?+60` + `menuOverride?+60`）。app 作用域算 280，但按钮实测仅占 **~162px** → 右侧 **~118px 空白**；且不随字体缩放/列自适应。 | B2/C2 实测 `tdWidth=280` |
| **V3** | `:38` `prop="id" label="ID" width="70"` | 内部主键（477/302/1）占**第一列 70px** 常显，对使用者零信息量且抢占第一眼注意力。 | B1 截图 |
| **V4** | `:49-53` + `:558-562 roleTagType` | `superadmin/admin` 映射为 **`type="danger"`（红）**，与「删除」的红**同色** → 语义冲突（红色=危险动作 vs 红色=角色）。 | B1 截图「超级管理员」红 tag |
| **V5** | `:72-78` 状态列 | 「启用」`success+plain` 与「应用管理员」`success+light` 观感几乎一致；「禁用」也用 `danger` 红（禁用不是危险）。 | B1/B2 截图 |
| **V6** | `:91-98` 「编辑」按钮 | app 作用域点它打开的是**只读**弹窗（`:169` 标题「用户信息（只读）」），按钮却叫 **"编辑"**、还是 primary 蓝 → **文案与行为不符**。 | C3 截图 |
| **V7** | `:167-203` 只读弹窗 | 只读视图**复用编辑表单**把 `el-input` 置灰（C3 实测 3 个 `is-disabled`），且用户名仍带**必填红星 `*`**（`:174 prop="username"` + `:592-596 formRules`）→ "只读"却标"必填"，自相矛盾；footer 只有「取消」，**关闭语义错误**。 | C3 截图 |
| **V8** | `:170 / :206 / :222 / :264` | 弹窗宽度四处硬编码且不统一（460px / 420px / 460px / 760px），窄屏溢出；`label-width="80px"`（`:173`）比例失衡。 | 代码实读 |
| **V9** | `:3 el-card` + 宿主卡片 | portal 宿主 `AdminConsoleView.vue:4` 已有「统一认证中心」卡，组件内再套 `el-card` → **双层边框 + 三层标题**（页面标题 / 卡片标题 / 表头）。kb-ops `UsersView.vue` 同样。 | B1 截图 |
| **V10** | `:10-33` + `:910-935 .mgmt-header/.mgmt-toolbar` | 标题与工具栏同行 `space-between`，工具栏内**筛选与主操作混排在一起**，未分区；`flex-wrap` 后整块掉到下一行并左对齐错位。 | B1 截图 |
| **V11** | `:37 el-table stripe` | 表头与卡片同底色、无字重/字号区分；行高约 54px 但内容稀疏（kb-ops 只有 1 行时整张表显得很空）。 | B2/C2 截图 |
| **V12** | `:37` | 无 `<template #empty>`：app 作用域空表时只有 EP 默认「暂无数据」，缺「本系统还没有用户 → 添加已有用户」引导；`v-loading` **无 `element-loading-text`**，无骨架屏。 | 代码实读 |
| **V13** | `:152-163` | 分页 `layout="total, sizes, prev, pager, next, jumper"` 全堆右侧、与表格无分隔；`jumper` 文案随各应用 locale 变化（portal 截图显示 **`Go to`**，kb-ops 显示 **`前往`/`页`**）→ 同一组件跨应用文案不一致。 | B1 vs B2 截图 |
| **V14** | 全局配色 | 组件继承各宿主 `--el-color-primary`：kb-web **`#c9a96e`**（金棕）、kb-ops/infra `#409eff`；而 IdP 登录页写死 **`#2563eb`**。同时组件内又硬编码 `warning/success` 语义色 → 跨应用观感漂移；kb-web 金色背景下「移出本系统」的红**对比不足**。 | F8 grep + C2 截图 |
| **V15** | 深色/硬编码色 | **仅 kb-web 有 `html.dark`**（`kb-web/src/styles/dark.scss`）；组件自身用 `var(--el-*)` 尚可，但宿主 portal/kb-ops 有硬编码 `#606266`/`#909399`（`AdminConsoleView.vue:227,248`）**不随主题变**。 | grep 证据 |
| **V16** | 可点击性 | `el-button link size="small"` 行高 ≈24px < 44px 触控标准；「编辑」与「删除/移出本系统」**相邻无间距**（仅 EP 默认 12px）→ 误点风险（危险动作紧邻高频动作）。 | B1/C2 截图 |

### 3.3 改版方案

#### 3.3.1 设计令牌（**关键决策：不要硬编码 `#2563eb`**）

`#2563eb` 是 **auth-center 自有页面**（`login.html` / `forgot-password.html`）的品牌色。嵌入式面板必须**跟随宿主品牌**，否则会把 kb-web 的金色体系打烂（V14）。

在组件根节点定义一层可被宿主覆盖的令牌，全部回落 Element Plus 变量：

```css
.marschat-user-mgmt {
  --umg-accent: var(--el-color-primary);
  --umg-accent-soft: var(--el-color-primary-light-9);
  --umg-danger: var(--el-color-danger);
  --umg-radius: 8px;
  --umg-gap: 12px;
  --umg-font-title: 16px;
  --umg-font-base: 13px;
  --umg-font-sm: 12px;
  --umg-header-color: var(--el-text-color-primary);
}
```

> 若产品后来要求「六个应用后台统一平台蓝」，正确做法是**在宿主侧**把 `--el-color-primary` 统一为 `#2563eb`（或给面板传覆盖变量），而不是写进共享组件。

#### 3.3.2 操作列：行内主操作 + 「更多」下拉（解决 V1/V2/V6/V16）

| 作用域 | 行内（常显） | 「更多 ▾」内 |
|---|---|---|
| **platform** | `编辑`(link primary) | 重置密码 / 应用角色 / 菜单权限 / **删除**(danger, divided) |
| **app** | `查看`(link, 默认色) + `本系统角色`(link primary) | 菜单权限 / **移出本系统**(danger, divided) |

- 「编辑」在 app 作用域**改名「查看」**（与只读语义对齐，V6）。
- 固定 `width="160" fixed="right"`，**删除 `opColumnWidth` 计算**（V2）。
- 语义色只保留两类：**主操作=primary**、**破坏性=danger**；不再用 success/warning 表达"打开弹窗"（V1）。
- 下拉项与行内按钮**沿用原有可见性判据**（`!cfg.readonly && !isAppScope && cfg.allowResetPassword !== false`、`cfg.appRoles`、`showMenuOverride`、`isAppScope`、`cfg.allowDelete !== false`、`isSelf(row)` 禁用逻辑）→ **不改变任何权限语义**。
- ⚠️ 铁律遵守：**不新增**「全选并删除」这类二合一；本改版**不新增任何破坏性操作**。

#### 3.3.3 列策略（解决 V3/V11/V13 + 响应式）

| 列 | 改动 |
|---|---|
| `ID` | **删除**（内部主键；如需排障，改到「查看/编辑」弹窗里显示） |
| 用户名 | `min-width="160"`，本人「当前登录」tag 改 `type="primary" effect="plain"` + `margin-left:8px` |
| 昵称 | `min-width="120" show-overflow-tooltip`，**<992px 隐藏** |
| 邮箱 | `min-width="200" show-overflow-tooltip` |
| 角色（全局） | `width="104" align="center"`；tag 语义重定义见 3.3.4 |
| 本系统角色（app） | `min-width="160" align="center"`；**最多渲染 2 个 tag + `+N`**（`el-tooltip` 列其余），根治 V5 的列撑宽 |
| 状态 | `width="80" align="center"` |
| 创建时间 | `width="168" show-overflow-tooltip`，**1200~1439px 隐藏** |
| 操作 | `width="160" fixed="right" align="right"` |

断点用 `window.matchMedia`（**零新依赖**）+ `onUnmounted` 解绑：

```ts
const mqNarrow = window.matchMedia('(max-width: 1199px)')
const mqCompact = window.matchMedia('(max-width: 991px)')
const isNarrow = ref(mqNarrow.matches)
const isCompact = ref(mqCompact.matches)
const onMq = () => { isNarrow.value = mqNarrow.matches; isCompact.value = mqCompact.matches }
mqNarrow.addEventListener('change', onMq); mqCompact.addEventListener('change', onMq)
onUnmounted(() => { mqNarrow.removeEventListener('change', onMq); mqCompact.removeEventListener('change', onMq) })
```

#### 3.3.4 标签色彩语义（解决 V4/V5/V14）

用**「实心 / 描边 / 浅底」三级**表达角色权重，**与"危险红"彻底脱钩**：

```ts
function roleTagType(role?: string | null) {
  if (role === 'superadmin') return 'primary'   // effect="dark"：最高权重
  if (role === 'admin') return 'warning'        // effect="plain"
  if (role === 'editor') return 'info'
  return 'info'                                 // user：effect="light"
}
// 模板：<el-tag :type="roleTagType(row.role)" :effect="row.role==='superadmin' ? 'dark' : (row.role==='user' ? 'light' : 'plain')">
```

- **状态**：启用 = `success + plain`；**禁用 = `info + plain`**（不再是 danger）。
- **本系统角色** tag：`type="info" effect="light"`（中性），**不再用 success 绿**。
- **当前登录** tag：`type="primary" effect="plain"`。
- 破坏性动作（删除 / 移出本系统）是**唯一**的红色来源。

#### 3.3.5 工具栏三区（解决 V10 + 铁律）

```
┌ 筛选查询区 ────────────────┐ ┌ 选择区 ┐ ┌ 批量操作区 ┐ │ 主操作
│ 🔍 搜索用户名/邮箱/昵称  查询  重置 │ │（按需）│ │（按需）  │ │ 新建用户 / 添加已有用户
└────────────────────────────┘ └───────┘ └──────────┘
```

- 结构：`.umg-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap }`，`.umg-bulk { margin-left:auto; display:flex; align-items:center; gap:8px }`，主操作前用 `<el-divider direction="vertical" />` 与批量区硬分隔。
- **选择区 / 批量操作区本轮默认不渲染**（不新增破坏性批量写能力，见 §5 Q5）；但**结构与样式就位**，将来启用时天然满足"三区分离、禁止二合一"。
- 搜索框由固定 `width:240px` → `flex: 0 1 240px; min-width: 160px`；`isCompact` 时占满整行。
- 现有「添加已有用户」弹窗内的 `.add-toolbar`（`:270-284`）已符合「筛选区 + footer 操作」结构，**保持不动**。

#### 3.3.6 空状态 / 加载态（解决 V12）

```html
<el-table …>
  <template #empty>
    <div class="umg-empty">
      <el-icon class="umg-empty__icon"><Box /></el-icon>
      <p class="umg-empty__title">{{ isAppScope ? '本系统还没有用户' : '暂无用户' }}</p>
      <p class="umg-empty__hint">{{ isAppScope
        ? '可以从平台已有身份中添加，或先在门户「统一认证中心」创建统一身份。'
        : '点击右上角「新建用户」开始。' }}</p>
      <el-button v-if="!cfg.readonly && isAppScope" @click="openAddExisting">添加已有用户</el-button>
      <el-button v-else-if="!cfg.readonly" type="primary" @click="openCreate">新建用户</el-button>
    </div>
  </template>
</el-table>
```

- `v-loading` → `v-loading="loading" element-loading-text="加载中…"`。
- 首屏（`loading && !rows.length`）叠加 `el-skeleton :rows="3"`（`@element-plus/icons-vue` 已依赖，**无需新增包**）。

#### 3.3.7 弹窗（解决 V7/V8）

- **只读分支彻底换形态**：`editing && isAppScope` 时**不渲染 `el-form`**，改 `el-descriptions`：

```html
<div v-if="editing && isAppScope" class="umg-readonly">
  <el-descriptions :column="1" border size="small">
    <el-descriptions-item label="用户名">{{ form.username }}</el-descriptions-item>
    <el-descriptions-item label="昵称">{{ form.nickname || '—' }}</el-descriptions-item>
    <el-descriptions-item label="邮箱">{{ form.email || '—' }}</el-descriptions-item>
    <el-descriptions-item label="全局角色">{{ roleLabel(form.role) }}</el-descriptions-item>
    <el-descriptions-item label="状态">{{ form.status === 0 ? '禁用' : '启用' }}</el-descriptions-item>
    <el-descriptions-item label="本系统角色">
      <el-tag v-for="r in appRolesTarget?.appRoles || []" :key="r.id" type="info" size="small" class="app-role-tag">{{ r.name || r.code }}</el-tag>
      <span v-if="!(appRolesTarget?.appRoles || []).length" class="muted-text">未分配</span>
    </el-descriptions-item>
  </el-descriptions>
  <!-- 新增：把该用户切到「本系统角色」编辑也放在这里，避免用户先关弹窗再找 -->
  <el-button v-if="cfg.appRoles" link type="primary" @click="openAppRolesFromReadonly">调整本系统角色</el-button>
</div>
<el-form v-else …>
```

  只读态 footer：`<el-button @click="formVisible = false">关闭</el-button>`（**无"确定"**，与今日一致；把"取消"改"关闭"，语义修正）。
  → 一次性消灭 V7 的"只读却带必填红星 + 灰输入框"。
- 宽度统一：`const dialogWidth = computed(() => (isCompact.value ? '92%' : '480px'))`，三处弹窗都用它（只读态 520px）。
- 编辑/新建：`label-width="96px"`；密码框加 `autocomplete="new-password"`。

#### 3.3.8 间距 / 字号 / 圆角（可视规范）

| 令牌 | 值 |
|---|---|
| 卡片内边距 | 16px（`--el-card-padding`） |
| 纵向节奏 | 8 / 12 / 16 / 24 |
| 标题 | 16px / 600 / `--el-text-color-primary` |
| 副标题 | 12px / `--el-text-color-secondary` |
| 表头 | 13px / 600 / `--el-text-color-primary` |
| 单元格 | 13px；`.el-table .cell { line-height: 20px }` + `padding: 10px 0` → 行高 ≈48px |
| tag | 12px |
| 操作链接 | 保持 `size="small"` 但**加大命中区**：`.act-link { padding: 4px 6px; min-height: 28px }`；行内主操作之间 `margin-right: 12px`；破坏性动作与其它动作**至少 16px** 间距 |
| 圆角 | `--umg-radius: 8px`（与宿主卡片一致） |

#### 3.3.9 深色与响应式

- **深色**：组件内**只用 `var(--el-*)`**，不写死 hex；新增的 `--umg-*` 全部回落 EP 变量 → 在 kb-web 的 `html.dark` 下自动适配。**回归必须在 kb-web 切深色跑一遍**（唯一有深色的宿主）。
  - 宿主侧硬编码（`AdminConsoleView.vue:227,248` 的 `#606266`/`#909399`）→ 顺手改为 `var(--el-text-color-regular)`/`var(--el-text-color-secondary)`（属宿主小改，风险低）。
- **响应式**：`≥1440` 全列；`1200~1439` 隐藏「创建时间」；`992~1199` 再隐藏「昵称」；`<992` 工具条换行 + 表格横向滚动（此时固定操作列保证「更多」始终可达）。

### 3.4 改动清单

#### 3.4.1 组件包 `marschat-components`

**① `packages/auth-components/src/components/UserManagementPanel.vue`（主改）**

| 区块 | 行号（现状） | 改法 |
|---|---|---|
| 外壳 | `:2-3` | `<el-card shadow="never" class="mgmt-card">` → `<div class="mgmt-shell" :class="{ 'is-flat': cfg.flat }">`；`cfg.flat` 为 false 时内部仍渲染 `el-card`（**向后兼容**） |
| 工具条 | `:10-33` | 拆为 `.umg-filter` / `.umg-select`（本轮不渲染）/ `.umg-bulk`（本轮不渲染）/ `.umg-primary` 四段 + `el-divider` |
| 表格列 | `:37-81` | 按下表重设：删 `ID`；加 `show-overflow-tooltip`；`align` 调整；`isNarrow/isCompact` 条件列 |
| 操作列 | `:82-149` | 整块重写为「行内主操作 + `el-dropdown` 更多」；`width="160" fixed="right" align="right"` |
| `#empty` | `:150` 前 | 新增（见 3.3.6） |
| 分页 | `:152-163` | `layout="total, sizes, prev, pager, next"`（去掉 jumper，根治 V13 的 `Go to` 混排）；`justify-content: space-between` 并与表格间加 1px 分隔线 |
| 只读弹窗 | `:167-203` | 加 `v-if="editing && isAppScope"` 的 `el-descriptions` 分支；footer 文案「取消」→「关闭」 |
| 其它弹窗宽度 | `:206 / :222 / :264` | 统一用 `dialogWidth` 计算值 |
| 脚本 | `:388-393` | **删除** `opColumnWidth` |
| 脚本 | `:541-568` | `roleTagType` 重定义（3.3.4）；新增 `isNarrow/isCompact` + `mq` 清理；新增 `moreActions()`；新增 `appRolesTarget` 兼容只读态 |
| 样式 | `:903-992` | 新增 `--umg-*` 令牌、`.umg-toolbar` 三区、`.act-link`、`.umg-empty`、`@media` 断点；删 `.mgmt-search{width:240px}` 固定宽 |

**② `packages/auth-components/src/utils/userAdmin.ts`**

```ts
  /**
   * 是否以「扁平」形态渲染（不套组件内的 el-card）。
   * 宿主已有外层卡片时传 true，避免"框中框"（portal /portal/admin、kb-ops /ops/users 等）。
   * 缺省 false，保持既有视觉，向后兼容。
   */
  flat?: boolean
```

> 仅新增**可选**字段，不改任何既有字段；TypeScript 严格模式下旧宿主不受影响。

#### 3.4.2 宿主（升级组件版本时**顺带**改，增量成本≈0）

| 文件 | 改法 |
|---|---|
| `devtools/portal/src/views/AdminConsoleView.vue` | `userConfig` 加 `flat: true`；`.head-sub` 的 `#606266` → `var(--el-text-color-regular)` |
| `devtools/portal/src/views/UsersView.vue` | 若该路由仍在（`router/index.ts:47` 有映射）则同样加 `flat: true` |
| `devtools/kb-ops/kb-ops-web/src/views/users/UsersView.vue` | `config` 加 `flat: true` |
| `devtools/mykng/kb-web/src/views/settings/UsersView.vue` | `config` 加 `flat: true` |
| `devtools/infra-monitor/infra-monitor-web/src/views/users/UsersView.vue` | `config` 加 `flat: true` |
| `devtools/cosmic-studio/frontend/src/views/Admin.vue` | `config` 加 `flat: true` |

> **不在本方案内**：activecode（`activation-code-server/src/main/resources/static/activecode/*.html`）自绘用户页，**不使用该 Vue 组件**（F7）；仅在 §5 Q 相关选项下才需要动 UMD。

#### 3.4.3 发版链路（组件是 npm 包，这是重链路 —— 必须讲清）

```
① marschat-components 仓库：
   pnpm build                     # vue-tsc + vite（ES + UMD）+ vue-tsc -p tsconfig.build.json
   pnpm publish --filter @marschat/auth-components   # → Nexus npm-hosted
   ⚠️ 坑 #29：lang="scss" 时 sass 必须在 devDependencies（现已在，勿删）
   ⚠️ 坑 #33：核验产物**自报版本号**（dist 里的 version 常量），不能只看 package.json
② 5 个宿主各自升级（坑 #13 三对齐：package.json 约束 + lock + 线上版本戳）
   portal / kb-ops-web / kb-web / infra-monitor-web / cosmic-studio-frontend
③ 各仓库分别 push → 各自 Woodpecker 流水线（**同一时刻只跑一条**，逐个来）
④ 坑 #24：流水线 SUCCESS ≠ 产物已更新 → 必须核对线上 chunk 内容/hash
⑤ 坑 #25：push 后 git ls-remote 核对远端 tip
```

**UMD 影响面**：`UserManagementPanel` 是 Vue 组件，**UMD 产物不含它**（`umd.ts` 只导出逻辑层）→ **缺陷 B 不需要 UMD 重同步、不需要动 activecode**。
（若最终采用缺陷 A 的 (b) 方案才需要 UMD 同步；本方案 A 选 (c2)，故**也不需要**。）

### 3.5 回归验证清单

**功能不回归（硬门禁，逐条打勾）**

- [ ] platform 作用域（portal `/portal/admin`）：「新建用户」存在；「重置密码」存在；有「删除」；**无**「移出本系统」
- [ ] app 作用域（kb-ops `/ops/users`）：**无**「新建用户」；**无**「重置密码」；「编辑」打开的是**只读**、**无确定按钮**；有「移出本系统」
- [ ] app 作用域「本系统角色」绑定/解绑成功，文案含「最迟 60 秒生效」
- [ ] 「菜单权限」仅减不加；`menuOverrides.clientId` 生效
- [ ] `isSelf(row)` 保护仍在：删除/移出自己对**置灰**
- [ ] `emit('changed', …)` 5 个动作取值未变（宿主刷新逻辑不受影响）
- [ ] `defineExpose({ reload, reloadToFirstPage })` 仍可用
- [ ] `cfg.flat` 缺省 false 时**视觉与旧版一致**（老宿主不升级也不破相）

**视觉/交互（针对本方案）**

- [ ] 操作列宽度稳定 160px，5 个动作不再挤压、无换行
- [ ] 「更多」下拉可键盘 Tab 到、可 Esc 关闭；`el-dropdown` 默认 trigger=click（**注意坑 #38：EP 下拉未展开时不在 DOM**，自动化需先点触发器）
- [ ] 表头/单元格字号与字重符合 3.3.8；行高 ≈48px
- [ ] 空态、加载态（骨架 + `element-loading-text`）均可见
- [ ] 分页文案**不再出现 `Go to`**（去掉 jumper）
- [ ] 1440 / 1366 / 1200 / 1024 / 768 五档视口无错位；<992 表格横向滚动且操作列固定
- [ ] kb-web 深色模式（唯一有 `html.dark` 的宿主）下 tag / 表头 / 空态对比度正常
- [ ] 各宿主品牌色仍生效（kb-web 金色、kb-ops 蓝）——**验证没有硬编码 `#2563eb`**

**回归口径（沿用 README 四铁律 + 已知误判）**

- [ ] 用 **headless chromium + 全新 profile**（坑 #27），**不占用户本机桌面**
- [ ] 断言只精确匹配 `<button>` 全等文本 + 真实鼠标事件（坑 #16/#⑯）
- [ ] 成功判据 = 落点 URL + 接口状态码 + 身份，**不用「无 toast」**
- [ ] 每应用断言前**重置** console/网络缓冲（坑 #37）
- [ ] 跑既有套件：`wb_p10_r1_auth.py` / `verify/phase10/wb_runall.py` 的「用户管理」页巡检（6 应用并行点击巡检）

---

## 4. 影响面评估

### 4.1 缺陷 A（改 auth-center = 12 应用依赖的枢纽）

`python3 shared/app-map/appmap.py impact auth-center` 实测：

```
直接依赖 12: active-manager, auth-components, cosmic-studio, infra-monitor,
             infra-monitor-web, kb-gateway, kb-ops-web, kb-web, memory-panel,
             portal-server, portal-web, tokenhub
传递影响 12（同上集合）
```

| 维度 | 评估 |
|---|---|
| 改了什么 | **+2 个新文件**（`LoginContextController`、`RedirectAllowList`）、**1 行** `SecurityConfig` matcher、`login.html` 增量脚本与样式 |
| 有没有改既有 API / 契约 / 鉴权边界 | **没有**。无既有方法签名变更、无既有端点行为变更、无 matcher 移除 |
| 下游是否需要配合升级 | **不需要**。12 个下游运行时行为零变化 |
| 需要同步升级的下游应用 | **无** |
| 部署耦合 | Woodpecker repo_id=4（自动）；可选加 config-as-code（nginx） |
| 故障域边界 | 端点整体 try/catch + 前端静默降级 → **最坏结果是"没有返回按钮"，不会比今天更差** |
| 需登记的技术债 | ① `RedirectAllowList` 与 `AuthController#isAllowedRedirect` 短期重复（可后续收敛）；② SavedRequest 的「不被中间请求消耗」是未文档化依赖（F4），需写进 `TROUBLESHOOTING.md`；③ 多标签覆盖限制（R3） |

### 4.2 缺陷 B（改 npm 共享组件 = 5 个 SPA 宿主）

| 维度 | 评估 |
|---|---|
| 组件版本 | 0.8.8 → **0.8.9**（纯视觉/结构，无 props 破坏）；若要跟随语义化"视觉行为变更"，也可取 **0.9.0**（见 §5 Q8） |
| 需升级并重跑的宿主（**5**） | `portal`、`kb-ops/kb-ops-web`、`mykng/kb-web`、`infra-monitor/infra-monitor-web`、`cosmic-studio/frontend` |
| 不需要动 | `activecode`（自绘 HTML，不用该 Vue 组件）、`memory-panel`、`tokenhub`、`kb-gateway`、`portal-server`、`active-manager`（后端） |
| 流水线条数 | 1（组件发版）+ **5**（宿主）——**同一时刻一条**，含"发版→5 应用逐个升级→逐个部署→逐个核验"的线性链路 |
| 回滚 | 组件可 `unpublish`/发 0.8.10 修复；宿主可回退依赖版本重跑流水线。**`cfg.flat` 缺省 false 保证"不升级的宿主不受影响"** |

### 4.3 两缺陷的批次建议

**建议 A、B 分两批上线，先 A 后 B**：A 只碰 1 个后端仓（风险最低、收益立竿见影、可 5 分钟内回滚）；B 是组件 + 5 宿主的长链路，应与 A 解耦，避免"组件发版卡住导致 A 也不能上线"。

---

## 5. 待用户拍板的问题清单

| # | 问题 | 选项 | 我的推荐 |
|---|---|---|---|
| **Q1** | 缺陷 A 用哪个方案？ | (a) referrer / (b) 应用侧 Cookie / (c) 后端接管 GET /login | **(c2) 新增 `GET /login-context`**。理由见 §2.3。**明确否决 (a)**：`kb-web` 与 `kb-ops` 同 origin，referrer 只能给到 origin（实测），必然错一半。备选 (c1)「扩展 `/auth/session`」少一个文件，但会污染 6 应用共用的热契约，**不推荐**。 |
| **Q2** | 新端点依赖边缘 nginx 既有的 `location /login` **前缀**匹配（实测可达）；是否同批在 config-as-code 加显式 `location = /login-context`？ | ① 只靠前缀（0 额外部署）② 同批加显式 location（多 1 仓 + push-to-host） | **②，但不阻塞**：功能上①已够（F5 实测 403 而非 404=已到后端）；显式化只为防"后人把 `/login` 收紧成 `= /login.html` 时静默失效"。可排在主变更 **+1 天**。 |
| **Q3** | 「返回」入口的语义边界？ | ① 只跳回应用独立登录页 ② 额外提供「取消本次授权」（带 `error=access_denied` 回跳应用） | **①**。②要改 SAS 回调语义并让 6 应用处理 error 分支，收益不明；且 (R6) 已说明：无 IdP 会话时回登录页不会被弹走。 |
| **Q4** | 缺陷 B 是否接受"操作列收纳进「更多」下拉"？ | ① 接受（推荐）② 保持 5 个平铺、只调间距/配色 | **①**。这是把 360px 操作列从"5 个裸链接"救回来的唯一干净做法；且平台 doc 的列表页规范本就要求动作分层。**风险**：5 个宿主的管理员肌肉记忆变化 → 建议在「更多」上加 `el-tooltip` 说明。 |
| **Q5** | 是否本轮引入**批量操作**（本页全选 / 跨页全选 + 批量移出本系统 / 批量应用角色）？ | ① 不做，只把三区**结构**留好 ② 同时实现 | **①**。批量移出/批量角色是**新增破坏性写能力**，需先确认中心 `/admin/clients/{cid}/users/{uid}/roles` 的批量语义与审计口径（属平台事务），不应混在"视觉改版"里。结构已就位，后续单独立项即可。 |
| **Q6** | 嵌入式面板配色策略？ | ① **跟随宿主品牌**（现状：kb-web 金棕、kb-ops 蓝）② 强制统一为 `#2563eb` | **①**。`#2563eb` 属 auth-center 自有页面；强制统一会把 kb-web 的金色体系打烂（V14）。若要统一，应在**宿主侧**调 `--el-color-primary`，而非写进共享组件。 |
| **Q7** | 是否同批做 `cfg.flat`（去掉组件内层 `el-card`，解决"框中框"V9）？ | ① 同批（组件 + 5 宿主）② 只用 CSS 弱化内层卡边框 | **①**。`flat` 缺省 false 向后兼容，不升级的宿主不受影响；5 个宿主本来就要改依赖升级，增量成本≈0。 |
| **Q8** | 组件版本号？ | ① `0.8.9` ② `0.9.0` | **①`0.8.9`**：无 props/emits 破坏、无行为语义变更，仅视觉与 DOM 结构。若团队把"操作列结构变化"视为 breaking，则取 `0.9.0`。 |
| **Q9** | 上线批次？ | ① A、B 一起 ② 先 A 后 B | **②**。A 是 1 仓、可 5 分钟回滚、收益即时；B 是 1+5 仓长链路。解耦可避免 B 卡住 A。 |
| **Q10** | cosmic-studio 的返回地址走②兜底（`…/login`）是否需要显式化？ | ① 走兜底即可 ② 在 `apps-registry.yml` 给 `cosmic-studio` 补 `post-logout-redirect-uris` | **②可选**。补数据后走①注册表分支更稳（顺带把"cosmic 登出无回跳"这个既有缺口一起补上）；但需重跑 `gen-from-registry.py` + 重启 auth-center，**建议作为独立小项，不与 A 合并**。 |

---

## 附录

### 附录 1：本轮取证产物

| 文件 | 说明 |
|---|---|
| `shots/A1-idp-login-page.png` | IdP 登录页现状：**只有「忘记密码？」一个链接**（缺陷 A 直接证据） |
| `shots/B1-portal-admin-users.png` | portal `/portal/admin`（platform 作用域，5 个平铺操作链接） |
| `shots/B2-kbops-users.png` | kb-ops `/ops/users`（app 作用域，操作列 280px 有大量空白） |
| `shots/C2-kbweb-users.png` | kb-web `/kb/users`（**金色品牌 `#c9a96e`**，同一组件观感漂移 → V14） |
| `shots/C3-kbops-readonly-dialog.png` | app 作用域「编辑」= 只读弹窗：**必填红星 + 3 个置灰输入框 + 仅「取消」**（V6/V7） |
| `shots/cdp-shot.mjs` | 主取证脚本（CDP 驱动 headless chromium，只读） |
| `shots/cdp-shot2.mjs` | 补充取证（窄屏 / kb-web 品牌 / 只读弹窗） |
| `shots/referee-probe.mjs` | **F1/F2 证据**：referrer 仅 origin；kb-web 与 kb-ops 同为 `https://kb.marschat.online/` |
| `shots/savedreq-probe.mjs` | **F4 证据**：额外同源请求后 `saved_request_survived: true` |

### 附录 2：本轮新增的关键实测输出（原文）

```
# F1/F2 —— referrer 精度
"3_after_sso_url": "https://auth.marschat.online/login.html",
"3_referrer": "https://main.marschat.online/",          ← 只有 origin，无 /portal/login
"8_after_sso_kbops_referrer": "https://kb.marschat.online/",  ← 与 kb-web 无法区分
"5_direct_referrer": ""                                  ← 直连为空
# 响应头
referrer-policy: strict-origin-when-cross-origin

# F3 —— SavedRequest 确实在，且登录后续跑授权流
"after login url = https://main.marschat.online/portal/auth/callback?code=...&state=evidence1"

# F4 —— SavedRequest 不会被中间请求消耗
"extra_fetch_status": 200,        # GET /auth/session（链2）
"extra_probe_status": 403,        # GET /login-context（链3，修复前）
"final_url": ".../portal/auth/callback?code=...&state=SRTEST",
"saved_request_survived": true

# F5 —— 边缘 nginx：/login 是个前缀 location（登录页能通就是靠它）
GET /login-context   -> 403   ← 已到 auth-center（链3 拒），非 nginx 404
GET /zzz-probe       -> 404   ← nginx 末尾 location / { return 404; }
GET /auth/session    -> 200
GET /auth/me         -> 404   ← /auth/ 不是整段前缀，只有显式登记的路径可达

# 缺陷 B 实测
portal 操作列: tdWidth=360, btns=[编辑30, 重置密码54, 应用角色54, 菜单权限54, 删除30]
kb-ops 操作列: tdWidth=280, btns=[编辑30, 本系统角色66, 移出本系统66]
kb-web 操作列: tdWidth=280, btns=[编辑, 本系统角色, 移出本系统]；--el-color-primary = #c9a96e
kb-ops 只读弹窗: 标题「用户信息（只读）」, footer=["取消"], 置灰输入框数=3
```

---

*本方案仅为设计稿，未改动任何代码、配置或线上数据。经用户拍板后交工程师实施。*
