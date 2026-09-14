/**
 * SPA 部署 base 的**统一读取点**（与 @marschat/auth-components 的 utils/appBase 同一契约）。
 *
 * ## 为什么公共库不能写死 `/login`
 * 本平台每个 SPA 都部署在**子路径**下（`/ops` / `/kb` / `/infra` / `/portal`）。
 * `window.location.href = '/login'` 是**根相对**路径 → 浏览器跳到域名根
 * `https://kb.marschat.online/login`，nginx 没有该 location → **404 白页**
 * （2026-09-14 实测：kb-ops 的 401 兜底路径踩中）。
 *
 * ## 契约：应用在入口声明一次
 * ```ts
 * // 各应用 src/main.ts（唯一声明点）
 * window.__MARSCHAT_APP_BASE__ = CONTEXT_PATH   // 如 '/ops'
 * ```
 * 未声明时返回 `''` → 地址退化为 `/login`，与修复前完全一致（零回归）。
 */

declare global {
  interface Window {
    /** 应用部署 base（子路径），由各应用在入口用 CONTEXT_PATH 注入 */
    __MARSCHAT_APP_BASE__?: string
  }
}

/** 取本应用的部署 base（如 `/ops`）；未声明或为根部署时返回 `''` */
export function getAppBase(): string {
  try {
    const raw = window.__MARSCHAT_APP_BASE__
    if (typeof raw !== 'string') return ''
    const trimmed = raw.replace(/\/+$/, '')
    return trimmed === '/' ? '' : trimmed
  } catch {
    return ''
  }
}

/**
 * 把**应用内路径**（如 `/login`）补成带 base 的站内绝对路径。
 *
 * @example appPath('/login') → '/ops/login'（未声明 base 时 → '/login'）
 */
export function appPath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path // 已是绝对 URL，原样返回
  const base = getAppBase()
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
