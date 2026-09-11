/**
 * 会话监视器（Session Watcher）—— 让「单点登出」真正跨应用联动
 *
 * ## 解决什么问题
 *
 * SAS 1.x **不实现** OIDC Front-Channel / Back-Channel Logout
 * （`oauth2_registered_client` 表里连 `frontchannel_logout_uri` 列都没有）。
 * RP-Initiated Logout 只能保证「IdP 会话被销毁 + **发起方**清掉本地凭据」。
 * 于是实测出现：activecode 退出后，kb-web 刷新**仍然进 dashboard** ——
 * IdP 会话早就没了，但其余各应用的本地 token 还在。
 *
 * ## 怎么做（选型：探针联动，而非 iframe 广播）
 *
 * 在页面**重新可见**（`visibilitychange` / `focus`）与**定时轮询**时，
 * 询问 auth-center `/auth/session`；一旦**确认**会话已消失，就清本地并跳回登录页。
 *
 * 为什么不用 front-channel iframe 广播：那需要 auth-center 维护「登出页清单」、
 * 每个应用再各加一张静态页、还要处理 iframe 被 SameSite / CSP 拦掉的兼容性；
 * 探针方案是**纯前端、一处实现**，零后端改动，且直接复用既有已放行的 CORS 端点。
 * （广播策略作为后续可选增强，`SessionWatcherOptions.strategy` 已预留插槽。）
 *
 * ## 🔴 安全铁律：fail-safe，绝不误登出
 *
 * 只有 `probe.ok === true && probe.authenticated === false` 才算「**确认**失去会话」。
 * 探针失败（网络抖动 / 超时 / CORS / auth-center 重启期 502）一律**保持现状**并重置计数。
 * 否则认证中心抖一次，就会把全平台在线用户集体踢出去 —— 那比"登不掉"严重得多。
 */

import type { SsoConfig } from '../types'
import { probeIdpSession } from './sso'
import { getToken, clearTokens } from './token'

/** 会话监视器配置 */
export interface SessionWatcherOptions {
  /**
   * 轮询间隔（毫秒）。默认 60000（60 秒）。
   * 传 `<= 0` 关闭定时轮询，只保留「页面可见时」触发。
   */
  intervalMs?: number
  /** 页面从隐藏变可见（切回标签页）时立即探针，默认 `true` */
  watchVisibility?: boolean
  /** 窗口重新获得焦点时立即探针，默认 `true`（可与 watchVisibility 叠加去重） */
  watchFocus?: boolean
  /** 监听同源其他标签页的 localStorage 变化，触发一次探针，默认 `true` */
  watchStorage?: boolean
  /** 单次探针超时（毫秒），默认 4000 */
  timeoutMs?: number
  /**
   * 需要连续多少次「确认无会话」才真正登出，默认 1。
   * 设为 2+ 可进一步防抖（代价是登出联动慢一个周期）。
   */
  confirmCount?: number
  /**
   * 确认失去会话后是否自动跳转到登录页，默认 `true`。
   * 设为 `false` 时只清本地并回调 `onSessionLost`，由调用方决定去向。
   */
  redirectOnLost?: boolean
  /** 失去会话时的回调（在清本地**之后**、跳转**之前**调用） */
  onSessionLost?: (info: { username?: string | null; reason: 'probe' }) => void
  /** 探针发生「不可信失败」时的回调，便于应用侧埋点观测 */
  onProbeError?: (error: unknown) => void
  /**
   * 失去会话时的落地页。缺省取 `SsoConfig.loginUrl`，再缺省 `/login`。
   * 会自动带上 `?slo=1` 标记，便于登录页区分「被联动登出」与「主动访问」。
   */
  loginUrl?: string
  /**
   * 自定义「本地是否还持有凭据」判定。默认读组件库配置的 `accessTokenKey`。
   *
   * ★ 为什么必须可注入：**自管 token 的应用**（凭据存在自己的键上，例如 portal 的
   *   `portal_token`、cosmic-studio 的 `token`）若沿用默认实现，`getToken()` 读不到值 →
   *   `tick()` 在首行 `if (!readToken()) return false` **直接短路 → 永不探针 → SLO 联动静默失效**。
   *   （2026-09-12 实测：cosmic 的 bundle 里含监视器代码，但运行期 **0 次** `/auth/session` 探针，
   *     根因即此。）
   */
  getToken?: () => string | null | undefined
  /**
   * 失去会话时清理本地凭据。默认清组件库的 token 键 + `auth_user`。
   *
   * ★ 自管 token 的应用**必须**传入自己的清理函数，否则会「清掉组件库的键、留下自己的键」——
   *   本地凭据没清干净，下次静默免登又会把人登回去。
   */
  clearLocalAuth?: () => void
}

/** 会话监视器句柄 */
export interface SessionWatcher {
  /** 启动监视（幂等：重复调用只生效一次） */
  start(): void
  /** 停止监视并清理所有监听器/定时器 */
  stop(): void
  /** 暂停（保留监听器，但不做登出判定），用于登出流程自身 */
  pause(): void
  /** 恢复 */
  resume(): void
  /** 立即探针一次，返回「是否仍处于已登录状态」 */
  probeNow(): Promise<boolean>
  /** 是否正在运行 */
  isRunning(): boolean
  /** 是否处于暂停态 */
  isPaused(): boolean
}

/** 默认参数 */
const DEFAULTS = {
  intervalMs: 60_000,
  watchVisibility: true,
  watchFocus: true,
  watchStorage: true,
  timeoutMs: 4_000,
  confirmCount: 1,
  redirectOnLost: true,
} as const

