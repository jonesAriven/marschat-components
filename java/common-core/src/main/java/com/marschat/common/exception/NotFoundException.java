package com.marschat.common.exception;

/**
 * 资源不存在 (404)
 */
public class NotFoundException extends BusinessException {
    public NotFoundException(String resource, Long id) {
        super(404, resource + " 不存在: " + id);
    }

    public NotFoundException(String message) {
        super(404, message);
    }
}
