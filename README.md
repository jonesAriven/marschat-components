# MarsChat Components

> **MarsChat 公共组件库 Monorepo** — 一次开发，全处复用

统一管理所有自研系统的公共组件，包括前端 UI/工具库和后端核心库。

> 📌 **权威文档在 [`docs/统一认证平台手册.md`](./docs/统一认证平台手册.md)**（设计 · 接入 · 使用运维三篇合一）。
> 本文件只做「仓库门面 + 快速开始」，**接入细节、踩坑铁律、权限模型一律以 `docs/统一认证平台手册.md` 为准**。

## 📦 包概览

### 前端 npm 包 (`packages/`)

| 包名 | 版本 | 说明 |
|------|------|------|
| `@marschat/app-kit` | `0.1.9` | **装配层**：`createMarschatApp()` 一行完成运行时配置/令牌/SSO/401续期/守卫/会话监视/权限预取/路由注册；`createShell()` 共享外壳（Phase 13 新增） |
| `@marschat/auth-components` | `0.8.8` | 认证 UI（LoginPage/LoginPanel/SsoCallbackView）+ SSO client（PKCE/静默免登/续期）+ 用户管理面板×4（platform\|app 双作用域）+ PermissionGate + usePermissions/useMenus |
| `@marschat/frontend-common` | `0.3.5` | createRequest（401 静默续期拦截器）、createAuthGuard 路由守卫、TokenStore、SidebarMenu |

### Java Maven 包 (`java/`)

| 包名 | 版本 | 说明 |
|------|------|------|
| `common-core` | `1.1.6` | 公共核心库（Result、异常处理、链路追踪、MyBatis-Plus 配置、事件总线） |
| `auth-core` | `2.3.0` | 认证公共库（HS256 TokenProvider、RS256/JWKS OidcTokenVerifier、@MarsUser、@RequirePermission、菜单上报、Feign 透传、**BFF 管理代理自动装配：白名单配置化 + 凭据三模式 + 账号上报 SPI**、**登录校验放行配置化 `marschat.auth.anonymous`：路径级 Ant 通配 + 方法级精确 + 登录保底集**） |

> 版本基线 **2026-10-22**（app-kit 0.1.9「无令牌不预取权限」上线后实测态：五应用锁文件升级 + 逐条流水线部署）。升级前请核对 `docs/统一认证平台手册.md` 的版本基线行与 `docs/配置参考.md` 的配置全表。

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
│   ├── app-kit/                 #   装配层（0.1.9）：createMarschatApp 一行接入 + createShell 共享外壳
│   ├── auth-components/         #   认证 UI + SSO client（0.8.8）
│   │   ├── src/
│   │   │   ├── components/      #     LoginPage / LoginPanel / SsoCallbackView
│   │   │   │                    #     UserManagementPanel（platform|app 双作用域）
│   │   │   │                    #     CrossAppAuthPanel / AccountMappingPanel
│   │   │   │                    #     MenuPermissionPanel / UserMenuOverridePanel
│   │   │   │                    #     PermissionGate
│   │   │   ├── composables/     #     useAuth / useSso / usePermissions / useMenus
│   │   │   ├── utils/           #     sso(PKCE) / token / sessionWatcher / appBase
│   │   │   │                    #     userAdmin / accountMapping / authorizationMatrix
│   │   │   └── umd.ts           #     无构建静态页用的 UMD 入口
│   │   └── package.json
│   └── frontend-common/         #   前端公共工具（0.3.5）
│       └── src/                 #     request(401 静默续期) / createAuthGuard / TokenStore / SidebarMenu
├── java/                        # Java Maven 包
│   ├── common-core/             #   1.1.6：Result / 异常体系 / 链路 trace / MyBatis-Plus / 事件总线
│   └── auth-core/               #   2.3.0：TokenProvider(HS256) / OidcTokenVerifier(RS256·JWKS)
│                                #          @MarsUser / @RequirePermission / MenuRegistryReporter / Feign 透传
│                                #          BFF 管理代理（白名单配置化 + 凭据三模式 + 账号上报 SPI）
│                                #          登录校验放行配置化 marschat.auth.anonymous（路径级 + 方法级 + 保底集）
├── scripts/                     # 构建脚本
├── docs/统一认证平台手册.md               # 🔥 唯一权威手册
├── pnpm-workspace.yaml
└── package.json
```

## 🔧 使用方式

### 在前端项目中使用

```bash
# 添加依赖（新应用推荐直接用装配层 app-kit）
pnpm add @marschat/app-kit @marschat/auth-components @marschat/frontend-common
```

```typescript
// 使用认证组件
import { LoginPanel } from '@marschat/auth-components'
import { createRequest, createLocalStorageTokenStore } from '@marschat/frontend-common'

