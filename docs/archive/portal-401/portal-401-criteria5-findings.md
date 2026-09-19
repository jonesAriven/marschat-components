# 判据⑤ · 硬踢 401 的三条纯只读判据结果

> 归属：架构师｜执行机：mykng(192.168.31.105)｜时间：2026-09-18 13:53–14:00 CST
> 授权：主理人「E2b 降级；改走 ⑤ 的纯只读、无需复现的判据」——**只读**，不改代码/配置、不重启、不触发流水线
> 与主诊断关系：补充证据，不推翻 `portal-401-diagnosis.md`（冻结）

---

## 0. TL;DR

| 判据 | 结果 | 对"4 次命中"的解释力 |
|------|------|----------------------|
| **⑤-1 `PORTAL_JWT_ISSUER` 实际值** | **未设**（容器 env 无此变量）⇒ issuer = 默认 `marschat-portal` | ❌ **"环境值漂移"假设不成立** |
| **⑤-2 镜像构建时间 vs 命中时间** | 镜像 build = **09-18 00:11:55**；7 次命中在 **09:19–13:37**；**窗口内无重启/换 jar/换 key** | ❌ **"轮换边界"不成立**（00:12 前 9 小时 0 命中） |
| **⑤-3 profile 是否跨 run 复用** | **复用**（token iat 跨 run 共存于同一 leveldb） | ❌ **但磁盘上无任何不匹配/旧 portal token** ⇒ 该来源排除 |

**净结论**：三条廉价假设**全部排除**；且 7 次命中**在时间上与自动化测试窗口一一对齐**（【推测】测试夹具自触发）。**真正原因仍需 E0 服务端采样日志定格**（见 `portal-401-commit3-logging-spec.md`）。

---

## 1. ⑤-1 —— `PORTAL_JWT_ISSUER` 的实际值

**方法**：`docker exec portal-server sh -c 'env' | grep -iE 'PORTAL|JWT|ISSUER|TOKEN'`；并 `grep -rns PORTAL_JWT_ISSUER /root`（仓库/部署文件）。

**结果**（【已证实】）：
```
AUTH_CENTER_ISSUER=https://auth.marschat.online
PORTAL_JWT_SECRET=k2Sd...（已脱敏）
```
- **容器 env 中不存在 `PORTAL_JWT_ISSUER`** ⇒ 应用取 `application.yml:66` 默认值 **`marschat-portal`**。
- `grep PORTAL_JWT_ISSUER /root` **零命中** ⇒ 未见部署/compose 对该变量的覆盖。

**判定**：假设「环境值漂移 ⇒ 变更前签发的 token 被自己的闸门拒绝」**不成立**。
> 保留：**未找到 portal-server 源码树**，故"是否存在挂载的 `application.yml` 覆盖"未 100% 排除；**最终断言仍建议由 E0 打印实际生效 issuer**（列入待澄清）。

---

## 2. ⑤-2 —— 镜像构建时间 vs 4 次命中时间

**方法**：`docker inspect` / `docker image inspect` / 容器内 jar mtime；`docker logs --timestamps` 抽命中行。

**结果**（【已证实】）：

| 项 | 值（+08:00） |
|----|--------------|
| 镜像 `kb-app-portal-server:latest` build | **2026-09-18 00:11:55** |
| 容器 created / started | 2026-09-18 00:12:01 / 00:12:02（Up 14h） |
| 容器内 `portal-server.jar` mtime | 2026-09-18 00:11 |
| 镜像 digest | `sha256:b7039330cd1d98117cf811bc891f5ae8bcaa57d7075a2216fff670cd0c29988a` |

**7 次 `拒绝跨应用 token` 命中（+08:00）**，全部 URI=`/portal/api/sys/system/all`：
```
09:19:08  09:51:57  10:53:29  10:57:57  13:10:05  13:20:14  13:37:54
```
按小时聚合（UTC）：`01h → 2 次`、`02h → 2 次`、`05h → 3 次`（= 09/10/13 点 +08）。**00:12–09:19 之间 0 次**。

**判定**：
- 7 次全部在 build（00:11:55）**之后**，且**期间容器未重启、jar 未更、密钥未换** ⇒ **窗口内不存在"轮换边界"**。
- 若要用"24h 有效性 + 轮换前老 token"解释，则须在 00:12 前后有 iss/密钥变更；但容器创建=镜像构建=00:11，**且此后 9 小时 0 命中** ⇒ **该假设不成立**（【已证实】）。

**时间对齐（【推测】）**：命中的 3 个时段与**自动化测试窗口**吻合——
- 09:00–10:00 桶 ↔ QA 的 i2/i3/o2 矩阵（profile `i2-S3A` iat 09:18:41、`i3-*` 09:32–09:40…）；
- 13:00 桶 ↔ **本轮我的 E1/E2/E3 诊断**（profile `e2v2-A-1` iat 13:07–13:20、`e3b-S4-*` 13:37）。
⇒ 高度怀疑命中由**测试夹具自身**触发（间歇、随测试窗口出现），而非线上自然用户访问。

---

## 3. ⑤-3 —— 测试 profile 是否跨 run 复用 + 磁盘 token 普查

