/**
 * `@marschat/app-kit` 配置派生自测 —— 零依赖（Node 原生类型擦除），
 * 覆盖「配置化接入」中最容易出错、历史上真实出过事故的几处：
 * 路径前缀归一、双前缀回归、令牌键派生、配置优先级。
 *
 * 运行：node --experimental-strip-types test/run-tests.mjs
 */
import {
  resolveAppConfig,
  normalizeContextPath,
  baseFragment,
  deriveTokenKeys,
  mergeTokenKeys,
  appUrl,
  toRouterPath,
  DEFAULT_WHITE_LIST_PATHS,
} from '../src/config.ts'

let passed = 0
let failed = 0

function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.log(`  ✗ ${label}\n      期望 ${e}\n      实际 ${a}`)
  }
}

function throws(fn, label) {
  try {
    fn()
    failed++
    console.log(`  ✗ ${label}（未抛异常）`)
  } catch {
    passed++
    console.log(`  ✓ ${label}`)
  }
}

console.log('\n[1] normalizeContextPath —— 部署前缀归一')
eq(normalizeContextPath(undefined), '/', 'undefined → /')
eq(normalizeContextPath(''), '/', '空串 → /')
eq(normalizeContextPath('/'), '/', '/ → /')
eq(normalizeContextPath('kb'), '/kb', 'kb → /kb（补前导斜杠）')
eq(normalizeContextPath('/kb/'), '/kb', '/kb/ → /kb（去尾斜杠）')
eq(normalizeContextPath('kb/'), '/kb', 'kb/ → /kb')
eq(normalizeContextPath('/kb'), '/kb', '/kb → /kb（幂等）')

console.log('\n[2] baseFragment —— 根部署不得拼出 //login')
eq(baseFragment('/'), '', '根部署 → 空串')
eq(baseFragment('/kb'), '/kb', '子路径 → /kb')

console.log('\n[3] deriveTokenKeys —— 令牌键派生')
eq(deriveTokenKeys('marschat-kbweb').accessTokenKey, 'kbweb_access_token', 'marschat-kbweb → kbweb_access_token')
eq(deriveTokenKeys('cosmic-studio').accessTokenKey, 'cosmic_studio_access_token', 'cosmic-studio → 连字符净化')
eq(deriveTokenKeys('marschat-kbweb', 'kb_').accessTokenKey, 'kb_access_token', '显式前缀优先（存量应用保持旧键）')
eq(Object.keys(deriveTokenKeys('marschat-x')).sort(),
  ['accessTokenKey', 'idTokenKey', 'refreshTokenKey', 'tokenKindKey'].sort(), '四个键齐全（含 id_token）')

console.log('\n[4] resolveAppConfig —— 必填校验与配置优先级')
throws(() => resolveAppConfig({}), '缺 appId → 抛错')
throws(() => resolveAppConfig(undefined), 'options 为空 → 抛错')

const sub = resolveAppConfig(
  { appId: 'marschat-kbweb' },
  { contextPath: '/kb', apiBase: '/kb/api', clientId: 'marschat-kbweb' },
  'https://kb.marschat.online',
)
eq(sub.contextPath, '/kb', 'runtime.contextPath 生效')
eq(sub.apiBase, '/kb/api', 'runtime.apiBase 生效')
eq(sub.redirectUri, 'https://kb.marschat.online/kb/sso-callback', '回调地址 = origin + 前缀 + /sso-callback')
eq(sub.loginUrl, 'https://kb.marschat.online/kb/login', '登录页地址带前缀')
eq(sub.issuer, 'https://auth.marschat.online', 'issuer 回落内置默认')
eq(sub.sessionMode, 'oidc', '会话模式默认 oidc')
eq(sub.usersPath, '/users', '用户管理路径默认 /users')

const root = resolveAppConfig({ appId: 'cosmic-studio' }, { contextPath: '/' }, 'https://cosmic.marschat.online')
eq(root.redirectUri, 'https://cosmic.marschat.online/sso-callback', '根部署回调无多余斜杠')
eq(root.apiBase, '/api', '根部署 API 前缀')

