package com.marschat.auth.jwt;

import com.marschat.auth.AuthCoreProperties;
import com.marschat.auth.LoginUser;
import com.marschat.auth.oidc.OidcTokenVerifier;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

/**
 * JWT 统一签发/验签（jjwt HS256）。
 * <p>
 * 是 kb-auth {@code JwtTokenProvider}（签发方用法）与 kb-ops
 * {@code JwtTokenProvider}（验签方用法）的合并超集，claim 契约保持不变：
 * <pre>
 *   {sub: userId, username: xxx, type: access|refresh, iat, exp}
 * </pre>
 * 服务只需 {@code @Autowired TokenProvider} 即可，工具类不再各自复制。
 * <p>
 * 注意：infra-monitor 曾兼容「sub=username」的自签 token——那是历史遗留双格式，
 * 新代码统一走本契约；若必须兼容旧 token，请用 {@link #parseUsernameLoosely}。
 */
public class TokenProvider {

    private final SecretKey key;
    private final AuthCoreProperties properties;
    /**
     * OIDC RS256 验签器（双验签过渡期）。为 null 时退化为纯 HS256 模式（向后兼容旧服务）。
     * 由 {@code AuthJwtAutoConfig} 注入；无 nimbus-jose-jwt 或显式排除时为空。
     */
    private final OidcTokenVerifier oidcVerifier;

    public TokenProvider(AuthCoreProperties properties) {
        this(properties, null);
    }

    public TokenProvider(AuthCoreProperties properties, OidcTokenVerifier oidcVerifier) {
        if (properties.getSecret() == null || properties.getSecret().getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalArgumentException(
                    "marschat.auth.secret 未配置或长度不足 32 字节（HS256 要求），无法初始化 TokenProvider");
        }
        this.properties = properties;
        this.key = Keys.hmacShaKeyFor(properties.getSecret().getBytes(StandardCharsets.UTF_8));
        this.oidcVerifier = oidcVerifier;
    }

    // ---------- 签发（auth 服务 / 需要自签的服务用） ----------

    public String generateAccessToken(Long userId, String username) {
        Date now = new Date();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .claim("username", username)
                .claim("type", "access")
                .issuedAt(now)
                .expiration(new Date(now.getTime() + properties.getAccessTokenExpiration()))
                .signWith(key)
                .compact();
    }

    public String generateRefreshToken(Long userId) {
        Date now = new Date();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .claim("type", "refresh")
                .issuedAt(now)
                .expiration(new Date(now.getTime() + properties.getRefreshTokenExpiration()))
                .signWith(key)
                .compact();
    }

    // ---------- 验签（全部业务服务用） ----------

    /**
     * 纯 HS256 验签（legacy，kb-auth 自签 token）。双验签入口见 {@link #parseClaims}。
     */
    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    /**
     * 双验签核心：先 OIDC RS256（auth-center 签发），失败（含 JWKS 不可用）回退 HS256（legacy）。
     * 两种算法互不兼容——RS256 token 用 HS256 密钥验必失败、反之亦然，回退安全不会误判。
     */
    private Claims parseClaims(String token) {
        if (oidcVerifier != null) {
            Claims oidc = oidcVerifier.verify(token);
            if (oidc != null) {
                return oidc;
            }
        }
        return parseToken(token);
    }

    public boolean validateToken(String token) {
        try {
            parseClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }

    public boolean isTokenExpired(String token) {
        try {
            parseToken(token);
            return false;
        } catch (ExpiredJwtException e) {
            return true;
        } catch (JwtException e) {
            return false;
        }
    }

    public LoginUser parseUser(String token) {
        Claims claims = parseClaims(token);
        Long userId;
        try {
            userId = Long.parseLong(claims.getSubject());
        } catch (NumberFormatException e) {
            userId = null;
        }
        return new LoginUser(userId, claims.get("username", String.class), claims.get("type", String.class));
    }

    /**
     * 宽松解析用户名：优先取 claim "username"，缺失时回退 subject。
     * 仅用于兼容历史「sub=username」token（infra-monitor 自签格式）。
     */
    public String parseUsernameLoosely(String token) {
        Claims claims = parseClaims(token);
        String username = claims.get("username", String.class);
        return username != null ? username : claims.getSubject();
    }

    public Long getUserIdFromToken(String token) {
        return Long.parseLong(parseClaims(token).getSubject());
    }

    /**
     * 取用户标识（字符串，不强制数字）：优先 OIDC 的 {@code uid} claim，缺失时回退 {@code sub}。
     * 用于 OIDC RS256 token——其 uid 可能不是数字，故不做 {@code Long.parseLong}，
     * 下游需要 Long 时自行处理。legacy HS256 token 仍走 {@link #getUserIdFromToken}。
     */
    public String getUidFromToken(String token) {
        Claims claims = parseClaims(token);
        String uid = claims.get("uid", String.class);
        return uid != null ? uid : claims.getSubject();
    }

    public String getUsernameFromToken(String token) {
        return parseClaims(token).get("username", String.class);
    }

    public String getTokenType(String token) {
        return parseClaims(token).get("type", String.class);
    }

    public Date getExpirationFromToken(String token) {
        return parseClaims(token).getExpiration();
    }

    public long getAccessTokenExpiration() {
        return properties.getAccessTokenExpiration();
    }

    // ========== SSO Cookie 支持 ==========

    /** SSO Access Token Cookie 名称（与前端和 auth-center 配置一致） */
    private static final String SSO_ACCESS_TOKEN_COOKIE_NAME = "sso_access_token";

    /**
     * 从 HttpServletRequest 中解析 Token（多来源）
     * <p>
     * 优先级：
     * 1. Cookie（SSO 模式，由 auth-center 设置的跨域 Cookie）
     * 2. Authorization Header（Legacy 模式，Bearer token）
     *
     * @param request HTTP 请求
     * @return Token 字符串，未找到返回 null
     */
    public String resolveToken(HttpServletRequest request) {
        // 1. 先尝试从 Cookie 获取（SSO 模式）
        String tokenFromCookie = getTokenFromCookie(request);
        if (tokenFromCookie != null && !tokenFromCookie.isBlank()) {
            return tokenFromCookie;
        }

        // 2. 再尝试从 Header 获取（Legacy 模式）
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            return header.substring(7);
        }

        return null;
    }

    /**
     * 从 Cookie 中获取 SSO Access Token
     *
     * @param request HTTP 请求
     * @return Token 字符串，未找到返回 null
     */
    public String getTokenFromCookie(HttpServletRequest request) {
        if (request.getCookies() == null) {
            return null;
        }
        for (Cookie cookie : request.getCookies()) {
            if (SSO_ACCESS_TOKEN_COOKIE_NAME.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    /**
     * 从请求中解析并验证用户信息（便捷方法）
     * <p>
     * 自动从 Cookie 或 Header 获取 Token 并验证
     *
     * @param request HTTP 请求
     * @return LoginUser 对象，Token 无效时返回 null
     */
    public LoginUser resolveAndValidateUser(HttpServletRequest request) {
        String token = resolveToken(request);
        if (token == null || !validateToken(token)) {
            return null;
        }
        return parseUser(token);
    }
}
