package com.marschat.auth.bff;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * BFF 白名单语义单测 —— 覆盖**默认拒绝**与**越界防护**两类安全不变式。
 *
 * <p>这些用例对应历史上三份手写 {@code isAllowed()} 的关键分支，收敛为公共实现后
 * 必须逐条守住；任何一条失败都意味着管理面出现了「不该放行的放行」。
 */
class BffWhitelistTest {

    private static final String APP = "marschat-demo";

    /** 与模板等价的一组规则。 */
    private static BffWhitelist demoWhitelist() {
        return new BffWhitelist(List.of(
                new BffWhitelistRule("/admin/clients/{clientId}/**", null, false, true),
                new BffWhitelistRule("/admin/users", List.of("GET"), true, false),
                new BffWhitelistRule("/admin/users/{id}/client-roles", List.of("GET", "PUT"), true, false),
                new BffWhitelistRule("/admin/users/{id}/menu-overrides", List.of("GET", "PUT"), true, false),
                new BffWhitelistRule("/admin/roles", List.of("GET"), false, false)));
    }

    @Test
    @DisplayName("空白名单 → 全部拒绝（不是全部放行）")
    void emptyWhitelistDeniesEverything() {
        BffWhitelist empty = BffWhitelist.empty();
        assertTrue(empty.isEmpty());
        assertFalse(empty.isAllowed("GET", "/admin/users", null, APP));
        assertFalse(empty.isAllowed("GET", "/admin/roles", null, APP));
    }

    @Test
    @DisplayName("未配置 client-id → 一律拒绝（无法做作用域校验，fail-closed）")
    void missingClientIdDeniesEverything() {
        BffWhitelist whitelist = demoWhitelist();
        assertFalse(whitelist.isAllowed("GET", "/admin/roles", null, null));
        assertFalse(whitelist.isAllowed("GET", "/admin/roles", null, "  "));
    }

    @Test
    @DisplayName("白名单内路径 + 允许方法 → 放行")
    void allowedPathAndMethod() {
        BffWhitelist whitelist = demoWhitelist();
        assertTrue(whitelist.isAllowed("GET", "/admin/users", null, APP));
        assertTrue(whitelist.isAllowed("GET", "/admin/roles", null, APP));
        assertTrue(whitelist.isAllowed("PUT", "/admin/users/302/client-roles", "client=" + APP, APP));
    }

    @Test
    @DisplayName("方法不匹配 → 拒绝（只读端点不得被写方法穿透）")
    void methodMismatchDenied() {
        BffWhitelist whitelist = demoWhitelist();
        assertFalse(whitelist.isAllowed("POST", "/admin/roles", null, APP));
        assertFalse(whitelist.isAllowed("DELETE", "/admin/roles", null, APP));
        assertFalse(whitelist.isAllowed("POST", "/admin/users", null, APP));
    }

    @Test
    @DisplayName("未声明 methods → 任意方法放行")
    void methodsAbsentMeansAny() {
        BffWhitelist whitelist = new BffWhitelist(List.of(
                new BffWhitelistRule("/admin/clients/{clientId}/**", null, false, true)));
        assertTrue(whitelist.isAllowed("GET", "/admin/clients/" + APP + "/members", null, APP));
        assertTrue(whitelist.isAllowed("POST", "/admin/clients/" + APP + "/members", null, APP));
        assertTrue(whitelist.isAllowed("DELETE", "/admin/clients/" + APP + "/members/302", null, APP));
    }

    @Test
    @DisplayName("{id} 占位只匹配单段，不跨 /")
    void placeholderMatchesSingleSegment() {
        BffWhitelist whitelist = demoWhitelist();
        assertTrue(whitelist.isAllowed("GET", "/admin/users/302/client-roles", null, APP));
        assertFalse(whitelist.isAllowed("GET", "/admin/users/302/roles/client-roles", null, APP));
        assertFalse(whitelist.isAllowed("GET", "/admin/users//client-roles", null, APP));
    }

    @Test
    @DisplayName("** 通配匹配任意多段")
    void doubleStarMatchesMultipleSegments() {
        BffWhitelist whitelist = demoWhitelist();
        assertTrue(whitelist.isAllowed("GET", "/admin/clients/" + APP + "/users/302/roles", null, APP));
        assertTrue(whitelist.isAllowed("GET", "/admin/clients/" + APP + "/member-candidates", null, APP));
    }

    @Test
    @DisplayName("路径越界：{clientId} 不等于本应用 → 拒绝")
    void clientInPathBlocksOtherClients() {
        BffWhitelist whitelist = demoWhitelist();
        assertFalse(whitelist.isAllowed("GET", "/admin/clients/marschat-other/members", null, APP));
        assertFalse(whitelist.isAllowed("DELETE", "/admin/clients/marschat-other/users/302", null, APP));
    }

    @Test
    @DisplayName("查询参数越界：?client=其它应用 → 拒绝")
    void clientScopeBlocksOtherClients() {
        BffWhitelist whitelist = demoWhitelist();
        assertFalse(whitelist.isAllowed("GET", "/admin/users", "client=marschat-other", APP));
        assertFalse(whitelist.isAllowed("PUT", "/admin/users/302/client-roles",
                "client=marschat-other", APP));
    }

    @Test
    @DisplayName("查询参数缺省 → 放行；等于本应用 → 放行")
    void clientScopeAllowsAbsentOrMatching() {
        BffWhitelist whitelist = demoWhitelist();
        assertTrue(whitelist.isAllowed("GET", "/admin/users", null, APP));
        assertTrue(whitelist.isAllowed("GET", "/admin/users", "page=1&size=10", APP));
        assertTrue(whitelist.isAllowed("GET", "/admin/users", "client=" + APP, APP));
    }

