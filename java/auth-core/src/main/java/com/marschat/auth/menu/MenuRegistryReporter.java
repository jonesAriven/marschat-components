package com.marschat.auth.menu;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
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
 * 菜单上报器（Phase 2 交付物 · 上报开关默认关，Phase 4 打开）。
 *
 * <p>应用把 classpath 的 {@code menu-registry.yml} 原文启动时上报给 auth-center
 * {@code PUT /admin/clients/{client-id}/menus}（**全量覆盖**语义：中心以最后一次上报为准）。
 * 需要服务账号凭据（client_credentials 或专用上报 token）——第一版用
 * {@code marschat.menu.report-token}（管理员 token，运维配置）。
 *
 * <p>失败仅 WARN：上报失败不阻断应用启动（下次重启重试；中心侧菜单缺失表现为
 * 授权界面少一棵树，不影响既有授权）。
 */
@Slf4j
public class MenuRegistryReporter implements ApplicationRunner {

    private final String issuer;
    private final String clientId;
    private final String reportToken;
    private final boolean enabled;
    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).build();

    public MenuRegistryReporter(String issuer, String clientId, String reportToken, boolean enabled) {
        this.issuer = issuer == null ? "" : issuer.replaceAll("/+$", "");
        this.clientId = clientId;
        this.reportToken = reportToken;
        this.enabled = enabled;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            return;
        }
        if (clientId == null || clientId.isBlank() || reportToken == null || reportToken.isBlank()) {
            log.warn("菜单上报已启用但缺 client-id/report-token，跳过");
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
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(issuer + "/admin/clients/" + clientId + "/menus"))
                    .timeout(Duration.ofSeconds(6))
                    .header("Authorization", "Bearer " + reportToken)
                    .header("Content-Type", "application/json")
                    .PUT(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
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
