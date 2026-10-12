import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ClipResponse, ClipStatus } from '@/api/types'

// The state is always a word; its colour only repeats it (spec 2.1).
const COLOR: Record<ClipStatus, string> = {
  QUEUED: 'text-muted-foreground',
  RECORDING: 'text-foreground',
  ENCODING: 'text-foreground',
  UPLOADING: 'text-foreground',
  DONE: 'text-positive',
  FAILED: 'text-negative',
}

interface StatusChipProps {
  clip: Pick<ClipResponse, 'status' | 'progress' | 'queuePosition'>
  /** Leaves the percentage of a recording out, where it is shown large beside the chip. */
  percent?: boolean
  /** Leaves the blinking dot of a recording out, where the picture of the clip, right above the chip, blinks already. */
  dot?: boolean
  className?: string
}

/**
 * The state of a clip as one mono line (spec 3): `QUEUED · #2 in line` in grey, `RECORDING 45%` behind the blinking REC
 * dot, `ENCODING` and `UPLOADING` in the text colour, `READY` in green, `FAILED` in red. The reason of a failure is not
 * part of the chip: whoever shows the chip puts it beside it.
 */
export default function StatusChip({ clip, percent = true, dot = true, className }: StatusChipProps) {
  const t = useT()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-mono text-[11px] leading-4 tracking-[0.06em] whitespace-nowrap uppercase',
        COLOR[clip.status],
        className,
      )}
    >
      {clip.status === 'RECORDING' && dot && (
        <span aria-hidden="true" className="size-2 shrink-0 animate-rec rounded-full bg-rec" />
      )}
      <span>
        {t.clip.status[clip.status]}
        {clip.status === 'QUEUED' && clip.queuePosition !== null && ` · ${t.clip.queuePosition(clip.queuePosition)}`}
        {clip.status === 'RECORDING' && percent && (
          // The number changes with every answer of the backend. Where the chip stands in a part of the page that is
          // announced when it changes, the word of the state is announced, and the number is read only when asked for.
          <span aria-live="off">{` ${clip.progress}%`}</span>
        )}
      </span>
    </span>
  )
}
