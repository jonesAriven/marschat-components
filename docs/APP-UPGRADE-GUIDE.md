# 各应用 SSO + 忘记密码功能接入指南

## 概述

本文档指导 6 个自研应用如何升级组件以支持：
1. **SSO 跨域单点登录** - 通过 Cookie Domain 共享实现免密访问
2. **忘记密码功能** - 集成到登录组件的四步流程

## 前置条件

### 1. 发布 marschat-components 组件

在 `marschat-components` 目录执行：

```bash
# 1. 构建 Java 组件（auth-core, common-core）
cd D:\huliang\java\ideaworkspace\marschat-components
pnpm run build:java

# 2. 构建并发布前端组件（auth-components, frontend-common）
pnpm run build
# 发布到 npm/GitLab Package Registry
pnpm publish --filter @marschat/auth-components
pnpm publish --filter @marschat/frontend-common
```

### 2. 部署 auth-center 新版本

auth-center 后端已添加 SSO Cookie 支持，需要重新构建部署：

```bash
cd D:\huliang\java\ideaworkspace\auth-center
mvn clean package -DskipTests
# 然后通过 CI/CD 流水线部署
```

---

## 各应用升级步骤

### 1. Portal (main.marschat.online)

**路径**: `D:\huliang\java\ideaworkspace\devtools\portal`

**当前状态**: 未使用 `@marschat/auth-components`

**升级步骤**:

```bash
cd D:\huliang\java\ideaworkspace\devtools\portal

# 1. 安装新组件
pnpm add @marschat/auth-components@latest @marschat/frontend-common@latest

# 2. 修改 src/views/LoginView.vue，使用 LoginPanel 组件
# 3. 修改 src/api/request.ts，使用 createRequest 创建请求实例
# 4. 修改 src/api/auth.ts，配置 SSO
```

**LoginView.vue 示例**:

```vue
<template>
  <div class="login-container">
    <LoginPanel 
      :config="loginConfig" 
      @login="handleLogin" 
      @sso-login="handleSsoLogin"
      @password-reset="handlePasswordReset"
    />
  </div>
</template>

<script setup lang="ts">
import { LoginPanel } from '@marschat/auth-components'
import { createRequest } from '@marschat/frontend-common'
import { useRouter } from 'vue-router'

const router = useRouter()

const loginConfig = {
  title: 'MarsChat 工具看板',
  subtitle: '统一导航与状态监控',
  icon: 'Monitor',  // Element Plus 图标名
  color: '#409eff',
  showSso: true,
  showForgotPassword: true,  // 启用忘记密码功能
  ssoConfig: {
    issuer: 'https://auth.marschat.online',
    clientId: 'portal',
    redirectUri: `${window.location.origin}/login`,
  },
  // 自定义文案（可选）
  labels: {
    ssoButtonText: 'SSO 统一认证登录',
    forgotPasswordText: '忘记密码？',
  },
}

// 独立登录
async function handleLogin(credentials: { username: string; password: string }) {
  const api = createRequest({ baseURL: '/portal-api' })
  const res = await api.post('/auth/login', credentials)
  // 登录成功，跳转到 dashboard
  router.push('/dashboard')
}

// SSO 登录（可选自定义逻辑，默认会自动跳转）
function handleSsoLogin() {
  // 默认行为：跳转到 auth-center
}

// 忘记密码成功回调
function handlePasswordReset() {
  console.log('密码重置成功')
}
</script>
```

**request.ts 示例**:

```typescript
// src/api/request.ts
import { createRequest } from '@marschat/frontend-common'

export const api = createRequest({
  baseURL: '/portal-api',
  ssoConfig: {
    issuer: 'https://auth.marschat.online',
    clientId: 'portal',
    redirectUri: `${window.location.origin}/login`,
  },
  onUnauthorized: () => {
    window.location.href = '/login'
  }
})

export default api
```

---

### 2. kb-ops (ops.marschat.online)

**路径**: `D:\huliang\java\ideaworkspace\devtools\kb-ops\kb-ops-web`

**当前状态**: 使用 `@marschat/request: 0.1.0`（旧版）

**升级步骤**:

```bash
cd D:\huliang\java\ideaworkspace\devtools\kb-ops\kb-ops-web

# 1. 移除旧包，安装新包
pnpm remove @marschat/request
pnpm add @marschat/auth-components@latest @marschat/frontend-common@latest

# 2. 更新 src/api/auth.ts - 配置 SSO
# 3. 更新 src/views/LoginView.vue - 使用 LoginPanel 组件
# 4. 更新 vite.config.ts - 配置 auth-components 按需导入
```

