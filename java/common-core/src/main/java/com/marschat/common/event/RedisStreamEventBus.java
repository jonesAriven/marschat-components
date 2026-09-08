package com.marschat.common.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.HashMap;
import java.util.Map;

/**
 * 基于 Redis Streams 的事件总线实现（M4-M5 重构）
 * <p>
 * 替代原 Redis Pub/Sub 方案，提供：
 * - 持久化：事件存储在 Stream 中，消费者离线后重启可继续消费
 * - 消费者组：多个消费者独立 group，互不影响（kb-knowledge 一组，kb-intelligence 一组）
 * - ACK 机制：消费成功后 ACK，失败可重试
 * - 死信队列：消费失败 N 次后转入死信流（kb:streams:dead-letter）
 * <p>
 * 序列化方式：JSON 字符串（不依赖 RedisTemplate 的 activateDefaultTyping，更安全）
 */
@Slf4j
@RequiredArgsConstructor
public class RedisStreamEventBus implements EventBus {

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    /** TraceId 在 MDC 中的 key */
    private static final String TRACE_ID_KEY = "traceId";

    @Override
    public String publish(AppEvent event) {
        String stream = routeStream(event.getEvent());
        return publish(stream, event);
    }

    @Override
    public String publish(String stream, AppEvent event) {
        // 填充 traceId（从 MDC 获取，串联请求链路）
        if (event.getTraceId() == null) {
            event.setTraceId(MDC.get(TRACE_ID_KEY));
        }

        try {
            String json = objectMapper.writeValueAsString(event);
            Map<String, String> fields = new HashMap<>();
            fields.put("event", json);
            fields.put("type", event.getEvent());
            fields.put("source", event.getSource() != null ? event.getSource() : "unknown");

            var recordId = redisTemplate.opsForStream().add(stream, fields);
            log.info("发布事件到 Stream: {} eventId={} type={} recordId={}",
                    stream, event.getEventId(), event.getEvent(), recordId);
            return recordId != null ? recordId.getValue() : null;
        } catch (Exception e) {
            log.error("发布事件失败 stream={} eventId={} type={}",
                    stream, event.getEventId(), event.getEvent(), e);
            return null;
        }
    }

    /**
     * 根据事件类型路由到对应 Stream
     * <p>
     * 路由规则：
     * - file 点号开头的类型 路由到 kb:streams:file-events
     * - doc/web/share/folder/space/tag 点号开头的类型 路由到 kb:streams:knowledge-events
     * - request 点号开头的类型 路由到 kb:streams:request-logs
     * - 其他 路由到 kb:streams:knowledge-events（默认）
     */
    private String routeStream(String eventType) {
        if (eventType == null) {
            return AppEvent.STREAM_KNOWLEDGE_EVENTS;
        }
        if (eventType.startsWith("file.")) {
            return AppEvent.STREAM_FILE_EVENTS;
        }
        if (eventType.startsWith("share.")) {
            return AppEvent.STREAM_SHARE_EVENTS;
        }
        if (eventType.startsWith("request.")) {
            return AppEvent.STREAM_REQUEST_LOGS;
        }
        return AppEvent.STREAM_KNOWLEDGE_EVENTS;
    }
}
