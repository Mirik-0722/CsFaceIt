import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { TeamStatsResponse } from '@/api/types'

const COLUMN_COUNT = 7
// A number column is as wide as its figures plus 8px each side on a phone, so that all six fit in 360px; from `sm` up
// it is at least 68px wide with 16px each side.
const NUMBER_HEAD = 'px-2 text-right sm:min-w-17 sm:px-4'
const NUMBER_CELL = 'number-mono px-2 text-right sm:px-4'
// The player column stays in place while the numbers scroll under it, on a screen too narrow for all of them (or with
// a very long nickname), so every number keeps its name. It takes the row's background, hover included.
const STICKY = 'sticky left-0 bg-inherit'

/**
 * One team's scoreboard: the team name, its score and a Winner badge in the table header, then a row per player,
 * most kills first (players with equal kills keep the order the API gave them). `lost` dims the team that lost a
 * decided match: its score is `text-subtle` and its name `text-muted-foreground`, as in the match header.
 */
export default function StatsTable({ team, lost = false }: { team: TeamStatsResponse; lost?: boolean }) {
  const t = useT()
  const players = [...team.players].sort((a, b) => b.kills - a.kills)
  return (
    <div className="@container border border-border bg-card">
      {/* The shadcn Table puts the caption below the table (`caption-bottom`, inherited); the team header goes on
          top. The table is as wide as its cells need: when that is more than the box, the box scrolls. */}
      <Table className="caption-top">
        <TableCaption className="mt-0 text-left text-foreground">
          {/* As wide as the box, not as the table, and stuck to its left edge: the team name, the Winner badge and
              the score stay in view while the columns scroll under them. */}
          <div className="sticky left-0 flex w-[100cqw] items-center gap-3 px-4 py-3">
            <h2 className={cn('min-w-0 truncate text-base font-semibold', lost && 'text-muted-foreground')}>
              {team.name ?? t.stats.team}
            </h2>
            {team.win && <Badge variant="positive">{t.stats.winner}</Badge>}
            <span
              className={cn(
                'ml-auto font-mono text-[22px] leading-none font-semibold tabular-nums',
                lost && 'text-subtle',
              )}
            >
              <span className="sr-only">{t.stats.score}</span> {team.score}
            </span>
          </div>
        </TableCaption>
        <TableHeader>
          <TableRow>
            {/* Its own background rather than the row's: a header row has no hover colour to follow. */}
            <TableHead className="sticky left-0 w-full bg-card px-4">{t.stats.player}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.kills}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.deaths}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.assists}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.headshots}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.kdRatio}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.adr}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {players.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="px-4 text-center text-muted-foreground">
                {t.stats.empty}
              </TableCell>
            </TableRow>
          ) : (
            players.map((player) => (
              <TableRow key={player.playerId} className="bg-card">
                <TableCell className={cn(STICKY, 'px-4 py-0')}>
                  {/* The outline is drawn inside the link: the last row ends at the edge of the scrolling box, which
                      would cut an outline drawn around it. The 8px of padding (taken back by the negative margin)
                      keep that inset outline off the letters, and `min-w-11` keeps a short nickname a 44px target. */}
                  <Link
                    to={`/players/${encodeURIComponent(player.playerId)}`}
                    className="-mx-2 inline-flex min-h-11 max-w-44 min-w-11 items-center px-2 font-medium underline-offset-4 -outline-offset-2 hover:underline sm:max-w-none"
                  >
                    {/* On a narrow screen a long nickname is cut, so that it does not push every number out of view. */}
                    <span className="truncate">{player.nickname}</span>
                  </Link>
                </TableCell>
                <TableCell className={cn(NUMBER_CELL, 'font-semibold')}>{player.kills}</TableCell>
                <TableCell className={cn(NUMBER_CELL, 'text-muted-foreground')}>{player.deaths}</TableCell>
                <TableCell className={cn(NUMBER_CELL, 'text-muted-foreground')}>{player.assists}</TableCell>
                <TableCell className={NUMBER_CELL}>{player.headshots}</TableCell>
                <TableCell className={cn(NUMBER_CELL, player.kdRatio < 1 && 'text-muted-foreground')}>
                  {player.kdRatio.toFixed(2)}
                </TableCell>
                <TableCell className={NUMBER_CELL}>{player.adr.toFixed(1)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
