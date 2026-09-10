# ADR-LOGINPAGE-001: 登录页整页公共组件 LoginPage

**状态**: 已采纳（@marschat/auth-components 0.3.1 起可用，修复登录失败误弹成功见 0.3.2）
**日期**: 2026-09-10
**决策者**: 良哥
**关联问题**: 公共组件优先原则 / ADR-2026-09-09（组件发布到 Nexus）

---

## 1. 背景与问题

### 1.1 现状

接入 SSO 的各前端应用（cosmic-studio、kb-web、kb-ops、infra-monitor、portal 等）原本各自实现登录页：

- 有的用 `@marschat/auth-components` 的 `LoginPanel`（纯表单卡片），外面包一层自己写的渐变背景 div；
- 有的连组件都没用，手写整页；
- 0.2.0 还暴露了一个更深的坑：**库构建（lib mode）默认不把 CSS 打进 JS**，应用侧也没手动引 `style.css` → 线上登录页**完全没有组件样式**（裸表单）。

### 1.2 问题现象

1. **重复实现**：每个应用抄一份"左品牌右表单 + 渐变 + 响应式 + 深色"的外壳，改一次主色/品牌色要动 N 个仓库。
2. **样式不可控**：换主题、收紧间距、加动效，得一个个应用去改。
3. **裸样式**：组件样式没随包带上，登录页丑且不一致。
4. **交互缺陷**：`LoginPanel` 在"事件模式"（应用只监听 `@login`、不传 `onLogin`）下无条件弹 `ElMessage.success('登录成功')`，导致错误密码时也出现「登录成功 + 登录失败」双 toast 假象。

---

## 2. 决策

### 2.1 抽一个整页登录公共组件 `LoginPage`

- 位置：`packages/auth-components/src/components/LoginPage.vue`
- 形态：**品牌分栏外壳（左栏品牌区 + 右栏表单卡片）**，内嵌 `LoginPanel`（独立登录 / SSO / 忘记密码流程）。
- 设计目标：**接入应用只传 config + 监听事件，一行页面样式都不用写**。

### 2.2 关键设计约束（公共组件铁律）

| 约束 | 做法 |
|------|------|
| 配置驱动 | `title/subtitle/icon/color/brand/footerText/labels` 全可覆盖；深色、响应式内置 |
| 开箱即用样式 | `vite.config.ts` 加 `injectStyleImport()`，ES 产物顶部自动 `import './style.css'`（**不再要求应用手动引 CSS**） |
| 深色 / 响应式 | 组件自带 `--lp-*` 令牌 + `html.dark` 适配 + `<900px` 自动隐藏品牌栏 |
| 动效降级 | `prefers-reduced-motion` 下关闭入场与光晕动画 |

### 2.3 修复登录 toast 假象

`LoginPanel.handleLogin` 改为：仅当 `config.onLogin` 存在（组件托管模式）时，才在 `await onLogin()` 成功后弹成功提示；否则只 `emit('login', ...)`，由应用自行处理成败提示（应用侧已有 `ElMessage.error('登录失败…')`）。

### 2.4 版本与发布

- `@marschat/auth-components@0.3.1`：新增 `LoginPage` + 样式自动注入。
- `@marschat/auth-components@0.3.2`：修复登录失败误弹成功。
- 发布：`vite build` → `npm publish --registry https://nexus.marschat.online/repository/npm-hosted/`。
- **发布后应用 `npm i` 报 `ETARGET`**：Nexus 代理组有元数据缓存，加 `--prefer-online` 即可。

---

## 3. 用法（与包内 `LOGIN-PAGE-USAGE.md` 同步，包文档为权威源）

> 权威用法以 `packages/auth-components/LOGIN-PAGE-USAGE.md` 为准，本文档为 ADR 决策留存 + 同步副本。

### 3.1 最小接入

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
    tagline: 'COSMIC 功能点度量生产系统：编写库 / 归档库 / 质量门禁 / 业务词库',
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

### 3.2 配置项

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

### 3.3 能力

- ✅ **响应式**：< 900px 自动隐藏品牌栏，表单居中铺渐变
- ✅ **深色模式**：跟随系统 / `html.dark` / `:dark="true|false"` 强制
- ✅ **动效降级**：`prefers-reduced-motion` 下关闭入场与光晕动画
- ✅ **零样式代码**：0.3.1 起 ES 产物自动 `import './style.css'`，无需应用手动引

### 3.4 维护者发版与升级

```bash
cd D:\huliang\java\ideaworkspace\marschat-components\packages\auth-components
# 1. 改代码 → 升 version（同版本不能重复发布）
# 2. 构建
node ./node_modules/vite/bin/vite.js build
# 3. 发布到 Nexus npm-hosted
npm publish --registry=https://nexus.marschat.online/repository/npm-hosted/
# 4. 应用侧
npm i @marschat/auth-components@latest --prefer-online   # 代理组有缓存，加 --prefer-online
```

---

## 4. 后续其他应用接入清单

把"抄登录页"的应用改成统一 `LoginPage`：

- [ ] `devtools/mykng/kb-web`
- [ ] `devtools/kb-ops/kb-ops-web`
- [ ] `devtools/infra-monitor/infra-monitor-web`
- [ ] `devtools/portal`

统一后，登录视觉/交互改一次组件发版即可全应用生效。

---

## 5. 关联

- 决策原则：**公共组件优先**（跨应用复用的 UI/功能先抽组件发 Nexus，应用只做配置）——已写入 `~/.workbuddy/MEMORY.md` 行为铁律 9。
- 用法权威文档：`packages/auth-components/LOGIN-PAGE-USAGE.md`
- 发布机制：`ADR-2026-09-09 · 公共组件发布到 Nexus npm 私服`
- 实现位置：`packages/auth-components/src/components/LoginPage.vue`、`src/types/index.ts`（`LoginPageConfig`/`LoginBrandConfig`）、`src/index.ts`（已 export）
