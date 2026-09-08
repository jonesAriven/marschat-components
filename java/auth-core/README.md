# auth-core

认证公共库（独立 git 仓库 / 独立版本线）—— `com.marschat:auth-core`

SSO Phase 1 落地件：统一 jjwt HS256 验签、`@MarsUser LoginUser` 参数解析、Feign token 透传。
前身是 kb-auth / kb-ops / infra-monitor 各自复制的 JwtTokenProvider / JwtUtil。

## 快速接入

```xml
<dependency>
    <groupId>com.marschat</groupId>
    <artifactId>auth-core</artifactId>
    <version>1.0.0</version>
</dependency>
```

```yaml
marschat:
  auth:
    secret: ${JWT_SECRET}              # >= 32 字节，全服务一致才能 token 互认
    access-token-expiration: 7200000   # 可选，默认 2h（毫秒）
    refresh-token-expiration: 604800000 # 可选，默认 7d（毫秒）
```

引入即自动装配 `TokenProvider`，Controller 直接用：

```java
@GetMapping("/me")
public Result<?> me(@MarsUser LoginUser user) { ... }
```

## Token 契约（与现网 kb-auth 签发格式完全一致）

```json
{ "sub": "1", "username": "admin", "type": "access", "iat": ..., "exp": ... }
```

## 能力矩阵

| Bean | 条件 | 用途 |
|---|---|---|
| `TokenProvider` | classpath 有 jjwt + 配了 secret | 签发/验签/身份解析（fail-fast） |
| `MarsUserArgumentResolver` | Servlet web 环境 | `@MarsUser LoginUser` 参数注入 |
| `AuthHeadersFeignInterceptor` | classpath 有 OpenFeign | 服务间调用透传 Authorization |

所有 Bean 均 `@ConditionalOnMissingBean`，服务可自行覆盖。

## 仓库

- Gitee: git@gitee.com:jonesAriven/auth-core.git
- Nexus: https://nexus.marschat.online/repository/maven-releases/
