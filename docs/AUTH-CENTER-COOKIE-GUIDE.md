# auth-center 后端 SSO Cookie 设置指南

## 概述

为了实现 SSO 跨系统免密访问，auth-center 需要在用户登录成功后，通过 `Set-Cookie` 响应头设置 **Domain 级别** 的 Cookie，使所有子域（`.marschat.online`）都能共享该 Token。

## 架构说明

```
┌─────────────────────────────────────────────────────────────┐
│                     登录流程                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 用户在 Portal (main.marschat.online) 点击 SSO 登录       │
│                    ↓                                        │
│  2. 跳转到 auth.marschat.online/oauth2/authorize             │
│                    ↓                                        │
│  3. 用户输入账密，认证通过                                     │
│                    ↓                                        │
│  4. 重定向回 Portal /login?code=xxx                          │
│                    ↓                                        │
│  5. Portal 用 code 换 token                                  │
│     POST auth.marschat.online/oauth2/token                  │
│                    ↓                                        │
│  6. auth-center 返回 token + Set-Cookie 响应头               │
│     Set-Cookie: sso_access_token=<jwt>;                     │
│                Domain=.marschat.online;                      │
│                Path=/; HttpOnly; Secure; SameSite=Lax        │
│                    ↓                                        │
│  7. 浏览器自动保存 Cookie（对所有 .marschat.online 子域有效）   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 实施步骤

### Step 1: 添加 Cookie 配置类

**文件**: `auth-center/src/main/java/com/marschat/auth/config/SsoCookieProperties.java`

```java
package com.marschat.auth.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * SSO Cookie 配置属性
 */
@Component
@ConfigurationProperties(prefix = "sso.cookie")
public class SsoCookieProperties {
    
    /** Access Token Cookie 名称 */
    private String accessTokenName = "sso_access_token";
    
    /** Refresh Token Cookie 名称 */
    private String refreshTokenName = "sso_refresh_token";
    
    /** Cookie 域名（覆盖所有子域） */
    private String domain = ".marschat.online";
    
    /** Cookie 路径 */
    private String path = "/";
    
    /** 是否仅 HTTPS */
    private boolean secure = true;
    
    /** SameSite 策略 */
    private String sameSite = "Lax";
    
    /** 过期时间（秒），默认 2 小时 */
    private int maxAge = 7200;
    
    // Getters and Setters
    public String getAccessTokenName() { return accessTokenName; }
    public void setAccessTokenName(String accessTokenName) { this.accessTokenName = accessTokenName; }
    
    public String getRefreshTokenName() { return refreshTokenName; }
    public void setRefreshTokenName(String refreshTokenName) { this.refreshTokenName = refreshTokenName; }
    
    public String getDomain() { return domain; }
    public void setDomain(String domain) { this.domain = domain; }
    
    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }
    
    public boolean isSecure() { return secure; }
    public void setSecure(boolean secure) { this.secure = secure; }
    
    public String getSameSite() { return sameSite; }
    public void setSameSite(String sameSite) { this.sameSite = sameSite; }
    
    public int getMaxAge() { return maxAge; }
    public void setMaxAge(int maxAge) { this.maxAge = maxAge; }
}
```

### Step 2: 创建 Cookie 工具类

**文件**: `auth-center/src/main/java/com/marschat/auth/util/SsoCookieUtil.java`

```java
package com.marschat.auth.util;

import com.marschat.auth.config.SsoCookieProperties;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;

/**
 * SSO Cookie 工具类
 * 用于设置和删除跨域 SSO Token Cookie
 */
@Component
public class SsoCookieUtil {
    
    private final SsoCookieProperties cookieProperties;
    
    public SsoCookieUtil(SsoCookieProperties cookieProperties) {
        this.cookieProperties = cookieProperties;
    }
    
    /**
     * 设置 SSO Access Token Cookie
     */
    public void setAccessTokenCookie(HttpServletResponse response, String token) {
        setCookie(
            response,
            cookieProperties.getAccessTokenName(),
            token,
            cookieProperties.getMaxAge()
        );
    }
    
