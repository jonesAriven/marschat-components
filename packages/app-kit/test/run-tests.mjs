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

console.log(`\n${'='.repeat(56)}`)
console.log(`配置派生自测：${passed} 通过 / ${failed} 失败（共 ${passed + failed} 项）`)
console.log('='.repeat(56))
process.exit(failed === 0 ? 0 : 1)
