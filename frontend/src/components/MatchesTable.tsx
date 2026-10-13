import { ChevronRight, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import DemoStages from '@/components/DemoStages'
import FaceitTag from '@/components/FaceitTag'
import MapEmblem from '@/components/MapEmblem'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale, useT } from '@/i18n'
import { formatMatchTime } from '@/lib/formatDate'
import { formatScore } from '@/lib/formatScore'
import { kindText, summarizeHighlights } from '@/lib/matchHighlights'
import { mapLabel } from '@/lib/mapTint'
import { cn } from '@/lib/utils'
import { isDemoInProgress, type ClipCounts, type PlayerMatchResponse } from '@/api/overview'
import type { Bringing } from '@/lib/useDemoBringing'
import { useViewer } from '@/lib/viewer'
import { nextPossible } from '@/lib/limits'
import type { MatchResult } from '@/api/types'

// The columns of the header and of every row: the map with where the match is from and its date, the score, K / D / A,
// the highlights (the one that takes what is left), the clips and the arrow. The first one holds the emblem and, on one
// line, the FACEIT tag and the date; the number columns are as wide as their figures need, so that the highlights keep
// their room. The row starts 14px in: 3px of it is the bar of the result.
const COLUMNS = 'grid grid-cols-[220px_100px_104px_minmax(0,1fr)_160px_16px] items-center gap-4 pr-1 pl-3.5'

// A row carries its result (the `result-row` utility: a bar at the left edge and a tint that fades out); a match
// without a known result has neither. The word of the result stays in the row: the colour is never the only sign.
const RESULT_ROW: Record<MatchResult, string | undefined> = {
  WIN: 'result-row [--result:var(--positive)]',
  LOSS: 'result-row [--result:var(--negative)]',
  UNKNOWN: undefined,
}

/**
 * A figure of the stored line of the match. Where the backend has none it is a dash that screen readers do not read,
 * with the words "No data" for them, as in the maps table and the statistics tiles.
 */
function Figure({ value, digits = 0 }: { value: number | null; digits?: number }) {
  const t = useT()
  if (value === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t.statsCards.noData}</span>
      </>
    )
  }
  return value.toFixed(digits)
}

/**
 * What the player's own rows can do about a demo: the files in the rows' state of bringing, and the way to ask for a
 * file for a match. Only the page of the signed-in player's own matches has it; the others' rows have no action.
 */
export interface RowBringing {
  states: Record<string, Bringing>
  /** Opens the file chooser for this match. */
  pick: (matchId: string) => void
}

/** Whether a row's own action is the "Upload a demo" button: the match has no demo or its demo failed, and no file is on its way. */
function offersUpload(match: PlayerMatchResponse, state: Bringing | undefined): boolean {
  return (match.demoStatus === null || match.demoStatus === 'FAILED') && state?.phase !== 'sending' && state?.phase !== 'sent'
}

/** Whether the row draws anything of its own beside the link: the button, or the figure of a file that is going. */
function hasRowAction(match: PlayerMatchResponse, state: Bringing | undefined): boolean {
  return state?.phase === 'sending' || offersUpload(match, state)
}

// Where the action stands in the row's grid (the link takes the one column). From `md` up it is over the right-hand end
// of the row, where the clips column is, held 36px inside the right edge of what is on screen. Under `md` the table
// scrolls sideways, and anything over the figures would cover them: the action goes to a second grid row, under the
// figures, held at the left edge of what is on screen, so that it covers nothing at any scroll position. The wrapper
// lets the pointer through to the row's link everywhere but on the button itself.
const ACTION_PLACE =
  'pointer-events-none sticky z-10 col-start-1 max-md:row-start-2 max-md:self-end max-md:justify-self-start max-md:left-3.5 max-md:pb-2.5 md:row-start-1 md:right-9 md:self-center md:justify-self-end'

/**
 * The strongest highlight of the match as a tag (only an ace is filled) and the others as a line of text. Without an
 * analyzed demo there is nothing to show: a match that has no demo, or whose demo failed, says that it has none, one
 * that is on its way shows the stages it has been through.
 */
