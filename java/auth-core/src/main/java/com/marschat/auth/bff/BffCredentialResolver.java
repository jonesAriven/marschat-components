package com.marschat.auth.bff;

import jakarta.servlet.http.HttpServletRequest;

/**
 * 中心凭据解析器 —— 决定「这次代理请求用哪个 token 去访问 auth-center」。
 *
 * <p>这是 Phase 13 收敛的核心接缝：历史上三份手写 {@code AdminProxyController} 在这一点上
 * **行为已经分叉**（kb-ops 直接透传调用者 {@code Authorization}；infra / activecode 走
 * {@code resolveCenterToken()} + {@link CenterSessionStore} 换票）。同一个「代理中心
 * {@code /admin/**}」语义却有两套凭据策略，意味着**安全边界由"当时抄的是哪一份"决定**。
 *
 * <p>现统一为一个可配置接缝：默认实现 {@link DefaultBffCredentialResolver} 覆盖
 * {@link BffProperties.CredentialMode} 的三种模式；应用若有更特殊的需求（如需在换票时
 * 顺带刷新），提供自己的 {@code BffCredentialResolver} Bean 即可覆盖，无需改公共库。
 */
@FunctionalInterface
public interface BffCredentialResolver {

    /**
     * 解析本次请求可用的**中心** accessToken。
     *
     * @param request 当前请求
     * @return 中心 accessToken（**不含** {@code Bearer } 前缀）；无凭据返回 {@code null}
     *         （调用方据此返回 401 fail-closed，**绝不**回退服务账号）
     */
    String resolve(HttpServletRequest request);
}
