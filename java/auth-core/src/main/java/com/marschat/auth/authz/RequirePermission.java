package com.marschat.auth.authz;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 方法级权限点校验（Phase 2 · RBAC 公共能力）。
 *
 * <p>标注在 Controller 方法（或类）上，{@link RequirePermissionInterceptor} 在进入方法前
 * 用当前 Bearer token 调 auth-center {@code GET /auth/permissions?client=<本应用>}，
 * 校验权限点集合。权限点 code 约定 {@code <client_id>:<type>:<code>}，如
 * {@code marschat-kbops:api:deployment:create}。
 *
 * <p>语义：<ul>
 *   <li>{@link Mode#ANY}（默认）：拥有任一权限点即放行；</li>
 *   <li>{@link Mode#ALL}：必须同时拥有全部权限点；</li>
 *   <li>平台超管（roles 含 admin/superadmin）恒放行。</li>
 * </ul>
 *
 * <p>fail-open：auth-center 不可达时按 {@code marschat.authz.fail-open}（默认 true）放行并记 WARN——
 * 枢纽抖动不得把业务接口全打成 403；需要强安全语义的调用方显式配 false。
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequirePermission {

    /** 需要的权限点 code（不含 client 前缀亦可——拦截器自动补本应用 client_id 前缀）。 */
    String[] value();

    Mode mode() default Mode.ANY;

    enum Mode { ANY, ALL }
}
