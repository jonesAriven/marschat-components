# LoginPage 整页登录组件 · 使用指南

> 版本：@marschat/auth-components **0.3.1+**
> 目标：**接入应用不再自己写登录页**，只传配置 + 监听事件。改样式/改交互，改组件发版即可全应用生效。

## 一、为什么要有 LoginPage

`LoginPanel` 只负责「表单卡片」，外面的整页背景、品牌区、响应式、深色模式都得应用自己写 ——
结果每个应用各抄一份，改一次主色要动 N 个仓库（cosmic-studio 之前正是这样）。

`LoginPage` = **整页外壳（品牌分栏 + 渐变 + 响应式 + 深色）** + 内嵌 `LoginPanel`（表单/SSO/忘记密码）。

## 二、最小接入

```bash
pnpm add @marschat/auth-components@latest   # 或 npm i @marschat/auth-components@latest
```

```vue
<template>
  <LoginPage
    :config="loginConfig"
    @login="handleLogin"
    @sso-login="handleSsoLogin"
    @password-reset="handlePasswordReset"
  />
</template>

<script setup lang="ts">
import { LoginPage } from '@marschat/auth-components'

const loginConfig = {
  title: 'COSMIC 度量表',
  subtitle: '欢迎回来，登录后继续你的度量工作',
  icon: 'DataAnalysis',          // Element Plus 图标名（应用需全局注册图标）
  color: '#3d5af1',              // 主题色，驱动按钮/聚焦环/链接
  showSso: true,
  showForgotPassword: true,
  ssoConfig: {
    issuer: 'https://auth.marschat.online',
    clientId: 'cosmic-studio',
    redirectUri: `${window.location.origin}/sso-callback`,
    scope: 'openid profile',
  },
  brand: {
    name: 'COSMIC Studio',
    tagline: '一句话说明这个系统是干什么的',
    gradient: ['#1d2535', '#2f3f73'],   // 品牌区渐变
    highlights: [                        // 最多建议 4 条
      { icon: 'EditPen', title: '编写库', desc: '功能过程与数据属性在线编写' },
      { icon: 'Files', title: '归档库', desc: '版本归档与跨项目复用' },
    ],
  },
  footerText: '© 2026 COSMIC Studio · MarsChat 统一认证',
}

async function handleLogin({ username, password }) { /* 调自己的 /auth/login */ }
function handleSsoLogin() { /* 不传则用组件内置 OIDC 跳转 */ }
function handlePasswordReset() { /* 重置成功回调 */ }
</script>
```

**就这些。** 页面级样式一行都不用写。

## 三、配置项

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `title` | string | — | 卡片标题 |
| `subtitle` | string | — | 卡片副标题（品牌区未配 tagline 时复用） |
| `icon` | string \| object | — | Element Plus 图标名 |
| `color` | string | `#3d5af1` | 主题色 |
| `layout` | `'split' \| 'centered'` | `split` | 左品牌右表单 / 居中卡片 |
| `showSso` | boolean | true | 是否显示 SSO 按钮 |
| `showForgotPassword` | boolean | true | 是否显示忘记密码 |
| `ssoConfig` | SsoConfig | — | OIDC 配置 |
| `labels` | LoginPanelLabels | — | 全部文案可覆盖 |
| `brand` | `{ name, tagline, highlights[], gradient }` | — | 左栏品牌区（split 布局） |
| `footerText` | string | `© MarsChat · 统一认证` | 品牌区底部文字 |
| `onLogin/onSsoLogin/onSendCode/onVerifyCode/onResetPassword` | fn | — | 覆盖默认实现 |

## 四、能力

- ✅ **响应式**：< 900px 自动隐藏品牌栏，表单居中铺渐变
- ✅ **深色模式**：跟随系统 / `html.dark` / `:dark="true|false"` 强制
- ✅ **动效降级**：`prefers-reduced-motion` 下关闭入场与光晕动画
- ✅ **零样式代码**：组件自带样式（0.3.1 起 ES 产物自动 `import './style.css'`，无需应用手动引）

## 五、发版与升级（维护者看）

```bash
cd D:\huliang\java\ideaworkspace\marschat-components\packages\auth-components
# 1. 改代码 → 升 version（同版本不能重复发布）
# 2. 构建
node ./node_modules/vite/bin/vite.js build
# 3. 发布到 Nexus npm-hosted（~/.npmrc 已配 auth）
npm publish --registry=https://nexus.marschat.online/repository/npm-hosted/
# 4. 应用侧
npm i @marschat/auth-components@latest --prefer-online   # 代理组元数据有缓存，加 --prefer-online
```

⚠️ 两个坑（已踩）：
1. **代理组缓存**：发布后立刻装可能报 `ETARGET No matching version`，加 `--prefer-online` 即可。
2. **lib 模式不自动带 CSS**：0.2.0 各应用样式是「裸」的。0.3.1 起由 `vite.config.ts` 的
   `injectStyleImport()` 插件在 ES 产物顶部注入 `import './style.css'`，不要再回退这个改动。
