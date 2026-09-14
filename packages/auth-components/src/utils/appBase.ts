/**
 * SPA 部署 base 的**统一读取点**（公共契约）。
 *
 * ## 背景：为什么公共库不能写死 `/login`
 * 本平台的每个 SPA 都部署在**子路径**下（kb-web=`/kb`、kb-ops=`/ops`、
 * infra-monitor=`/infra`、portal=`/portal`、cosmic=`/`）。
 * 而 `window.location.href = '/login'` / `<a href="/login">` 是**根相对**路径 ——
 * 浏览器会跳到域名根 `https://kb.marschat.online/login`，nginx 没有该 location
 * → **404 白页**（2026-09-14 良哥实测：kb.marschat.online/login）。
 *
 * ## 契约：应用在入口声明一次
 * ```ts
 * // 各应用 src/main.ts（唯一声明点）
 * window.__MARSCHAT_APP_BASE__ = CONTEXT_PATH   // 如 '/kb'
 * ```
 * 之后公共库（本 helper / request.ts / sessionWatcher / SsoCallbackView）
 * 都能拼出**带 base 的正确地址**，无需各自猜。
 *
 * ## 未声明时的行为
 * 返回 `''` → 地址退化为 `/login`，与修复前完全一致（零回归，不会把别处打坏）。
 */

declare global {
  interface Window {
    /** 应用部署 base（子路径），由各应用在入口用 CONTEXT_PATH 注入 */
    __MARSCHAT_APP_BASE__?: string
  }
}

/** 取本应用的部署 base（如 `/kb`）；未声明或为根部署时返回 `''` */
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
 * 把**应用内路径**（如 `/login`、`/dashboard`）补成带 base 的站内绝对路径。
 *
 * @example appPath('/login') → '/kb/login'（未声明 base 时 → '/login'）
 */
export function appPath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path // 已是绝对 URL，原样
  const base = getAppBase()
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
