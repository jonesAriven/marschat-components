package com.marschat.auth.bff;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 本地账号上报器（**公共实现**）—— 启动时把应用本地账号全量登记到中心
 * {@code app_account_mapping}，使「该应用有哪些账号」在中心一处可见。
 *
 * <p>上报契约（与中心 {@code /internal/clients/{id}/accounts} 一致）：
 * <pre>
 * PUT {authCenterBase}/internal/clients/{clientId}/accounts
 * X-Client-Secret: {reportSecret}
 * {"accounts":[{"account":"xxx","name":"显示名"}]}
 * </pre>
 *
 * <p><b>降级口径</b>（与既有实现一致）：凭据缺失只 WARN、异常只 WARN，**不阻断启动**。
 * 故「没报错」不代表上报成功，须核对中心侧映射。
 *
 * <p><b>已知边界</b>：仅启动时执行 —— 运行期新建的本地账号需重启才登记。
 */
@Order(Ordered.LOWEST_PRECEDENCE)
public class MarschatBffAccountReporter implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(MarschatBffAccountReporter.class);

    private final BffProperties properties;
    private final BffAccountSource accountSource;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MarschatBffAccountReporter(BffProperties properties, BffAccountSource accountSource) {
        this.properties = properties;
        this.accountSource = accountSource;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!properties.isAccountReportEnabled()) {
            return;
        }
        String clientId = properties.getClientId();
        if (clientId == null || clientId.isBlank()) {
            log.warn("[账号上报] 未配置 marschat.bff.client-id，跳过");
            return;
        }
        String secret = properties.getReportSecret();
        if (secret == null || secret.isBlank()) {
            log.warn("[账号上报] 未配置 marschat.bff.report-secret，跳过（本地账号未登记到中心）");
            return;
        }
        List<BffAccountSource.BffLocalAccount> accounts;
        try {
            accounts = accountSource.localAccounts();
        } catch (Exception e) {
            log.warn("[账号上报] 读取本地账号失败（不阻断启动）：{}", e.getMessage());
            return;
        }
        if (accounts == null || accounts.isEmpty()) {
            log.info("[账号上报] 本应用无本地账号，跳过");
            return;
        }

        List<Map<String, Object>> rows = new ArrayList<>();
        for (BffAccountSource.BffLocalAccount account : accounts) {
            if (account == null || account.account() == null || account.account().isBlank()) {
                continue;
            }
            rows.add(Map.of(
                    "account", account.account(),
                    "name", account.name() == null ? account.account() : account.name()));
        }
        if (rows.isEmpty()) {
            log.info("[账号上报] 本地账号均无效，跳过");
            return;
        }

        try {
            String body = objectMapper.writeValueAsString(Map.of("accounts", rows));
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofMillis(properties.getConnectTimeoutMs()))
                    .build();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(trimTrailingSlash(properties.getAuthCenterBase())
                            + "/internal/clients/" + clientId + "/accounts"))
                    .timeout(Duration.ofMillis(properties.getRequestTimeoutMs()))
                    .header("Content-Type", "application/json")
                    .header("X-Client-Secret", secret)
                    .PUT(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> response = client.send(request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() == 200) {
                log.info("[账号上报] 成功：{} 个本地账号已登记（{}）", rows.size(), response.body());
            } else {
                log.warn("[账号上报] 失败 HTTP {}：{}", response.statusCode(), response.body());
            }
        } catch (Exception e) {
            log.warn("[账号上报] 异常（不阻断启动）：{}", e.getMessage());
        }
    }

    private static String trimTrailingSlash(String s) {
        if (s == null) {
            return "";
        }
        String out = s;
        while (out.length() > 1 && out.endsWith("/")) {
            out = out.substring(0, out.length() - 1);
        }
        return out;
    }
}
