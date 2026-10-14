import { Link } from 'react-router-dom'
import TeamSides from '@/components/TeamSides'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useT } from '@/i18n'
import { playerPath } from '@/lib/matchSource'
import { cn } from '@/lib/utils'
import type { BreakdownPlayer, RoundSide } from '@/api/breakdownTypes'
import type { TeamStatsResponse } from '@/api/types'

// The player and the six figures of the match stats; the four of the demo analysis come after them when there are any.
const STATS_COLUMNS = 7
const ANALYSIS_COLUMNS = 4
// A number column is as wide as its figures plus 8px each side on a phone, so that the six of the match stats fit in
// 360px; from `sm` up every number column is 68px wide and its figures end at its right edge, as the columns of the
// design do, and the last one keeps the 16px of the box's side.
// The labels of the header are of normal weight, as the design draws them.
const NUMBER_HEAD =
  'px-2 text-right font-normal sm:w-17 sm:min-w-17 sm:px-0 sm:last:w-21 sm:last:min-w-21 sm:last:pr-4'
const NUMBER_CELL = 'number-mono px-2 text-right sm:px-0 sm:last:pr-4'
// The player column stays in place while the numbers scroll under it, on a screen too narrow for all of them (or with
// a very long nickname), so every number keeps its name. It takes the row's background, hover included.
const STICKY = 'sticky left-0 bg-inherit'

/** A figure nobody has: a dash for the eye, the words for a screen reader. */
function NoData() {
  const t = useT()
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t.statsCards.noData}</span>
    </>
  )
}

interface StatsTableProps {
  team: TeamStatsResponse
  /** Dims the team that lost a decided match. */
  lost?: boolean
  /** The side the team started the match on, when the rounds of the demo tell it. */
  startSide?: RoundSide | null
  /**
   * What the demo analysis computed for the players of the match, by player id. With it the table has the columns
   * KAST, entry, trade and clutch; without it (no analyzed demo, or its players are not linked) they are left out.
   */
  analysis?: ReadonlyMap<string, BreakdownPlayer>
  /** The player of the signed-in visitor: that row is marked. */
  viewerPlayerId?: string | null
}

// The left edge of a team's box in the colour of the side it started on (`CT → T` in its header says the same in
// letters, so the colour is never the only sign).
const SIDE_EDGE: Record<RoundSide, string> = {
  CT: 'border-l-3 border-l-side-ct',
  T: 'border-l-3 border-l-side-t',
}

/**
 * One team's scoreboard: the team name, its sides, a Winner badge and its score in the table header, then a row per
 * player, most kills first (players with equal kills keep the order the API gave them). `lost` dims the team that lost
 * a decided match: its score is `text-subtle` and its name `text-muted-foreground`, as in the match header; the winner's
 * header has a tint of the positive colour and its score is in it. The box's left edge is in the colour of the side the
 * team started on, when the demo tells it. The visitor's own row has a line at its left edge. K/D is in the positive
 * colour from 1.00 up and in the negative one below. The share of headshots is of the player's kills; a figure there is
 * nothing to compute from is a dash.
 */
