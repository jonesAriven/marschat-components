package com.marschat.auth.anonymous;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link AnonymousAuthProperties} 单元测试 —— 锁定「双形态保底 / 归一化 / 整体替换 / 装配」四条语义。
 */
class AnonymousAuthPropertiesTest {

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(AnonymousAuthAutoConfig.class));

    @Test
    void defaultEffectivePaths_containsLoginFallbackDualShapeAndFavicon() {
        AnonymousAuthProperties p = new AnonymousAuthProperties();
        Set<String> paths = p.effectivePaths();

        // 原始形态
        assertThat(paths).contains("/api/auth/login", "/api/auth/sso-login", "/api/auth/session",
                "/api/auth/mail-login", "/api/auth/mail-login/send-code",
                "/api/auth/forgot-password", "/api/auth/reset-password",
                "/login.html", "/sso-callback.html", "/favicon.ico");
        // 未配 context-path 时不生成带前缀形态
        assertThat(paths).doesNotContain("/activecode/api/auth/login");
        assertThat(paths).hasSize(11);
    }

    @Test
    void contextPath_generatesPrefixedShapeToo() {
        AnonymousAuthProperties p = new AnonymousAuthProperties();
        p.setContextPath("/activecode");
        Set<String> paths = p.effectivePaths();

        assertThat(paths).contains("/activecode/api/auth/login", "/activecode/login.html",
                "/activecode/sso-callback.html");
        // favicon 是根级服务，永不拼前缀
        assertThat(paths).contains("/favicon.ico");
        assertThat(paths).doesNotContain("/activecode/favicon.ico");
        // 原始形态仍在（nginx 剥前缀形态的应用靠它命中）
        assertThat(paths).contains("/api/auth/login");
    }

    @Test
    void contextPathNormalize() {
        assertThat(AnonymousAuthProperties.normalizeContextPath("/kb")).isEqualTo("/kb");
        assertThat(AnonymousAuthProperties.normalizeContextPath("kb")).isEqualTo("/kb");
        assertThat(AnonymousAuthProperties.normalizeContextPath("/kb/")).isEqualTo("/kb");
        assertThat(AnonymousAuthProperties.normalizeContextPath("  /ops  ")).isEqualTo("/ops");
        assertThat(AnonymousAuthProperties.normalizeContextPath("/")).isEmpty();
        assertThat(AnonymousAuthProperties.normalizeContextPath(null)).isEmpty();
        assertThat(AnonymousAuthProperties.normalizeContextPath("   ")).isEmpty();
    }

    @Test
    void ymlPaths_replaceSemantics_notMerge() {
        AnonymousAuthProperties p = new AnonymousAuthProperties();
        p.setPaths(List.of("/activecode/index.html", "/activecode/api/download/**"));
        Set<String> paths = p.effectivePaths();

        // 配置的 paths 全部在
        assertThat(paths).contains("/activecode/index.html", "/activecode/api/download/**");
        // 保底集仍在（不可清空）
        assertThat(paths).contains("/api/auth/login", "/favicon.ico");
        // 未配置的业务路径不在（整体替换：默认空集被替换，而非叠加旧默认）
        assertThat(paths).doesNotContain("/activecode/downloads.html");
    }

    @Test
    void fallbackModeNone_skipsSafetyNet() {
        AnonymousAuthProperties p = new AnonymousAuthProperties();
        p.setFallbackMode(AnonymousAuthProperties.FallbackMode.NONE);
        p.setPaths(List.of("/x/only"));
        Set<String> paths = p.effectivePaths();

        assertThat(paths).containsExactly("/x/only");
        assertThat(paths).doesNotContain("/api/auth/login", "/favicon.ico");
    }

    @Test
    void endpointMap_uppercasesAndSkipsInvalid() {
        AnonymousAuthProperties p = new AnonymousAuthProperties();
        p.setEndpoints(List.of(
                new AnonymousAuthProperties.Endpoint("/a/generate", Set.of("post")),
                new AnonymousAuthProperties.Endpoint("/a/verify", new LinkedHashSet<>(List.of("GET", "get"))),
                new AnonymousAuthProperties.Endpoint(null, Set.of("GET")),
                new AnonymousAuthProperties.Endpoint("/a/empty", Set.of())));

        Map<String, Set<String>> map = p.endpointMap();
        assertThat(map).containsOnlyKeys("/a/generate", "/a/verify");
        assertThat(map.get("/a/generate")).containsExactly("POST");
        assertThat(map.get("/a/verify")).containsExactly("GET");
    }

    @Test
    void springBinding_ymlReplaceAndFallbackMerge() {
        contextRunner.withPropertyValues(
                        "marschat.auth.anonymous.context-path=/portal",
                        "marschat.auth.anonymous.paths[0]=/portal/index.html",
                        "marschat.auth.anonymous.endpoints[0].path=/portal/api/activation/generate",
                        "marschat.auth.anonymous.endpoints[0].methods[0]=POST")
                .run(context -> {
                    assertThat(context).hasSingleBean(AnonymousAuthProperties.class);
                    AnonymousAuthProperties p = context.getBean(AnonymousAuthProperties.class);
                    assertThat(p.effectivePaths()).contains("/portal/index.html", "/portal/api/auth/login",
                            "/api/auth/login", "/favicon.ico");
                    assertThat(p.endpointMap()).containsEntry("/portal/api/activation/generate", Set.of("POST"));
                });
    }

    @Test
    void autoConfig_registersPropertiesBean() {
        contextRunner.run(context -> assertThat(context).hasSingleBean(AnonymousAuthProperties.class));
    }
}
