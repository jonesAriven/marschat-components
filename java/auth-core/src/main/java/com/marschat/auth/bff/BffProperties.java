package com.marschat.auth.bff;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 统一认证中心 BFF（管理代理）配置 —— 应用侧「用户管理」页数据通道的**唯一配置面**。
 *
 * <p>设计目标（Phase 13 · 配置化接入）：新增应用接入用户管理**不再手写 300 行代理类**，
 * 只需在 {@code application.yml} 里写：
 * <pre>
 * marschat:
 *   bff:
 *     enabled: true
 *     client-id: marschat-&lt;新应用&gt;
 *     path-prefix: /api/admin            # 本应用暴露给前端的代理前缀
 *     credential-mode: passthrough       # 或 session-store / auto
 * </pre>
 * 再放一份 {@code bff-whitelist.yml}（默认拒绝）即可。其余（白名单匹配、HPP 加固、
 * fail-closed 401、状态码透传）全部由公共实现负责。
 *
 * <p><b>不配置 = 不装配</b>：{@code enabled} 默认 {@code false}，未显式打开时本模块
 * 不注册任何 Bean，对既有应用零影响。
 */
@ConfigurationProperties(prefix = "marschat.bff")
public class BffProperties {

    /** 是否启用管理代理（默认关闭；显式打开才装配）。 */
    private boolean enabled = false;

    /** 本应用在统一认证中心的 client_id（白名单作用域绑定，必填才生效）。 */
    private String clientId;

    /** 中心内网基址（默认 {@code 127.0.0.1:8085}；compose 网络可写 {@code http://auth-center:8085}）。 */
    private String authCenterBase = "http://127.0.0.1:8085";

    /**
     * 本应用对前端暴露的代理前缀（默认 {@code /api/admin}）。
     *
     * <p>实际转发路径 = {@link #centerPathPrefix} + （请求 URI 去掉本前缀后的剩余段）。
     * 例：前缀 {@code /api/admin} + 请求 {@code /infra/api/admin/users}
     * → 中心 {@code /admin/users}；前缀 {@code /admin} + 请求 {@code /kb-ops/admin/users}
     * → 中心 {@code /admin/users}。两种历史写法都能收敛到同一实现。
     */
    private String pathPrefix = "/api/admin";

    /** 中心侧管理端点前缀（默认 {@code /admin}，一般不改）。 */
    private String centerPathPrefix = "/admin";

    /** 凭据解析模式，见 {@link CredentialMode}。 */
    private CredentialMode credentialMode = CredentialMode.PASSTHROUGH;

    /**
     * 白名单文件位置（默认 {@code classpath:bff-whitelist.yml}）。
     * 支持 {@code classpath:} 与 {@code file:} 前缀；文件缺失 = 空白名单 = **全部拒绝**。
     */
    private String whitelistLocation = "classpath:bff-whitelist.yml";

    /** 连接中心超时（毫秒）。 */
    private int connectTimeoutMs = 5000;

    /** 单次代理请求超时（毫秒）。 */
    private int requestTimeoutMs = 10000;

    /** 账号上报凭据（{@code X-Client-Secret}，与菜单上报同值）；缺省时上报静默跳过。 */
    private String reportSecret;

    /** 本地账号上报开关（默认开启；无 {@link BffAccountSource} Bean 时自动跳过）。 */
    private boolean accountReportEnabled = true;

    /**
     * 凭据解析模式 —— 把历史上三份手写实现的行为差异收敛为配置项。
     */
    public enum CredentialMode {
        /**
         * 直接透传调用者的 {@code Authorization} 头。
         * 适用于纯 SSO 应用（浏览器持有的就是中心 OIDC token）。
         */
        PASSTHROUGH,

        /**
         * 忽略 {@code Authorization}，改从 {@link CenterSessionStore} 按当前用户名取中心令牌。
         * 适用于账密 / 邮箱码登录后由服务端换票的应用。
         */
        SESSION_STORE,

        /**
         * 两者兼容：先判断调用者 token 是否为本应用自签（经 {@link BffLocalTokenClassifier}），
         * 非自签则直接用（SSO 会话），是自签则回落 {@link CenterSessionStore}（账密会话）。
         * 未提供 {@code BffLocalTokenClassifier} Bean 时退化为 {@link #PASSTHROUGH}。
         */
        AUTO
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getClientId() {
        return clientId;
    }

    public void setClientId(String clientId) {
        this.clientId = clientId;
    }

    public String getAuthCenterBase() {
        return authCenterBase;
    }

    public void setAuthCenterBase(String authCenterBase) {
        this.authCenterBase = authCenterBase;
    }

    public String getPathPrefix() {
        return pathPrefix;
    }

    public void setPathPrefix(String pathPrefix) {
        this.pathPrefix = pathPrefix;
    }

    public String getCenterPathPrefix() {
        return centerPathPrefix;
    }

    public void setCenterPathPrefix(String centerPathPrefix) {
        this.centerPathPrefix = centerPathPrefix;
    }

    public CredentialMode getCredentialMode() {
        return credentialMode;
    }

    public void setCredentialMode(CredentialMode credentialMode) {
        this.credentialMode = credentialMode;
    }

    public String getWhitelistLocation() {
        return whitelistLocation;
    }

    public void setWhitelistLocation(String whitelistLocation) {
        this.whitelistLocation = whitelistLocation;
    }

    public int getConnectTimeoutMs() {
        return connectTimeoutMs;
    }

    public void setConnectTimeoutMs(int connectTimeoutMs) {
        this.connectTimeoutMs = connectTimeoutMs;
    }

    public int getRequestTimeoutMs() {
        return requestTimeoutMs;
    }

    public void setRequestTimeoutMs(int requestTimeoutMs) {
        this.requestTimeoutMs = requestTimeoutMs;
    }

    public String getReportSecret() {
        return reportSecret;
    }

    public void setReportSecret(String reportSecret) {
        this.reportSecret = reportSecret;
    }

    public boolean isAccountReportEnabled() {
        return accountReportEnabled;
    }

    public void setAccountReportEnabled(boolean accountReportEnabled) {
        this.accountReportEnabled = accountReportEnabled;
    }
}
