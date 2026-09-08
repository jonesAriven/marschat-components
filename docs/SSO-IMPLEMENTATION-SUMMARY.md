# SSO 单点登录 + 忘记密码功能 - 实施总结

**日期**: 2026-01-09  
**状态**: 前端组件开发完成，待各应用接入测试

---

## 一、已完成的工作

### 1. 忘记密码功能集成到登录组件 (ISS-001, ISS-002)

#### 修改的文件

| 文件 | 说明 |
|------|------|
| `packages/auth-components/src/types/index.ts` | 新增 `ForgotPasswordStep`、`SendCodeResponse`、`ResetPasswordRequest` 类型；扩展 `LoginPanelConfig` 和 `LoginPanelLabels` |
| `packages/auth-components/src/components/LoginPanel.vue` | 重写组件，集成四步忘记密码流程（email → verify → reset → success） |
| `packages/auth-components/FORGOT-PASSWORD-USAGE.md` | 创建使用指南文档 |
| `docs/ADR-SSO-Cookie-Domain-Sharing.md` | 添加 ADR-AUTH-002 决策记录 |

#### 功能特性

- ✅ **零页面跳转**：整个忘记密码流程在 LoginPanel 组件内完成
- ✅ **四步状态机**：输入邮箱 → 验证码验证 → 重置密码 → 成功提示
- ✅ **倒计时功能**：默认 60 秒倒计时，防止频繁发送
- ✅ **表单校验**：邮箱格式、验证码长度、密码一致性
- ✅ **可配置 API**：支持自定义 `onSendCode`、`onVerifyCode`、`onResetPassword` 回调
- ✅ **可配置文案**：所有 UI 文本均可自定义
- ✅ **默认 API**：不配置回调时使用默认端点对接 auth-center

---

### 2. SSO Cookie Domain 共享方案 (ISS-003)

#### 前端修改

| 文件 | 说明 |
|------|------|
| `packages/auth-components/src/utils/token.ts` | 重写，支持 Cookie 读写（Cookie 优先，localStorage 降级） |
| `packages/frontend-common/src/interceptors/authInterceptor.ts` | 增强，支持 SSO Cookie 模式（credentials: 'include'） |
| `packages/frontend-common/src/request.ts` | 增强，自动检测 Token 来源并适配请求方式 |

#### 后端修改

| 文件 | 说明 |
|------|------|
| `java/auth-core/src/main/java/com/marschat/auth/jwt/TokenProvider.java` | 新增 `resolveToken()`、`getTokenFromCookie()`、`resolveAndValidateUser()` 方法 |
| `java/auth-core/src/main/java/com/marschat/auth/web/MarsUserArgumentResolver.java` | 修改 `extractToken()` 使用统一的 Token 解析方法 |

#### 文档

| 文件 | 说明 |
|------|------|
| `docs/AUTH-CENTER-COOKIE-GUIDE.md` | auth-center 后端 Cookie 设置完整指南 |
| `docs/ADR-SSO-Cookie-Domain-Sharing.md` | ADR-SSO-001 架构决策记录 |

---

## 二、架构图

### SSO 登录流程（新）

```
┌─────────────────────────────────────────────────────────────────┐
│                        SSO 登录流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户 ──→ Portal (main.marschat.online)                          │
│              │                                                   │
│              │ 点击 "SSO 登录"                                    │
│              ↓                                                   │
│         auth.marschat.online/oauth2/authorize                    │
│              │                                                   │
│              │ 用户输入账密                                        │
│              ↓                                                   │
│         认证通过，重定向回 Portal                                  │
│         /login?code=AUTHORIZATION_CODE                           │
│              │                                                   │
│              │ Portal 用 code 换 token                            │
│              ↓                                                   │
│         POST /oauth2/token                                       │
│              │                                                   │
│              │ auth-center 返回:                                  │
│              │  1. JSON: { access_token, refresh_token }          │
│              │  2. Set-Cookie: sso_access_token=xxx;              │
│              │     Domain=.marschat.online; HttpOnly; Secure     │
│              ↓                                                   │
│         浏览器保存 Cookie（对所有子域有效）                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    SSO 跨域访问流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户已在 Portal SSO 登录                                         │
│       │                                                         │
│       │ 访问 kb.marschat.online/kb/dashboard                     │
│       ↓                                                         │
│  浏览器自动携带 Cookie: sso_access_token                         │
│       │                                                         │
│       ↓                                                         │
│  kb-web 后端从 Cookie 读取 Token (TokenProvider.resolveToken)     │
│       │                                                         │
│       │ Token 有效 → 直接进入 dashboard                           │
│       ↓                                                         │
│  ✅ 无需重新登录！                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 忘记密码流程（新）

```
┌─────────────┐    点击"忘记密码？"   ┌─────────────┐
│   登录表单    │ ─────────────────→ │  输入邮箱     │
│             │                    │             │
└─────────────┘                    └──────┬──────┘
       ↑                                │ 发送验证码
       │                          邮箱收到验证码
       │                                ↓
       │                          ┌──────┴──────┐
       │                          │ 输入验证码   │
       │                          │  (60s倒计时) │
       │                          └──────┬──────┘
       │                                │ 验证通过
       │                          ┌──────┴──────┐
       │                          │  设置新密码  │
       │                          └──────┬──────┘
       │                                │ 重置成功
       │                          ┌──────┴──────┐
       └──────────────────────────→│  成功提示   │
                                 │  返回登录   │
                                 └─────────────┘
