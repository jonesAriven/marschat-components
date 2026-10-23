# 忘记密码功能集成指南

## 概述

忘记密码功能已集成到 `LoginPanel` 组件中，**无需跳转到独立页面**。整个流程在登录面板内完成：

```
登录页 → 点击"忘记密码" → 输入邮箱 → 发送验证码 → 验证 → 重置密码 → 返回登录
```

## 流程步骤

| 步骤 | 说明 | 用户操作 |
|------|------|----------|
| 1. email | 输入注册邮箱 | 点击"发送验证码" |
| 2. verify | 输入6位验证码 | 点击"验证"（可重发） |
| 3. reset | 设置新密码 | 确认后点击"重置密码" |
| 4. success | 显示成功提示 | 点击"返回登录" |

## 接入方式

### 方式一：使用默认 API（推荐）

组件内置的默认实现会调用 auth-center 的两个公开接口。**只需把 `authApiBase` 配成本应用域名下能到达 auth-center 的 nginx 前缀**即可：

```vue
<template>
  <LoginPanel :config="loginConfig" @login="handleLogin" />
</template>

<script setup lang="ts">
import { LoginPanel } from '@marschat/auth-components'

const loginConfig = {
  title: '知识库管理系统',
  showForgotPassword: true, // 默认 true，可省略
  // ★ 忘记密码 / 重置密码接口前缀（相对本应用 origin），默认 '/kb/api/auth'
  //   必须与本应用域名的 nginx 路由前缀一致，各应用取值见文末「各应用接入清单」
  authApiBase: '/kb/api/auth',
  showSso: true,
  ssoConfig: {
    issuer: 'https://auth.marschat.online',
    clientId: 'kb-web',
    redirectUri: `${window.location.origin}/login`,
  },
  onLogin: async (credentials) => {
    // 调用应用自己的登录接口
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    })
    if (!res.ok) throw new Error('登录失败')
    // 保存 token...
  },
}
</script>
```

> 组件拼接规则：`${authApiBase}/forgot-password`（发送验证码）、`${authApiBase}/reset-password`（重置密码）。
> `authApiBase` 可传相对路径（推荐，随页面 origin 走）或绝对 URL。

### 方式二：自定义 API 回调

如果应用的忘记密码接口不是默认路径，可以自定义回调。注意后端返回的是 `{code, message, data, traceId}` 信封，且**业务异常同样是 HTTP 200**：

```vue
<script setup lang="ts">
import { LoginPanel } from '@marschat/auth-components'
import type { SendCodeResponse, ResetPasswordRequest } from '@marschat/auth-components'

/** 通用：解析 Result 信封，业务失败抛错 */
async function callApi(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`)
  const json = await res.json()
  if (json?.code !== 200) throw new Error(json?.message || '操作失败')
  return json
}

const loginConfig = {
  title: '知识库管理系统',
  showForgotPassword: true,

  // 自定义发送验证码
  onSendCode: async (email: string): Promise<SendCodeResponse> => {
    await callApi('/your-prefix/forgot-password', { email })
    return { success: true, message: '验证码已发送', expiresIn: 60 }
  },

  // 自定义验证验证码
  // ⚠️ auth-center 没有独立的验证码预校验端点，验证发生在 reset-password 内部。
  //    如需自定义，请在此做本地格式校验（或自行新增后端端点），不要假装"已验证"。
  onVerifyCode: async (_email: string, code: string): Promise<boolean> => {
    return !!code
  },

  // 自定义重置密码（验证码是否正确以本步结果为准）
  onResetPassword: async (data: ResetPasswordRequest): Promise<void> => {
    await callApi('/your-prefix/reset-password', data)
  },
}
</script>
```

### 方式三：完全禁用忘记密码

```javascript
const loginConfig = {
  title: '我的应用',
  showForgotPassword: false, // 隐藏忘记密码链接
}
```

## 自定义文案

所有忘记密码相关的文案都可以自定义：

```javascript
const loginConfig = {
  title: 'Knowledge Base',
  labels: {
    forgotPasswordText: 'Forgot Password?',
    forgotPasswordTitle: 'Reset Password',
    emailPlaceholder: 'Enter your registered email',
    sendCodeText: 'Send Code',
    codePlaceholder: 'Enter verification code',
    resendCodeText: 'Resend',
    verifyCodeText: 'Verify',
    newPasswordPlaceholder: 'New password',
    confirmPasswordPlaceholder: 'Confirm password',
    resetPasswordText: 'Reset Password',
    passwordResetSuccessText: 'Password reset successfully!',
    backToLoginText: 'Back to Login',
  },
}
```

## 后端 API 要求

auth-center 实际只提供**两个**公开接口（`auth-center/AuthController.java`，均 `permitAll`）。

> ⚠️ **全局约定：业务异常同样返回 HTTP 200**，错误码在 body 的 `code` 字段。
> 前端必须同时校验 `response.ok` 与 `body.code === 200`，只看 HTTP 状态码会把业务失败误判为成功。

### 1. 发送验证码

```
POST {authApiBase}/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}

