/**
 * 本地存储工具
 */

const STORAGE_PREFIX = 'marschat'

function getKey(key: string): string {
  return `${STORAGE_PREFIX}:${key}`
}

export const storage = {
  get<T = any>(key: string, defaultValue: T): T {
    const value = localStorage.getItem(getKey(key))
    if (value === null) return defaultValue
    try {
      return JSON.parse(value)
    } catch {
      return value as any
    }
  },

  set(key: string, value: any): void {
    const v = typeof value === 'string' ? value : JSON.stringify(value)
    localStorage.setItem(getKey(key), v)
  },

  remove(key: string): void {
    localStorage.removeItem(getKey(key))
  },

  clear(): void {
    Object.keys(localStorage)
      .filter(k => k.startsWith(`${STORAGE_PREFIX}:`))
      .forEach(k => localStorage.removeItem(k))
  },
}