    /**
     * 设置 SSO Refresh Token Cookie
     */
    public void setRefreshTokenCookie(HttpServletResponse response, String token) {
        // Refresh Token 可以设置更长的过期时间，如 7 天
        setCookie(
            response,
            cookieProperties.getRefreshTokenName(),
            token,
            604800 // 7 天
        );
    }
    
    /**
     * 清除所有 SSO Cookie
     */
    public void clearSsoCookies(HttpServletResponse response) {
        deleteCookie(response, cookieProperties.getAccessTokenName());
        deleteCookie(response, cookieProperties.getRefreshTokenName());
    }
    
    /**
     * 设置 Cookie
     */
    private void setCookie(HttpServletResponse response, String name, String value, int maxAge) {
        jakarta.servlet.http.Cookie cookie = new jakarta.servlet.http.Cookie(name, value);
        cookie.setDomain(cookieProperties.getDomain());
        cookie.setPath(cookieProperties.getPath());
        cookie.setHttpOnly(true);  // 防 XSS
        cookie.setSecure(cookieProperties.isSecure());  // 仅 HTTPS
        cookie.setAttribute("SameSite", cookieProperties.getSameSite());
        cookie.setMaxAge(maxAge);
        response.addCookie(cookie);
    }
    
    /**
     * 删除 Cookie（设置 maxAge=0）
     */
    private void deleteCookie(HttpServletResponse response, String name) {
        jakarta.servlet.http.Cookie cookie = new jakarta.servlet.http.Cookie(name, "");
        cookie.setDomain(cookieProperties.getDomain());
        cookie.setPath(cookieProperties.getPath());
        cookie.setMaxAge(0);
        response.addCookie(cookie);
    }
}
```

### Step 3: 修改 Token 端点

**文件**: `auth-center/src/main/java/com/marschat/auth/controller/Oauth2TokenController.java`

```java
package com.marschat.auth.controller;

import com.marschat.auth.util.SsoCookieUtil;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * OAuth2 Token 端点
 * 在返回 token 的同时，设置 SSO Cookie
 */
@RestController
@RequestMapping("/oauth2")
public class Oauth2TokenController {
    
    private final SsoCookieUtil ssoCookieUtil;
    
    public Oauth2TokenController(SsoCookieUtil ssoCookieUtil) {
        this.ssoCookieUtil = ssoCookieUtil;
    }
    
    @PostMapping("/token")
    public ResponseEntity<?> token(
            @RequestBody Map<String, String> params,
            HttpServletResponse response) {
        
        // ... 原有的 token 生成逻辑 ...
        String accessToken = generateAccessToken(params);
        String refreshToken = generateRefreshToken(params);
        
        // ★ 新增：设置 SSO Cookie
        ssoCookieUtil.setAccessTokenCookie(response, accessToken);
        ssoCookieUtil.setRefreshTokenCookie(response, refreshToken);
        
        // 返回 token（保持原有响应格式不变）
        Map<String, Object> result = Map.of(
            "access_token", accessToken,
            "refresh_token", refreshToken,
            "token_type", "Bearer",
            "expires_in", 7200
        );
        
        return ResponseEntity.ok(result);
    }
    
    // ... 其他方法 ...
}
```

### Step 4: 添加配置

**文件**: `auth-center/src/main/resources/application.yml`

```yaml
# SSO Cookie 配置
sso:
  cookie:
    # Access Token Cookie 名称（必须与前端一致）
    access-token-name: sso_access_token
    # Refresh Token Cookie 名称
    refresh-token-name: sso_refresh_token
    # Cookie 域名 - 覆盖所有子域
    domain: .marschat.online
    # Cookie 路径
    path: /
    # 是否仅 HTTPS（生产环境必须为 true）
    secure: true
    # SameSite 策略
    same-site: Lax
    # Access Token 过期时间（秒）
    max-age: 7200

# Server 配置（可选）
server:
  servlet:
    session:
      cookie:
        # Session Cookie 也设置为域级别（如果使用 Session）
        domain: .marschat.online
        http-only: true
        secure: true
        same-site: lax
