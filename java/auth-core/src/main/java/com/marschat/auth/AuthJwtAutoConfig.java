package com.marschat.auth;

import com.marschat.auth.jwt.TokenProvider;
import com.marschat.auth.oidc.OidcTokenVerifier;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;

/**
 * TokenProvider 自动装配。
 * <p>
 * 引入 auth-core + 配好 marschat.auth.secret 即得 TokenProvider；
 * 服务自带实现（如 kb-auth 需要更多签发方法）时可用 @ConditionalOnMissingBean 覆盖。
 * <p>
 * 2.0.0 起：若类路径存在 nimbus-jose-jwt（OIDC JWKS 解析），自动装配 OidcTokenVerifier
 * 并注入 TokenProvider，使其 validateToken 具备 RS256+HS256 双验签能力；缺失时退化为纯 HS256。
 */
@AutoConfiguration
@ConditionalOnClass(name = "io.jsonwebtoken.Jwts")
@EnableConfigurationProperties(AuthCoreProperties.class)
public class AuthJwtAutoConfig {

    @Bean
    @ConditionalOnMissingBean
    @ConditionalOnClass(name = "com.nimbusds.jose.jwk.JWKSet")
    public OidcTokenVerifier oidcTokenVerifier() {
        return new OidcTokenVerifier();
    }

    @Bean
    @ConditionalOnMissingBean
    public TokenProvider tokenProvider(AuthCoreProperties properties,
                                       ObjectProvider<OidcTokenVerifier> oidcTokenVerifier) {
        return new TokenProvider(properties, oidcTokenVerifier.getIfAvailable());
    }
}
