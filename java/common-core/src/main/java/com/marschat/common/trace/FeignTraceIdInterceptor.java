package com.marschat.common.trace;

import feign.RequestInterceptor;
import feign.RequestTemplate;
import org.slf4j.MDC;

/**
 * Feign 调用时自动传递 traceId（P0 新增）
 * <p>
 * 注册为 Bean 即可自动生效：
 * <code>
 *   @Bean
 *   public RequestInterceptor feignTraceIdInterceptor() {
 *       return new FeignTraceIdInterceptor();
 *   }
 * </code>
 */
public class FeignTraceIdInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        String traceId = MDC.get(TraceIdInterceptor.TRACE_ID_MDC);
        if (traceId != null && !traceId.isBlank()) {
            template.header(TraceIdInterceptor.TRACE_ID_HEADER, traceId);
        }
    }
}