```

### Step 5: 修改登出端点

**文件**: `auth-center/src/main/java/com/marschat/auth/controller/AuthController.java`

```java
@PostMapping("/logout")
public ResponseEntity<?> logout(HttpServletRequest request, HttpServletResponse response) {
    // 清除 SSO Cookie
    ssoCookieUtil.clearSsoCookies(response);
    
    // ... 其他的登出逻辑（清除 Redis 中的 token 等） ...
    
    return ResponseEntity.ok(Map.of("success", true, "message", "登出成功"));
}
```

### Step 6: 后端读取 Cookie Token

**文件**: `java/auth-core/src/main/java/com/marschat/auth/jwt/TokenProvider.java`（在 marschat-components 中）

```java
/**
 * 从 Cookie 中获取 SSO Token
 */
public String getTokenFromCookie(HttpServletRequest request) {
    if (request.getCookies() != null) {
        for (Cookie cookie : request.getCookies()) {
            if ("sso_access_token".equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
    }
    return null;
}

/**
 * 获取 Token（多来源）
 * 优先级：Cookie > Authorization Header
 */
public String resolveToken(HttpServletRequest request) {
    // 1. 先尝试从 Cookie 获取（SSO 模式）
    String token = getTokenFromCookie(request);
    if (token != null && !token.isEmpty()) {
        return token;
    }
    
    // 2. 再尝试从 Header 获取（Legacy 模式）
    String header = request.getHeader("Authorization");
    if (header != null && header.startsWith("Bearer ")) {
        return header.substring(7);
    }
    
    return null;
}
```

## Nginx 配置

确保各应用的 Nginx 配置允许跨域 Cookie 传递：

```nginx
# 各子域应用的 Nginx 配置
server {
    listen 443 ssl;
    server_name kb.marschat.online;
    
    location /api/ {
        proxy_pass http://backend:8080/;
        
        # 允许跨域 Cookie
        proxy_cookie_domain auth.marschat.online $host;
        
        # 重要：传递原始 Host 头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 安全注意事项

| 项目 | 要求 | 说明 |
|------|------|------|
| **HttpOnly** | 必须 | 防止 JavaScript 读取 Cookie，防止 XSS 攻击 |
| **Secure** | 生产环境必须 | 仅通过 HTTPS 传输，防中间人攻击 |
| **SameSite** | Lax 或 Strict | 防止 CSRF 攻击 |
| **Domain** | `.marschat.online` | 覆盖所有子域，实现 SSO |
| **Path** | `/` | 全路径有效 |

## 测试验证

### 1. 验证 Cookie 设置

```bash
# 使用 curl 测试
curl -v -X POST https://auth.marschat.online/oauth2/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"authorization_code","code":"xxx"}'

# 检查响应头中是否包含 Set-Cookie
# 应该看到：
# Set-Cookie: sso_access_token=<jwt>; Domain=.marschat.online; Path=/; HttpOnly; Secure; SameSite=Lax
```

### 2. 验证跨域共享

1. 在 Portal (main.marschat.online) 进行 SSO 登录
2. 打开浏览器开发者工具 → Application → Cookies
3. 确认可以看到 `sso_access_token` Cookie，Domain 为 `.marschat.online`
4. 新开标签页访问 kb.marschat.online
5. 检查请求是否自动携带了该 Cookie
6. 应该可以直接进入 dashboard，无需重新登录

### 3. 验证登出清除

1. 在任意已登录的子域调用登出接口
2. 检查 Cookie 是否被清除
3. 访问其他子域，应该需要重新登录

## 回滚方案

如果出现问题，可以通过以下方式快速回滚：

1. **前端回滚**：设置 `useSsoCookie: false`
2. **后端回滚**：注释掉设置 Cookie 的代码
3. **配置回滚**：将 `sso.cookie.domain` 设置为空字符串或当前子域

```yaml
# 回滚配置
sso:
  cookie:
    domain: ""  # 不设置域，Cookie 仅对当前子域有效
```

## 关联文档

- [ADR-SSO-001: SSO 跨系统 Cookie Domain 共享方案](./ADR-SSO-Cookie-Domain-Sharing.md)
- [忘记密码功能使用指南](../packages/auth-components/FORGOT-PASSWORD-USAGE.md)
