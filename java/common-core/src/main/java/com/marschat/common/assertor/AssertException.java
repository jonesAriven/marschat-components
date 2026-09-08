package com.marschat.common.assertor;

import com.marschat.common.exception.BusinessException;

/**
 * 异常断言（SOP 2.5）
 * <p>
 * 封装对 Runnable 执行时的异常断言逻辑。
 * 使用纯 Java 抛出 {@link AssertionError}，不绑定具体测试框架。
 */
public final class AssertException {

    private AssertException() {}

    /**
     * 断言抛出 {@link BusinessException} 且 code 匹配预期值
     */
    public static void assertBusinessException(Runnable action, int expectedCode) {
        assertNotNull(action, "被测动作不能为 null");
        BusinessException ex = assertThrowsBusinessException(action);
        if (ex.getCode() != expectedCode) {
            throw new AssertionError("预期错误码=" + expectedCode + "，实际 code=" + ex.getCode());
        }
    }

    /**
     * 断言抛出 {@link BusinessException} 且 code 匹配预期值，并校验 message 包含关键字
     */
    public static void assertBusinessException(Runnable action, int expectedCode, String messageContains) {
        assertNotNull(action, "被测动作不能为 null");
        BusinessException ex = assertThrowsBusinessException(action);
        if (ex.getCode() != expectedCode) {
            throw new AssertionError("预期错误码=" + expectedCode + "，实际 code=" + ex.getCode());
        }
        if (ex.getMessage() == null || !ex.getMessage().contains(messageContains)) {
            throw new AssertionError("预期 message 包含 [" + messageContains + "]，实际 message=" + ex.getMessage());
        }
    }

    /**
     * 断言不抛出任何异常
     */
    public static void assertNoException(Runnable action) {
        assertNotNull(action, "被测动作不能为 null");
        try {
            action.run();
        } catch (Exception e) {
            throw new AssertionError("预期不抛出异常，但实际抛出：" + e.getClass().getName() + ": " + e.getMessage());
        }
    }

    /**
     * 断言抛出指定类型的异常
     */
    public static void assertExceptionType(Runnable action, Class<? extends Exception> expectedType) {
        assertNotNull(action, "被测动作不能为 null");
        assertNotNull(expectedType, "预期异常类型不能为 null");
        try {
            action.run();
        } catch (Exception e) {
            if (expectedType.isInstance(e)) {
                return;
            }
            throw new AssertionError("预期抛出 " + expectedType.getName() + "，实际抛出 " + e.getClass().getName());
        }
        throw new AssertionError("预期抛出 " + expectedType.getName() + "，但未抛出任何异常");
    }

    private static BusinessException assertThrowsBusinessException(Runnable action) {
        try {
            action.run();
        } catch (BusinessException e) {
            return e;
        } catch (Exception e) {
            throw new AssertionError("预期抛出 BusinessException，实际抛出 " + e.getClass().getName() + ": " + e.getMessage());
        }
        throw new AssertionError("预期抛出 BusinessException，但未抛出任何异常");
    }

    private static void assertNotNull(Object obj, String message) {
        if (obj == null) {
            throw new AssertionError(message);
        }
    }
}
