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

如果应用通过 Nginx 反向代理到 auth-center，只需配置 `showForgotPassword: true`（默认）：

```vue
<template>
  <LoginPanel :config="loginConfig" @login="handleLogin" />
</template>

<script setup lang="ts">
import { LoginPanel } from '@marschat/auth-components'

const loginConfig = {
  title: '知识库管理系统',
  showForgotPassword: true, // 默认 true，可省略
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

### 方式二：自定义 API 回调

如果应用的忘记密码接口不是默认路径，可以自定义回调：

```vue
<script setup lang="ts">
import { LoginPanel } from '@marschat/auth-components'
import type { SendCodeResponse, ResetPasswordRequest } from '@marschat/auth-components'

const loginConfig = {
  title: '知识库管理系统',
  showForgotPassword: true,
  
  // 自定义发送验证码
  onSendCode: async (email: string): Promise<SendCodeResponse> => {
    const res = await fetch('https://auth.marschat.online/api/auth/forgot-password/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return res.json()
  },
  
  // 自定义验证验证码
  onVerifyCode: async (email: string, code: string): Promise<boolean> => {
    const res = await fetch('https://auth.marschat.online/api/auth/forgot-password/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
    const data = await res.json()
    return data.valid === true
  },
  
  // 自定义重置密码
  onResetPassword: async (data: ResetPasswordRequest): Promise<void> => {
    const res = await fetch('https://auth.marschat.online/api/auth/forgot-password/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('重置密码失败')
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

auth-center 需要提供以下三个接口：

### 1. 发送验证码

```
POST /api/auth/forgot-password/send-code
Content-Type: application/json

{
  "email": "user@example.com"
}

Response:
{
  "success": true,
  "message": "验证码已发送",
  "expiresIn": 60
}
```

### 2. 验证验证码

```
POST /api/auth/forgot-password/verify-code
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456"
}

Response:
{
  "valid": true
}
```

### 3. 重置密码

```
POST /api/auth/forgot-password/reset
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456",
  "newPassword": "newPassword123"
}

Response:
{
  "success": true,
  "message": "密码重置成功"
}
```

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

**新方式（✅ 推荐）：**
```vue
<!-- 新版：组件内完成 -->
<LoginPanel :config="{ showForgotPassword: true }" />
```

### 各应用更新清单

| 应用 | 操作 |
|------|------|
| activecode | 升级 @marschat/auth-components 到最新版本 |
| kb-web | 升级 + 配置 onSendCode/onVerifyCode/onResetPassword（如需要） |
| cosmic-studio | 同上 |
| kb-ops | 同上 |
| infra-monitor | 同上 |
| portal | 同上 |

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
