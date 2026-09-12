package com.marschat.common.audit;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;

/**
 * audit 自动装配：{@code marschat.audit.enabled=false} 可停用（默认开启）。
 *
 * <p>⚠️ 2026-09-13 事故修复（common-core 1.1.5）——**必须保持 Servlet 条件，勿删**。
 *
 * <p>事故现象：kb-gateway（WebFlux，{@code AnnotationConfigReactiveWebServerApplicationContext}）
 * 启动即崩，容器 {@code Exited (1)} 反复重启，网关 8090 无响应：
 *
 * <pre>
 * BeanCreationException: Error creating bean with name 'meterRegistryPostProcessor'
 *   ... BeanPostProcessor before instantiation of bean failed
 * Caused by: java.lang.NoClassDefFoundError: jakarta/servlet/http/HttpServletRequest
 *   at org.aspectj.internal.lang.reflect.AjTypeImpl.getDeclarePrecedence
 *   at org.springframework.aop.aspectj.annotation.AspectMetadata.&lt;init&gt;
 *   at ...BeanFactoryAspectJAdvisorsBuilder.buildAspectJAdvisors
 * </pre>
 *
 * <p>根因：{@link AuditOperationAspect} 直接依赖 Servlet API
 * （{@code jakarta.servlet.http.HttpServletRequest} + {@code RequestContextHolder}），
 * 而本配置原先**没有** Web 类型条件 → WebFlux 应用也装配该切面 Bean。
 * AspectJ 的 {@code BeanFactoryAspectJAdvisorsBuilder} 遍历 Bean 定义构造
 * {@code AspectMetadata} 时反射读取方法签名，触发 {@code HttpServletRequest} 类加载；
 * WebFlux 应用 classpath 无 servlet API → {@code NoClassDefFoundError} → 上下文刷新失败。
 *
 * <p>为何此前未暴露：mykng 下游升版（common-core 1.1.x）后**从未真实部署过**，
 * 本次 P-A 首次全量部署才让该缺陷进入运行期。与 {@code CryptoAutoConfig} 的两处缺陷
 * 同属一类——**库的自动装配未按 Web 类型收敛条件**。
 *
 * <p>修复口径：与 {@link com.marschat.common.trace.TraceIdAutoConfig}
 * （{@code @ConditionalOnWebApplication(SERVLET)}）和
 * {@code GlobalExceptionHandlerAutoConfiguration}
 * （SERVLET + {@code @ConditionalOnClass(DispatcherServlet)}）保持一致。
 * WebFlux 应用不装配本配置——其审计语义应由 reactive 侧另行实现（当前无此需求）。
 *
 * <p>回归防护：{@code AuditAutoConfigTest} 断言非 Servlet 环境下
 * {@code AuditSink} / {@code AuditOperationAspect} 均不装配。
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "marschat.audit", name = "enabled", havingValue = "true", matchIfMissing = true)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class AuditAutoConfig {

    @Bean
    @ConditionalOnMissingBean
    public AuditSink auditSink() {
        return new Slf4jAuditSink();
    }

    @Bean
    @ConditionalOnMissingBean
    public AuditOperationAspect auditOperationAspect(AuditSink sink) {
        return new AuditOperationAspect(sink);
    }
}
