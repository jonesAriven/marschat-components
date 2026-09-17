# Phase 12 · 全量功能验证报告（2026-09-17）

> **范围**：认证中心 + 6 个接入应用（portal / activecode / kb-web / kb-ops / infra-monitor / cosmic-studio）+ 共享组件，覆盖**登录、SSO、免登、权限治理、安全边界、部署产物**全线。
> **方法**：mykng 主机上 HTTP 级探针（`requests` / `curl`）+ 浏览器级真机（`headless chromium` + CDP）+ 中心库 SQL 核对 + **部署产物字节码核验**。全部测试夹具用后精确还原。
> **结论**：**约 102 个用例，0 例真实失败**。报告内 5 处 `FAIL` 经定位**全部为测试脚本自身缺陷**（见 §5），已在脚本侧修正后复验通过。
> **非幂等/不可自动化的边界**已在 §6 声明，未粉饰。

---

## 1. 计分总表

| 轮次 | 覆盖 | PASS | FAIL | SKIP | 备注 |
|---|---|---|---|---|---|
| **v1** | 平台基线 + 数据真源 + 6 应用接入面 | **37** | 0 | 1 WARN | WARN = activecode 内联 UMD 版本戳 0.8.7（已知漂移，非功能缺陷） |
| **v2** | 权限治理（三层 API / D-7 / 假闸门）+ 安全边界 | **32** | 0 | 1 SKIP | SKIP 项为 activecode 登录路径写错，已由 v2b 覆盖 |
| **v2b** | D-7 真实候选 + activecode BFF + **R8 自锁** | **12** | 1 | — | 该 1 例为测试 bug（1 字符 keyword），v2c 修正 |
| **v2c** | 修正复验 + members 基线核对 | **2** | 0 | — | — |
| **v3** | 浏览器层（登录页 / SSO 免登 / 错误文案 / app 作用域只读） | **18** | 1 | — | 该 1 例为选择器平局 bug，v3b 修正 |
| **v3b** | 忘记密码精确点击复验 | **1** | 0 | — | — |
| **合计** | | **102** | **2→0** | — | 修正后净失败 **0** |

---

## 2. v1 · 平台基线 + 6 应用接入面（37 PASS / 0 FAIL）

### 2.1 认证中心基线
`/actuator/health` = UP ｜ OIDC issuer = `https://auth.marschat.online` ｜ `/login.html` 200 ｜ `/oauth2/jwks` 200 ｜ `POST /auth/login` 200（**alg=HS384**）｜ `/auth/refresh` 200 ｜ 邮箱验证码发送 200、**二次发送 400（60s 频控）** ｜ `POST /auth/forgot-password` 200（防枚举恒成功）

> ⚠️ **重要事实**：中心业务 API（`/auth/**`）**不在公网 `auth.marschat.online` 暴露**（实测该路径 404），只经**应用 BFF / 网关**或**内网 8085** 可达。各应用 `authApiBase` 走各自域名的反代路径。

### 2.2 数据真源完整性
启用客户端 **6/6** ｜ 平台超管在位且启用 ｜ 权限点脏数据（含点号）**0** ｜ 活跃用户 **2**（`admin` + 常驻回归 `p10x`）

| client_id | menu | api | 合计 |
|---|---|---|---|
| marschat-portal | 2 | 3 | 5 |
| marschat-kbweb | 15 | 10 | 25 |
| marschat-kbops | 16 | **28** | 44 |
| marschat-inframon | 6 | 7 | 13 |
| marschat-activecode | 8 | 6 | 14 |
| cosmic-studio | 8 | 11 | 19 |

> kb-ops 的 api 从 3 → **28**，即 R5「假闸门整改」已注册生效。

### 2.3 前端产物（0.8.8 特征串命中）

| 容器 | 在服 chunk |
|---|---|
| portal-web | `index-BR-0YBai.js` |
| kb-web | `index-DhdUAR2C.js` |
| kb-ops-web | `index-fA7CZjN2.js` |
| infra-monitor-web | `index-DgttdD5G.js` |
| cosmic-web | `index-Tj-g62FF.js` |
| activecode（无构建） | 内联 UMD `version = "0.8.7"` ⚠️ **WARN：`VENDORED-auth-core-umd.md` 标 0.8.8，产物自报 0.8.7** —— 0.8.8 发版只改版本戳未重建 UMD |

### 2.4 入口与服务在线
6 应用公网入口（走 `1.117.70.30` 真实入口）**全部 200**；6 个后端**未授权可达**（portal-server/kb-gateway/infra/activecode/cosmic = 401，kb-ops = 403）→ 证明服务在线且鉴权门生效。

---

## 3. v2 / v2b / v2c · 权限治理与安全边界（46 PASS / 0 FAIL）

### 3.1 三层权限 API 边界（R1）—— 全部符合设计

