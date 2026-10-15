package com.marschat.auth.anonymous;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 🔓 放开登录校验的配置化白名单（公共库版）。
 *
 * <p><b>由来</b>：2026-10-14 首发于 activecode（{@code marschat.auth.anonymous} 两级清单 +
 * 登录保底集 + 写值即整体替换），收放匿名权不再改代码。2026-10-15 上沉到 auth-core 公共库，
 * 供全部 Java 应用复用（MVC 拦截器形态与 Spring Security 形态通用）。
 *
 * <p><b>用法</b>（应用侧只写 yml，不写代码）：
 * <pre>
 * marschat:
 *   auth:
 *     anonymous:
 *       context-path: /activecode        # 本应用部署前缀（保底段会按它再生成一份带前缀形态）
 *       fallback-mode: login             # login=合并登录保底集（默认）；none=完全不合并
 *       paths:                           # 路径级：整条路径不拦截（Ant 通配），写值即整体替换
 *         - /activecode/index.html
 *       endpoints:                       # 方法级：路径仍拦截，仅列出的方法放行（精确匹配，无通配）
 *         - path: /activecode/api/activation/generate
 *           methods: [POST]
 * </pre>
 *
 * <p><b>覆盖语义</b>：yml 写了 {@code paths} / {@code endpoints} 即<b>整体替换</b>对应清单
 * （配置即真相，收回匿名权 = 从 yml 删条目重启生效）。
 *
 * <p>🔒 <b>登录保底集不可清空</b>：{@link #LOGIN_FALLBACK_SEGMENTS} 是「还没有会话时也必须可达」
 * 的登录基础设施（账密登录 / SSO / 邮箱验证码 / 自助改密 / session 探测 / favicon），
 * 由代码合并进生效清单，配置无法移除——防止误配把登录链路打断导致没人能登录。
 * 业务性放开请配置 {@link #paths} / {@link #endpoints}，勿动此集。
 *
 * <p><b>双形态生成</b>：各应用后端「看不看得到 context-path」历史不一致——activecode 的
 * 后端收到 {@code /activecode/api/**}（带前缀），portal 的后端收到 {@code /api/**}
 * （nginx 已剥前缀）。因此保底段同时生成<b>原始</b>与<b>带前缀</b>两份，两边形态都命中；
 * 不存在的路径永不匹配，无副作用。登录路径形态特殊（如 infra 的 {@code /auth/login}
 * 不带 {@code /api}）的应用，请在 {@code paths} 里显式声明，保底集只是安全网不是真相源。
 *
 * <p><b>装配边界</b>：本 Properties 由 {@link AnonymousAuthAutoConfig} 注册，纯配置绑定、
 * 不注册任何拦截器——应用侧需在自己的 {@code WebMvcConfig#excludePathPatterns} 或
 * {@code SecurityConfig#requestMatchers(...).permitAll()} 里引用
 * {@link #effectivePaths()} / {@link #endpointMap()} 完成接线。
 */
@ConfigurationProperties(prefix = "marschat.auth.anonymous")
public class AnonymousAuthProperties {

    /**
     * 🔒 登录保底段（相对路径，不含 context-path）——按 {@link #contextPath} 双形态生成。
     * 与改造前 activecode {@code WebMvcConfig#excludePathPatterns} 的登录基础设施段一致。
     */
    private static final List<String> LOGIN_FALLBACK_SEGMENTS = List.of(
            "/login.html",
            "/sso-callback.html",
            "/api/auth/login",
            "/api/auth/sso-login",
            "/api/auth/session",
            "/api/auth/refresh",
            "/api/auth/mail-login",
            "/api/auth/mail-login/send-code",
            "/api/auth/forgot-password",
            "/api/auth/reset-password"
    );

    /** 🔒 根级保底段——永不拼 context-path（favicon 在域名根提供服务）。 */
    private static final List<String> ROOT_FALLBACK_SEGMENTS = List.of("/favicon.ico");

    /** 保底集合并模式。 */
    public enum FallbackMode {
        /** 合并登录保底集（默认）。 */
        LOGIN,
        /** 不合并保底集——生效清单完全由 {@link #paths} 决定（谨慎使用，配错会锁死登录）。 */
        NONE
    }

    /**
     * 本应用部署前缀（如 {@code /activecode}、{@code /portal}）。用于把登录保底段
     * 再生成一份带前缀形态；空串 = 只生成原始形态。
     */
    private String contextPath = "";

    /** 保底集合并模式，默认 {@link FallbackMode#LOGIN}。 */
    private FallbackMode fallbackMode = FallbackMode.LOGIN;

    /**
     * 路径级匿名清单（整条路径不拦截，Ant 风格通配）。默认空；
     * yml 配置后<b>整体替换</b>。
     */
    private List<String> paths = new ArrayList<>();

    /**
     * 方法级匿名清单（路径仍拦截，仅列出的 HTTP 方法放行）。默认空；
     * yml 配置后<b>整体替换</b>。精确路径匹配，不支持通配。
     */
    private List<Endpoint> endpoints = new ArrayList<>();

    public String getContextPath() {
        return contextPath;
    }

    public void setContextPath(String contextPath) {
        this.contextPath = contextPath;
    }

    public FallbackMode getFallbackMode() {
        return fallbackMode;
    }

    public void setFallbackMode(FallbackMode fallbackMode) {
        this.fallbackMode = fallbackMode;
    }

    public List<String> getPaths() {
        return paths;
    }

    public void setPaths(List<String> paths) {
        this.paths = paths;
    }

    public List<Endpoint> getEndpoints() {
        return endpoints;
    }

    public void setEndpoints(List<Endpoint> endpoints) {
        this.endpoints = endpoints;
    }

    /**
     * 生效的路径级匿名清单 = 登录保底集（按 contextPath 双形态）∪ 配置 paths。
     * 供 {@code WebMvcConfig} 的 excludePathPatterns / {@code SecurityConfig} 的
     * {@code requestMatchers(...).permitAll()} 使用（Ant 风格通配）。
     */
    public Set<String> effectivePaths() {
        Set<String> all = new LinkedHashSet<>();
        if (fallbackMode != FallbackMode.NONE) {
            String ctx = normalizeContextPath(contextPath);
            for (String seg : LOGIN_FALLBACK_SEGMENTS) {
                all.add(seg);
                if (!ctx.isEmpty()) {
                    all.add(ctx + seg);
                }
            }
            all.addAll(ROOT_FALLBACK_SEGMENTS);
        }
        if (paths != null) {
            all.addAll(paths);
        }
        return all;
    }

    /**
     * 生效的方法级匿名清单：path → methods（方法统一大写）。
     * 供应用自有拦截器的「方法级放行」判定使用（精确路径匹配，无通配）。
     */
    public Map<String, Set<String>> endpointMap() {
        Map<String, Set<String>> map = new LinkedHashMap<>();
        if (endpoints != null) {
            for (Endpoint e : endpoints) {
                if (e.getPath() == null || e.getMethods() == null || e.getMethods().isEmpty()) {
                    continue;
                }
                Set<String> upper = new LinkedHashSet<>();
                for (String m : e.getMethods()) {
                    if (m != null && !m.isBlank()) {
                        upper.add(m.trim().toUpperCase());
                    }
                }
                map.put(e.getPath(), upper);
            }
        }
        return map;
    }

    /** 归一化 context-path：补前导 `/`、去尾部 `/`；根路径 {@code "/"} 归一为**空串**（根部署 = 不拼前缀）；null/空白 → 空串。 */
    static String normalizeContextPath(String contextPath) {
        if (contextPath == null || contextPath.isBlank()) {
            return "";
        }
        String p = contextPath.trim();
        if (!p.startsWith("/")) {
            p = "/" + p;
        }
        if (p.length() > 1 && p.endsWith("/")) {
            p = p.substring(0, p.length() - 1);
        }
        // "/"（根部署，如 cosmic-studio）= 无前缀，不能拼出 "//api/..."
        if ("/".equals(p)) {
            return "";
        }
        return p;
    }

    /** 方法级白名单条目。 */
    public static class Endpoint {

        /** 精确请求路径（与 request.getRequestURI() 全等匹配，不支持通配）。 */
        private String path;

        /** 放行的 HTTP 方法（GET/POST/...，大小写不敏感）。 */
        private Set<String> methods;

        public Endpoint() {
        }

        public Endpoint(String path, Set<String> methods) {
            this.path = path;
            this.methods = methods;
        }

        public String getPath() {
            return path;
        }

        public void setPath(String path) {
            this.path = path;
        }

        public Set<String> getMethods() {
            return methods;
        }

        public void setMethods(Set<String> methods) {
            this.methods = methods;
        }
    }
}
