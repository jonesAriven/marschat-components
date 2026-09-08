package com.marschat.common.assertor;

import com.marschat.common.page.PageResult;
import com.marschat.common.result.Result;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;

/**
 * AssertResult 统一响应断言单元测试
 */
@DisplayName("AssertResult 统一响应断言单元测试")
class AssertResultTest {

    @Test
    @DisplayName("assertSuccess_成功响应_断言通过")
    void assertSuccess_validResult_passes() {
        Result<String> result = Result.ok("data");

        assertDoesNotThrow(() -> AssertResult.assertSuccess(result));
    }

    @Test
    @DisplayName("assertSuccess_无数据成功响应_断言通过")
    void assertSuccess_okWithoutData_passes() {
        Result<Object> result = Result.ok();

        assertDoesNotThrow(() -> AssertResult.assertSuccess(result));
    }

    @Test
    @DisplayName("assertSuccess_null结果_抛出AssertionError")
    void assertSuccess_nullResult_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class, () -> AssertResult.assertSuccess(null));
        assertTrue(ex.getMessage().contains("Result 不能为 null"));
    }

    @Test
    @DisplayName("assertSuccess_错误码_抛出AssertionError")
    void assertSuccess_wrongCode_throwsAssertionError() {
        Result<Object> result = Result.fail(404, "不存在");

        AssertionError ex = assertThrows(AssertionError.class, () -> AssertResult.assertSuccess(result));
        assertTrue(ex.getMessage().contains("code=200"));
    }

    @Test
    @DisplayName("assertBusinessError_匹配错误码_断言通过")
    void assertBusinessError_matchingCode_passes() {
        Result<Object> result = Result.fail(404, "资源不存在");

        assertDoesNotThrow(() -> AssertResult.assertBusinessError(result, 404));
    }

    @Test
    @DisplayName("assertBusinessError_成功响应_抛出AssertionError")
    void assertBusinessError_successResponse_throwsAssertionError() {
        Result<Object> result = Result.ok();

        assertThrows(AssertionError.class, () -> AssertResult.assertBusinessError(result, 404));
    }

    @Test
    @DisplayName("assertBusinessError_错误码不匹配_抛出AssertionError")
    void assertBusinessError_wrongCode_throwsAssertionError() {
        Result<Object> result = Result.fail(403, "无权限");

        AssertionError ex = assertThrows(AssertionError.class, () -> AssertResult.assertBusinessError(result, 404));
        assertTrue(ex.getMessage().contains("预期错误码=404"));
    }

    @Test
    @DisplayName("assertBusinessError_null结果_抛出AssertionError")
    void assertBusinessError_nullResult_throwsAssertionError() {
        assertThrows(AssertionError.class, () -> AssertResult.assertBusinessError(null, 404));
    }

    @Test
    @DisplayName("assertDataNotNull_非空data_断言通过")
    void assertDataNotNull_validData_passes() {
        Result<String> result = Result.ok("data");

        assertDoesNotThrow(() -> AssertResult.assertDataNotNull(result));
    }

    @Test
    @DisplayName("assertDataNotNull_null的data_抛出AssertionError")
    void assertDataNotNull_nullData_throwsAssertionError() {
        Result<Object> result = Result.ok();

        AssertionError ex = assertThrows(AssertionError.class, () -> AssertResult.assertDataNotNull(result));
        assertTrue(ex.getMessage().contains("data 非空"));
    }

    @Test
    @DisplayName("assertPageResult_有效分页_断言通过")
    void assertPageResult_validPage_passes() {
        PageResult<String> page = PageResult.of(Arrays.asList("a", "b"), 2L, 1, 10);
        Result<PageResult<String>> result = Result.ok(page);

        assertDoesNotThrow(() -> AssertResult.assertPageResult(result, 2L));
    }

    @Test
    @DisplayName("assertPageResult_总数不匹配_抛出AssertionError")
    void assertPageResult_wrongTotal_throwsAssertionError() {
        PageResult<String> page = PageResult.of(Arrays.asList("a"), 1L, 1, 10);
        Result<PageResult<String>> result = Result.ok(page);

        AssertionError ex = assertThrows(AssertionError.class, () -> AssertResult.assertPageResult(result, 100L));
        assertTrue(ex.getMessage().contains("预期总数=100"));
    }

    @Test
    @DisplayName("assertPageResult_data非PageResult类型_抛出AssertionError")
    void assertPageResult_nonPageResultData_throwsAssertionError() {
        Result<String> result = Result.ok("not a page");

        AssertionError ex = assertThrows(AssertionError.class, () -> AssertResult.assertPageResult(result, 0L));
        assertTrue(ex.getMessage().contains("PageResult"));
    }

    @Test
    @DisplayName("assertPageResult_null的data_抛出AssertionError")
    void assertPageResult_nullData_throwsAssertionError() {
        Result<Object> result = Result.ok();

        assertThrows(AssertionError.class, () -> AssertResult.assertPageResult(result, 0L));
    }

    @Test
    @DisplayName("assertSuccess_code为200但message非success_抛出AssertionError")
    void assertSuccess_wrongMessage_throwsAssertionError() {
        Result<Object> result = Result.ok();
        result.setMessage("wrong");

        AssertionError ex = assertThrows(AssertionError.class, () -> AssertResult.assertSuccess(result));
        assertTrue(ex.getMessage().contains("success"));
    }

    @Test
    @DisplayName("assertBusinessError_匹配code但message为null_抛出AssertionError")
    void assertBusinessError_nullMessage_throwsAssertionError() {
        Result<Object> result = Result.fail(404, "不存在");
        result.setMessage(null);

        AssertionError ex = assertThrows(AssertionError.class, () -> AssertResult.assertBusinessError(result, 404));
        assertTrue(ex.getMessage().contains("message 不能为 null"));
    }

    @Test
    @DisplayName("assertPageResult_list为null_抛出AssertionError")
    void assertPageResult_nullList_throwsAssertionError() {
        PageResult<String> page = new PageResult<>(null, 1L, 1, 10);
        Result<PageResult<String>> result = Result.ok(page);

        AssertionError ex = assertThrows(AssertionError.class, () -> AssertResult.assertPageResult(result, 1L));
        assertTrue(ex.getMessage().contains("list 不能为 null"));
    }

    @Test
    @DisplayName("私有构造器_反射调用_实例化成功")
    void privateConstructor_canBeInvokedViaReflection() throws Exception {
        java.lang.reflect.Constructor<AssertResult> constructor =
                AssertResult.class.getDeclaredConstructor();
        constructor.setAccessible(true);
        AssertResult instance = constructor.newInstance();
        assertNotNull(instance);
    }
}
