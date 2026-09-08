package com.marschat.common.trace;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * TraceIdInterceptor 链路追踪拦截器单元测试
 */
@DisplayName("TraceIdInterceptor 链路追踪拦截器单元测试")
class TraceIdInterceptorTest {

    private TraceIdInterceptor interceptor;
    private HttpServletRequest request;
    private HttpServletResponse response;

    @BeforeEach
    void setUp() {
        interceptor = new TraceIdInterceptor();
        request = mock(HttpServletRequest.class);
        response = mock(HttpServletResponse.class);
        MDC.clear();
    }

    @AfterEach
    void tearDown() {
        MDC.clear();
    }

    @Test
    @DisplayName("preHandle_请求头含traceId_复用并写入MDC和响应头")
    void preHandle_withHeader_reusesTraceId() {
        when(request.getHeader(TraceIdInterceptor.TRACE_ID_HEADER)).thenReturn("trace-from-gateway");

        boolean result = interceptor.preHandle(request, response, new Object());

        assertTrue(result);
        assertEquals("trace-from-gateway", MDC.get(TraceIdInterceptor.TRACE_ID_MDC));
        verify(response).setHeader(TraceIdInterceptor.TRACE_ID_HEADER, "trace-from-gateway");
    }

    @Test
    @DisplayName("preHandle_请求头无traceId_生成新traceId(无横杠32位)")
    void preHandle_withoutHeader_generatesNewTraceId() {
        when(request.getHeader(TraceIdInterceptor.TRACE_ID_HEADER)).thenReturn(null);

        boolean result = interceptor.preHandle(request, response, new Object());

        assertTrue(result);
        String traceId = MDC.get(TraceIdInterceptor.TRACE_ID_MDC);
        assertNotNull(traceId);
        assertFalse(traceId.contains("-"));
        assertEquals(32, traceId.length());
        verify(response).setHeader(eq(TraceIdInterceptor.TRACE_ID_HEADER), eq(traceId));
    }

    @Test
    @DisplayName("preHandle_请求头空白traceId_生成新traceId")
    void preHandle_withBlankHeader_generatesNewTraceId() {
        when(request.getHeader(TraceIdInterceptor.TRACE_ID_HEADER)).thenReturn("   ");

        boolean result = interceptor.preHandle(request, response, new Object());

        assertTrue(result);
        String traceId = MDC.get(TraceIdInterceptor.TRACE_ID_MDC);
        assertNotNull(traceId);
        assertFalse(traceId.isBlank());
        verify(response).setHeader(eq(TraceIdInterceptor.TRACE_ID_HEADER), anyString());
    }

    @Test
    @DisplayName("preHandle_请求头空字符串traceId_生成新traceId")
    void preHandle_withEmptyHeader_generatesNewTraceId() {
        when(request.getHeader(TraceIdInterceptor.TRACE_ID_HEADER)).thenReturn("");

        boolean result = interceptor.preHandle(request, response, new Object());

        assertTrue(result);
        assertNotNull(MDC.get(TraceIdInterceptor.TRACE_ID_MDC));
    }

    @Test
    @DisplayName("afterCompletion_清除MDC中的traceId")
    void afterCompletion_removesTraceIdFromMdc() {
        MDC.put(TraceIdInterceptor.TRACE_ID_MDC, "some-trace");

        interceptor.afterCompletion(request, response, new Object(), null);

        assertNull(MDC.get(TraceIdInterceptor.TRACE_ID_MDC));
    }

    @Test
    @DisplayName("afterCompletion_即使有异常也清除MDC")
    void afterCompletion_withException_removesTraceIdFromMdc() {
        MDC.put(TraceIdInterceptor.TRACE_ID_MDC, "some-trace");
        Exception ex = new RuntimeException("test");

        interceptor.afterCompletion(request, response, new Object(), ex);

        assertNull(MDC.get(TraceIdInterceptor.TRACE_ID_MDC));
    }

    @Test
    @DisplayName("afterCompletion_MDC无traceId_不报错")
    void afterCompletion_noTraceIdInMdc_doesNotThrow() {
        assertDoesNotThrow(() ->
                interceptor.afterCompletion(request, response, new Object(), null));
        assertNull(MDC.get(TraceIdInterceptor.TRACE_ID_MDC));
    }

    @Test
    @DisplayName("preHandle_复用的traceId与新生成的traceId不同")
    void preHandle_generatedTraceIdIsUuidWithoutDashes() {
        when(request.getHeader(TraceIdInterceptor.TRACE_ID_HEADER)).thenReturn(null);

        interceptor.preHandle(request, response, new Object());
        String first = MDC.get(TraceIdInterceptor.TRACE_ID_MDC);
        MDC.clear();

        interceptor.preHandle(request, response, new Object());
        String second = MDC.get(TraceIdInterceptor.TRACE_ID_MDC);

        assertNotEquals(first, second);
    }

    @Test
    @DisplayName("常量_头名和MDC键值正确")
    void constants_haveExpectedValues() {
        assertEquals("X-Trace-Id", TraceIdInterceptor.TRACE_ID_HEADER);
        assertEquals("traceId", TraceIdInterceptor.TRACE_ID_MDC);
    }
}
