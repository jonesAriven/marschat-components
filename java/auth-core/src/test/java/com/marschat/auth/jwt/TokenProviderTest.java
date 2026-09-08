package com.marschat.auth.jwt;

import com.marschat.auth.AuthCoreProperties;
import com.marschat.auth.LoginUser;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * TokenProvider 契约测试——与 kb-auth/kb-ops 现网 token 格式完全对齐。
 */
class TokenProviderTest {

    private static final String SECRET = "UnitTestSecretKey2026MustBe32Bytes!!";

    private TokenProvider provider;
    private AuthCoreProperties properties;

    @BeforeEach
    void setUp() {
        properties = new AuthCoreProperties();
        properties.setSecret(SECRET);
        properties.setAccessTokenExpiration(60_000L);
        properties.setRefreshTokenExpiration(600_000L);
        provider = new TokenProvider(properties);
    }

    @Test
    @DisplayName("access token 签发-验签-取身份 闭环，claim 契约与现网一致")
    void accessTokenRoundTrip() {
        String token = provider.generateAccessToken(1L, "admin");

        assertThat(provider.validateToken(token)).isTrue();
        assertThat(provider.getUserIdFromToken(token)).isEqualTo(1L);
        assertThat(provider.getUsernameFromToken(token)).isEqualTo("admin");
        assertThat(provider.getTokenType(token)).isEqualTo("access");
        assertThat(provider.getExpirationFromToken(token)).isNotNull();
    }

    @Test
    @DisplayName("refresh token：type=refresh 且无 username claim")
    void refreshTokenContract() {
        String token = provider.generateRefreshToken(42L);

        assertThat(provider.validateToken(token)).isTrue();
        assertThat(provider.getTokenType(token)).isEqualTo("refresh");
        assertThat(provider.getUserIdFromToken(token)).isEqualTo(42L);
        assertThat(provider.getUsernameFromToken(token)).isNull();

        LoginUser user = provider.parseUser(token);
        assertThat(user.userId()).isEqualTo(42L);
        assertThat(user.isRefreshToken()).isTrue();
    }

    @Test
    @DisplayName("parseUser 与 kb-auth 签发的 token 互认（同 secret 手工签发）")
    void interoperableWithKbAuthFormat() {
        // 用 kb-auth JwtTokenProvider 的原始签发逻辑独立复刻一份 token
        String token = Jwts.builder()
                .subject("1")
                .claim("username", "admin")
                .claim("type", "access")
                .issuedAt(new java.util.Date())
                .expiration(new java.util.Date(System.currentTimeMillis() + 60_000))
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .compact();

        LoginUser user = provider.parseUser(token);
        assertThat(user.userId()).isEqualTo(1L);
        assertThat(user.username()).isEqualTo("admin");
        assertThat(user.tokenType()).isEqualTo("access");
    }

    @Test
    @DisplayName("篡改/伪造 token 验签失败")
    void tamperedTokenRejected() {
        String token = provider.generateAccessToken(1L, "admin");
        String tampered = token.substring(0, token.length() - 4) + "AAAA";
        assertThat(provider.validateToken(tampered)).isFalse();
    }

    @Test
    @DisplayName("过期 token：validateToken=false 且 isTokenExpired=true")
    void expiredToken() {
        AuthCoreProperties expired = new AuthCoreProperties();
        expired.setSecret(SECRET);
        expired.setAccessTokenExpiration(-1_000L); // 已过期
        TokenProvider expiredProvider = new TokenProvider(expired);

        String token = expiredProvider.generateAccessToken(1L, "admin");
        assertThat(expiredProvider.validateToken(token)).isFalse();
        assertThat(expiredProvider.isTokenExpired(token)).isTrue();
    }

    @Test
    @DisplayName("宽松用户名解析：兼容历史 sub=username 格式（infra-monitor 自签）")
    void looseUsernameParsing() {
        String token = Jwts.builder()
                .subject("admin") // 历史 infra-monitor 格式：sub 即用户名
                .issuedAt(new java.util.Date())
                .expiration(new java.util.Date(System.currentTimeMillis() + 60_000))
                .signWith(Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8)))
                .compact();

        assertThat(provider.parseUsernameLoosely(token)).isEqualTo("admin");
    }

    @Test
    @DisplayName("密钥不足 32 字节直接抛错（防 HS256 WeakKeyException 拖到运行期）")
    void shortSecretRejected() {
        AuthCoreProperties bad = new AuthCoreProperties();
        bad.setSecret("too-short");
        assertThatThrownBy(() -> new TokenProvider(bad))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("32");
    }

    @Test
    @DisplayName("未配置 secret 直接抛错（fail-fast，不留 null key 隐患）")
    void nullSecretRejected() {
        AuthCoreProperties bad = new AuthCoreProperties();
        assertThatThrownBy(() -> new TokenProvider(bad))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
