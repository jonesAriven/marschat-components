package com.marschat.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 认证公共配置。
 * <p>
 * 迁移自各服务散落的 {@code @Value("${jwt.secret}")} 等零散注入点，
 * 统一收敛为一个前缀 {@code marschat.auth} 的属性对象。
 * <p>
 * 兼容说明：属性名与原各服务的 application.yml 键保持独立（原 {@code jwt.*} 键不动，
 * 服务迁移时可同时保留两套配置过渡），避免一次切换导致线上启动失败。
 */
@ConfigurationProperties(prefix = "marschat.auth")
public class AuthCoreProperties {

    /** HS256 签名密钥（>= 32 字节），全服务必须一致才能 token 互认 */
    private String secret;

    /** access token 有效期（毫秒），默认 2 小时 */
    private long accessTokenExpiration = 2 * 60 * 60 * 1000L;

    /** refresh token 有效期（毫秒），默认 7 天 */
    private long refreshTokenExpiration = 7 * 24 * 60 * 60 * 1000L;

    public String getSecret() {
        return secret;
    }

    public void setSecret(String secret) {
        this.secret = secret;
    }

    public long getAccessTokenExpiration() {
        return accessTokenExpiration;
    }

    public void setAccessTokenExpiration(long accessTokenExpiration) {
        this.accessTokenExpiration = accessTokenExpiration;
    }

    public long getRefreshTokenExpiration() {
        return refreshTokenExpiration;
    }

    public void setRefreshTokenExpiration(long refreshTokenExpiration) {
        this.refreshTokenExpiration = refreshTokenExpiration;
    }
}
