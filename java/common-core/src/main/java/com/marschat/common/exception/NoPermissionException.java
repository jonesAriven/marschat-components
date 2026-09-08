package com.marschat.common.exception;

/**
 * 无操作权限 (403)
 */
public class NoPermissionException extends BusinessException {
    public NoPermissionException() {
        super(403, "无操作权限");
    }

    public NoPermissionException(String message) {
        super(403, message);
    }
}
