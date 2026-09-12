package com.marschat.common.crypto;

/**
 * 存量密文双读的「旧算法」钩子（Phase 2 · CryptoUtil 收敛，R1 决策 A）。
 *
 * <p>平台标准为 AES-256-GCM（密文格式 {@code gcm:<ivB64>:<ctB64>}）。各应用存量密文
 * 格式/密钥各异（portal 是独立 key-based 实现，active-manager 另含 RSA 等）——
 * 接入方实现本接口处理自己库里的旧格式；读到旧密文用旧逻辑解，写回统一新格式，
 * 迁移完成后移除实现即可。
 */
@FunctionalInterface
public interface LegacyCipherHandler {

    /**
     * 尝试用旧算法解密。仅当密文**不是**平台新格式（无 {@code gcm:} 前缀）时被调用。
     *
     * @param cipherText 原样密文
     * @return 明文；无法识别/解密返回 {@code null}（上层抛出统一异常）
     */
    String decrypt(String cipherText);
}
