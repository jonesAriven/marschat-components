package com.marschat.common.result;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Result 统一响应单元测试
 */
@DisplayName("Result 统一响应单元测试")
class ResultTest {

    @Test
    @DisplayName("ok_无数据_返回成功响应")
    void ok_noData_returnsSuccessResult() {
        Result<Object> result = Result.ok();

        assertEquals(200, result.getCode());
        assertEquals("success", result.getMessage());
        assertNull(result.getData());
    }

    @Test
    @DisplayName("ok_带数据_返回成功响应且包含数据")
    void ok_withData_returnsSuccessResultWithData() {
        Result<String> result = Result.ok("hello");

        assertEquals(200, result.getCode());
        assertEquals("success", result.getMessage());
        assertEquals("hello", result.getData());
    }

    @Test
    @DisplayName("fail_仅message_默认错误码500")
    void fail_withMessageOnly_returnsDefaultErrorCode() {
        Result<Object> result = Result.fail("内部错误");

        assertEquals(500, result.getCode());
        assertEquals("内部错误", result.getMessage());
        assertNull(result.getData());
    }

    @Test
    @DisplayName("fail_指定code和message_返回指定错误码")
    void fail_withCodeAndMessage_returnsSpecifiedErrorCode() {
        Result<Object> result = Result.fail(404, "资源不存在");

        assertEquals(404, result.getCode());
        assertEquals("资源不存在", result.getMessage());
        assertNull(result.getData());
    }

    @Test
    @DisplayName("withTraceId_设置traceId_返回自身以支持链式调用")
    void withTraceId_setsTraceIdAndReturnsSelf() {
        Result<Object> result = Result.ok();

        Result<Object> returned = result.withTraceId("trace-123");

        assertSame(result, returned);
        assertEquals("trace-123", result.getTraceId());
    }

    @Test
    @DisplayName("withTraceId_成功响应链式调用_保留所有字段")
    void withTraceId_chainedAfterOk_preservesAllFields() {
        Result<String> result = Result.ok("data").withTraceId("trace-456");

        assertEquals(200, result.getCode());
        assertEquals("success", result.getMessage());
        assertEquals("data", result.getData());
        assertEquals("trace-456", result.getTraceId());
    }
}
