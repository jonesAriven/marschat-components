package com.marschat.auth.bff;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * 统一认证 BFF（管理代理）自动装配 —— **新增应用接入用户管理的唯一入口**。
 *
 * <p>启用方式（应用侧只需配置，不写代码）：
 * <pre>
 * marschat:
 *   bff:
 *     enabled: true
 *     client-id: marschat-&lt;新应用&gt;
 *     auth-center-base: http://auth-center:8085
 *     path-prefix: /api/admin
 *     credential-mode: passthrough
 * </pre>
 * 外加一份 classpath {@code bff-whitelist.yml}。装配后即可获得：
 * 白名单校验（默认拒绝）· 凭据解析（三模式）· fail-closed 401 · 状态码透传 · 本地账号上报。
 *
 * <h3>条件装配（三条，缺一不生效）</h3>
 * <ol>
 *   <li>{@code marschat.bff.enabled=true}（**默认 false**，未显式打开对既有应用零影响）；</li>
 *   <li>类路径存在 Servlet（{@code jakarta.servlet.http.HttpServletRequest}）—— WebFlux 应用不装配；</li>
 *   <li>应用未自带同类型 Bean（{@code @ConditionalOnMissingBean}）—— 便于灰度期覆盖。</li>
 * </ol>
 *
 * <h3>Bean 命名（重要）</h3>
 * 全部 Bean 方法名带 {@code marschatBff} 前缀。原因：{@code @ConditionalOnMissingBean} **只按类型匹配**，
 * 挡不住「异类型同名」—— 应用自带 {@code @Component CenterSessionStore} 时，
 * 通用名 {@code centerSessionStore} 会撞车抛 {@code BeanDefinitionOverrideException} 启动 crash-loop。
 * 加库前缀是公共库的硬性约定。
 *
 * <h3>灰度迁移口径</h3>
 * 应用启用本装配前，应先删除自家的 {@code AdminProxyController} / {@code CenterSessionStore} /
 * {@code LocalAccountReporter} 三个类，并把原硬编码白名单改写为 {@code bff-whitelist.yml}。
 * 未迁移的应用保持 {@code enabled=false}（缺省），行为完全不变。
 */
@AutoConfiguration
@ConditionalOnClass(name = "jakarta.servlet.http.HttpServletRequest")
@ConditionalOnProperty(prefix = "marschat.bff", name = "enabled", havingValue = "true")
@EnableConfigurationProperties(BffProperties.class)
public class MarschatBffAutoConfig {

    /** 白名单：从 {@code marschat.bff.whitelist-location} 读取；文件缺失 = 空白名单 = 全部拒绝。 */
    @Bean
    @ConditionalOnMissingBean(BffWhitelist.class)
    public BffWhitelist marschatBffWhitelist(BffProperties properties) {
        return new BffWhitelistLoader().load(properties.getWhitelistLocation());
    }

    /** 中心会话存储：默认进程内存实现；应用提供 Redis 实现即可覆盖。 */
    @Bean
    @ConditionalOnMissingBean(CenterSessionStore.class)
    public CenterSessionStore marschatCenterSessionStore() {
        return new InMemoryCenterSessionStore();
    }

    /** 凭据解析器：按 {@code credential-mode} 选择行为；应用可提供自定义 Bean 覆盖。 */
    @Bean
    @ConditionalOnMissingBean(BffCredentialResolver.class)
    public BffCredentialResolver marschatBffCredentialResolver(
            BffProperties properties,
            CenterSessionStore marschatCenterSessionStore,
            ObjectProvider<BffLocalTokenClassifier> localTokenClassifier) {
        return new DefaultBffCredentialResolver(
                properties.getCredentialMode(),
                marschatCenterSessionStore,
                localTokenClassifier.getIfAvailable());
    }

    /** 管理代理控制器。 */
    @Bean
    @ConditionalOnMissingBean(MarschatBffAdminProxyController.class)
    public MarschatBffAdminProxyController marschatBffAdminProxyController(
            BffProperties properties,
            BffWhitelist marschatBffWhitelist,
            BffCredentialResolver marschatBffCredentialResolver) {
        return new MarschatBffAdminProxyController(
                properties, marschatBffWhitelist, marschatBffCredentialResolver);
    }

    /**
     * 本地账号上报器 —— **仅当应用提供了 {@link BffAccountSource} Bean 时装配**。
     * 纯 SSO 应用（无本地账号）不必提供，自然不装配。
     */
    @Bean
    @ConditionalOnBean(BffAccountSource.class)
    @ConditionalOnMissingBean(MarschatBffAccountReporter.class)
    public MarschatBffAccountReporter marschatBffAccountReporter(
            BffProperties properties, BffAccountSource bffAccountSource) {
        return new MarschatBffAccountReporter(properties, bffAccountSource);
    }
}
