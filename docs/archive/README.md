# 归档索引（archive/）

> **定位**：存放「统一登录 / 用户管理」主题的**历史与过程材料** —— 设计规格、专项诊断、验证证据、对抗性复盘。
> 🔴 **本目录不是现行态**。要查「现在怎么设计 / 怎么接入」→ `../README.md`；「还有什么没做」→ `../STATUS.md`；「线上出故障怎么查」→ `../TROUBLESHOOTING.md`。
>
> **归档时间**：2026-09-19（全量审计，来源为 3 个会话工作区 + 1 个应用仓库）
> **归档原则**：① 只复制不移动（源工作区可能仍活跃，且会话工作区会被清理）；② **已被现行文档覆盖的不归档**（见 §二，这是"不冗余"的依据）；③ 含明文凭据的**脱敏后**才归档（见 §三）。
> **命名**：保留原文件名，按主题分子目录；文件名前缀无特殊含义，勿据此推断版本序。

---

## 一、已归档（22 份 / 约 560KB）

### 1. `phase12/` —— Phase 12 三层权限与两类菜单（2026-09-16）

| 文件 | 篇幅 | 内容 | 为什么值得留 |
|---|---|---|---|
| `p12-architect-design.md` | 42KB | 三层权限 API + 两类菜单**完整设计规格**（迁移 Step1-4 序、令牌分离 3.2-B 评估、逐文件行号论证） | README §8 只是它的**浓缩结论**，推导过程仅此一份 |
| `p12-menu-ux-spec.md` | 33KB | 两类用户管理菜单**逐文件前端规格**（7 页面定性、`UserManagementPanel` 三处裁剪、接口迁移对照表、错误文案总表） | README §6.1 无此细度；改前端时唯一权威源 |
| `p12-architect-audit.md` | 42KB | 全量复核审计：接入完成度矩阵（12 应用 × 6 维度逐文件证据）、P0/P1/P2 问题登记、取证清单 | 审计基线与取证方法（问题本身已转 `STATUS.md`） |
| `p12-authcenter-deploy-audit.md` | 14KB | **auth-center 部署链路全貌**：`clients.yml` 真源链 / `/root/auth-center` 是落后 45 提交的陈旧克隆 / 回滚无 `:previous` 镜像 / 推 main 自动重建单容器 | **全新主题**，README/CONFIG/TROUBLESHOOTING 原本都没有 |
| `p12-engineer-probe.md` | 20KB | 线上实测快照：版本核验、F1 共享密钥确认、**数据真源统计**（活跃用户 / client 数 / 权限点分布 / 映射数）、未推送改动盘点 | 数据快照是历史基线，排查回归时可比对 |
| `p12-f1-jwt-rotation-plan.md` | 6KB | **F1 共享密钥两阶段轮换方案**（阶段 1 下游改 JWKS 公钥验签 → 阶段 2 双密钥过渡，顺序不可颠倒） | `STATUS.md` 的 T-DEC-1 只有标题，方案正文仅此一份 |

### 2. `portal-401/` —— portal 并发同账号「被踢」专项（2026-09-18/19）

> 这是 **docs 原本完全没有的一条工作线**，比 R6 报告更新。涉及两件事：三项用户需求（D1 IdP 返回入口 / D2 中文语言包 / D3 视觉 16 项）+ portal 401 硬踢诊断。

