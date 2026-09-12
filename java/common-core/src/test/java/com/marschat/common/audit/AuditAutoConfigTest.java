package com.marschat.common.audit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * audit 自动装配语义测试。
 *
 * <p>回归防护（2026-09-13 · common-core 1.1.5 事故）：
 * kb-gateway 是 WebFlux 应用，{@link AuditOperationAspect} 却因缺少 Web 类型条件
 * 被装配，AspectJ 构造 {@code AspectMetadata} 时加载 {@code HttpServletRequest}
 * → {@code NoClassDefFoundError} → 启动崩溃。
 *
 * <p>本测试锁死语义：**Servlet 应用装配，非 Servlet 环境整体不装配**。
 * 若有人删掉 {@code AuditAutoConfig} 上的 {@code @ConditionalOnWebApplication(SERVLET)}，
 * {@code doesNotConfigureOutsideServletApplication} 会立刻失败。
 */
class AuditAutoConfigTest {

    /** Servlet Web 环境（对应 kb-file / kb-knowledge / kb-intelligence / kb-ops / infra-monitor / portal-server） */
    private final WebApplicationContextRunner servletRunner = new WebApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(AuditAutoConfig.class));

    /** 非 Web 环境（NONE）——与 REACTIVE 一样不满足 SERVLET 条件，用于锁死「非 servlet 不装配」 */
    private final ApplicationContextRunner plainRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(AuditAutoConfig.class));

    @Test
    @DisplayName("Servlet 应用：装配 AuditSink + AuditOperationAspect")
    void configuresInServletApplication() {
        servletRunner.run(context -> {
            assertThat(context).hasSingleBean(AuditSink.class);
            assertThat(context).hasSingleBean(AuditOperationAspect.class);
        });
    }

    @Test
    @DisplayName("非 Servlet 环境：整体不装配（杜绝 servlet API 被加载）")
    void doesNotConfigureOutsideServletApplication() {
        plainRunner.run(context -> {
            assertThat(context).doesNotHaveBean(AuditSink.class);
            assertThat(context).doesNotHaveBean(AuditOperationAspect.class);
        });
    }

    @Test
    @DisplayName("marschat.audit.enabled=false 时停用")
    void disabledByProperty() {
        servletRunner.withPropertyValues("marschat.audit.enabled=false")
                .run(context -> {
                    assertThat(context).doesNotHaveBean(AuditSink.class);
                    assertThat(context).doesNotHaveBean(AuditOperationAspect.class);
                });
    }

    @Test
    @DisplayName("应用自带 AuditSink 时让位（不覆盖）")
    void customSinkRespected() {
        AuditSink custom = new Slf4jAuditSink();
        servletRunner.withBean("myAuditSink", AuditSink.class, () -> custom)
                .run(context -> assertThat(context.getBean(AuditSink.class)).isSameAs(custom));
    }
}
