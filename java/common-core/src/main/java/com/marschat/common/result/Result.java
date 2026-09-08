package com.marschat.common.result;

import lombok.Data;
import org.slf4j.MDC;

import java.io.Serializable;

/**
 * 统一返回格式（P0 优化版）
 * <p>
 * 所有服务统一使用此格式返回，前端通过 code 判断状态。
 * traceId 用于跨服务链路追踪，自动从 MDC 填充。
 */
@Data
public class Result<T> implements Serializable {

    private static final String TRACE_ID_KEY = "traceId";

    private int code;
    private String message;
    private T data;
    private String traceId;

    private Result() {}

    public static <T> Result<T> ok() {
        return ok(null);
    }

    public static <T> Result<T> ok(T data) {
        Result<T> r = new Result<>();
        r.setCode(200);
        r.setMessage("success");
        r.setData(data);
        r.fillTraceId();
        return r;
    }

    public static <T> Result<T> fail(String message) {
        return fail(500, message);
    }

    public static <T> Result<T> fail(int code, String message) {
        Result<T> r = new Result<>();
        r.setCode(code);
        r.setMessage(message);
        r.fillTraceId();
        return r;
    }

    public Result<T> withTraceId(String traceId) {
        this.traceId = traceId;
        return this;
    }

    /** 从 MDC 中读取当前请求的 traceId 并填充到响应体 */
    private void fillTraceId() {
        if (this.traceId == null) {
            this.traceId = MDC.get(TRACE_ID_KEY);
        }
    }
}