| 文件 | 篇幅 | 内容 |
|---|---|---|
| `REPORT-2026-09-18.md` | 47KB | **本轮主报告**（倒序追加，**结论以最上面 §0 为准**）。含双浏览器多会话矩阵逐应用口径、portal 401 三条候选根因的收敛、D1 验收 30/30、E0 采样日志上线证据 |
| `portal-401-diagnosis.md` | 38KB | 401 机制**诊断基座**（真 401 唯一发射点、拦截器注册面、业务 code:401 与真 401 的区别） |
| `portal-401-commit3-logging-spec.md` | 9KB | **E0 结构化采样日志规格**（`reason` 枚举、埋点位置、只记 `sha256(token)` 前 8 位、严禁原始 token） |
| `portal-s3s4-defect-registration.md` | 5KB | **独立缺陷登记**：S3/S4 的"身份守卫静默重授权"是与硬踢**不同的另一条链路** |
| `portal-401-criteria3-closure.md` | 6KB | 判据③：为何"夹具自关联"**不能闭合**（时间对齐但请求/token 来源对不上） |
| `portal-401-criteria5-findings.md` | 8KB | 判据⑤：三条廉价假设（issuer 漂移 / 密钥轮换边界 / 残留旧 token）**逐条排除** |
| `portal-401-e1-e3-findings.md` | 11KB | E1/E3 实验：E3 证实守卫链路（exchange 未发出）；发现 CDP harness 缺陷 ｜ ⚠️ **已脱敏** |
| `portal-401-e2-e4-findings.md` | 10KB | E2/E4b：C1 不可复现（9/9 无 401）；4 次真 401 全落 `iss/typ 不匹配`分支 |
| `architect-fix-plan.md` | 64KB | D1 方案对比（推荐新增 `GET /login-context`）+ **D3 视觉 16 项元素级清单** |
| `qa-multisession-report.md` | 36KB | QA 多会话主矩阵；P1/P2 缺陷取证基座 |
| `qa-coverage-report.md` | 22KB | QA 覆盖补测（逐应用 17 PASS / 3 N/A / 0 FAIL；S8 同源键名零交集） |
| `qa-regression-report.md` | 21KB | 修复后回归（含"Fix A 当时未部署"的时间线） |
| `qa-d1-report.md` | 16KB | D1 验收证据（六应用 30/30 PASS、PKCE 前提） |

### 3. `phase11/` —— Phase 11 对抗性复盘（2026-09-15）

| 文件 | 篇幅 | 内容 |
|---|---|---|
| `01-初衷达成度评估.md` | 26KB | 按 6 条初衷逐条实测达成度，列 G1–G15 缺口；含**取证纪律**（每条结论须 file:line / DB / HTTP 实测） |
| `02-架构合理性评估与重构方案.md` | 59KB | 架构合理性 + 重构方案；**附录 B 修正了 5 条历史 ADR 结论**；含"复制粘贴清单"（~1400 行同构代码）与数据模型实测快照 ｜ ⚠️ **已脱敏** |

### 4. `activecode/`

| 文件 | 篇幅 | 内容 |
|---|---|---|
| `VENDORED-auth-core-umd.md` | 2.5KB | **无构建链静态页如何接入公共组件**（内联 UMD + 同步脚本 + sha256 纪律 + 禁手改）。README 接入篇只提了脚本名，机制说明仅此一份 |

---

## 二、未归档清单（**去冗余依据**，勿重复搬入）

> 判定标准：**内容已被现行文档覆盖，或属一次性/半成品产物**。原件仍留在原工作区（路径见下），需要时按路径回查。

