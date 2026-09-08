# SSO + 忘记密码功能 - 部署实施总结

**日期**: 2026-01-09  
**状态**: ✅ 代码开发完成，待部署测试

---

## 一、已完成的工作

### 1. 前端组件 (marschat-components)

| 组件 | 修改内容 | 状态 |
|------|----------|------|
| `auth-components` | LoginPanel 集成忘记密码四步流程 | ✅ |
| `auth-components` | token.ts 支持 Cookie 读写 | ✅ |
| `frontend-common` | authInterceptor 支持 SSO Cookie 模式 | ✅ |
| `frontend-common` | request.ts 自动检测 Token 来源 | ✅ |
| `auth-core` (Java) | TokenProvider 新增 Cookie 读取方法 | ✅ |
| `auth-core` (Java) | MarsUserArgumentResolver 统一 Token 解析 | ✅ |

### 2. 后端 (auth-center)

| 文件 | 操作 | 说明 |
|------|------|------|
| `config/SsoCookieProperties.java` | 新建 | SSO Cookie 配置属性类 |
| `util/SsoCookieUtil.java` | 新建 | Cookie 设置/删除工具类 |
| `controller/AuthController.java` | 修改 | login/logout/refresh 添加 Cookie 操作 |
| `resources/application.yml` | 修改 | 添加 `sso.cookie.*` 配置 |

### 3. 应用升级

| 应用 | 路径 | 修改文件 | 状态 |
|------|------|----------|------|
| portal | `devtools/portal` | LoginView.vue, vite.config.ts | ✅ |
| kb-ops | `devtools/kb-ops/kb-ops-web` | LoginView.vue, vite.config.ts | ✅ |

### 4. 构建状态

| 项目 | 构建命令 | 状态 |
|------|----------|------|
| common-core | `mvn clean install -DskipTests` | ✅ 成功 |
| auth-core | `mvn clean install -DskipTests` | ✅ 成功 |
| auth-center | `mvn clean package -DskipTests` | ✅ 成功 |

---

## 二、部署步骤

### 1. 部署 auth-center

```bash
# auth-center 已构建完成，JAR 包在:
D:\huliang\java\ideaworkspace\auth-center\target\*.jar

# 通过 CI/CD 或手动部署:
# 1. 上传 JAR 到服务器
# 2. 重启 auth-center 容器/服务
```

**验证部署成功**:
```bash
curl https://auth.marschat.online/auth/health
# 应返回 {"status": "UP"}
```

### 2. 部署前端应用 (portal, kb-ops)

```bash
# 方式一：本地开发（使用源码链接，已配置）
cd D:\huliang\java\ideaworkspace\devtools\portal
pnpm install
pnpm run dev

cd D:\huliang\java\ideaworkspace\devtools\kb-ops\kb-ops-web
pnpm install
pnpm run dev
```

**方式二：生产构建**
```bash
# 需要先发布 npm 包，或继续使用本地链接方式构建
pnpm run build
# 将 dist 目录部署到 Nginx
```

### 3. Nginx 配置

确保各应用 Nginx 配置包含：

```nginx
location /api/ {
    proxy_pass http://backend:8080/;
    proxy_cookie_domain auth.marschat.online $host;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## 三、测试验证

### SSO 跨域测试

1. **Portal SSO 登录**
   - 打开 https://main.marschat.online/portal/
   - 点击 "统一认证登录（SSO）"
   - 在 auth-center 输入账密登录
   - 预期：登录成功，跳转回 Portal

2. **跨域访问 kb-web**
   - 在新标签页打开 https://kb.marschat.online/kb/dashboard
   - 预期：**直接进入 dashboard，无需重新登录**

3. **跨域访问 kb-ops**
   - 在新标签页打开 https://kb.marschat.online/ops/dashboard
   - 预期：**直接进入 dashboard，无需重新登录**

4. **登出联动**
   - 任一系统点击登出
   - 刷新其他系统页面
   - 预期：需要重新登录

### 忘记密码测试

1. **点击忘记密码**
   - 登录页点击 "忘记密码？"
   - 预期：切换到邮箱输入视图（不跳转页面）

2. **发送验证码**
   - 输入注册邮箱
   - 点击 "发送验证码"
   - 预期：显示验证码输入视图，60秒倒计时开始

3. **重置密码**
   - 输入收到的验证码
   - 输入新密码并确认
   - 点击 "重置密码"
   - 预期：显示成功提示

4. **返回登录**
   - 点击 "返回登录"
   - 使用新密码登录
   - 预期：登录成功

---

## 四、文件变更清单

### 新增文件

```
marschat-components/
├── packages/auth-components/
│   └── FORGOT-PASSWORD-USAGE.md
├── docs/
│   ├── AUTH-CENTER-COOKIE-GUIDE.md
│   ├── APP-UPGRADE-GUIDE.md
│   ├── SSO-IMPLEMENTATION-SUMMARY.md
│   └── DEPLOYMENT-SUMMARY-2026-01-09.md (本文件)
└── auth-center/
    └── src/main/java/com/marschat/authcenter/
        ├── config/SsoCookieProperties.java
        └── util/SsoCookieUtil.java
```

### 修改文件

```
marschat-components/
├── packages/auth-components/src/
│   ├── types/index.ts
│   ├── components/LoginPanel.vue
│   └── utils/token.ts
├── packages/frontend-common/src/
│   ├── interceptors/authInterceptor.ts
│   └── request.ts
└── java/auth-core/src/main/java/com/marschat/auth/
    ├── jwt/TokenProvider.java
    └── web/MarsUserArgumentResolver.java

auth-center/
├── src/main/java/com/marschat/authcenter/controller/AuthController.java
└── src/main/resources/application.yml

devtools/portal/
├── src/views/LoginView.vue
└── vite.config.ts

devtools/kb-ops/kb-ops-web/
├── src/views/login/LoginView.vue
└── vite.config.ts
```

---

## 五、回滚方案

如需回滚：

1. **前端**：恢复旧的 LoginView.vue，移除 vite.config.ts 中的别名配置
2. **后端**：移除 AuthController 中的 SsoCookieUtil 调用
3. **配置**：删除 application.yml 中的 `sso.cookie.*` 配置

---

## 六、关联文档

| 文档 | 说明 |
|------|------|
| [SSO 实施总结](./SSO-IMPLEMENTATION-SUMMARY.md) | 完整架构设计和代码说明 |
| [ADR-SSO-001](./ADR-SSO-Cookie-Domain-Sharing.md) | Cookie Domain 共享架构决策 |
| [AUTH-CENTER-COOKIE-GUIDE.md](./AUTH-CENTER-COOKIE-GUIDE.md) | 后端 Cookie 设置指南 |
| [FORGOT-PASSWORD-USAGE.md](../packages/auth-components/FORGOT-PASSWORD-USAGE.md) | 忘记密码使用指南 |
| [APP-UPGRADE-GUIDE.md](./APP-UPGRADE-GUIDE.md) | 各应用升级详细步骤 |