```

---

## 三、Token 读取优先级

### 前端 (token.ts)

```
1. Cookie (sso_access_token)  ← SSO 模式，跨域共享
2. localStorage (app_access_token)  ← Legacy 模式，独立存储
```

### 后端 (TokenProvider.java)

```
1. Cookie (sso_access_token)  ← SSO 模式
2. Authorization Header (Bearer xxx)  ← Legacy 模式
3. X-Auth-Token Header  ← 兼容网关转发
```

---

## 四、待完成工作

### 1. 各应用升级组件版本

```bash
# 在各应用目录执行
pnpm add @marschat/auth-components@latest
pnpm add @marschat/frontend-common@latest
```

需要更新的应用：
- [ ] activecode
- [ ] kb-web
- [ ] cosmic-studio
- [ ] kb-ops
- [ ] infra-monitor
- [ ] portal

### 2. auth-center 后端改造

按照 `docs/AUTH-CENTER-COOKIE-GUIDE.md` 实施：
- [ ] 添加 `SsoCookieProperties` 配置类
- [ ] 添加 `SsoCookieUtil` 工具类
- [ ] 修改 `/oauth2/token` 端点，返回时设置 Cookie
- [ ] 修改 `/logout` 端点，登出时清除 Cookie
- [ ] 添加 `application.yml` 配置

### 3. Nginx 配置更新

确保各应用允许跨域 Cookie：
```nginx
proxy_cookie_domain auth.marschat.online $host;
```

### 4. 测试验证

详见下节测试用例。

---

## 五、测试用例

### SSO 跨域访问测试

| # | 测试场景 | 预期结果 | 状态 |
|---|----------|----------|------|
| 1 | Portal SSO 登录后，访问 kb-web | 直接进入 dashboard，无需登录 | ⏳ 待测 |
| 2 | Portal SSO 登录后，访问 infra-monitor | 直接进入 dashboard，无需登录 | ⏳ 待测 |
| 3 | Portal SSO 登录后，访问 kb-ops | 直接进入 dashboard，无需登录 | ⏳ 待测 |
| 4 | kb-web 独立登录后，刷新页面 | 保持登录状态 | ⏳ 待测 |
| 5 | 任一系统登出后，访问其他系统 | 需要重新登录 | ⏳ 待测 |

### 忘记密码功能测试

| # | 测试场景 | 预期结果 | 状态 |
|---|----------|----------|------|
| 1 | 点击"忘记密码？"链接 | 切换到输入邮箱视图 | ⏳ 待测 |
| 2 | 输入无效邮箱格式 | 显示校验错误 | ⏳ 待测 |
| 3 | 输入有效邮箱，点击发送 | 显示验证码输入视图，开始倒计时 | ⏳ 待测 |
| 4 | 倒计时期间，重发按钮禁用 | 按钮灰色不可点击 | ⏳ 待测 |
| 5 | 倒计时结束后，可重发验证码 | 按钮可点击，点击后重新倒计时 | ⏳ 待测 |
| 6 | 输入错误验证码 | 显示错误信息 | ⏳ 待测 |
| 7 | 输入正确验证码 | 切换到重置密码视图 | ⏳ 待测 |
| 8 | 两次密码不一致 | 显示校验错误 | ⏳ 待测 |
| 9 | 密码长度不足 | 显示校验错误 | ⏳ 待测 |
| 10 | 正确设置新密码 | 显示成功提示 | ⏳ 待测 |
| 11 | 点击"返回登录" | 回到登录表单 | ⏳ 待测 |
| 12 | 使用新密码登录 | 登录成功 | ⏳ 待测 |

---

## 六、文件清单

### 新增文件

```
marschat-components/
├── packages/
│   └── auth-components/
│       └── FORGOT-PASSWORD-USAGE.md    # 忘记密码使用指南
└── docs/
    ├── AUTH-CENTER-COOKIE-GUIDE.md      # 后端 Cookie 设置指南
    └── SSO-IMPLEMENTATION-SUMMARY.md    # 本文档
```

### 修改文件

```
marschat-components/
├── packages/
│   ├── auth-components/
│   │   ├── src/
│   │   │   ├── types/index.ts           # 新增类型定义
│   │   │   ├── components/LoginPanel.vue # 重写，集成忘记密码
│   │   │   └── utils/token.ts           # 重写，支持 Cookie
│   └── frontend-common/
│       └── src/
│           ├── interceptors/authInterceptor.ts  # 增强 SSO 支持
│           └── request.ts                      # 增强 SSO 支持
└── java/
    └── auth-core/
        └── src/main/java/com/marschat/auth/
            ├── jwt/TokenProvider.java           # 新增 Cookie 读取方法
            └── web/MarsUserArgumentResolver.java # 使用统一 Token 解析
```

---

## 七、回滚方案

如果新方案出现问题：

### 前端回滚

```typescript
// 在应用入口设置
import { initTokenConfig } from '@marschat/auth-components'

initTokenConfig({
  cookie: {
    domain: '',  // 不设置域，禁用 Cookie 共享
  }
})
```

### 后端回滚

注释掉 `SsoCookieUtil` 的调用即可。

---

## 八、关联文档

- [ADR-SSO-001: SSO 跨系统 Cookie Domain 共享方案](./ADR-SSO-Cookie-Domain-Sharing.md)
- [ADR-AUTH-002: 忘记密码功能集成到登录组件](./ADR-SSO-Cookie-Domain-Sharing.md#adr-auth-002-忘记密码功能集成到登录组件)
- [auth-center 后端 Cookie 设置指南](./AUTH-CENTER-COOKIE-GUIDE.md)
- [忘记密码功能使用指南](../packages/auth-components/FORGOT-PASSWORD-USAGE.md)
