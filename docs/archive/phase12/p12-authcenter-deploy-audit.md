# P12 · auth-center 部署链路只读调查报告

- 日期：2026-09-16
- 范围：**纯只读**（未 commit / 未 push / 未触发流水线 / 未改任何文件或容器）
- 目的：为「三层权限 API 改造」确认地基 —— 改哪个源、走哪条生效路径、能不能安全推 main、能否回滚

---

## 0. 四句结论（先给答案）

1. **线上源码来源**：`github.com/jonesAriven/auth-center` **main @ `62124537db8f`**（Woodpecker repo_id=4，`clone_url` 即此仓）。运行镜像 = 该提交的 CI 产物（可用 md5 硬对齐，见 §A4）。
2. **`clients.yml` / `ClientsYmlLoader` 在生效路径**：**在**。线上 jar 内确有 `BOOT-INF/classes/clients.yml`(6110B) 与 `ClientsYmlLoader.class`（见 §B）。前序「jar 里找不到」的判断是**误判**。
3. **分叉真相**：**不是真分叉**。`/root/auth-center` 是**落后上游 45 个提交的陈旧克隆**（其 HEAD `be405b4` 是上游 main 的**祖先**），它显示的「领先 2」是**本地 remote-tracking 引用陈旧**导致的假象。Windows 克隆 = 上游 main + 1 个未推提交。
4. **推 main 安全性与回滚**：推 main 会**自动触发 CI**（`event: [push, manual]`），且**只重建 auth-center 一个容器**（`--no-deps`）；**没有任何 `:previous` 镜像可回滚**，回滚 = `git revert` 后再推一次重跑 CI。

---

## A. 部署产物从哪来

### A1. `/root/auth-center`（mykng）git 状态
```
git remote -v  → gitee  https://…@gitee.com/jonesAriven/auth-center.git   (带内嵌凭据，值略)
                 github git@github.com:jonesAriven/auth-center.git
                 origin = 同 gitee（origin 与 gitee 同一 URL）
git branch -vv → * main be405b4 [github/main: 领先 2]
git status -sb → ## main...github/main [领先 2]  +  M docs/adr/INDEX.md（自动生成，脏）
git log -5     → be405b4, 3650f5d, 3bf3474, b2670f4(Merge '15dcaf8'), 8cbd8ce, 15dcaf8
```
根目录**没有** `.woodpecker.yml`、`deploy.sh`、`docker-compose.yml`；只有 `Dockerfile / pom.xml / scripts/ / src/ / target/ / ac2.bundle / ac3.bundle`。
> `scripts/` 内仅 `selftest-forgot-password.sh`；`src/main/resources/` = `application*.yml` + `sql/`（**无 `clients.yml`** —— 因为它只存在于更新的上游提交里，见 §C）。

### A2. 生效的流水线定义 = auth-center 仓库自带的 `.woodpecker.yml`（repo_id=4）
- **触发**：`when: { event: [push, manual], branch: [main] }` → **push 到 main 自动跑**。
- **build 步**：`maven:3.9-eclipse-temurin-21` 内 `mvn -s ci-settings.xml clean package -DskipTests`（走 Nexus 私服），产物**直写** `/mnt/shared/auth-center-build/`：`target/auth-center.jar` + `Dockerfile` + `scripts/deploy.sh`；落盘有 mkdir 原子锁 `/mnt/shared/.auth-center-pipeline.lock`（**产物目录是共享单例 → 禁止并发跑本仓库多条流水线**）。
- **deploy 步**：`appleboy/drone-ssh` → **host `192.168.31.105`（mykng）**，执行 `bash /mnt/shared/auth-center-build/deploy.sh`。
- 关键：**build context / compose 均指向 `/mnt/shared/auth-center-build`，不再指向 `/root/auth-center`**（文件内注释明确记录：曾因 build context 指向旧克隆导致「假成功」）。

`scripts/deploy.sh`（对上游 main 取回）：
- `-p kb-app -f /mnt/shared/mykng/docker/docker-compose.app.yml up -d --build --force-recreate --no-deps auth-center`
- 健康检查 `http://localhost:8085/actuator/health`（60×10s）
- **反「假成功」硬门禁**：`md5(CI 产物) == md5(容器内 /app/auth-center.jar)`，不一致即 die；并探 `/login.html` 必须 200。
- **无任何回滚逻辑**。

