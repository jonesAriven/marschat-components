# MarsChat 统一认证 · 双浏览器多会话隔离 + IdP 返回入口 + 用户管理 UI 审查

**执行人**：QA 工程师 严过关（software-qa-engineer）
**任务编号**：#1　**执行日期**：2026-09-18 03:20–05:05（服务器时间）
**报告路径**：`C:\Users\13871\WorkBuddy\2026-09-06-22-47-35\verify\multisession\qa-multisession-report.md`

---

## 0. TL;DR（只看这段就能判断严重性）

| 结论 | 判定 |
|---|---|
| **核心命题「多浏览器并发登录同一账号不会互相踢下线」** | ✅ **成立（实测证实）**。S1–S5 全 PASS：两个独立浏览器（独立 profile）、任意 SSO/独立登录组合、跨过 ≥1 个 sessionWatcher 探针周期后，双方身份各自保持，无互踢、无串号。 |
| **同账号 B 侧登出是否会请出 A** | **不会**。S6：B 登出后 B 落 `/kb/login`，A 跨 2 次探针仍为 admin。属符合设计语义（A/B 是两个独立浏览器 = 两个独立 IdP 会话）。 |
| **同一浏览器（同 profile）两个页签** | ⚠️ **IdP 会话被覆盖后，另一个页签会「静默切换身份」**（admin → 另一账号），无提示、无登出、头像仍显示旧账号。属预期内的设计约束（单浏览器 = 单 IdP 身份），但「静默」这一点有风险，建议评估。**恢复路径已实测确认**。 |
| 🔴 **P1 缺陷** | **独立登录（`token_kind=legacy`）会话完全不启动 sessionWatcher** → SLO 登出联动 + 身份守卫对独立登录会话 **100% 失效**。实测：oidc 会话 150s 内 3 次探针 / legacy 会话 150s 内 **0 次**；同一次用例内 A(oidc) 2 次、B(legacy) 0 次。 |
| 🔴 **P1 缺陷** | **用户管理表格横向溢出，操作列被裁切**。kb-web / kb-ops / infra 三个应用的「用户管理」共用同一组件：表格 1330px、容器 1114px → **溢出 216px**，表头「操作」被压成「操」，行末「移出本系统」按钮在 1440px 视口就被裁掉。portal 管理台「跨应用授权」矩阵最后一列同样被裁。 |
| 🟠 **P1/P2 缺陷** | **IdP 登录页无任何返回入口**，且 URL **完全不带** `redirect_uri`/`client_id`/`state`，`document.referrer` 只有 **origin（无路径）**，且 **kb-web 与 kb-ops 的 referrer 完全相同**（都是 `https://kb.marschat.online/`）→ 修复方案必须以「IdP 侧保存授权请求」为主，**不能靠 referrer 反推返回目标**。 |
| 🟡 **P2 缺陷** | 删除用户不清理 `oauth2_authorization`（残留 19 条），且属**既有行为**（历史墓碑账号 134/141/148/169/… 均有残留）。 |
| ✅ **正面验证** | 未授权应用的用户（跨应用授权矩阵 6 个应用全「未授权」）仍可 SSO 登录，但**数据域为空**（文档数 0 / 空间数 0，而 admin 是 1/1）→ 应用级数据隔离生效，不串号。 |
| 产品缺陷 | 6 条（P1×3、P2×3，无 P0） |
| 测试脚本缺陷 | 8 条（**已单列成表**，历史上正是这类缺陷造成过误判，务必区分） |

**未发现 P0**：无数据丢失、无越权（未授权用户看不到他人数据）、无跨浏览器账号串号。

---

## 1. 环境与口径

### 1.1 测试环境
| 项 | 值 |
|---|---|
| 测试主机 | `mykng`（Debian 13，`ssh root@192.168.31.105` 免密），内核 6.12.90 |
| 浏览器 | `/usr/bin/chromium`，`--headless=new` + CDP（Python `websockets` 直连 DevTools Protocol） |
| 隔离手段 | 每个"浏览器"一个独立 `--user-data-dir` profile → cookie / localStorage 天然隔离，用来模拟两个不同浏览器 |
| 缓存 | 全程 `Network.setCacheDisabled=true`（避免跑到历史 bundle） |
| 探针周期 | 应用 `sessionWatcher` 为 `intervalMs: 60000` → 每个用例**等待 70–75s** 跨过至少 1 个周期 |

### 1.2 踩到的 hosts 坑（复现时必须照做）
该机 `/etc/hosts` 把两个域名钉到本机：

```
127.0.0.1  ops.marschat.online kb.marschat.online
```

⇒ 启动 chromium 必须带：

```
--host-resolver-rules="MAP kb.marschat.online 1.117.70.30,MAP ops.marschat.online 1.117.70.30"
```

否则 kb-web / kb-ops 会连到 `127.0.0.1` 失败。脚本内建 `curl --resolve`（见 `scripts/run_matrix.py`、`probe*.py`）。
**已复查 `/etc/hosts` 全文，被钉的只有这两个域名**（其余 6 行是 localhost/IPv6 标准项），无需额外 MAP。

