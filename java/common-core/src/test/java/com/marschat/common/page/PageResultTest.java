package com.marschat.common.page;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * PageResult 分页结果单元测试
 */
@DisplayName("PageResult 分页结果单元测试")
class PageResultTest {

    @Test
    @DisplayName("of_创建分页结果_所有字段正确")
    void of_createsPageResultWithAllFields() {
        List<String> list = Arrays.asList("a", "b", "c");

        PageResult<String> result = PageResult.of(list, 3L, 1, 10);

        assertEquals(list, result.getList());
        assertEquals(3L, result.getTotal());
        assertEquals(1, result.getPage());
        assertEquals(10, result.getSize());
    }

    @Test
    @DisplayName("of_空列表_total为0")
    void of_emptyList_totalZero() {
        PageResult<String> result = PageResult.of(Collections.emptyList(), 0L, 1, 10);

        assertTrue(result.getList().isEmpty());
        assertEquals(0L, result.getTotal());
    }

    @Test
    @DisplayName("of_单元素列表_total为1")
    void of_singleElement_totalOne() {
        PageResult<String> result = PageResult.of(Collections.singletonList("only"), 1L, 1, 10);

        assertEquals(1, result.getList().size());
        assertEquals("only", result.getList().get(0));
        assertEquals(1L, result.getTotal());
    }

    @Test
    @DisplayName("of_分页超出总数_返回空列表但total保留")
    void of_pageBeyondTotal_returnsEmptyListWithFullTotal() {
        PageResult<String> result = PageResult.of(Collections.emptyList(), 100L, 11, 10);

        assertTrue(result.getList().isEmpty());
        assertEquals(100L, result.getTotal());
        assertEquals(11, result.getPage());
        assertEquals(10, result.getSize());
    }

    @Test
    @DisplayName("无参构造_创建空对象_所有字段为默认值")
    void noArgsConstructor_createsEmptyObject() {
        PageResult<String> result = new PageResult<>();

        assertNull(result.getList());
        assertEquals(0L, result.getTotal());
        assertEquals(0, result.getPage());
        assertEquals(0, result.getSize());
    }

    @Test
    @DisplayName("全参构造_创建对象_所有字段正确")
    void allArgsConstructor_createsObjectWithAllFields() {
        List<Integer> list = Arrays.asList(1, 2);
        PageResult<Integer> result = new PageResult<>(list, 2L, 1, 20);

        assertEquals(list, result.getList());
        assertEquals(2L, result.getTotal());
        assertEquals(1, result.getPage());
        assertEquals(20, result.getSize());
    }

    @Test
    @DisplayName("setter_设置字段_值正确返回")
    void setters_setFieldsCorrectly() {
        PageResult<String> result = new PageResult<>();
        result.setList(Collections.singletonList("x"));
        result.setTotal(1L);
        result.setPage(2);
        result.setSize(5);

        assertEquals(1, result.getList().size());
        assertEquals(1L, result.getTotal());
        assertEquals(2, result.getPage());
        assertEquals(5, result.getSize());
    }
}