**vite.config.ts 更新**:

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // 指向本地开发或 npm 包
      '@marschat/auth-components': path.resolve(__dirname, '../marschat-components/packages/auth-components/src'),
      '@marschat/frontend-common': path.resolve(__dirname, '../marschat-components/packages/frontend-common/src'),
    }
  },
  // 开发时代理 auth-center
  server: {
    proxy: {
      '/api/auth': {
        target: 'http://localhost:8085',
        changeOrigin: true,
      }
    }
  }
})
```

---

### 3. infra-monitor (monitor.marschat.online)

**路径**: `D:\huliang\java\ideaworkspace\devtools\infra-monitor`

**升级步骤**: 同 kb-ops

---

### 4. cosmic-studio (192.168.31.105:8310)

**路径**: `D:\huliang\java\ideaworkspace\devtools\cosmic-studio`

**特殊说明**: 
- 内网 IP 访问，无需 HTTPS
- 需要在 `initTokenConfig` 中设置 `secure: false`

```typescript
import { initTokenConfig } from '@marschat/auth-components'

// 开发环境/内网环境关闭 secure
initTokenConfig({
  cookie: {
    domain: '',  // 内网可不设置域名
    secure: false,  // 内网 HTTP 环境
  }
})
```

---

### 5. kb-web (kb.marschat.online) 和 activecode (tools.marschat.online)

这两个应用需要单独查找其前端项目位置后进行类似升级。

---

## Nginx 配置更新

各应用的 Nginx 配置需要添加跨域 Cookie 支持：

```nginx
# 各子域应用的 Nginx 配置
server {
    listen 443 ssl;
    server_name kb.marschat.online;
    
    location /api/ {
        proxy_pass http://kb-web-backend:8080/;
        
        # 允许跨域 Cookie（关键！）
        proxy_cookie_domain auth.marschat.online $host;
        
        # 其他代理设置
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # CORS 设置（如需要）
        add_header Access-Control-Allow-Origin $http_origin;
        add_header Access-Control-Allow-Credentials true;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization";
    }
}
```

---

## 测试验证清单

### SSO 跨域测试

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | Portal SSO 登录 | 在 Portal 点击 SSO 登录 → 输入账密 | 登录成功 |
| 2 | 跨域访问 kb-web | Portal 登录后，新标签页打开 kb-web | 直接进入 dashboard |
| 3 | 跨域访问 kb-ops | Portal 登录后，新标签页打开 kb-ops | 直接进入 dashboard |
| 4 | 跨域访问 infra-monitor | Portal 登录后，新标签页打开 infra-monitor | 直接进入 dashboard |
| 5 | 登出联动 | 任一系统登出 | 其他系统也需要重新登录 |

### 忘记密码测试

| # | 场景 | 操作 | 预期结果 |
|---|------|------|----------|
| 1 | 点击忘记密码 | 登录页点击"忘记密码？" | 切换到邮箱输入视图 |
| 2 | 发送验证码 | 输入邮箱，点击发送 | 显示验证码输入视图，60s倒计时 |
| 3 | 验证码验证 | 输入正确验证码 | 切换到重置密码视图 |
| 4 | 重置密码 | 输入新密码，确认 | 显示成功提示 |
| 5 | 返回登录 | 点击"返回登录" | 回到登录表单 |
| 6 | 新密码登录 | 使用新密码登录 | 登录成功 |

---

## 回滚方案

如果新版本出现问题：

```bash
# 回滚到旧版本
pnpm add @marschat/auth-components@0.1.0
pnpm add @marschat/frontend-common@0.1.0

# 或禁用 SSO Cookie
initTokenConfig({ cookie: { domain: '' } })
```

---

## 关联文档

- [SSO 实施总结](./SSO-IMPLEMENTATION-SUMMARY.md)
- [auth-center 后端 Cookie 设置指南](./AUTH-CENTER-COOKIE-GUIDE.md)
- [忘记密码功能使用指南](../packages/auth-components/FORGOT-PASSWORD-USAGE.md)
- [ADR-SSO-001: Cookie Domain 共享方案](./ADR-SSO-Cookie-Domain-Sharing.md)