### 1.3 入口可达性基线（2026-09-18 03:21 实测，均 HTTP 200）
`main.marschat.online/portal/` · `kb.marschat.online/kb/dashboard` · `monitor.marschat.online/infra/dashboard` · `cosmic.marschat.online/` · `tools.marschat.online/activecode/index.html` · `auth.marschat.online/login.html` · `auth.marschat.online/.well-known/openid-configuration`

### 1.4 「在线」判据（三条件 + 身份归属，全程统一）
```
online = (页面无可见 password 输入框) AND (url 不含 /login) AND (localStorage 有应用 token)
identity = 解码应用自己的 token payload / 读应用自己写的 LS 用户标识
```
- **未使用**「无 toast」当成功判据（成功 toast 也是 toast）。
- **未使用** `'/portal/' in url` 当登录态判据（`/portal/login` 也含该子串，会产生假绿）。
- 每个用例断言前 `reset_buffers()` 清空 console / network 缓冲。

### 1.5 主测应用为何选 kb-web（关键设计决策）
探测确认**两条通道走向不同后端**：

| 应用 | 独立登录实际打到 | 说明 |
|---|---|---|
| **kb-web** | `POST https://kb.marschat.online/kb/api/auth/login` → kb-gateway → **auth-center** | token **HS384**，payload 带 **`tv`（token 版本）** → 真正经过中心 Redis `auth:tv:{userId}` 机制 |
| portal | `POST /portal/api/auth/login` | **自认证 HS256**，压根不调 auth-center |
| infra | `POST /infra/api/auth/login` | infra 自身后端，token HS384 但**无 `tv`** |
| cosmic | `POST /api/auth/login` | cosmic 自身后端，非 JWT（base64 JSON） |
| kb-ops | 登录页**只有邮箱验证码**，无账密表单 | 独立登录通道无法用账密自动化，只能走 SSO |

⇒ 因为本次核心命题是**中心的 token 版本机制**，矩阵主测应用选 **kb-web**（唯一 独立登录也经过 auth-center 的应用），并对 portal 做了 S1/S3 交叉确认。

### 1.6 账号与纪律
- 测试账号 `admin`（平台超管）。口令经实测验证可用（`POST /portal/api/auth/login` → 200 + `role=superadmin`）。**口令未写入任何文件、未回显到本报告、未出现在 bash 命令行以外的地方。**
- 第二账号：**未拿到 `p10x`(302) 口令**，故按授权创建临时账号 **`qa-ms-m1`(id=484)**（经 portal 管理台 UI「新建用户」），**测试后已墓碑**（见 §6）。
- **全程未触碰任何改密端点**（未探测 `reset-password` / `forgot-password` / `change-password`）。
- ⚠️ **注意**：`qa-ms-u2`(id=477，创建时间 03:26:16) **非本次创建**（早于我的建号操作，且我的首次建号尝试失败未提交）——疑似同目录下另一并行任务所建，**我未改动它**。
- ⚠️ `/root/qa-ms/` 该目录被并行任务共用；本报告只引用我自己的产物（前缀见 §7）。

---

## 2. 用例矩阵逐条结果

主测应用 `kb-web`；A / B 为两个独立 profile 的 headless chromium（= 两个不同浏览器）。
流程：A 登录 → B 登录 → T0（双方刷新，立即判定）→ 等待 70s（跨探针周期）→ T1（双方刷新，判定身份）。

| # | A（通道/账号） | B（通道/账号） | T1 期望 | **实测** | 判定 |
|---|---|---|---|---|---|
| **S1** | SSO / admin | SSO / admin | A 仍在线且身份=admin | A: `online=true, username=admin, sub=1, kind=oidc`；B 同 | ✅ **PASS** |
| **S2** | SSO / admin | SSO / `qa-ms-m1` | 双方各自保持身份，不串号 | A: `admin/1/oidc`；B: `qa-ms-m1/484/oidc` | ✅ **PASS** |
| **S3** | 独立 / admin | 独立 / admin | 同 S1 | A、B 均 `online=true, admin, sub=1, tv=3, kind=legacy` | ✅ **PASS** |
| **S4** | 独立 / admin | 独立 / `qa-ms-m1` | 同 S2 | A: `admin/1/tv=3/legacy`；B: `qa-ms-m1/484/tv=0/legacy` | ✅ **PASS** |
| **S5** | SSO / admin | 独立 / `qa-ms-m1` | 混合通道互不影响 | A: `admin/1/oidc`；B: `qa-ms-m1/484/tv=0/legacy` | ✅ **PASS** |
| **S6** | SSO / admin | SSO / admin，**B 执行登出** | 只记录，不预设对错 | B → `/kb/login`（token 已清，`ok=true`，菜单项「退出登录」）；**A 跨 2 次探针仍 `admin/1/oidc` 在线** | ⚪ **OBSERVE**（A 未被请出） |
| **S7** | 同 profile / 同浏览器，Tab1 SSO admin → Tab2 在 IdP 登录另一账号 | | 只记录影响范围与恢复路径 | **Tab1 静默切换身份**：`admin/1` → `qa-ms-m1/484`（无刷新、无提示） | ⚪ **OBSERVE**（详见 §3.3） |
| S1p | SSO / admin（portal） | SSO / admin（portal） | 交叉确认 | 通过（portal 侧行为一致） | ✅ 交叉确认 |
| S3p | 独立 / admin（portal） | 独立 / admin（portal） | 交叉确认 | 通过（portal 侧行为一致） | ✅ 交叉确认 |

