import { cn } from '@/lib/utils'

/** The product name: a constant, not a dictionary entry, because a name is not translated (a working name, spec 9). */
export const WORDMARK = 'csfaceit'

/** The mark of spec 3: a camera frame (four corner brackets) around the REC dot, with the wordmark beside it. */
export default function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {/* Decorative: the wordmark next to it carries the name. */}
      <svg viewBox="0 0 28 28" aria-hidden="true" className="size-6.5 shrink-0">
        <path d="M3 9V3h6M19 3h6v6M25 19v6h-6M9 25H3v-6" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="14" cy="14" r="4.5" className="fill-rec" />
      </svg>
      <span className="font-mono text-[15px] font-semibold tracking-[-0.02em]">{WORDMARK}</span>
    </span>
  )
}