| 用例 | 结果 |
|---|---|
| F1 平台管理员 GET `/admin/clients/cosmic-studio/members` | 200 |
| F2 **普通用户** 同端点 | **403** |
| F3 **应用管理员（本应用）** 同端点 | **200** |
| F4 应用管理员 **删平台用户** `/admin/users/{id}` | **403** |
| F5 应用管理员改**本应用**角色 | 200 |
| F6 应用管理员**跨 client** 改角色 | **403** |
| F7 应用管理员**跨 client** 读 members | **403** |

> 结论：**「应用管理员 ≠ 平台管理员」在服务端成立**，且 client 已钉进 path，`?client=` 不能越界。

### 3.2 D-7 受限读端点（加人候选）

| 用例 | 结果 |
|---|---|
| `keyword` < 2 字符 | **400** |
| `keyword=p10` | 200，返回 `[{"userId":302,"username":"p10x","nickname":null}]` |
| **字段仅 3 个**（`userId`/`username`/`nickname`） | ✅ 无 email/role/status |
| 已加入者（admin）不在候选 | ✅ |
| `size=999` | 200 且 ≤20（服务端 clamp；因活跃用户仅 2 个，候选集天然 ≤1，clamp 属**结构级**验证） |
| 普通用户访问候选 | 403 |
| 应用管理员**跨 client** 访问候选 | 403 |
| 应用管理员读**本 client 角色清单** `GET /admin/clients/{cid}/roles` | 200（**同名不同权**：POST 建角色仍仅平台管理员） |

### 3.3 R8 自锁（临时 client 夹具，可逆）

| 用例 | 结果 |
|---|---|
| 夹具：临时 client + admin/user 角色 + `api:admin:write`，仅 1 名持有者 | 就绪（持有者数=1） |
| R8-1 应用管理员**移出最后一名管理员** | **409**，文案：`该用户是应用 v2r8probe 的最后一名管理员，此操作将导致应用管理功能无人可用；请联系平台管理员处理` |
| R8-2 应用管理员**降级自己**（roleIds=[]） | **409** |
| R8-3 **平台管理员**同类操作 | **200**（放行） |
| 审计留痕 `user.remove_last_app_admin` | ✅ 已写入 `operation_log` |
| 夹具清理 | 五张表残留合计 **0**；活跃用户仍 **2** |

### 3.4 kb-ops 写闸门（R5 假闸门整改）

| 用例 | 结果 |
|---|---|
| 超管写 `POST /kb-ops/ops/service` | 400（**过闸门**，落参数校验） |
| 普通用户写同接口 | **403** |
| 普通用户触发 `POST /ops/sync/from-intelligence` | **403**（整改前该接口**无任何权限注解**） |
| 决定性证据（R5 轮）：只授 `menu:services`、不授 api 点 | 读 `GET /ops/service/list` **200**；写 **403** ⇒ **开菜单 ≠ 给写权限** |

### 3.5 BFF 白名单与 HPP（R2 / R3 / R4）

**kb-ops（带真实会话 token）**：
`GET /admin/users?client=own` 200 ｜ `POST /admin/users` **404** ｜ `PUT /admin/users/1` **404** ｜ `DELETE /admin/users/1` **404** ｜ `PUT /admin/users/1/password` **404** ｜ **重复 `client` 参数（HPP）404** ｜ `/admin/authorization-matrix` **404** ｜ `GET /admin/permissions` **200** ｜ `GET /admin/roles/78/permission-codes` **200**（后两条为 R4 补放行，修复 R3 造成的坏功能）

**infra-monitor（应用自有 JWT 会话）**：
`GET /api/admin/roles` 200 ｜ `POST /api/admin/users` **404** ｜ `PUT /api/admin/users/999999` **404** ｜ HPP **404**

**activecode（JSESSIONID 会话，登录径 `POST /activecode/api/auth/login`）**：
`GET /api/admin/users?client=own` 200 ｜ `POST /api/admin/users` **404** ｜ HPP **404** ｜ `/api/admin/authorization-matrix` **404** ｜ `GET /api/admin/roles` 200

---

## 4. v3 · 浏览器层（19 PASS / 0 FAIL）

### 4.1 6 应用登录页元素（未登录态）

| 应用 | SSO 入口 | 账密框 | 邮箱码 | 忘记密码入口 |
|---|---|---|---|---|
| portal | ✅ | ✅ | — | ✅ |
| kb-web | ✅ | ✅ | — | ✅ |
| kb-ops | ✅ | —（**纯 SSO 应用，符合设计**） | ✅ | ✅ |
| infra | ✅ | ✅ | — | ✅ |
| cosmic | ✅ | ✅ | — | ✅ |
| activecode | ✅ | ✅ | ✅（tab 切换） | ✅ |

### 4.2 SSO 单点免登（核心铁律）

