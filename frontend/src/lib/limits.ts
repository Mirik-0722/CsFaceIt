import { localeOf, type Messages } from '@/i18n'
import { formatClock, formatMatchDay } from '@/lib/formatDate'

/**
 * When the next request is possible, as a part of a sentence in the language of `t` (`at 22:14`, `on 14 Oct at
 * 22:14`): the hour alone when the moment is today on the visitor's own clock, the day with it otherwise. Null when
 * there is no moment to name (the backend sent none, or not a date): the sentence then says "later".
 */
export function nextPossible(iso: string | null | undefined, t: Messages, now: Date = new Date()): string | null {
  if (!iso) {
    return null
  }
  const moment = new Date(iso)
  if (Number.isNaN(moment.getTime())) {
    return null
  }
  const today = moment.toDateString() === now.toDateString()
  return t.limits.nextAt(formatClock(iso), today ? null : formatMatchDay(iso, localeOf(t), now))
}
