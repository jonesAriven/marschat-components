package com.marschat.common.event;

import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * 跨服务事件通知（v2 - M4 重构升级）
 * <p>
 * 通过 Redis Streams 传递，用于服务间异步通知（持久化 + 消费者组 + ACK）。
 * 如：kb-file 解析完成 → 通知 kb-knowledge 建索引 / 标记分享失效
 * <p>
 * v2 升级点：
 * - 新增 eventId（UUID，唯一标识，消费者可幂等去重）
 * - 新增 version（事件版本，用于演进兼容）
 * - 新增 traceId（链路追踪 ID，串联请求链路）
 * - 整合所有模块的事件类型常量（file/doc/web/share/folder/space/tag）
 */
@Data
@NoArgsConstructor
public class AppEvent {

    /** 事件 ID（UUID，唯一标识，消费者可幂等去重） */
    private String eventId;
    /** 事件版本（默认 v2，用于演进兼容） */
    private String version = "v2";
    /** 链路追踪 ID（MDC 传递，串联请求链路） */
    private String traceId;
    /** 事件类型: file.parsed, file.deleted, doc.created 等 */
    private String event;
    /** 关联实体 ID */
    private Long entityId;
    /** 附加数据 */
    private Map<String, Object> payload;
    /** 事件时间 */
    private Instant timestamp;
    /** 事件来源服务名（如 kb-file, kb-knowledge） */
    private String source;

    /**
     * 构造事件（自动生成 eventId 和 timestamp）
     */
    public AppEvent(String event, Long entityId, Map<String, Object> payload) {
        this.eventId = UUID.randomUUID().toString();
        this.event = event;
        this.entityId = entityId;
        this.payload = payload;
        this.timestamp = Instant.now();
    }

    /**
     * 构造事件（指定 source）
     */
    public AppEvent(String event, Long entityId, Map<String, Object> payload, String source) {
        this(event, entityId, payload);
        this.source = source;
    }

    // ========== 文件事件类型常量（kb-file 发布） ==========
    public static final String FILE_PARSED = "file.parsed";
    public static final String FILE_DELETED = "file.deleted";
    public static final String FILE_REPARSE = "file.reparse";
    /** 文件永久删除（M4 新增） */
    public static final String FILE_PERMANENT_DELETED = "file.permanent_deleted";
    /** 回收站清空（M4 新增） */
    public static final String FILE_TRASH_EMPTIED = "file.trash_emptied";

    // ========== 知识库事件类型常量（kb-knowledge 发布） ==========
    public static final String DOC_CREATED = "doc.created";
    public static final String DOC_UPDATED = "doc.updated";
    public static final String DOC_DELETED = "doc.deleted";
    public static final String WEB_COLLECTED = "web.collected";
    public static final String WEB_DELETED = "web.deleted";
    public static final String SHARE_CREATED = "share.created";
    public static final String SHARE_DELETED = "share.deleted";
    public static final String FOLDER_CREATED = "folder.created";
    public static final String FOLDER_DELETED = "folder.deleted";
    public static final String SPACE_CREATED = "space.created";
    public static final String SPACE_DELETED = "space.deleted";
    public static final String TAG_CREATED = "tag.created";
    public static final String TAG_DELETED = "tag.deleted";

    // ========== 请求日志事件类型 ==========
    public static final String REQUEST_LOG = "request.log";

    // ========== 事件流通道（Redis Streams Key） ==========
    /** 文件事件流（kb-file → kb-knowledge） */
    public static final String STREAM_FILE_EVENTS = "kb:streams:file-events";
    /** 知识库事件流（kb-knowledge → kb-intelligence） */
    public static final String STREAM_KNOWLEDGE_EVENTS = "kb:streams:knowledge-events";
    /** 分享事件流（kb-knowledge → 其他模块） */
    public static final String STREAM_SHARE_EVENTS = "kb:streams:share-events";
    /** 请求日志流（所有服务 → kb-auth 统一存储） */
    public static final String STREAM_REQUEST_LOGS = "kb:streams:request-logs";
    /** 死信流（处理失败的事件） */
    public static final String STREAM_DEAD_LETTER = "kb:streams:dead-letter";

    // ========== 消费者组（每个消费者独立 group，互不影响） ==========
    /** kb-knowledge 消费 file-events 的消费者组 */
    public static final String GROUP_KNOWLEDGE = "kb-knowledge-group";
    /** kb-intelligence 消费 knowledge-events 的消费者组 */
    public static final String GROUP_INTELLIGENCE = "kb-intelligence-group";
    /** kb-auth 消费 request-logs 的消费者组 */
    public static final String GROUP_REQUEST_LOG = "request-log-group";
}