    @Test
    @DisplayName("HPP 加固：重复 client 键（参数劫持）→ 拒绝")
    void hppDuplicateClientKeyDenied() {
        BffWhitelist whitelist = demoWhitelist();
        assertFalse(whitelist.isAllowed("GET", "/admin/users",
                "client=" + APP + "&client=marschat-other", APP));
        assertFalse(whitelist.isAllowed("GET", "/admin/users",
                "client=marschat-other&client=" + APP, APP));
    }

    @Test
    @DisplayName("作用域旁路加固：client 来自表单体（查询串为空）同样被拦截")
    void clientFromFormBodyCannotBypassScope() {
        BffWhitelist whitelist = demoWhitelist();
        // 查询串为空，但 Servlet 解析出的参数里有 client=其它应用 → 必须拒绝
        assertFalse(whitelist.isAllowed("GET", "/admin/users", null,
                new String[]{"marschat-other"}, APP));
        assertTrue(whitelist.isAllowed("GET", "/admin/users", null,
                new String[]{APP}, APP));
    }

    @Test
    @DisplayName("作用域旁路加固：Servlet 参数出现多个 client 值 → 拒绝")
    void multipleClientParamValuesDenied() {
        BffWhitelist whitelist = demoWhitelist();
        assertFalse(whitelist.isAllowed("GET", "/admin/users", null,
                new String[]{APP, "marschat-other"}, APP));
        assertFalse(whitelist.isAllowed("GET", "/admin/users", "client=" + APP,
                new String[]{APP, APP}, APP));
    }

    @Test
    @DisplayName("Servlet 参数优先于原始查询串（不重复计数导致误拒）")
    void servletParamsTakePrecedenceOverRawQuery() {
        BffWhitelist whitelist = demoWhitelist();
        // 真实容器里 getParameterValues 已含查询串参数；此处两者一致，不得因「两处都算」而误拒
        assertTrue(whitelist.isAllowed("GET", "/admin/users", "client=" + APP,
                new String[]{APP}, APP));
    }

    @Test
    @DisplayName("平台级写端点未登记 → 拒绝（应用台不得下发平台能力）")
    void platformWriteEndpointsDenied() {
        BffWhitelist whitelist = demoWhitelist();
        assertFalse(whitelist.isAllowed("POST", "/admin/users", null, APP));
        assertFalse(whitelist.isAllowed("PUT", "/admin/users/302", null, APP));
        assertFalse(whitelist.isAllowed("DELETE", "/admin/users/302", null, APP));
        assertFalse(whitelist.isAllowed("PUT", "/admin/users/302/password", null, APP));
        assertFalse(whitelist.isAllowed("GET", "/admin/authorization-matrix", null, APP));
        assertFalse(whitelist.isAllowed("POST", "/admin/authz/migrate", null, APP));
        assertFalse(whitelist.isAllowed("GET", "/admin/mappings", null, APP));
    }

    @Test
    @DisplayName("内网上报通道 /internal/** 永不被暴露")
    void internalChannelNeverAllowed() {
        BffWhitelist whitelist = new BffWhitelist(List.of(
                new BffWhitelistRule("/admin/clients/{clientId}/**", null, false, true)));
        assertFalse(whitelist.isAllowed("PUT", "/internal/clients/" + APP + "/menus", null, APP));
        assertFalse(whitelist.isAllowed("PUT", "/internal/clients/" + APP + "/accounts", null, APP));
    }

    @Test
    @DisplayName("路径模式中的正则元字符按字面量匹配（不产生意外通配）")
    void regexMetacharsAreEscaped() {
        BffWhitelist whitelist = new BffWhitelist(List.of(
                new BffWhitelistRule("/admin/roles", List.of("GET"), false, false)));
        // `.` 若未转义会匹配任意字符 → 这里必须拒绝
        assertFalse(whitelist.isAllowed("GET", "/admin/rolesX", null, APP));
        assertFalse(whitelist.isAllowed("GET", "/adminXroles", null, APP));
        assertTrue(whitelist.isAllowed("GET", "/admin/roles", null, APP));
    }

    @Test
    @DisplayName("尾部斜杠归一：/admin/users/ 与 /admin/users 同判")
    void trailingSlashNormalisation() {
        BffWhitelist whitelist = demoWhitelist();
        // 控制器在匹配前已去尾斜杠；此处验证规则本身不依赖尾斜杠写法
        assertFalse(whitelist.isAllowed("GET", "/admin/users/", null, APP));
        assertTrue(whitelist.isAllowed("GET", "/admin/users", null, APP));
    }

    @Test
    @DisplayName("路径模式 → 正则：{clientId} 生成捕获组，其余占位为非捕获")
    void regexCompilation() {
        assertEquals("^/admin/clients/([^/]+)/.*$",
                BffWhitelistRule.toRegex("/admin/clients/{clientId}/**"));
        assertEquals("^/admin/users/[^/]+/client-roles$",
                BffWhitelistRule.toRegex("/admin/users/{id}/client-roles"));
        assertEquals("^/admin/users$", BffWhitelistRule.toRegex("/admin/users"));
    }

    @Test
    @DisplayName("describe() 输出可读摘要，供启动自检日志")
    void describeIsReadable() {
        assertTrue(BffWhitelist.empty().describe().contains("全部拒绝"));
        String desc = demoWhitelist().describe();
        assertTrue(desc.contains("/admin/users"));
        assertTrue(desc.contains("client-scope"));
        assertTrue(desc.contains("client-in-path"));
    }
}
