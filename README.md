# MarsChat Components

> **MarsChat 公共组件库 Monorepo** — 一次开发，全处复用

统一管理所有自研系统的公共组件，包括前端 UI/工具库和后端核心库。

## 📦 包概览

### 前端 npm 包 (`packages/`)

| 包名 | 版本 | 说明 |
|------|------|------|
| `@marschat/auth-components` | `0.1.0` | 认证 UI 组件（LoginPanel、SSO 流程、PKCE 工具） |
| `@marschat/frontend-common` | `0.2.0` | 前端公共工具（axios 封装、拦截器、composables） |

### Java Maven 包 (`java/`)

| 包名 | 版本 | 说明 |
|------|------|------|
| `common-core` | `0.1.0-SNAPSHOT` | 公共核心库（Result、异常处理、链路追踪、MyBatis-Plus 配置） |
| `auth-core` | `2.0.0` | 认证公共库（JWT 双验签、LoginUser、Feign 透传） |

## 🚀 快速开始

### 环境要求

- **Node.js**: >= 18.0.0
- **pnpm**: >= 8.0.0
- **Java**: 21
- **Maven**: 3.8+

### 安装依赖

```bash
# 前端包
pnpm install

# Java 包（自动安装到本地 Maven 仓库）
cd java/common-core && mvn clean install -DskipTests
cd java/auth-core && mvn clean install -DskipTests
```

### 构建全部

```bash
# 仅前端
pnpm build

# 全量（前端 + Java）
pnpm build:all
```

## 📁 项目结构

```
marschat-components/
├── packages/                    # 前端 npm 包
│   ├── auth-components/         #   认证 UI 组件
│   │   ├── src/
│   │   │   ├── components/      #     LoginPanel, SsoCallbackView
│   │   │   ├── composables/     #     useAuth, useSso
│   │   │   └── utils/           #     PKCE, SSO, Token 工具
│   │   └── package.json
│   └── frontend-common/         #   前端公共工具
│       ├── src/
│       │   ├── request.ts       #     axios 封装
│       │   ├── interceptors/    #     认证/错误拦截器
│       │   └── composables/     #     useLoading, usePagination
│       └── package.json
├── java/                        # Java Maven 包
│   ├── common-core/             #   公共核心库
│   │   └── src/main/java/com/marschat/common/
│   │       ├── result/          #     Result 统一返回
│   │       ├── exception/       #     异常体系 + GlobalExceptionHandler
│   │       ├── trace/           #     链路追踪 (TraceIdInterceptor)
│   │       ├── mybatis/         #     MyBatis-Plus 自动配置
│   │       └── event/           #     事件总线 (EventBus)
│   └── auth-core/               #   认证公共库
│       └── src/main/java/com/marschat/auth/
│           ├── jwt/             #     TokenProvider (HS256+RS256 双验签)
│           ├── oidc/            #     OidcTokenVerifier (JWKS RS256)
│           ├── feign/           #     AuthHeadersFeignInterceptor
│           ├── web/             #     @MarsUser 注解 + ArgumentResolver
│           └── LoginUser.java   #     登录用户模型
├── scripts/                     # 构建脚本
│   ├── build-all.ps1            #   全量构建
│   └── push-all.ps1             #   双远程推送
├── pnpm-workspace.yaml
├── package.json
└── .gitignore
```

## 🔧 使用方式

### 在前端项目中使用

```bash
# 添加依赖
pnpm add @marschat/auth-components @marschat/frontend-common
```

```typescript
// 使用认证组件
import { LoginPanel } from '@marschat/auth-components'
import { createRequest, createLocalStorageTokenStore } from '@marschat/frontend-common'

// 创建请求实例
const { request, authRequest } = createRequest({
  baseURL: '/api',
  authBaseURL: 'http://auth-center:8085',
  tokenStore: createLocalStorageTokenStore('my_app'),
  hooks: {
    onError: (msg) => ElMessage.error(msg),
    onUnauthorized: () => router.push('/login')
  }
})
```

### 在后端项目中使用

```xml
<!-- pom.xml -->
<dependency>
    <groupId>com.marschat</groupId>
    <artifactId>common-core</artifactId>
    <version>0.1.0-SNAPSHOT</version>
</dependency>
<dependency>
    <groupId>com.marschat</groupId>
    <artifactId>auth-core</artifactId>
    <version>2.0.0</version>
</dependency>
```

```java
// application.yml
marschat:
  auth:
    secret: "your-32-byte-secret-key-here!!!"
  oidc:
    issuer: https://auth.marschat.online
    jwks-uri: http://kb-auth:8085/oauth2/jwks
```

```java
// Controller 示例
@RestController
public class UserController {
    
    @Autowired
    private TokenProvider tokenProvider;
    
    @GetMapping("/me")
    public Result<?> me(@MarsUser LoginUser user) {
        return Result.ok(user);
    }
}
```

## 🌐 远程仓库

| 平台 | 地址 | 用途 |
|------|------|------|
| Gitee | `git@gitee.com:jonesAriven/marschat-components.git` | 主仓库 / 国内访问 |
| GitHub | `git@github.com:jonesAriven/marschat-components.git` | 镜像 / 国际访问 |

## 📋 版本管理

使用 [Changesets](https://github.com/changesets/changesets) 管理：

```bash
# 添加变更记录
pnpm changeset

# 生成版本号
pnpm version

# 发布到 npm
pnpm publish
```

## 🛠️ 开发指南

### 新增前端包

1. 在 `packages/` 下创建新目录
2. 添加 `package.json`（name 以 `@marschat/` 开头）
3. 在 `pnpm-workspace.yaml` 中无需额外配置（已通配 `packages/*`）

### 新增 Java 包

1. 在 `java/` 下创建新目录
2. 添加 `pom.xml`（groupId 为 `com.marschat`）
3. 更新 `scripts/build-all.ps1` 构建列表

## 📄 License

MIT
