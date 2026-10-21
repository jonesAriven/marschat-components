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
  runtimeConfigCandidates,
  resolvePermissionsIssuer,
  DEFAULT_WHITE_LIST_PATHS,
  parseRuntimeConfig,
  classifyRuntimeConfigFailure,
  formatRuntimeConfigWarning,
  loadRuntimeConfig,
  buildPermissionsUrl,
  classifyPermissionsFailure,
  formatPermissionsWarning,
  warnPermissionsFailure,
  createPermissionsWarnDedupe,
  resetPermissionsWarnDedupe,
  PERMISSIONS_FAIL_OPEN_CONSEQUENCE,
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

console.log('\n[12] 运行时配置探测候选 —— context-path 应用不再静默失效（2026-10-17 实测缺陷）')
{
  eq(runtimeConfigCandidates('/', '/infra/login'), ['/infra/', '/'],
     '🔴 显式 / 视为未指定 → /infra/ 排在最前（context-path 应用零 404 命中真实配置）')
  eq(runtimeConfigCandidates(undefined, '/infra/login'), ['/infra/', '/'],
     '未显式传 + /infra/login → 同上（默认值即 /，同样视为未指定）')
  eq(runtimeConfigCandidates('/portal', '/portal/login'), ['/portal/', '/'],
     '显式 /portal → 去重后 [ /portal/, / ]（前缀归一 + 尾斜杠补齐）')
  eq(runtimeConfigCandidates(undefined, '/kb/'), ['/kb/', '/'],
     '未显式传 + /kb/ → [/kb/, /]（根候选兜底）')
  eq(runtimeConfigCandidates(undefined, '/'), ['/'],
     '根部署 → 只有 /（零多余请求，行为与旧版一致）')
  eq(runtimeConfigCandidates(undefined, '/a/b/login'), ['/a/b/', '/a/', '/'],
     '多级前缀 → 完整目录先于首段（防误命中上级应用的配置）')
  eq(runtimeConfigCandidates('kb', '/kb/x'), ['/kb/', '/'],
     '无前导斜杠的显式值被归一（kb → /kb/）')
  // 🔴 去重铁律：显式值与推导值相同时不得重复请求（否则 context-path 应用每次多一次 404）
  eq(runtimeConfigCandidates('/ops', '/ops/dashboard'), ['/ops/', '/'],
     '显式与推导同源 → 去重，不产生重复请求')
}

console.log('\n[13] 权限查询基址缺省 —— 不再回落到跨域 IdP（STATUS T-ENG-11，2026-10-17 浏览器实测缺陷）')
{
  // ⚠️ 拼装口径：auth-components 内部请求 `${issuer}/auth/permissions`，故本值必须**不含 /auth**
  const idp = { issuer: 'https://auth.marschat.online', apiBase: '/kb/api' }
  eq(resolvePermissionsIssuer(undefined, idp, 'https://kb.marschat.online'), '/kb/api',
     '🔴 未显式指定 → 同源代理（旧实现回落 IdP ⇒ CORS/403 ⇒ fail-open 全放行）')
  eq(resolvePermissionsIssuer(undefined, idp, 'https://kb.marschat.online') + '/auth/permissions',
     '/kb/api/auth/permissions',
     '🔴 拼装结果必须等于实测可用的代理端点（防写成 authApiBase ⇒ /auth/auth/permissions 404）')
  eq(resolvePermissionsIssuer('/kb/api', idp, 'https://kb.marschat.online'), '/kb/api',
     '显式指定 → 显式值优先（存量正确接入行为不变）')
  eq(resolvePermissionsIssuer('/kb/api/', idp, 'https://kb.marschat.online'), '/kb/api',
     '显式值尾斜杠被归一（避免拼出 //auth/permissions）')
  eq(resolvePermissionsIssuer(undefined, idp, 'http://localhost'), '/kb/api',
     '本地开发同结论（不等 IdP 同源）')
  // 🔴 身份与权限的边界不能越：issuer 被 SSO 客户端消费，绝不能被权限基址顶掉
  const self = { issuer: 'https://kb.marschat.online/auth-api', apiBase: '/kb/api' }
  eq(resolvePermissionsIssuer(undefined, self, 'https://kb.marschat.online'), 'https://kb.marschat.online/auth-api',
     'IdP 与本站点同源 → 保留 issuer（自建 IdP 直供权限点场景不被打破）')
  eq(resolvePermissionsIssuer(undefined, { issuer: 'https://auth.marschat.online', apiBase: '' },
     'https://kb.marschat.online'), 'https://auth.marschat.online',
     '无 apiBase → 兜底 issuer（不可达也只是维持旧行为，不引入新失败）')
  eq(resolvePermissionsIssuer(undefined, { issuer: 'https://auth.marschat.online/', apiBase: '/x/api' },
     'https://kb.marschat.online'), '/x/api',
     'issuer 带尾斜杠仍能正确判同源')
  eq(resolvePermissionsIssuer('', idp, 'https://kb.marschat.online'), '/kb/api',
     '空串视为未指定（防 app-config.json 生成空值绕过修复）')
}

