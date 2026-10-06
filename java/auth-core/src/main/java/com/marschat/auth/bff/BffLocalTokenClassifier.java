package com.marschat.auth.bff;

/**
 * 判断一个 token 是否由**本应用自己签发**（即中心不认的那一类）。
 *
 * <p>用途：{@link BffProperties.CredentialMode#AUTO} 模式下，代理需要区分两种会话：
 * <ul>
 *   <li><b>SSO 会话</b>：{@code Authorization} 里就是中心 OIDC token，可直接转发中心；</li>
 *   <li><b>账密 / 邮箱码会话</b>：{@code Authorization} 是本应用自签 token（中心不认），
 *       必须改用 {@link CenterSessionStore} 里暂存的中心令牌。</li>
 * </ul>
 *
 * <p>由应用提供实现（通常包一层自家 {@code JwtUtil}）：
 * <pre>
 * &#64;Bean
 * BffLocalTokenClassifier bffLocalTokenClassifier(JwtUtil jwtUtil) {
 *     return token -&gt; jwtUtil.parseLocalUsername(token) != null;
 * }
 * </pre>
 *
 * <p>未提供该 Bean 时，{@code AUTO} 退化为 {@link BffProperties.CredentialMode#PASSTHROUGH}
 * （直接透传；中心会拒掉自签 token 并返回 401，不会造成越权）。
 */
@FunctionalInterface
public interface BffLocalTokenClassifier {

    /**
     * @param token 不含 {@code Bearer } 前缀的裸 token
     * @return {@code true} 表示该 token 由本应用签发（不可用于访问中心）
     */
    boolean isLocallyIssued(String token);
}
