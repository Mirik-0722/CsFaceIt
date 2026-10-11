import type { Locale } from '@/i18n'

const englishFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

// Spelled out here rather than taken from `Intl`: the Uzbek month names differ between engines.
const UZBEK_MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek']

/** An ISO-8601 instant in the viewer's time zone: `01 Oct 2026` in English (the default), `1-okt 2026` in Uzbek. */
export function formatDate(iso: string, locale: Locale = 'en'): string {
  const date = new Date(iso)
  if (locale === 'uz') {
    return `${date.getDate()}-${UZBEK_MONTHS[date.getMonth()]} ${date.getFullYear()}`
  }
  return englishFormat.format(date)
}
