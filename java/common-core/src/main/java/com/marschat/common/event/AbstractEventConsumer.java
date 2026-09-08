package com.marschat.common.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.connection.stream.*;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 事件消费者抽象基类（M4-M5 重构）
 * <p>
 * 子类继承后实现 4 个抽象方法即可自动消费 Redis Streams 事件：
 * <pre>
 * &#64;Component
 * public class FileEventConsumer extends AbstractEventConsumer {
 *     &#64;Override public String getStream() { return AppEvent.STREAM_FILE_EVENTS; }
 *     &#64;Override public String getGroup() { return AppEvent.GROUP_KNOWLEDGE; }
 *     &#64;Override public String getConsumer() { return "kb-knowledge-1"; }
 *     &#64;Override public void handleEvent(AppEvent event) {
 *         // 处理事件
 *     }
 * }
 * </pre>
 * <p>
 * 特性：
 * - 自动创建消费者组（如不存在）
 * - 独立守护线程拉取消息（不依赖 @EnableScheduling）
 * - 自动 ACK：处理成功后 ACK
 * - 死信队列：处理失败后转死信流（kb:streams:dead-letter），并 ACK 避免重复消费
 * - 优雅关闭：@PreDestroy 关闭线程池
 */
@Slf4j
public abstract class AbstractEventConsumer {

    @Autowired
    protected StringRedisTemplate redisTemplate;

    @Autowired
    protected ObjectMapper objectMapper;

    /** 单次拉取数量 */
    private static final int BATCH_SIZE = 10;
    /** 阻塞读取时长 */
    private static final Duration BLOCK_DURATION = Duration.ofMillis(1000);

    private ExecutorService executor;

    /**
     * 子类返回订阅的 Stream key（如 AppEvent.STREAM_FILE_EVENTS）
     */
    public abstract String getStream();

    /**
     * 子类返回消费者组名（如 AppEvent.GROUP_KNOWLEDGE）
     */
    public abstract String getGroup();

    /**
     * 子类返回消费者名（如 "kb-knowledge-1"，需在 group 内唯一）
     */
    public abstract String getConsumer();

    /**
     * 子类实现事件处理逻辑
     */
    public abstract void handleEvent(AppEvent event);

