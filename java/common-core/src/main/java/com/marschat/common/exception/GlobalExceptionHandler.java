package com.marschat.common.exception;

import com.marschat.common.result.Result;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.stream.Collectors;

/**
 * 全局异常处理器（P0 优化）
 * <p>
 * 所有服务继承此类或直接使用 @Import 引入。
 * 统一异常返回格式，自动注入 traceId。
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public Result<?> handleBusiness(BusinessException e, HttpServletRequest req) {
        log.warn("业务异常 [{}]: {}", req.getRequestURI(), e.getMessage());
        return Result.fail(e.getCode(), e.getMessage()).withTraceId(MDC.get("traceId"));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleValidation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage())
                .collect(Collectors.joining("; "));
        log.warn("参数校验失败: {}", msg);
        return Result.fail(400, "参数校验失败: " + msg).withTraceId(MDC.get("traceId"));
    }

    /**
     * 资源/路由不存在 → 404（而不是落到下面的 Exception 兜底变 500）。
     * <p>
     * Spring Boot 3.2 起 MVC 对「无匹配 handler」抛 {@code NoResourceFoundException}，
     * 若不加本映射会被 {@link #handleUnknown} 捕获并返回 500 + 错误日志，
     * 把「URL 打错/路由不存在」与「服务内部故障」混为一谈（台账 L044）。
     * 典型场景：调用方把 PUT /admin/users/{id}/password 误写成 POST .../reset-password。
     */
    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public Result<?> handleNoResourceFound(org.springframework.web.servlet.resource.NoResourceFoundException e,
                                           HttpServletRequest req) {
        log.warn("接口不存在 [{}]: {}", req.getRequestURI(), e.getMessage());
        return Result.fail(404, "接口不存在: " + req.getRequestURI()).withTraceId(MDC.get("traceId"));
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<?> handleUnknown(Exception e, HttpServletRequest req) {
        log.error("未知异常 [{}]: {}", req.getRequestURI(), e.getMessage(), e);
        return Result.fail(500, "服务内部错误，请稍后重试").withTraceId(MDC.get("traceId"));
    }
}
