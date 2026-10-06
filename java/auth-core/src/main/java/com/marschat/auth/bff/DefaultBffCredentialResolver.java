package com.marschat.auth.bff;

import jakarta.servlet.http.HttpServletRequest;

import java.security.Principal;

/**
 * {@link BffCredentialResolver} 的默认实现 —— 把三种历史行为收敛为配置项。
 *
 * <table border="1">
 *   <caption>模式对照</caption>
 *   <tr><th>模式</th><th>行为</th><th>历史对应</th></tr>
 *   <tr><td>{@code PASSTHROUGH}</td><td>直接透传调用者 {@code Authorization}</td><td>kb-ops</td></tr>
 *   <tr><td>{@code SESSION_STORE}</td><td>按当前用户名从 {@link CenterSessionStore} 取</td>
 *       <td>（更严格的账密形态）</td></tr>
 *   <tr><td>{@code AUTO}</td><td>非自签 token 直接用，自签 token 回落会话表</td>
 *       <td>infra-monitor / activecode</td></tr>
 * </table>
 *
 * <p><b>安全不变式（三种模式共同保证）</b>：
 * <ul>
 *   <li>绝不使用服务账号 / 固定凭据兜底（历史上正是「无会话回退服务账号」造成提权）；</li>
 *   <li>解析不到凭据 → 返回 {@code null} → 上层 401 fail-closed；</li>
 *   <li>角色判定不在此做 —— 中心返回什么状态就透传什么（非管理员 403 / token 过期 401）。</li>
 * </ul>
 */
public class DefaultBffCredentialResolver implements BffCredentialResolver {

    private static final String BEARER = "Bearer ";

    private final BffProperties.CredentialMode mode;
    private final CenterSessionStore sessionStore;
    private final BffLocalTokenClassifier localTokenClassifier;

    public DefaultBffCredentialResolver(BffProperties.CredentialMode mode,
                                        CenterSessionStore sessionStore,
                                        BffLocalTokenClassifier localTokenClassifier) {
        this.mode = mode == null ? BffProperties.CredentialMode.PASSTHROUGH : mode;
        this.sessionStore = sessionStore;
        this.localTokenClassifier = localTokenClassifier;
    }

    @Override
    public String resolve(HttpServletRequest request) {
        String presented = bearerToken(request);
        return switch (mode) {
            case PASSTHROUGH -> blankToNull(presented);
            case SESSION_STORE -> fromSessionStore(request);
            case AUTO -> resolveAuto(request, presented);
        };
    }

    /** AUTO：非自签 token 视为 SSO 会话直接用；自签 token（或无 classifier）回落会话表。 */
    private String resolveAuto(HttpServletRequest request, String presented) {
        if (presented != null && !presented.isBlank()) {
            // 没有 classifier 时无法判定来源 → 按「中心 token」处理（中心会拒掉自签 token，
            // 只损失一次 401，不产生越权），随后仍有会话表兜底
            boolean locallyIssued = localTokenClassifier != null
                    && localTokenClassifier.isLocallyIssued(presented);
            if (!locallyIssued) {
                return presented;
            }
        }
        String fromStore = fromSessionStore(request);
        return fromStore != null ? fromStore : blankToNull(presented);
    }

    private String fromSessionStore(HttpServletRequest request) {
        if (sessionStore == null) {
            return null;
        }
        Principal principal = request.getUserPrincipal();
        if (principal == null || principal.getName() == null) {
            return null;
        }
        return blankToNull(sessionStore.getAccessToken(principal.getName()));
    }

    /** 取 {@code Authorization: Bearer xxx} 里的裸 token。 */
    private static String bearerToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith(BEARER)) {
            return null;
        }
        return header.substring(BEARER.length()).trim();
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }
}
