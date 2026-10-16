import { useLayoutEffect, useRef, useState } from 'react'
import HighlightTag from '@/components/HighlightTag'
import { useT } from '@/i18n'
import { strongestKinds } from '@/lib/matchHighlights'
import { cn } from '@/lib/utils'
import type { HighlightCount } from '@/api/overview'

/** What of the tags is drawn: the first `tags` of them, and the count of the others where `count` (and any is left). */
interface Fit {
  tags: number
  count: boolean
}

/**
 * How many tags of these widths fit in `room`, from the first, with the count of those left out after them (`plus` is
 * the widest count the row can have). Where not even the count fits, nothing is drawn.
 */
function fitting(widths: number[], hidden: number, room: number, gap: number, plus: number): Fit {
  for (let tags = widths.length; tags >= 0; tags -= 1) {
    const left = hidden + widths.length - tags
    const used = widths.slice(0, tags).reduce((sum, width) => sum + width, 0) + gap * Math.max(0, tags - 1)
    if ((left > 0 ? used + (tags > 0 ? gap : 0) + plus : used) <= room) {
      return { tags, count: true }
    }
  }
  return { tags: 0, count: false }
}

interface PhoneHighlightTagsProps {
  highlights: HighlightCount[]
  /** The most tags the row may have: two beside something at the right end of its line, three otherwise. */
  limit: number
}

/**
 * The highlight tags of a row of matches on a phone (spec of the phone view, 4, as plan 8 rules it: the row's second
 * line never wraps), in the matches table and in the profile's history alike: at most `limit` of the kinds that stand
 * out most, as tags 18px tall with 10px letters (the table's are 22px and 11px), and the count of the kinds left out
 * (`+2`). They stay on one line, in the room the line leaves them: a tag that does not fit in whole is not drawn but
 * counted, from the end, so that the strongest stay. The box measures its tags again whenever its width or theirs
 * changes (the line's room, the fonts arriving). Drawn under `md` only: from there the rows have the table's tag and
 * line, or none.
 */
export default function PhoneHighlightTags({ highlights, limit }: PhoneHighlightTagsProps) {
  const t = useT()
  const { kinds, hidden } = strongestKinds(highlights, t, limit)
  const box = useRef<HTMLSpanElement>(null)
  const [fit, setFit] = useState<Fit>({ tags: kinds.length, count: true })
  const texts = kinds.map((kind) => kind.text).join('|')
  useLayoutEffect(() => {
    const element = box.current
    // Without an observer (the tests' DOM) every tag is drawn.
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }
    // Fractional widths (not `offsetWidth`, which rounds): a rounded-down sum could leave a tag a pixel too wide.
    const width = (node: Element | null) => node?.getBoundingClientRect().width ?? 0
    const measure = () => {
      const room = width(element)
      // Not drawn (from `md`): there is nothing to measure.
      if (room === 0) {
        return
      }
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0
      const widths = Array.from(element.querySelectorAll('[data-tag]'), width)
      const plus = width(element.querySelector('[data-count-room]'))
      const next = fitting(widths, hidden, room, gap, plus)
      setFit((current) => (current.tags === next.tags && current.count === next.count ? current : next))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.querySelectorAll('[data-tag]').forEach((tag) => observer.observe(tag))
    measure()
    return () => observer.disconnect()
  }, [texts, hidden])
  const left = hidden + kinds.length - fit.tags
  return (
    <span ref={box} className="relative flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden md:hidden">
      {kinds.map((kind, index) => (
        // A tag that does not fit stays to be measured, out of the line and unseen (so not heard either).
        <span key={kind.type} data-tag className={cn('flex shrink-0', index >= fit.tags && 'invisible absolute')}>
          <HighlightTag type={kind.type} className="h-4.5 px-1.5 text-[10px]">
            {kind.text}
          </HighlightTag>
        </span>
      ))}
      {left > 0 && fit.count && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{`+${left}`}</span>
      )}
      {/* The widest count the row can have, unseen: the room a count takes. */}
      <span data-count-room aria-hidden="true" className="invisible absolute font-mono text-[11px]">
        {`+${hidden + kinds.length}`}
      </span>
    </span>
  )
}
