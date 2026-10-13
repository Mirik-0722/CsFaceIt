import type { Locale } from '@/i18n'

// Spelled out here rather than taken from `Intl`, as the dates are: an engine without the Uzbek data would group with
// commas. A no-break space keeps a figure and its unit on one line.
const GROUP_SEPARATORS: Record<Locale, string> = { en: ',', uz: ' ' }

/** A whole number with its thousands grouped as the language does: `1,742` in English, `1 742` in Uzbek. */
export function formatInteger(value: number, locale: Locale): string {
  const rounded = Math.round(value)
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATORS[locale])
  return rounded < 0 ? `-${digits}` : digits
}
