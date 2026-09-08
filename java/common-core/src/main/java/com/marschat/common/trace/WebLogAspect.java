package com.marschat.common.trace;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.marschat.common.event.EventBus;
import com.marschat.common.event.AppEvent;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Pointcut;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;

import jakarta.servlet.http.HttpServletResponse;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Web 请求日志切面（P0 新增）
 * <p>
 * 自动记录所有 Controller 方法的入参、出参、耗时，并带上 traceId。
 * 这样当出现问题时，可以通过 traceId 在日志中找到完整的调用链：
 * <ol>
 *   <li>网关生成 traceId 并记录请求</li>
 *   <li>下游服务 TraceIdInterceptor 接收 traceId 放入 MDC</li>
 *   <li>本切面记录 Controller 入参、出参、耗时（日志中自动带 traceId）</li>
 *   <li>异常处理日志记录异常（也带 traceId）</li>
 * </ol>
 * <p>
 * 设计原则：
 * <ul>
 *   <li>只记录 Controller 层，不记录 Service 层（避免日志过多）</li>
 *   <li>敏感参数（password、token）自动脱敏</li>
 *   <li>大对象（MultipartFile、HttpServletResponse）只记录类型</li>
 *   <li>慢请求（>500ms）标记 WARN 级别</li>
 *   <li>可选：发布请求日志事件到 Redis Stream（通过 EventBus）</li>
 * </ul>
 */
@Aspect
public class WebLogAspect {

    private static final Logger log = LoggerFactory.getLogger(WebLogAspect.class);

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .configure(SerializationFeature.FAIL_ON_EMPTY_BEANS, false);

    /** 慢请求阈值（毫秒） */
    private static final long SLOW_REQUEST_THRESHOLD = 500;

    /** 需要脱敏的参数名（不区分大小写） */
    private static final List<String> SENSITIVE_PARAMS = List.of(
            "password", "passwd", "token", "secret", "credential", "authorization"
    );

    /** 不序列化的参数类型 */
    private static final List<Class<?>> SKIP_TYPES = List.of(
            MultipartFile.class, HttpServletRequest.class, HttpServletResponse.class
    );

    /** 事件总线（可选，用于发布请求日志事件） */
    @Autowired(required = false)
    private EventBus eventBus;

    /** 服务名（用于标识请求来源服务） */
    @Value("${spring.application.name:unknown}")
    private String applicationName;

    /** 是否启用请求日志事件发布（默认关闭，避免过多事件） */
    @Value("${kb.web-log.event-enabled:false}")
    private boolean eventEnabled;

    /**
     * 切入所有 @RestController 注解的类的 public 方法
     */
    @Pointcut("within(@org.springframework.web.bind.annotation.RestController *)")
    public void restControllerPointcut() {}

    @Around("restControllerPointcut()")
    public Object logAround(ProceedingJoinPoint joinPoint) throws Throwable {
        String traceId = MDC.get("traceId");
        String methodName = joinPoint.getSignature().getDeclaringType().getSimpleName() + "." + joinPoint.getSignature().getName();
        HttpServletRequest request = getRequest();
        String httpMethod = request != null ? request.getMethod() : "N/A";
        String requestUri = request != null ? request.getRequestURI() : "N/A";
        String ip = request != null ? getClientIp(request) : null;
        String userAgent = request != null ? request.getHeader("User-Agent") : null;

        // 记录入参
        String argsStr = formatArgs(joinPoint.getArgs());
        log.info("[{}] >>> {} {} | args={}", traceId, httpMethod, requestUri, argsStr);

        // 执行方法
        long startTime = System.currentTimeMillis();
        try {
            Object result = joinPoint.proceed();
            long costMs = System.currentTimeMillis() - startTime;

            // 记录出参
            String resultStr = formatResult(result);
            String status = costMs > SLOW_REQUEST_THRESHOLD ? "slow" : "success";
            if (costMs > SLOW_REQUEST_THRESHOLD) {
                log.warn("[{}] <<< {} {} | cost={}ms (SLOW) | result={}", traceId, httpMethod, requestUri, costMs, resultStr);
            } else {
                log.info("[{}] <<< {} {} | cost={}ms | result={}", traceId, httpMethod, requestUri, costMs, resultStr);
            }

            // 发布请求日志事件（可选）
            publishRequestLogEvent(traceId, httpMethod, requestUri, methodName,
                    argsStr, resultStr, costMs, status, null, ip, userAgent);

            return result;
        } catch (Throwable e) {
            long costMs = System.currentTimeMillis() - startTime;
            String exceptionStr = e.getClass().getSimpleName() + ": " + e.getMessage();
            log.error("[{}] !!! {} {} | cost={}ms | exception={}: {}", traceId, httpMethod, requestUri, costMs,
                    e.getClass().getSimpleName(), e.getMessage());

            // 发布请求日志事件（可选）
            publishRequestLogEvent(traceId, httpMethod, requestUri, methodName,
                    argsStr, null, costMs, "error", exceptionStr, ip, userAgent);

            throw e;
        }
    }

