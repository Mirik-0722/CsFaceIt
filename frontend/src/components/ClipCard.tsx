import { Link } from 'react-router-dom'
import StatusChip from '@/components/StatusChip'
import ViewfinderFrame from '@/components/ViewfinderFrame'
import { useLocale, useT } from '@/i18n'
import { clipLabel, formatBytes } from '@/lib/clips'
import { formatDate } from '@/lib/formatDate'
import { formatDuration } from '@/lib/highlightLabels'
import { mapLabel } from '@/lib/mapTint'
import type { ClipResponse } from '@/api/types'

/** What the middle of the frame says: a play mark on a finished clip, the percentage of a recording, else the state. */
function FrameCenter({ clip }: { clip: ClipResponse }) {
  if (clip.status === 'DONE') {
    return (
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-primary">
        <svg viewBox="0 0 12 12" className="size-4 fill-primary-foreground">
          <path d="M3.5 1.5v9l7-4.5z" />
        </svg>
      </span>
    )
  }
  if (clip.status === 'RECORDING') {
    // The status line under the frame says the same in words; here the number is the picture.
    return (
      <span aria-hidden="true" className="font-mono text-[28px] leading-9 font-semibold tabular-nums">
        {clip.progress}%
      </span>
    )
  }
  return (
    <span aria-hidden="true" className="border border-ring bg-background/80 px-2.5 py-1">
      <StatusChip clip={clip} />
    </span>
  )
}

/**
 * One clip as a card (spec 3): the frame with where the clip is from, how long it is and in what quality, then what it
 * shows, whose it is, and its state. The whole card is the link to the clip's page, in whatever state the clip is.
 */
export default function ClipCard({ clip }: { clip: ClipResponse }) {
  const t = useT()
  const locale = useLocale()
  const map = mapLabel(clip.mapName) ?? t.match.unknownMap
  const recording = clip.status === 'RECORDING'
  return (
    <Link
      to={`/clips/${clip.id}`}
      className="flex h-full flex-col border border-border bg-card -outline-offset-2 hover:bg-secondary"
    >
      <article className="flex h-full flex-col">
        <div className="relative">
          <ViewfinderFrame
            mapName={clip.mapName}
            imageUrl={clip.thumbnailUrl}
            // `R14` and `MATCH` are marks on the frame, the same in every language, like the tags of the highlights.
            topLeft={`${map} · ${clip.roundNumber !== null ? `R${clip.roundNumber}` : 'MATCH'}`}
            topRight={
              recording && (
                <span aria-hidden="true" className="flex items-center gap-1.5">
                  <span className="size-1.5 animate-rec rounded-full bg-rec" />
                  REC
                </span>
              )
            }
            center={<FrameCenter clip={clip} />}
            bottomLeft={clip.durationMs !== null && formatDuration(clip.durationMs / 1000)}
            bottomRight={clip.quality}
          />
          {recording && (
            <span
              aria-hidden="true"
              className="absolute bottom-0 left-0 h-0.75 bg-rec"
              style={{ width: `${clip.progress}%` }}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1 px-4 pt-3.5 pb-1.5">
          <h3 className="truncate text-[15px] font-semibold">
            {clipLabel(clip, t)} · {clip.nickname}
          </h3>
          <p className="truncate text-[13px] text-muted-foreground">
            {map}
            {clip.roundNumber !== null && `, ${t.highlight.round(clip.roundNumber)}`}
            {' · '}
            <time dateTime={clip.createdAt}>{formatDate(clip.createdAt, locale)}</time>
          </p>
        </div>
        <div className="mt-auto flex min-h-11 min-w-0 items-center gap-2 px-4 pb-1.5">
          <StatusChip clip={clip} />
          {clip.status === 'DONE' && clip.sizeBytes !== null && (
            <span className="font-mono text-[11px] tracking-[0.06em] text-subtle">{formatBytes(clip.sizeBytes)}</span>
          )}
          {/* The recorder's own words about what went wrong, as they are: a technical message. */}
          {clip.status === 'FAILED' && clip.error && (
            <span className="min-w-0 truncate font-mono text-[11px] text-subtle">{clip.error}</span>
          )}
        </div>
      </article>
    </Link>
  )
}
