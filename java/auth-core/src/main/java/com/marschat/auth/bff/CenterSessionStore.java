package com.marschat.auth.bff;

/**
 * 中心会话存储 —— 账密 / 邮箱码登录换来的**中心业务令牌**（auth-center {@code /auth/login}
 * 的 {@code data.accessToken}）的服务端暂存，按用户名索引。
 *
 * <h3>为什么必须放服务端而不是浏览器</h3>
 * 「用户管理」页需要以**中心身份**调 {@code /admin/**}，而账密登录会话持有的只是本应用自签 token。
 * 若把中心 accessToken 回传前端存 localStorage，等于给页面加了一个可被 XSS 直接窃取的
 * **中心管理凭据**，且它不受本应用登出控制。因此由服务端按用户名暂存、代理时取用，
 * 浏览器侧只留本应用自己的会话 token。
 *
 * <h3>为什么把它上移到 auth-core（Phase 13）</h3>
 * 此前 infra-monitor 与 activecode 各写了一份 71 行的实现，**除 {@code package} 行外逐字节相同**
 * —— 没有归属地的重复代码。上移后应用只需保留一行配置；未来换 Redis 后端也只需替换实现，
 * 不动业务代码（历史遗留 {@code T-LOW-2}：进程内存态、重启即失效、多副本不共享）。
 */
public interface CenterSessionStore {

    /**
     * 记录某用户的中心会话。
     *
     * @param username    中心用户名
     * @param accessToken 中心 accessToken
     * @param expiresInMs 中心返回的 expiresIn（毫秒）；{@code <=0} 或缺省时按 1 小时兜底
     */
    void put(String username, String accessToken, long expiresInMs);

    /**
     * 取该用户当前有效的中心 accessToken。
     *
     * @return 无会话或已过期返回 {@code null}
     */
    String getAccessToken(String username);

    /** 清除某用户的中心会话（登出时调用）。 */
    void remove(String username);
}
