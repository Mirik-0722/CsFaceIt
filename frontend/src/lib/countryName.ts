import type { Locale } from '@/i18n'

/**
 * The name of a country in the interface language (`ua` → `Ukraine`), from the browser's own data; null when the code
 * is not one of a region, the browser has no names in the interface language (it would answer in its own default
 * language, which is not the one the page is in) or has none for this region, so that the caller shows the code. The
 * site writes the apostrophe as `'` (`O'zbekiston`), and so do these names, whatever mark the browser's data uses.
 */
export function countryName(code: string, locale: Locale): string | null {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' })
    if (!names.resolvedOptions().locale.toLowerCase().startsWith(locale)) {
      return null
    }
    return names.of(code.toUpperCase())?.replace(/[\u02BB\u02BC\u2018\u2019]/g, "'") ?? null
  } catch {
    // A code that is not shaped like a region (`RangeError`), or a browser without `Intl.DisplayNames`.
    return null
  }
}