const explicit = resolveAppConfig(
  { appId: 'marschat-x', contextPath: '/x', apiBase: '/x/api2', clientId: 'override', issuer: 'https://idp.example/' },
  { contextPath: '/ignored', apiBase: '/ignored', clientId: 'ignored' },
  'https://x.example',
)
eq(explicit.contextPath, '/x', '显式选项 > runtime')
eq(explicit.apiBase, '/x/api2', '显式 apiBase 覆盖 runtime')
eq(explicit.clientId, 'override', '显式 clientId 覆盖 runtime')
eq(explicit.issuer, 'https://idp.example', 'issuer 尾斜杠被归一（逐字一致要求）')

console.log('\n[5] 可选行为配置')
const custom = resolveAppConfig({
  appId: 'marschat-portal',
  sessionMode: 'bff',
  usersPath: false,
  loginPath: '/auth/login',
  callbackPath: '/auth/callback',
  homePath: '/home',
  tokenKeyPrefix: 'portal_',
  whiteListPaths: ['/custom'],
  sessionProbeIntervalMs: 30_000,
}, {}, 'https://main.marschat.online')
eq(custom.sessionMode, 'bff', 'sessionMode 可切 bff（消除 portal 特例分支）')
eq(custom.usersPath, false, 'usersPath:false 可关闭用户管理路由')
eq(custom.loginPath, '/auth/login', '登录路径可配')
eq(custom.callbackPath, '/auth/callback', '回调路径可配')
eq(custom.tokenKeys.accessTokenKey, 'portal_access_token', '令牌键可配（portal 保持旧键）')
eq(custom.sessionProbeIntervalMs, 30_000, '探针间隔可配')
eq(custom.whiteListPaths.includes('/custom') && custom.whiteListPaths.includes('/login'), true, '白名单与默认项合并')

console.log('\n[6] 白名单去重')
const dup = resolveAppConfig({ appId: 'marschat-x', whiteListPaths: ['/login', '/extra'] }, {}, 'https://x')
eq(dup.whiteListPaths.filter((p) => p === '/login').length, 1, '重复项被去重')
eq(dup.whiteListPaths.length, DEFAULT_WHITE_LIST_PATHS.length + 1, '合并后长度正确')

console.log('\n[7] toRouterPath —— 双前缀事故的根治点')
eq(toRouterPath({ contextPath: '/kb' }, '/kb/dashboard'), '/dashboard', '/kb/dashboard → /dashboard')
eq(toRouterPath({ contextPath: '/kb' }, '/kb'), '/', '裸前缀 → /')
eq(toRouterPath({ contextPath: '/kb' }, '/dashboard'), '/dashboard', '已无前缀 → 原样')
eq(toRouterPath({ contextPath: '/' }, '/dashboard'), '/dashboard', '根部署原样')
eq(toRouterPath({ contextPath: '/infra' }, '/infra/services'), '/services', 'infra 同款')
eq(toRouterPath({ contextPath: '/kb' }, '/kbitem'), '/kbitem', '不得误伤同前缀兄弟路径（/kb vs /kbitem）')
eq(toRouterPath({ contextPath: '/kb' }, ''), '/', '空路径 → /')

console.log('\n[8] appUrl —— 站内绝对地址拼接')
eq(appUrl({ contextPath: '/kb' }, '/users', 'https://kb.marschat.online'),
  'https://kb.marschat.online/kb/users', '子路径拼接')
eq(appUrl({ contextPath: '/' }, '/users', 'https://cosmic.marschat.online'),
  'https://cosmic.marschat.online/users', '根部署无多余斜杠')
eq(appUrl({ contextPath: '/kb' }, 'users'), '/kb/users', '缺前导斜杠自动补')

