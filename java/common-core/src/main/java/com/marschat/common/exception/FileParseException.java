package com.marschat.common.exception;

/**
 * 文件解析失败 (422)
 */
public class FileParseException extends BusinessException {
    public FileParseException(String fileName, String reason) {
        super(422, "文件解析失败 [" + fileName + "]: " + reason);
    }
}
