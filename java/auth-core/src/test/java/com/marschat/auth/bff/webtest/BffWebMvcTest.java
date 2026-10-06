package com.marschat.auth.bff.webtest;

import com.marschat.auth.bff.MarschatBffAutoConfig;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * BFF 管理代理的**真实 MVC 链路**测试 —— 证明「配置化接入」端到端成立：
 * 只写 {@code application.yml} 几行 + 一份 {@code bff-whitelist.yml}，
 * 就能得到正确的路径映射、白名单拦截与 fail-closed 401。
 *
 * <p>本测试刻意验证的是**自动化配置无法覆盖的部分**：{@code @RequestMapping} 里的
 * {@code ${marschat.bff.path-prefix}} 占位是否真被解析（否则整条代理会静默 404）。
 */
@SpringBootTest(
        classes = BffWebMvcTest.TestApp.class,
        webEnvironment = SpringBootTest.WebEnvironment.MOCK,
        properties = {
                // TokenProvider 初始化所需（与 BFF 无关，仅为让上下文起来）
                "marschat.auth.secret=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                // BFF 配置：这就是「新增应用接入用户管理」要写的全部后端配置
                "marschat.bff.enabled=true",
                "marschat.bff.client-id=marschat-demo",
                "marschat.bff.path-prefix=/api/admin",
                "marschat.bff.whitelist-location=classpath:bff-whitelist-test.yml",
                // 故意指向不可达端口，用于验证「转发链路已打通」（应得 502 而非 404/401）
                "marschat.bff.auth-center-base=http://127.0.0.1:1",
                "marschat.bff.connect-timeout-ms=300",
                "marschat.bff.request-timeout-ms=300",
                "marschat.oidc.jwks-uri=http://127.0.0.1:1/oauth2/jwks"
        })
@AutoConfigureMockMvc
class BffWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("占位解析生效：/api/admin/** 已注册（非白名单路径返回 404 而非 404-by-no-mapping 之外的状态）")
    void pathPrefixPlaceholderResolves() throws Exception {
        // 若 ${marschat.bff.path-prefix} 未被解析，此处会因「无映射」返回 404，
        // 但响应体不会是我们自定义的 JSON 信封；用 JSON 断言区分两种情况。
        mockMvc.perform(get("/api/admin/not-registered"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(404));
    }

    @Test
    @DisplayName("白名单外路径 → 404（不转发、不泄漏）")
    void nonWhitelistedPathIs404() throws Exception {
        mockMvc.perform(post("/api/admin/users"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("接口不存在"));
    }

    @Test
    @DisplayName("越界 client（路径段）→ 404")
    void otherClientInPathIs404() throws Exception {
        mockMvc.perform(get("/api/admin/clients/marschat-other/members"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("越界 client（查询参数）→ 404")
    void otherClientInQueryIs404() throws Exception {
        mockMvc.perform(get("/api/admin/users").param("client", "marschat-other"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("白名单内 + 无凭据 → 401 fail-closed（绝不服务账号兜底）")
    void whitelistedWithoutCredentialIs401() throws Exception {
        mockMvc.perform(get("/api/admin/roles"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(401));
    }

    @Test
    @DisplayName("白名单内 + 有凭据 → 转发链路打通（中心不可达得 502）")
    void whitelistedWithCredentialReachesForwarding() throws Exception {
        mockMvc.perform(get("/api/admin/roles").header("Authorization", "Bearer some-token"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value(502));
    }

    @Test
    @DisplayName("本应用 client 作用域端点放行：/api/admin/clients/{本应用}/**")
    void ownClientInPathAllowed() throws Exception {
        mockMvc.perform(get("/api/admin/clients/marschat-demo/members")
                        .header("Authorization", "Bearer some-token"))
                .andExpect(status().isBadGateway());
    }

    /** 测试专用最小应用（不扫描业务包，避免把被测组件重复注册）。 */
    @SpringBootApplication
    @ImportAutoConfiguration(MarschatBffAutoConfig.class)
    static class TestApp {
    }
}
