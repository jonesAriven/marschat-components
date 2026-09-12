package com.marschat.common.audit;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;

/** audit 自动装配：{@code marschat.audit.enabled=false} 可停用（默认开启）。 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "marschat.audit", name = "enabled", havingValue = "true", matchIfMissing = true)
public class AuditAutoConfig {

    @Bean
    @ConditionalOnMissingBean
    public AuditSink auditSink() {
        return new Slf4jAuditSink();
    }

    @Bean
    @ConditionalOnMissingBean
    public AuditOperationAspect auditOperationAspect(AuditSink sink) {
        return new AuditOperationAspect(sink);
    }
}
