package com.marschat.common.trace;

import feign.RequestTemplate;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.Mockito.*;

/**
 * FeignTraceIdInterceptor Feign 链路传递单元测试
 */
@DisplayName("FeignTraceIdInterceptor Feign 链路传递单元测试")
class FeignTraceIdInterceptorTest {

    private FeignTraceIdInterceptor interceptor;
    private RequestTemplate template;

    @BeforeEach
    void setUp() {
        interceptor = new FeignTraceIdInterceptor();
        template = mock(RequestTemplate.class);
        MDC.clear();
    }

    @AfterEach
    void tearDown() {
        MDC.clear();
    }

    @Test
    @DisplayName("apply_MDC含traceId_写入请求头")
    void apply_withTraceId_setsHeader() {
        MDC.put(TraceIdInterceptor.TRACE_ID_MDC, "feign-trace-123");

        interceptor.apply(template);

        verify(template).header(TraceIdInterceptor.TRACE_ID_HEADER, "feign-trace-123");
    }

    @Test
    @DisplayName("apply_MDC无traceId_不写入请求头")
    void apply_withoutTraceId_doesNotSetHeader() {
        interceptor.apply(template);

        verifyNoInteractions(template);
    }

    @Test
    @DisplayName("apply_MDC空白traceId_不写入请求头")
    void apply_withBlankTraceId_doesNotSetHeader() {
        MDC.put(TraceIdInterceptor.TRACE_ID_MDC, "   ");

        interceptor.apply(template);

        verifyNoInteractions(template);
    }

    @Test
    @DisplayName("apply_MDC空字符串traceId_不写入请求头")
    void apply_withEmptyTraceId_doesNotSetHeader() {
        MDC.put(TraceIdInterceptor.TRACE_ID_MDC, "");

        interceptor.apply(template);

        verifyNoInteractions(template);
    }

    @Test
    @DisplayName("apply_null template_不抛出异常（容错）")
    void apply_withNullMdcTraceId_doesNotThrow() {
        assertDoesNotThrow(() -> interceptor.apply(template));
    }

    @Test
    @DisplayName("apply_多次调用_MDC一致时写入相同traceId")
    void apply_multipleCalls_sameTraceId() {
        MDC.put(TraceIdInterceptor.TRACE_ID_MDC, "stable-trace");
        RequestTemplate t1 = mock(RequestTemplate.class);
        RequestTemplate t2 = mock(RequestTemplate.class);

        interceptor.apply(t1);
        interceptor.apply(t2);

        verify(t1).header(TraceIdInterceptor.TRACE_ID_HEADER, "stable-trace");
        verify(t2).header(TraceIdInterceptor.TRACE_ID_HEADER, "stable-trace");
    }
}
