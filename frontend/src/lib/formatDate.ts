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

/**
 * The time of day of an ISO-8601 instant in the viewer's time zone, on the 24-hour clock: `22:14`. A string that is not a
 * date gives an empty string.
 */
export function formatClock(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const englishDayMonth = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' })

const DAY_MONTH_FORMATS: Record<Locale, (date: Date) => string> = {
  en: (date) => englishDayMonth.format(date),
  uz: (date) => `${date.getDate()}-${UZBEK_MONTHS[date.getMonth()]}`,
}

/**
 * When a match was played, in the short form of a narrow table column: day, month and time of day, `10 Oct · 21:40` in
 * English, `10-okt · 21:40` in Uzbek, for an instant of the year of `now`. Any other year takes the date with its year
 * and no time (`10 Oct 2025`): a date without its year would be read as this year's, and the column has no room for
 * both the year and the time. A string that is not a date gives an empty string.
 */
export function formatMatchTime(iso: string, locale: Locale, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  if (date.getFullYear() !== now.getFullYear()) {
    return FORMATS[locale](date)
  }
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${DAY_MONTH_FORMATS[locale](date)} · ${time}`
}

/**
 * The day a match was played, for a place that has room for a few characters only (the breadcrumb of the match):
 * `10 Oct` in English, `10-okt` in Uzbek, for an instant of the year of `now`. Any other year takes the date with its
 * year, as `formatMatchTime` does. A string that is not a date gives an empty string.
 */
export function formatMatchDay(iso: string, locale: Locale, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.getFullYear() === now.getFullYear() ? DAY_MONTH_FORMATS[locale](date) : FORMATS[locale](date)
}
