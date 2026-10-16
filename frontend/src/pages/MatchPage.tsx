import type { UseQueryResult } from '@tanstack/react-query'
import { Scissors } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMatchBreakdown } from '@/api/breakdown'
import { useDemo, useMatch, useMatchClips, useMatchHighlights, useMatchStats } from '@/api/queries'
import ClipButton from '@/components/ClipButton'
import ClipList from '@/components/ClipList'
import ClipOrderDialog, { type ClipOrder } from '@/components/ClipOrderDialog'
import DemoPanel from '@/components/DemoPanel'
import HighlightList from '@/components/HighlightList'
import MapEmblem from '@/components/MapEmblem'
import MatchScore from '@/components/MatchScore'
import RecDot from '@/components/RecDot'
import RecorderBanner from '@/components/RecorderBanner'
import RoundStrip from '@/components/RoundStrip'
import SourceTag from '@/components/SourceTag'
import StatsTable from '@/components/StatsTable'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale, useT } from '@/i18n'
import { useAdminKey } from '@/lib/adminKey'
import { clipFor, compilationFor, montageEditorPath } from '@/lib/clips'
import { errorMessage } from '@/lib/errorMessage'
import { formatClock, formatDate, formatMatchDay } from '@/lib/formatDate'
import { hasLost } from '@/lib/hasLost'
import { highlightGroup, highlightLabel, type HighlightGroup } from '@/lib/highlightLabels'
import { mapSceneryUrl } from '@/lib/mapArt'
import { mapLabel } from '@/lib/mapTint'
import { byNumber, startingSides } from '@/lib/matchRounds'
import { cn } from '@/lib/utils'
import { useViewer, useViewerPlayerId } from '@/lib/viewer'
import type { ApiError } from '@/api/client'
import type { MatchResponse, MatchStatsResponse, TeamStatsResponse } from '@/api/types'

/** How long the match took in whole minutes, or null when one of its two times is missing or they make no span. */
function minutesPlayed(match: MatchResponse): number | null {
  if (!match.startedAt || !match.finishedAt) {
    return null
  }
  const span = Date.parse(match.finishedAt) - Date.parse(match.startedAt)
  return span > 0 ? Math.round(span / 60_000) : null
}

/**
 * Whether the visitor's player won or lost the match; null when the player is in neither team, or nobody has won yet.
 */
function resultFor(match: MatchResponse, viewerPlayerId: string | null): 'won' | 'lost' | null {
  if (!viewerPlayerId || !match.winner) {
    return null
  }
  const own = match.teams.find((team) => team.players.some((player) => player.playerId === viewerPlayerId))
  if (!own) {
    return null
  }
  return own.factionId === match.winner ? 'won' : 'lost'
}

/**
 * The way back to the visitor's matches, and where the visitor is: `Matches / Mirage · 10 Oct`. It is there for a
 * visitor who has a player only: nobody else has a list of matches for the first step to lead to.
 */