**方法**：扫描 `/root/*/profiles/**/{Local Storage,Session Storage,Cookies}/leveldb/**`，抽取所有 JWT，按 `(alg,iss,typ,sub,iat)` 分组。（脚本：`/tmp/scan_profiles.py`）

**结果**：扫描 2250 文件 / 去重 **295 个 token**。

### 3.1 跨 run 复用（【已证实】：复用）
- QA：`/root/qa-ms/profiles/admin2/.../000003.log` **同时含 03:33 与 08:46** 两个不同 iat 的 portal token；
- 我的：`/root/diag-401/profiles/e2v2-A-1/.../000003.log` 含 13:07–13:20 一整串 iat。
⇒ **profile 目录跨 run 持久化**（`cdp.py` 不清理 profile；仅部分 QA 脚本按 RUN_TAG `rm -rf`）。

### 3.2 但——磁盘上**没有**不匹配/旧 portal token（【已证实】：排除）
- 所有 `iss=marschat-portal, typ=portal, alg=HS256` 的 portal token：**全部合法**，`iat` 全在 **09-18 当天**，`exp` 次日（24h）。
- **未发现任何 `iss≠marschat-portal` 或 `typ≠portal` 的 portal-family token**。
- 扫描出的"HS384 / iss=None / typ=None（sub=admin|1）"token 共 31 个，属 **kb-web/kb-ops/intelligence 的应用 token**（与冻结报告 `_jwt_scan.txt` 的 `20 | HS384 | None | None` 一致）——它们**签名密钥与 portal 不同**，**不会被 portal 判为"签名可验"**，**不是**这 7 次命中的来源。

**判定**：假设「profile 里残留旧/不匹配 portal token 被继续发送」**排除**。

---

## 4. 旁证（auth-center 侧）

**方法**：`docker logs --timestamps auth-center`（13:30–13:48 我的实验窗口）。

**结果**：该窗口内 auth-center **仅出现正常的 SSO 发新 refresh token**：
```
INSERT INTO refresh_token (user_id, token, expire_at, created_at) VALUES (?,?,?,?)
已设置 SSO Refresh Token Cookie: name=sso_refresh_token, domain=marschat.online, maxAge=604800s
```
**无 `invalid_grant`、无 `oauth2/token` 报错。**

**判定**（【已证实】）：这 7 次 `拒绝跨应用 token` **与 auth-center 的 token 签发/刷新无关**（刷新链路本身正常）。

> 附带观察（供 S3/S4 参考，【已证实】）：**每次 SSO 登录都会 INSERT 一条 refresh_token 并重设 cookie** ⇒ SSO 侧会在并发窗口内**持续轮换刷新令牌**；这是 S3/S4 竞态的 plausible 背景，但**与 401/拒绝跨应用 token 无关**。

---

## 5. 结论汇总

【已证实】
1. `PORTAL_JWT_ISSUER` 未设 ⇒ issuer=`marschat-portal`（环境漂移排除）。
2. portal-server 镜像/容器 = 09-18 00:11–00:12；7 次命中在 09:19–13:37；窗口内无重启/换 jar/换 key（轮换边界排除）。
3. 测试 profile **跨 run 复用**，但**磁盘无任何不匹配/旧 portal token**（残留来源排除）。
4. 7 次命中**全部**在 `/portal/api/sys/system/all`；按小时仅 3 桶；**首次命中前 9 小时为 0**。
5. auth-center 在实验窗口内**签发/刷新正常**。

【推测·未定格】
6. 命中**时间与自动化测试窗口一一对齐** ⇒ 疑似**测试夹具自触发**（间歇）。
7. `JwtInterceptor` 的 WARN 文案是**硬编码**、**不打印实际 iss/typ** ⇒ 客户端/CDP 侧永远看不到差异根因。
8. 因此**三条廉价假设排除后，真因仍须 E0 服务端采样日志**（实际 iss/typ/alg + `sha256(token)` 前 8 位）定格。

---

## 6. 证据文件（mykng）

| 文件 | 内容 |
|------|------|
| `/tmp/probe5.txt` | 容器 env / 镜像 / jar / 7 次命中原文 / `/root` 内 `PORTAL_JWT_ISSUER` 检索 |
| `/tmp/probe5c.txt` | auth-center 日志窗口 + 命中按小时聚合 |
| `/tmp/scan_profiles.py`、`/tmp/scan_profiles.out` | 295 token 普查（分组 + SUSPECT） |

本机副本：`verify/_probe5.txt`、`verify/_probe5c.txt`、`verify/_scan_profiles.txt`、`verify/_e2/scan_profiles.py`。

---

## 7. 交主理人

| # | 事项 | 建议 |
|---|------|------|
| Q5a | ⑤ 三条全部排除后，是否确认"真因需 E0 定格" | 确认；E0 规格见 `portal-401-commit3-logging-spec.md` |
| Q5b | "测试夹具自触发"假设 | 建议**保留为待澄清（不升格）**，E0 首日 `reason`+`token_fp` 分布即可判真伪 |
| Q5c | E2b | 按你裁定**降级**，⑤ 未能解释时才回来跑 |
