package com.marschat.common.assertor;

import com.marschat.common.page.PageResult;
import com.marschat.common.result.Result;

/**
 * 统一响应断言（SOP 2.5）
 * <p>
 * 封装对 {@link Result} 的业务级断言，不止是简单的值相等判断。
 * 使用纯 Java 抛出 {@link AssertionError}，不绑定具体测试框架，
 * 可被 JUnit5 / TestNG 等任何测试框架捕获。
 */
public final class AssertResult {

    private AssertResult() {}

    /**
     * 断言响应成功：code=200 且 message=success
     */
    public static void assertSuccess(Result<?> result) {
        assertNotNull(result, "Result 不能为 null");
        if (result.getCode() != 200) {
            throw new AssertionError("预期成功(code=200)，实际 code=" + result.getCode() + "，message=" + result.getMessage());
        }
        if (!"success".equals(result.getMessage())) {
            throw new AssertionError("成功响应 message 应为 success，实际=" + result.getMessage());
        }
    }

    /**
     * 断言业务错误：code 等于预期错误码，且非成功响应
     */
    public static void assertBusinessError(Result<?> result, int expectedCode) {
        assertNotNull(result, "Result 不能为 null");
        if (result.getCode() == 200) {
            throw new AssertionError("预期业务错误，但实际为成功响应");
        }
        if (result.getCode() != expectedCode) {
            throw new AssertionError("预期错误码=" + expectedCode + "，实际 code=" + result.getCode());
        }
        if (result.getMessage() == null) {
            throw new AssertionError("业务错误响应 message 不能为 null");
        }
    }

    /**
     * 断言响应成功且 data 非空
     */
    public static void assertDataNotNull(Result<?> result) {
        assertSuccess(result);
        if (result.getData() == null) {
            throw new AssertionError("预期 data 非空，但实际为 null");
        }
    }

    /**
     * 断言响应为分页结果，且总数等于预期值
     */
    public static void assertPageResult(Result<?> result, long expectedTotal) {
        assertSuccess(result);
        if (result.getData() == null) {
            throw new AssertionError("分页结果 data 不能为 null");
        }
        if (!(result.getData() instanceof PageResult)) {
            throw new AssertionError("预期 data 为 PageResult，实际类型=" + result.getData().getClass().getName());
        }
        PageResult<?> pageResult = (PageResult<?>) result.getData();
        if (pageResult.getTotal() != expectedTotal) {
            throw new AssertionError("预期总数=" + expectedTotal + "，实际 total=" + pageResult.getTotal());
        }
        if (pageResult.getList() == null) {
            throw new AssertionError("分页结果 list 不能为 null");
        }
    }

    private static void assertNotNull(Object obj, String message) {
        if (obj == null) {
            throw new AssertionError(message);
        }
    }
}
