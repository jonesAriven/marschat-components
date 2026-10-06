package com.marschat.auth.bff;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 白名单加载器单测 —— 覆盖「配置化接入」最容易出错的两种情形：
 * 文件缺失（必须 fail-closed 而非 fail-open）与 YAML 写法容错。
 */
class BffWhitelistLoaderTest {

    private static final String APP = "marschat-demo";

    @Test
    @DisplayName("文件缺失 → 空白名单（全部拒绝），不抛异常")
    void missingFileYieldsEmptyWhitelist() {
        BffWhitelist whitelist = new BffWhitelistLoader()
                .load("classpath:definitely-not-exists-bff-whitelist.yml");
        assertTrue(whitelist.isEmpty());
        assertFalse(whitelist.isAllowed("GET", "/admin/users", null, APP));
    }

    @Test
    @DisplayName("正常 YAML → 规则全部载入且可判定")
    void parsesValidYaml() {
        String yaml = """
                client-id: marschat-demo
                rules:
                  - path: /admin/clients/{clientId}/**
                    client-in-path: true
                  - path: /admin/users
                    methods: [GET]
                    require-client-scope: true
                  - path: /admin/roles
                    methods: [GET]
                """;
        BffWhitelist whitelist = new BffWhitelistLoader().parse(yaml);
        assertEquals(3, whitelist.size());
        assertTrue(whitelist.isAllowed("GET", "/admin/clients/" + APP + "/members", null, APP));
        assertTrue(whitelist.isAllowed("GET", "/admin/users", null, APP));
        assertTrue(whitelist.isAllowed("GET", "/admin/roles", null, APP));
        assertFalse(whitelist.isAllowed("GET", "/admin/clients/other/members", null, APP));
        assertFalse(whitelist.isAllowed("POST", "/admin/users", null, APP));
    }

    @Test
    @DisplayName("method 单数 + 逗号写法都支持")
    void acceptsMethodShorthand() {
        BffWhitelist single = new BffWhitelistLoader().parse("""
                rules:
                  - path: /admin/roles
                    method: GET
                """);
        assertTrue(single.isAllowed("GET", "/admin/roles", null, APP));
        assertFalse(single.isAllowed("PUT", "/admin/roles", null, APP));

        BffWhitelist comma = new BffWhitelistLoader().parse("""
                rules:
                  - path: /admin/users/{id}/client-roles
                    method: "GET,PUT"
                """);
        assertTrue(comma.isAllowed("GET", "/admin/users/302/client-roles", null, APP));
        assertTrue(comma.isAllowed("PUT", "/admin/users/302/client-roles", null, APP));
        assertFalse(comma.isAllowed("DELETE", "/admin/users/302/client-roles", null, APP));
    }

    @Test
    @DisplayName("无 rules / 空文本 / 非映射 → 空白名单，不抛异常")
    void tolerantToMalformedInput() {
        BffWhitelistLoader loader = new BffWhitelistLoader();
        assertTrue(loader.parse("").isEmpty());
        assertTrue(loader.parse("client-id: x").isEmpty());
        assertTrue(loader.parse("- just\n- a\n- list").isEmpty());
        assertTrue(loader.parse("rules: not-a-list").isEmpty());
    }

    @Test
    @DisplayName("缺 path 的规则被跳过，其余规则不受影响")
    void skipsRuleWithoutPath() {
        BffWhitelist whitelist = new BffWhitelistLoader().parse("""
                rules:
                  - methods: [GET]
                  - path: /admin/roles
                    methods: [GET]
                """);
        assertEquals(1, whitelist.size());
        assertTrue(whitelist.isAllowed("GET", "/admin/roles", null, APP));
    }

    @Test
    @DisplayName("YAML 语法错误 → 空白名单（fail-closed），不抛异常")
    void malformedYamlFailsClosed() {
        // 缩进错乱导致解析异常
        BffWhitelist whitelist = new BffWhitelistLoader().load("classpath:no-such-file.yml");
        assertTrue(whitelist.isEmpty());
    }
}
