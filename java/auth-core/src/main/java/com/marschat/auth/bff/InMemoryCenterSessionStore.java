package com.marschat.auth.bff;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * {@link CenterSessionStore} 的进程内实现（默认装配）。
 *
 * <p><b>已知边界</b>（与 portal 同口径，登记为 {@code T-LOW-2}）：
 * 内存态，服务重启即失效 → 账密会话访问用户管理会返回 401 触发重授权；且要求单实例部署。
 * SSO 会话不受影响 —— 它持有的是中心 OIDC access token，由调用方直接带来。
 * 多副本 / 重启不丢的场景，请提供自定义 {@link CenterSessionStore} Bean（如 Redis 实现）覆盖本默认。
 */
public class InMemoryCenterSessionStore implements CenterSessionStore {

    /** 提前 60s 视为过期，避免边界时刻把刚过期的 token 发出去。 */
    private static final long SKEW_MS = 60_000L;

    /** 中心未返回 expiresIn 时的兜底有效期：1 小时。 */
    private static final long DEFAULT_TTL_MS = 3_600_000L;

    private final Map<String, Entry> sessions = new ConcurrentHashMap<>();

    private record Entry(String accessToken, long expiresAt) {
    }

    @Override
    public void put(String username, String accessToken, long expiresInMs) {
        if (username == null || username.isBlank() || accessToken == null || accessToken.isBlank()) {
            return;
        }
        long ttl = expiresInMs > 0 ? expiresInMs : DEFAULT_TTL_MS;
        sessions.put(username, new Entry(accessToken, System.currentTimeMillis() + ttl - SKEW_MS));
    }

    @Override
    public String getAccessToken(String username) {
        if (username == null || username.isBlank()) {
            return null;
        }
        Entry entry = sessions.get(username);
        if (entry == null) {
            return null;
        }
        if (entry.expiresAt() <= System.currentTimeMillis()) {
            sessions.remove(username);
            return null;
        }
        return entry.accessToken();
    }

    @Override
    public void remove(String username) {
        if (username != null) {
            sessions.remove(username);
        }
    }

    /** 当前在册会话数（自检 / 监控用）。 */
    public int size() {
        return sessions.size();
    }
}