### 2.1 核心命题结论（明确回答用户原话）
> 「两个不同的浏览器独立分别的通过 SSO 登录，或者独立登录，或者两个都是 SSO 登录，或者两个都是独立登录，有没有问题，正常两个不同的浏览器是没有限制的」

**实测结论：没有问题，用户的预期成立。** 6 种组合中 5 种（S1–S5）全部 PASS，第 6 种（S6）是「登出只影响登出方」，符合"不同浏览器各自独立"的语义。**中心 Redis token 版本机制只读 `currentVersion()` 不 `bump()` 的理论预期，被实测证实：多浏览器并发登录同一账号不会互踢。**

### 2.2 关键证据（URL + 状态码 + 身份）

**S1 / A 侧（`evidence/matrix-S6-S1.json`，截图 `shots/S1A-final.png`）**
```
url            = https://kb.marschat.online/kb/dashboard
token_kind     = oidc            token_len = 938
identity       = {"username":"admin","sub":"1"}
/auth/session 期间探针 = 2 次 200（https://auth.marschat.online/auth/session）  ← 证明真的跨过了探针周期
```

**S3 / A 侧（`evidence/matrix-S3-S4.json`，截图 `shots/S3A-final.png`）——中心 tv 机制直证**
```
POST https://kb.marschat.online/kb/api/auth/login  -> 200
identity = {"username":"admin","sub":"1","tv":3,"type":"access"}   ← HS384 + tv，确证经 auth-center
```

**S5（`evidence/matrix-S5-S6.json`）——同一用例内的差异对照，最有力**
```
A (SSO/oidc)     等待期间 /auth/session = 2 次
B (独立/legacy)  等待期间 /auth/session = 0 次      ← 见 P1-1
```

**S6 / B 侧（截图 `shots/S6B-logoutmenu.png`、`shots/S6B-after-logout.png`）**
```
菜单项 = 退出登录   →  POST https://kb.marschat.online/kb/api/auth/logout -> 200
落点   = https://kb.marschat.online/kb/login     token_after = false
同一窗口 A 侧 /auth/session = 2 次 200 → A 仍 online, username=admin
```

---

## 3. 测试目标 2：IdP 登录页缺少「返回」入口（缺陷取证）

### 3.1 无返回入口（确认）
`https://auth.marschat.online/login.html` 页面**只有一个 `<a>` 标签**：
```
<a href="/forgot-password.html">忘记密码？</a>
```
全文检索 `返回|back|cancel|取消|上一步|goBack|history` → **无任何返回/取消类元素**。
截图：`shots/recon-idp.png`、`shots/idp-login-page.png`。
页面元素：`#username` / `#password` / `remember-me` 复选框 / 「忘记密码？」 / 「登 录」按钮。

### 3.2 关键取证：`document.referrer` 的真实值（决定修复方案）

模拟用户从**每个应用的登录页**点「统一认证登录（SSO）」被跳到 IdP 页后读取（`evidence/referrer.json`）：

| 来源应用 | 来源页面 URL | 跳转后 IdP URL | **`document.referrer` 原始字符串** |
|---|---|---|---|
| portal | `.../portal/login` | `https://auth.marschat.online/login.html` | `https://main.marschat.online/` |
| kb-web | `.../kb/login` | 同上 | `https://kb.marschat.online/` |
| kb-ops | `.../ops/login` | 同上 | `https://kb.marschat.online/` |
| infra | `.../infra/login` | 同上 | `https://monitor.marschat.online/` |
| cosmic | `.../login` | 同上 | `https://cosmic.marschat.online/` |
| activecode | `.../activecode/login.html` | 同上 | `https://tools.marschat.online/` |
| （新开标签页直达 IdP） | 无 | 同上 | **空字符串 `''`** |

**两个决定性事实：**
1. **IdP 页 URL 完全不带任何业务参数** —— 六条路径全部是裸的 `https://auth.marschat.online/login.html`，**没有 `redirect_uri` / `client_id` / `state` / `scope`**（授权请求被 Spring Authorization Server 存在自己的会话里）。⇒ **地址栏无法用来推导返回目标。**
2. **referrer 只有 origin，没有路径** —— 这是浏览器默认 `Referrer-Policy: strict-origin-when-cross-origin` 的必然结果（跨域只发 origin）。所以 referrer 最多能推回"哪个应用的首页"，**推不回原来的 `/xxx/login?redirect=...` 页面**。
   ⚠️ **且 kb-web 与 kb-ops 的 referrer 完全相同**（都是 `https://kb.marschat.online/`）—— 同一个域名下两个应用，**referrer 无法区分**。

### 3.3 对修复方案的约束（重要，请架构师按此设计）
- ❌ 不能只靠 `document.referrer` 实现"返回上一步"：只能返回应用 origin 首页，且 kb-web/kb-ops 无法区分。
- ❌ 不能靠 URL 参数推导：IdP 页 URL 无参。
- ✅ 可行方向：**IdP 侧保存"当前待处理的授权请求"**（登录页渲染时把 SSO 登录前所在的应用/页面写进服务端会话或一次性 token），或**由应用在跳转前把 `redirect` 目标放进 state 并经 IdP 回传**；纯前端方案不足。
- ℹ️ 另：新开标签页直达 IdP 时 referrer 为空，必须能优雅降级（隐藏"返回"或返回应用列表）。

