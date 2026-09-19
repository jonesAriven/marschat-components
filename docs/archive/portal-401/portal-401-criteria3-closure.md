# 判据③ · "夹具自关联"——结论：**不能闭合**（但把可疑面收窄了一大截）

> 归属：架构师｜时间：2026-09-18 14:00–14:20 CST｜**只读**（无改代码/配置、无重启、无流水线）
> 主理人问题：**13:10:05 / 13:20:14 / 13:37:54 三次 `拒绝跨应用 token`，能否在我自己的 e1/e2v2/e3* 产物里对齐到"那一击"？**
> 判据：能定位到"该轮确实向 `/portal/api/sys/system/all` 发过请求、且 token 可解释为跨应用/跨通道混入" ⇒ 当场闭合；否则交 E0。

---

## 0. 结论（先给）

**不能闭合。** 时间能对上（3/3 落在我的窗口内），**但找不到"那一击"**：
- 我所有捕获到的 `/portal/api/sys/system/all` 请求 **全是 200**、`Authorization` 恒为 **portal 家族** token；
- 我的全部 profile 里**只有 portal 一族 token**（无跨应用/OIDC 混入）；
- 三条"token 来源"假设（残留旧 token / 跨应用复制 / OIDC 写进 portal 键）**均被排除**；
- **新增**：portal 的 `PORTAL_JWT_SECRET` **全服务唯一**，"另一个应用持同密钥签发"**被排除**；
- **新增（反编译实测）**：portal 自己的 `generateToken` **恒置 `iss=issuer` 且 `typ="portal"`** ⇒ **portal 自己签发的 token 永远不可能命中该 WARN**。

⇒ 真因交 **E0**（`portal-401-commit3-logging-spec.md`，打印实际 iss/typ）。

---

## 1. 时间对齐（做到了 3/3）

| 命中(UTC+8) | 我的运行窗口 | 证据 |
|-------------|--------------|------|
| **13:10:05** | e2v2 **legacy-legacy** 尾段（13:06:49–13:10:52） | `e2v2-legacy-legacy.json`(mtime 13:10:52) |
| **13:20:14** | **e3** 首跑（13:19:28–13:21:26） | `e3.json`(13:21:26)、profile `e3-S3-A-1`(13:19:28) |
| **13:37:54** | **e1+e3b**（13:33:15–13:39:46） | `e1.json`(13:35:51)、`e3b.json`(13:39:46)、profile `e3b-S3-B-*`(13:39:0x) |

⇒ **命中的确落在我的实验窗口内**。

## 2. 请求对齐（**对不上**）

- e2v2 捕获的 `rec["api"]`（reload 窗口内 `/portal/api/**`）：**legacy-legacy 6/6 轮、mixed 3/3 轮**，`/portal/api/sys/system/all` **全部 `status:200`**，`auth` **恒为 `Bearer eyJ0eXA`**。
- e1 / e3 / e3b / e3c：**401 计数全为 0**（`classify=[]`、`n401=[]`）。
- `eyJ0eXA` 解码 = **portal 家族**：`{"typ":"JWT","alg":"HS256"}` + payload `iss=marschat-portal, typ=portal`（见 §3）。

⇒ **我的捕获里没有一次"带坏 token 打 system/all"**。

> ⚠️ **必须声明的窗口盲区**：e2v2 的 `api` 只在 **target-reload 窗口**采集；**登录阶段的 system/all 请求不在内**。故"我的夹具在未捕获的登录窗口里发过一次坏 token"**无法被我的数据证否**。这也正是我**不**主张"已自证清白"的原因。

## 3. token 来源普查（**排除**）

扫描 `/root/diag-401/profiles` 全部 leveldb（`scan2.py`，36 个去重 token）：

| 家族 | header 前缀 | hdr.alg / hdr.typ | payload iss / typ | 数量 |
|------|-------------|-------------------|-------------------|------|
| **portal（唯一）** | `eyJ0eXAiOiJKV1QiLCJh` | HS256 / JWT | marschat-portal / portal | **36** |

