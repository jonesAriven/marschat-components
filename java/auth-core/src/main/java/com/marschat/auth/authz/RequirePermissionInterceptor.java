package com.marschat.auth.authz;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.lang.reflect.AnnotatedElement;
import java.lang.reflect.Method;

/**
 * {@link RequirePermission} 拦截器（Phase 2 · auth-core）。
 *
 * <p>读取顺序：方法注解优先，类注解兜底；都无注解 = 直接放行（零开销）。
 * 403 响应体与平台统一格式一致。
 */
@Slf4j
public class RequirePermissionInterceptor implements HandlerInterceptor {

    private final PermissionChecker checker;

    public RequirePermissionInterceptor(PermissionChecker checker) {
        this.checker = checker;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if (!(handler instanceof HandlerMethod hm)) {
            return true;
        }
        Method method = hm.getMethod();
        RequirePermission anno = findAnnotation(method, hm.getBeanType());
        if (anno == null) {
            return true;
        }
        String bearer = request.getHeader("Authorization");
        boolean ok = checker.hasPermission(bearer, anno.value(), anno.mode());
        if (ok) {
            return true;
        }
        log.warn("权限不足 [{} {}] required={} mode={}", request.getMethod(), request.getRequestURI(),
                String.join(",", anno.value()), anno.mode());
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":403,\"message\":\"当前账号无权限执行此操作\",\"data\":null}");
        return false;
    }

    private RequirePermission findAnnotation(Method method, Class<?> beanType) {
        AnnotatedElement element = method;
        RequirePermission anno = AnnotatedElementUtils.findMergedAnnotation(element, RequirePermission.class);
        if (anno == null) {
            anno = AnnotatedElementUtils.findMergedAnnotation(beanType, RequirePermission.class);
        }
        return anno;
    }
}
