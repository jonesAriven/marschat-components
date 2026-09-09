/**
 * 分页 composable
 * 提供分页数据和分页参数管理
 */

import { ref, computed, reactive } from 'vue'
import type { PaginationParams } from '../types/pagination'

export interface PaginationOptions<T = any> {
  /** 获取分页数据的 API 函数 */
  fetchFn: (params: PaginationParams) => Promise<PaginatedResponse<T>>
  /** 每页条数，默认 20 */
  pageSize?: number
  /** 是否自动加载第一页 */
  immediate?: boolean
}

export function usePagination<T = any>(options: PaginationOptions<T>) {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const currentPage = ref(1)
  const pageSize = ref(options.pageSize || 20)
  const total = ref(0)
  const records = ref<T[]>([])

  // 数据
  const paginatedData = computed(() => ({
    list: records.value,
    total: total.value,
    page: currentPage.value,
    pageSize: pageSize.value,
  }))

  /** 加载指定页 */
  async function loadPage(page: number, size?: number) {
    loading.value = true
    error.value = null
    
    try {
      const params: PaginationParams = {
        page,
        pageSize: size || pageSize.value,
      }
      const data = await options.fetchFn(params)
      
      records.value = data.list || []
      total.value = data.total || 0
      currentPage.value = page
      return data
    } catch (e: any) {
      error.value = e?.message || '加载失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  /** 刷新当前页 */
  async function refresh() {
    await loadPage(currentPage.value)
  }

  /** 下一页 */
  function nextPage() {
    const totalPages = Math.ceil(total.value / pageSize.value)
    if (currentPage.value < totalPages) {
      loadPage(currentPage.value + 1)
    }
  }

  /** 上一页 */
  function prevPage() {
    if (currentPage.value > 1) {
      loadPage(currentPage.value - 1)
    }
  }

  /** 首页/末页 */
  function goToPage(page: number) {
    const totalPages = Math.ceil(total.value / pageSize.value)
    if (page >= 1 && page <= totalPages) {
      loadPage(page)
    }
  }

  return {
    loading,
    error,
    currentPage,
    pageSize,
    total,
    records,
    paginatedData,
    loadPage,
    refresh,
    nextPage,
    prevPage,
    goToPage,
  }
}