Response（防枚举：邮箱不存在也返回 200，静默不发送）:
{
  "code": 200,
  "message": "success",
  "data": null,
  "traceId": "..."
}
```

失败示例（60 秒内重发）：

```
HTTP 200
{ "code": 400, "message": "验证码发送过于频繁，请 60 秒后再试", "data": null }
```

### 2. 重置密码（校验验证码 + 改密 + 踢下线）

```
POST {authApiBase}/reset-password
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456",
  "newPassword": "newPassword123"
}

Response:
{
  "code": 200,
  "message": "success",
  "data": null,
  "traceId": "..."
}
```

失败示例：`{"code":400,"message":"验证码错误或已过期"}` / `{"code":400,"message":"验证码错误"}`

### 后端没有的接口（别再照着写）

- ❌ `/forgot-password/send-code` —— 不存在，发送验证码就是 `/forgot-password`
- ❌ `/forgot-password/verify-code` —— 不存在，验证码校验发生在 `/reset-password` 内部
- ❌ `/forgot-password/reset` —— 不存在，正确路径是 `/reset-password`

### 验证码存储与限流（Redis，供排障参考）

| 键 | 含义 | TTL |
|---|---|---|
| `auth:mail:code:RESET_PASSWORD:{email}` | 6 位验证码（一次性，验证成功即删） | 5 分钟 |
| `auth:mail:ratelimit:RESET_PASSWORD:{email}` | 60 秒发送限频标记 | 60 秒 |
| `auth:mail:fail:RESET_PASSWORD:{email}` | 连续错误计数（≥5 次触发锁定） | 15 分钟 |
| `auth:mail:lock:RESET_PASSWORD:{email}` | 锁定标记 | 15 分钟 |

## 安全注意事项

1. **验证码有效期**：建议 60-300 秒
2. **发送频率限制**：同一邮箱 60 秒内只能发送一次
3. **验证次数限制**：同一验证码最多验证 5 次
4. **密码强度校验**：后端应校验密码复杂度
5. **HTTPS**：生产环境必须使用 HTTPS

## 迁移指南

### 从旧版迁移（跳转独立页面）

**旧方式（❌ 已废弃）：**
```vue
<!-- 旧版：跳转到独立页面 -->
<a href="https://auth.marschat.online/forgot-password.html">忘记密码？</a>
```
> ⚠️ `https://auth.marschat.online/forgot-password.html` **这个页面从未部署过**（auth 域 nginx 白名单只放行 OIDC 端点，其余一律 404）。
> `myfrp/frontend/src/views/Login.vue` 里仍残留该链接，点击必 404，需改为组件内流程。

**新方式（✅ 推荐）：**
```vue
<!-- 新版：组件内完成 -->
<LoginPanel :config="{ showForgotPassword: true }" />
```

### 各应用接入清单

组件版本统一 ≥ **0.3.3**（0.3.2 及以前的默认实现 URL 与后端契约不匹配，必 404）。

| 应用 | 页面 origin | `authApiBase` | nginx 路由来源 |
|------|-------------|---------------|----------------|
| kb-web | `kb.marschat.online` | `/kb/api/auth` | mykng `locations/kb.conf`（→ kb-gateway） |
| kb-ops-web | `main.` / `kb.marschat.online` | `/ops/auth-api` | mykng `locations/ops.conf`（→ kb-gateway） |
| infra-monitor-web | `monitor.marschat.online` | `/kb/api/auth` | monitor 域 catch-all → mykng |
| portal | `main.marschat.online` | `/portal/auth-api` | main 域 + mykng `locations/portal.conf`（→ kb-gateway） |
| cosmic-studio | 待确认 | 待确认 | ⚠️ 尚未接入，需按其域名补路由 |

⚠️ **多域名应用注意**：`authApiBase` 是**相对本应用 origin** 解析的。
若同一应用会被多个域名访问，必须保证每个域名的 nginx 都放行了该前缀，否则会出现「A 域名能用、B 域名 404」。

## 测试用例

### 正常流程测试
1. [ ] 点击"忘记密码？"链接
2. [ ] 输入有效邮箱，点击"发送验证码"
3. [ ] 收到邮件，输入6位验证码
4. [ ] 点击"验证"，进入重置密码页面
5. [ ] 输入新密码和确认密码
6. [ ] 点击"重置密码"，显示成功提示
7. [ ] 点击"返回登录"，回到登录表单
8. [ ] 使用新密码登录成功

### 异常流程测试
1. [ ] 输入无效邮箱格式，显示校验错误
2. [ ] 不输入邮箱直接点发送，显示必填提示
3. [ ] 输入错误的验证码，显示错误信息
4. [ ] 两次密码不一致，显示校验错误
5. [ ] 密码长度不足6位，显示校验错误
6. [ ] 倒计时期间"重新发送"按钮禁用
7. [ ] 倒计时结束后可重新发送验证码
