package com.marschat.common.exception;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Import;
import org.springframework.web.servlet.DispatcherServlet;

/**
 * 全局异常处理器的自动装配包装类。
 * <p>
 * 为什么需要这一层包装：{@link GlobalExceptionHandler} 本身是 {@code @RestControllerAdvice}，
 * 而 {@code @RestControllerAdvice} 不能直接写进
 * {@code META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports}
 * （自动配置入口要求是被 Spring 管理的配置类，异常处理器的语义是"组件"不是"配置"）。
 * 因此用一个空的 {@code @AutoConfiguration} 把它 {@code @Import} 进来。
 * <p>
 * 关键收益：下游服务只要引入 common-core 依赖，全局异常处理即自动生效，
 * <b>不再需要在启动类上手写 {@code @Import(GlobalExceptionHandler.class)}</b>。
 * 历史上 infra-monitor 正是因为漏写 @Import，且 {@code com.marschat.common} 不在其
 * 组件扫描路径内，导致全局异常处理静默失效（编译/启动均无报错）。
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnClass(DispatcherServlet.class)
@Import(GlobalExceptionHandler.class)
public class GlobalExceptionHandlerAutoConfiguration {
}