### A3. 运行容器（mykng）
```
docker inspect auth-center --format {{.Created}}    → 2026-09-15T04:33:39.238…Z
                            --format {{.State.StartedAt}} → 2026-09-15T04:33:41.9…Z
                            --format {{.Config.Image}}   → kb-app-auth-center
docker inspect --format '{{json .Mounts}}'           → []                （无 bind mount）
env keys: MYSQL_*, REDIS_*, NACOS_*, MAIL_*, JWT_SECRET, AUTH_ISSUER,
          SPRING_PROFILES_ACTIVE, TZ, JAVA_OPTS,
          MARSCHAT_AUTHZ_MODE, MARSCHAT_AUTHZ_STRICT_CLIENTS   ← 权限改造相关
docker exec auth-center ls -la /app → 仅 auth-center.jar (83,369,211 B)
```

### A4. 线上这版对应哪个 commit —— **可溯源（间接）到 `62124537`**
- jar 内 `META-INF/MANIFEST.MF` **无** `git.properties` / `build-info.properties`（只有 `Implementation-Version: 1.0.0`）→ **不能从 jar 直接读出 commit**。
- 但可对齐：
  - `md5(CI 产物) == md5(容器内 jar) == adc11fd5dfd874c73a6cf1360cdfa83b`（deploy.sh 的门禁当下成立）；
  - CI 产物 `target/auth-center.jar` mtime = `09-15 12:33`，容器 `Created = 04:33:39Z`；
  - 流水线 **#59** `event=push commit=62124537 started=04:32:46Z finished=04:34:26Z`（容器创建落在其窗口内）。
- ⇒ **线上 auth-center = GitHub main `62124537db8f` 的产物**。

---

## B. `clients.yml` / `ClientsYmlLoader` 到底在不在生效路径 —— **在**

### B1. 线上 jar 内实测（决定性）
```
docker exec auth-center unzip -l /app/auth-center.jar | grep -i -e clients -e apps-registry
  → BOOT-INF/classes/clients.yml                                  6110  09-15-2026 04:33
  → BOOT-INF/classes/com/marschat/authcenter/config/ClientsYmlLoader.class  15259  09-15-2026 04:33
```
⇒ `clients.yml` 与 `ClientsYmlLoader` **都在 jar 里、都在生效路径上**。前序结论「jar 里找不到」应是把 `/app`（只有 jar 文件）当成了检查对象所致。

### B2. `715b41e` 引入了什么、被谁调用（本地 Windows 仓库）
```
git show --stat 715b41e  →  src/main/resources/clients.yml | 1 +   （仅补 1 行，cosmic-studio 的 menu-report-secret，env-only）
ClientsYmlLoader.java:43  → class ClientsYmlLoader implements ApplicationRunner
ClientsYmlLoader.java:59  → new ClassPathResource("clients.yml")
ClientsYmlLoader.java:129 → “clients.yml 种子客户端 {}（{}）已就绪”
DatabaseInitializer.java:333 → 注释：OIDC 客户端种子改由 ClientsYmlLoader 读 classpath clients.yml；原硬编码 seedOidcClient 等已删除
```

### B3. 业务客户端注册（`sys_app_client` 的 10 条）实际怎么进去的 —— **两段式配置化**
**真源** = devtools 仓 `apps-registry.yml`（本机实测路径 `D:\…\devtools\apps-registry.yml`，其 `client-id` 恰好 10 条）：
```
marschat-portal, marschat-kbweb, marschat-kbops, marschat-inframon,
marschat-activecode, cosmic-studio, marschat-memory,
marschat-tokenhub, frp-manager, p3-probe-client
```
**生成器** = devtools 仓 `scripts/gen-from-registry.py`（`gen-from-registry.py clients` → stdout，由调用方重定向到 `<auth-center>/src/main/resources/clients.yml`；脚本自身不写文件）。
**执行者（运行时）** = auth-center `ClientsYmlLoader`（`ApplicationRunner`）读 classpath `clients.yml`，启动时**幂等 upsert** 到库内 OIDC 客户端表。
⇒ 链路：`apps-registry.yml → (gen-from-registry.py, devtools) → clients.yml(提交进 auth-center) → jar → (ClientsYmlLoader, 运行时) → 库内 sys_app_client`。**不是手工 SQL，也不是 V1 迁移脚本。**
> 旁证：`grep -rln apps-registry` 在 `/root/devtools/{scripts,woodScript}` 内**只命中** `gen-from-registry.py` 一个消费方（单一真源、单一生成器）。