---

## 4. 测试目标 3：用户管理页 UI 审查

> 用户反馈"样式有点丑"。以下**每条都指到具体元素 + CSS 层面量测**，不是"确实丑"。

审查范围与截图：
| 页面 | 全页截图 | 度量数据 |
|---|---|---|
| portal 管理台 4 页签 | `shots/portal-admin-tab1.png` ~ `tab4.png` | `evidence/ui-review.json` |
| kb-web 用户管理 | `shots/ui2-kb-web-users.png`、`shots/ui-kb-web-users.png` | `evidence/ui-review2.json` |
| kb-ops 用户管理 | `shots/kb-ops-users.png`、`shots/kb-ops-users-tab1~3.png` | 同上 |
| infra 用户管理 | `shots/ui-infra-users.png` | `evidence/ui-review.json` |
| cosmic 系统管理 | `shots/ui2-cosmic-admin.png` | `evidence/ui-review2.json` |
| portal 管理台窄视口 | `shots/ui2-portal-admin-1024.png`、`ui2-portal-admin-768.png` | 同上 |

### 4.1 🔴 表格横向溢出，操作列被裁切（**最实际的 UI 缺陷**）

**kb-web / kb-ops / infra 三个应用的「用户管理」页共用同一组件**，实测：
```
表格宽度  = 1330 px
容器宽度  = 1114 px
横向溢出  = 216 px          ← 1440px 视口下就已经溢出
表头      = ID(70) 用户名(150) 昵称(120) 邮箱(190) 全局角色(110) 本系统角色(150) 状态(90) 创建时间(170) 操作(280)
```
后果（截图直读）：
- 表头「**操作**」被压缩显示为「**操**」（`shots/kb-ops-users.png`、`shots/ui2-kb-web-users.png` 中可见）。
- 行内操作按钮 `编辑 | 本系统角色 | 移出本系统` 中，**最右的「移出本系统」（红色）在 1440px 视口就被卡片右边缘裁掉**，必须横向滚动才能点到。
- 9 列全是 14px 常规字重、无固定列、无列宽自适应策略。

portal 管理台同问题：
- 「**跨应用授权**」矩阵最后一列标题被截为「**运维后台 kb-o...**」（`shots/portal-admin-tab2.png`）。
- **无响应式**：1440→溢出 0；**1024 → 溢出 358px**；**768 → 溢出 614px**（`evidence/ui-review2.json` 中 `portal-admin-1024/768`）。窄屏完全靠横向滚动。

### 4.2 🔴 portal 管理台「统一用户」操作列拥挤（用户说"丑"的直观来源）

同一格 `操作`（**360px**）里塞了 **5 个 link 式按钮**（`shots/ui-portal-admin.png`）：
```
编辑(30×18) 重置密码(54×18) 应用角色(54×18) 菜单权限(54×18) 删除(30×18)
字号 12px / padding 2px / 行高 18px / 合计约 222px，按钮之间无分隔符
```
- **色彩语义重叠、主次不分**：编辑=蓝(primary)、菜单权限=**同样蓝**、重置密码=橙(warning)、应用角色=绿(success)、删除=红(danger) ⇒ 同一行出现 4 种颜色，但"菜单权限"和"编辑"同为蓝色，用户无法靠颜色区分主次。
- 按钮高度仅 18px、字号 12px，且是纯文字 + 色字，**可点击区域小于通用 32px 触控基线**。
- 相邻行按钮完全同列对齐，视觉上形成 5 条密集色带。

