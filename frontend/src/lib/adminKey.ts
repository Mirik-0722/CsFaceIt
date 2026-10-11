import { useSyncExternalStore } from 'react'

// The admin key is kept in this module's memory and nowhere else: not in `localStorage`, `sessionStorage` or a
// cookie. Reloading the page forgets it.
let adminKey: string | null = null
const listeners = new Set<() => void>()

export function getAdminKey(): string | null {
  return adminKey
}

/** Remembers the key until the page is reloaded; `null` forgets it. Everything that reads it re-renders. */
export function setAdminKey(key: string | null): void {
  adminKey = key
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The admin key typed earlier on this page load, or null. */
export function useAdminKey(): string | null {
  return useSyncExternalStore(subscribe, getAdminKey)
}