console.log('\n[14] 运行时配置解析与失败告警 —— 静默失效改为「一次看懂为什么失败」（坑 #41，0.1.7）')
{
  // 🔴 变异自测（本组用例存在的理由，改本文件时务必保留这两条捕获）：
  //    变异体 = 把「仅在**全部候选都失败**时才 warn 一次」改成「每次候选失败都 warn」。
  //    捕获点①：`loadRuntimeConfig` 的 `warning` 是**单条**字符串；若被改成为每条 attempt
  //              各生成一条（或把多条拼接起来），告警头 `[marschat-app-kit]` 的出现次数
  //              会从 1 变成 N ⇒ 「告警头只出现一次」类断言立刻失败。
  //    捕获点②：成功路径若被改成「把已探测的失败候选也 warn」，`warning` 不再是空串
  //              ⇒ 「成功路径 warning === '' / warn 次数 === 0」类断言失败。
  //    两条任一不成立 ⇒ 本组用例无效，必须重写。

  // ---- parseRuntimeConfig：判据逐字保留（200 + 非对象 ⇒ 不算成功），且**绝不抛异常** ----
  eq(parseRuntimeConfig('{"clientId":"marschat-kbweb","contextPath":"/kb"}'),
    { clientId: 'marschat-kbweb', contextPath: '/kb' }, '正常配置 → 原样解析')
  eq(parseRuntimeConfig('// AUTO-GENERATED by gen-from-registry.py\n{"contextPath":"/kb","apiBase":"/kb/api"}'),
    { contextPath: '/kb', apiBase: '/kb/api' }, '⚠️ 坑 #4：首行 // 横幅被剥离后正常解析（不剥则 JSON.parse 抛错）')
  eq(parseRuntimeConfig('// banner1\n// banner2\n{"a":1}'), { a: 1 }, '多行 // 横幅全部剥离')
  eq(parseRuntimeConfig('{"a":1} // 行尾注释不在行首，保留'), null,
    '行尾 // 不是横幅（正则只剥行首）→ 非法 JSON → null')
  // 🔴 SPA try_files 兜底：任意 404 路径被回成 index.html（状态 200、内容 HTML）
  eq(parseRuntimeConfig('<!doctype html><html><head></head><body><div id="app"></div></body></html>'),
    null, '🔴 index.html / HTML → null（200 也不算成功，判据不得放宽）')
  eq(parseRuntimeConfig('[]'), null, '空数组 → null（顶层必须是对象）')
  eq(parseRuntimeConfig('["a"]'), null, '非空数组 → null')
  eq(parseRuntimeConfig('"just a string"'), null, 'JSON 字符串 → null')
  eq(parseRuntimeConfig('123'), null, 'JSON 数字 → null')
  eq(parseRuntimeConfig('null'), null, 'JSON null → null')
  eq(parseRuntimeConfig('{oops'), null, '非法 JSON → null（不抛异常）')
  eq(parseRuntimeConfig('{"a":1,}'), null, '尾逗号非法 JSON → null（不抛异常）')
  eq(parseRuntimeConfig(''), null, '空串 → null（不抛异常）')
  eq(parseRuntimeConfig('   \n  '), null, '纯空白 → null（不抛异常）')
  eq(parseRuntimeConfig('// only banner'), null, '只有横幅（剥完为空）→ null')
  eq(parseRuntimeConfig(null), null, 'null 入参 → null（不抛异常）')
  eq(parseRuntimeConfig(undefined), null, 'undefined 入参 → null（不抛异常）')

  // ---- classifyRuntimeConfigFailure：告警归因（与 parseRuntimeConfig 同一套判据） ----
  eq(classifyRuntimeConfigFailure(''), 'empty-body', '归因：空响应体')
  eq(classifyRuntimeConfigFailure('// only banner'), 'empty-body', '归因：只有横幅（剥完为空）')
  eq(classifyRuntimeConfigFailure('<html></html>'), 'parse-error', '归因：HTML → 解析失败')
  eq(classifyRuntimeConfigFailure('[1,2]'), 'not-an-object', '归因：数组 → 非对象')
  eq(classifyRuntimeConfigFailure('{"a":1}'), 'not-an-object', '归因：合法对象不会走到本函数（保持总有返回值）')

  // ---- formatRuntimeConfigWarning：单条 / 空输入 ----
  eq(formatRuntimeConfigWarning([]), '', '空 attempts → **空字符串**（调用方据此跳过日志，不是 undefined）')
  const one = formatRuntimeConfigWarning([
    { url: 'https://kb.example/kb/app-config.json', status: 404, reason: 'http-not-200' },
  ])
  eq(one.includes('https://kb.example/kb/app-config.json'), true, '单条：文案含**完整 URL**（可直接贴浏览器复核）')
  eq(one.includes('404'), true, '单条：文案含状态码')
  eq(one.includes('回落'), true, '文案明确说明「已回落内置默认值」')
  eq(one.includes('apps-registry.yml'), true, '文案给出可操作提示：apps-registry.yml')
  eq(one.includes('gen-from-registry.py'), true, '文案给出可操作提示：gen-from-registry.py')
  eq(one.includes('contextPath'), true, '文案点名 contextPath')
  eq(one.includes('apiBase'), true, '文案点名 apiBase')

  // ---- 多条：每个 URL 都出现，且只产出**一条**告警 ----
  const multi = formatRuntimeConfigWarning([
    { url: 'https://kb.example/kb/app-config.json', status: 404, reason: 'http-not-200' },
    { url: 'https://kb.example/app-config.json', status: 200, reason: 'parse-error' },
  ])
  eq(multi.includes('https://kb.example/kb/app-config.json'), true, '多条：第 1 个 URL 出现')
  eq(multi.includes('https://kb.example/app-config.json'), true, '多条：第 2 个 URL 出现')
  eq(multi.split('[marschat-app-kit]').length - 1, 1, '🔴 多条：告警头只出现一次 ⇒ 只有**一条**告警')

  // ---- 四种 reason 都有对应中文说明 ----
  const all = formatRuntimeConfigWarning([
    { url: 'https://x/a/app-config.json', status: 404, reason: 'http-not-200' },
    { url: 'https://x/b/app-config.json', status: 200, reason: 'empty-body' },
    { url: 'https://x/c/app-config.json', status: 200, reason: 'not-an-object' },
    { url: 'https://x/d/app-config.json', status: 200, reason: 'parse-error' },
  ])
  for (const u of ['https://x/a/app-config.json', 'https://x/b/app-config.json',
    'https://x/c/app-config.json', 'https://x/d/app-config.json']) {
    eq(all.includes(u), true, `四种 reason：${u} 出现在文案里`)
  }
  eq(all.includes('状态非 200'), true, 'reason=http-not-200 → 有对应说明')
  eq(all.includes('为空'), true, 'reason=empty-body → 有对应说明')
  eq(all.includes('不是对象'), true, 'reason=not-an-object → 有对应说明')
  eq(all.includes('解析失败'), true, 'reason=parse-error → 有对应说明')
  eq(all.includes('回落'), true, '四种 reason 场景同样说明「已回落内置默认值」')

  // ---- loadRuntimeConfig：探测管线（IO 由假 probe 注入） ----
  const fake = (map) => (url) => (url in map ? map[url] : { status: 404, body: '' })

  // 场景 A：首个候选即命中 → 零日志、零多余请求
  {
    const r = loadRuntimeConfig(['/kb/', '/'], fake({
      '/kb/app-config.json': { status: 200, body: '// banner\n{"contextPath":"/kb"}' },
    }))
    eq(r.config, { contextPath: '/kb' }, 'A·命中候选 → 返回配置（横幅被剥离）')
    eq(r.warning, '', '🔴 A·成功路径 warning 为空串（零日志）')
    eq(r.attempts, [], '🔴 A·成功路径 attempts 为空数组（调用方据此跳过日志）')
    const probed = []
    loadRuntimeConfig(['/kb/', '/'], (url) => {
      probed.push(url)
      return { status: 200, body: '{"a":1}' }
    })
    eq(probed, ['/kb/app-config.json'], 'A·命中后立刻返回，不再探测后续候选（零多余请求）')
  }

  // 场景 B：先 404 后命中 → 仍零日志（「中途失败」不是「全败」）
  {
    const r = loadRuntimeConfig(['/kb/', '/'], fake({
      '/app-config.json': { status: 200, body: '{"clientId":"x"}' },
    }))
    eq(r.config, { clientId: 'x' }, 'B·首个候选 404、次个命中 → 返回后者配置')
    eq(r.warning, '', '🔴 B·中途失败但最终成功 → 仍然零告警（只有全败才 warn）')
    eq(r.attempts, [], '🔴 B·中途失败但最终成功 → attempts 不产出')
  }

  // 场景 C：全败 → 一条告警，含全部 URL
  {
    const r = loadRuntimeConfig(['/kb/', '/'], fake({}))
    eq(r.config, null, 'C·全败 → config 为 null（调用方回落 {}）')
    eq(r.attempts.length, 2, 'C·两条失败记录')
    eq(r.attempts[0], { url: '/kb/app-config.json', status: 404, reason: 'http-not-200' },
      'C·attempt = 完整 URL + 状态码 + 归因')
    eq(r.attempts[1], { url: '/app-config.json', status: 404, reason: 'http-not-200' },
      'C·第二条同样完整记录')
    eq(r.warning.split('[marschat-app-kit]').length - 1, 1, '🔴 C·全败仍只有**一条**告警（不是两条）')
    eq(r.warning.includes('/kb/app-config.json') && r.warning.includes('/app-config.json'), true,
      'C·告警含全部探测过的 URL')
    eq(r.warning.includes('回落'), true, 'C·告警说明已回落内置默认值')
  }

  // 场景 D：200 + HTML（SPA try_files 兜底）→ 不算成功，且不再「无声 continue」
  {
    const html = '<!doctype html><html><body><div id="app"></div></body></html>'
    const r = loadRuntimeConfig(['/kb/', '/'], fake({
      '/kb/app-config.json': { status: 200, body: html },
    }))
    eq(r.config, null, '🔴 D·200 + HTML 不算成功（判据逐字保留，不放宽）')
    eq(r.attempts[0].reason, 'parse-error', 'D·HTML 被归因为 parse-error（告警里能看懂为什么）')
    eq(r.warning.includes('/kb/app-config.json'), true, 'D·告警点名该 URL（旧实现只是无声 continue）')
    const ok = loadRuntimeConfig(['/kb/', '/'], fake({
      '/kb/app-config.json': { status: 200, body: html },
      '/app-config.json': { status: 200, body: '{"a":1}' },
    }))
    eq(ok.config, { a: 1 }, 'D·HTML 候选失败后继续探测，后续候选仍可命中')
    eq(ok.warning, '', 'D·最终命中 → 零告警')
  }

  // 场景 E：探测器抛错（网络错误 / 无 XHR 环境）→ 记成 attempt，不再被空 catch 整体吞掉
  {
    const r = loadRuntimeConfig(['/kb/', '/'], () => {
      throw new Error('network down')
    })
    eq(r.config, null, 'E·探测抛错 → 不向外抛出，回落 null')
    eq(r.attempts.length, 2, 'E·抛错也被记成 attempt（旧实现被空 catch 整体吞掉）')
    eq(r.attempts[0].status, 0, 'E·无状态码记为 0')
    eq(r.warning.includes('/kb/app-config.json'), true, 'E·告警仍点名 URL')
  }

  // 场景 F：端到端复刻 readRuntimeConfig 的调用契约（真实实现依赖 XHR，无法在 Node 直测）
  {
    const asCaller = (urls, probe) => {
      const r = loadRuntimeConfig(urls, probe)
      const warnings = []
      if (r.warning) {
        warnings.push(r.warning)      // createMarschatApp.ts：warning 非空才 console.warn，且只有这一次
      }
      return { config: r.config ?? {}, warnings }
    }
    const fail = asCaller(['/kb/', '/'], fake({}))
    eq(fail.config, {}, 'F·全败 → 调用方拿到 {}（回落内置默认值，与 0.1.6 行为一致）')
    eq(fail.warnings.length, 1, '🔴 F·全败 → 只 warn **一次**（变异体「每条都 warn」会得到 2 ⇒ 被抓住）')
    const ok = asCaller(['/kb/', '/'], fake({ '/kb/app-config.json': { status: 200, body: '{"a":1}' } }))
    eq(ok.config, { a: 1 }, 'F·成功 → 调用方拿到配置')
    eq(ok.warnings.length, 0, '🔴 F·成功路径 warn 次数为 0（控制台零噪音）')
    const mid = asCaller(['/kb/', '/'], fake({ '/app-config.json': { status: 200, body: '{"a":1}' } }))
    eq(mid.warnings.length, 0, '🔴 F·「先 404 再命中」warn 次数为 0（中途失败不产生日志）')
  }
}

