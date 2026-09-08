package com.marschat.auth;

/**
 * 当前登录用户（从 JWT 解析出的最小身份信息）。
 * <p>
 * 迁移自 kb-auth / kb-ops 各自手写的「userId + username + type」三连读取。
 *
 * @param userId    用户 ID（JWT subject）
 * @param username  用户名（JWT claim "username"）
 * @param tokenType token 类型（access / refresh，自签发服务才有）
 */
public record LoginUser(Long userId, String username, String tokenType) {

    public boolean isRefreshToken() {
        return "refresh".equals(tokenType);
    }
}
