# common-core

> **MarsChat 公共核心库** — `com.marschat:common-core`

统一返回结果、全局异常处理、链路追踪、MyBatis-Plus 自动配置、事件总线。

## 📦 快速接入

```xml
<dependency>
    <groupId>com.marschat</groupId>
    <artifactId>common-core</artifactId>
    <version>0.1.0-SNAPSHOT</version>
</dependency>
```

## 🎯 核心模块

### 1. 统一返回 (`result.Result`)

```java
// 成功返回
return Result.ok(data);
return Result.ok();  // 无数据

// 失败返回
return Result.fail("业务异常");
return Result.fail(400, "参数错误");

// 自动填充 traceId（从 MDC 读取）
Result<String> r = Result.ok("hello");
r.getTraceId();  // 当前请求的链路追踪 ID
```

**响应格式**：
```json
{
  "code": 200,
  "message": "success",
  "data": { ... },
  "traceId": "abc123"
}
```

### 2. 异常体系 (`exception.*`)

| 异常类 | HTTP 状态码 | 用途 |
|--------|-------------|------|
| `BusinessException` | 500 (可自定义) | 业务逻辑异常 |
| `NotFoundException` | 404 | 资源不存在 |
| `NoPermissionException` | 403 | 无权限访问 |
| `ConflictException` | 409 | 资源冲突 |
| `NotLoginException` | 401 | 未登录 |
| `FileParseException` | 400 | 文件解析异常 |

**使用示例**：
```java
// 抛出业务异常（自动被 GlobalExceptionHandler 捕获）
throw new NotFoundException("用户不存在");
throw new NoPermissionException("无权操作");
throw new BusinessException(400, "参数错误");
```

### 3. 全局异常处理 (`exception.GlobalExceptionHandler`)

引入即生效，自动处理：
- `BusinessException` → 返回业务错误码
- `MethodArgumentNotValidException` → 参数校验失败详情
- 其他 `Exception` → 500 通用错误

**启用方式**：添加到组件扫描路径即可（`@SpringBootApplication` 自动扫描）。

### 4. 链路追踪 (`trace.*`)

**自动配置**：引入后自动注册以下组件：

| 组件 | 说明 |
|------|------|
| `TraceIdInterceptor` | HTTP 请求拦截，生成/传递 traceId |
| `FeignTraceIdInterceptor` | Feign 调用透传 traceId 到下游 |
| `WebLogAspect` | 请求/响应日志 AOP 切面 |

**配置项**（application.yml）：
```yaml
marschat:
  trace:
    header-name: X-Trace-Id  # 可选，默认 X-Trace-Id
    log-request: true        # 是否打印请求日志
    log-response: true       # 是否打印响应日志
```

### 5. MyBatis-Plus 自动配置 (`mybatis.MybatisPlusAutoConfig`)

引入后自动配置：
- 分页插件（PageHelper）
- 逻辑删除（deleted 字段）
- 自动填充（createTime / updateTime）

**使用示例**：
```java
// 分页查询
PageResult<User> result = userService.page(new Page<>(1, 10), wrapper);

// PageResult 响应格式
// { "records": [...], "total": 100, "current": 1, "size": 10 }
```

### 6. 断言工具 (`assertor.*`)

```java
// 对象断言
CommonAssertions.notNull(obj, "对象不能为空");
CommonAssertions.notBlank(str, "字符串不能为空");

// 结果断言
AssertResult.isTrue(condition, "条件必须为真");
AssertResult.isFalse(condition, "条件必须为假");

// 字段断言
AssertField.notEmpty(list, "列表不能为空", "fieldName");
AssertField.maxLength(str, 100, "长度超限", "fieldName");
```

### 7. 事件总线 (`event.*`)

支持内存和 Redis Stream 两种实现：

```java
// 发布事件
eventBus.publish(new AppEvent("user.created", userId));

// 消费事件
@EventListener
public void onUserCreated(AppEvent event) {
    // 处理事件
}
```

**Redis Stream 配置**：
```yaml
marschat:
  event:
    type: redis  # memory | redis
    redis:
      stream-key: app-events
      group: consumer-group
```

## 🔧 配置项汇总

```yaml
marschat:
  trace:
    header-name: X-Trace-Id
    log-request: true
    log-response: true
  event:
    type: memory  # memory | redis
  mybatis-plus:
    logic-delete-field: deleted
    logic-delete-value: 1
    logic-not-delete-value: 0
```

## 📋 依赖要求

- **Java**: 21+
- **Spring Boot**: 3.2.x
- **MyBatis-Plus**: 3.5.5+

## 🌐 仓库信息

- **Gitee**: `git@gitee.com:jonesAriven/common-core.git`
- **Nexus**: https://nexus.marschat.online/repository/maven-snapshots/
- **Monorepo**: 已整合至 `marschat-components/java/common-core`
