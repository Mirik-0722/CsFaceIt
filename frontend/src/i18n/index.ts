import { useSyncExternalStore } from 'react'
import { en } from './en'
import { uz } from './uz'

export type Locale = 'uz' | 'en'
export type Messages = typeof en

export const LOCALES: readonly Locale[] = ['uz', 'en']
export const DEFAULT_LOCALE: Locale = 'uz'
/** The `localStorage` key that remembers the chosen language between visits. */
export const LOCALE_STORAGE_KEY = 'csfaceit.lang'

const DICTIONARIES: Record<Locale, Messages> = { uz, en }

function isLocale(value: string | null): value is Locale {
  return LOCALES.some((locale) => locale === value)
}

/** The remembered language; a value that is not a known language, or a storage that cannot be read, gives the default. */
function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    return isLocale(stored) ? stored : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

// A module-level store instead of a React context: no provider to mount, so a component renders in either language
// wherever it is rendered, including on its own in a test.
let current = readStoredLocale()
const listeners = new Set<() => void>()

// The page language is set once when the module loads as well, so it is right before anyone picks a language.
document.documentElement.lang = current

export function getLocale(): Locale {
  return current
}

/** Switches the language: remembers it, sets `<html lang>` and re-renders everything that reads it. */
export function setLocale(locale: Locale): void {
  current = locale
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Storage is unavailable (private mode, blocked site data): the choice then lasts until the page is reloaded.
  }
  document.documentElement.lang = locale
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale)
}

export function messagesFor(locale: Locale): Messages {
  return DICTIONARIES[locale]
}

/**
 * The language a dictionary is of, for what is given the texts and has to format a date to go with them. A dictionary
 * that is none of the known ones (there is no such) counts as the default language.
 */
export function localeOf(messages: Messages): Locale {
  return LOCALES.find((locale) => DICTIONARIES[locale] === messages) ?? DEFAULT_LOCALE
}

/** The texts of the current language; the component re-renders when the language changes. */
export function useT(): Messages {
  return messagesFor(useLocale())
}
