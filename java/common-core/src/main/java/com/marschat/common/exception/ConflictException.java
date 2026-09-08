package com.marschat.common.exception;

/**
 * 数据冲突 (409)
 */
public class ConflictException extends BusinessException {
    public ConflictException(String message) {
        super(409, message);
    }
}
