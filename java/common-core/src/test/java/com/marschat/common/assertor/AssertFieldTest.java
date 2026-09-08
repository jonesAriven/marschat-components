package com.marschat.common.assertor;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * AssertField 字段断言单元测试
 */
@DisplayName("AssertField 字段断言单元测试")
class AssertFieldTest {

    // ===== assertNotBlank =====

    @Test
    @DisplayName("assertNotBlank_非空字符串_断言通过")
    void assertNotBlank_validString_passes() {
        assertDoesNotThrow(() -> AssertField.assertNotBlank("name", "hello"));
    }

    @Test
    @DisplayName("assertNotBlank_带空格字符串_断言通过")
    void assertNotBlank_stringWithSpaces_passes() {
        assertDoesNotThrow(() -> AssertField.assertNotBlank("name", "  hello  "));
    }

    @Test
    @DisplayName("assertNotBlank_null_抛出AssertionError且消息含字段名")
    void assertNotBlank_null_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertNotBlank("name", null));
        assertTrue(ex.getMessage().contains("name"));
        assertTrue(ex.getMessage().contains("null"));
    }

    @Test
    @DisplayName("assertNotBlank_空字符串_抛出AssertionError")
    void assertNotBlank_emptyString_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertNotBlank("name", ""));
        assertTrue(ex.getMessage().contains("空白"));
    }

    @Test
    @DisplayName("assertNotBlank_纯空格_抛出AssertionError")
    void assertNotBlank_blankString_throwsAssertionError() {
        assertThrows(AssertionError.class,
                () -> AssertField.assertNotBlank("name", "   "));
    }

    // ===== assertIdNotNull =====

    @Test
    @DisplayName("assertIdNotNull_正数ID_断言通过")
    void assertIdNotNull_positiveId_passes() {
        assertDoesNotThrow(() -> AssertField.assertIdNotNull(1L));
    }

    @Test
    @DisplayName("assertIdNotNull_大数ID_断言通过")
    void assertIdNotNull_largeId_passes() {
        assertDoesNotThrow(() -> AssertField.assertIdNotNull(Long.MAX_VALUE));
    }

    @Test
    @DisplayName("assertIdNotNull_null_抛出AssertionError")
    void assertIdNotNull_null_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertIdNotNull(null));
        assertTrue(ex.getMessage().contains("null"));
    }

    @Test
    @DisplayName("assertIdNotNull_零_抛出AssertionError")
    void assertIdNotNull_zero_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertIdNotNull(0L));
        assertTrue(ex.getMessage().contains("正数"));
        assertTrue(ex.getMessage().contains("0"));
    }

    @Test
    @DisplayName("assertIdNotNull_负数_抛出AssertionError")
    void assertIdNotNull_negative_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertIdNotNull(-5L));
        assertTrue(ex.getMessage().contains("正数"));
        assertTrue(ex.getMessage().contains("-5"));
    }

    // ===== assertCreated =====

    @Test
    @DisplayName("assertCreated_实体有id_断言通过")
    void assertCreated_entityWithId_passes() {
        SampleEntity entity = new SampleEntity();
        entity.id = 1L;

        assertDoesNotThrow(() -> AssertField.assertCreated(entity));
    }

    @Test
    @DisplayName("assertCreated_实体id为null_抛出AssertionError")
    void assertCreated_entityWithNullId_throwsAssertionError() {
        SampleEntity entity = new SampleEntity();

        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertCreated(entity));
        assertTrue(ex.getMessage().contains("id"));
    }

    @Test
    @DisplayName("assertCreated_null实体_抛出AssertionError")
    void assertCreated_nullEntity_throwsAssertionError() {
        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertCreated(null));
        assertTrue(ex.getMessage().contains("实体不能为 null"));
    }

    @Test
    @DisplayName("assertCreated_id在父类_断言通过")
    void assertCreated_idInSuperclass_passes() {
        ChildEntity entity = new ChildEntity();
        entity.id = 10L;

        assertDoesNotThrow(() -> AssertField.assertCreated(entity));
    }

    @Test
    @DisplayName("assertCreated_父类id为null_抛出AssertionError")
    void assertCreated_superclassIdNull_throwsAssertionError() {
        ChildEntity entity = new ChildEntity();

        assertThrows(AssertionError.class,
                () -> AssertField.assertCreated(entity));
    }

    @Test
    @DisplayName("assertCreated_实体无id字段_抛出AssertionError")
    void assertCreated_entityWithoutIdField_throwsAssertionError() {
        NoIdEntity entity = new NoIdEntity();

        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertCreated(entity));
        assertTrue(ex.getMessage().contains("不存在字段"));
        assertTrue(ex.getMessage().contains("id"));
    }

    // ===== assertUpdated =====

    @Test
    @DisplayName("assertUpdated_字段已变更_断言通过")
    void assertUpdated_fieldChanged_passes() {
        SampleEntity before = new SampleEntity();
        before.id = 1L;
        before.name = "old";
        SampleEntity after = new SampleEntity();
        after.id = 1L;
        after.name = "new";

        assertDoesNotThrow(() -> AssertField.assertUpdated(before, after, "name"));
    }

    @Test
    @DisplayName("assertUpdated_多字段全部变更_断言通过")
    void assertUpdated_multipleFields_allChanged_passes() {
        SampleEntity before = new SampleEntity();
        before.name = "old";
        before.value = 1;
        SampleEntity after = new SampleEntity();
        after.name = "new";
        after.value = 2;

        assertDoesNotThrow(() -> AssertField.assertUpdated(before, after, "name", "value"));
    }

    @Test
    @DisplayName("assertUpdated_字段未变更_抛出AssertionError")
    void assertUpdated_fieldUnchanged_throwsAssertionError() {
        SampleEntity before = new SampleEntity();
        before.name = "same";
        SampleEntity after = new SampleEntity();
        after.name = "same";

        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertUpdated(before, after, "name"));
        assertTrue(ex.getMessage().contains("name"));
        assertTrue(ex.getMessage().contains("未变化"));
    }

    @Test
    @DisplayName("assertUpdated_null before_抛出AssertionError")
    void assertUpdated_nullBefore_throwsAssertionError() {
        SampleEntity after = new SampleEntity();

        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertUpdated(null, after, "name"));
        assertTrue(ex.getMessage().contains("before"));
    }

    @Test
    @DisplayName("assertUpdated_null after_抛出AssertionError")
    void assertUpdated_nullAfter_throwsAssertionError() {
        SampleEntity before = new SampleEntity();

        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertUpdated(before, null, "name"));
        assertTrue(ex.getMessage().contains("after"));
    }

    @Test
    @DisplayName("assertUpdated_null fields_抛出AssertionError")
    void assertUpdated_nullFields_throwsAssertionError() {
        SampleEntity before = new SampleEntity();
        SampleEntity after = new SampleEntity();

        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertUpdated(before, after, (String[]) null));
        assertTrue(ex.getMessage().contains("字段不能为 null"));
    }

    @Test
    @DisplayName("assertUpdated_空fields_抛出AssertionError")
    void assertUpdated_emptyFields_throwsAssertionError() {
        SampleEntity before = new SampleEntity();
        SampleEntity after = new SampleEntity();

        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertUpdated(before, after));
        assertTrue(ex.getMessage().contains("至少需要指定一个"));
    }

    @Test
    @DisplayName("assertUpdated_字段不存在_抛出AssertionError")
    void assertUpdated_nonExistentField_throwsAssertionError() {
        SampleEntity before = new SampleEntity();
        SampleEntity after = new SampleEntity();

        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertUpdated(before, after, "nonExistent"));
        assertTrue(ex.getMessage().contains("不存在字段"));
    }

    @Test
    @DisplayName("assertUpdated_第一个字段变更第二个未变更_抛出AssertionError指向未变更字段")
    void assertUpdated_firstChangedSecondUnchanged_throwsForSecond() {
        SampleEntity before = new SampleEntity();
        before.name = "old";
        before.value = 1;
        SampleEntity after = new SampleEntity();
        after.name = "new";
        after.value = 1;

        AssertionError ex = assertThrows(AssertionError.class,
                () -> AssertField.assertUpdated(before, after, "name", "value"));
        assertTrue(ex.getMessage().contains("value"));
        assertTrue(ex.getMessage().contains("未变化"));
    }

    // ===== 私有构造器覆盖 =====

    @Test
    @DisplayName("私有构造器_反射调用_实例化成功")
    void privateConstructor_canBeInvokedViaReflection() throws Exception {
        java.lang.reflect.Constructor<AssertField> constructor =
                AssertField.class.getDeclaredConstructor();
        constructor.setAccessible(true);
        AssertField instance = constructor.newInstance();
        assertNotNull(instance);
    }

    // ===== 测试辅助实体 =====

    static class SampleEntity {
        Long id;
        String name;
        Integer value;
    }

    static class ParentEntity {
        Long id;
    }

    static class ChildEntity extends ParentEntity {
        String extra;
    }

    static class NoIdEntity {
        String other;
    }
}