    @PostConstruct
    public void init() {
        createGroupIfNotExists();
        executor = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "kb-event-consumer-" + getConsumer());
            t.setDaemon(true);
            return t;
        });
        executor.submit(this::consumeLoop);
        log.info("事件消费者已启动 stream={} group={} consumer={}",
                getStream(), getGroup(), getConsumer());
    }

    @PreDestroy
    public void destroy() {
        if (executor != null) {
            executor.shutdownNow();
            try {
                executor.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        log.info("事件消费者已停止 stream={} group={} consumer={}",
                getStream(), getGroup(), getConsumer());
    }

    /**
     * 创建消费者组（如不存在，自动创建 Stream）
     * <p>
     * Redis 不允许在不存在的 Stream 上创建消费者组，
     * 所以当 Stream 不存在时先添加一条初始消息创建 Stream，再创建组。
     */
    private void createGroupIfNotExists() {
        try {
            redisTemplate.opsForStream().createGroup(getStream(), ReadOffset.from("0"), getGroup());
            log.info("创建消费者组成功 stream={} group={}", getStream(), getGroup());
        } catch (Exception e) {
            // Spring Data Redis 会把 BUSYGROUP 包装成 RedisSystemException("Error in execution")，
            // 真实原因藏在 cause 链中，必须遍历判断
            if (isBusyGroup(e)) {
                log.debug("消费者组已存在 stream={} group={}", getStream(), getGroup());
            } else {
                log.warn("创建消费者组失败，尝试创建Stream后重试 stream={} group={} err={}",
                        getStream(), getGroup(), e.getMessage());
                try {
                    // Stream 不存在时才加初始消息创建 Stream，避免重启时塞垃圾消息
                    if (Boolean.FALSE.equals(redisTemplate.hasKey(getStream()))) {
                        redisTemplate.opsForStream().add(getStream(), java.util.Map.of("_init", "1"));
                    }
                    // 重试创建消费者组
                    redisTemplate.opsForStream().createGroup(getStream(), ReadOffset.from("0"), getGroup());
                    log.info("创建消费者组成功（重试） stream={} group={}", getStream(), getGroup());
                } catch (Exception retryEx) {
                    if (isBusyGroup(retryEx)) {
                        log.debug("消费者组已存在 stream={} group={}", getStream(), getGroup());
                    } else {
                        log.error("创建消费者组最终失败 stream={} group={} err={}",
                                getStream(), getGroup(), retryEx.getMessage());
                    }
                }
            }
        }
    }

    /**
     * 判断异常（含 cause 链）是否为"消费者组已存在"（BUSYGROUP）。
     * Spring 包装后 getMessage() 只剩 Error in execution，必须拆到内层。
     */
    private static boolean isBusyGroup(Throwable e) {
        for (Throwable t = e; t != null; t = (t.getCause() == t ? null : t.getCause())) {
            String m = t.getMessage();
            if (m != null && (m.contains("BUSYGROUP") || m.contains("already exists"))) {
                return true;
            }
        }
        return false;
    }

    /**
     * 消费循环（独立线程，持续拉取）
     */
    private void consumeLoop() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                pollAndAck();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                log.error("消费循环异常 stream={} group={}", getStream(), getGroup(), e);
                sleep(1000);
            }
        }
    }

    /**
     * 拉取并处理一批消息
     */
    @SuppressWarnings({"rawtypes", "unchecked"})
    private void pollAndAck() throws InterruptedException {
        Consumer consumer = Consumer.from(getGroup(), getConsumer());
        StreamReadOptions options = StreamReadOptions.empty()
                .count(BATCH_SIZE)
                .block(BLOCK_DURATION);
        StreamOffset<String> offset = StreamOffset.create(getStream(), ReadOffset.lastConsumed());

        List records = redisTemplate.opsForStream().read(consumer, options, offset);

        if (records == null || records.isEmpty()) {
            return;
        }

        for (Object recordObj : records) {
            MapRecord<String, Object, Object> record = (MapRecord<String, Object, Object>) recordObj;
            processRecord(record);
        }
    }

    /**
     * 处理单条消息：反序列化 → 调用 handleEvent → ACK（失败转死信）
     */
    private void processRecord(MapRecord<String, Object, Object> record) {
        RecordId recordId = record.getId();
        try {
            AppEvent event = deserialize(record);
            if (event == null) {
                log.warn("反序列化事件失败，跳过 recordId={}", recordId);
                ack(recordId);
                return;
            }
            log.debug("收到事件 recordId={} eventId={} type={}",
                    recordId, event.getEventId(), event.getEvent());
            handleEvent(event);
            ack(recordId);
        } catch (Exception e) {
            log.error("处理事件失败 recordId={} stream={}", recordId, getStream(), e);
            sendToDeadLetter(record, e);
            ack(recordId);
        }
    }

    /**
     * 反序列化（从 MapRecord 的 "event" 字段读取 JSON）
     */
    private AppEvent deserialize(MapRecord<String, Object, Object> record) {
        Map<Object, Object> fields = record.getValue();
        Object eventObj = fields.get("event");
        if (eventObj == null) {
            return null;
        }
        String json = eventObj.toString();
        try {
            return objectMapper.readValue(json, AppEvent.class);
        } catch (Exception e) {
            log.error("反序列化事件失败 recordId={} json={}", record.getId(), json, e);
            return null;
        }
    }

    /**
     * ACK 确认
     */
    private void ack(RecordId recordId) {
        try {
            redisTemplate.opsForStream().acknowledge(getStream(), getGroup(), recordId);
        } catch (Exception e) {
            log.warn("ACK 失败 recordId={} stream={}", recordId, getStream(), e.getMessage());
        }
    }

    /**
     * 转死信队列（保留原始消息 + 错误信息）
     */
    private void sendToDeadLetter(MapRecord<String, Object, Object> record, Exception error) {
        try {
            Map<String, String> deadFields = new java.util.HashMap<>();
            record.getValue().forEach((k, v) -> {
                if (k != null && v != null) {
                    deadFields.put(k.toString(), v.toString());
                }
            });
            deadFields.put("originalStream", getStream());
            deadFields.put("originalGroup", getGroup());
            deadFields.put("originalRecordId", record.getId().toString());
            deadFields.put("error", error.getClass().getName() + ": " + error.getMessage());
            deadFields.put("failedAt", java.time.Instant.now().toString());
            redisTemplate.opsForStream().add(AppEvent.STREAM_DEAD_LETTER, deadFields);
            log.warn("事件转死信队列 recordId={} stream={} deadLetter={}",
                    record.getId(), getStream(), AppEvent.STREAM_DEAD_LETTER);
        } catch (Exception e) {
            log.error("转死信队列失败 recordId={}", record.getId(), e);
        }
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
