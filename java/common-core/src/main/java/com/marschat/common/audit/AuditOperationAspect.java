package com.marschat.common.audit;

import com.marschat.common.crypto.CryptoUtil;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.MDC;
import org.springframework.expression.Expression;
import org.springframework.expression.ExpressionParser;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * {@link AuditOperation} 环绕切面（Phase 2 · audit 包）。
 *
 * <p>铁律：**审计失败绝不影响业务主链路**——采集/SpEL/Sink 全程 try-catch，
 * 失败仅记 WARN。敏感参数名（password/token/secret/key）不进快照。
 */
@Slf4j
@Aspect
public class AuditOperationAspect {

    private static final Set<String> SENSITIVE = Set.of(
            "password", "newpassword", "oldpassword", "token", "secret", "key", "cipher", "authorization");

    private final AuditSink sink;
    private final ExpressionParser parser = new SpelExpressionParser();

    public AuditOperationAspect(AuditSink sink) {
        this.sink = sink;
    }

    @Around("@annotation(auditOperation)")
    public Object around(ProceedingJoinPoint pjp, AuditOperation auditOperation) throws Throwable {
        long start = System.currentTimeMillis();
        Throwable error = null;
        Object result = null;
        try {
            result = pjp.proceed();
            return result;
        } catch (Throwable t) {
            error = t;
            throw t;
        } finally {
            try {
                long cost = System.currentTimeMillis() - start;
                sink.write(buildEvent(pjp, auditOperation, result, error, cost));
            } catch (Exception e) {
                log.warn("审计采集失败（不影响业务）: {}", e.getMessage());
            }
        }
    }

    private AuditEvent buildEvent(ProceedingJoinPoint pjp, AuditOperation anno,
                                  Object result, Throwable error, long cost) {
        MethodSignature sig = (MethodSignature) pjp.getSignature();
        String[] paramNames = sig.getParameterNames();
        Object[] args = pjp.getArgs();

        AuditEvent.AuditEventBuilder builder = AuditEvent.builder()
                .action(anno.action())
                .resourceType(anno.resourceType())
                .success(error == null)
                .errorMessage(error == null ? null : error.getMessage())
                .costMs(cost)
                .traceId(MDC.get("traceId"));

        // SpEL：resourceId / detail（以实参为根，#id / #body.username 形式）
        if (paramNames != null && paramNames.length > 0 && !(anno.resourceId().isBlank() && anno.detail().isBlank())) {
            try {
                StandardEvaluationContext ctx = new StandardEvaluationContext();
                for (int i = 0; i < paramNames.length; i++) {
                    ctx.setVariable(paramNames[i], args[i]);
                }
                if (!anno.resourceId().isBlank()) {
                    Expression exp = parser.parseExpression(anno.resourceId());
                    builder.resourceId(String.valueOf(exp.getValue(ctx)));
                }
                if (!anno.detail().isBlank()) {
                    Expression exp = parser.parseExpression(anno.detail());
                    builder.detail(String.valueOf(exp.getValue(ctx)));
                }
            } catch (Exception e) {
                log.debug("审计 SpEL 解析失败（不阻断）: {}", e.getMessage());
            }
        }
        builder.argsSnapshot(sanitizeArgs(paramNames, args));

        HttpServletRequest req = currentRequest();
        if (req != null) {
            builder.clientIp(clientIp(req));
            builder.userAgent(req.getHeader("User-Agent"));
            Object userId = req.getAttribute("userId");
            if (userId != null) {
                builder.operatorId(String.valueOf(userId));
            }
            Object username = req.getAttribute("username");
            if (username != null) {
                builder.operatorName(String.valueOf(username));
            }
        }
        return builder.build();
    }

    private Map<String, String> sanitizeArgs(String[] names, Object[] args) {
        Map<String, String> snapshot = new LinkedHashMap<>();
        if (names == null) {
            return snapshot;
        }
        for (int i = 0; i < names.length && i < args.length; i++) {
            if (args[i] == null) {
                continue;
            }
            String lower = names[i].toLowerCase();
            if (SENSITIVE.stream().anyMatch(lower::contains)) {
                snapshot.put(names[i], "***");
                continue;
            }
            String v = args[i] instanceof String s ? s : String.valueOf(args[i]);
            snapshot.put(names[i], v.length() > 200 ? v.substring(0, 200) + "..." : v);
        }
        return snapshot;
    }

    private HttpServletRequest currentRequest() {
        ServletRequestAttributes attrs =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        return attrs == null ? null : attrs.getRequest();
    }

    private String clientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            return xff.split(",")[0].trim();
        }
        return req.getRemoteAddr();
    }
}
