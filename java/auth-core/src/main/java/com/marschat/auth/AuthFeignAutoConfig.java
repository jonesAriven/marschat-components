package com.marschat.auth;

import com.marschat.auth.feign.AuthHeadersFeignInterceptor;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;

/**
 * Feign token 透传自动装配（仅当下游引入了 OpenFeign 时生效）。
 */
@AutoConfiguration
@ConditionalOnClass(name = "feign.RequestInterceptor")
public class AuthFeignAutoConfig {

    @Bean
    @ConditionalOnMissingBean(AuthHeadersFeignInterceptor.class)
    public AuthHeadersFeignInterceptor authHeadersFeignInterceptor() {
        return new AuthHeadersFeignInterceptor();
    }
}
