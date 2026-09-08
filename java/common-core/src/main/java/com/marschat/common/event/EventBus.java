package com.marschat.common.event;

/**
 * 事件总线接口（M4 重构：统一事件发布入口）
 * <p>
 * 实现：
 * - {@link RedisStreamEventBus} 基于 Redis Streams（持久化 + 消费者组 + ACK）
 * <p>
 * 使用方式：
 * <pre>
 * &#64;RequiredArgsConstructor
 * public class FileParseServiceImpl {
 *     private final EventBus eventBus;  // 自动注入
 *
 *     public void onParsed(Long fileId, Long userId, String name, String content) {
 *         Map&lt;String, Object&gt; payload = Map.of("fileId", fileId, "userId", userId, "name", name, "content", content);
 *         AppEvent event = new AppEvent(AppEvent.FILE_PARSED, fileId, payload, "kb-file");
 *         eventBus.publish(event);  // 自动路由到 kb:streams:file-events
 *     }
 * }
 * </pre>
 */
public interface EventBus {

    /**
     * 发布事件（自动根据事件类型选择 Stream）
     * <p>
     * 路由规则：
     * - file 点号开头的类型 路由到 kb:streams:file-events
     * - doc/web/share/folder/space/tag 点号开头的类型 路由到 kb:streams:knowledge-events
     *
     * @param event 事件对象
     * @return Redis Stream Record ID（用于追溯）
     */
    String publish(AppEvent event);

    /**
     * 发布事件到指定 Stream（覆盖默认路由）
     *
     * @param stream Redis Stream key
     * @param event  事件对象
     * @return Redis Stream Record ID
     */
    String publish(String stream, AppEvent event);
}
