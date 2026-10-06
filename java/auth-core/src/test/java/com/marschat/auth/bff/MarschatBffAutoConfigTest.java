package com.marschat.auth.bff;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * BFF 自动装配单测 —— 验证「配置化接入」的门槛与边界：
 * <b>不配置 = 不装配</b>（对既有应用零影响）、配置后能力齐备、以及两个可选 Bean 的装配条件。
 */
class MarschatBffAutoConfigTest {

    private final WebApplicationContextRunner runner = new WebApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(MarschatBffAutoConfig.class));

    @Test
    @DisplayName("未配置 marschat.bff.enabled → 完全不装配（既有应用零影响）")
    void disabledByDefault() {
        runner.run(context -> {
            assertFalse(context.containsBean("marschatBffAdminProxyController"));
            assertFalse(context.containsBean("marschatBffWhitelist"));
            assertFalse(context.containsBean("marschatCenterSessionStore"));
        });
    }

    @Test
    @DisplayName("enabled=true → 白名单 / 会话表 / 凭据解析器 / 控制器 全部装配")
    void enabledWiresAllCoreBeans() {
        runner.withPropertyValues(
                        "marschat.bff.enabled=true",
                        "marschat.bff.client-id=marschat-demo",
                        "marschat.bff.whitelist-location=classpath:not-exists-demo.yml")
                .run(context -> {
                    assertTrue(context.containsBean("marschatBffWhitelist"));
                    assertTrue(context.containsBean("marschatCenterSessionStore"));
                    assertTrue(context.containsBean("marschatBffCredentialResolver"));
                    assertTrue(context.containsBean("marschatBffAdminProxyController"));
                    // 白名单文件缺失 → fail-closed 空白名单
                    BffWhitelist whitelist = context.getBean(BffWhitelist.class);
                    assertTrue(whitelist.isEmpty());
                    assertFalse(whitelist.isAllowed("GET", "/admin/users", null, "marschat-demo"));
                });
    }

    @Test
    @DisplayName("提供 BffAccountSource → 装配账号上报器；不提供 → 不装配")
    void accountReporterConditionalOnSource() {
        runner.withPropertyValues(
                        "marschat.bff.enabled=true",
                        "marschat.bff.client-id=marschat-demo",
                        "marschat.bff.whitelist-location=classpath:not-exists-demo.yml")
                .run(context -> assertFalse(context.containsBean("marschatBffAccountReporter")));

        runner.withUserConfiguration(WithAccountSource.class)
                .withPropertyValues(
                        "marschat.bff.enabled=true",
                        "marschat.bff.client-id=marschat-demo",
                        "marschat.bff.whitelist-location=classpath:not-exists-demo.yml")
                .run(context -> assertTrue(context.containsBean("marschatBffAccountReporter")));
    }

    @Test
    @DisplayName("应用自带 CenterSessionStore → 公共默认实现让位（灰度期可覆盖）")
    void appProvidedSessionStoreWins() {
        runner.withUserConfiguration(WithCustomSessionStore.class)
                .withPropertyValues(
                        "marschat.bff.enabled=true",
                        "marschat.bff.client-id=marschat-demo",
                        "marschat.bff.whitelist-location=classpath:not-exists-demo.yml")
                .run(context -> {
                    CenterSessionStore store = context.getBean(CenterSessionStore.class);
                    store.put("someone", "token-abc", 60_000);
                    assertTrue(store.getAccessToken("someone").startsWith("custom:"));
                });
    }

    @Test
    @DisplayName("凭据模式默认 PASSTHROUGH；可配置为 SESSION_STORE / AUTO")
    void credentialModeIsConfigurable() {
        runner.withPropertyValues(
                        "marschat.bff.enabled=true",
                        "marschat.bff.client-id=marschat-demo",
                        "marschat.bff.whitelist-location=classpath:not-exists-demo.yml")
                .run(context -> {
                    BffProperties props = context.getBean(BffProperties.class);
                    assertTrue(props.getCredentialMode() == BffProperties.CredentialMode.PASSTHROUGH);
                });

        runner.withPropertyValues(
                        "marschat.bff.enabled=true",
                        "marschat.bff.client-id=marschat-demo",
                        "marschat.bff.credential-mode=auto",
                        "marschat.bff.path-prefix=/admin",
                        "marschat.bff.whitelist-location=classpath:not-exists-demo.yml")
                .run(context -> {
                    BffProperties props = context.getBean(BffProperties.class);
                    assertTrue(props.getCredentialMode() == BffProperties.CredentialMode.AUTO);
                    // 路径前缀可配置：kb-ops 风格 /admin 与 infra 风格 /api/admin 用同一实现
                    assertTrue("/admin".equals(props.getPathPrefix()));
                });
    }

    @Configuration
    static class WithAccountSource {
        @Bean
        BffAccountSource bffAccountSource() {
            return () -> List.of(new BffAccountSource.BffLocalAccount("admin", "应急管理员"));
        }
    }

    @Configuration
    static class WithCustomSessionStore {
        @Bean
        CenterSessionStore centerSessionStore() {
            return new CenterSessionStore() {
                @Override
                public void put(String username, String accessToken, long expiresInMs) {
                }

                @Override
                public String getAccessToken(String username) {
                    return "custom:token";
                }

                @Override
                public void remove(String username) {
                }
            };
        }
    }
}
