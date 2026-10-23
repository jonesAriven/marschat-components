# @marschat/auth-components

> **MarsChat 认证 UI 组件库** — 统一登录面板、SSO 单点登录流程

提供开箱即用的认证组件，支持 OIDC PKCE 流程和独立登录模式。

## 📦 安装

```bash
pnpm add @marschat/auth-components
```

## 🚀 快速使用

### 1. LoginPanel 登录面板

```vue
<template>
  <LoginPanel
    title="MarsChat 统一认证"
    :show-sso="true"
    :show-forget-password="true"
    forget-password-url="/forgot-password"
    @sso-login="handleSsoLogin"
    @login="handleLogin"
  />
</template>

<script setup>
import { LoginPanel } from '@marschat/auth-components'

const handleSsoLogin = () => {
  // 触发 SSO 登录
}

const handleLogin = (credentials) => {
  // 处理独立登录
}
</script>
```

**Props**：

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `title` | `string` | `'登录'` | 面板标题 |
| `subtitle` | `string` | `''` | 副标题 |
| `logo` | `string` | `''` | Logo 图片 URL |
| `showSso` | `boolean` | `true` | 是否显示 SSO 登录按钮 |
| `showForgetPassword` | `boolean` | `true` | 是否显示忘记密码链接 |
| `forgetPasswordUrl` | `string` | `'/forgot-password'` | 忘记密码页面路径 |
| `loading` | `boolean` | `false` | 加载状态 |

**Events**：

| 事件 | 参数 | 说明 |
|------|------|------|
| `sso-login` | - | 点击 SSO 按钮时触发 |
| `login` | `{ username, password }` | 独立登录提交时触发 |
| `forget-password` | - | 点击忘记密码链接时触发 |

### 2. SsoCallbackView SSO 回调页

```vue
<template>
  <SsoCallbackView 
    auth-base-url="http://auth-center:8085"
    success-url="/dashboard"
    login-url="/login"
  />
</template>

<script setup>
import { SsoCallbackView } from '@marschat/auth-components'
</script>
```

**Props**：

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `authBaseUrl` | `string` (必填) | - | 认证服务地址 |
| `successUrl` | `string` | `'/'` | 登录成功后跳转地址 |
| `loginUrl` | `string` | `'/login'` | 登录失败回退地址 |

### 3. useAuth 组合式函数

```typescript
import { useAuth } from '@marschat/auth-components'

const {
  isLoggedIn,
  user,
  login,
  logout,
  ssoLogin,
  checkAuth,
} = useAuth({
  authBaseUrl: 'http://auth-center:8085',
  tokenStore: createLocalStorageTokenStore('my_app'),
})

// SSO 登录
await ssoLogin()

// 独立登录
await login({ username, password })

// 登出
await logout()
```

### 4. useSSO 组合式函数（底层 PKCE 流程）

```typescript
import { useSso } from '@marschat/auth-components'

const { initiateSsoFlow, handleSsoCallback } = useSso({
  authorizationEndpoint: 'http://auth-center:8085/oauth2/authorize',
  clientId: 'my-client',
  redirectUri: window.location.origin + '/callback',
})

// 发起 SSO 授权
await initiateSsoFlow()

// 处理回调
const tokens = await handleSsoCallback()
```

## 🔧 配置

### OIDC 配置

```typescript
// src/config/auth.ts
export const authConfig = {
  // 认证中心地址
  authBaseUrl: 'https://auth.marschat.online',
  
  // OIDC 客户端配置
  clientId: 'marschat-portal',
  redirectUri: `${window.location.origin}/oauth2/callback`,
  
  // 端点路径
  authorizationEndpoint: '/oauth2/authorize',
  tokenEndpoint: '/oauth2/token',
  userInfoEndpoint: '/userinfo',
  jwksUri: '/oauth2/jwks',
  
  // PKCE 配置
  pkceMethod: 'S256',  // S256 | plain
  
  // Token 存储 key 前缀（避免多应用冲突）
  tokenKeyPrefix: 'marschat_portal',
}
```

## 📁 导出列表

```typescript
// 组件
export { LoginPanel } from './components/LoginPanel.vue'
export { SsoCallbackView } from './components/SsoCallbackView.vue'

// 组合式函数
export { useAuth } from './composables/useAuth'
export { useSso } from './composables/useSso'

// 工具函数
export { generateCodeVerifier, generateCodeChallenge, generateState } from './utils/pkce'
export { buildAuthorizationUrl, parseCallbackParams, exchangeCodeForTokens } from './utils/sso'
export { storeTokens, getTokens, clearTokens } from './utils/token'

// 类型定义
export type { AuthConfig, TokenPair, UserInfo, SsoState } from './types'
```

## 🎨 样式定制

组件使用 CSS 变量，可覆盖默认样式：

```css
:root {
  --auth-primary-color: #409eff;
  --auth-border-radius: 4px;
  --auth-box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}
```

## 🌐 浏览器兼容性

- Chrome >= 90
- Firefox >= 88
- Safari >= 14
- Edge >= 90

> **注意**: PKCE 使用 Web Crypto API (`crypto.subtle`)，不支持 IE。

## 📄 License

MIT
