# ADR-SSO-001: SSO 跨系统 Cookie Domain 共享方案

**状态**: 已采纳
**日期**: 2026-01-09
**决策者**: DevTeam
**关联问题**: ISS-003

---

## 1. 背景与问题

### 1.1 当前架构

```
┌─────────────────┐     ┌─────────────────┐
│   Portal       │     │   kb-web      │
│  (已登录)      │     │  (未登录)    │
│                │     │                │
│  localStorage    │     │  localStorage │
│  portal_*      │     │  kb_*        │
└─────────────────┘     └─────────────────┘
```

### 1.2 问题现象

| 场景 | 预期行为 | 实际行为 |
|------|----------|----------|----------|
| Portal SSO 登录后 | 点击 kb-web "访问" → **直接进入 dashboard** | 跳转到 kb-web 登录页，**需重新登录** |
| Portal SSO 登录后 | 点击 infra-monitor "访问" → **直接进入 dashboard** | 跳转到 infra-monitor 登录页，**需重新登录** |
| 各系统独立登录 | 输入账密 → 登录成功 | ✅ 正常 |

### 1.3 根因分析

**当前 Token 存储机制**：
- 每个系统使用**不同的 localStorage key**
  - Portal: `auth_access_token`
  - kb-web: `kb_access_token`  
  - kb-ops: `kb_ops_access_token`
  - infra-monitor: `infra_access_token`

**跨域限制**：
- `localStorage` 遵循 **同源策略（Same-Origin Policy）**
- `portal.marschat.online` ≠ `kb.marschat.online` → 无法读取对方 localStorage
- 即使同域，不同 path 也无法共享

---

## 2. 决策：采用 Cookie Domain 共享方案 (方案 B)

### 2.1 方案描述

**核心思路**：将 SSO Token 存储在 **auth-center 的根域名 cookie** 上，各子域通过设置相同的 `domain` 属性实现共享。

### 2.2 架构图

```
                    ┌──────────────────────────────────────────────┐
                    │         auth-center (认证中心)                  │
                    │         :8085                             │
                    │         /oauth2/token                     │
                    │              ↓ POST {code, ...}            │
                    │              ↓ 返回 access_token + Set-Cookie  │
                    │              ↓ Set-Cookie:                   │
                    │              ↓ Domain=.marschat.online          │
                    │              ↓ Path=/                          │
                    │              ↓ HttpOnly=true               │
                    │              ↓ Secure=true                 │
                    └──────────────────────────────────────────────┘
                                    │
        ┌──────────────────────────────────────────────────────┐
        │                  Cookie: .marschat.online           │
        │                  Value: <access_token>             │
        │                  Domain: .marschat.online         │
        │                  Path: /                         │
        │                  HttpOnly: true                  │
        │                  Secure: true                  │
        └──────────────────────────────────────────────────────┘
        ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ 
        ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
        │Portal │  │kb-web │  │kb-ops  │  │infra-monitor│
        └────────┘  └────────┘  └─────────┘
         ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ ↕ 
        ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
        │activecode│  │cosmic-studio│  │tokenhub │  │nexus   │
        └────────┘  └────────┘  └─────────┘
```

### 2.3 Cookie 配置详情

```http
Set-Cookie: sso_access_token=<jwt_token_value>; 
             Domain=.marschat.online; 
             Path=/; 
             HttpOnly=true; 
             Secure=true; 
             SameSite=Lax; 
             Max-Age=7200; 
             SameSite=None
```

### 2.4 域名选择

| 选项 | 域名 | 覆盖范围 | 安全性 |
|------|------|------|----------|--------|
| `.marschat.online` | 所有子域 | 最广 | ⚠️ 中（可被非 HTTPS 窃窃取）|
| `auth.marschat.online` | 仅 auth 子域 | 更安全 | ✅ 推荐 |
| `.marschat.online; .kb.marschat.online` | 多个子域 | 灵活但复杂 | ⚠️ 维护成本高 |

**推荐**: 先用 `.marschat.online`，后续可收紧为 `auth.marschat.online`

---

## 3. 实施步骤

### Step 1: 修改 auth-center (SAS)

**文件**: `auth-center/src/main/resources/application.yml`

```yaml
server:
  servlet:
    session:
      cookie:
        name: JSESSIONID
        domain: .marschat.online
        http-only: true
        secure: true
        same-site: lax

# 新增：SSO Token Cookie 配置
sso:
  cookie:
    name: sso_access_token
    domain: .marschat.online
    path: /
    http-only: true
    secure: true
    same-site: lax
    max-age: 7200  # 2 小时 = 7200 秒
```

**修改点**：
1. 在 `/oauth2/token` 接口中，返回 token 时额外调用 `HttpServletResponse.addCookie()`
2. Cookie 设置为上述配置

### Step 2: 修改前端 Token 存储 (auth-components)

**文件**: `packages/auth-components/src/utils/token.ts`

```typescript
// 新增：Cookie 操作（优先使用 Cookie）
const COOKIE_NAME = 'sso_access_token'
const COOKIE_DOMAIN = '.marschat.online'

export function setToken(token: string): void {
  // 优先写入 Cookie（支持跨域共享）
  document.cookie = `${COOKIE_NAME}=${token}; ` +
    `Domain=${COOKIE_DOMAIN}; ` +
    `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=7200`
  
  // 同时保留 localStorage 作为降级方案
  localStorage.setItem(config.accessTokenKey, token)
}

export function getToken(): string | null {
  // 优先从 Cookie 读取（SSO 模式下 Cookie 应该有值）
  const match = document.cookie.match(/sso_access_token=([^;]+)/)
  if (match && match[1]) return match[1]
  // 降级到 localStorage
  return localStorage.getItem(config.accessTokenKey)
}
```

