package com.marschat.auth.bff;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * BFF 白名单加载器 —— 从 {@code bff-whitelist.yml} 读规则，**文件缺失 = 空白名单 = 全部拒绝**。
 *
 * <p>典型文件内容：
 * <pre>
 * # 应用侧管理代理白名单（默认拒绝，Phase 13 配置化接入）
 * client-id: marschat-&lt;新应用&gt;
 * rules:
 *   - path: /admin/clients/{clientId}/**
 *     client-in-path: true
 *   - path: /admin/users
 *     methods: [GET]
 *     require-client-scope: true
 *   - path: /admin/users/{id}/client-roles
 *     methods: [GET, PUT]
 *     require-client-scope: true
 *   - path: /admin/roles
 *     methods: [GET]
 * </pre>
 *
 * <p>加载失败（文件不存在 / YAML 语法错 / 规则缺 path）**不抛异常阻断启动**，
 * 而是退化为空白名单并打 WARN —— 与「上报凭据缺失只 WARN 不阻断」的既有口径一致；
 * 代价是本应用管理面全部 404（fail-closed，安全侧可接受）。
 */
public class BffWhitelistLoader {

    private static final Logger log = LoggerFactory.getLogger(BffWhitelistLoader.class);

    private final ResourceLoader resourceLoader;

    public BffWhitelistLoader() {
        this(new DefaultResourceLoader());
    }

    public BffWhitelistLoader(ResourceLoader resourceLoader) {
        this.resourceLoader = resourceLoader;
    }

    /**
     * 加载白名单。
     *
     * @param location {@code classpath:bff-whitelist.yml} / {@code file:/path/to.yml}，
     *                 无前缀时按 classpath 处理
     * @return 白名单（永不返回 {@code null}；异常时返回空白名单）
     */
    public BffWhitelist load(String location) {
        String loc = (location == null || location.isBlank())
                ? "classpath:bff-whitelist.yml" : location.trim();
        if (!loc.contains(":")) {
            loc = "classpath:" + loc;
        }
        try {
            Resource resource = resourceLoader.getResource(loc);
            if (!resource.exists()) {
                log.warn("[BFF 白名单] 未找到 {} —— 管理代理将**全部拒绝**（404）。"
                        + "新增应用请放置 bff-whitelist.yml 并显式登记所需端点。", loc);
                return BffWhitelist.empty();
            }
            try (InputStream in = resource.getInputStream()) {
                String yaml = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                BffWhitelist whitelist = parse(yaml);
                if (whitelist.isEmpty()) {
                    log.warn("[BFF 白名单] {} 中没有任何 rules —— 管理代理**全部拒绝**（404）", loc);
                } else {
                    log.info("[BFF 白名单] 已加载 {} 条规则：{}", whitelist.size(), whitelist.describe());
                }
                return whitelist;
            }
        } catch (Exception e) {
            log.warn("[BFF 白名单] 解析 {} 失败（不阻断启动，退化为全部拒绝）：{}", loc, e.getMessage());
            return BffWhitelist.empty();
        }
    }

    /** 从 YAML 文本解析（供测试与内联配置使用）。 */
    @SuppressWarnings("unchecked")
    public BffWhitelist parse(String yaml) {
        if (yaml == null || yaml.isBlank()) {
            return BffWhitelist.empty();
        }
        Object root = new Yaml().load(yaml);
        if (!(root instanceof Map<?, ?> map)) {
            return BffWhitelist.empty();
        }
        Object rawRules = map.get("rules");
        if (!(rawRules instanceof List<?> list)) {
            return BffWhitelist.empty();
        }
        List<BffWhitelistRule> rules = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> ruleMap)) {
                continue;
            }
            Map<String, Object> rm = (Map<String, Object>) ruleMap;
            BffWhitelistRule rule = new BffWhitelistRule();
            rule.setPath(str(rm.get("path")));
            rule.setMethods(methods(rm));
            rule.setRequireClientScope(bool(rm.get("require-client-scope")));
            rule.setClientInPath(bool(rm.get("client-in-path")));
            if (rule.getPath() == null || rule.getPath().isBlank()) {
                log.warn("[BFF 白名单] 跳过缺少 path 的规则：{}", rm);
                continue;
            }
            rule.compile();
            rules.add(rule);
        }
        return new BffWhitelist(rules);
    }

    /** {@code methods: [GET, PUT]} 或 {@code method: GET} 两种写法都支持。 */
    private List<String> methods(Map<String, Object> rm) {
        Object v = rm.get("methods");
        if (v == null) {
            v = rm.get("method");
        }
        if (v == null) {
            return null;
        }
        List<String> out = new ArrayList<>();
        if (v instanceof List<?> list) {
            for (Object o : list) {
                if (o != null) {
                    out.add(String.valueOf(o));
                }
            }
        } else {
            // 支持 "GET,PUT" 逗号写法
            for (String s : String.valueOf(v).split(",")) {
                if (!s.isBlank()) {
                    out.add(s.trim());
                }
            }
        }
        return out.isEmpty() ? null : out;
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static boolean bool(Object o) {
        if (o instanceof Boolean b) {
            return b;
        }
        return o != null && Boolean.parseBoolean(String.valueOf(o));
    }
}