function HighlightsCell({ match, onItsWay }: { match: PlayerMatchResponse; onItsWay: boolean }) {
  const t = useT()
  if (match.demoStatus === null || match.demoStatus === 'FAILED') {
    return <span className="font-mono text-xs text-subtle">{t.demo.none}</span>
  }
  // A demo on its way: where it has got to, as the line of its stages (the same as the demo panel of the match shows).
  // One that has stayed PARSED too long is not counted as on its way and gets the dash below.
  if (onItsWay) {
    return <DemoStages demo={{ status: match.demoStatus, error: null, errorCode: null }} compact />
  }
  const { top, rest } = summarizeHighlights(match.highlights, t)
  if (match.demoStatus !== 'ANALYZED' || !top) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        <span aria-hidden="true">—</span>
        {match.demoStatus === 'ANALYZED' && <span className="sr-only">{t.matches.highlights.none}</span>}
      </span>
    )
  }
  return (
    <>
      {/* Written as it is shown, as on the highlight cards: the tag leaves the case of `1v3 CLUTCH` alone. */}
      <Badge variant={top.type === 'ACE' ? 'default' : 'outline'} className="normal-case">
        {kindText(top, t)}
      </Badge>
      {rest && (
        // Two lines at most, so that the count of the kinds left out (`+3`) is not cut off with the rest of the text.
        <span title={rest} className="line-clamp-2 min-w-0 font-mono text-xs text-muted-foreground">
          {rest}
        </span>
      )}
    </>
  )
}

/**
 * The clips of the match: how many are in progress and how many are ready, or only how many are ready. `active` counts
 * every clip that is neither finished nor failed, the queued ones too, so there is no REC dot here: on this site the dot
 * says "being recorded now" (`StatusChip`), which this count does not. A demo that is being analyzed says so where the
 * clips would be. Nothing for a match without a clip. Failed clips are not counted here; the page of the match shows them.
 */
function ClipsCell({ clips, onItsWay }: { clips: ClipCounts; onItsWay: boolean }) {
  const t = useT()
  if (clips.active > 0) {
    return (
      <span className="text-foreground">
        {t.matches.clips.active(clips.active)}
        {clips.done > 0 && ` · ${t.matches.clips.ready(clips.done)}`}
      </span>
    )
  }
  if (clips.done > 0) {
    return <span>{t.matches.clips.readyAlone(clips.done)}</span>
  }
  if (onItsWay) {
    return (
      <span className="font-mono text-[11px] tracking-[0.06em] text-foreground uppercase">{t.matches.analyzing}</span>
    )
  }
  return null
}

/**
 * The action of a player's own row that brings a demo, drawn over the right-hand end of the row, where the clips column
 * is (a match without a demo has no clips): "Upload a demo" while there is nothing to start from, the percent while a
 * file goes. It is the row's sibling, not inside the link: a button in a link is two interactive elements in one. It
 * sits at the row's right edge, past the arrow's column (16px of arrow, 16px of gap and the row's 4px), and on a phone
 * under the figures (see `ACTION_PLACE`). A used-up day's limit turns the button off and says when it frees up.
 */
