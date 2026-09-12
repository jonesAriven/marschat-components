package com.marschat.common.audit;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 操作审计（Phase 2 · audit 包）。标注在 Controller / Service 方法上，
 * {@link AuditOperationAspect} 环绕采集并写入 {@link AuditSink}。
 *
 * <p>统一此前 kb-ops / auth-center 各自演化的三套 OperationLog 的字段口径：
 * 操作人 / 动作 / 资源类型 / 资源 ID / 前后值 / IP / UA / 结果 / 耗时。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface AuditOperation {

    /** 动作，如 create / update / delete / reset_password。 */
    String action();

    /** 资源类型，如 user / deployment / credential。 */
    String resourceType();

    /** 资源 ID 的 SpEL（相对方法参数），如 "#id" 或 "#body.username"；空则不解析。 */
    String resourceId() default "";

    /** 简述（可含 SpEL），写入审计明细。 */
    String detail() default "";
}
