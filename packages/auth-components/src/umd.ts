/**
 * @marschat/auth-core —— 框架无关的认证 SDK（UMD 单文件入口）
 *
 * ## 为什么单独出一个 UMD 入口
 *
 * `@marschat/auth-components` 的 ES 产物依赖 Vue + Element Plus，只适合有构建链的
 * SPA（kb-web / kb-ops / infra-monitor / portal / cosmic-studio）。
 * 而 **activation-code（activecode）前端是一张手写的静态 HTML 页 + 原生 JS**，
 * 没有 npm / vite / vue，无法 `import` 任何东西。
 *
 * 所以这里把「纯逻辑层」（PKCE、授权码换票、会话探针、统一登出、静默续期）
 * 单独打成一个 **自包含 UMD 单文件**：浏览器直接
 *
 * ```html
 * <script src="/activecode/marschat-auth-core.umd.js"></script>
 * <script>
 *   const sso = MarschatAuth.createSsoClient({ ... })
 *   await sso.bootstrapLoginPage()
 * </script>
 * ```
 *
 * 即可获得与 SPA 完全一致的紧密型接入能力（**同一份实现**，杜绝各应用各写一套）。
 *
 * ⚠️ 本入口**不导出任何 Vue 组件**，也不引入 element-plus，保证零依赖。
 * 构建命令：`pnpm --filter @marschat/auth-components build:umd`
 */

import { createSsoClient } from './client'
import type { SsoClient } from './client'
import {
  probeIdpSession,
  silentSignIn,
  startSsoLogin,
  handleSsoCallback,
  buildSsoAuthorizeUrl,
  buildSloUrl,
  ssoLogout,
  renewByReauthorize,
  bootstrapLoginPage,
  clearLocalAuth,
} from './utils/sso'
import {
  initTokenConfig,
  getToken,
  setToken,
  clearTokens,
  getIdToken,
  setIdToken,
  setTokenKind,
  getTokenKind,
  isOidcToken,
  decodeOidcClaims,
} from './utils/token'
// Phase 6：会话监视（SLO 跨应用联动）+ 统一用户管理数据源（均为纯逻辑，无 Vue 依赖）
import { createSessionWatcher, startSessionWatcher } from './utils/sessionWatcher'
import { createUserAdminClient } from './utils/userAdmin'
import type { SsoConfig, SessionProbeResult, SloOptions } from './types'

/**
 * 版本号（构建时由 vite define 注入）—— 挂到 `window.MarschatAuth.version`，便于线上排障时确认加载的是哪一版。
 */
declare const __AUTH_CORE_VERSION__: string

export const version: string =
  typeof __AUTH_CORE_VERSION__ === 'string' ? __AUTH_CORE_VERSION__ : '0.0.0-dev'

/**
 * ⚠️ 这里**刻意只用 named exports、不写 `export default`**。
 *
 * 原因（2026-09-11 实测）：UMD lib 模式下若同时存在 default 与 named 导出，rollup 会把整个模块
 * 挂成 `window.MarschatAuth.default`，静态页必须写 `MarschatAuth.default.createSsoClient(...)`，
 * 反直觉且容易踩坑。改成纯 named 后，`window.MarschatAuth` 本身就是那个对象：
 *
 * ```js
 * const sso = MarschatAuth.createSsoClient({ ... })
 * ```
 */

export {
  createSsoClient,
  probeIdpSession,
  silentSignIn,
  startSsoLogin,
  handleSsoCallback,
  buildSsoAuthorizeUrl,
  buildSloUrl,
  ssoLogout,
  renewByReauthorize,
  bootstrapLoginPage,
  clearLocalAuth,
  initTokenConfig,
  getToken,
  setToken,
  clearTokens,
  getIdToken,
  setIdToken,
  setTokenKind,
  getTokenKind,
  isOidcToken,
  decodeOidcClaims,
  // Phase 6：会话监视（SLO 跨应用联动）+ 统一用户管理数据源（activecode 静态页同样需要）
  createSessionWatcher,
  startSessionWatcher,
  createUserAdminClient,
}

export type { SsoClient, SsoConfig, SessionProbeResult, SloOptions }