console.log('\n[9] 端到端：kb-web 接入配置（对照线上实测值）')
const kb = resolveAppConfig(
  { appId: 'marschat-kbweb' },
  { clientId: 'marschat-kbweb', issuer: 'https://auth.marschat.online', contextPath: '/kb', apiBase: '/kb/api' },
  'https://kb.marschat.online',
)
eq(kb.redirectUri, 'https://kb.marschat.online/kb/sso-callback', 'redirect_uri 与 apps-registry 登记一致')
eq(kb.authApiBase, '/kb/api/auth', '认证接口前缀默认派生')
eq(kb.tokenKeys.accessTokenKey, 'kbweb_access_token', '默认令牌键')
eq(kb.contextPath + kb.loginPath, '/kb/login', '登录页 = 前缀 + 路径')

console.log('\n[10] tokenKeys 显式覆盖 —— 非 `<prefix>access_token` 形态应用的接入能力（0.1.3）')
{
  // 场景 A：portal 形态 —— 只有一个键是非标准形态（portal_token），其余仍走前缀派生。
  // 这是最危险的中间态：若实现是「传了 tokenKeys 就不派生」，漏传键会变 undefined
  // → localStorage 读到字面量 "undefined" → 老用户静默掉登录态。
  const partial = resolveAppConfig({
    appId: 'marschat-portal',
    tokenKeyPrefix: 'portal_',
    tokenKeys: { accessTokenKey: 'portal_token' },
  }, {}, 'https://main.marschat.online')
  eq(partial.tokenKeys.accessTokenKey, 'portal_token', 'A·显式键生效（覆盖派生值 portal_access_token）')
  eq(partial.tokenKeys.refreshTokenKey, 'portal_refresh_token', 'A·未覆盖的键仍走前缀派生（不得为 undefined）')
  eq(partial.tokenKeys.tokenKindKey, 'portal_token_kind', 'A·未覆盖的键仍走前缀派生（不得为 undefined）')
  eq(partial.tokenKeys.idTokenKey, 'portal_id_token', 'A·未覆盖的键仍走前缀派生（不得为 undefined）')

  // 场景 B：全量覆盖 —— 四个键都不遵循前缀形态。
  const full = resolveAppConfig({
    appId: 'marschat-portal',
    tokenKeyPrefix: 'portal_',
    tokenKeys: {
      accessTokenKey: 'portal_token',
      refreshTokenKey: 'portal_refresh',
      tokenKindKey: 'portal_kind',
      idTokenKey: 'portal_id',
    },
  }, {}, 'https://main.marschat.online')
  eq(full.tokenKeys, {
    accessTokenKey: 'portal_token',
    refreshTokenKey: 'portal_refresh',
    tokenKindKey: 'portal_kind',
    idTokenKey: 'portal_id',
  }, 'B·全量显式键完全覆盖派生结果')

  // 场景 C：显式传 undefined 的字段**不覆盖**（`{ a: undefined }` 等价于不传该字段）。
  const undef = resolveAppConfig({
    appId: 'marschat-portal',
    tokenKeyPrefix: 'portal_',
    tokenKeys: { accessTokenKey: 'portal_token', refreshTokenKey: undefined, tokenKindKey: undefined, idTokenKey: undefined },
  }, {}, 'https://main.marschat.online')
  eq(undef.tokenKeys.accessTokenKey, 'portal_token', 'C·undefined 字段不覆盖已给定的键')
  eq(undef.tokenKeys.refreshTokenKey, 'portal_refresh_token', 'C·显式 undefined 的字段回落派生')
  eq(undef.tokenKeys.tokenKindKey, 'portal_token_kind', 'C·显式 undefined 的字段回落派生')
  eq(undef.tokenKeys.idTokenKey, 'portal_id_token', 'C·显式 undefined 的字段回落派生')

  // 场景 D：回归保护 —— 不传 tokenKeys 时结果必须与 0.1.2 逐字段相同（kb-ops / infra-monitor 零影响）。
  const legacyKbOps = resolveAppConfig({ appId: 'marschat-kbops', tokenKeyPrefix: 'kb_' }, {}, 'https://kb.marschat.online')
  eq(legacyKbOps.tokenKeys, deriveTokenKeys('marschat-kbops', 'kb_'), 'D·不传 tokenKeys 与 deriveTokenKeys 逐字一致（0.1.2 回归保护）')
  const legacyInfra = resolveAppConfig({ appId: 'marschat-infra-monitor' }, {}, 'https://infra.marschat.online')
  eq(legacyInfra.tokenKeys, deriveTokenKeys('marschat-infra-monitor', undefined), 'D·无前缀应用的派生结果不变')
  eq(legacyInfra.tokenKeys, {
    accessTokenKey: 'infra_monitor_access_token',
    refreshTokenKey: 'infra_monitor_refresh_token',
    tokenKindKey: 'infra_monitor_token_kind',
    idTokenKey: 'infra_monitor_id_token',
  }, 'D·对照 0.1.2 线上实测值逐字一致')
  // tokenKeys 为空对象时也必须等价于「不传」
  eq(resolveAppConfig({ appId: 'marschat-kbops', tokenKeyPrefix: 'kb_', tokenKeys: {} }, {}, 'https://kb').tokenKeys,
    deriveTokenKeys('marschat-kbops', 'kb_'), 'D·空对象覆盖等价于不传')
  // mergeTokenKeys 独立函数与 resolveAppConfig 走同一条路径
  eq(mergeTokenKeys('marschat-portal', 'portal_', { accessTokenKey: 'portal_token' }),
    resolveAppConfig({ appId: 'marschat-portal', tokenKeyPrefix: 'portal_', tokenKeys: { accessTokenKey: 'portal_token' } }, {}, 'https://m').tokenKeys,
    'D·mergeTokenKeys 与 resolveAppConfig 结果一致（单一实现，无第二套逻辑）')
}

