/**
 * 框架无关的认证客户端工厂（createSsoClient）
 *
 * 纯逻辑，零依赖（不引 Vue / Element Plus），
 * 同时被两个入口使用：
 * - `src/index.ts` —— 有构建链的 SPA（tree-shaking 后只带上用到的部分）
 * - `src/umd.ts`   —— 无构建链的静态页（打成自包含 UMD 单文件）
 *
 * 这样「一套实现、两种分发」，不会出现各应用各写一套 SSO 代码的老问题。
 */

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
import { getToken, getIdToken, isOidcToken, decodeOidcClaims } from './utils/token'
import { startSessionWatcher } from './utils/sessionWatcher'
import type { SessionWatcher, SessionWatcherOptions } from './utils/sessionWatcher'
import type { SsoConfig, SessionProbeResult, SloOptions, OidcClaims } from './types'

/**
 * 创建一个绑定好配置的 SSO 客户端。
 * 所有方法都已把 config 预置进去，调用方不用每次重复传。
 *
 * @example
 * ```ts
 * const sso = createSsoClient({
 *   issuer: 'https://auth.marschat.online',
 *   clientId: 'marschat-kbweb',
 *   redirectUri: 'https://kb.marschat.online/kb/sso-callback',
 *   loginUrl: 'https://kb.marschat.online/kb/login',
 * })
 *
 * // 登录页：有会话免登，无会话继续渲染登录框
 * if (await sso.bootstrapLoginPage('/kb/')) { /* 已跳走 *\/ }
 *
 * // 退出登录：销毁 IdP 会话，而不是只清本地
 * sso.logout()
 * ```
 */
export function createSsoClient(config: SsoConfig) {
  if (!config?.issuer) {
    throw new Error('[marschat-auth] createSsoClient 缺少 issuer')
  }
  if (!config?.clientId) {
    throw new Error('[marschat-auth] createSsoClient 缺少 clientId')
  }
  if (!config?.redirectUri) {
    throw new Error('[marschat-auth] createSsoClient 缺少 redirectUri')
  }

  return {
    /** 当前配置（只读快照） */
    config: { ...config },

    /** 会话探针：auth-center 侧是否还有有效 IdP 会话 */
    probeSession: (opts?: { timeoutMs?: number }): Promise<SessionProbeResult> =>
      probeIdpSession(config, opts),

    /** 静默免登：有会话直接跳授权（不返回），无会话返回 false */
    silentSignIn: (redirect?: string): Promise<boolean> => silentSignIn(config, redirect),

    /** 登录页入口编排：有会话免登，无会话返回 false（正常显示登录框） */
    bootstrapLoginPage: (redirect?: string, opts?: { force?: boolean }): Promise<boolean> =>
      bootstrapLoginPage(config, redirect, opts),

    /** 主动发起登录（跳授权端点，不返回） */
    login: (redirect?: string): Promise<never> => startSsoLogin(config, redirect),

    /** 处理授权回调：用 code + PKCE 换票，返回落地路径 */
    handleCallback: (searchParams?: URLSearchParams): Promise<string> =>
      handleSsoCallback(config, searchParams),

    /** 静默续期：重跑一次授权（token 过期 / 收到 401 时调用，不返回） */
    renew: (redirect?: string): Promise<never> =>
      renewByReauthorize(config, redirect || `${window.location.pathname}${window.location.search}`),

    /** 统一登出（SLO）：销毁 IdP 会话 + 清本地，然后回跳 */
    logout: (options?: SloOptions): void => ssoLogout(config, options),

    /** 仅构建登出 URL（需要自己控制跳转时机时用） */
    buildLogoutUrl: (options?: SloOptions): string => buildSloUrl(config, options),

    /** 构建授权 URL（自绘 SSO 按钮时用） */
    buildAuthorizeUrl: (): string => buildSsoAuthorizeUrl(config),

    /** 仅清本地凭据，不碰 IdP 会话 */
    clearLocalAuth: (): void => clearLocalAuth(),

    /**
     * 启动**会话监视**（Phase 6：单点登出跨应用联动）。
     *
     * SAS 不支持 back-channel logout，其他应用在别处登出后本地 token 不会失效。
     * 监视线程会在「页面切回可见 / 窗口获焦 / 定时（默认 60s）」时探一次
     * `/auth/session`，**确认**会话消失才清本地并跳登录页；探针失败一律保持现状。
     *
     * @returns 监视器句柄 —— **应用主动登出前必须 `.stop()`**，否则登出跳转途中
     *          监视器可能再判定一次，造成多余的二次跳转。
     *
     * @example
     * ```ts
     * const watcher = sso.watchSession({ intervalMs: 60_000 })
     * // 退出登录时：
     * watcher.stop()
     * sso.logout()
     * ```
     */
    watchSession: (options?: SessionWatcherOptions): SessionWatcher =>
      startSessionWatcher(config, options),

    // ---- token 便捷方法 ----
    getToken: (): string | null => getToken(),
    getIdToken: (): string | null => getIdToken(),
    decodeClaims: (token?: string): OidcClaims => decodeOidcClaims(token || getToken() || ''),
    isOidc: (): boolean => isOidcToken(),
  }
}

export type SsoClient = ReturnType<typeof createSsoClient>