export default function StatsTable({ team, lost = false, startSide, analysis, viewerPlayerId }: StatsTableProps) {
  const t = useT()
  const players = [...team.players].sort((a, b) => b.kills - a.kills)
  return (
    <div className={cn('@container border border-border bg-card', startSide && SIDE_EDGE[startSide])}>
      {/* The shadcn Table puts the caption below the table (`caption-bottom`, inherited); the team header goes on
          top. The table is as wide as its cells need: when that is more than the box, the box scrolls. */}
      <Table className="caption-top">
        <TableCaption className="mt-0 text-left text-foreground">
          {/* As wide as the box, not as the table, and stuck to its left edge: the team name, its sides, the Winner
              badge and the score stay in view while the columns scroll under them. */}
          <div className={cn('sticky left-0 flex h-13 w-[100cqw] items-center gap-3 px-4', team.win && 'win-tint')}>
            <h2 className={cn('min-w-0 truncate text-base font-semibold', lost && 'text-muted-foreground')}>
              {team.name ?? t.stats.team}
            </h2>
            {startSide && <TeamSides start={startSide} />}
            {team.win && <Badge variant="positive">{t.stats.winner}</Badge>}
            <span
              className={cn(
                'ml-auto font-mono text-[22px] leading-none font-semibold tabular-nums',
                lost && 'text-subtle',
                team.win && 'text-positive',
              )}
            >
              <span className="sr-only">{t.stats.score}</span> {team.score}
            </span>
          </div>
        </TableCaption>
        {/* The rule above the column labels, as the board draws it under the team's header. */}
        <TableHeader className="[&_tr]:border-t">
          <TableRow>
            {/* Its own background rather than the row's: a header row has no hover colour to follow. */}
            <TableHead className="sticky left-0 w-full bg-card px-4 font-normal sm:min-w-53">{t.stats.player}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.kills}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.deaths}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.assists}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.kdRatio}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.adr}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.match.columns.headshotShare}</TableHead>
            {analysis && (
              <>
                <TableHead className={NUMBER_HEAD}>{t.match.columns.kast}</TableHead>
                <TableHead className={NUMBER_HEAD}>{t.match.columns.entry}</TableHead>
                <TableHead className={NUMBER_HEAD}>{t.match.columns.trade}</TableHead>
                <TableHead className={NUMBER_HEAD}>{t.match.columns.clutch}</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {players.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={STATS_COLUMNS + (analysis ? ANALYSIS_COLUMNS : 0)}
                className="px-4 text-center text-muted-foreground"
              >
                {t.stats.empty}
              </TableCell>
            </TableRow>
          ) : (
            players.map((player) => {
              const isViewer = viewerPlayerId != null && player.playerId === viewerPlayerId
              const figures = analysis?.get(player.playerId)
              return (
                <TableRow key={player.playerId} className={isViewer ? 'bg-secondary' : 'bg-card'}>
                  <TableCell className={cn(STICKY, 'px-4 py-0', isViewer && 'shadow-[inset_2px_0_0_var(--foreground)]')}>
                    {/* The outline is drawn inside the link: the last row ends at the edge of the scrolling box, which
                        would cut an outline drawn around it. The 8px of padding (taken back by the negative margin)
                        keep that inset outline off the letters, and `min-w-11` keeps a short nickname a 44px target. */}
                    <Link
                      to={playerPath(player.playerId)}
                      className={cn(
                        '-mx-2 inline-flex min-h-11 max-w-44 min-w-11 items-center gap-2 px-2 underline-offset-4 -outline-offset-2 hover:underline sm:max-w-none',
                        isViewer ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {/* On a narrow screen a long nickname is cut, so that it does not push every number out of view. */}
                      <span className="truncate">{player.nickname}</span>
                      {isViewer && (
                        <span className="shrink-0 font-mono text-[10px] font-medium tracking-[0.08em] text-subtle uppercase">
                          {t.match.you}
                        </span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className={cn(NUMBER_CELL, 'font-semibold')}>{player.kills}</TableCell>
                  <TableCell className={cn(NUMBER_CELL, 'text-muted-foreground')}>{player.deaths}</TableCell>
                  <TableCell className={cn(NUMBER_CELL, 'text-muted-foreground')}>{player.assists}</TableCell>
                  {/* Judged as it is written: 0.996 is written "1.00" and is good news. */}
                  <TableCell
                    className={cn(NUMBER_CELL, Number(player.kdRatio.toFixed(2)) >= 1 ? 'text-positive' : 'text-negative')}
                  >
                    {player.kdRatio.toFixed(2)}
                  </TableCell>
                  <TableCell className={NUMBER_CELL}>{player.adr.toFixed(1)}</TableCell>
                  <TableCell className={NUMBER_CELL}>
                    {player.kills > 0 ? `${Math.round((player.headshots / player.kills) * 100)}%` : <NoData />}
                  </TableCell>
                  {analysis && (
                    <>
                      <TableCell className={NUMBER_CELL}>
                        {figures?.kast != null ? `${Math.round(figures.kast)}%` : <NoData />}
                      </TableCell>
                      <TableCell className={cn(NUMBER_CELL, 'text-muted-foreground')}>
                        {figures?.entryKills ?? <NoData />}
                      </TableCell>
                      <TableCell className={cn(NUMBER_CELL, 'text-muted-foreground')}>
                        {figures?.tradeKills ?? <NoData />}
                      </TableCell>
                      <TableCell className={cn(NUMBER_CELL, 'text-muted-foreground')}>
                        {/* Clutches won of those tried; a player who never stood alone has nothing to show. */}
                        {figures?.clutchWins != null && figures.clutchAttempts != null && figures.clutchAttempts > 0 ? (
                          `${figures.clutchWins}/${figures.clutchAttempts}`
                        ) : (
                          <NoData />
                        )}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}
