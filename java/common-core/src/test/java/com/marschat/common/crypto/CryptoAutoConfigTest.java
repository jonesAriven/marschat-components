package com.marschat.common.crypto;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * crypto 自动装配语义测试 —— 守住 2026-09-12 实测到的两个**启动期**缺陷（ADR §18.3）。
 *
 * <p>这两个缺陷都是「classpath 一升版本就炸」级别，且只在真机启动时才暴露
 * （单测/编译期都发现不了），所以必须固化成用例：
 *
 * <ol>
 *   <li><b>bean 名撞车</b>：库 bean 名曾是 {@code cryptoUtil}，与 portal / kb-ops /
 *       infra-monitor 应用自带的 {@code @Component CryptoUtil} 同名 → 生产禁 bean 覆盖
 *       → {@code BeanDefinitionOverrideException} 启动失败。守卫：库 bean 名必须是
 *       {@code marschatCryptoUtil}，且应用自带同名 bean 时二者**共存**。</li>
 *   <li><b>空 key 炸启动</b>：{@link CryptoUtil} 构造对空 key 抛异常，而自动装配若在
 *       未配 key 时也装配，任何只升版本、没配 {@code marschat.crypto.key} 的应用都会
 *       启动失败。守卫：未配 key 时**不装配**。</li>
 * </ol>
 */
class CryptoAutoConfigTest {

    private static final String VALID_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(CryptoAutoConfig.class));

    @Test
    @DisplayName("配了 key：装配 CryptoUtil，且 bean 名带命名空间前缀 marschatCryptoUtil")
    void configuresWithKeyAndNamespacedBeanName() {
        runner.withPropertyValues("marschat.crypto.key=" + VALID_KEY)
                .run(context -> {
                    assertThat(context).hasSingleBean(CryptoUtil.class);
                    // 🔴 回归守卫 ①：bean 名一旦被改回裸 cryptoUtil，生产会与应用自带 bean 撞车
                    assertThat(context.containsBean("marschatCryptoUtil"))
                            .as("库 bean 必须叫 marschatCryptoUtil（不得占用通用名 cryptoUtil）")
                            .isTrue();
                    assertThat(context.containsBean("cryptoUtil"))
                            .as("库不得注册裸名 cryptoUtil")
                            .isFalse();
                });
    }

    @Test
    @DisplayName("🔴 回归：应用自带同名 cryptoUtil（异类型）bean 时二者共存，不抛 BeanDefinitionOverrideException")
    void coexistsWithApplicationOwnedCryptoUtilBean() {
        runner.withPropertyValues("marschat.crypto.key=" + VALID_KEY)
                // 模拟 portal / kb-ops / infra-monitor：应用自己 @Component 的 CryptoUtil，
                // 包名不同（类型不同）但 bean 名同为 cryptoUtil
                .withBean("cryptoUtil", AppOwnedCryptoUtil.class, AppOwnedCryptoUtil::new)
                .run(context -> {
                    assertThat(context.containsBean("cryptoUtil")).isTrue();
                    assertThat(context.containsBean("marschatCryptoUtil")).isTrue();
                    assertThat(context.getBean("cryptoUtil")).isInstanceOf(AppOwnedCryptoUtil.class);
                    assertThat(context.getBean("marschatCryptoUtil")).isInstanceOf(CryptoUtil.class);
                });
    }

    @Test
    @DisplayName("🔴 回归：未配 marschat.crypto.key 时不装配（存量应用只升版本不得被拖崩）")
    void doesNotConfigureWithoutKey() {
        runner.run(context -> {
            assertThat(context).doesNotHaveBean(CryptoUtil.class);
            assertThat(context.containsBean("marschatCryptoUtil")).isFalse();
        });
    }

    @Test
    @DisplayName("marschat.crypto.enabled=false 整体停用")
    void disabledByProperty() {
        runner.withPropertyValues(
                        "marschat.crypto.key=" + VALID_KEY,
                        "marschat.crypto.enabled=false")
                .run(context -> assertThat(context).doesNotHaveBean(CryptoUtil.class));
    }

    @Test
    @DisplayName("装配出的实例可用：加解密往返")
    void roundTrip() {
        runner.withPropertyValues("marschat.crypto.key=" + VALID_KEY)
                .run(context -> {
                    CryptoUtil util = context.getBean(CryptoUtil.class);
                    String cipher = util.encrypt("hello-platform");
                    assertThat(cipher).startsWith("gcm:");
                    assertThat(util.decrypt(cipher)).isEqualTo("hello-platform");
                });
    }

    /** 模拟存量应用自带的同名组件（包名/类型不同，bean 名相同）。 */
    public static class AppOwnedCryptoUtil {
    }
}
