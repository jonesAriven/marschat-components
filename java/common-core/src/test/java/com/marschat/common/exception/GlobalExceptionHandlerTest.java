package com.marschat.common.exception;

import com.marschat.common.result.Result;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.http.HttpMethod;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * GlobalExceptionHandler 全局异常处理器单元测试
 */
@DisplayName("GlobalExceptionHandler 全局异常处理器单元测试")
class GlobalExceptionHandlerTest {

    private GlobalExceptionHandler handler;
    private HttpServletRequest request;

    @BeforeEach
    void setUp() {
        handler = new GlobalExceptionHandler();
        request = mock(HttpServletRequest.class);
        when(request.getRequestURI()).thenReturn("/api/test");
        MDC.clear();
    }

    @AfterEach
    void tearDown() {
        MDC.clear();
    }

    // ===== handleBusiness =====

    @Test
    @DisplayName("handleBusiness_业务异常_返回对应code和message")
    void handleBusiness_returnsCodeAndMessage() {
        BusinessException ex = new BusinessException(404, "资源不存在");

        Result<?> result = handler.handleBusiness(ex, request);

        assertEquals(404, result.getCode());
        assertEquals("资源不存在", result.getMessage());
        assertNull(result.getTraceId());
        assertNull(result.getData());
    }

    @Test
    @DisplayName("handleBusiness_MDC含traceId_响应注入traceId")
    void handleBusiness_withTraceId_injectsTraceId() {
        MDC.put("traceId", "trace-abc");
        BusinessException ex = new BusinessException(422, "校验失败");

        Result<?> result = handler.handleBusiness(ex, request);

        assertEquals("trace-abc", result.getTraceId());
    }

    @Test
    @DisplayName("handleBusiness_默认code400异常_返回400")
    void handleBusiness_defaultCodeException_returns400() {
        BusinessException ex = new BusinessException("参数错误");

        Result<?> result = handler.handleBusiness(ex, request);

        assertEquals(400, result.getCode());
        assertEquals("参数错误", result.getMessage());
    }

    @Test
    @DisplayName("handleBusiness_子类异常NotFoundException_返回404且消息含资源和ID")
    void handleBusiness_subClassException_returns404() {
        NotFoundException ex = new NotFoundException("用户", 100L);

        Result<?> result = handler.handleBusiness(ex, request);

        assertEquals(404, result.getCode());
        assertTrue(result.getMessage().contains("用户"));
        assertTrue(result.getMessage().contains("100"));
    }

    @Test
    @DisplayName("handleBusiness_带原因的异常_保留code")
    void handleBusiness_exceptionWithCause_preservesCode() {
        BusinessException ex = new BusinessException(500, "服务异常", new RuntimeException("db down"));

        Result<?> result = handler.handleBusiness(ex, request);

        assertEquals(500, result.getCode());
        assertEquals("服务异常", result.getMessage());
    }

    // ===== handleValidation =====

    @Test
    @DisplayName("handleValidation_多个字段错误_返回400并拼接所有字段错误")
    void handleValidation_multipleFieldErrors_returns400WithAllErrors() {
        MethodArgumentNotValidException ex = mock(MethodArgumentNotValidException.class);
        BindingResult bindingResult = mock(BindingResult.class);
        when(ex.getBindingResult()).thenReturn(bindingResult);
        when(bindingResult.getFieldErrors()).thenReturn(List.of(
                new FieldError("obj", "name", "不能为空"),
                new FieldError("obj", "age", "必须为正数")
        ));

        Result<?> result = handler.handleValidation(ex);

        assertEquals(400, result.getCode());
        assertTrue(result.getMessage().contains("name"));
        assertTrue(result.getMessage().contains("不能为空"));
        assertTrue(result.getMessage().contains("age"));
        assertTrue(result.getMessage().contains("必须为正数"));
        assertTrue(result.getMessage().contains(";"));
    }

