package com.marschat.auth;

import com.marschat.auth.feign.AuthHeadersFeignInterceptor;
import com.marschat.auth.jwt.TokenProvider;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.cloud.openfeign.FeignAutoConfiguration;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 装配语义测试：secret 缺失 fail-fast、secret 配好自动出 TokenProvider、Feign 拦截器按条件装配。
 */
class AuthAutoConfigTest {

    private static final String SECRET = "UnitTestSecretKey2026MustBe32Bytes!!";

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(AuthJwtAutoConfig.class));

    @Test
    @DisplayName("未配置 secret：启动失败（fail-fast）")
    void missingSecretFailsFast() {
        runner.run(context -> assertThat(context).hasFailed());
    }

    @Test
    @DisplayName("配置 secret：自动装配 TokenProvider")
    void tokenProviderAutoConfigured() {
        runner.withPropertyValues("marschat.auth.secret=" + SECRET)
                .run(context -> {
                    assertThat(context).hasSingleBean(TokenProvider.class);
                    assertThat(context).hasSingleBean(AuthCoreProperties.class);
                    assertThat(context.getBean(AuthCoreProperties.class).getAccessTokenExpiration())
                            .isEqualTo(2 * 60 * 60 * 1000L); // 默认 2h
                });
    }

    @Test
    @DisplayName("自定义 TokenProvider Bean 存在时不覆盖（@ConditionalOnMissingBean 语义）")
    void customProviderRespected() {
        AuthCoreProperties props = new AuthCoreProperties();
        props.setSecret(SECRET);
        TokenProvider custom = new TokenProvider(props);

        runner.withPropertyValues("marschat.auth.secret=" + SECRET)
                .withBean("customTokenProvider", TokenProvider.class, () -> custom)
                .run(context -> assertThat(context.getBean(TokenProvider.class)).isSameAs(custom));
    }

    @Test
    @DisplayName("Feign 拦截器：有 RequestInterceptor class 时自动装配，透传 Authorization")
    void feignInterceptorConfiguredAndWorks() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(
                        AuthJwtAutoConfig.class, AuthFeignAutoConfig.class, FeignAutoConfiguration.class))
                .withPropertyValues("marschat.auth.secret=" + SECRET)
                .run(context -> {
                    assertThat(context).hasSingleBean(AuthHeadersFeignInterceptor.class);

                    // 行为验证：当前请求带 Authorization，模板应被透传
                    MockHttpServletRequest request = new MockHttpServletRequest();
                    request.addHeader("Authorization", "Bearer abc.def.ghi");
                    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
                    try {
                        feign.RequestTemplate template = new feign.RequestTemplate();
                        context.getBean(AuthHeadersFeignInterceptor.class).apply(template);
                        assertThat(template.headers().get("Authorization"))
                                .containsExactly("Bearer abc.def.ghi");
                    } finally {
                        RequestContextHolder.resetRequestAttributes();
                    }
                });
    }
}
