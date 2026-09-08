package com.marschat.auth;

import com.marschat.auth.jwt.TokenProvider;
import com.marschat.auth.web.MarsUserArgumentResolver;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

/**
 * @MarsUser 参数解析器自动装配（仅 Servlet web 环境）。
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnClass(WebMvcConfigurer.class)
public class AuthWebAutoConfig {

    @Bean
    @ConditionalOnMissingBean
    public MarsUserArgumentResolver marsUserArgumentResolver(TokenProvider tokenProvider) {
        return new MarsUserArgumentResolver(tokenProvider);
    }

    @Bean
    @ConditionalOnMissingBean(name = "marsUserWebMvcConfigurer")
    public WebMvcConfigurer marsUserWebMvcConfigurer(MarsUserArgumentResolver resolver) {
        return new WebMvcConfigurer() {
            @Override
            public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
                resolvers.add(resolver);
            }
        };
    }
}