### 4.3 🟡 视觉一致性：三套不同的外壳主题
| 应用 | 侧边栏 | 主色 |
|---|---|---|
| portal 管理台 | 顶部紫色渐变导航条 | 紫/靛蓝 (#4f46e5 附近) |
| kb-web | **米色/暖白侧边栏 + 棕色强调 + 右下角琥珀色悬浮圆钮** | 暖调 |
| kb-ops / infra | **深海军蓝侧边栏** | 冷调深蓝 |

三个"同一个统一认证体系下"的用户管理页，视觉语言完全不同（截图可直接对比 `shots/portal-admin-tab1.png` / `shots/ui2-kb-web-users.png` / `shots/ui-infra-users.png`）。这正是"看起来像三个不同产品"的根因。

### 4.4 🟡 低对比度文本（可访问性）
- 「跨应用授权」矩阵中作为**主要数据**的「未授权」是浅灰字（实测标签色 `rgb(144,147,153)` on 近白底 ≈ 2.3:1），远低于 WCAG AA 常规文本 4.5:1。
- 「普通用户」角色标签：灰底 `rgb(244,244,245)` + 灰字 `rgb(144,147,153)`，同为低对比。
- 「superadmin」标签：红字 `rgb(245,108,108)` on 浅红 `rgb(254,240,240)` ≈ 3.4:1。

### 4.5 🟡 其他细节
- **行高不一致**：「跨应用授权」表里用户名+昵称同格换行（`qa-ms-m1 (QA多会话临时)`）导致该行高 ≈ 80px，而其他行 ≈ 61px。
- **对齐不一致**：用户/邮箱/角色/状态列左对齐，应用授权列居中，同一张表混用两套对齐。
- **信息密度两极**：`ID` 列宽 70px 只放 3 位数字；`操作` 列宽 360px 占 27% 表宽；而 4 行数据下方留出整屏空白。
- **标题层级重复**：导航条「devtools 看板」+ 页面卡头「统一认证中心」+ 卡内「统一用户」三级标题堆叠。
- **统计卡宽度不一**：「账号映射」页顶部 5 张卡（22/4/3/1/14）宽窄不齐。
- **元素密度**：「本系统用户」说明文字 12px 灰字，比表格正文（14px）还小，说明文字反而更抢注意力。

### 4.6 ✅ UI 方面未发现的问题（避免误报）
- `/ops/users` 我第一轮截到**空白页**，经独立复核（`scripts/probe_kbops.py`）确认是**我等得太短**的测试问题，**不是产品缺陷** —— 该页正常渲染「用户 / 菜单授权 / 账号映射」三个页签。**已从缺陷清单剔除。**

---

## 5. 缺陷清单（分级 · 含复现步骤与判定依据）

### 🔴 P1-1　独立登录会话不启动 sessionWatcher → SLO 登出联动与身份守卫完全失效
- **现象**：以**独立登录（账密）**方式建立的会话（`token_kind=legacy`），**从不发起** 60s 探针，150s 内 0 次 `/auth/session`；而 SSO（`token_kind=oidc`）会话同窗口 3 次。
- **复现步骤**：
  1. 用 kb-web 账密独立登录 admin → 进入 `/kb/dashboard`
  2. `Page.reload`（**必须 reload**：见下方机制说明）→ 保持页面不动观察 150s
  3. 抓 `Network.responseReceived` 中 `/auth/session` 的请求数 → **0**
  4. 对照组：改用 SSO 登录后同样 reload + 观察 150s → **3 次**（约 t+3s / t+63s / t+123s）
- **证据**：`scripts/probe_watcher.py` 输出对比；截图 `shots/S5A-final.png` 与无探针的 B 侧；`evidence/matrix-S5-S6.json` 中 `session_probe_during_wait`（A=2，B=0）。
- **判定依据（源码级，非猜测）**：**5 个应用的生产 bundle 里，守卫启动点写法完全一致，全部被 `isOidc()` 门控**（同一份共享库 `[marschat-auth] createSsoClient`，错误串 `"[marschat-auth] createSsoClient 缺少 issuer"` 可证）：
  | 应用 | bundle 中的启动代码（minified，原文） | 门控函数 |
  |---|---|---|
  | portal | `const hi=js(M6); hi.token && (h6() && Qne({...}))` | `h6()` |
  | kb-web | `const lae=Xa(); lae && (s8(i2).fetchModules(), r2() && ene(), Qd.ensure())` | `r2()` |
  | kb-ops | `ga.mount("#app"); const Fr=De(); Fr && (qa() && _r()` | `qa()` |
  | infra | `qs.mount("#app"); const yne=Oa(); yne && (z0() && Zte(), Bd.ensure())` | `z0()` |
  | cosmic | `Wu.mount("#app"); const Wde=localStorage.getItem("token"); Wde && (Mde() && Ade()` | `Mde()` |
  | activecode | **未验证**（未做 bundle 级核验） | — |

  三个门控函数均为该应用自己的 `isOidc()`（各处 `world: t=>h6()/r2()/qa()/z0()/Mde()` 即 `isOidc`）。
- 且守卫的启动时机是 **app 启动那一刻（模块初始化，紧跟 `mount("#app")`）**：内部是 `setTimeout(m, 3000)` + `setInterval(m, 60000)`。⇒ 新 SSO 登录流程（callback 页启动时 LS 里还没有 token）**当场不会启动**，必须**再手动刷新一次**才启动（这是次生缺陷！）；legacy 会话即使刷新，`isOidc()` 仍为 false → **永远不启动**。
- **修复友好度**：因为是**同一份共享库**，一处改动即可覆盖 portal / kb-web / kb-ops / infra / cosmic 全部 5 个应用（activecode 待确认）。
- **影响**：独立登录的用户**完全失去**「中心侧登出/禁用 → 应用侧 60s 内联动登出」与「身份守卫（identity mismatch）」保护。若中心停用/删除某用户，该用户已建立的**独立登录会话不会在 60s 内被踢**。
- **建议**：把守卫启动条件从 `isOidc()` 改为「存在任意有效应用会话」，并把启动时机从"模块初始化一次性判断"改为"登录成功后/路由就绪时"（当前实现导致 SSO 登录当次也不启动，需用户手动刷新，本身就是次生缺陷）。

### 🔴 P1-2　用户管理表格横向溢出，操作列按钮被裁切（3 个应用共享组件 + portal 矩阵）
- **复现步骤**：
  1. 以 admin SSO 登录 `https://kb.marschat.online/kb/dashboard`
  2. 点左下「系统 → 用户管理」（或直接 `https://kb.marschat.online/ops/users`、`https://monitor.marschat.online/infra/users`）
  3. 视口 1440×757 → 观察表头「操作」与行末「移出本系统」
- **证据**：截图 `shots/kb-ops-users.png`（表头显示「操」）、`shots/ui2-kb-web-users.png`、`shots/ui-infra-users.png`；度量 `evidence/ui-review.json` 的 `tables[0].overflow = 216`。
- **判定依据**：`table.scrollWidth - parent.clientWidth = 216px`，且 `操作` 列固定 280px 却不设 `fixed="right"`，最右按钮超出容器可视区。
- **影响**：管理员在标准 1440 屏上**看不到/点不到**该行最后一个操作按钮（功能可用性受损）。
- **同源问题**：portal 管理台「跨应用授权」最后一列被截（`shots/portal-admin-tab2.png`）；窄视口无任何自适应（1024→358px、768→614px）。

### 🔴 P1-3　IdP 登录页无返回入口，且无可用于推导返回目标的信息
- **复现步骤**：从任一应用登录页点「统一认证登录（SSO）」→ 到 `https://auth.marschat.online/login.html`
- **证据**：`shots/recon-idp.png`、`shots/idp-login-page.png`、`evidence/referrer.json`（6 条路径）
- **判定依据**：页面仅 1 个 `<a>`（忘记密码）；IdP URL 无 `redirect_uri/client_id/state`；`document.referrer` 只有 origin；**kb-web 与 kb-ops referrer 完全相同**。
- **影响**：用户误入统一认证页后**无法回到刚才的应用**（只能手动改地址栏或后退——要注意后退在 302 场景下不一定可用）。
- **修复约束**：见 §3.3，纯前端 referrer 方案不成立。

### 🟡 P2-1　同浏览器 IdP 会话被覆盖后，应用会话「静默切换身份」
- **复现步骤**（S7，脚本 `scripts/run_s7g.py` / `run_s7b.py`）：
  1. 同一 browser（同一 profile）Tab1：kb-web SSO 登录 admin → 落 `/kb/dashboard`
  2. Tab1 刷新一次（启动守卫）
  3. Tab2：新开 `https://auth.marschat.online/login.html`，以 **`qa-ms-m1`** 登录 IdP（覆盖共享的 IdP 会话）
  4. 等 70s（≥1 个守卫周期）→ 回到 **Tab1 不刷新**读取身份
- **实测（两次独立复现一致）**：
  ```
  IdP /auth/session 覆盖前 : {"authenticated":true,"username":"1"}     (admin)
  IdP /auth/session 覆盖后 : {"authenticated":true,"username":"484"}   (qa-ms-m1)
  Tab1（未刷新）70s 后身份 : {"username":"qa-ms-m1","sub":"484"}  online=true
  ```
- **证据**：`evidence/s7c.json`（`idp_session_before` / `idp_session_after` / `tab1_after_wait`）、`evidence/s7g.json`、截图 `shots/S7b-tab1-switched.png`。
- **判定**：属**预期内的设计约束**（一个浏览器 = 一个 IdP 身份），**不是缺陷**；但「**静默**」值得评估：
  - 无任何提示/确认，页面仍显示"已登录"；
  - **右上角头像仍显示旧账号的字形**（实测切换后头像仍为 admin 昵称首字「管」，`evidence/s7g.json` 的 `avatar_switched={"txt":"管"}`）→ 用户会以为自己还是 admin，实际已是另一个账号（**UI 与真实身份不一致**）。
- **恢复路径（已实测确认）**：在任意 IdP 入口**重新以目标账号登录**即可；已打开的页签会在 **≤1 个守卫周期（≈60s）内自动切回**目标身份，无需手动登出。
  ```
  Tab2 重新以 admin 登录 IdP → 70s 后 Tab1 自动回到 {"username":"admin","sub":"1"}
  ```
- **建议**：身份切换时给出显式提示（或至少同步刷新头像/用户标识），并在"静默切换"时记录审计日志。

### 🟡 P2-2　删除用户不清理 `oauth2_authorization` 残留
- **实测**：墓碑 `qa-ms-m1`(484) 后，`oauth2_authorization` 仍有 **19 行** `principal_name='484'`（时间戳 03:39:57–04:52:55，全部落在本次测试窗口）。
- **判定依据（这是既有行为，非本次引入）**：按 `principal_name` 分组统计，**所有历史墓碑账号都有残留**：`134→6, 141→2, 148→16, 169→4, 176→2, 183→1, 197→1, 204→1, 211→2, 218→3, 225→2, 232→4, 239→12, 246→5, 253→5, 260→8, 267→2, 274→2, 281→5, 288→9, 295→8, 2→6`。
- **影响**：低（用户已墓碑，令牌不可用），但属数据卫生问题：授权记录无限累积，且理论上让"已删除用户仍留有授权痕迹"。
- **建议**：用户删除时级联清理 `oauth2_authorization` / `oauth2_authorization_consent`（`principal_name = userId`）。

### 🟡 P2-3　用户管理页视觉一致性 / 可访问性 / 信息密度（用户"丑"的具体落点）
详见 §4.2–§4.5。**最高优先的两条**：
1. `操作` 列 5 个 12px link 按钮无分隔、4 种颜色语义重叠、点击区 18px 高；
2. 三套外壳主题（紫/米色/深蓝）不统一 + 数据主文本（"未授权"）对比度 ≈2.3:1。

---

## 6. 夹具还原自检

| 项 | 处置 | 结果 | 证据 |
|---|---|---|---|
| 临时账号 `qa-ms-m1`(id=484) | 经 portal 管理台 UI 删除（墓碑） | ✅ `deleted=1` | `DELETE https://main.marschat.online/portal/api/admin/users/484` → **200**；列表复查 `HAS USER = False`；截图 `shots/cleanup-after-delete.png` |
| `admin`(id=1) | 未改动 | ✅ `deleted=0` | DB 复查 |
| `p10x`(id=302) | 未改动 | ✅ `deleted=0` | DB 复查 |
| `qa-ms-u2`(id=477) | **非本次创建，未改动** | ✅ `deleted=0` | DB 复查 |
| 484 的角色绑定 / 身份映射 | 未产生 | ✅ `sys_user_role=0`、`user_identity=0` | DB 复查 |
| 484 的 OAuth2 授权记录 | **残留 19 行（未删）** | ⚠️ 残留，见 P2-2；属既有产品行为，历史墓碑账号同样有残留 | DB 复查 |
| 密码 / 配置 / 代码 | **全程未改** | ✅ 未触碰任何改密端点；未修改任何配置或代码 | — |
| 浏览器 cookie / localStorage | 全部在 `/root/qa-ms/profiles/<RUN>-*` 隔离 profile 内 | ✅ 不影响真实浏览器 | — |

**自检结论：除"账号墓碑后遗留的 OAuth2 授权记录"（属产品既有行为，已单列为 P2-2）外，所有夹具已精确清理，被测系统数据无越权改动。**

---

## 7. 未覆盖边界（明确列出，不猜）

1. **邮箱验证码登录通道**（portal/kb-web/infra/cosmic/kb-ops 的「邮箱验证码登录」页签）——需真实收件箱取码，本轮**未覆盖**。kb-ops 的**账密独立登录因此完全未覆盖**（其登录页只有邮箱验证码）。
2. **主动改密 / 忘记密码流程**——按纪律**禁止探测**（会真实改口令），未覆盖。
3. **portal 的独立登录不经过 auth-center**（自认证 HS256）⇒ 中心 `auth:tv` 机制在 portal 上的表现未覆盖（已在 kb-web 覆盖）。
4. **`activecode`**：仅探测到 `/activecode/login.html`（200）与 `/activecode/`（302）；其登录/用户管理页未做功能测试，**其 bundle 也未做 sessionWatcher 门控核验**（故 P1-1 的适用范围表述为 5 个应用 + activecode 待确认，未直接断言 6 个）。
5. **并发规模**：仅 2 个浏览器实例（符合本次命题），未做 >2 并发或压测。
6. **S2/S3/S4/S5 的执行批次说明**：这 4 例在发现脚本 `drain()` 时序缺陷（见 T-1）**之前**执行；但其"等待 70s 跨探针周期"用的是正确的 `pump()` 实现，身份归属断言也不依赖被缩短的那部分等待，**结论有效**；S1 与 S6 已在修复后**复跑确认**（`evidence/matrix-S6-S1.json`）。
7. **S7 的"登出后重登"恢复路径**：已用 IdP 重登路径确认（`evidence/s7g.json`）；应用内「退出登录」按钮在 S6 中确认可用，但在 S7 切换态下的自动化点击未成功（T-4，脚本问题），该分支未取到自动化证据。

---

## 8. ⚠️ 测试脚本缺陷（**与产品缺陷严格区分，勿误读为产品问题**）

| # | 缺陷 | 表现 | 根因 | 修复 |
|---|---|---|---|---|
| **T-1** | `drain(seconds)` 提前返回 | 所有"等待 N 秒"实际只等 ≈0.2s → 页面还在渲染就断言 | `ws.recv(timeout=0.2)` 超时抛异常被 `return` 当成"等完了" | 改为超时后 `continue` 继续循环（`cdp.py:drain`） |
| **T-2** | websockets 保活 ping 超时断连 | 70s 空闲等待中 `ConnectionClosedError: keepalive ping timeout` | 空闲期不读 socket，ping 无 pong | 连接时 `ping_interval=None`，改用 `pump()` 主动读 |
| **T-3** | profile 目录复用 | 崩溃后重启用同名 profile → S1 首轮"登录失败"假象 | 上次崩溃残留的 profile 状态 | 每次运行加 `RUN=` 唯一前缀（`lib_qa.mk_browser`） |
| **T-4** | Element Plus 下拉 hover/click 混用 | `logout()` 报 `logout-item-not-found` | hover 打开 popper，紧接着 click 又把它**关掉**（toggle） | 改为"只用 click"或"只用 hover"，不混用 |
| **T-5** | 确认弹窗按钮点错 | 清理时点到行内「删除」而非弹窗确认按钮 | `click_text("删除")` 命中 DOM 顺序里第一个匹配（行按钮） | 作用域限定到 `.el-message-box/.el-dialog`（`cleanup_user.py`） |
| **T-6** | `/ops/users` 截到空白页 | 一度误判为"kb-ops 用户页空白"→ **已剔除，非产品缺陷** | 页面 SPA 渲染未完成就截图 | 独立复核 `scripts/probe_kbops.py` + 增加 settle 等待 |
| **T-7** | 标签宽度量测取到内层元素 | 「普通用户」量到 `w=23px`（截图上实际约 60px） | `querySelector('.el-tag')` 命中外层，`getBoundingClientRect` 受 inline-flex 影响 | **该指标已从报告剔除**，改用截图 + 按钮度量 |
| **T-8** | kb-ops 无账密登录入口 | 独立登录用例无法在 kb-ops 落地 | 该应用登录页只有邮箱验证码（**这是产品事实，不是缺陷**） | 改用 SSO 通道进入 `/ops/users` |
| **T-9** | `cdp.py::session_bodies()` 抓 `/auth/session` 响应体**恒为 `ERR:…-32601 "wasn't found"`** | 拿不到 `/auth/session` 响应体 | `body()` 把 `Network.getResponseBody` 发到 **browser 作用域**（`sess=None`），而 `requestId` 属于**页面 session**（flatten 模式下须带 `sessionId`） | ①当时改用页面内 `fetch(...,{credentials:'include'})` 取体（`run_s7c.py`；S7 结论基于此法，**不受影响**）；②**2026-09-18 根治**（架构师 E3c 佐证）：`_event()` 记录每请求 `sessionId`、`body()` 按所属 session 发送 —— 实测 `/auth/session` 返回真实 JSON（`{"authenticated":false,…}`），`ERR_BODIES=0`，测试脚本 `tmp/cdp_scope_test.py` VERDICT **PASS** |

---

## 9. 产物清单

```
C:\Users\13871\WorkBuddy\2026-09-06-22-47-35\verify\multisession\
├── qa-multisession-report.md        本报告
├── evidence\                        原始证据（JSON，全部为我本人产出）
│   ├── recon.json                   7 个页面侦察（按钮/输入框/落点）
│   ├── referrer.json                6 条 SSO 路径的 IdP URL + referrer ← 目标 2 主证据
│   ├── matrix-S1.json / matrix-S1-S2.json / matrix-S3-S4.json / matrix-S5-S6.json / matrix-S6-S1.json
│   ├── s7.json / s7b.json / s7c.json / s7d.json / s7g.json           ← S7 全流程
│   └── ui-review.json / ui-review2.json                              ← UI 量测
├── shots\                           109 张截图（关键断言 + UI 全页）
│   ├── recon-idp.png / idp-login-page.png              IdP 登录页（目标 2）
│   ├── S1A-final.png / S2A-final.png / S3A-final.png / S5A-final.png  矩阵断言
│   ├── S6B-logoutmenu.png / S6B-after-logout.png       S6 登出
│   ├── S7b-tab1-switched.png / S7g-after-recovery.png  S7 切换与恢复
│   ├── portal-admin-tab1~4.png                         portal 管理台 4 页签
│   ├── ui-portal-admin.png / ui-infra-users.png / ui2-kb-web-users.png / kb-ops-users.png
│   └── ui2-portal-admin-1024.png / ui2-portal-admin-768.png            窄视口
└── scripts\                         可复跑脚本（Python3 + websockets + requests）
    ├── cdp.py                        CDP 驱动（点击只匹配 <button>/全等文本/bbox 中心/真实鼠标事件）
    ├── lib_qa.py                     应用配置 + 双通道登录 + 在线/身份判定 + 登出
    ├── run_matrix.py                 S1–S6 矩阵（`python3 run_matrix.py S1,S2`）
    ├── run_s7.py / run_s7b.py / run_s7c.py / run_s7g.py                S7
    ├── probe_watcher.py              sessionWatcher 探针验证（本次 P1-1 的关键工具）
    ├── probe_kbops.py                kb-ops 路由复核（排除 T-6 误判）
    ├── ui_review.py / ui_review2.py / final_ui.py                      UI 审查
    ├── create_user.py / cleanup_user.py                                夹具建/销
    └── recon.py / probe_flow.py / probe2.py / probe3.py / probe_logout*.py
```

### 复跑方式（在 mykng 上）
```bash
cd /root/qa-ms
QAPWD=<admin口令> NEWU=<第二账号> NEWP=<口令> RUN=my1 APP=kb-web WAIT=70 \
  python3 scripts/run_matrix.py S1,S2,S3,S4,S5,S6
```
> `RUN=` 必须每次唯一（避免 profile 复用，见 T-3）。脚本默认已带 `--host-resolver-rules` 与 `Network.setCacheDisabled`。

---

## 10. 给下游的三句话

1. **P1-1 是最值得修的一条**：独立登录会话完全没有 SLO 联动/身份守卫。源码级根因清楚（**5 个应用的共享库**里，守卫启动点被 `isOidc()` 门控 + 时机绑定在模块初始化），**改一份共享库即可覆盖 portal / kb-web / kb-ops / infra / cosmic**（activecode 未验证）。
2. **P1-2 是用户"丑"投诉里最实际的一条**：操作列按钮真的被裁掉点不到，改共享组件的列宽/固定列即可全局见效。
3. **P1-3 的修复方案不能用 referrer**：referrer 只有 origin，且 kb-web/kb-ops 无法区分 —— 必须在 IdP 侧保存授权请求上下文。