function RowAction({ match, state, bringing }: { match: PlayerMatchResponse; state: Bringing | undefined; bringing: RowBringing }) {
  const t = useT()
  const locale = useLocale()
  const { limits } = useViewer()
  const label = `${mapLabel(match.mapName) ?? t.match.unknownMap}, ${formatMatchTime(match.startedAt, locale)}`
  if (state?.phase === 'sending') {
    // Not pressable and not read twice (the feed above the rows is the live region): the row only shows the figure.
    return (
      <span aria-hidden="true" className={cn(ACTION_PLACE, 'flex w-36 flex-col items-start gap-1.5 md:items-end')}>
        <span className="font-mono text-[11px] tracking-[0.06em] uppercase">
          {state.percent === null ? t.matches.bring.fetching : t.matches.bring.sending(state.percent)}
        </span>
        {state.percent !== null && (
          <span className="block h-0.5 w-full bg-border">
            <span className="block h-full bg-foreground" style={{ width: `${state.percent}%` }} />
          </span>
        )}
      </span>
    )
  }
  if (!offersUpload(match, state)) {
    return null
  }
  const limitText =
    limits !== null && limits.demoUploads.remaining <= 0
      ? t.limits.UPLOAD_LIMIT_REACHED(nextPossible(limits.demoUploads.resetsAt, t))
      : null
  return (
    <span className={ACTION_PLACE}>
      {/* Focusable while it is off, so that the sentence is under the pointer and is read: a button that is `disabled`
          lets the pointer through to the row's link, which a click on it would follow. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={limitText ? `${t.matches.bring.rowFor(label)}. ${limitText}` : t.matches.bring.rowFor(label)}
        title={limitText ?? undefined}
        disabled={limitText !== null}
        focusableWhenDisabled
        className="pointer-events-auto bg-background data-disabled:cursor-not-allowed data-disabled:opacity-50"
        onClick={() => {
          if (limitText === null) {
            bringing.pick(match.matchId)
          }
        }}
      >
        <Upload aria-hidden="true" />
        {t.matches.bring.row}
      </Button>
    </span>
  )
}

/**
 * One match: the whole row is the link to the match, so its name is everything the row says. A player's own row may
 * also carry an action beside the link, which is why the row is a box with the link and the action in it, not the link
 * alone.
 */
function MatchRow({
  match,
  bringing,
  stalled,
}: {
  match: PlayerMatchResponse
  bringing: RowBringing | undefined
  stalled: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const onItsWay = isDemoInProgress(match.demoStatus) && !stalled
  const action = bringing !== undefined && hasRowAction(match, bringing.states[match.matchId])
  const resultClass = match.result === 'WIN' ? 'text-positive' : match.result === 'LOSS' ? 'text-negative' : undefined
  const resultWord =
    match.result === 'WIN' ? t.matchList.win : match.result === 'LOSS' ? t.matchList.loss : t.matchList.unknown
  return (
    // A grid of one cell: the link and the action share it, the action over the link's right-hand end.
    <li className="group grid border-b border-border">
      <Link
        to={`/matches/${encodeURIComponent(match.matchId)}`}
        className={cn(
          COLUMNS,
          'col-start-1 row-start-1 min-h-18 -outline-offset-2 group-hover:bg-secondary',
          // Under `md` the link spans the action's row too, with room left under its figures for the action.
          action && 'max-md:row-span-2 max-md:pb-14',
          RESULT_ROW[match.result],
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <MapEmblem mapName={match.mapName} size={44} />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-[15px] leading-5 font-semibold">{mapLabel(match.mapName) ?? t.match.unknownMap}</span>
            <span className="flex items-center gap-2">
              {/* Every match of the list is from FACEIT: the tag is decoration here, not a word in the link's name. */}
              <FaceitTag decorative />
              <time dateTime={match.startedAt} className="font-mono text-[11px] whitespace-nowrap text-subtle">
                {formatMatchTime(match.startedAt, locale)}
              </time>
            </span>
          </span>
        </span>
        <span className="flex flex-col">
          <span className={cn('font-mono text-[19px] leading-[1.3] font-semibold tabular-nums', resultClass)}>
            <span className="sr-only">{t.stats.score}</span> {formatScore(match.score, match.result)}
          </span>
          <span className="text-xs text-muted-foreground">{resultWord}</span>
        </span>
        <span className="flex flex-col">
          <span className="font-mono text-sm">
            <span className="sr-only">{`${t.stats.kills} / ${t.stats.deaths} / ${t.stats.assists}: `}</span>
            <Figure value={match.kills} /> / <Figure value={match.deaths} /> / <Figure value={match.assists} />
          </span>
          <span className="font-mono text-[11px] text-subtle">
            {t.stats.adr} <Figure value={match.adr} digits={1} />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <HighlightsCell match={match} onItsWay={onItsWay} />
        </span>
        <span className="flex items-center justify-end gap-2 text-[13px] text-muted-foreground">
          <ClipsCell clips={match.clips} onItsWay={onItsWay} />
        </span>
        <ChevronRight aria-hidden="true" className="size-4 text-subtle" />
      </Link>
      {bringing && <RowAction match={match} state={bringing.states[match.matchId]} bringing={bringing} />}
    </li>
  )
}

/**
 * A player's matches as a table of rows (spec 3, screen 2): a header of mono labels and a link per match. It is as wide
 * as its six columns need, and scrolls in its box on a phone. The header only names the columns for the eye: each row's
 * name carries the words of what its figures are. With `bringing`, the rows that have no demo carry the action that
 * uploads one.
 */
export default function MatchesTable({
  items,
  bringing,
  stalled,
}: {
  items: PlayerMatchResponse[]
  bringing?: RowBringing
  /** Whether a PARSED row has been so too long to be shown as on its way. */
  stalled?: (match: PlayerMatchResponse) => boolean
}) {
  const t = useT()
  return (
    // Positioned, so that the words only a screen reader hears (absolutely positioned, with the row they are in) are
    // clipped with the row, not left beyond the box where they would widen the page.
    <div className="relative overflow-x-auto">
      <div className="min-w-205">
        <div aria-hidden="true" className={cn(COLUMNS, 'label-mono h-9 border-b border-border')}>
          <span>{t.matches.columns.map}</span>
          <span>{t.matches.columns.score}</span>
          <span>{t.matches.columns.kda}</span>
          <span>{t.matches.columns.highlights}</span>
          <span className="text-right">{t.matches.columns.clips}</span>
          <span />
        </div>
        <ul aria-label={t.matches.title}>
          {items.map((match) => (
            <MatchRow key={match.matchId} match={match} bringing={bringing} stalled={stalled?.(match) ?? false} />
          ))}
        </ul>
      </div>
    </div>
  )
}