console.log('\n[15] 权限探针失败归因与告警 —— fail-open 不再「静默全放行」（坑 #43，0.1.8）')
{
  // 🔴 变异自测（本组用例存在的理由，改本文件时务必保留这三条捕获）：
  //    变异体 A = `classifyPermissionsFailure` 忽略 `err` ⇒ CORS/网络错误被误判成 'unknown'
  //              ⇒ 「归因① network-error」断言立刻失败；
  //    变异体 B = `warnPermissionsFailure` 去掉去重（每次都 log）⇒
  //              「同一 URL + 同一原因只打一次」断言（logs.length === 1）立刻失败；
  //    变异体 C = `formatPermissionsWarning` 去掉后果句 ⇒
  //              「文案含 fail-open 后果说明」断言立刻失败。
  //    三条变异体在下面被**真实执行**（不是只写在注释里）：先证明变异体会跑出错误结果，
  //    再证明真实实现跑不出那个结果 ⇒ 断言确有约束力。任一捕获不成立 ⇒ 本组用例无效，必须重写。

  const URL_A = 'https://auth.marschat.online/auth/permissions?client=marschat-kbops'
  const URL_B = 'https://kb.marschat.online/kb/api/auth/permissions?client=marschat-kbweb'

  // ---- buildPermissionsUrl：与 auth-components 的 fetchPermissions 逐字同口径 ----
  eq(buildPermissionsUrl('https://auth.marschat.online/', 'marschat-kbops'), URL_A,
     'URL 拼装：尾斜杠被剥 + client 走 encodeURIComponent（与 usePermissions.ts 逐字同口径）')
  eq(buildPermissionsUrl('/kb/api', 'marschat-kbweb'), '/kb/api/auth/permissions?client=marschat-kbweb',
     'URL 拼装：同源代理形态（取 apiBase，不是 authApiBase ⇒ 不会拼出 /auth/auth/permissions）')
  eq(buildPermissionsUrl('/kb/api', 'a b&c'), '/kb/api/auth/permissions?client=a%20b%26c',
     'URL 拼装：clientId 特殊字符被转义（防拼出畸形 query）')

  // ---- classifyPermissionsFailure：五种归因（+ 业务码 / 未知）各一例 ----
  eq(classifyPermissionsFailure(new TypeError('Failed to fetch'), null), 'network-error',
     '归因①：fetch 抛错（含 CORS 跨域被拦）→ network-error')
  eq(classifyPermissionsFailure(undefined, { status: 403, ok: false }), 'http-not-200',
     '归因②：HTTP 403 → http-not-200（kb-ops 跨域直连中心的真实形态）')
  eq(classifyPermissionsFailure(undefined, { status: 200, ok: true }, ''), 'empty-body',
     '归因③：2xx 但响应体为空 → empty-body')
  eq(classifyPermissionsFailure(undefined, { status: 200, ok: true },
    '{"code":200,"data":{"configured":true,"permissions":"menu:users"}}'), 'not-an-array',
     '归因④：permissions 不是数组 → not-an-array')
  eq(classifyPermissionsFailure(undefined, { status: 200, ok: true },
    '<!doctype html><html><body><div id="app"></div></body></html>'), 'parse-error',
     '归因⑤：2xx 但回的是 index.html → parse-error')
  eq(classifyPermissionsFailure(undefined, { status: 200, ok: true }, '{"code":401,"message":"无权限"}'),
    'business-error', '归因⑥：HTTP 通了但业务码非 200 → business-error')

  // 「其实没失败」的合法形态 —— 不得误报（误报会把正常应用刷满告警）
  eq(classifyPermissionsFailure(undefined, { status: 200, ok: true },
    '{"code":200,"data":{"configured":true,"permissions":["a:menu:users"]}}'), 'unknown',
     '合法形态：configured=true + 权限点数组 → unknown（不算失败，不告警）')
  eq(classifyPermissionsFailure(undefined, { status: 200, ok: true },
    '{"code":200,"data":{"configured":false}}'), 'unknown',
     '🔴 合法形态：应用确实没配权限点（configured=false）→ unknown（正常的 fail-open，不得误报）')
  eq(classifyPermissionsFailure(undefined, null), 'unknown',
     '既无异常也无响应对象 → unknown（无从归因）')

  // 判据边界
  eq(classifyPermissionsFailure(undefined, { status: 0, ok: false }), 'http-not-200',
     '状态码 0 + ok=false → http-not-200（err 才是 network-error 的唯一判据）')
  eq(classifyPermissionsFailure(undefined, { status: 299, ok: true }, '[]'), 'unknown',
     '2xx 上界：299 仍算成功')
  eq(classifyPermissionsFailure(undefined, { status: 301, ok: false }), 'http-not-200',
     '3xx / 4xx / 5xx 一律 http-not-200')
  eq(classifyPermissionsFailure(undefined, { status: 200, ok: true }, null), 'empty-body',
     '响应体为 null → empty-body')
  eq(classifyPermissionsFailure(undefined, { status: 200, ok: true }, '   \n '), 'empty-body',
     '响应体纯空白 → empty-body')
  eq(classifyPermissionsFailure(undefined, { status: 200, ok: true }, '["a:menu:users"]'), 'unknown',
     '后端直回权限点数组 → 合法')
  eq(classifyPermissionsFailure(undefined, { status: 200, ok: true }, '"just a string"'), 'not-an-array',
     'JSON 字符串 → not-an-array（不是 parse-error：解析这一步是成功的）')

  // ---- formatPermissionsWarning：一条告警 = URL + 原因 + 状态 + 后果 ----
  eq(formatPermissionsWarning(null), '', '空 attempt → **空字符串**（调用方据此跳过日志，不是 undefined）')
  eq(formatPermissionsWarning({ url: '', status: 0, reason: 'network-error' }), '', 'URL 为空 → 空字符串')
  const w403 = formatPermissionsWarning({ url: URL_A, status: 403, reason: 'http-not-200' })
  eq(w403.includes(URL_A), true, '文案含**完整请求 URL**（可直接贴进浏览器复核）')
  eq(w403.includes('HTTP 403'), true, '文案含 HTTP 状态码')
  eq(w403.includes('状态非 2xx'), true, '文案含**中文**失败原因')
  eq(w403.includes('[marschat-app-kit]'), true, '文案沿用 [marschat-app-kit] 前缀')
  eq(w403.split('[marschat-app-kit]').length - 1, 1, '🔴 只有**一条**告警（前缀只出现一次）')
  eq(w403.includes(PERMISSIONS_FAIL_OPEN_CONSEQUENCE), true, '🔴 文案含**完整后果说明**（fail-open 全放行）')
  eq(w403.includes('fail-open'), true, '文案含 fail-open 关键字')
  eq(w403.includes('全部放行'), true, '文案含「全部放行」')
  eq(w403.includes('写接口硬闸门不受影响'), true, '文案说明写接口硬闸门不受影响')
  eq(w403.includes('同源代理'), true, '文案给出可操作提示：改用同源代理')

  const wNet = formatPermissionsWarning({ url: URL_B, status: 0, reason: 'network-error' })
  eq(wNet.includes('HTTP 0'), false, '网络错误不写「HTTP 0」（0 不是状态码，写上去会误导排查）')
  eq(wNet.includes('未拿到 HTTP 响应'), true, '网络错误明说「未拿到 HTTP 响应」')
  eq(wNet.includes('CORS'), true, '网络错误文案点名 CORS（跨域被拦是第一大来源）')

  const wCustom = formatPermissionsWarning({ url: URL_B, status: 500, reason: 'http-not-200' }, '自定义后果')
  eq(wCustom.includes('自定义后果'), true, '后果说明可被注入覆盖')
  eq(wCustom.includes(PERMISSIONS_FAIL_OPEN_CONSEQUENCE), false, '覆盖后不再出现默认后果句')

  for (const r of ['network-error', 'http-not-200', 'empty-body', 'not-an-array', 'parse-error', 'business-error']) {
    const text = formatPermissionsWarning({ url: URL_B, status: 200, reason: r })
    eq(text.includes('失败原因：') && text.length > 60, true, `六种归因（${r}）都有中文说明且文案非空`)
  }

  // ---- warnPermissionsFailure：同 URL + 同原因只告警一次（防刷屏） ----
  {
    resetPermissionsWarnDedupe()
    const logs = []
    const attempt = { url: URL_A, status: 403, reason: 'http-not-200' }
    eq(warnPermissionsFailure(attempt, { log: (m) => logs.push(m) }), true, '首次告警 → 返回 true（确实打了）')
    eq(warnPermissionsFailure(attempt, { log: (m) => logs.push(m) }), false, '🔴 第二次（同 URL 同原因）→ false（去重生效）')
    eq(warnPermissionsFailure(attempt, { log: (m) => logs.push(m) }), false, '🔴 第三次同样被拦下（路由守卫每次导航都会走到这里）')
    eq(logs.length, 1, '🔴 三次调用只产出 **1 条**告警（变异体「不去重」会得到 3 ⇒ 被抓住）')
    eq(logs[0], w403, '打出去的正是 formatPermissionsWarning 的那一条')
    eq(warnPermissionsFailure({ url: URL_A, status: 0, reason: 'network-error' }, { log: (m) => logs.push(m) }), true,
       '同一 URL 换**原因** → 再告警一次（去重键 = 原因 + URL，换原因说明换了失败形态，不能吞）')
    eq(logs.length, 2, '换原因后累计 2 条')
    eq(warnPermissionsFailure({ url: URL_B, status: 403, reason: 'http-not-200' }, { log: (m) => logs.push(m) }), true,
       '换个 URL → 再告警一次')
    eq(logs.length, 3, '换 URL 后累计 3 条')
    resetPermissionsWarnDedupe()
  }

  // ---- 独立 dedupe 注入（多实例 / 测试隔离） ----
  {
    const dedupe = createPermissionsWarnDedupe()
    const logs = []
    const attempt = { url: URL_B, status: 500, reason: 'http-not-200' }
    eq(warnPermissionsFailure(attempt, { dedupe, log: (m) => logs.push(m) }), true, '注入 dedupe：首次 → true')
    eq(warnPermissionsFailure(attempt, { dedupe, log: (m) => logs.push(m) }), false, '注入 dedupe：第二次 → false')
    eq(logs.length, 1, '注入 dedupe：只打一次')
    eq(warnPermissionsFailure(attempt, { dedupe: createPermissionsWarnDedupe(), log: (m) => logs.push(m) }), true,
       '另一个 dedupe 互不影响 → 仍为 true')
    eq(logs.length, 2, '两个 dedupe 各自计一次')
  }

  // ---- 🔴 变异自测（真实执行） ----
  {
    // 变异体 A：忽略 err（把 fetch 抛错当成「没有响应」）
    const mutantA = (response, body) => classifyPermissionsFailure(undefined, response, body)
    eq(mutantA(null, undefined), 'unknown', 'A·变异体把 fetch 抛错误判成 unknown')
    eq(mutantA(null, undefined) !== classifyPermissionsFailure(new TypeError('Failed to fetch'), null), true,
       '🔴 A·变异体被抓到：忽略 err 会让「归因① network-error」断言失败')
    // 变异体 B：去掉去重（每次都打）
    const attempt = { url: 'https://x/api/auth/permissions?client=c', status: 403, reason: 'http-not-200' }
    const mutantLogs = []
    const mutantB = (a) => {
      mutantLogs.push(formatPermissionsWarning(a))
      return true
    }
    mutantB(attempt)
    mutantB(attempt)
    mutantB(attempt)
    eq(mutantLogs.length, 3, 'B·变异体（不去重）连打 3 条')
    const realLogs = []
    const dedupe = createPermissionsWarnDedupe()
    warnPermissionsFailure(attempt, { dedupe, log: (m) => realLogs.push(m) })
    warnPermissionsFailure(attempt, { dedupe, log: (m) => realLogs.push(m) })
    warnPermissionsFailure(attempt, { dedupe, log: (m) => realLogs.push(m) })
    eq(realLogs.length, 1, '🔴 B·变异体被抓到：真实实现只打 1 条（3 ≠ 1 ⇒ 「只打一次」断言有约束力）')
    // 变异体 C：去掉后果句
    const mutantC = (a) => formatPermissionsWarning(a)
      .split('\n').filter((line) => !line.startsWith('后果：')).join('\n')
    eq(mutantC(attempt).includes(PERMISSIONS_FAIL_OPEN_CONSEQUENCE), false, 'C·变异体（去掉后果句）不再含后果说明')
    eq(formatPermissionsWarning(attempt).includes(PERMISSIONS_FAIL_OPEN_CONSEQUENCE), true,
       '🔴 C·变异体被抓到：真实实现含后果说明 ⇒ 「含 fail-open 后果」断言有约束力')
  }

  // ---- 端到端：kb-ops 跨域直连恒 403 的真实现场（2026-10-20 R12 实测） ----
  {
    const logs = []
    const dedupe = createPermissionsWarnDedupe()
    const url = buildPermissionsUrl('https://auth.marschat.online', 'marschat-kbops')
    const attempt = { url, status: 403, reason: classifyPermissionsFailure(undefined, { status: 403, ok: false }) }
    eq(attempt.reason, 'http-not-200', 'E2E·kb-ops 现场归因 = http-not-200')
    warnPermissionsFailure(attempt, { dedupe, log: (m) => logs.push(m) })
    eq(logs.length, 1, 'E2E·产出一条告警')
    eq(logs[0].includes('https://auth.marschat.online/auth/permissions?client=marschat-kbops'), true,
       'E2E·告警含真实请求地址（跨域直连中心 ⇒ 一眼看出该走同源代理）')
    eq(logs[0].includes('403'), true, 'E2E·告警含 403')
    eq(logs[0].includes('全部放行'), true, 'E2E·告警明说「已全部放行」')
    for (let i = 0; i < 20; i += 1) {
      warnPermissionsFailure(attempt, { dedupe, log: (m) => logs.push(m) })
    }
    eq(logs.length, 1, '🔴 E2E·20 次导航仍只有 1 条告警（防刷屏铁律）')
  }
}

console.log(`\n${'='.repeat(56)}`)
console.log(`配置派生自测：${passed} 通过 / ${failed} 失败（共 ${passed + failed} 项）`)
console.log('='.repeat(56))
process.exit(failed === 0 ? 0 : 1)