function Breadcrumb({ viewerPlayerId, match }: { viewerPlayerId: string; match: MatchResponse | undefined }) {
  const t = useT()
  const locale = useLocale()
  return (
    <nav aria-label={t.match.breadcrumb}>
      <ol className="flex min-h-11 items-center gap-2.5 text-sm">
        <li>
          <Link
            to={`/players/${encodeURIComponent(viewerPlayerId)}/matches`}
            className="inline-flex min-h-11 items-center text-muted-foreground hover:text-foreground"
          >
            {t.matches.title}
          </Link>
        </li>
        {match && (
          <li aria-current="page" className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="text-subtle">
              /
            </span>
            <span className="truncate">
              {[mapLabel(match.mapName) ?? t.match.unknownMap, match.startedAt && formatMatchDay(match.startedAt, locale)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        )}
      </ol>
    </nav>
  )
}

interface MatchHeaderProps {
  match: MatchResponse
  /** The stats of the match, once they have arrived: the score, the number of rounds and the rosters of the strip. */
  stats: MatchStatsResponse | undefined
  viewerPlayerId: string | null
}

/**
 * The two scores of the match as the compact header of a phone says them: the visitor's own team first when the
 * visitor played (so that `13:9` in green is a win, `9:13` in red a loss), else in the order of the scoreboard; null
 * unless there are two teams.
 */
function phoneScore(teams: TeamStatsResponse[] | undefined, viewerPlayerId: string | null): string | null {
  if (teams?.length !== 2) {
    return null
  }
  const own = teams.findIndex((team) => team.players.some((player) => player.playerId === viewerPlayerId))
  const [first, second] = own === 1 ? [teams[1], teams[0]] : teams
  return `${first.score}:${second.score}`
}

/** The colour of the compact header's score and its veil on a phone: the visitor's result, or none to say. */
const RESULT_TEXT = { won: 'text-positive', lost: 'text-negative' } as const
const RESULT_VEIL = { won: 'from-positive/14', lost: 'from-negative/14' } as const

/**
 * The panel of the match (spec 4, screen 3): the map with a line of facts under it (where the match is from, when it
 * started, how long it took, how many rounds), the result for the visitor's own player, the two teams with the score
 * and their sides, and the strip of rounds. Every part is left out while nobody knows it: the facts while FACEIT has
 * not published them, the sides and the strip without an analyzed demo (or when its answer fails). The scenery of the
 * map fills the panel behind all of it, under a veil; a map without scenery, or no map, leaves the panel plain.
 *
 * Under `md` the panel is compact (phone spec 5.3): a 44px emblem, the map in 20px, the tag and the day; at the right
 * the score in mono 26px in the colour of the result, with the word of the result under it, on a veil of that colour
 * that fades out downwards. The big score with the teams is left out (the strip under it names the teams); the facts
 * beyond the day too, but the state of a match that is not over.
 */
function MatchHeader({ match, stats, viewerPlayerId }: MatchHeaderProps) {
  const t = useT()
  const locale = useLocale()
  const matchId = match.matchId
  const breakdown = useMatchBreakdown(matchId)
  const highlights = useMatchHighlights(matchId)
  const teams = stats?.teams
  const rounds = byNumber(breakdown.data?.rounds ?? [])
  const minutes = minutesPlayed(match)
  const result = resultFor(match, viewerPlayerId)
  const scenery = mapSceneryUrl(match.mapName)
  const score = phoneScore(teams, viewerPlayerId)
  // Each fact is an element of its own; a match that is over needs no word for it, any other state is said. `phone`:
  // the fact stays on a phone (the day and the state); the others are left out there, with the dot before them.
  const facts: { node: ReactNode; phone: boolean }[] = []
  if (match.startedAt) {
    facts.push({
      phone: true,
      node: (
        <span key="started" className="whitespace-nowrap">
          <time dateTime={match.startedAt}>{formatDate(match.startedAt, locale)}</time>
          <span className="max-md:hidden">{`, ${formatClock(match.startedAt)}`}</span>
        </span>
      ),
    })
  }
  if (minutes !== null) {
    facts.push({
      phone: false,
      node: (
        <span key="minutes" className="whitespace-nowrap max-md:hidden">
          {t.match.minutes(minutes)}
        </span>
      ),
    })
  }
  if (stats && stats.rounds > 0) {
    facts.push({
      phone: false,
      node: (
        <span key="rounds" className="whitespace-nowrap max-md:hidden">
          {t.match.roundCount(stats.rounds)}
        </span>
      ),
    })
  }
  if (match.status && match.status.toUpperCase() !== 'FINISHED') {
    facts.push({
      phone: true,
      node: (
        // Upper case by CSS, so its look does not depend on the case FACEIT sends.
        <span key="status" data-slot="match-status" className="uppercase">
          {match.status}
        </span>
      ),
    })
  }
  return (
    // `isolate`: the scenery lies under the panel's content but over the panel's own colour.
    <Card className="relative isolate py-7 max-md:py-4">
      {scenery && (
        // Decoration: never announced. A wrapper, not the picture itself, is the panel's first child (the Card drops
        // its top padding for a picture that is).
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          {/* On a phone the picture is a band at the top of the panel, behind the map's title. */}
          <img
            src={scenery}
            alt=""
            decoding="async"
            className="h-28 w-full object-cover object-[50%_35%] sm:h-full"
          />
          <div className="scenery-veil-panel absolute inset-0" />
        </div>
      )}
      {result && (
        // On a phone, the colour of the result from the top of the panel, fading out over the scenery's veil.
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 -z-10 bg-linear-to-b to-transparent to-70% md:hidden',
            RESULT_VEIL[result],
          )}
        />
      )}
      <CardContent className="flex flex-col gap-6 px-[clamp(16px,3vw,32px)] max-md:gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 max-md:flex-nowrap max-md:gap-x-3">
          <div className="flex min-w-0 items-center gap-4 max-md:gap-3">
            <MapEmblem mapName={match.mapName} size={64} className="max-md:size-11" />
            <div className="flex min-w-0 flex-col gap-1.5 max-md:gap-1">
              <CardTitle className="truncate text-[26px] leading-[1.2] tracking-[-0.02em] max-md:text-[20px] max-md:font-bold">
                {mapLabel(match.mapName) ?? t.match.unknownMap}
              </CardTitle>
              {/* The tag and the facts read as one line, `FACEIT · 10 Oct 2026, 21:40 · 47 minutes`: the tag's own
                  box separates it for the eye, so the dot after it is only heard. */}
              {/* From `sm` up the line stands where the scenery shows (on a phone the veil is closed here): its small
                  grey text has a scrim of its own. */}
              <p className="sm:scenery-scrim flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-subtle">
                <SourceTag matchId={matchId} />
                {facts.length > 0 && (
                  <span>
                    <span className="sr-only"> · </span>
                    {facts.map((fact, index) => (
                      <Fragment key={index}>
                        {/* The dot before a fact goes with it; on a phone also the one before the first fact shown. */}
                        {index > 0 && (
                          <span
                            className={cn(
                              (!fact.phone || !facts.slice(0, index).some((before) => before.phone)) &&
                                'max-md:hidden',
                            )}
                          >
                            {' · '}
                          </span>
                        )}
                        {fact.node}
                      </Fragment>
                    ))}
                  </span>
                )}
              </p>
            </div>
          </div>
          {/* The result at the right: on a phone the score above the word of the result. From `md` the box is none of
              its own (`contents`), the score is not there, and the word is the row's own item, as it always was. */}
          {(result || score) && (
            <div className="contents max-md:flex max-md:shrink-0 max-md:flex-col max-md:items-end max-md:gap-1.5">
              {score && (
                <p
                  className={cn(
                    'font-mono text-[26px] leading-none font-semibold tracking-[-0.02em] tabular-nums md:hidden',
                    result ? RESULT_TEXT[result] : 'text-foreground',
                  )}
                >
                  <span className="sr-only">{t.stats.score} </span>
                  {score}
                </p>
              )}
              {result && (
                // Always a word, never the colour alone (spec 3, the result mark). It stands where the scenery shows
                // most, so its outline has a dark fill.
                <Badge
                  variant={result === 'won' ? 'positive' : 'negative'}
                  className="h-6.5 rounded-none bg-card/92 px-2.5 tracking-[0.08em] max-md:h-5.5 max-md:px-1.5 max-md:text-[10px]"
                >
                  {result === 'won' ? t.matchList.win : t.matchList.loss}
                </Badge>
              )}
            </div>
          )}
        </div>
        {(teams?.length === 2 || rounds.length > 0) && (
          // The centre block: the teams with the score (drawn for two teams) and the strip of rounds, on a scrim that
          // fades out around them. From `xl` it spans the panel, so its scrim lets go well before the panel's edges (12%
          // of its width), which keep the picture; the names, which can run out to those edges, have a scrim of their own
          // (`MatchScore`). Under `xl` the panel is narrow: the strip is as wide as the box or wider and scrolls in it, so
          // a round number can stand at the box's end, where a share of the width would have the scrim gone. The scrim
          // is at full strength all the way to the block's own edges there, and fades only beyond them (1.5rem).
          // On a phone the score with the teams is left out (the header's right end has the score): without a strip
          // of rounds the block is empty there, and left out as well.
          <div
            className={cn(
              'scenery-scrim flex flex-col gap-6 [--scrim-fade-x:1.5rem] [--scrim-fade-y:2.5rem] [--scrim-strength:55%] xl:[--scrim-fade-x:12%]',
              rounds.length === 0 && 'max-md:hidden',
            )}
          >
            {teams && (
              <div className="contents max-md:hidden">
                <MatchScore teams={teams} sides={startingSides(rounds, teams)} />
              </div>
            )}
            {rounds.length > 0 && (
              <RoundStrip
                rounds={rounds}
                teams={teams}
                highlightRounds={new Set((highlights.data ?? []).map((highlight) => highlight.roundNumber))}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function subscribeToHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/**
 * The sections of the page as a row of tabs (spec 3, tabs): each is a link to its section, the highlights and the
 * clips with how many there are. The one the address points at is marked, the first one when it points at none. A
 * match without clips has no clips section, so it has no such tab either.
 *
 * Under `md` (phone spec 5.3) the tabs are equal columns 48px tall that stick under the top bar (`--top-bar-h`), on the
 * page's ground and from edge to edge of the screen, under the top bar's layer; `index.css` keeps a section the tabs
 * lead to clear of both (`scroll-padding-top`).
 */
function SectionTabs({ matchId }: { matchId: string }) {
  const t = useT()
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash)
  const highlights = useMatchHighlights(matchId).data
  const clips = useMatchClips(matchId).data
  const tabs: { id: string; label: string; count?: number }[] = [
    { id: 'highlights', label: t.highlight.title, count: highlights?.length },
    { id: 'scoreboard', label: t.match.scoreboard },
  ]
  if (clips && clips.length > 0) {
    tabs.push({ id: 'clips', label: t.clip.listTitle, count: clips.length })
  }
  const current = tabs.find((tab) => hash === `#${tab.id}`) ?? tabs[0]
  return (
    <nav
      aria-label={t.match.sections}
      className="flex flex-wrap gap-1 border-b border-border max-md:sticky max-md:top-[var(--top-bar-h)] max-md:z-30 max-md:-mx-(--page-gutter) max-md:grid max-md:auto-cols-fr max-md:grid-flow-col max-md:gap-0 max-md:bg-background max-md:px-(--page-gutter)"
    >
      {tabs.map((tab) => (
        // A plain link, not the router's: the browser itself scrolls to the section and moves the focus there.
        <a
          key={tab.id}
          href={`#${tab.id}`}
          aria-current={tab === current ? 'location' : undefined}
          className="inline-flex min-h-11 items-center gap-2 px-3.5 text-sm font-medium text-muted-foreground -outline-offset-2 hover:text-foreground aria-[current=location]:text-foreground aria-[current=location]:shadow-[inset_0_-2px_0_var(--foreground)] max-md:min-h-12 max-md:min-w-0 max-md:justify-center max-md:gap-1.5 max-md:px-1 max-md:whitespace-nowrap"
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="font-mono text-xs font-normal text-subtle tabular-nums">{tab.count}</span>
          )}
        </a>
      ))}
    </nav>
  )
}

type HighlightFilter = 'all' | 'mine' | HighlightGroup

/**
 * Whose clips the visitor has a way to order, so that the page offers only orders that can be made: with the admin
 * key on the page, anybody's; signed in without it, what the session allows (a player's own, an administrator's
 * anybody's); not signed in, anybody's as before, since the order dialog is where that visitor is invited to sign in
 * or to type the key. `known` is false until it is known who is signed in: what depends on it waits.
 */
function useOrderAccess() {
  const viewer = useViewer()
  const adminKey = useAdminKey()
  const byKey = adminKey !== null
  return {
    known: byKey || !viewer.loading,
    /** A signed-in player without the key: the only clips to order are the player's own. */
    ownOnly: !byKey && viewer.signedIn && !viewer.admin,
    mayOrderFor: (playerId: string) => byKey || !viewer.signedIn || viewer.canOrderFor(playerId).allowed,
  }
}

/** How many highlights the list shows before "show more" is asked for. */
const VISIBLE_HIGHLIGHTS = 6

interface MatchHighlightsProps {
  matchId: string
  viewerPlayerId: string | null
  onOrder: (order: ClipOrder) => void
  /** What closes the section, under the list: the compilation panel. */
  children?: ReactNode
}

/**
 * The highlights of the match with a filter by kind above them, and the visitor's own when there are any. The filter
 * works on what is already loaded; each button carries the number of highlights it would show. The list shows the
 * first six, and a button under it the rest. Every card ends with what can be done about the clip of its highlight:
 * any highlight can be recorded, of whatever kind, by whoever has a way to order it (see {@link useOrderAccess}); a
 * signed-in visitor is not offered the clips of other players' highlights. A failure stays inside the section.
 */
function MatchHighlights({ matchId, viewerPlayerId, onOrder, children }: MatchHighlightsProps) {
  const t = useT()
  const highlights = useMatchHighlights(matchId)
  const clips = useMatchClips(matchId)
  const orders = useOrderAccess()
  const [filter, setFilter] = useState<HighlightFilter>('all')
  const [expanded, setExpanded] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const items = highlights.data
  const matchClips = clips.data
  const labels: Record<HighlightFilter, string> = {
    all: t.highlight.groupAll,
    mine: t.highlight.groupMine,
    multi: t.highlight.groupMulti,
    clutch: t.highlight.groupClutch,
    special: t.highlight.groupSpecial,
  }
  const matching = (kind: HighlightFilter) =>
    (items ?? []).filter((highlight) =>
      kind === 'all'
        ? true
        : kind === 'mine'
          ? highlight.playerId === viewerPlayerId
          : highlightGroup(highlight.type) === kind,
    )
  // "Mine" is offered only to a visitor whose player has a highlight in this match.
  const filters: HighlightFilter[] =
    viewerPlayerId && matching('mine').length > 0
      ? ['all', 'mine', 'multi', 'clutch', 'special']
      : ['all', 'multi', 'clutch', 'special']
  const filtered = matching(filter)
  const shown = expanded ? filtered : filtered.slice(0, VISIBLE_HIGHLIGHTS)
  const hidden = filtered.length - shown.length
  // The button that revealed the rest is gone with the click: the focus goes on to the first card it revealed.
  useEffect(() => {
    if (expanded) {
      listRef.current
        ?.querySelectorAll('ul > li')
        [VISIBLE_HIGHLIGHTS]?.querySelector<HTMLElement>('a, button')
        ?.focus()
    }
  }, [expanded])
  return (
    <section id="highlights" className="flex scroll-mt-4 flex-col gap-5 max-md:scroll-mt-0">
      {/* The tab above already says "Highlights" to the eye; the section keeps its heading for the outline. */}
      <h2 className="sr-only">{t.highlight.title}</h2>
      {items && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div role="group" aria-label={t.highlight.filterLabel} className="flex flex-wrap gap-2">
            {filters.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={filter === kind}
                onClick={() => setFilter(kind)}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong px-3.5 text-sm font-medium text-foreground transition-colors aria-[pressed=false]:hover:bg-secondary aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:font-semibold aria-pressed:text-background"
              >
                {labels[kind]}
                <span className={cn('font-mono text-xs tabular-nums', filter !== kind && 'text-subtle')}>
                  {matching(kind).length}
                </span>
              </button>
            ))}
          </div>
          <RecorderBanner />
        </div>
      )}
      <div ref={listRef} aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {highlights.isPending && (
          <>
            <p className="label-mono">{t.highlight.loading}</p>
            <Skeleton className="h-40 w-full" />
          </>
        )}
        {items && (
          <HighlightList
            items={shown}
            showMatch={false}
            // Until the clips of the match are known, a card cannot say whether its highlight has one, and until it is
            // known who is signed in, whether its clip can be ordered. While either is on its way the row is kept
            // free, so that the cards do not grow under the reader when they arrive. A card with nothing to offer
            // keeps the row as well: the cards of a row of the grid stay alike.
            action={
              matchClips && orders.known
                ? (highlight) => (
                    <ClipButton
                      clip={clipFor(highlight, matchClips)}
                      canOrder={orders.mayOrderFor(highlight.playerId)}
                      onOrder={() => onOrder({ kind: 'highlight', highlight })}
                      subject={[
                        highlightLabel(highlight.type, t),
                        highlight.nickname,
                        t.highlight.round(highlight.roundNumber),
                      ].join(' · ')}
                    />
                  )
                : clips.isPending || (matchClips && !orders.known)
                  ? () => <span aria-hidden="true" />
                  : undefined
            }
          />
        )}
        {highlights.isError && !items && (
          <p className="text-sm text-destructive">{errorMessage(highlights.error, t)}</p>
        )}
        {items && items.length > 0 && clips.isError && !matchClips && (
          <p className="text-sm text-destructive">{errorMessage(clips.error, t)}</p>
        )}
      </div>
      {hidden > 0 && (
        <Button type="button" variant="outline" className="self-center" onClick={() => setExpanded(true)}>
          {t.highlight.showMore(hidden)}
        </Button>
      )}
      {children}
    </section>
  )
}

