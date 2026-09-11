package com.marschat.common.exception;

import com.marschat.common.result.Result;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

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

    /**
     * 客户端请求类异常 → 语义化 4xx（全局根治，台账 L044 的同类扩展）。
     * <p>
     * 背景：本类只映射了 3 个具体异常 + {@code Exception} 兜底 500，结果是
     * <b>所有客户端请求错误都被兜底吞成 500「服务内部错误」</b>，与真实服务故障无法区分，
     * 且客户端错误被当作 error 级日志打出来污染告警。公网实测复现（2026-09-11）：
     * <pre>
     *   GET  /login                      → 500（应为 404）
     *   POST /auth/forgot-password  空body → 500（应为 400）
     *   POST /auth/forgot-password  {bad  → 500（应为 400）
     *   POST /auth/reset-password   空body → 500（应为 400）
     * </pre>
     * 只补 {@code NoResourceFoundException} 是打地鼠，这里按「整类客户端错误一次映射到位」根治。
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleNotReadable(HttpMessageNotReadableException e, HttpServletRequest req) {
        log.warn("请求体不可读 [{}]: {}", req.getRequestURI(), e.getMessage());
        return Result.fail(400, "请求体缺失或格式错误").withTraceId(MDC.get("traceId"));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    @ResponseStatus(HttpStatus.METHOD_NOT_ALLOWED)
    public Result<?> handleMethodNotSupported(HttpRequestMethodNotSupportedException e, HttpServletRequest req) {
        log.warn("请求方法不支持 [{}]: {}", req.getRequestURI(), e.getMessage());
        return Result.fail(405, "请求方法不支持: " + e.getMethod()).withTraceId(MDC.get("traceId"));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    @ResponseStatus(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
    public Result<?> handleMediaTypeNotSupported(HttpMediaTypeNotSupportedException e, HttpServletRequest req) {
        log.warn("媒体类型不支持 [{}]: {}", req.getRequestURI(), e.getMessage());
        return Result.fail(415, "不支持的 Content-Type: " + e.getContentType()).withTraceId(MDC.get("traceId"));
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleMissingParam(MissingServletRequestParameterException e, HttpServletRequest req) {
        log.warn("缺少必填参数 [{}]: {}", req.getRequestURI(), e.getParameterName());
        return Result.fail(400, "缺少必填参数: " + e.getParameterName()).withTraceId(MDC.get("traceId"));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleTypeMismatch(MethodArgumentTypeMismatchException e, HttpServletRequest req) {
        log.warn("参数类型不匹配 [{}]: {}", req.getRequestURI(), e.getName());
        return Result.fail(400, "参数类型不匹配: " + e.getName()).withTraceId(MDC.get("traceId"));
    }

    /**
     * 表单/查询参数绑定失败（{@link MethodArgumentNotValidException} 是其子类，已由上面的 handler 覆盖，
     * Spring 会优先匹配子类）。
     */
    @ExceptionHandler(BindException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleBind(BindException e, HttpServletRequest req) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage())
                .collect(Collectors.joining("; "));
        log.warn("参数绑定失败 [{}]: {}", req.getRequestURI(), msg);
        return Result.fail(400, "参数绑定失败: " + msg).withTraceId(MDC.get("traceId"));
    }

    /** 方法参数上的 {@code @Validated} 约束校验失败（Spring 6.1+ 的 HandlerMethodValidationException 之外的路径）。 */
    @ExceptionHandler(ConstraintViolationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleConstraintViolation(ConstraintViolationException e, HttpServletRequest req) {
        String msg = e.getConstraintViolations().stream()
                .map(v -> v.getPropertyPath() + ": " + v.getMessage())
                .collect(Collectors.joining("; "));
        log.warn("参数约束校验失败 [{}]: {}", req.getRequestURI(), msg);
        return Result.fail(400, "参数校验失败: " + msg).withTraceId(MDC.get("traceId"));
    }

    /** Spring Framework 6.1 起 @Validated 方法级校验失败抛此异常（不再抛 ConstraintViolationException）。 */
    @ExceptionHandler(HandlerMethodValidationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<?> handleHandlerMethodValidation(HandlerMethodValidationException e, HttpServletRequest req) {
        log.warn("方法参数校验失败 [{}]: {}", req.getRequestURI(), e.getMessage());
        return Result.fail(400, "参数校验失败").withTraceId(MDC.get("traceId"));
    }

    // ⚠️ 有意不加 AccessDeniedException → 403 映射（2026-09-12 评估后否决）：
    // 该 handler 需要方法签名引用 spring-security-core 的类，而 common-core 无此依赖；
    // 强引会给没有 security classpath 的下游服务带来 NoClassDefFoundError 风险。
    // 全平台 @PreAuthorize 目前只有 auth-center 在用，已由其本地 AccessDeniedAdvice 精确映射 403；
    // 未来第二个服务需要方法级授权时，照抄该 advice（3 行）而非动枢纽库。

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<?> handleUnknown(Exception e, HttpServletRequest req) {
        log.error("未知异常 [{}]: {}", req.getRequestURI(), e.getMessage(), e);
        return Result.fail(500, "服务内部错误，请稍后重试").withTraceId(MDC.get("traceId"));
    }
}
