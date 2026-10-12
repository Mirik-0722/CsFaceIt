import type { Locale } from '@/i18n'

const englishFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

// Spelled out here rather than taken from `Intl`: the Uzbek month names differ between engines.
const UZBEK_MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek']

// One format per language: a language added to `Locale` without a date format here does not compile.
const FORMATS: Record<Locale, (date: Date) => string> = {
  en: (date) => englishFormat.format(date),
  uz: (date) => `${date.getDate()}-${UZBEK_MONTHS[date.getMonth()]} ${date.getFullYear()}`,
}

/**
 * An ISO-8601 instant in the viewer's time zone: `01 Oct 2026` in English, `1-okt 2026` in Uzbek. A string that is not
 * a date gives an empty string in every language.
 */
export function formatDate(iso: string, locale: Locale): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return FORMATS[locale](date)
}

/**
 * An ISO-8601 instant with its time of day, on the 24-hour clock of spec 5: `01 Oct 2026, 22:14` in English,
 * `1-okt 2026, 22:14` in Uzbek. A string that is not a date gives an empty string.
 */
export function formatDateTime(iso: string, locale: Locale): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${FORMATS[locale](date)}, ${time}`
}
