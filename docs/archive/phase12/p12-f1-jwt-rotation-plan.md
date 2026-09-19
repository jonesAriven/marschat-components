# F1 · JWT 共享密钥轮换方案（P2 · 待立项）

> 日期：2026-09-17 · 性质：**方案 + 取证，未改动任何线上配置**
> 背景：Phase 12 审计登记项 F1（auth-center 与 kb-gateway 共用 `JWT_SECRET`）
> 本文全程**不含任何密钥明文**，仅用长度 + sha256 前 8 位指纹判等

---

## 1. 现状取证（2026-09-17 实测）

| 服务 | 环境变量 | 长度 | 指纹 | 角色 | 判定 |
|---|---|---|---|---|---|
| auth-center | `JWT_SECRET` | 58 | `92712b1a` | **签发 + 验签** | 密钥持有者（弱默认样式） |
| kb-gateway | `JWT_SECRET` | 58 | `92712b1a` | 只验签 | 🔴 **与 auth-center 同值** |
| kb-ops | `MARSCHAT_AUTH_SECRET` | 58 | `92712b1a` | 只验签 | 🔴 **与 auth-center 同值**（ADR 原记漏了这一处） |
| portal-server | `PORTAL_JWT_SECRET` | 48 | `95dbcb71` | 独立签发 | ✅ 已独立（且代码内建"命中已泄露共享密钥则拒绝启动"的护栏） |
| infra-monitor | `JWT_SECRET` | 48 | `1579449c` | 独立签发 | ✅ 已独立（2026-09 早前轮换过） |

**结论修正**：共享面是 **3 个服务**（auth-center / kb-gateway / kb-ops），不是 ADR 里记的 2 个。kb-ops 的入口是 `MARSCHAT_AUTH_SECRET`（`application.yml` 回落到 `JWT_SECRET`），所以按 `JWT_SECRET` 去 grep 会漏掉它。

**补充事实**
- kb-gateway **只验签不签发**：`signWith / Jwts.builder / JwtEncoder` 在 `src/main` 零命中，只出现在 `src/test`。
- auth-center 的 OIDC 端点可用：`/oauth2/jwks` → 200；`/.well-known/openid-configuration` → 200，issuer = `https://auth.marschat.online`。
- kb-web 已纯 OIDC；portal / infra 各有独立密钥 ⇒ **legacy HS256 的发签方只剩 auth-center 自己**。

---

## 2. 风险定性

1. **鉴权边界失效**：kb-gateway、kb-ops 持有与签发方相同的对称密钥 ⇒ 任一被攻破，可自行签发任意 `sub`/`role` 的 token，下游全认。
2. **弱密钥**：58 字节但为 `Your…AtLeast256BitsLong!!` 这类**公开可猜的默认样式**（源码 README 与配置文件里就写着原文），等同于公开密钥。
3. **爆炸半径**：auth-center 是 12 应用的 SSO 枢纽，密钥一旦被滥用 = 全平台身份可伪造。

---

## 3. 处置方案（两阶段，先治本再换钥）

### 阶段 1（治本，推荐先做）——下游停止共享对称密钥，改用 JWKS 公钥验签

| 项 | 内容 |
|---|---|
| 动作 | kb-gateway、kb-ops 的验签链改为 **auth-center JWKS（RS256）**；从配置中**移除** `JWT_SECRET` / `MARSCHAT_AUTH_SECRET` 的对称验签分支 |
| 依据 | 网关只验签不签发（已取证）；JWKS 端点 200 可用；kb-web 走 OIDC 已是 RS256，改造后**全链路口径统一** |
| 收益 | 共享面 3 → 1（只剩 auth-center 自己）；下游**不再持有任何可用于伪造的密钥**；后续轮换 auth-center 密钥时下游零感知 |
| 影响面 | 仍持有 **legacy HS token** 的会话会 401 ⇒ 需重新登录一次。OIDC/RS256 会话不受影响 |
| 前置确认 | ① 确认没有服务还在给网关发 HS256 token（当前证据指向"没有"，但需实测抓一次线上流量再切）② kb-ops 的双验签第 1 环（HS384 fallback）是否可一并下线 |
| 回滚 | 保留对称验签分支一个发版周期（配置开关控制），异常即切回；JWKS 验签与对称验签可并存 |
| 验证判据 | ① 用一个仅用旧 HS 密钥签的 token 打网关 → 应 401 ② OIDC 登录全流程 → 各应用仍免登 ③ 网关日志无 `JwtValidationException` 激增 |

### 阶段 2（换弱密钥）——auth-center 自身密钥轮换，走双密钥过渡

| 项 | 内容 |
|---|---|
| 动作 | 生成 ≥64B 随机新密钥；auth-center 临时支持 `JWT_SECRET`（旧）与 `JWT_SECRET_NEW`（新）：**签发用新，验签新旧都收**；全端滚动完成后移除旧值 |
| 影响面 | 过渡期内旧 token 仍有效（因为双验签）⇒ **无需停机、无需集中重新登录**；过渡结束后旧 token 失效，最长影响 = token 有效期 |
| 顺序 | 阶段 1 完成后再做 ⇒ 下游已走 JWKS，auth-center 换钥对下游**零影响**，影响面收窄到 auth-center 自己 |
| 风险 | 若阶段 1 未完成就换钥，kb-gateway / kb-ops 会因密钥不一致而**全量 401** ⇒ **两阶段顺序不可颠倒** |
| 回滚 | 新值撤掉即回到旧密钥签发/验签（旧密钥在过渡期始终有效） |
| 验证判据 | ① 新签发的 token 能被验过 ② 过渡期内旧 token 仍可用 ③ 移除旧值后旧 token 401 |

---

## 4. 建议执行窗口与沟通

- 阶段 1 选**低峰期**（夜间），因为会有一次性的重新登录；影响对象是"当前持有 legacy HS 会话"的用户，规模需上线前用网关访问日志估一次。
- 阶段 2 可在阶段 1 稳定 1~2 天后进行，用户无感。
- 两阶段都要留**回滚镜像 / 旧配置备份**，且都在一个发版窗口内完成，不做跨窗口半成品。

---

## 5. 待确认（需良哥拍板或实测）

1. 线上是否仍有服务在发 HS256/HS384 token 给 kb-gateway？（决定阶段 1 能否一次性切干净）
2. kb-ops 的双验签第一环（HS384 fallback）是否随阶段 1 一并下线？
3. auth-center 是否对**第三方/外部系统**签发长期 HS token？（若有，阶段 2 的过渡期要按最长 token 有效期来定）
4. 轮换后的密钥放哪：继续走容器 env，还是纳入 Vaultwarden（`vault.marschat.online:8222`，已是凭据真源）统一分发？

---

## 6. 本文不做的事

- 未改动任何线上配置、未轮换任何密钥。
- 未触碰 workcheck（硬性禁区）。
- 未把任何密钥明文写进文档、日志或代码。

---

## 7. 需要回填的 ADR 修正

`ADR-2026-09-16-Phase12-统一认证权限治理.md` 的 F1 条目写的是「auth-center 与 kb-gateway 共用」，**漏了 kb-ops**（它的入口是 `MARSCHAT_AUTH_SECRET`）。下次动 ADR 时一并更正为"3 个服务共享"。
