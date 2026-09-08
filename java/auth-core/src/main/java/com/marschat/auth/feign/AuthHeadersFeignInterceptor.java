package com.marschat.auth.feign;

import feign.RequestInterceptor;
import feign.RequestTemplate;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Feign token 透传：把当前请求的 Authorization 头原样带给下游服务。
 * <p>
 * 替代 kb-knowledge 等服务手写的 feignUserInterceptor（其只透传 X-User-Id）。
 * 网关/服务间调用的认证语义由此统一为「透传原始 token，由被调方自行验签」。
 */
public class AuthHeadersFeignInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        if (template.headers().containsKey("Authorization")) {
            return; // 调用方已显式设置，不覆盖
        }
        HttpServletRequest request = currentRequest();
        if (request == null) {
            return; // 非 web 线程（定时任务 / 消费者线程），无 token 可透传
        }
        String authorization = request.getHeader("Authorization");
        if (authorization != null && !authorization.isBlank()) {
            template.header("Authorization", authorization);
        }
    }

    private HttpServletRequest currentRequest() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return attributes.getRequest();
        }
        return null;
    }
}
