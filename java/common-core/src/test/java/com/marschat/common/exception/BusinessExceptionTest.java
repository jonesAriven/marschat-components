package com.marschat.common.exception;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * BusinessException 异常体系单元测试
 */
@DisplayName("BusinessException 异常体系单元测试")
class BusinessExceptionTest {

    @Test
    @DisplayName("构造_仅message_默认code为400")
    void constructor_messageOnly_defaultCode400() {
        BusinessException ex = new BusinessException("参数错误");

        assertEquals(400, ex.getCode());
        assertEquals("参数错误", ex.getMessage());
    }

    @Test
    @DisplayName("构造_指定code和message_设置正确code")
    void constructor_codeAndMessage_setsSpecifiedCode() {
        BusinessException ex = new BusinessException(422, "文件解析失败");

        assertEquals(422, ex.getCode());
        assertEquals("文件解析失败", ex.getMessage());
    }

    @Test
    @DisplayName("构造_带原因_保留code和原因")
    void constructor_withCause_preservesCodeAndCause() {
        Throwable cause = new RuntimeException("IO 异常");
        BusinessException ex = new BusinessException(500, "服务异常", cause);

        assertEquals(500, ex.getCode());
        assertEquals("服务异常", ex.getMessage());
        assertSame(cause, ex.getCause());
    }

    @Test
    @DisplayName("NotFoundException_资源ID_返回code404")
    void notFoundException_withResourceId_hasCode404() {
        NotFoundException ex = new NotFoundException("用户", 999L);

        assertEquals(404, ex.getCode());
        assertTrue(ex.getMessage().contains("用户"));
        assertTrue(ex.getMessage().contains("999"));
    }

    @Test
    @DisplayName("NotFoundException_仅message_返回code404")
    void notFoundException_withMessageOnly_hasCode404() {
        NotFoundException ex = new NotFoundException("文档不存在");

        assertEquals(404, ex.getCode());
        assertEquals("文档不存在", ex.getMessage());
    }

    @Test
    @DisplayName("ConflictException_返回code409")
    void conflictException_hasCode409() {
        ConflictException ex = new ConflictException("名称冲突");

        assertEquals(409, ex.getCode());
        assertEquals("名称冲突", ex.getMessage());
    }

    @Test
    @DisplayName("NoPermissionException_无参_返回code403和默认消息")
    void noPermissionException_noArgs_hasCode403() {
        NoPermissionException ex = new NoPermissionException();

        assertEquals(403, ex.getCode());
        assertEquals("无操作权限", ex.getMessage());
    }

    @Test
    @DisplayName("NoPermissionException_带message_返回code403")
    void noPermissionException_withMessage_hasCode403() {
        NoPermissionException ex = new NoPermissionException("无权删除该资源");

        assertEquals(403, ex.getCode());
        assertEquals("无权删除该资源", ex.getMessage());
    }

    @Test
    @DisplayName("NotLoginException_无参_返回code401和默认消息")
    void notLoginException_noArgs_hasCode401() {
        NotLoginException ex = new NotLoginException();

        assertEquals(401, ex.getCode());
        assertEquals("未登录或登录已过期", ex.getMessage());
    }

    @Test
    @DisplayName("NotLoginException_带message_返回code401和自定义消息")
    void notLoginException_withMessage_hasCode401() {
        NotLoginException ex = new NotLoginException("请重新登录");

        assertEquals(401, ex.getCode());
        assertEquals("请重新登录", ex.getMessage());
    }

    @Test
    @DisplayName("FileParseException_返回code422且消息包含文件名和原因")
    void fileParseException_hasCode422AndContainsFileInfo() {
        FileParseException ex = new FileParseException("doc.pdf", "格式不支持");

        assertEquals(422, ex.getCode());
        assertTrue(ex.getMessage().contains("doc.pdf"));
        assertTrue(ex.getMessage().contains("格式不支持"));
    }

    @Test
    @DisplayName("子类异常_是BusinessException的子类")
    void subClasses_areBusinessExceptionSubtypes() {
        assertInstanceOf(BusinessException.class, new NotFoundException("test", 1L));
        assertInstanceOf(BusinessException.class, new ConflictException("test"));
        assertInstanceOf(BusinessException.class, new NoPermissionException());
        assertInstanceOf(BusinessException.class, new NotLoginException());
        assertInstanceOf(BusinessException.class, new FileParseException("test.pdf", "err"));
    }

    @Test
    @DisplayName("BusinessException_是RuntimeException的子类")
    void businessException_isRuntimeException() {
        BusinessException ex = new BusinessException("test");

        assertInstanceOf(RuntimeException.class, ex);
    }
}
