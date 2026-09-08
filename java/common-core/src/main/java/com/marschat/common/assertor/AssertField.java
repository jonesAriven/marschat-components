package com.marschat.common.assertor;

import java.lang.reflect.Field;
import java.util.Objects;

/**
 * 字段断言（SOP 2.5）
 * <p>
 * 封装对实体字段的业务级断言，通过反射支持任意实体。
 * 使用纯 Java 抛出 {@link AssertionError}，不绑定具体测试框架。
 */
public final class AssertField {

    private AssertField() {}

    /**
     * 断言字符串非空且非空白
     */
    public static void assertNotBlank(String fieldName, String value) {
        if (value == null) {
            throw new AssertionError(fieldName + " 不能为 null");
        }
        if (value.trim().isEmpty()) {
            throw new AssertionError(fieldName + " 不能为空白");
        }
    }

    /**
     * 断言 ID 非空且为正数
     */
    public static void assertIdNotNull(Long id) {
        if (id == null) {
            throw new AssertionError("ID 不能为 null");
        }
        if (id <= 0) {
            throw new AssertionError("ID 必须为正数，实际=" + id);
        }
    }

    /**
     * 断言实体已创建：通过反射获取 id 字段，断言非空
     */
    public static void assertCreated(Object entity) {
        if (entity == null) {
            throw new AssertionError("实体不能为 null");
        }
        Object idValue = getFieldValue(entity, "id");
        if (idValue == null) {
            throw new AssertionError("实体 id 不能为 null（未创建）");
        }
    }

    /**
     * 断言实体已更新：before 与 after 在指定字段上值不同
     *
     * @param before 更新前实体
     * @param after  更新后实体
     * @param fields 需要校验已变更的字段名
     */
    public static void assertUpdated(Object before, Object after, String... fields) {
        if (before == null) {
            throw new AssertionError("before 实体不能为 null");
        }
        if (after == null) {
            throw new AssertionError("after 实体不能为 null");
        }
        if (fields == null) {
            throw new AssertionError("校验字段不能为 null");
        }
        if (fields.length == 0) {
            throw new AssertionError("至少需要指定一个校验字段");
        }

        for (String fieldName : fields) {
            Object beforeValue = getFieldValue(before, fieldName);
            Object afterValue = getFieldValue(after, fieldName);
            if (Objects.equals(beforeValue, afterValue)) {
                throw new AssertionError("字段 [" + fieldName + "] 预期已更新，但值未变化：before=" + beforeValue + "，after=" + afterValue);
            }
        }
    }

    /**
     * 通过反射获取字段值（支持父类字段）
     */
    private static Object getFieldValue(Object entity, String fieldName) {
        Class<?> clazz = entity.getClass();
        while (clazz != null) {
            try {
                Field field = clazz.getDeclaredField(fieldName);
                field.setAccessible(true);
                return field.get(entity);
            } catch (NoSuchFieldException e) {
                clazz = clazz.getSuperclass();
            } catch (IllegalAccessException e) {
                throw new AssertionError("无法访问字段 [" + fieldName + "]: " + e.getMessage());
            }
        }
        throw new AssertionError("实体 " + entity.getClass().getName() + " 及其父类中不存在字段 [" + fieldName + "]");
    }
}
