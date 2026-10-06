package com.marschat.auth.bff;

import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * BFF 白名单**单条规则** —— 把历史上硬编码在 Java 里的
 * {@code if (path.equals("/admin/users")) return "GET".equals(m) && clientScopeOk(query);}
 * 变成一行声明式配置。
 *
 * <pre>
 * rules:
 *   - path: /admin/users                       # 中心路径模式
 *     methods: [GET]                           # 缺省 = 任意方法
 *     require-client-scope: true               # 校验 ?client= 必须等于本应用
 *   - path: /admin/clients/{clientId}/**       # {clientId} 必须是本应用（防越界）
 *     client-in-path: true
 * </pre>
 *
 * <p><b>路径模式语法</b>：
 * <ul>
 *   <li>{@code {name}} —— 匹配单个路径段（{@code [^/]+}）</li>
 *   <li>{@code *} —— 匹配段内任意字符（{@code [^/]*}）</li>
 *   <li>{@code **} —— 匹配任意多段（{@code .*}）</li>
 *   <li>其余字符按字面量匹配（正则元字符自动转义）</li>
 * </ul>
 *
 * <p><b>HPP 加固</b>：{@code require-client-scope} 的规则会先统计查询串中 {@code client}
 * 键的出现次数，{@code >1} 一律拒绝 —— 因为「校验所见」与「转发所得」若取的不是同一个键，
 * 攻击者可让校验看到 A、转发带上 B。
 */
public class BffWhitelistRule {

    /** 中心路径模式，如 {@code /admin/users/{id}/client-roles}。 */
    private String path;

    /** 允许的方法（大小写不敏感）；{@code null} 或空 = 任意方法。 */
    private List<String> methods;

    /** 是否校验 {@code ?client=} 必须等于本应用 client_id（缺省未传视为放行）。 */
    private boolean requireClientScope;

    /** 是否校验路径中的 {@code {clientId}} 段必须等于本应用 client_id。 */
    private boolean clientInPath;

    /** 编译后的匹配正则（{@code {clientId}} 为唯一捕获组，供越界校验取值）。 */
    private Pattern compiled;

    public BffWhitelistRule() {
    }

    public BffWhitelistRule(String path, List<String> methods,
                            boolean requireClientScope, boolean clientInPath) {
        this.path = path;
        this.methods = methods;
        this.requireClientScope = requireClientScope;
        this.clientInPath = clientInPath;
        compile();
    }

    /** 编译路径模式；{@link BffWhitelistLoader} 载入后调用。 */
    public void compile() {
        if (path == null || path.isBlank()) {
            throw new IllegalStateException("bff-whitelist 规则缺少 path");
        }
        this.compiled = Pattern.compile(toRegex(path));
    }

    /**
     * 判断单条规则是否放行。
     *
     * @param method           HTTP 方法
     * @param path             中心路径（不含查询串）
     * @param rawQuery         原始查询串（{@code clientParamValues} 缺失时的兜底来源）
     * @param clientParamValues Servlet 解析出的**全部** {@code client} 参数值
     *                         （{@code request.getParameterValues("client")}：真实容器里已涵盖
     *                         查询串 + 表单体，可堵住「校验看查询串、转发带上表单体」的旁路）
     * @param appClientId      本应用 client_id
     * @return 命中且通过作用域校验返回 {@code true}
     */
    public boolean matches(String method, String path, String rawQuery,
                           String[] clientParamValues, String appClientId) {
        if (compiled == null) {
            compile();
        }
        if (!methodAllowed(method)) {
            return false;
        }
        Matcher matcher = compiled.matcher(path);
        if (!matcher.matches()) {
            return false;
        }
        // 路径里钉了 client：必须等于本应用，否则改一段 path 就能管别的 client
        if (clientInPath) {
            String inPath = matcher.groupCount() >= 1 ? matcher.group(1) : null;
            if (inPath == null || !inPath.equals(appClientId)) {
                return false;
            }
        }
        if (requireClientScope) {
            return clientScopeOk(rawQuery, clientParamValues, appClientId);
        }
        return true;
    }

