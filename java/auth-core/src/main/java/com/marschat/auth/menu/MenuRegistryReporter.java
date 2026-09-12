package com.marschat.auth.menu;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * 菜单上报器（Phase 4 P-B 打通）。
 *
 * <p>应用把 classpath 的 {@code menu-registry.yml} 原文启动时上报给 auth-center
 * {@code PUT /internal/clients/{client-id}/menus}（**全量覆盖**语义：中心以最后一次上报为准）。
 *
 * <p>凭据两种模式（{@code marschat.menu.report-mode}）：
 * <ul>
 *   <li>{@code secret}（默认）：header {@code X-Client-Secret}，对应
 *       {@code sys_app_client.client_secret}——应用身份直连，无需管理员 token（推荐）；</li>
 *   <li>{@code token}：header {@code Authorization: Bearer <marschat.menu.report-token>}，
 *       走 /admin/clients/** 管理端鉴权（兼容旧配置）。</li>
 * </ul>
 *
 * <p>失败仅 WARN：上报失败不阻断应用启动（下次重启重试；中心侧菜单缺失表现为
 * 授权界面少一棵树，不影响既有授权）。
 */
@Slf4j
public class MenuRegistryReporter implements ApplicationRunner {

    private final String issuer;
    private final String clientId;
    private final String reportToken;
    private final String reportSecret;
    private final String reportMode;
    private final boolean enabled;
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).build();

    public MenuRegistryReporter(String issuer, String clientId,
                                String reportToken, String reportSecret, String reportMode,
                                boolean enabled) {
        this.issuer = issuer == null ? "" : issuer.replaceAll("/+$", "");
        this.clientId = clientId;
        this.reportToken = reportToken;
        this.reportSecret = reportSecret;
        this.reportMode = reportMode == null ? "secret" : reportMode;
        this.enabled = enabled;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            return;
        }
        if (clientId == null || clientId.isBlank()) {
            log.warn("菜单上报已启用但缺 client-id，跳过");
            return;
        }
        boolean secretMode = !"token".equalsIgnoreCase(reportMode);
        String credential = secretMode ? reportSecret : reportToken;
        if (credential == null || credential.isBlank()) {
            log.warn("菜单上报已启用但缺 report-secret/report-token（mode={}），跳过", reportMode);
            return;
        }
        try {
            ClassPathResource resource = new ClassPathResource("menu-registry.yml");
            if (!resource.exists()) {
                log.info("无 menu-registry.yml，跳过菜单上报");
                return;
            }
            String yml = new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            String body = mapper.writeValueAsString(java.util.Map.of("menusYaml", yml));
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(issuer + "/internal/clients/" + clientId + "/menus"))
                    .timeout(Duration.ofSeconds(6))
                    .header("Content-Type", "application/json")
                    .PUT(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
            if (secretMode) {
                builder.header("X-Client-Secret", credential);
            } else {
                builder.header("Authorization", "Bearer " + credential)
                        .uri(URI.create(issuer + "/admin/clients/" + clientId + "/menus"));
            }
            HttpResponse<String> resp = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            JsonNode node = mapper.readTree(resp.body());
            if (node.path("code").asInt() == 200) {
                log.info("菜单上报成功: {} ({} bytes)", clientId, yml.length());
            } else {
                log.warn("菜单上报被拒: HTTP {} {}", resp.statusCode(), node.path("message").asText(""));
            }
        } catch (Exception e) {
            log.warn("菜单上报失败（不阻断启动）: {}", e.getMessage());
        }
    }
}