console.log('\n[11] 会话监视判据 —— 布尔闸门语义（0.1.3 回归保护，纯函数等价物）')
{
  // 判据逻辑内联在此复刻，因其依赖 getToken()（浏览器 API）无法在 Node 直测。
  // 目的是把「布尔 true 不越过 sessionMode 闸门」这条最容易写错的语义钉死。
  const decide = (watchSession, sessionMode) => {
    const useWatcher = typeof watchSession === 'function'
      ? watchSession()
      : (watchSession ?? true) && sessionMode === 'oidc'
    return useWatcher
  }
  eq(decide(undefined, 'oidc'), true, '不传 + oidc → 启动监视（0.1.3 行为不变）')
  eq(decide(undefined, 'bff'), false, '不传 + bff → 不启动（纯 BFF 单模闸门）')
  eq(decide(true, 'oidc'), true, 'true + oidc → 启动')
  // 🔴 这条是最危险的：布尔 true 若越过 sessionMode，纯 BFF 应用会被误踢
  eq(decide(true, 'bff'), false, '🔴 true + bff →仍不启动（布尔不得越过 sessionMode 闸门）')
  eq(decide(false, 'oidc'), false, 'false + oidc → 不启动（显式关闭）')
  // 函数式：按会话实时判定，且**不受** sessionMode 闸门约束（双模应用自判）
  eq(decide(() => true, 'bff'), true, '函数返回 true + bff → 启动（双模：本次是 oidc 会话）')
  eq(decide(() => false, 'oidc'), false, '函数返回 false + oidc → 不启动（双模：本次是账密会话）')
  // 布尔 vs 函数覆盖同一输入 → 结果一致（证明两条路径语义统一，无第二套判断）
  eq(decide(() => true, 'oidc'), decide(true, 'oidc'), '函数 true 与布尔 true 在 oidc 下一致')
  eq(decide(() => false, 'bff'), decide(false, 'oidc'), '函数 false 与显式关闭一致')
}

console.log(`\n${'='.repeat(56)}`)
console.log(`配置派生自测：${passed} 通过 / ${failed} 失败（共 ${passed + failed} 项）`)
console.log('='.repeat(56))
process.exit(failed === 0 ? 0 : 1)