// 创建请求实例
const { request, authRequest } = createRequest({
  baseURL: '/api',
  authBaseURL: 'http://auth-center:8085',
  tokenStore: createLocalStorageTokenStore('my_app')
  // ⚠️ 不要传 hooks：@marschat/frontend-common@0.3.5 的 createRequest 无 hooks 字段（已发布产物 grep=0），
  //    传了静默失效（T-LOW-16）。错误提示与未登录跳转由 auth-components 的 useAuth 及 401 静默续期内置处理。
})
```

### 在后端项目中使用

```xml
<!-- pom.xml -->
<dependency>
    <groupId>com.marschat</groupId>
    <artifactId>common-core</artifactId>
    <version>1.1.6</version>
</dependency>
<dependency>
    <groupId>com.marschat</groupId>
    <artifactId>auth-core</artifactId>
    <version>2.3.0</version>
</dependency>
```

```yaml
# application.yml
marschat:
  oidc:
    issuer: https://auth.marschat.online                       # 与签发端逐字一致，错一个字符全部 token 验不过
    jwks-uri: http://<auth-center 内网地址>:8085/oauth2/jwks     # JWKS 走内网，不走公网
```

> ⚠️ **两件事别踩**：
> 1. `issuer` 必须与签发端**逐字一致**（踩坑 #8）。
> 2. **`JWT_SECRET` 每应用独立**，≥64B 随机，禁止 `Your…` 这类弱默认样式；密钥取值见 Vaultwarden，严禁写入任何文档或注释。
> 3. `kb-auth`（旧 HS256 自签服务）已下线，配置里若还写着 `http://kb-auth:8085` 请改为 auth-center 实际内网地址。

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

## 📚 文档

**平台文档**（`docs/`，权威级别从高到低）

| 文档 | 内容 |
|------|------|
| **[docs/统一认证平台手册.md](./docs/统一认证平台手册.md)** | 🔥 **权威手册（从这里开始）**：设计篇 / 接入篇（Level 0–5，含无构建静态页）/ 使用运维篇 + 50 条踩坑铁律 |
| **[docs/Phase13-配置化接入.md](./docs/Phase13-配置化接入.md)** | **配置化接入（Phase 13 决策记录）**：架构审计 → 设计（三处配置 + 一行装配）→ 实现 → 自测 → 6 应用迁移路线 |
| **[docs/状态与待办.md](./docs/状态与待办.md)** | ⏳ **未决项与待办**（唯一权威）：优先级清单 + 待拍板 + 已知取舍 + 下一轮路线 —— **接手先读** |
| **[docs/配置参考.md](./docs/配置参考.md)** | 配置项 / 环境变量 / 端点 / 已注册 client / 数据库真源 全表 |
| [docs/排查手册.md](./docs/排查手册.md) | 排查手册：症状 → 定位 → 根因 + 取证命令集 |
| [docs/登录测试用例.md](./docs/登录测试用例.md) | 6 系统登录功能测试用例（URL / 登录方式 / 预期）—— 手工验收与回归起点 |
| `docs/archive/phase12/Phase12全量验证报告-2026-09-17.md`、`docs/archive/phase12/R6多轮浏览器回归与缺陷修复-2026-09-18.md` | 验证与回归快照（历史证据） |

**包内组件用法**

| 文档 | 内容 |
|------|------|
| [packages/auth-components/使用说明.md](./packages/auth-components/使用说明.md) | 认证组件 API（LoginPage/LoginPanel/SsoCallbackView/各管理面板） |
| [packages/app-kit/使用说明.md](./packages/app-kit/使用说明.md) | **装配层 API（推荐入口）**：`createMarschatApp` 一行接入 + `createShell` 共享外壳 + 全部 options 字段 |
| [packages/auth-components/登录页使用说明.md](./packages/auth-components/登录页使用说明.md) | 统一登录页用法（含 `showLocalLogin` / `showMailLogin` 两个易漏字段） |
| [packages/auth-components/忘记密码使用说明.md](./packages/auth-components/忘记密码使用说明.md) | 忘记密码四步状态机 |
| [packages/frontend-common/使用说明.md](./packages/frontend-common/使用说明.md) | createRequest / createAuthGuard / TokenStore |
| [java/auth-core/使用说明.md](./java/auth-core/使用说明.md) | 后端验签与权限注解 |
| `devtools/docs/adr/` | 架构决策记录（决策史），最新为 `ADR-2026-09-16-Phase12-统一认证权限治理.md`；索引见同目录 `INDEX.md`。⚠️ **Phase 13 配置化接入的决策记录不在该目录**，见 `docs/Phase13-配置化接入.md` |

> ⚠️ 早期曾存在 `docs/INTEGRATION-GUIDE.md`、`docs/SSO-IMPLEMENTATION-SUMMARY.md`、`docs/ADR-SSO-Cookie-Domain-Sharing.md`、`docs/AUTH-CENTER-COOKIE-GUIDE.md`、`docs/APP-UPGRADE-GUIDE.md` 等 7 份文档，**已全部合并进 `docs/统一认证平台手册.md` 并从仓库删除**，旧链接会 404，勿再引用（沿革见 docs/统一认证平台手册.md 文末附录）。

## 📄 License

MIT
