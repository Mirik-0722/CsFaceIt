import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

function isTabHidden(): boolean {
  return document.visibilityState === 'hidden'
}

/** Whether the page's tab is in the background (or the window is minimised): nobody can see what moves on it. */
export function useTabHidden(): boolean {
  return useSyncExternalStore(subscribe, isTabHidden)
}
