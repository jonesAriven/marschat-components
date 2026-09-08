package com.marschat.common.trace;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * TraceId 自动配置（P0 新增）
 * <p>
 * 仅在 Servlet MVC 应用中生效（WebFlux 应用如 kb-gateway 不加载，避免 WebMvcConfigurer 类找不到）。
 * 各 Spring MVC 服务只需引入 common-core 依赖即可自动注册 TraceId 拦截器
 * （经 AutoConfiguration.imports 自动装配，无需在启动类 @Import）。
 * <p>
 * 同时注册 WebLogAspect 切面，自动记录 Controller 方法的入参、出参、耗时，并带 traceId。
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class TraceIdAutoConfig implements WebMvcConfigurer {

    @Bean
    public TraceIdInterceptor traceIdInterceptor() {
        return new TraceIdInterceptor();
    }

    @Bean
    public WebLogAspect webLogAspect() {
        return new WebLogAspect();
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(traceIdInterceptor())
                .addPathPatterns("/**");
    }
}