interface CompilationProps {
  matchId: string
  mapName: string | null
  /** The teams of the scoreboard, once the stats have arrived. */
  teams: TeamStatsResponse[] | undefined
  onOrder: (order: ClipOrder) => void
}

/**
 * One video of every kill of a player in the match (spec 4, the compilation panel). It is cut from the kills of the
 * demo, so the panel is there once the demo has been parsed. The players to choose from are those of the scoreboard
 * and, after them, players the highlights name that the scoreboard does not (a player the backend knows only from
 * the demo); of those, only the players the visitor has a way to order for (see {@link useOrderAccess}): a signed-in
 * player's own, already chosen, and without any there is no panel. Beside the chosen player stands the state of that
 * player's compilation, as on a highlight card.
 */
function Compilation({ matchId, mapName, teams, onOrder }: CompilationProps) {
  const t = useT()
  const playerFieldId = useId()
  const demo = useDemo(matchId)
  const highlights = useMatchHighlights(matchId)
  const clips = useMatchClips(matchId)
  const orders = useOrderAccess()
  const [chosenId, setChosenId] = useState('')
  const scenery = mapSceneryUrl(mapName)
  const status = demo.data?.status
  const players = [...(teams ?? []).flatMap((team) => team.players), ...(highlights.data ?? [])]
    .map(({ playerId, nickname }) => ({ playerId, nickname }))
    .filter((player, index, all) => all.findIndex((other) => other.playerId === player.playerId) === index)
    // Only the players the visitor has a way to order for: a signed-in player's own, anybody's for the others.
    .filter((player) => orders.mayOrderFor(player.playerId))
  const matchClips = clips.data
  if ((status !== 'PARSED' && status !== 'ANALYZED') || players.length === 0 || !matchClips || !orders.known) {
    return null
  }
  // A signed-in player has one player to choose, so it is chosen already.
  const preselected = orders.ownOnly ? players[0].playerId : ''
  const selectedId = chosenId || preselected
  const chosen = players.find((player) => player.playerId === selectedId)
  const record = t.clip.compilationPanel.record
  // Over a picture an outline is filled, so that its inside is not the picture.
  const fill = scenery ? 'bg-card/92' : undefined
  return (
    // `isolate`: the scenery lies under the panel's content but over the panel's own colour.
    <section className="relative isolate flex flex-wrap items-end gap-x-8 gap-y-4 border border-border bg-card px-6 py-5.5">
      {scenery && (
        // Decoration: never announced. On a phone the picture is a band at the top of the panel, behind the title, and
        // the veil closes under it (`scenery-veil-panel`), as in the panel of the match.
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <img
            src={scenery}
            alt=""
            decoding="async"
            loading="lazy"
            className="h-28 w-full object-cover object-[50%_35%] sm:h-full"
          />
          <div className="scenery-veil-panel absolute inset-0" />
        </div>
      )}
      <div className="flex min-w-0 flex-[999_1_24rem] flex-col gap-1">
        <h2 className="text-[17px] leading-[1.4] font-semibold">{t.clip.compilation}</h2>
        <p className="text-sm text-muted-foreground">{t.clip.compilationPanel.text}</p>
      </div>
      {/* The controls stand where the picture shows most: on a scrim of the panel's colour. */}
      <div className="scenery-scrim flex min-w-0 flex-wrap items-end gap-3 [--scrim-bleed-x:0.75rem] [--scrim-fade-x:0.75rem]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={playerFieldId} className="label-mono">
            {t.clip.compilationPanel.playerLabel}
          </label>
          <select
            id={playerFieldId}
            value={selectedId}
            onChange={(event) => setChosenId(event.target.value)}
            className={cn(
              'h-11 max-w-full min-w-48 rounded-lg border border-border bg-card px-3 text-base text-foreground',
              fill,
            )}
          >
            {!preselected && <option value="">{t.clip.compilationPanel.choosePlayer}</option>}
            {players.map((player) => (
              <option key={player.playerId} value={player.playerId}>
                {player.nickname}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-3">
          {chosen ? (
            <ClipButton
              clip={compilationFor(chosen.playerId, matchClips)}
              label={record}
              variant="outline"
              className={fill}
              onOrder={() => onOrder({ kind: 'compilation', matchId, mapName, ...chosen })}
            />
          ) : (
            // Nothing to record until a player is chosen: the button is there to say what the panel is for.
            <Button type="button" variant="outline" disabled className={fill}>
              <RecDot />
              {record}
            </Button>
          )}
          {/* The second way: the player's own cut of the kills, in the montage editor. A link once a player is chosen;
              until then a button that is off, since a link cannot be. */}
          {chosen ? (
            <Link
              to={montageEditorPath(matchId, chosen.playerId)}
              className={cn(buttonVariants({ variant: 'outline' }), fill)}
            >
              <Scissors aria-hidden="true" />
              {t.lively.buildMontage}
            </Link>
          ) : (
            <Button type="button" variant="outline" disabled className={fill}>
              <Scissors aria-hidden="true" />
              {t.lively.buildMontage}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}

/**
 * The clips of the match, in whatever state, newest first. A match without clips has no such section: the way to the
 * first clip is the button on a highlight.
 */
function MatchClips({ matchId }: { matchId: string }) {
  const t = useT()
  const clips = useMatchClips(matchId)
  if (!clips.data || clips.data.length === 0) {
    return null
  }
  return (
    <section id="clips" className="flex scroll-mt-4 flex-col gap-4 pt-5 max-md:scroll-mt-0">
      <h2 className="heading-section">{t.clip.listTitle}</h2>
      <ClipList items={clips.data} />
    </section>
  )
}

/** Two outlined boxes where the scoreboards will be, with the loading text as a label above them (spec 7). */
function StatsSkeleton() {
  const t = useT()
  return (
    <div className="flex flex-col gap-2">
      <p className="label-mono">{t.match.loadingStats}</p>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

interface MatchStatsProps {
  matchId: string
  stats: UseQueryResult<MatchStatsResponse, ApiError>
  viewerPlayerId: string | null
}

/**
 * One table per team, or the reason there is none. Stats that are already loaded win over a failed refetch. The
 * tables take the sides of the teams and the figures of the demo analysis from the breakdown of the match; while it
 * has none of them for a player of these teams (no analyzed demo, unlinked players, a failed answer) the tables keep
 * to the columns of the match stats.
 */
function MatchStats({ matchId, stats, viewerPlayerId }: MatchStatsProps) {
  const t = useT()
  const breakdown = useMatchBreakdown(matchId).data
  if (stats.data) {
    const teams = stats.data.teams
    if (teams.length === 0) {
      return <p className="text-sm text-muted-foreground">{t.match.statsUnavailable}</p>
    }
    const sides = startingSides(byNumber(breakdown?.rounds ?? []), teams)
    const figures = new Map((breakdown?.players ?? []).map((player) => [player.playerId, player]))
    // Both tables get the columns or neither does, so that the two stay aligned.
    const analysis = teams.some((team) => team.players.some((player) => figures.has(player.playerId)))
      ? figures
      : undefined
    return teams.map((team, index) => (
      <StatsTable
        key={team.teamId}
        team={team}
        lost={hasLost(team, teams)}
        startSide={sides?.[index]}
        analysis={analysis}
        viewerPlayerId={viewerPlayerId}
      />
    ))
  }
  if (stats.isError) {
    // The backend answers 404 for the stats of a match that is still being played; the match itself exists.
    return (
      <p className="text-sm text-muted-foreground">
        {stats.error.code === 'MATCH_NOT_FOUND' ? t.match.statsUnavailable : errorMessage(stats.error, t)}
      </p>
    )
  }
  return <StatsSkeleton />
}

function MatchDetails({ matchId, viewerPlayerId }: { matchId: string; viewerPlayerId: string | null }) {
  const t = useT()
  const match = useMatch(matchId)
  const stats = useMatchStats(matchId)
  // What is being ordered, a highlight's clip or a compilation; the one dialog of the page is open while there is one.
  const [order, setOrder] = useState<ClipOrder | null>(null)
  // A match that cannot be shown has no stats to show either: its error is the one message on the page.
  const matchFailed = match.isError && !match.data

  return (
    // 28px between the parts of the page, as the design draws them (spec 2.3: 24–36px between sections); the
    // scoreboard and the clips, which start with a heading of their own, keep 20px more above them.
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        {viewerPlayerId && <Breadcrumb viewerPlayerId={viewerPlayerId} match={match.data} />}
        <div aria-live="polite">
          {match.isPending && (
            <>
              <p className="label-mono mb-2">{t.match.loading}</p>
              <Skeleton className="h-24 w-full" />
            </>
          )}
          {matchFailed && <p className="text-sm text-destructive">{errorMessage(match.error, t)}</p>}
          {match.data && <MatchHeader match={match.data} stats={stats.data} viewerPlayerId={viewerPlayerId} />}
        </div>
      </div>
      {/* The demo and what was found in it belong to a match that exists: they wait for the header. */}
      {match.data && <DemoPanel matchId={matchId} match={match.data} />}
      {match.data && <SectionTabs matchId={matchId} />}
      {match.data && (
        <MatchHighlights matchId={matchId} viewerPlayerId={viewerPlayerId} onOrder={setOrder}>
          <Compilation matchId={matchId} mapName={match.data.mapName} teams={stats.data?.teams} onOrder={setOrder} />
        </MatchHighlights>
      )}
      {!matchFailed && (
        // The tables follow the header, so a match that then turns out to be missing never flashes them.
        <section id="scoreboard" className="flex scroll-mt-4 flex-col gap-4 pt-5 max-md:scroll-mt-0">
          <h2 className="heading-section">{t.match.scoreboard}</h2>
          <div aria-live="polite" className="flex flex-col gap-6">
            {match.data ? (
              <MatchStats matchId={matchId} stats={stats} viewerPlayerId={viewerPlayerId} />
            ) : (
              <StatsSkeleton />
            )}
          </div>
        </section>
      )}
      {match.data && <MatchClips matchId={matchId} />}
      <ClipOrderDialog order={order} onClose={() => setOrder(null)} />
    </div>
  )
}

export default function MatchPage() {
  const t = useT()
  const { matchId } = useParams()
  const viewerPlayerId = useViewerPlayerId()
  return (
    // The breadcrumb, where there is one, starts 20px under the top bar, as the design draws it; without it the panel
    // keeps the 36px every page starts at.
    <main className={cn('container-page flex flex-col gap-4 pb-18', matchId && viewerPlayerId ? 'pt-5' : 'pt-9')}>
      {/* The map name in the header is the page's big title, so the h1 only names the page: to a screen reader when
          the header is there, as a small label above the one message when there is no match to ask for. */}
      <h1 className={matchId ? 'sr-only' : 'label-mono'}>{t.match.title}</h1>
      {matchId ? (
        // Keyed by the match: what the panel, the filter and the clip order remember (a chosen file, a typed key, a
        // message, the chosen kind, an open dialog) must not follow the visitor to another match when only the id in
        // the URL changes.
        <MatchDetails key={matchId} matchId={matchId} viewerPlayerId={viewerPlayerId} />
      ) : (
        <p className="text-sm text-destructive">{t.errors.matchNotFound}</p>
      )}
    </main>
  )
}
