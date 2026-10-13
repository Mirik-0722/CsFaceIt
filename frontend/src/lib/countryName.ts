import type { Locale } from '@/i18n'

/**
 * The name of a country in the interface language (`ua` → `Ukraine`), from the browser's own data; null when the code
 * is not one of a region, or the browser has no name for it, so that the caller shows the code.
 */
export function countryName(code: string, locale: Locale): string | null {
  try {
    return new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }).of(code.toUpperCase()) ?? null
  } catch {
    // A code that is not shaped like a region (`RangeError`), or a browser without `Intl.DisplayNames`.
    return null
  }
}
