package com.marschat.auth.menu;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * 菜单上报自动装配（Phase 4 P-B）。
 *
 * <p>启用条件：{@code marschat.menu.report.enabled=true}（默认关闭——未显式打开不装配，
 * 与「上报开关默认关」的 Phase 2 口径一致）。
 * 必须配置 {@code marschat.menu.report.client-id} 与凭据（{@code report-secret} 优先，
 * 兼容旧 {@code report-token}），缺凭据时 reporter 内部跳过并 WARN。
 *
 * <p>本配置类无 Web 依赖（纯 ApplicationRunner + java.net.http），无需 Web 类型条件；
 * 无 @Bean 撞名风险（§18.5 审计口径：bean 名 marschatMenuRegistryReporter 全库唯一）。
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "marschat.menu.report", name = "enabled", havingValue = "true")
public class MenuReportAutoConfig {

    @Bean
    @ConfigurationProperties(prefix = "marschat.menu.report")
    @ConditionalOnMissingBean
    public MenuReportProperties menuReportProperties() {
        return new MenuReportProperties();
    }

    @Bean
    @ConditionalOnMissingBean
    public MenuRegistryReporter marschatMenuRegistryReporter(MenuReportProperties props) {
        return new MenuRegistryReporter(props.getIssuer(), props.getClientId(),
                props.getReportToken(), props.getReportSecret(), props.getReportMode(),
                props.isEnabled());
    }

    /** 菜单上报配置项。 */
    @ConfigurationProperties(prefix = "marschat.menu.report")
    public static class MenuReportProperties {
        /** 是否启用启动上报（默认 false，显式打开）。 */
        private boolean enabled = false;

        /** auth-center 基址（默认与应用验签 issuer 一致）。 */
        private String issuer = "https://auth.marschat.online";

        /** 本应用 client_id（必填才生效）。 */
        private String clientId;

        /** 上报凭据模式：secret（默认，X-Client-Secret 直连内部端点）/ token（管理员 Bearer）。 */
        private String reportMode = "secret";

        /** secret 模式凭据：与 sys_app_client.client_secret 一致。 */
        private String reportSecret;

        /** token 模式凭据（兼容旧配置）：管理员 token。 */
        private String reportToken;

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getIssuer() { return issuer; }
        public void setIssuer(String issuer) { this.issuer = issuer; }
        public String getClientId() { return clientId; }
        public void setClientId(String clientId) { this.clientId = clientId; }
        public String getReportMode() { return reportMode; }
        public void setReportMode(String reportMode) { this.reportMode = reportMode; }
        public String getReportSecret() { return reportSecret; }
        public void setReportSecret(String reportSecret) { this.reportSecret = reportSecret; }
        public String getReportToken() { return reportToken; }
        public void setReportToken(String reportToken) { this.reportToken = reportToken; }
    }
}
