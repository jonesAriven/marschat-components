package com.marschat.common.audit;

/**
 * 审计落点 SPI。各应用按需实现：
 * <ul>
 *   <li>有 operation_log 表的（auth-center / kb-ops）→ 实现并落自己的表；</li>
 *   <li>未实现的 → 装配默认 {@link Slf4jAuditSink} 结构化日志（告警可按关键字收集）。</li>
 * </ul>
 * ⚠️ 实现内不得抛异常、不得长时间阻塞——审计失败绝不能影响业务主链路。
 */
public interface AuditSink {

    void write(AuditEvent event);
}
