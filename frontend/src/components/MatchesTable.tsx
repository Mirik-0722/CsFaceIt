import { ChevronRight, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import DemoStages from '@/components/DemoStages'
import HighlightTag from '@/components/HighlightTag'
import MapEmblem from '@/components/MapEmblem'
import PhoneHighlightTags from '@/components/PhoneHighlightTags'
import SourceTag from '@/components/SourceTag'
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
import { RESULT_ROW } from '@/lib/resultRow'

// The columns of the header and of every row: the map with where the match is from and its date, the score, K / D / A,
// the highlights (the one that takes what is left), the clips and the arrow. The first one holds the emblem and, on one
// line, the FACEIT tag and the date; the number columns are as wide as their figures need, so that the highlights keep
// their room. The row starts 14px in: 3px of it is the bar of the result.
const COLUMNS = 'grid grid-cols-[220px_100px_104px_minmax(0,1fr)_160px_16px] items-center gap-4 pr-1 pl-3.5'

// Under `md` a row is two lines instead of the columns (spec of the phone view, 4), 12px from its top and bottom and the
// page's gutter from its sides: the map with its tag and date and, at the right, the score with the word of the result;
// then, from under the map's name (40px of emblem and 12px of gap), the second line (`PHONE_SECOND_LINE`). The list
// reaches the edges of the screen there and the row pads itself back by the gutter, so that its content starts where
// the page's text does and the 3px bar of the result is at the screen's edge.
const PHONE_ROW =
  'max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-2 max-md:px-(--page-gutter) max-md:py-3'

// The second line of a phone's row, which never wraps (plan 8's ruling): K / D / A, whole; ADR, only when nothing stands
// at the right end; the tags in the room that is left (`PhoneHighlightTags`: at most two beside something at the right
// end, three otherwise, and only those that fit in whole); and at the right end, whole, what the clips are at with the
// stages of a demo on its way, or the row's action. From `md` the box is not there (`contents`): its cells are the
// table's columns, as they were.
const PHONE_SECOND_LINE = 'contents max-md:col-span-2 max-md:flex max-md:min-w-0 max-md:items-center max-md:gap-3 max-md:pl-13'

interface MatchMapCellProps {
  /** The match: its id says where it is from, which the tag beside the date shows. */
  matchId: string
  mapName: string | null
  /** The name to show: the map's, "Unknown map", or nothing while the map is still being asked for. */
  name: ReactNode
  /** When the match started, as the row writes it. */
  date: ReactNode
  startedAt: string
}

/**
 * The first cell of a row of matches: the map's 44px emblem, its name, and under it on one line the tag of where the
 * match is from (`FACEIT` or `CS2 MM`) with the date. The tag is decoration here, not a word of the link's name: it
 * would be heard once per row. The rows of the profile's history use it too.
 */
export function MatchMapCell({ matchId, mapName, name, date, startedAt }: MatchMapCellProps) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      {/* 40px on a phone, where the second line of the row starts under the name, 52px in. */}
      <MapEmblem mapName={mapName} size={44} className="max-md:size-10" />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="min-h-5 truncate text-[15px] leading-5 font-semibold">{name}</span>
        <span className="flex items-center gap-2">
          <SourceTag matchId={matchId} decorative />
          <time dateTime={startedAt} className="font-mono text-[11px] whitespace-nowrap text-subtle">
            {date}
          </time>
        </span>
      </span>
    </span>
  )
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

// Where the action stands in the row's grid (the link takes the one cell). From `md` up it is over the right-hand end of
// the row, where the clips column is, held 36px inside the right edge of what is on screen. Under `md` it is at the right
// end of the row's second line, inside the row's 12px and gutter, over the room that the link keeps free for it there
// (see `actionRoom`). The wrapper lets the pointer through to the row's link everywhere but on the button itself.
const ACTION_PLACE =
  'pointer-events-none sticky z-10 col-start-1 row-start-1 max-md:mr-(--page-gutter) max-md:mb-3 max-md:self-end max-md:justify-self-end md:right-9 md:self-center md:justify-self-end'

/**
 * The room the link keeps free at the right end of a phone's second line for the action over it: the width of the
 * figure of a file that is going (112px), or the width and height of the "Demo" button (84px by 36px). The figure and the
 * button are that wide on a phone whatever the language, so that the room always fits them.
 */
function actionRoom(state: Bringing | undefined): string {
  return state?.phase === 'sending' ? 'max-md:min-w-28' : 'max-md:min-h-9 max-md:min-w-21'
}

