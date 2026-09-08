package com.marschat.common.exception;

/**
 * 未登录或登录已过期 (401)
 */
public class NotLoginException extends BusinessException {
    public NotLoginException() {
        super(401, "未登录或登录已过期");
    }

    public NotLoginException(String message) {
        super(401, message);
    }
}
