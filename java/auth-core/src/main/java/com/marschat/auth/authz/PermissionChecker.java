package com.marschat.auth.authz;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * 权限点客户端（Phase 2 · auth-core）。
 *
 * <p>调 auth-center {@code GET /auth/permissions?client=<clientId>}（Bearer 当前请求 token），
 * 结果按 (token 的 userId + client) 缓存 TTL 默认 60s——权限变更最迟一个 TTL 生效，
 * 避免每个请求都打枢纽。
 *
 * <p>响应契约：{@code {"code":200,"data":{"client":"...","roles":[...],"permissions":[...],
 * "configured":true|false,"platformRoles":[...]}}}。
 * {@code configured=false} 表示该应用尚未配置任何权限点（R10：未配置=行为不变），
 * 调用方（拦截器）应直接放行。
 */
@Slf4j
public class PermissionChecker {

    private final String issuer;
    private final String clientId;
    private final long cacheTtlMs;
    private final boolean failOpen;
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).build();

    private volatile CacheEntry cache;

    public PermissionChecker(String issuer, String clientId, long cacheTtlMs, boolean failOpen) {
        this.issuer = issuer == null ? "" : issuer.replaceAll("/+$", "");
        this.clientId = clientId;
        this.cacheTtlMs = cacheTtlMs;
        this.failOpen = failOpen;
    }

    private record CacheEntry(long fetchedAt, JsonNode data) {}

    /**
     * 判定当前 token 是否拥有所需权限点。
     *
     * @param bearerToken 当前请求的 Authorization 值（含 "Bearer " 前缀，可为 null）
     * @param required    注解声明的权限点（未带 client 前缀的自动补本应用前缀）
     * @param mode        ANY / ALL
     * @return true = 放行
     */
    public boolean hasPermission(String bearerToken, String[] required, RequirePermission.Mode mode) {
        if (required == null || required.length == 0) {
            return true;
        }
        JsonNode data = fetchData(bearerToken);
        if (data == null) {
            return failOpen; // 拉取失败：fail-open 放行 / fail-close 拒绝
        }
        if (!data.path("configured").asBoolean(false)) {
            return true; // R10：应用未配置权限点 = 行为不变，全部放行
        }
        // 平台超管恒放行
        for (JsonNode r : data.path("platformRoles")) {
            String role = r.asText("");
            if ("admin".equals(role) || "superadmin".equals(role)) {
                return true;
            }
        }
        Set<String> owned = new HashSet<>();
        data.path("permissions").forEach(p -> owned.add(p.asText()));
        long hit = Arrays.stream(required)
                .map(this::qualify)
                .filter(owned::contains)
                .count();
        return mode == RequirePermission.Mode.ALL ? hit == required.length : hit > 0;
    }

    /** 权限点补全：{@code api:deploy:create} → {@code <clientId>:api:deploy:create}。 */
    private String qualify(String code) {
        return code.indexOf(':') >= 0 ? code : clientId + ":" + code;
    }

    private JsonNode fetchData(String bearerToken) {
        CacheEntry c = cache;
        long now = System.currentTimeMillis();
        if (c != null && now - c.fetchedAt < cacheTtlMs) {
            return c.data;
        }
        synchronized (this) {
            c = cache;
            if (c != null && now - c.fetchedAt < cacheTtlMs) {
                return c.data;
            }
            if (bearerToken == null || bearerToken.isBlank()) {
                return null;
            }
            try {
                HttpRequest req = HttpRequest.newBuilder()
                        .uri(URI.create(issuer + "/auth/permissions?client="
                                + java.net.URLEncoder.encode(clientId, java.nio.charset.StandardCharsets.UTF_8)))
                        .timeout(Duration.ofSeconds(4))
                        .header("Authorization", bearerToken.startsWith("Bearer ") ? bearerToken : "Bearer " + bearerToken)
                        .GET().build();
                HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
                JsonNode body = mapper.readTree(resp.body());
                if (body.path("code").asInt() != 200) {
                    log.warn("拉取权限失败: HTTP {} {}", resp.statusCode(), body.path("message").asText(""));
                    return null;
                }
                JsonNode data = body.path("data");
                cache = new CacheEntry(now, data);
                return data;
            } catch (Exception e) {
                log.warn("拉取权限异常（fail-open={}）: {}", failOpen, e.getMessage());
                return null;
            }
        }
    }

    /** 当前缓存副本的只读视图（供调试/观测）。 */
    public Set<String> cachedPermissions() {
        CacheEntry c = cache;
        if (c == null) {
            return Collections.emptySet();
        }
        Set<String> out = new HashSet<>();
        c.data.path("permissions").forEach(p -> out.add(p.asText()));
        return out;
    }
}
