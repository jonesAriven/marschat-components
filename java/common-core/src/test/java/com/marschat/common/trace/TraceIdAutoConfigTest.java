package com.marschat.common.trace;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.config.annotation.InterceptorRegistration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * TraceIdAutoConfig 自动配置单元测试
 */
@DisplayName("TraceIdAutoConfig 自动配置单元测试")
class TraceIdAutoConfigTest {

    @Test
    @DisplayName("traceIdInterceptor_创建Bean_返回非空实例")
    void traceIdInterceptor_returnsNonNullInstance() {
        TraceIdAutoConfig config = new TraceIdAutoConfig();

        TraceIdInterceptor interceptor = config.traceIdInterceptor();

        assertNotNull(interceptor);
    }

    @Test
    @DisplayName("traceIdInterceptor_多次调用_返回新实例")
    void traceIdInterceptor_multipleCalls_returnsNewInstance() {
        TraceIdAutoConfig config = new TraceIdAutoConfig();

        TraceIdInterceptor i1 = config.traceIdInterceptor();
        TraceIdInterceptor i2 = config.traceIdInterceptor();

        assertNotSame(i1, i2);
    }

    @Test
    @DisplayName("addInterceptors_注册拦截器_路径模式为/**（历史为 /api/**；保持与实现一致，避免改变运行时行为）")
    void addInterceptors_registersInterceptorWithAllPattern() {
        TraceIdAutoConfig config = new TraceIdAutoConfig();
        InterceptorRegistry registry = mock(InterceptorRegistry.class);
        InterceptorRegistration registration = mock(InterceptorRegistration.class);
        when(registry.addInterceptor(any(TraceIdInterceptor.class))).thenReturn(registration);

        config.addInterceptors(registry);

        verify(registry).addInterceptor(any(TraceIdInterceptor.class));
        verify(registration).addPathPatterns("/**");
    }

    @Test
    @DisplayName("addInterceptors_注册后返回的registration可继续链式配置")
    void addInterceptors_returnsRegistrationForChaining() {
        TraceIdAutoConfig config = new TraceIdAutoConfig();
        InterceptorRegistry registry = mock(InterceptorRegistry.class);
        InterceptorRegistration registration = mock(InterceptorRegistration.class);
        when(registry.addInterceptor(any())).thenReturn(registration);

        config.addInterceptors(registry);

        verify(registry, times(1)).addInterceptor(any());
    }

    @Test
    @DisplayName("TraceIdAutoConfig_是WebMvcConfigurer实现")
    void traceIdAutoConfig_isWebMvcConfigurer() {
        TraceIdAutoConfig config = new TraceIdAutoConfig();

        assertInstanceOf(WebMvcConfigurer.class, config);
    }
}
