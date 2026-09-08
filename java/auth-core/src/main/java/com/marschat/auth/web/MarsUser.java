package com.marschat.auth.web;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Controller 方法参数注解：注入当前登录用户。
 * <pre>
 * &#64;GetMapping("/me")
 * public Result&lt;?&gt; me(&#64;MarsUser LoginUser user) { ... }
 * </pre>
 * token 无效时：required=true（默认）抛 NotLoginException 语义的 IllegalArgumentException，
 * required=false 注入 null 由业务自行判定。
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
public @interface MarsUser {

    /** token 无效/缺失时是否抛异常；false 则注入 null */
    boolean required() default true;
}
