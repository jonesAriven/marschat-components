package com.marschat.common.crypto;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;

/**
 * crypto 自动装配：配置 {@code marschat.crypto.key} 后即可注入 {@link CryptoUtil}。
 * {@code marschat.crypto.enabled=false} 可整体停用（默认开启）。
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "marschat.crypto", name = "enabled", havingValue = "true", matchIfMissing = true)
public class CryptoAutoConfig {

    @Bean
    @ConditionalOnMissingBean
    public CryptoUtil cryptoUtil(
            @Value("${marschat.crypto.key:}") String key,
            @org.springframework.beans.factory.annotation.Autowired(required = false)
            LegacyCipherHandler legacyHandler) {
        return new CryptoUtil(key, legacyHandler);
    }
}
