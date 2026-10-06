package com.marschat.auth.bff;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * 统一认证中心 {@code /admin/**} 的 BFF 管理代理（**公共实现**，Phase 13 收敛）。
 *
 * <h3>为什么需要它</h3>
 * 账密登录统一到认证中心后，应用会话持有的只是**本应用自签 token**，它调不动中心
 * {@code /admin/**}；而「用户管理」页需要以中心身份访问该接口。改造前前端直连
 * {@code auth.marschat.online/admin/**}，账密会话下必然 401 → 401 拦截器触发静默重授权
 * → **点一下「用户管理」就跳 IdP 登录页**。本代理把请求改为同源，由本服务以
 * **用户本人持有的中心 token** 转发。
 *
 * <h3>与三份手写实现的关系</h3>
 * 本类取代 kb-ops / infra-monitor / activecode 各一份的 {@code AdminProxyController}
 * （266 ~ 297 行）。三者在「白名单」上语义一致但各写一遍、在「凭据解析」上**已经分叉**；
 * 现全部收敛为配置：{@code marschat.bff.credential-mode} + {@code bff-whitelist.yml}。
 *
 * <h3>安全不变式（务必保持，改动需评审）</h3>
 * <ul>
 *   <li><b>默认拒绝</b>：白名单未命中一律 {@code 404}，且**在取凭据之前**判定
 *       —— 不泄漏路径存在性、不转发、不做任何中心调用。</li>
 *   <li><b>绝不服务账号兜底</b>：只转发调用方自己的 token；拿不到 → {@code 401}
 *       （fail-closed），交由前端走正常重授权。历史提权事故即源于「无会话时回退服务账号」。</li>
 *   <li><b>client 越界防护</b>：{@code ?client=} 与路径中的 {@code {clientId}} 都必须等于本应用，
 *       且重复 {@code client} 键（参数污染）一律拒绝。</li>
 *   <li><b>角色判定不在此做</b>：中心返回什么状态就透传什么（非管理员 403 / token 过期 401），
 *       避免两处真源不一致。</li>
 *   <li><b>只代理管理面</b>：中心的 {@code /internal/**}（带 secret 的上报通道）与
 *       {@code /auth/**} 不在白名单表达范围内，永不被暴露。</li>
 * </ul>
 */
@RestController
public class MarschatBffAdminProxyController {

    private static final Logger log = LoggerFactory.getLogger(MarschatBffAdminProxyController.class);

    private final BffProperties properties;
    private final BffWhitelist whitelist;
    private final BffCredentialResolver credentialResolver;
    private final HttpClient httpClient;

    public MarschatBffAdminProxyController(BffProperties properties,
                                           BffWhitelist whitelist,
                                           BffCredentialResolver credentialResolver) {
        this.properties = properties;
        this.whitelist = whitelist;
        this.credentialResolver = credentialResolver;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(properties.getConnectTimeoutMs()))
                .build();
    }

    /**
     * 代理中心管理端点。
     *
     * <p>例：前缀 {@code /api/admin} + 请求 {@code /infra/api/admin/users?client=marschat-inframon}
     * → 中心 {@code /admin/users?client=marschat-inframon}。
     */
    @RequestMapping("${marschat.bff.path-prefix:/api/admin}/**")
    public ResponseEntity<String> proxyAdmin(HttpServletRequest request,
                                            @RequestBody(required = false) String body) {
        String method = request.getMethod();
        String pathOnly = centerPathOnly(request);

        // ① 白名单（默认拒绝）—— 必须早于取凭据。
        //    作用域校验取 request.getParameterValues("client") 而非仅原始查询串：
        //    真实容器里它已合并查询串与表单体，可堵住「校验看查询串、转发带上表单体」的旁路。
        if (!whitelist.isAllowed(method, pathOnly, request.getQueryString(),
                request.getParameterValues("client"), properties.getClientId())) {
            log.warn("管理代理拒绝非白名单路径（{} {}）", method, pathOnly);
            return json(404, "{\"code\":404,\"message\":\"接口不存在\",\"data\":null}");
        }

        // ② 凭据（fail-closed，绝不服务账号兜底）
        String centerToken = credentialResolver.resolve(request);
        if (centerToken == null || centerToken.isBlank()) {
            return json(401, "{\"code\":401,\"message\":\"无统一认证中心凭据，请重新登录\",\"data\":null}");
        }

        // ③ 转发（方法 / 查询串 / 请求体原样，状态码与响应体原样透传）
        String centerPath = centerPathWithQuery(request);
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                    .uri(URI.create(trimTrailingSlash(properties.getAuthCenterBase()) + centerPath))
                    .header("Authorization", "Bearer " + centerToken)
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofMillis(properties.getRequestTimeoutMs()));
            switch (method.toUpperCase()) {
                case "POST" -> builder.POST(HttpRequest.BodyPublishers.ofString(
                        body == null ? "" : body, StandardCharsets.UTF_8));
                case "PUT" -> builder.PUT(HttpRequest.BodyPublishers.ofString(
                        body == null ? "" : body, StandardCharsets.UTF_8));
                case "DELETE" -> builder.DELETE();
                default -> builder.GET();
            }
            HttpResponse<String> response = httpClient.send(builder.build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return ResponseEntity.status(response.statusCode())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(response.body());
        } catch (Exception e) {
            log.warn("认证中心管理代理失败（{} {}）: {}", method, centerPath, e.getMessage());
            return json(502, "{\"code\":502,\"message\":\"认证中心不可达，请稍后重试\",\"data\":null}");
        }
    }

    /**
     * 请求 URI → 中心路径（**不含**查询串，去尾部斜杠），用于白名单匹配。
     *
     * <p>用 {@code indexOf(pathPrefix)} 而非按 context-path 长度裁剪：后者在反代改写
     * （nginx 把 {@code /infra/api/} 映射到 {@code /infra/}）时会切错位置。
     */
    private String centerPathOnly(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String prefix = properties.getPathPrefix();
        int idx = uri.indexOf(prefix);
        String remainder = idx >= 0 ? uri.substring(idx + prefix.length()) : "";
        String path = trimTrailingSlash(properties.getCenterPathPrefix()) + remainder;
        while (path.length() > 1 && path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }
        return path;
    }

    /** 中心路径 + 原样查询串。 */
    private String centerPathWithQuery(HttpServletRequest request) {
        String path = centerPathOnly(request);
        String qs = request.getQueryString();
        return (qs == null || qs.isBlank()) ? path : path + "?" + qs;
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

    private ResponseEntity<String> json(int status, String body) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body);
    }
}
