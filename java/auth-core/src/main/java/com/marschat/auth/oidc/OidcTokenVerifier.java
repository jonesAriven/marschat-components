package com.marschat.auth.oidc;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * OIDC RS256 验签器（双验签过渡期，auth-core 2.0.0 从 kb-gateway 移植）。
 * <p>
 * 设计要点：
 * <ul>
 *   <li>JWKS 从 auth-center 拉取（compose 内网直连 kb-auth，绕过公网回环），内存缓存 TTL 10 分钟；</li>
 *   <li>启动预热一次，失败不阻断启动（kb-auth 未就绪时首次请求再拉）；</li>
 *   <li>按 kid 匹配公钥，keyId 缺失时回退单 key 场景；</li>
 *   <li>验签同时校验 issuer 与过期；legacy HS256 token 由 {@code TokenProvider} 用本地密钥兜底。</li>
 * </ul>
 * <p>
 * 约定：本类由 {@code AuthJwtAutoConfig} 以 {@code @Bean} 形式注册（不挂 {@code @Component}，
 * 避免被下游组件扫描意外实例化导致 {@code @Value} 不生效）；{@code @Value}/{@code @PostConstruct}
 * 由 Spring 容器在创建该 bean 时统一注入与回调。
 */
@Slf4j
public class OidcTokenVerifier {

    private static final long JWKS_TTL_MS = Duration.ofMinutes(10).toMillis();

    @Value("${marschat.oidc.issuer:https://auth.marschat.online}")
    private String issuer;

    @Value("${marschat.oidc.jwks-uri:http://kb-auth:8085/oauth2/jwks}")
    private String jwksUri;

    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    private volatile Map<String, RSAPublicKey> keysByKid = Map.of();
    private volatile long fetchedAt = 0;

    @PostConstruct
    public void warmUp() {
        try {
            refreshJwks();
            log.info("OIDC JWKS 预热完成: issuer={}, keys={}", issuer, keysByKid.size());
        } catch (Exception e) {
            log.warn("OIDC JWKS 预热失败（将随首个 OIDC 请求重试）: {}", e.toString());
        }
    }

    /** RS256 验签；成功返回 claims，失败返回 null（由调用方决定 401 / 回退 HS256） */
    public Claims verify(String token) {
        try {
            String kid = extractKid(token);
            RSAPublicKey key = resolveKey(kid);
            if (key == null) {
                log.warn("OIDC RS256 无可用公钥: kid={}, cachedKeys={}", kid, keysByKid.keySet());
                return null;
            }
            return Jwts.parser()
                    .verifyWith(key)
                    .requireIssuer(issuer)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
        } catch (Exception e) {
            log.warn("OIDC RS256 验签异常（将回退 HS256）: {}", e.toString());
            return null;
        }
    }

    private String extractKid(String token) {
        // JWT header 是 JWT 的第一段 base64url，无需引入完整解析
        String[] parts = token.split("\\.");
        if (parts.length < 2) {
            return null;
        }
        byte[] header = Base64.getUrlDecoder().decode(parts[0]);
        String json = new String(header, java.nio.charset.StandardCharsets.UTF_8);
        // 轻量提取 kid（header 结构固定，由 auth-center 签发）
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("\"kid\"\\s*:\\s*\"([^\"]+)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    private RSAPublicKey resolveKey(String kid) throws Exception {
        Map<String, RSAPublicKey> keys = keysByKid;
        boolean expired = System.currentTimeMillis() - fetchedAt > JWKS_TTL_MS;
        if (keys.isEmpty() || expired) {
            lock.writeLock().lock();
            try {
                if (keysByKid.isEmpty() || System.currentTimeMillis() - fetchedAt > JWKS_TTL_MS) {
                    refreshJwks();
                }
                keys = keysByKid;
            } finally {
                lock.writeLock().unlock();
            }
        }
        if (kid != null && keys.containsKey(kid)) {
            return keys.get(kid);
        }
        // kid 缺失或不匹配时，若缓存里只有一把 key 则直接使用（auth-center 单 key 场景）
        return keys.size() == 1 ? keys.values().iterator().next() : null;
    }

    private synchronized void refreshJwks() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(jwksUri))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IllegalStateException("JWKS 拉取失败 HTTP " + response.statusCode());
        }
        JWKSet jwkSet = JWKSet.parse(response.body());
        List<com.nimbusds.jose.jwk.JWK> jwks = jwkSet.getKeys();
        if (jwks == null || jwks.isEmpty()) {
            throw new IllegalStateException("JWKS 为空");
        }
        Map<String, RSAPublicKey> map = new HashMap<>();
        for (com.nimbusds.jose.jwk.JWK jwk : jwks) {
            // auth-center（SAS）的 JWKS 未携带 alg 字段（实测仅有 kty/use/kid/n/e），按 kty=RSA 收取
            if (jwk instanceof RSAKey rsaKey) {
                map.put(rsaKey.getKeyID(), rsaKey.toRSAPublicKey());
            }
        }
        if (map.isEmpty()) {
            throw new IllegalStateException("JWKS 中无 RS256 key（keys=" + jwks.size() + "）");
        }
        this.keysByKid = Map.copyOf(map);
        this.fetchedAt = System.currentTimeMillis();
    }
}
