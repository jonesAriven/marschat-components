package com.marschat.auth.anonymous;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/**
 * 放开登录校验的配置化白名单 —— 自动装配入口。
 *
 * <p>本装配<b>只注册配置 Bean</b>（{@link AnonymousAuthProperties}），不注册任何拦截器：
 * 各应用的鉴权链形态各异（自有 MVC 拦截器 / Spring Security / 其他），公共库无法统一接管，
 * 但可以把「放行清单」这一事实源收敛到 yml。应用侧接线（二选一）：
 * <pre>
 * // 形态 A · 自有 MVC 拦截器（activecode / portal）
 * registry.addInterceptor(jwtInterceptor)
 *         .addPathPatterns(...)
 *         .excludePathPatterns(anonymousAuth.effectivePaths().toArray(new String[0]));
 *
 * // 形态 B · Spring Security（kb-ops / infra-monitor）
 * .requestMatchers(anonymousAuth.effectivePaths().toArray(new String[0])).permitAll()
 * </pre>
 *
 * <p><b>Bean 名约定</b>：由 {@code @EnableConfigurationProperties} 生成
 * （{@code <prefix>-<fqn>} 形式），应用侧用构造注入获取，禁止自定义同名 Bean。
 *
 * <p><b>条件</b>：类路径存在 Servlet API（{@code jakarta.servlet.http.HttpServletRequest}）。
 * WebFlux 应用不装配（用不着）；非 Web 应用同样不装配。
 */
@AutoConfiguration
@ConditionalOnClass(name = "jakarta.servlet.http.HttpServletRequest")
@EnableConfigurationProperties(AnonymousAuthProperties.class)
public class AnonymousAuthAutoConfig {
}