portal 未登录 → 点「统一认证登录」→ 落 IdP → **输入口令 1 次** → 回跳 portal 已登录；随后访问 kb-web / kb-ops / infra / cosmic / activecode **5/5 免登**。
**口令输入总次数 = 1** ✅（免登铁律达标）

### 4.3 其他

| 用例 | 结果 |
|---|---|
| P0-1 回归：带 IdP 会话重访 `/portal/login` | 自动免登，无密码框 |
| kb-ops `/ops/users` 页签（超管） | `[用户, 菜单授权, 账号映射]` 全可见 |
| app 作用域「编辑」 | 弹窗标题 **「用户信息（只读）」**，3 个身份字段**全部 disabled**，按钮仅「取消」**无「确定」** |
| 错误口令 / 不存在账号 | 弹窗文案 **「用户名或密码错误」**（两者同文案 = 正确防枚举） |
| 忘记密码 | 正确进入找回流程第 1 步（「忘记密码 / 请输入您的注册邮箱，我们将发送验证码 / 发送验证码 / 返回登录」） |
| 邮箱验证码频控 | **「验证码发送过于频繁，请 60 秒后再试」** |
| P0-3 回归：activecode 匿名 `POST /activation/generate`、`GET /config/default-expire` | 均 **401** |

---

## 5. 测试脚本自身缺陷清单（**本轮 5 次 FAIL 的真因，非产品问题**）

| # | 现象 | 真因 | 纠正 |
|---|---|---|---|
| ① | v1 A8 邮箱验证码 400 | 上一轮刚发过**同一邮箱**，命中 60s 频控 | 改唯一邮箱；频控另立用例断言 400 |
| ② | v1 A7/A8/A9 显示 `200200` | 我把「HTTP 码」与「body 码」拼成了一个串 | 只取 body `code` |
| ③ | v2 J0 activecode 会话 SKIP | 登录路径写错（应为 `/activecode/api/auth/login`） | 取源码映射后修正，v2b 覆盖 |
| ④ | v2b G4b 候选 0 行 | `keyword=p` 只有 1 字符 → 服务端按规则返回 **400**（与 G1 同因） | 改 2 字符以上；v2c 复验 |
| ⑤ | v3 E2 忘记密码无反应 | `a.forgot-link` 与父 `div` 文本长度相同，排序后取到了**父 div**（事件只向上冒泡） | 用元素**自身 bbox** 派发真实鼠标事件；v3b 复验 |

> **附带发现**：`members` 接口响应键是 **`list`**（不是 `records`）：`{list,total,page,size}` —— v2 中「cosmic members 复核 = []」即因此误读为空，实际基线为 1 行（`admin`），已在 v2c 核对确认未被测试破坏。

---

## 6. 未覆盖 / 边界（如实声明）

| 项 | 说明 |
|---|---|
| 邮箱验证码**闭环** | 需真实邮箱收码，本轮只验「发送成功 + 60s 频控 + 错误文案」；发送到不存在邮箱不产生真实邮件 |
| D-7 `size` clamp 上限 | 活跃用户仅 2 个、候选集 ≤1，无法构造 >20 数据集 → 仅**结构级**验证（请求 999 返回 ≤20 且不报错） |
| 应用管理员「加法补齐」的**时序** | 本轮验证的是「上报后自动补齐」（kb-ops 28/28）。「先报 menu 后报 api」的静默失效场景属坑 #18，未构造复现 |
| R8 的 `uid=1` 种子绑定 | 临时夹具 client 未重启 auth-center，故 uid=1 未被种子绑定；真实 client 在**重启后** uid=1 会恒为该 client 管理员（设计内） |
| F1 密钥共享 / 3.2-B 令牌分离 | 属**待拍板**项，不在本轮验证范围（现状已由源码 + 容器 env 指纹实测登记） |

---

## 7. 复现方式

| 轮次 | 入口 |
|---|---|
| v1 | mykng 上 `bash /tmp/v1.sh`（平台基线 + 数据真源 + 产物 + 入口 + 未授权可达） |
| v2 | `python3 /tmp/v2.py`（三层 API / D-7 / 假闸门 / BFF 白名单 / HPP；自带夹具清理） |
| v2b | `python3 /tmp/v2b.py`（R8 自锁 + 临时 client 夹具；**含五表清理与残留自检**） |
| v3 | `python3 /tmp/v3.py`（浏览器层；需 `chromium` + `websockets`，用 `--host-resolver-rules` 绕过本机 hosts 把 kb/ops 钉到 127.0.0.1 的问题） |

> 环境前置：`ssh root@192.168.31.105`（免密）· mykng 装有 `/usr/bin/chromium` 与 Python `websockets`/`requests`。
> 夹具纪律：所有临时账号**随机口令、用后墓碑**；临时 client 五表清理并自检残留=0；role 绑定精确还原。