    /** 方法白名单判定；未声明方法 = 任意方法放行。 */
    private boolean methodAllowed(String method) {
        if (methods == null || methods.isEmpty()) {
            return true;
        }
        String m = method == null ? "" : method.toUpperCase(Locale.ROOT);
        for (String allowed : methods) {
            if (allowed == null || allowed.isBlank()) {
                continue;
            }
            String a = allowed.trim().toUpperCase(Locale.ROOT);
            if ("*".equals(a) || "ANY".equals(a) || "ALL".equals(a) || a.equals(m)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 校验 {@code client} 作用域参数。
     *
     * <p>规则（从严）：
     * <ol>
     *   <li>取值来源**优先** Servlet 解析结果 {@code clientParamValues} —— 真实容器里它已合并
     *       查询串与表单体，可覆盖原始查询串看不到的旁路；缺失时才回落到解析 {@code rawQuery}。</li>
     *   <li>完全未传 → 放行（沿用既有语义：中心侧自行决定默认作用域）。</li>
     *   <li>出现 &gt;1 个值（参数污染 / HPP）→ 一律拒绝。</li>
     *   <li>值不等于本应用 → 拒绝（防改 {@code client=} 越界管理别的 client）。</li>
     * </ol>
     */
    private boolean clientScopeOk(String rawQuery, String[] clientParamValues, String appClientId) {
        String[] values = clientParamValues;
        if (values == null || values.length == 0) {
            values = parseValues(rawQuery, "client");
        }
        if (values.length == 0) {
            return true;
        }
        if (values.length > 1) {
            return false;
        }
        String only = values[0];
        return only == null || only.isBlank() || only.equals(appClientId);
    }

    /** 统计查询串中指定参数出现的次数（识别重复键 / 参数污染）。 */
    static int countParam(String query, String key) {
        return parseValues(query, key).length;
    }

    /** 从查询串解析指定参数的全部值（保留重复键，URL 解码）。 */
    static String[] parseValues(String query, String key) {
        if (query == null || query.isBlank()) {
            return new String[0];
        }
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            String k = eq >= 0 ? pair.substring(0, eq) : pair;
            if (key.equals(k)) {
                String v = eq >= 0 ? pair.substring(eq + 1) : "";
                out.add(java.net.URLDecoder.decode(v, java.nio.charset.StandardCharsets.UTF_8));
            }
        }
        return out.toArray(new String[0]);
    }

    /**
     * 路径模式 → 正则。
     * <p>{@code {clientId}} 生成**捕获组**（唯一），其余 {@code {x}} 生成非捕获占位，
     * 以便 {@code clientInPath} 取值校验。
     */
    static String toRegex(String pattern) {
        StringBuilder sb = new StringBuilder("^");
        int i = 0;
        while (i < pattern.length()) {
            char c = pattern.charAt(i);
            if (c == '{') {
                int end = pattern.indexOf('}', i);
                if (end > i) {
                    String name = pattern.substring(i + 1, end);
                    if ("clientId".equals(name)) {
                        sb.append("([^/]+)");
                    } else {
                        sb.append("[^/]+");
                    }
                    i = end + 1;
                    continue;
                }
            }
            if (c == '*') {
                if (i + 1 < pattern.length() && pattern.charAt(i + 1) == '*') {
                    sb.append(".*");
                    i += 2;
                    continue;
                }
                sb.append("[^/]*");
                i++;
                continue;
            }
            // 只转义真正的正则元字符（`{`/`}`/`*` 已在上方分支消费，命中此处说明是字面量）
            if ("\\.[](){}<>^$|?+".indexOf(c) >= 0) {
                sb.append('\\');
            }
            sb.append(c);
            i++;
        }
        sb.append('$');
        return sb.toString();
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public List<String> getMethods() {
        return methods;
    }

    public void setMethods(List<String> methods) {
        this.methods = methods;
    }

    public boolean isRequireClientScope() {
        return requireClientScope;
    }

    public void setRequireClientScope(boolean requireClientScope) {
        this.requireClientScope = requireClientScope;
    }

    public boolean isClientInPath() {
        return clientInPath;
    }

    public void setClientInPath(boolean clientInPath) {
        this.clientInPath = clientInPath;
    }
}