    @Test
    @DisplayName("handleValidation_单个字段错误_返回400且无分号")
    void handleValidation_singleFieldError_returns400WithoutSemicolon() {
        MethodArgumentNotValidException ex = mock(MethodArgumentNotValidException.class);
        BindingResult bindingResult = mock(BindingResult.class);
        when(ex.getBindingResult()).thenReturn(bindingResult);
        when(bindingResult.getFieldErrors()).thenReturn(
                List.of(new FieldError("obj", "name", "不能为空")));

        Result<?> result = handler.handleValidation(ex);

        assertEquals(400, result.getCode());
        assertTrue(result.getMessage().contains("name: 不能为空"));
    }

    @Test
    @DisplayName("handleValidation_MDC含traceId_响应注入traceId")
    void handleValidation_withTraceId_injectsTraceId() {
        MDC.put("traceId", "trace-val");
        MethodArgumentNotValidException ex = mock(MethodArgumentNotValidException.class);
        BindingResult bindingResult = mock(BindingResult.class);
        when(ex.getBindingResult()).thenReturn(bindingResult);
        when(bindingResult.getFieldErrors()).thenReturn(
                List.of(new FieldError("obj", "name", "不能为空")));

        Result<?> result = handler.handleValidation(ex);

        assertEquals("trace-val", result.getTraceId());
    }

    @Test
    @DisplayName("handleValidation_无字段错误_返回400")
    void handleValidation_noFieldErrors_returns400() {
        MethodArgumentNotValidException ex = mock(MethodArgumentNotValidException.class);
        BindingResult bindingResult = mock(BindingResult.class);
        when(ex.getBindingResult()).thenReturn(bindingResult);
        when(bindingResult.getFieldErrors()).thenReturn(Collections.emptyList());

        Result<?> result = handler.handleValidation(ex);

        assertEquals(400, result.getCode());
        assertTrue(result.getMessage().contains("参数校验失败"));
    }

    // ===== handleUnknown =====

    @Test
    @DisplayName("handleUnknown_未知异常_返回500和通用错误信息")
    void handleUnknown_returns500WithGenericMessage() {
        Exception ex = new RuntimeException("NPE somewhere");

        Result<?> result = handler.handleUnknown(ex, request);

        assertEquals(500, result.getCode());
        assertEquals("服务内部错误，请稍后重试", result.getMessage());
        assertNull(result.getData());
    }

    @Test
    @DisplayName("handleUnknown_MDC含traceId_响应注入traceId")
    void handleUnknown_withTraceId_injectsTraceId() {
        MDC.put("traceId", "trace-err");
        Exception ex = new RuntimeException("boom");

        Result<?> result = handler.handleUnknown(ex, request);

        assertEquals("trace-err", result.getTraceId());
    }

    @Test
    @DisplayName("handleUnknown_异常message为null_仍返回500")
    void handleUnknown_nullMessage_returns500() {
        Exception ex = new RuntimeException();

        Result<?> result = handler.handleUnknown(ex, request);

        assertEquals(500, result.getCode());
        assertEquals("服务内部错误，请稍后重试", result.getMessage());
    }

    @Test
    @DisplayName("handleUnknown_检查异常_返回500")
    void handleUnknown_checkedException_returns500() {
        Exception ex = new Exception("checked");

        Result<?> result = handler.handleUnknown(ex, request);

        assertEquals(500, result.getCode());
    }

    // ===== handleNoResourceFound（L044）=====

    @Test
    @DisplayName("handleNoResourceFound_无匹配路由_返回404而非500")
    void handleNoResourceFound_returns404() {
        NoResourceFoundException ex = new NoResourceFoundException(HttpMethod.POST, "/admin/users/1/reset-password");

        Result<?> result = handler.handleNoResourceFound(ex, request);

        assertEquals(404, result.getCode());
        assertTrue(result.getMessage().contains("/api/test"), "消息应含请求路径（来自 req.getRequestURI()）");
    }

    @Test
    @DisplayName("handleNoResourceFound_MDC含traceId_响应注入traceId")
    void handleNoResourceFound_withTraceId_injectsTraceId() {
        MDC.put("traceId", "trace-404");
        NoResourceFoundException ex = new NoResourceFoundException(HttpMethod.GET, "/nope");

        Result<?> result = handler.handleNoResourceFound(ex, request);

        assertEquals("trace-404", result.getTraceId());
    }
}
