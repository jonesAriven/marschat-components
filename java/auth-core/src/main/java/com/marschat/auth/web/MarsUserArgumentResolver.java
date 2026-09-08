package com.marschat.auth.web;

import com.marschat.auth.LoginUser;
import com.marschat.auth.jwt.TokenProvider;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.MethodParameter;
import org.springframework.lang.NonNull;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

/**
 * 解析 {@code @MarsUser LoginUser} 参数：从请求中获取 token 并验签。
 * <p>
 * Token 获取优先级（SSO 增强）：
 * 1. Cookie（SSO 模式，sso_access_token）
 * 2. Authorization Header (Bearer)
 * 3. X-Auth-Token Header（兼容网关转发场景）
 */
public class MarsUserArgumentResolver implements HandlerMethodArgumentResolver {

    private final TokenProvider tokenProvider;

    public MarsUserArgumentResolver(TokenProvider tokenProvider) {
        this.tokenProvider = tokenProvider;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(MarsUser.class)
                && LoginUser.class.isAssignableFrom(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(@NonNull MethodParameter parameter,
                                  ModelAndViewContainer mavContainer,
                                  NativeWebRequest webRequest,
                                  WebDataBinderFactory binderFactory) {
        MarsUser anno = parameter.getParameterAnnotation(MarsUser.class);
        boolean required = anno == null || anno.required();

        HttpServletRequest request = webRequest.getNativeRequest(HttpServletRequest.class);
        String token = extractToken(request);

        if (token == null || token.isBlank()) {
            if (required) {
                throw new NotLoginRuntimeException("missing token");
            }
            return null;
        }
        try {
            return tokenProvider.parseUser(token);
        } catch (JwtException | IllegalArgumentException e) {
            if (required) {
                throw new NotLoginRuntimeException("invalid token: " + e.getMessage());
            }
            return null;
        }
    }

    /**
     * 从请求中提取 Token（支持 SSO Cookie 和 Legacy Header）
     * <p>
     * 优先使用 TokenProvider.resolveToken() 统一解析
     */
    private String extractToken(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        
        // 使用 TokenProvider 的统一解析方法（支持 Cookie + Header）
        String token = tokenProvider.resolveToken(request);
        if (token != null && !token.isBlank()) {
            return token;
        }
        
        // 兼容：X-Auth-Token Header（网关转发场景）
        return request.getHeader("X-Auth-Token");
    }

    /**
     * 未登录运行时异常（RuntimeException 子类，避免 common-core 强耦合）。
     * GlobalExceptionHandler 可按类型映射为 401。
     */
    public static class NotLoginRuntimeException extends RuntimeException {
        public NotLoginRuntimeException(String message) {
            super(message);
        }
    }
}
