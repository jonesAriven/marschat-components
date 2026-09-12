package com.marschat.common.audit;

import lombok.Builder;
import lombok.Data;

import java.util.Map;

/** 审计事件（@AuditOperation 切面的采集结果，交给 {@link AuditSink} 落库或记日志）。 */
@Data
@Builder
public class AuditEvent {

    /** 操作人（从请求 Bearer token 解出的 userId，取不到为 null——匿名/系统调用）。 */
    private String operatorId;

    /** 操作人名（可由应用 enrich；切面尽力取 username claim）。 */
    private String operatorName;

    private String action;

    private String resourceType;

    /** 资源 ID（SpEL 解析结果；解析失败为 null，不阻断业务）。 */
    private String resourceId;

    /** 审计明细（detail SpEL 解析结果 + 入参摘要）。 */
    private String detail;

    /** 关键入参快照（形参名 → String 化值，截断 200 字符；敏感参数名过滤）。 */
    private Map<String, String> argsSnapshot;

    private boolean success;

    /** 业务异常消息（失败时）。 */
    private String errorMessage;

    private long costMs;

    private String clientIp;

    private String userAgent;

    /** traceId（common-core MDC）。 */
    private String traceId;
}
