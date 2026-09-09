import type { AxiosRequestConfig } from 'axios'

export type { AxiosRequestConfig }

export interface RequestOptions {
  /** 是否跳过错误处理 */
  skipError?: boolean
  /** 是否跳过 loading */
  skipLoading?: boolean
  /** 自定义 headers */
  headers?: Record<string, string>
}

export type { CreateRequestOptions, TokenStore, RequestClient } from '../request'
