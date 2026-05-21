import { useState, useEffect, useCallback } from 'react'

/**
 * useState backed by localStorage. Used by list pages to persist the
 * user's chosen sort option across reloads.
 *
 * Falls back to the provided default on first load or when JSON parsing
 * fails. Writes silently no-op if localStorage is unavailable (private
 * mode, SSR, etc.).
 */
export function useStoredState(storageKey, defaultValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined' || !storageKey) return defaultValue
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw == null) return defaultValue
      return JSON.parse(raw)
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !storageKey) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      // Quota exceeded / disabled — ignore.
    }
  }, [storageKey, value])

  const reset = useCallback(() => setValue(defaultValue), [defaultValue])
  return [value, setValue, reset]
}
