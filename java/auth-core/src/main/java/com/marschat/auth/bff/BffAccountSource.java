package com.marschat.auth.bff;

import java.util.List;

/**
 * 本地账号来源（SPI）—— 应用把自己的「本地账号」告诉公共上报器。
 *
 * <p>应用只需实现这一个方法（通常 3 ~ 10 行：查一次本地用户表 / 读一个配置项），
 * 上报的重试、鉴权头、JSON 组装、异常降级全部由 {@link MarschatBffAccountReporter} 负责。
 * 历史上这份逻辑在 portal / infra-monitor / activecode 各写了一遍（95 ~ 111 行）。
 *
 * <p>实现示例：
 * <pre>
 * &#64;Bean
 * BffAccountSource bffAccountSource(UserMapper userMapper) {
 *     return () -&gt; userMapper.selectList(null).stream()
 *             .map(u -&gt; new BffLocalAccount(u.getUsername(), u.getNickname()))
 *             .toList();
 * }
 * </pre>
 *
 * <p>返回空集合 = 本应用无本地账号（如纯 SSO 应用），上报器会跳过并记 INFO。
 */
@FunctionalInterface
public interface BffAccountSource {

    /** 本应用的本地账号清单（可能为空，不返回 {@code null}）。 */
    List<BffLocalAccount> localAccounts();

    /** 单条本地账号：{@code account} 用于与中心身份认领，{@code name} 仅作展示。 */
    record BffLocalAccount(String account, String name) {
    }
}
