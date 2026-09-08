package com.marschat.common.assertor;

import com.marschat.common.exception.BusinessException;
import com.marschat.common.result.Result;

/**
 * 业务断言门面（SOP 2.5）
 * <p>
 * 聚合 {@link AssertResult}、{@link AssertException}、{@link AssertField} 的快捷入口。
 * 测试中可直接通过此类调用所有断言方法，统一断言风格。
 *
 * <pre>{@code
 *   CommonAssertions.assertSuccess(result);
 *   CommonAssertions.assertBusinessException(() -> service.login(req), 401);
 *   CommonAssertions.assertCreated(savedUser);
 * }</pre>
 */
public final class CommonAssertions {

    private CommonAssertions() {}

    // ===== 统一响应断言（委托 AssertResult）=====

    public static void assertSuccess(Result<?> result) {
        AssertResult.assertSuccess(result);
    }

    public static void assertBusinessError(Result<?> result, int expectedCode) {
        AssertResult.assertBusinessError(result, expectedCode);
    }

    public static void assertDataNotNull(Result<?> result) {
        AssertResult.assertDataNotNull(result);
    }

    public static void assertPageResult(Result<?> result, long expectedTotal) {
        AssertResult.assertPageResult(result, expectedTotal);
    }

    // ===== 异常断言（委托 AssertException）=====

    public static void assertBusinessException(Runnable action, int expectedCode) {
        AssertException.assertBusinessException(action, expectedCode);
    }

    public static void assertBusinessException(Runnable action, int expectedCode, String messageContains) {
        AssertException.assertBusinessException(action, expectedCode, messageContains);
    }

    public static void assertNoException(Runnable action) {
        AssertException.assertNoException(action);
    }

    public static void assertExceptionType(Runnable action, Class<? extends Exception> expectedType) {
        AssertException.assertExceptionType(action, expectedType);
    }

    // ===== 字段断言（委托 AssertField）=====

    public static void assertNotBlank(String fieldName, String value) {
        AssertField.assertNotBlank(fieldName, value);
    }

    public static void assertIdNotNull(Long id) {
        AssertField.assertIdNotNull(id);
    }

    public static void assertCreated(Object entity) {
        AssertField.assertCreated(entity);
    }

    public static void assertUpdated(Object before, Object after, String... fields) {
        AssertField.assertUpdated(before, after, fields);
    }
}
