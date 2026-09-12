package com.marschat.common.audit;

import lombok.extern.slf4j.Slf4j;

/** 默认落点：结构化单行 JSON 日志（未提供 AuditSink 实现时兜底）。 */
@Slf4j
public class Slf4jAuditSink implements AuditSink {

    @Override
    public void write(AuditEvent event) {
        log.info("AUDIT|{}|{}|{}|{}|operator={}|success={}|cost={}ms|ip={}|traceId={}|detail={}|err={}",
                event.getResourceType(), event.getAction(), event.getResourceId(),
                event.getOperatorName(), event.getOperatorId(), event.isSuccess(),
                event.getCostMs(), event.getClientIp(), event.getTraceId(),
                event.getDetail(), event.getErrorMessage());
    }
}
