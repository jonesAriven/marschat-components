package com.marschat.common.assertor;

import com.marschat.common.exception.BusinessException;
import com.marschat.common.exception.NotFoundException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * AssertException 异常断言单元测试
 */
@DisplayName("AssertException 异常断言单元测试")
class AssertExceptionTest {

    @Test
    @DisplayName("assertBusinessException_匹配code_断言通过")
    void assertBusinessException_matchingCode_passes() {
        assertDoesNotThrow(() ->
                AssertException.assertBusinessException(
                        () -> { throw new BusinessException(404, "不存在"); },
                        404
                )
        );
    }

    @Test
    @DisplayName("assertBusinessException_子类异常匹配code_断言通过")
    void assertBusinessException_subClassMatchingCode_passes() {
        assertDoesNotThrow(() ->
                AssertException.assertBusinessException(
                        () -> { throw new NotFoundException("用户", 1L); },
                        404
                )
        );
    }

    @Test
    @DisplayName("assertBusinessException_code不匹配_抛出AssertionError")
    void assertBusinessException_wrongCode_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class, () ->
                AssertException.assertBusinessException(
                        () -> { throw new BusinessException(403, "无权限"); },
                        404
                )
        );
        assertTrue(ex.getMessage().contains("预期错误码=404"));
    }

    @Test
    @DisplayName("assertBusinessException_未抛出异常_抛出AssertionError")
    void assertBusinessException_noException_throwsAssertionError() {
        assertThrows(AssertionError.class, () ->
                AssertException.assertBusinessException(() -> {}, 404)
        );
    }

    @Test
    @DisplayName("assertBusinessException_抛出非BusinessException_抛出AssertionError")
    void assertBusinessException_otherException_throwsAssertionError() {
        assertThrows(AssertionError.class, () ->
                AssertException.assertBusinessException(
                        () -> { throw new RuntimeException("其他异常"); },
                        404
                )
        );
    }

    @Test
    @DisplayName("assertBusinessException_带message校验_匹配通过")
    void assertBusinessException_withMessageCheck_passes() {
        assertDoesNotThrow(() ->
                AssertException.assertBusinessException(
                        () -> { throw new BusinessException(404, "用户不存在"); },
                        404,
                        "用户"
                )
        );
    }

    @Test
    @DisplayName("assertBusinessException_带message校验_message不匹配_抛出AssertionError")
    void assertBusinessException_withMessageCheck_mismatch_throwsAssertionError() {
        assertThrows(AssertionError.class, () ->
                AssertException.assertBusinessException(
                        () -> { throw new BusinessException(404, "资源不存在"); },
                        404,
                        "用户"
                )
        );
    }

    @Test
    @DisplayName("assertNoException_无异常_断言通过")
    void assertNoException_noException_passes() {
        assertDoesNotThrow(() -> AssertException.assertNoException(() -> {
            int sum = 1 + 1;
            assertEquals(2, sum);
        }));
    }

    @Test
    @DisplayName("assertNoException_抛出异常_抛出AssertionError")
    void assertNoException_throwsException_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class, () ->
                AssertException.assertNoException(() -> { throw new RuntimeException("boom"); })
        );
        assertTrue(ex.getMessage().contains("boom"));
    }

    @Test
    @DisplayName("assertExceptionType_类型匹配_断言通过")
    void assertExceptionType_matchingType_passes() {
        assertDoesNotThrow(() ->
                AssertException.assertExceptionType(
                        () -> { throw new NotFoundException("test", 1L); },
                        NotFoundException.class
                )
        );
    }

    @Test
    @DisplayName("assertExceptionType_父类型匹配_断言通过")
    void assertExceptionType_superTypeMatching_passes() {
        assertDoesNotThrow(() ->
                AssertException.assertExceptionType(
                        () -> { throw new NotFoundException("test", 1L); },
                        BusinessException.class
                )
        );
    }

    @Test
    @DisplayName("assertExceptionType_类型不匹配_抛出AssertionError")
    void assertExceptionType_wrongType_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class, () ->
                AssertException.assertExceptionType(
                        () -> { throw new RuntimeException("其他"); },
                        BusinessException.class
                )
        );
        assertTrue(ex.getMessage().contains("BusinessException"));
    }

    @Test
    @DisplayName("assertExceptionType_未抛出异常_抛出AssertionError")
    void assertExceptionType_noException_throwsAssertionError() {
        assertThrows(AssertionError.class, () ->
                AssertException.assertExceptionType(() -> {}, BusinessException.class)
        );
    }

    @Test
    @DisplayName("assertBusinessException_null动作_抛出AssertionError")
    void assertBusinessException_nullAction_throwsAssertionError() {
        assertThrows(AssertionError.class, () ->
                AssertException.assertBusinessException(null, 404)
        );
    }

    @Test
    @DisplayName("assertNoException_null动作_抛出AssertionError")
    void assertNoException_nullAction_throwsAssertionError() {
        assertThrows(AssertionError.class, () ->
                AssertException.assertNoException(null)
        );
    }

    @Test
    @DisplayName("assertExceptionType_null预期类型_抛出AssertionError")
    void assertExceptionType_nullExpectedType_throwsAssertionError() {
        assertThrows(AssertionError.class, () ->
                AssertException.assertExceptionType(() -> {}, null)
        );
    }

    @Test
    @DisplayName("assertBusinessException_带message校验_code不匹配_抛出AssertionError")
    void assertBusinessException_withMessageCheck_wrongCode_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class, () ->
                AssertException.assertBusinessException(
                        () -> { throw new BusinessException(403, "无权限"); },
                        404,
                        "无权限"
                )
        );
        assertTrue(ex.getMessage().contains("预期错误码=404"));
    }

    @Test
    @DisplayName("assertExceptionType_null动作_抛出AssertionError")
    void assertExceptionType_nullAction_throwsAssertionError() {
        assertThrows(AssertionError.class, () ->
                AssertException.assertExceptionType(null, BusinessException.class)
        );
    }

    @Test
    @DisplayName("私有构造器_反射调用_实例化成功")
    void privateConstructor_canBeInvokedViaReflection() throws Exception {
        java.lang.reflect.Constructor<AssertException> constructor =
                AssertException.class.getDeclaredConstructor();
        constructor.setAccessible(true);
        AssertException instance = constructor.newInstance();
        assertNotNull(instance);
    }
}
