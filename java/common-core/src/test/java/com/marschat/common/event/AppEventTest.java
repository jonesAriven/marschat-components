package com.marschat.common.event;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * AppEvent v2 跨服务事件单元测试
 */
@DisplayName("AppEvent v2 跨服务事件单元测试")
class AppEventTest {

    @Test
    @DisplayName("全参构造_设置event/entityId/payload且timestamp/eventId非空")
    void allArgsConstructor_setsFieldsAndTimestamp() {
        Map<String, Object> payload = new HashMap<>();
        payload.put("key", "value");

        AppEvent event = new AppEvent(AppEvent.FILE_PARSED, 100L, payload);

        assertEquals(AppEvent.FILE_PARSED, event.getEvent());
        assertEquals(100L, event.getEntityId());
        assertSame(payload, event.getPayload());
        assertNotNull(event.getTimestamp());
        assertNotNull(event.getEventId(), "v2 新增：eventId 应自动生成");
        assertEquals("v2", event.getVersion(), "v2 新增：version 默认 v2");
    }

    @Test
    @DisplayName("全参构造_指定source_设置source字段")
    void allArgsConstructor_withSource_setsSource() {
        AppEvent event = new AppEvent(AppEvent.FILE_DELETED, 1L, null, "kb-file");

        assertEquals("kb-file", event.getSource());
        assertNotNull(event.getEventId());
    }

    @Test
    @DisplayName("全参构造_timestamp接近当前时间")
    void allArgsConstructor_timestampCloseToNow() {
        Instant before = Instant.now();

        AppEvent event = new AppEvent("file.parsed", 1L, null);

        Instant after = Instant.now();
        assertNotNull(event.getTimestamp());
        assertTrue(!event.getTimestamp().isBefore(before));
        assertTrue(!event.getTimestamp().isAfter(after));
    }

    @Test
    @DisplayName("全参构造_payload为null_字段保留null但timestamp和eventId已设置")
    void allArgsConstructor_nullPayload_keepsNullButSetsTimestamp() {
        AppEvent event = new AppEvent("file.deleted", 2L, null);

        assertEquals("file.deleted", event.getEvent());
        assertEquals(2L, event.getEntityId());
        assertNull(event.getPayload());
        assertNotNull(event.getTimestamp());
        assertNull(event.getSource());
        assertNotNull(event.getEventId(), "v2 新增：payload 为 null 时 eventId 仍应生成");
    }

    @Test
    @DisplayName("全参构造_entityId为null_字段保留null")
    void allArgsConstructor_nullEntityId_keepsNull() {
        AppEvent event = new AppEvent("file.reparse", null, null);

        assertEquals("file.reparse", event.getEvent());
        assertNull(event.getEntityId());
    }

    @Test
    @DisplayName("无参构造_event/entityId/payload/timestamp/source为null但version默认v2")
    void noArgsConstructor_allFieldsDefault() {
        AppEvent event = new AppEvent();

        assertNull(event.getEvent());
        assertNull(event.getEntityId());
        assertNull(event.getPayload());
        assertNull(event.getTimestamp());
        assertNull(event.getSource());
        assertNull(event.getEventId());
        assertEquals("v2", event.getVersion(), "v2 新增：无参构造 version 默认 v2");
    }

    @Test
    @DisplayName("setter_设置所有字段_getter返回正确值")
    void setters_setAllFields() {
        AppEvent event = new AppEvent();
        Map<String, Object> payload = Map.of("k", "v");

        event.setEvent(AppEvent.FILE_REPARSE);
        event.setEntityId(99L);
        event.setPayload(payload);
        event.setTimestamp(Instant.parse("2026-01-01T00:00:00Z"));
        event.setSource("kb-file");
        event.setEventId("evt-123");
        event.setVersion("v3");
        event.setTraceId("trace-abc");

        assertEquals(AppEvent.FILE_REPARSE, event.getEvent());
        assertEquals(99L, event.getEntityId());
        assertSame(payload, event.getPayload());
        assertEquals(Instant.parse("2026-01-01T00:00:00Z"), event.getTimestamp());
        assertEquals("kb-file", event.getSource());
        assertEquals("evt-123", event.getEventId());
        assertEquals("v3", event.getVersion());
        assertEquals("trace-abc", event.getTraceId());
    }

