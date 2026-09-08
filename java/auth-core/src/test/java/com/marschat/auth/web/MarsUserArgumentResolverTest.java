package com.marschat.auth.web;

import com.marschat.auth.AuthCoreProperties;
import com.marschat.auth.LoginUser;
import com.marschat.auth.jwt.TokenProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.ServletWebRequest;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * @MarsUser 参数解析器测试：Bearer / X-Auth-Token / 缺失 / 无效 / required=false。
 */
class MarsUserArgumentResolverTest {

    private TokenProvider provider;
    private MarsUserArgumentResolver resolver;

    @BeforeEach
    void setUp() {
        AuthCoreProperties properties = new AuthCoreProperties();
        properties.setSecret("UnitTestSecretKey2026MustBe32Bytes!!");
        provider = new TokenProvider(properties);
        resolver = new MarsUserArgumentResolver(provider);
    }

    record Controller() {
        public void withUser(@MarsUser LoginUser user) {
        }

        public void optionalUser(@MarsUser(required = false) LoginUser user) {
        }
    }

    private static MethodParameter param(String methodName) throws NoSuchMethodException {
        Method method = Controller.class.getDeclaredMethod(methodName, LoginUser.class);
        return new MethodParameter(method, 0);
    }

    private static NativeWebRequest webRequest(MockHttpServletRequest request) {
        return new ServletWebRequest(request);
    }

    @Test
    @DisplayName("Authorization: Bearer xxx 正常解析")
    void bearerTokenResolved() throws Exception {
        String token = provider.generateAccessToken(7L, "liang");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer " + token);

        Object result = resolver.resolveArgument(param("withUser"), null, webRequest(request), null);
        assertThat(result).isEqualTo(new LoginUser(7L, "liang", "access"));
    }

    @Test
    @DisplayName("X-Auth-Token 兜底头同样生效")
    void xAuthTokenFallback() throws Exception {
        String token = provider.generateAccessToken(7L, "liang");
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Auth-Token", token);

        Object result = resolver.resolveArgument(param("withUser"), null, webRequest(request), null);
        assertThat(result).isEqualTo(new LoginUser(7L, "liang", "access"));
    }

    @Test
    @DisplayName("缺 token 且 required=true → 抛未登录异常")
    void missingTokenThrows() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        assertThatThrownBy(() ->
                resolver.resolveArgument(param("withUser"), null, webRequest(request), null))
                .isInstanceOf(MarsUserArgumentResolver.NotLoginRuntimeException.class);
    }

    @Test
    @DisplayName("缺 token 且 required=false → 注入 null")
    void missingTokenOptional() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest();
        Object result = resolver.resolveArgument(param("optionalUser"), null, webRequest(request), null);
        assertThat(result).isNull();
    }

    @Test
    @DisplayName("伪造 token → 抛未登录异常")
    void invalidTokenThrows() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer not-a-jwt");
        assertThatThrownBy(() ->
                resolver.resolveArgument(param("withUser"), null, webRequest(request), null))
                .isInstanceOf(MarsUserArgumentResolver.NotLoginRuntimeException.class);
    }

    @Test
    @DisplayName("supportsParameter：仅认 @MarsUser + LoginUser 组合")
    void supportsParameter() throws Exception {
        assertThat(resolver.supportsParameter(param("withUser"))).isTrue();
    }
}
