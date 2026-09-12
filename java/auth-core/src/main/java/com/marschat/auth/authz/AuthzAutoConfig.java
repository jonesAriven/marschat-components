package com.marschat.auth.authz;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * authz 自动装配（Phase 2）。
 *
 * <p>启用条件：{@code marschat.authz.enabled=true}（默认开启）且 Servlet web 环境。
 * 必须配置 {@code marschat.authz.client-id}（本应用在 auth-center 注册的 client_id），
 * 未配置时整块不装配（避免误以空 client 拉权限）。
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(prefix = "marschat.authz", name = "enabled", havingValue = "true", matchIfMissing = true)
public class AuthzAutoConfig {

    @Bean
    @ConfigurationProperties(prefix = "marschat.authz")
    @ConditionalOnMissingBean
    public AuthzProperties authzProperties() {
        return new AuthzProperties();
    }

    @Bean
    @ConditionalOnMissingBean
    public PermissionChecker permissionChecker(AuthzProperties props) {
        return new PermissionChecker(props.getIssuer(), props.getClientId(),
                props.getCacheTtlMs(), props.isFailOpen());
    }

    @Bean
    @ConditionalOnMissingBean(name = "requirePermissionWebConfigurer")
    public WebMvcConfigurer requirePermissionWebConfigurer(AuthzProperties props, PermissionChecker checker) {
        return new WebMvcConfigurer() {
            @Override
            public void addInterceptors(InterceptorRegistry registry) {
                if (props.getClientId() == null || props.getClientId().isBlank()) {
                    // 未配置 client_id：跳过注册（log 由 properties 里 getter 打）
                    return;
                }
                registry.addInterceptor(new RequirePermissionInterceptor(checker))
                        .addPathPatterns("/**")
                        .order(0);
            }
        };
    }

    /** authz 配置项。 */
    @ConfigurationProperties(prefix = "marschat.authz")
    public static class AuthzProperties {
        /** 是否启用 @RequirePermission 拦截（默认 true；未配 client-id 时不注册拦截器）。 */
        private boolean enabled = true;

        /** auth-center 基址（如 https://auth.marschat.online）。 */
        private String issuer = "https://auth.marschat.online";

        /** 本应用 client_id（必填才生效）。 */
        private String clientId;

        /** 权限缓存 TTL（毫秒），默认 60s。 */
        private long cacheTtlMs = 60_000L;

        /** auth-center 不可达时放行（默认 true）。 */
        private boolean failOpen = true;

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getIssuer() { return issuer; }
        public void setIssuer(String issuer) { this.issuer = issuer; }
        public String getClientId() { return clientId; }
        public void setClientId(String clientId) { this.clientId = clientId; }
        public long getCacheTtlMs() { return cacheTtlMs; }
        public void setCacheTtlMs(long cacheTtlMs) { this.cacheTtlMs = cacheTtlMs; }
        public boolean isFailOpen() { return failOpen; }
        public void setFailOpen(boolean failOpen) { this.failOpen = failOpen; }
    }
}