    @Test
    @DisplayName("常量_文件事件类型值正确")
    void constants_fileEventTypesCorrect() {
        assertEquals("file.parsed", AppEvent.FILE_PARSED);
        assertEquals("file.deleted", AppEvent.FILE_DELETED);
        assertEquals("file.reparse", AppEvent.FILE_REPARSE);
        assertEquals("file.permanent_deleted", AppEvent.FILE_PERMANENT_DELETED);
        assertEquals("file.trash_emptied", AppEvent.FILE_TRASH_EMPTIED);
    }

    @Test
    @DisplayName("常量_知识库事件类型值正确")
    void constants_knowledgeEventTypesCorrect() {
        assertEquals("doc.created", AppEvent.DOC_CREATED);
        assertEquals("doc.updated", AppEvent.DOC_UPDATED);
        assertEquals("doc.deleted", AppEvent.DOC_DELETED);
        assertEquals("web.collected", AppEvent.WEB_COLLECTED);
        assertEquals("web.deleted", AppEvent.WEB_DELETED);
        assertEquals("share.created", AppEvent.SHARE_CREATED);
        assertEquals("share.deleted", AppEvent.SHARE_DELETED);
        assertEquals("folder.created", AppEvent.FOLDER_CREATED);
        assertEquals("folder.deleted", AppEvent.FOLDER_DELETED);
        assertEquals("space.created", AppEvent.SPACE_CREATED);
        assertEquals("space.deleted", AppEvent.SPACE_DELETED);
        assertEquals("tag.created", AppEvent.TAG_CREATED);
        assertEquals("tag.deleted", AppEvent.TAG_DELETED);
    }

    @Test
    @DisplayName("常量_事件流通道和消费者组正确")
    void constants_streamsAndGroupsCorrect() {
        assertEquals("kb:streams:file-events", AppEvent.STREAM_FILE_EVENTS);
        assertEquals("kb:streams:knowledge-events", AppEvent.STREAM_KNOWLEDGE_EVENTS);
        assertEquals("kb:streams:share-events", AppEvent.STREAM_SHARE_EVENTS);
        assertEquals("kb:streams:dead-letter", AppEvent.STREAM_DEAD_LETTER);
        assertEquals("kb-knowledge-group", AppEvent.GROUP_KNOWLEDGE);
        assertEquals("kb-intelligence-group", AppEvent.GROUP_INTELLIGENCE);
    }

    @Test
    @DisplayName("全参构造_使用所有事件类型常量_构造成功")
    void allArgsConstructor_withAllEventConstants_constructsSuccessfully() {
        assertDoesNotThrow(() -> new AppEvent(AppEvent.FILE_PARSED, 1L, null));
        assertDoesNotThrow(() -> new AppEvent(AppEvent.FILE_DELETED, 2L, null));
        assertDoesNotThrow(() -> new AppEvent(AppEvent.FILE_REPARSE, 3L, null));
        assertDoesNotThrow(() -> new AppEvent(AppEvent.FILE_PERMANENT_DELETED, 4L, null));
        assertDoesNotThrow(() -> new AppEvent(AppEvent.FILE_TRASH_EMPTIED, null, null));
        assertDoesNotThrow(() -> new AppEvent(AppEvent.DOC_CREATED, 5L, null));
        assertDoesNotThrow(() -> new AppEvent(AppEvent.SHARE_CREATED, 6L, null));
    }

    @Test
    @DisplayName("每次构造_eventId唯一")
    void allArgsConstructor_eventIdUnique() {
        AppEvent e1 = new AppEvent("test", 1L, null);
        AppEvent e2 = new AppEvent("test", 1L, null);

        assertNotEquals(e1.getEventId(), e2.getEventId(), "eventId 应唯一");
    }
}
