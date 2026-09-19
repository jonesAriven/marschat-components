# 内联公共组件说明（vendored）

`activation-code-server/src/main/resources/static/activecode/marschat-auth-core.umd.js`
**不是本应用源码**，而是公共组件仓 `marschat-components/packages/auth-components` 的构建产物，
为「无构建链的静态页」而内联。

| 项 | 值 |
|---|---|
| 来源包 | `@marschat/auth-components` |
| 版本 | `0.8.8` |
| 源文件 | `packages/auth-components/dist/marschat-auth-core.umd.js` |
| 落地位置 | `activation-code-server/src/main/resources/static/activecode/marschat-auth-core.umd.js` |
| 全局变量 | `window.MarschatAuth`（纯 named 导出，无 `.default`） |
| 文件大小 | 30426 bytes |
| sha256 | `be44ea0a2d1666c7be460185e7b526116573b657a9a7a4fe05d0ac8cef903249` |
| 内联原因 | active-code-server 前端是手写静态 HTML + 原生 JS，无 npm/vite/vue，无法 `import` 任何模块 |

## 为什么内联而不是走 Nexus

组件同时发布到 Nexus npm（`@marschat/auth-components`），但本服务是 **Maven 构建的 Java 服务**，
构建链里没有 npm。为保持「一套实现、两种分发」且不把 npm 引进 Maven 构建，采用内联 + 版本戳方式。

**唯一真源仍是公共组件仓**：该 `.umd.js` 只允许通过 `woodScript/sync-auth-core-umd.sh` 更新，禁止手改。

## 相关文件

| 文件 | 角色 |
|---|---|
| `static/activecode/marschat-auth-core.umd.js` | 内联的公共组件（只读产物，禁手改） |
| `static/activecode/sso.js` | 本应用**薄适配层**：键名映射 + 换票后调后端建 session，其余全部委托组件 |
| `static/activecode/login.html` | 登录页：启动遮罩 + 静默免登探测 + SSO 按钮 |
| `static/activecode/sso-callback.html` | 授权回调页：换票 → 建后端 session → 落地 |
| `static/activecode/main.html` | 业务页：`handleLogout` 走 SLO、401 走静默重授权 |

## 更新流程

```bash
# 1. 公共组件仓发新版本
cd marschat-components/packages/auth-components
pnpm --filter @marschat/auth-components build:umd

# 2. 同步内联副本（自动重算 sha256 并回写本文件的版本/大小/哈希）
bash devtools/woodScript/sync-auth-core-umd.sh

# 3. 校验内联产物哈希与组件产物一致（脚本末尾已自带断言）
sha256sum active-manager/activation-code-server/src/main/resources/static/activecode/marschat-auth-core.umd.js
```

线上排障时打开浏览器控制台执行 `MarschatAuth.version` 即可确认实际生效版本。