### B4. 安全观察（不写值）
`clients.yml` 里的 `secret`/`menu-report-secret` 采用 `${ENV:默认值}` 形式，**默认值已随文件提交进公开仓库**（如 confidential 的 portal 客户端 secret、若干 menu-report-secret）。建议后续改为**无默认值**（缺失即启动失败），避免公开仓默认凭据被直接利用。*（本轮只读，未改动。）*

---

## C. 分叉真相 —— **不是真分叉；`/root/auth-center` 只是陈旧克隆**

| 对象 | main HEAD | 与上游关系 |
|---|---|---|
| **GitHub main**（`ls-remote`/API） | `62124537db8f` | —— 上游基准 |
| **Gitee main**（`git ls-remote origin main`） | `62124537db8f` | = GitHub main（两远端一致） |
| **Windows 克隆** `D:\…\auth-center` | `715b41eeb0c1` | `origin/main..main` = `715b41e` 1 条（**仅领先 1，两侧皆非独有历史**）→ 未推的 `715b41e` |
| **服务器** `/root/auth-center` | `be405b497095` | `github/main`(本地陈旧引用)=`3bf3474`；`main..github/main`=0，`github/main..main`=2 |

**独立判定（GitHub Compare API）**：
```
GET /repos/jonesAriven/auth-center/compare/main...be405b497095…
  → status = "behind", ahead_by = 0, behind_by = 45, merge_base = be405b497095…
GET /repos/…/compare/main...3bf3474c8a…  → status="behind", ahead_by=0, behind_by=47, merge_base=3bf3474…
```
⇒ `be405b4` 与 `3bf3474` **都是上游 main 的祖先**。服务器 `main`(`be405b4`) = `3bf3474` + 2 个提交（`3650f5d`、`be405b4`），这 2 个提交**也已在上游 main 里**（`git branch -a --contains be405b4` → `main / remotes/gitee/main / remotes/origin/main` 均包含）。
**结论**：服务器那份**没有任何独有提交**，纯粹落后 45 个提交；它显示「领先 2」是因为其本地 `github/main` 引用停在 `3bf3474`（陈旧）。**改代码不要用 `/root/auth-center` 比对**（它是旧世界）。真正可用的源 = **Windows/上游 main**（当前 `715b41e` 领先上游 1 个未推提交）。

---

## D. 改造风险评估

### D1. 推 auth-center main 会触发什么
- **自动触发**：`.woodpecker.yml` 顶层 `event: [push, manual]`（#58/#59 均为 `event=push`，非手动）。
- **只重建 auth-center**：deploy 步 = `deploy.sh` → `docker compose … up -d --build --force-recreate --no-deps auth-center` → **不动其它服务**。
- **并发禁令**：产物目录 `/mnt/shared/auth-center-build` 是共享单例，配 `.auth-center-pipeline.lock`；**一次只跑一条本仓库流水线**。
- ⇒ 推 main 是「自动 + 单服务重建」，**风险可控但不可逆地立即上生产**（无审批门）。

### D2. 回滚路径
```
docker images | grep auth-center
  kb-app-auth-center:latest  494ac0b680de  (在跑)
  docker-auth-center:latest  4849088cb050  (legacy)
  kb-app-kb-auth:latest      e5099df17539  (legacy，旧容器 kb-auth)
```
- **没有 `:previous` 之类上一版镜像**；`deploy.sh` 无回滚分支。
- 现实回滚 = **`git revert` 目标提交 → 再 push 一次**（重跑 CI 重建 + 健康检查）。若 online 已坏需最快止损，只能手工 `docker tag` 历史镜像（需事先留存），当前**无留存**。
- ⇒ **改造前建议：先 `docker tag kb-app-auth-center:latest kb-app-auth-center:rollback-<日期>`**（本轮只读未做）。

