package com.marschat.auth.bff;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * BFF 白名单 —— 一组 {@link BffWhitelistRule} 的集合，**默认拒绝**。
 *
 * <p>语义铁律（与历史三份手写实现一致，务必保持）：
 * <ol>
 *   <li><b>默认拒绝</b>：未命中任何规则 → 拒绝。空白名单 = 全部拒绝（不是全部放行）。</li>
 *   <li>规则命中即放行，不做「后置否决」（无 deny 规则，避免出现「既 allow 又 deny」的歧义）。</li>
 *   <li>作用域校验在规则内完成（{@code client} 查询参数 / 路径段），不在此层重复。</li>
 * </ol>
 */
public class BffWhitelist {

    private final List<BffWhitelistRule> rules;

    public BffWhitelist(List<BffWhitelistRule> rules) {
        this.rules = rules == null ? List.of() : List.copyOf(rules);
    }

    /** 空白名单（全部拒绝）—— 文件缺失时的安全缺省。 */
    public static BffWhitelist empty() {
        return new BffWhitelist(List.of());
    }

    /**
     * 判断是否放行（查询串兜底形态）。
     *
     * @param method      HTTP 方法
     * @param path        中心路径（不含查询串）
     * @param query       原始查询串
     * @param appClientId 本应用 client_id
     * @return 命中任一规则返回 {@code true}；否则 {@code false}
     */
    public boolean isAllowed(String method, String path, String query, String appClientId) {
        return isAllowed(method, path, query, null, appClientId);
    }

    /**
     * 判断是否放行（完整形态）。
     *
     * @param method            HTTP 方法
     * @param path              中心路径（不含查询串）
     * @param query             原始查询串（{@code clientParamValues} 缺失时的兜底）
     * @param clientParamValues {@code request.getParameterValues("client")} —— 真实容器里已涵盖
     *                          查询串与表单体，用它而非仅解析查询串，可堵住
     *                          「校验看查询串、转发带上表单体」的作用域旁路
     * @param appClientId       本应用 client_id
     * @return 命中任一规则返回 {@code true}；否则 {@code false}
     */
    public boolean isAllowed(String method, String path, String query,
                             String[] clientParamValues, String appClientId) {
        if (appClientId == null || appClientId.isBlank()) {
            // 未配置 client-id 时无法做作用域校验 → 一律拒绝（fail-closed）
            return false;
        }
        for (BffWhitelistRule rule : rules) {
            if (rule.matches(method, path, query, clientParamValues, appClientId)) {
                return true;
            }
        }
        return false;
    }

    /** 是否为空（空白名单意味着本应用管理面全部 404）。 */
    public boolean isEmpty() {
        return rules.isEmpty();
    }

    public int size() {
        return rules.size();
    }

    public List<BffWhitelistRule> getRules() {
        return Collections.unmodifiableList(new ArrayList<>(rules));
    }

    /** 供日志/自检输出：规则的可读摘要。 */
    public String describe() {
        if (rules.isEmpty()) {
            return "(空 — 全部拒绝)";
        }
        StringBuilder sb = new StringBuilder();
        for (BffWhitelistRule r : rules) {
            sb.append("\n  - ").append(r.getMethods() == null || r.getMethods().isEmpty()
                    ? "ANY" : String.join("|", r.getMethods()));
            sb.append(' ').append(r.getPath());
            if (r.isClientInPath()) {
                sb.append(" [client-in-path]");
            }
            if (r.isRequireClientScope()) {
                sb.append(" [client-scope]");
            }
        }
        return sb.toString();
    }
}
