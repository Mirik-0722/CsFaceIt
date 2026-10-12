import { useT } from '@/i18n'
import { otherSide } from '@/lib/matchRounds'
import type { RoundSide } from '@/api/breakdownTypes'

// A side is shown as its letters in its own colour, so the colour is never the only sign.
const SIDE_CLASS: Record<RoundSide, string> = { CT: 'text-side-ct', T: 'text-side-t' }

/**
 * The sides a team played on, in order (`CT → T`): the side it started on, then the other one. The arrow is for the
 * eye; a screen reader hears the same as a sentence.
 */
export default function TeamSides({ start }: { start: RoundSide }) {
  const t = useT()
  const then = otherSide(start)
  return (
    <span className="shrink-0 font-mono text-[11px] font-normal tracking-[0.06em] whitespace-nowrap text-subtle">
      <span className="sr-only">{t.match.sides(start, then)}</span>
      <span aria-hidden="true">
        <span className={SIDE_CLASS[start]}>{start}</span> → <span className={SIDE_CLASS[then]}>{then}</span>
      </span>
    </span>
  )
}
