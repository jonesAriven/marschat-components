# @marschat/frontend-common

> **MarsChat 前端公共工具包** — axios 封装、拦截器、通用 Composables

统一的前端请求层，支持自动 token 刷新、错误处理、并发请求去重。

## 📦 安装

```bash
pnpm add @marschat/frontend-common
```

## 🚀 快速使用

### 1. 创建请求实例

```typescript
// src/utils/request.ts
import { createRequest, createLocalStorageTokenStore } from '@marschat/frontend-common'

export const { request, authRequest } = createRequest({
  baseURL: '/api',
  authBaseURL: 'https://auth.marschat.online',  // 认证服务地址（可选）
  tokenStore: createLocalStorageTokenStore('my_app'),  // Token 存储
  timeout: 15000,
  
  // 白名单路径（不弹全局错误、不触发登录跳转）
  whiteListPaths: ['/login', '/refresh', '/health'],
  
  hooks: {
    onError: (message) => {
      ElMessage.error(message)  // 或其他 UI 提示
    },
    onUnauthorized: () => {
      router.push('/login')  // 跳转到登录页
    },
  },
})

export default request
```

### 2. 业务请求

```typescript
// 使用 request 实例（返回完整 AxiosResponse）
import request from '@/utils/request'

// GET 请求
const res = await request.get('/users')
const data = res.data.data  // 解包：res.data 是 R<T>，.data 才是业务数据

// POST 请求
const res = await request.post('/users', { name: 'test' })

// 文件上传
const formData = new FormData()
formData.append('file', file)
await request.post('/upload', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
})
```

### 3. Auth 请求（自动解包）

```typescript
// 使用 authRequest 实例（直接返回 data.data）
import { authRequest } from '@/utils/request'

// 自动解包，直接拿到业务数据
const tokens = await authRequest.post('/refresh', { refreshToken })
// tokens = { accessToken: '...', refreshToken: '...' }
```

### 4. Composables

#### useLoading - 加载状态管理

```typescript
import { useLoading } from '@marschat/frontend-common'

const { loading, withLoading } = useLoading()

// 自动管理 loading 状态
const data = await withLoading(() => fetchData())
// loading.value 在请求期间为 true
```

#### usePagination - 分页

```typescript
import { usePagination } from '@marschat/frontend-common'

const { 
  pagination, 
  pageData, 
  loadPage, 
  refresh,
  total,
} = usePagination(async (page, size) => {
  const res = await request.get('/users', { params: { page, size } })
  return {
    records: res.data.data.records,
    total: res.data.data.total,
  }
})

// 模板中使用
// <el-pagination v-model="pagination" />
```

## 🔧 API 参考

### createRequest Options

| 属性 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `baseURL` | `string` | ✅ | - | 业务接口基础 URL |
| `authBaseURL` | `string` | ❌ | `baseURL` | 认证服务 URL |
| `refreshPath` | `string` | ❌ | `'/refresh'` | Token 刷新路径 |
| `timeout` | `number` | ❌ | `15000` | 请求超时时间 (ms) |
| `tokenStore` | `TokenStore` | ✅ | - | Token 存储实现 |
| `whiteListPaths` | `string[]` | ❌ | `['/login', '/refresh']` | 白名单路径 |
| `hooks.onError` | `(msg) => void` | ❌ | - | 全局错误回调 |
| `hooks.onUnauthorized` | `() => void` | ❌ | - | 401 未授权回调 |

### RequestPair 返回值

| 属性 | 类型 | 说明 |
|------|------|------|
| `request` | `AxiosInstance` | 业务实例（返回完整响应） |
| `authRequest` | `AxiosInstance` | Auth 实例（自动解包 data.data） |

### TokenStore 接口

```typescript
interface TokenStore {
  getAccessToken(): string | null
  setAccessToken(token: string): void
  getRefreshToken(): string | null
  setRefreshToken(token: string): void
  clear(): void
}
```

**内置实现**：

```typescript
// localStorage 实现（推荐）
const store = createLocalStorageTokenStore('my_app')

// 自定义实现（如 Cookie）
const cookieStore: TokenStore = {
  getAccessToken: () => getCookie('access_token'),
  setAccessToken: (t) => setCookie('access_token', t),
  getRefreshToken: () => getCookie('refresh_token'),
  setRefreshToken: (t) => setCookie('refresh_token', t),
  clear: () => { removeCookie('access_token'); removeCookie('refresh_token') },
}
```

## 🔄 Token 自动刷新机制

```
请求 → 401 → 有 refreshToken?
              ├─ 否 → clear() → onUnauthorized()
              └─ 是 → 并发刷新?
                       ├─ 是 → 挂起等待新 token → 重放请求
                       └─ 否 → 发起刷新请求
                              ├─ 成功 → 更新 token → 重放原请求 + 排队请求
                              └─ 失败 → clear() → onUnauthorized()
```

**特性**：
- ✅ 并发请求自动合并为一次刷新
- ✅ 刷新失败自动跳转登录
- ✅ 白名单接口不触发刷新
- ✅ 防止无限重试（`_retry` 标记）

## 📦 导出列表

```typescript
// 核心函数
export { createRequest } from './index'
export type { CreateRequestOptions, RequestPair, RequestHooks } from './index'

// Token 存储
export { createLocalStorageTokenStore } from './token-store'
export type { TokenStore } from './token-store'

// 类型定义
export type { R } from './types'

// Composables
export { useLoading } from './composables/useLoading'
export { usePagination } from './composables/usePagination'

// 工具函数
export { formatDate, formatDateTime, formatFileSize } from './utils/format'
```

## 🎯 与后端 Result 对齐

前端 `R<T>` 类型与 Java `Result<T>` 完全对齐：

```typescript
// 前端类型
interface R<T> {
  code: number      // 200=成功, 其他=失败
  message: string   // 错误信息
  data: T          // 业务数据
  traceId?: string // 链路追踪 ID
}
```

```java
// Java 类型（common-core）
public class Result<T> {
    private int code;
    private String message;
    private T data;
    private String traceId;
}
```

## 📄 License

MIT