| 来源 | 文件 | 未归档原因 |
|---|---|---|
| `2026-09-16-01-25-17/docs` | `p12-browser-e2e.md` | 半成品（仅场景 A 完成，B–F 因配额中断未执行），结论已被后续报告覆盖 |
| 同上 | `p12-kbweb-kbops-samesite.md` | 已被 `p12-r3-samesite.md` 的**实施**超越（实施报告已入库 devtools） |
| 同上 | `p12-r2-workorder.md` | 施工工单已完成，无结论价值 |
| 同上 | `p12-r2-report.md` / `p12-r2-qa.md` / `p12-r3-samesite.md` / `p12-activecode-gate.md` / `p12-bff-narrow.md` / `p12-cosmic-narrow.md` / `p12-authcenter-3layer.md` / `p12-engineer-fix.md` | 实施记录，**结论已分别并入** `../STATUS.md`（已闭合清单）、`../README.md`（§6/§8）、`PHASE12-SUMMARY`/`ROUND6`；独有增量仅为提交号与流水线号（已在上述文档登记） |
| `2026-09-06-22-47-35/verify/design` | `portal-401-fix-spec.md` | 实施规格，主体已被 git 提交 `01034332` 覆盖，且含已被推翻的 `currentSpaPath()` 死代码 |
| 同上 | `portal-401-handoff.md` | 交接单，已被实际提交取代，含同一处死代码 |
| `devtools/active-manager/docs/v2` | `design.md` / `development.md` / `requirements.md` / `troubleshooting.md` / `deploy.md` / `usage.md` / `changelog.md` | **激活码业务系统文档**（加解密 / 编译 / 部署 / 业务需求），与统一登录主题无关，留在应用仓。⚠️ 其中 `deploy.md` / `usage.md` **含明文凭据**（见 §三） |
| `auth-center/docs/adr` | `INDEX.md` | 属 auth-center 仓；且**已过期不完整**（仅 2 条 2026-09-08 条目，缺 Phase 11/12 权威 ADR，仍指向已并入 §38 的旧文件）。**建议删除或改为指向 `devtools/docs/adr/INDEX.md`**（已登记待办） |
| `config-as-code/docs/adr` | 2 份 ADR | Monorepo 决策 / nginx 配置版本化，非登录主题；⚠️ 其中 monorepo ADR 的「6 应用」口径与现行不一致（含 `tokenhub`、漏 `cosmic-studio`） |
| `devtools/` | `账密清单_审核用.md` | 🔴 **严禁归档**（见 §三） |

---

## 三、敏感信息处置（**重要**）

| 事项 | 处置 |
|---|---|
| 归档前的脱敏 | `portal-401/portal-401-e1-e3-findings.md`（QA 夹具明文口令 ×2）、`phase11/02-架构合理性评估与重构方案.md`（明文密钥引用 ×9）、`portal-401/portal-401-commit3-logging-spec.md`（历史共享密钥值 ×1）→ 均已替换为 `<REDACTED-*>` 占位符。**原文保留在原工作区**。 |
| 归档后自检 | 对全目录扫描口令 / secret / 密钥值模式：**零残留**（2026-09-19） |
| 🔴 **高危待处置** | `D:\huliang\java\ideaworkspace\devtools\账密清单_审核用.md`（5.7KB，**未被 git 跟踪** ✅）—— 含**全栈明文凭据**：SSH 口令、MySQL root、Nacos/MinIO/MeiliSearch/MongoDB 口令、`JWT_SECRET` / `CRYPTO_AES_KEY` / `MEILI_MASTER_KEY` / Vaultwarden ADMIN_TOKEN。文件自带「审核后删除」字样。**建议：凭据入 Vaultwarden 后删除该文件**（已登记 `../STATUS.md` T-DOC-3） |
| 其他 | `active-manager/docs/v2/{deploy,usage}.md` 亦含明文口令，随其留在应用仓 —— 建议一并清理（已登记） |

---

## 四、时效与权威声明

1. **archive 只提供"当初为何这样"的可追溯性**，**不作为现状依据**。任何与 `../README.md`、`../STATUS.md` 冲突的表述，以现行文档为准。
2. 本目录内的报告多为**倒序追加**（如 `portal-401/REPORT-2026-09-18.md` 结论以最上面一节为准），**早期章节可能已被自身后续推翻** —— 引用前务必确认节序。
3. **必须原样保留的"未证实边界"**（不得升格为已确认缺陷）：
   - 「**真实用户会被 portal 踢**」**至今未被证实** —— 全部观测来自自动化夹具，7 次命中按小时仅落 3 个桶且与测试窗口一一对齐，**高度疑似夹具自触发**。
   - portal 401 的 token 来源**仍未定位**；E0 采样日志（已上线）是为定格它而补的观测手段。
   - 对外表述只能是「portal 存在一条会硬踢的 401 处理路径」，**不能**表述为「portal 有并发被踢缺陷」。
4. 相关现行条目：`../TROUBLESHOOTING.md` §9（portal 401 与新约定陷阱）、`../STATUS.md`（未决项）。