/** 判断当前是否已经身处登录页（避免在登录页上反复自我跳转） */
function isOnLoginPage(loginUrl: string): boolean {
  try {
    const cur = new URL(window.location.href)
    const target = new URL(loginUrl, window.location.origin)
    // 只比 pathname，忽略 query（登录页可能带 ?redirect= / ?slo=1）
    return cur.origin === target.origin && cur.pathname === target.pathname
  } catch {
    return false
  }
}

/**
 * 创建一个绑定好配置的会话监视器。
 *
 * @example
 * ```ts
 * const watcher = startSessionWatcher(ssoConfig, { intervalMs: 60_000 })
 * // 应用退出登录前记得 watcher.stop()，避免"自己把自己再登一次"
 * ```
 */
export function createSessionWatcher(
  config: SsoConfig,
  options: SessionWatcherOptions = {}
): SessionWatcher {
  const opts = { ...DEFAULTS, ...options }
  const loginUrl = options.loginUrl || config.loginUrl || '/login'

  /**
   * 凭据读取 / 清理 —— 可被应用覆盖（见 `SessionWatcherOptions.getToken` / `clearLocalAuth`）。
   *
   * ⚠️ 默认实现只认**组件库自己的 token 键**；自管 token 的应用必须注入，否则 `readToken()`
   *    恒为假 → 监视器永不探针（这正是 cosmic-studio SLO 失效的根因）。
   */
  const readToken = options.getToken ?? getToken
  const clearAuth = options.clearLocalAuth ?? clearLocalAuthSafely

  let running = false
  let paused = false
  let timer: ReturnType<typeof setInterval> | null = null
  let probing = false
  let lostStreak = 0
  let firstProbeTimer: ReturnType<typeof setTimeout> | null = null

  /** 触发一次探针并做登出判定 */
  async function tick(): Promise<boolean> {
    if (!running || paused || probing) return true
    // 本地没有 token 时无需探针（未登录状态，探针无意义且浪费请求）
    if (!readToken()) {
      return false
    }
    probing = true
    try {
      const probe = await probeIdpSession(config, { timeoutMs: opts.timeoutMs })

      if (!probe.ok) {
        // 探针未成功执行 → 不可信 → 保持现状（fail-safe）
        lostStreak = 0
        opts.onProbeError?.(new Error('session probe failed (untrusted)'))
        return true
      }

      if (probe.authenticated) {
        lostStreak = 0
        return true
      }

      // 确认无会话：需连续 confirmCount 次
      lostStreak += 1
      if (lostStreak < opts.confirmCount) {
        return true
      }

      // ---- 确认失去会话，执行联动登出 ----
      lostStreak = 0
      const username = probe.username ?? null
      // 先停表，避免跳转过程中再次触发
      stopWatcher()
      clearAuth()
      opts.onSessionLost?.({ username, reason: 'probe' })

      if (opts.redirectOnLost && !isOnLoginPage(loginUrl)) {
        const sep = loginUrl.includes('?') ? '&' : '?'
        window.location.assign(`${loginUrl}${sep}slo=1`)
      }
      return false
    } finally {
      probing = false
    }
  }

  function clearLocalAuthSafely(): void {
    try {
      clearTokens()
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem('auth_user')
    } catch {
      /* ignore */
    }
  }

  /**
   * 停止监视（提取为具名函数：供 `tick` 内部与返回对象共用）。
   *
   * ⚠️ 必须抽出来 —— 早先在 `tick` 里直接写 `stop()` 引用的是「返回对象上的方法」，
   * 在闭包作用域里并不存在，会在**确认失去会话的那一刻**抛 ReferenceError，
   * 导致 SLO 跨应用联动静默失效（已被冒烟测试捕获）。
   */
  function stopWatcher(): void {
    running = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (firstProbeTimer) {
      clearTimeout(firstProbeTimer)
      firstProbeTimer = null
    }
    document.removeEventListener('visibilitychange', onWakeup)
    window.removeEventListener('focus', onWakeup)
    window.removeEventListener('storage', onStorage)
  }

  /** 页面可见 / 获得焦点 / 跨标签页存储变化 → 立即补一次探针 */
  function onWakeup(): void {
    if (!running || paused) return
    if (document.visibilityState === 'hidden') return
    void tick()
  }

  function onStorage(): void {
    if (!running || paused) return
    // 同源其他标签页改动了 localStorage（例如已登出清了 token）→ 立刻核验
    void tick()
  }

  return {
    start(): void {
      if (running) return
      running = true
      paused = false

      if (opts.watchVisibility) document.addEventListener('visibilitychange', onWakeup)
      if (opts.watchFocus) window.addEventListener('focus', onWakeup)
      if (opts.watchStorage) window.addEventListener('storage', onStorage)

      if (opts.intervalMs > 0) {
        timer = setInterval(() => void tick(), opts.intervalMs)
      }

      // 首次探针延迟 3s：避开登录/回调跳转的竞争窗口
      firstProbeTimer = setTimeout(() => void tick(), 3_000)
    },

    stop: stopWatcher,

    pause(): void {
      paused = true
    },

    resume(): void {
      paused = false
    },

    probeNow(): Promise<boolean> {
      return tick()
    },

    isRunning(): boolean {
      return running
    },

    isPaused(): boolean {
      return paused
    },
  }
}

/**
 * 便捷入口：创建并立即启动一个会话监视器。
 *
 * @returns 监视器句柄，应用**登出前必须调用 `.stop()`**
 */
export function startSessionWatcher(
  config: SsoConfig,
  options: SessionWatcherOptions = {}
): SessionWatcher {
  const watcher = createSessionWatcher(config, options)
  watcher.start()
  return watcher
}