/**
 * The strongest highlight of the match as a tag (only an ace is filled) and the others as a line of text. Without an
 * analyzed demo there is nothing to show: a match that has no demo, or whose demo failed, says that it has none, one
 * that is on its way shows the stages it has been through. On a phone the row has its own tags instead
 * (`PhoneHighlightTags`, at most `tagLimit`), the stages are at the right end of its line (see `MatchRow`), and a row
 * whose action is beside it (`withAction`) leaves the words "No demo" to the screen reader: its "Demo" button says it.
 */
function HighlightsCell({
  match,
  onItsWay,
  withAction,
  tagLimit,
}: {
  match: PlayerMatchResponse
  onItsWay: boolean
  withAction: boolean
  tagLimit: number
}) {
  const t = useT()
  if (match.demoStatus === null || match.demoStatus === 'FAILED') {
    return (
      <span className={cn('font-mono text-xs text-subtle max-md:truncate', withAction && 'max-md:sr-only')}>
        {t.demo.none}
      </span>
    )
  }
  // A demo on its way: where it has got to, as the line of its stages (the same as the demo panel of the match shows).
  // One that has stayed PARSED too long is not counted as on its way and gets the dash below.
  if (onItsWay) {
    return <DemoStages demo={{ status: match.demoStatus, error: null, errorCode: null }} compact className="max-md:hidden" />
  }
  const { top, rest } = summarizeHighlights(match.highlights, t)
  if (match.demoStatus !== 'ANALYZED' || !top) {
    // On a phone a missing part of the second line is not drawn at all (no dash), but still heard.
    return (
      <span className="font-mono text-xs text-muted-foreground max-md:sr-only">
        <span aria-hidden="true">—</span>
        {match.demoStatus === 'ANALYZED' && <span className="sr-only">{t.matches.highlights.none}</span>}
      </span>
    )
  }
  // A phone's row has its own small tags and the count of the others instead: the table's tag and line are not drawn
  // there.
  return (
    <>
      {/* Written as it is shown, as on the highlight cards, in the colour of its family. */}
      <HighlightTag type={top.type} className="max-md:hidden">
        {kindText(top, t)}
      </HighlightTag>
      {rest && (
        // Two lines at most, so that the count of the kinds left out (`+3`) is not cut off with the rest of the text.
        <span title={rest} className="line-clamp-2 min-w-0 font-mono text-xs text-muted-foreground max-md:hidden">
          {rest}
        </span>
      )}
      <PhoneHighlightTags highlights={match.highlights} limit={tagLimit} />
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
    // On a phone in the colour of a finished clip (spec of the phone view, 4).
    return <span className="max-md:text-positive">{t.matches.clips.readyAlone(clips.done)}</span>
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
 * at the right end of the second line (see `ACTION_PLACE`), where the button is 36px tall and says only "Demo" (its
 * name is the same). A used-up day's limit turns the button off and says when it frees up.
 */
function RowAction({ match, state, bringing }: { match: PlayerMatchResponse; state: Bringing | undefined; bringing: RowBringing }) {
  const t = useT()
  const locale = useLocale()
  const { limits } = useViewer()
  const label = `${mapLabel(match.mapName) ?? t.match.unknownMap}, ${formatMatchTime(match.startedAt, locale)}`
  if (state?.phase === 'sending') {
    // Not pressable and not read twice (the feed above the rows is the live region): the row only shows the figure.
    return (
      <span aria-hidden="true" className={cn(ACTION_PLACE, 'flex w-36 flex-col items-end gap-1.5 max-md:w-28')}>
        {/* One line on a phone: "YUKLANMOQDA 100%" is a few pixels wider than its 112px, which the 12px gap beside the
            room takes. */}
        <span className="font-mono text-[11px] tracking-[0.06em] uppercase max-md:whitespace-nowrap">
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
        // On a phone 36px to the eye and 84px wide (the room the row keeps for it), with 4px above and below it that
        // still press it, so that the finger has 44px.
        className="pointer-events-auto bg-background data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-background max-md:relative max-md:h-9 max-md:w-21 max-md:px-3 max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-1"
        onClick={() => {
          if (limitText === null) {
            bringing.pick(match.matchId)
          }
        }}
      >
        <Upload aria-hidden="true" />
        <span className="max-md:hidden">{t.matches.bring.row}</span>
        <span className="md:hidden">{t.matches.bring.rowShort}</span>
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
  const state = bringing?.states[match.matchId]
  const action = bringing !== undefined && hasRowAction(match, state)
  // A phone's second line leaves out what is not known (no dashes), but a screen reader still hears it as "no data".
  const noKda = match.kills === null || match.deaths === null || match.assists === null
  // What stands at the right end of a phone's second line, whole: the row's action, or what the clips are at, with the
  // stages of a demo on its way. Beside it the line has no ADR and at most two tags.
  const atRight = action || match.clips.active > 0 || match.clips.done > 0 || onItsWay
  // Whether the second line shows anything on a phone; without anything it is only heard, and takes no room.
  const lineTwo =
    !noKda ||
    atRight ||
    (match.demoStatus === 'ANALYZED' && match.highlights.some((kind) => kind.count > 0)) ||
    ((match.demoStatus === null || match.demoStatus === 'FAILED') && !action)
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
          PHONE_ROW,
          'col-start-1 row-start-1 min-h-18 -outline-offset-2 group-hover:bg-secondary',
          RESULT_ROW[match.result],
        )}
      >
        <MatchMapCell
          matchId={match.matchId}
          mapName={match.mapName}
          name={mapLabel(match.mapName) ?? t.match.unknownMap}
          date={formatMatchTime(match.startedAt, locale)}
          startedAt={match.startedAt}
        />
        <span className="flex flex-col max-md:items-end">
          <span className={cn('font-mono text-[19px] leading-[1.3] font-semibold tabular-nums', resultClass)}>
            <span className="sr-only">{t.stats.score}</span> {formatScore(match.score, match.result)}
          </span>
          <span className="text-xs text-muted-foreground max-md:text-[11px]">{resultWord}</span>
        </span>
        <span className={cn(PHONE_SECOND_LINE, !lineTwo && 'max-md:sr-only')}>
          <span
            className={cn(
              'flex flex-col max-md:shrink-0 max-md:flex-row max-md:items-baseline max-md:gap-x-2 max-md:whitespace-nowrap',
              noKda && 'max-md:sr-only',
            )}
          >
            <span className="font-mono text-sm max-md:text-[13px] max-md:font-medium">
              <span className="sr-only">{`${t.stats.kills} / ${t.stats.deaths} / ${t.stats.assists}: `}</span>
              <Figure value={match.kills} /> / <Figure value={match.deaths} /> / <Figure value={match.assists} />
            </span>
            <span className={cn('font-mono text-[11px] text-subtle', (match.adr === null || atRight) && 'max-md:sr-only')}>
              {t.stats.adr} <Figure value={match.adr} digits={1} />
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-2 max-md:flex-1">
            <HighlightsCell match={match} onItsWay={onItsWay} withAction={action} tagLimit={atRight ? 2 : 3} />
          </span>
          <span
            className={cn(
              'flex items-center justify-end gap-2 text-[13px] text-muted-foreground max-md:shrink-0 max-md:flex-col max-md:items-end max-md:justify-center max-md:gap-1.5 max-md:whitespace-nowrap',
              // Without anything in it, it takes no room on a phone (not even the gap beside it).
              action ? actionRoom(state) : 'max-md:empty:hidden',
            )}
          >
            <ClipsCell clips={match.clips} onItsWay={onItsWay} />
            {/* On a phone the stages of a demo on its way are here, under the status, where the table has them in the
                highlights column. */}
            {onItsWay && match.demoStatus !== null && (
              <DemoStages demo={{ status: match.demoStatus, error: null, errorCode: null }} compact className="md:hidden" />
            )}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 text-subtle max-md:hidden" />
      </Link>
      {bringing && <RowAction match={match} state={state} bringing={bringing} />}
    </li>
  )
}

/**
 * A player's matches as a table of rows (spec 3, screen 2): a header of mono labels and a link per match. It is as wide
 * as its six columns need, and scrolls in its box between `md` and that width; on a phone each row is two lines and the
 * header is not there (spec of the phone view, 4). The header only names the columns for the eye: each row's name
 * carries the words of what its figures are. With `bringing`, the rows that have no demo carry the action that uploads
 * one.
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
    // On a phone it reaches the edges of the screen (see `PHONE_ROW`).
    <div className="relative overflow-x-auto max-md:-mx-(--page-gutter)">
      <div className="min-w-205 max-md:min-w-0">
        <div aria-hidden="true" className={cn(COLUMNS, 'label-mono h-9 border-b border-border max-md:hidden')}>
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
