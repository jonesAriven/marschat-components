package com.marschat.common.crypto;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;

/**
 * crypto 自动装配：配置 {@code marschat.crypto.key} 后即可注入 {@link CryptoUtil}。
 * {@code marschat.crypto.enabled=false} 可整体停用（默认开启）。
 *
 * <p>🔴 <b>两个启动期硬约束</b>（2026-09-12 实测事故，见 ADR §18.3）：
 *
 * <p><b>① 必须配 key 才装配</b>：{@link CryptoUtil} 的构造对空 key 直接
 * {@code IllegalArgumentException}。若不要求 key 就装配，任何「classpath 上有 common-core
 * 但没配 {@code marschat.crypto.key}」的应用都会在启动时炸——而存量应用用的是自家属性名
 * （kb-ops/infra-monitor 是 {@code crypto.aes-key}、portal 是 {@code portal.encryption.key}），
 * {@code marschat.crypto.key} 必然为空。故加 {@code @ConditionalOnProperty(name="key")}：
 * 没配就不装配，存量应用升版本零波及（与 R10「未配置即行为不变」一致）。
 *
 * <p><b>② bean 名必须带命名空间前缀</b>：本类原先用方法名作 bean 名 = {@code cryptoUtil}，
 * 而 portal / kb-ops / infra-monitor 三个存量应用各自都有 {@code @Component public class
 * CryptoUtil}（包名不同、**bean 名同为 cryptoUtil**）。{@code @ConditionalOnMissingBean}
 * 默认**按类型**判定，库类型是 {@code com.marschat.common.crypto.CryptoUtil}、应用类型是
 * {@code com.kb.*.util.CryptoUtil}，类型不同 → 条件不生效 → 随后按**名字**注册时撞车，
 * Spring Boot 默认禁止 bean 覆盖，直接 {@code BeanDefinitionOverrideException} 启动失败
 * （portal-server 实测 crash-loop）。
 *
 * <p>修法：库 bean 改名 {@code marschatCryptoUtil}。库**不该占用** {@code cryptoUtil}
 * 这类通用名——应用侧可以继续保有自己的同名 bean，二者类型不同、按类型注入互不干扰，
 * 存量应用零改动即可升版本；应用完成 crypto 收敛后再删掉自家实现即可。
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "marschat.crypto", name = "enabled", havingValue = "true", matchIfMissing = true)
public class CryptoAutoConfig {

    @Bean(name = "marschatCryptoUtil")
    @ConditionalOnMissingBean
    @ConditionalOnProperty(prefix = "marschat.crypto", name = "key")
    public CryptoUtil cryptoUtil(
            @Value("${marschat.crypto.key:}") String key,
            @org.springframework.beans.factory.annotation.Autowired(required = false)
            LegacyCipherHandler legacyHandler) {
        return new CryptoUtil(key, legacyHandler);
    }
}
