package com.marschat.common.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * common-core 事件总线自动配置（M4 重构）
 * <p>
 * 下游服务引入 common-core 依赖即自动获得 EventBus Bean
 * （经 AutoConfiguration.imports 自动装配，无需在启动类 @Import）。
 * <p>
 * 条件：classpath 中存在 StringRedisTemplate（即下游服务已引入 spring-boot-starter-data-redis）。
 */
@AutoConfiguration
@ConditionalOnClass(StringRedisTemplate.class)
public class EventAutoConfig {

    @Bean
    @ConditionalOnMissingBean(EventBus.class)
    public EventBus eventBus(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        return new RedisStreamEventBus(redisTemplate, objectMapper);
    }
}
