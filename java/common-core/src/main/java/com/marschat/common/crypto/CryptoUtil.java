package com.marschat.common.crypto;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * 平台标准对称加密（Phase 2 · R1 决策 A：AES-256-GCM 为唯一标准实现）。
 *
 * <p>参数与 infra-monitor / kb-ops 既有实现一致：AES/GCM/NoPadding，IV=12B，TAG=128bit。
 * 密文自描述格式：{@code gcm:<ivBase64>:<cipherBase64>}。
 *
 * <p><b>存量双读</b>：{@link #decrypt} 遇到无 {@code gcm:} 前缀的旧密文时，委托
 * {@link LegacyCipherHandler}（应用注入自己的旧算法）；解出后由业务决定是否以
 * {@link #encrypt} 重写回新格式。迁移完成后移除 Handler。
 *
 * <p>密钥来源：{@code marschat.crypto.key}（Base64 的 32 字节 = 256bit）。
 * 未配置时按 SHA-256(keyMaterial) 派生，保证「给了任意非空字符串就能用」，
 * 但生产应配置满 32 字节随机密钥。
 */
public final class CryptoUtil {

    private static final String PREFIX = "gcm:";
    private static final int IV_LENGTH = 12;
    private static final int TAG_BITS = 128;

    private final SecretKeySpec keySpec;
    private final LegacyCipherHandler legacyHandler;
    private final SecureRandom random = new SecureRandom();

    public CryptoUtil(String keyMaterial, LegacyCipherHandler legacyHandler) {
        if (keyMaterial == null || keyMaterial.isBlank()) {
            throw new IllegalArgumentException("crypto key 不可为空");
        }
        this.keySpec = deriveKey(keyMaterial);
        this.legacyHandler = legacyHandler;
    }

    private static SecretKeySpec deriveKey(String keyMaterial) {
        try {
            byte[] key;
            try {
                byte[] decoded = Base64.getDecoder().decode(keyMaterial.trim());
                key = decoded.length == 32 ? decoded
                        : sha256(keyMaterial); // 非 32B 的 base64 按口令派生，避免半截 key 静默弱化
            } catch (IllegalArgumentException notBase64) {
                key = sha256(keyMaterial);
            }
            return new SecretKeySpec(key, "AES");
        } catch (Exception e) {
            throw new IllegalStateException("crypto key 派生失败", e);
        }
    }

    private static byte[] sha256(String material) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }

    /** 加密为自描述格式 {@code gcm:<ivB64>:<ctB64>}。 */
    public String encrypt(String plaintext) {
        if (plaintext == null) {
            throw new IllegalArgumentException("待加密内容为 null");
        }
        try {
            byte[] iv = new byte[IV_LENGTH];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, keySpec, new GCMParameterSpec(TAG_BITS, iv));
            byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return PREFIX
                    + Base64.getEncoder().encodeToString(iv) + ":"
                    + Base64.getEncoder().encodeToString(ct);
        } catch (Exception e) {
            throw new IllegalStateException("加密失败", e);
        }
    }

    /**
     * 解密：{@code gcm:} 前缀走标准 GCM；否则委托 {@link LegacyCipherHandler} 双读。
     *
     * @throws IllegalStateException 无法解密（新格式损坏 / 旧格式且无 Handler 或 Handler 解不出）
     */
    public String decrypt(String cipherText) {
        if (cipherText == null || cipherText.isBlank()) {
            throw new IllegalArgumentException("密文为空");
        }
        if (cipherText.startsWith(PREFIX)) {
            try {
                String[] parts = cipherText.substring(PREFIX.length()).split(":", 2);
                if (parts.length != 2) {
                    throw new IllegalArgumentException("格式非法");
                }
                byte[] iv = Base64.getDecoder().decode(parts[0]);
                byte[] ct = Base64.getDecoder().decode(parts[1]);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, keySpec, new GCMParameterSpec(TAG_BITS, iv));
                return new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
            } catch (Exception e) {
                throw new IllegalStateException("解密失败（密文损坏或密钥不匹配）", e);
            }
        }
        // 存量双读
        if (legacyHandler != null) {
            String plain = legacyHandler.decrypt(cipherText);
            if (plain != null) {
                return plain;
            }
        }
        throw new IllegalStateException("无法解密的存量密文（未配置 LegacyCipherHandler 或旧算法解不出）");
    }

    /** 判断是否平台新格式（写入侧决定是否需要重写迁移）。 */
    public static boolean isStandardFormat(String cipherText) {
        return cipherText != null && cipherText.startsWith(PREFIX);
    }
}