    /**
     * 发布请求日志事件到 Redis Stream
     */
    private void publishRequestLogEvent(String traceId, String httpMethod, String requestUri,
                                        String controllerMethod, String requestArgs, String responseResult,
                                        Long costMs, String status, String exception, String ip, String userAgent) {
        if (!eventEnabled || eventBus == null) {
            return;
        }
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("traceId", traceId);
            payload.put("httpMethod", httpMethod);
            payload.put("requestUri", requestUri);
            payload.put("controllerMethod", controllerMethod);
            payload.put("requestArgs", requestArgs);
            payload.put("responseResult", responseResult);
            payload.put("costMs", costMs);
            payload.put("status", status);
            payload.put("exception", exception);
            payload.put("ip", ip);
            payload.put("userAgent", userAgent);
            payload.put("serviceName", applicationName);

            AppEvent event = new AppEvent(AppEvent.REQUEST_LOG, null, payload, applicationName);
            event.setTraceId(traceId);
            eventBus.publish(event);
        } catch (Exception e) {
            log.warn("发布请求日志事件失败: traceId={}, uri={}", traceId, requestUri, e);
        }
    }

    private HttpServletRequest getRequest() {
        ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        return attrs != null ? attrs.getRequest() : null;
    }

    private String getClientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        if (ip != null && ip.contains(",")) {
            ip = ip.split(",")[0].trim();
        }
        return ip;
    }

    /**
     * 格式化入参，脱敏敏感字段
     */
    private String formatArgs(Object[] args) {
        if (args == null || args.length == 0) {
            return "[]";
        }
        return Arrays.stream(args)
                .map(this::safeToString)
                .collect(Collectors.joining(", ", "[", "]"));
    }

    /**
     * 格式化出参（截断过长的内容）
     */
    private String formatResult(Object result) {
        if (result == null) {
            return "null";
        }
        String str = safeToString(result);
        // 截断超过 1000 字符的结果
        if (str.length() > 1000) {
            return str.substring(0, 1000) + "...(truncated, total=" + str.length() + ")";
        }
        return str;
    }

    /**
     * 安全序列化对象，跳过不序列化的类型
     */
    private String safeToString(Object obj) {
        if (obj == null) {
            return "null";
        }
        // 跳过不序列化的类型
        for (Class<?> skipType : SKIP_TYPES) {
            if (skipType.isInstance(obj)) {
                return "<" + obj.getClass().getSimpleName() + ">";
            }
        }
        try {
            String json = MAPPER.writeValueAsString(obj);
            // 脱敏敏感字段
            return maskSensitive(json);
        } catch (Exception e) {
            return obj.toString();
        }
    }

    /**
     * 脱敏 JSON 中的敏感字段值
     */
    private String maskSensitive(String json) {
        String result = json;
        for (String param : SENSITIVE_PARAMS) {
            // 匹配 "paramName":"value" 模式（不区分大小写）
            result = result.replaceAll(
                    "(?i)(\"(" + param + ")\"\\s*:\\s*\")([^\"]*)(\")",
                    "$1***$4"
            );
        }
        return result;
    }
}