### D3. 健康检查
- `deploy.sh`：`/actuator/health` == 200（最多 10 分钟）；`/login.html` == 200（否则认为 SSO 断链）；结尾再探 `/.well-known/openid-configuration`。
- 当前实测：health 200、login.html 200、OIDC 200。
- 附加硬门禁：CI jar md5 == 容器 jar md5（防「假成功」）。

### D4. 枢纽依赖（哪些依赖 auth-center）
- **10 个 OIDC 客户端**（`clients.yml`/`apps-registry.yml`，即「sys_app_client 10 条」）：portal、kb-web、kb-ops、infra-monitor、activecode、cosmic-studio、memory、tokenhub、frp-manager、p3-probe。
- **nginx 单入口**：`config-as-code/hosts/tencent-cloud-2/nginx/sites-available/auth.marschat.online` → `proxy_pass http://100.93.36.113:8085`（大量 location 全打 8085）；`hosts/mykng/nginx/conf.d/locations/portal.conf` 亦引用。
- **API 网关**：`mykng/kb-gateway` 的 `OidcConfig / KbGatewayProperties / application.yml / module-manifest.json` 均引用 8085（kb-gateway 作为 OIDC 客户端/转发）。
- ⇒ auth-center 是**单点登录主链路的唯一签发方**；代码注释自称「12 应用 SSO 枢纽」（该「12」是含内部报告/映射消费方的口径，硬数字以 10 个注册客户端为准）。

### D5. 登录主链路会不会被三层改造牵连 —— 必须明确防
代码本身已确立铁律（`be405b4` 提交信息原文）：
> 「⚠️ Redis 读写全部 try-catch 降级：auth-center 是 **12 应用 SSO 枢纽**，**Redis 抖动不得导致登录/刷新 500**（currentVersion 降级为 0，bump 仅记日志）」
> 「邮箱验证码登录（**独立端点，不碰 /auth/login 主链路**）… `SecurityConfig` 新增 `@Order(1)` 独立链 `securityMatcher("/auth/mail-login/**")`」

**给三层改造的硬要求**：任何在 `@PreAuthorize` / 鉴权判据里新增的「查 DB / 查中心 / 查缓存」都必须与 Redis 同口径 **try-catch 降级（fail-open）**，不得让 `/auth/login`、`/auth/refresh`、`/auth/mail-login` 出现**新的硬依赖**；否则枢纽一抖 → 全站登录 500。

---

## E. 对下一步（三层权限 API 改造）的操作结论

1. **改哪个源**：`github.com/jonesAriven/auth-center` **main**（Woodpecker 的 `clone_url`）。**不要**用 `/root/auth-center`（陈旧，落后 45）。
2. **推送前**：确认工作副本 = 上游 main（Windows 现为 `715b41e`，领先 1）；推 main **会自动**跑 CI 并**只重建 auth-center**（无需手动触发、无需担心连带 12 应用）。
3. **上线即生产**：无审批、无 `:previous` 镜像 → 改造前先手工留存回滚镜像 tag；`revert + 再推` 是唯一编排内回滚。
4. **登录主链路护栏**：新增判据一律 fail-open 降级（见 D5）。
5. **CLIENTS 配置**：改接入清单改 `devtools/apps-registry.yml` + 跑 `gen-from-registry.py clients` 重生成 `clients.yml`，**别手改** `clients.yml`（AUTO-GENERATED）。

---

### 无法确认项（明确标注，不猜）
- 线上 jar 内**无** `git.properties`/`build-info.properties` → 无法用「读 jar」直接确认 commit；本报告的 commit 归属是**间接证据链**（md5 对齐 + 流水线时间窗），非 jar 内自证。
- Gitee 远端 `main` 与 GitHub 一致（`62124537`），但**服务器无 GitHub 私钥**（`ssh -T git@github.com` → `Permission denied (publickey)`，`id_ed25519`/`id_woodpecker` 均不行），故服务器侧无法直接读 GitHub 远端；上述比对以本机 `git ls-remote` + GitHub 公开 API 为准。