对照 QA 的 `/root/qa-ms/profiles`（259 个）：另有 `eyJraWQ…`(RS256/auth-center) 184 个、`eyJhbGciOiJIUzM4NCJ9`(HS384/kb 应用) 31 个。

⇒ 我的 profile **只有 portal 一族**：**没有** OIDC/RS256 token 被写进 portal 的键，**没有**跨应用/跨 profile 复制。

## 4. 新增关键判据：密钥指纹（**排除"另一应用持同密钥"**）

打印各服务 `*SECRET/JWT*` 的 `sha256[:12]`（不落原文）：

| 服务 | 变量 | 指纹 |
|------|------|------|
| **portal-server** | **PORTAL_JWT_SECRET** | **95dbcb714d52**（唯一） |
| infra-monitor | JWT_SECRET | 1579449c2525 |
| kb-gateway | JWT_SECRET | 92712b1a3014 |
| kb-ops | MARSCHAT_AUTH_SECRET | 92712b1a3014 |
| auth-center | JWT_SECRET | 92712b1a3014 |

⇒ **portal 的 HS256 密钥全服务唯一**。**没有任何其他服务持有它**。⇒ "另一个应用用 portal 密钥签发了 iss/typ 不符的 token" ⇒ **排除**。

## 5. 新增关键判据：反编译当前 jar（**逻辑上排除 portal 自签**）

对当前在跑 jar 反编译（`javap -l`，详见笔三 §2）：

- `JwtUtil.generateToken`（`:101-113`）**恒置** `iss=issuer(=marschat-portal)`、`typ="portal"`；
- `JwtUtil.isIssuedByPortal`（`:144-152`）= 签名可验 **且** `iss==issuer` **且** `typ!=null && typ=="portal"`；
- `JwtInterceptor:42` 的 WARN 恰在该方法返回 false 时打印。

⇒ 由 `§4`（密钥唯一）+ 本 §（生成器恒置 iss/typ）可推：**当前 portal 自己签发的 token，永远满足 `isIssuedByPortal`，不可能触发 `:42`**。

⇒ 要触发 `:42`，token 必须是"**在 portal 密钥下可验、但 iss/typ 非 portal 规格**"——这把可能面收窄到**唯一一种**：**另有进程/构建持有同一 secret 且签发规则不同**（当前 10 个在跑容器中**未发现**；`/opt/portal-server` 是 7 月旧部署目录，**未在运行**）。**这只能靠 E0 打印实际 iss/typ 才能定格。**

## 6. 为什么不"再跑一遍"

7 次命中跨 ~4.5h **间歇**分布；单次复跑 = 等它出现，与主理人"不要再靠再跑矩阵等它出现"的指示相悖。⇒ **不跑**。

---

## 7. 证据（mykng / 本机）

| 文件 | 内容 |
|------|------|
| `/tmp/probe6.txt` | token header 家族普查 + 证据/日志时间线 |
| `/tmp/probe8..12.txt` | jar 反编译（JwtInterceptor/JwtUtil/WebMvcConfig 行号） |
| `/tmp/probe13.txt` | 各服务密钥 sha256 指纹 |
| 本机 | `verify/_probe6.txt`、`_probe8~13.txt`、`_e2/scan2.py`、`_e2/{e1,e3b,e3c}.py` |

## 8. 交主理人

| # | 事项 | 结论/建议 |
|---|------|-----------|
| ③ | 夹具自关联 | **不能闭合**（时间 3/3 对上；请求/token 来源均对不上；密钥唯一 + 生成器恒置 iss/typ ⇒ portal 自签不可能命中） |
| ③b | 后续 | **完全交 E0**；E0 首日 `reason/iss/typ/token_fp` 即定真伪 |
| ③c | 诚实口径 | "**真实用户会被踢**"至今**未被证实**；所有硬踢观测均来自**自动化夹具**——支持你把主报告写成"**间歇**、触发概率未知" |
