/**
 * 加载状态 composable
 */

import { ref } from 'vue'

export function useLoading(initialState = false) {
  const loading = ref(initialState)
  
  function startLoading() {
    loading.value = true
  }
  
  function stopLoading() {
    loading.value = false
  }
  
  return {
    loading,
    startLoading,
    stopLoading,
  }
}