### Step 3: 修改请求拦截器 (frontend-common)

**文件**: `packages/frontend-common/src/interceptors/authInterceptor.ts`

```typescript
// 请求时自动携带 Cookie（而非 Authorization header）
instance.interceptors.request.use((config) => {
  // SSO 模式：使用 Cookie 传递 token
  if (isOidcToken()) {
    // 不再手动设置 Authorization header
    // Cookie 会自动携带
    return config
  }
  
  // Legacy 模式：继续使用 Authorization header
  const token = options.tokenStore?.getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})
```

### Step 4: 修改后端 Token 读取 (auth-core)

**文件**: `java/auth-core/src/main/java/com/marschat/auth/jwt/TokenProvider.java`

```java
// 新增：从 Cookie 读取 Token 的方法
public String getTokenFromCookie(HttpServletRequest request) {
    javax.servlet.http.Cookie[] cookies = request.getCookies();
    if (cookies != null) {
        for (javax.servlet.http.Cookie cookie : cookies) {
            if ("sso_access_token".equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
    }
    return null;
}
```

### Step 5: 修改 LoginUser 解析器 (auth-core)

**文件**: `java/auth-core/src/main/java/com/marschat/auth/web/MarsUserArgumentResolver.java`

```java
@Override
public Object resolveArgument(...) {
    // 1. 先尝试从 Cookie 读取（SSO 模式）
    String token = tokenProvider.getTokenFromCookie(request);
    
    // 2. Cookie 没有则降级到 Header 或 localStorage
    if (token == null || !validateToken(token)) {
        // 尝试 Authorization header
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            token = header.substring(7);
        } else {
            // 最后尝试 localStorage（兼容独立登录）
            token = tokenProvider.getToken();
        }
    }
    
    if (token == null || !validateToken(token)) {
        if (required) throw new NotLoginRuntimeException("missing token");
        return null;
    }
    
    return tokenProvider.parseUser(token);
}
```

---

## 4. 域名规划

| 系统 | URL | 子域 | 是否需要 SSO |
|------|-----|------|-------------|
| auth-center | `auth.marschat.online` | `auth.marschat.online` | 认证中心 |
| Portal | `main.marschat.online` | `main.marschat.online` | ✅ |
| kb-web | `kb.marschat.online/kb` | `kb.marschat.online` | ✅ |
| kb-ops | `ops.marschat.online` | `ops.marschat.online` | ✅ |
| infra-monitor | `monitor.marschat.online/infra` | `monitor.marschat.online` | ✅ |
| activecode | `tools.marschat.online` | `tools.marschat.online` | ❌ 工具页 |
| cosmic-studio | `192.168.31.105:8310` | 内网 IP | ❌ 内网无需 |

**Cookie Domain**: `.marschat.online` 覆盖所有公网子域

---

## 5. 兼容性处理

### 5.1 降级策略

```
读取顺序：
1. Cookie (.marschat.online)
2. Authorization Header (Bearer token)
3. localStorage (各系统独立 key)
```

### 5.2 双 Token 支持

| Token 类型 | 存储方式 | 跨域共享 |
|-----------|----------|----------|
| OIDC RS256 | Cookie (.marschat.online) | ✅ |
| Legacy HS256 | Cookie (.marschat.online) | ✅ |
| Refresh Token | Cookie (.marschat.online) | ✅ |

### 5.3 安全属性

| 属性 | 值 | 用途 |
|------|---|---|------|
| `HttpOnly` | true | 防 XSS 读取 |
| `Secure` | true | 仅 HTTPS 传输 |
| `SameSite` | Lax | 允许跨域 POST |
| `Max-Age` | 7200 | 2 小时过期 |
| `Path` | `/` | 全局有效 |

---

## 6. 测试验证清单

- [ ] Portal SSO 登录后，点击 kb-web"访问"→ 直接进入 dashboard
- [ ] Portal SSO 登录后，点击 infra-monitor"访问"→ 直接进入 dashboard
- [ ] kb-web 独立登录后，刷新页面仍保持登录
- [ ] infra-monitor 独立登录后，刷新页面仍保持登录
- [ ] activecode 页面正常加载
- [ ] cosmic-studio 独立登录正常
- [ ] 忘记密码链接可跳转（需先部署页面）

---

## 7. 风险评估

| 风险项 | 级别 | 缓解措施 |
|----------|------|------|----------|
| Cookie 被窃取 | 中 | HttpOnly + Secure + SameSite=Lax |
| CSRF 攻击 | 低 | SameSite=Lax + CsrfToken |
| Token 泄露 | 低 | HttpOnly + Secure |
| 跨站请求伪造 | 低 | Cookie 的 SameSite 属性 |

---

## 8. 回滚方案

如果 Cookie 方案出问题，可快速回滚：

```javascript
// 切换回 localStorage 模式
const USE_COOKIE = false  // 设为 false 则使用 localStorage
```

---

## 关联文档

- [忘记密码功能使用指南](./APP-UPGRADE-GUIDE.md)
- [SSO 实施总结](./SSO-IMPLEMENTATION-SUMMARY.md)
- [应用升级指南](./APP-UPGRADE-GUIDE.md)
