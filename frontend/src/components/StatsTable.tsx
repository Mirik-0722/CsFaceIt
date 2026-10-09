import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WIN_BADGE_CLASS } from '@/lib/badgeStyles'
import type { TeamStatsResponse } from '@/api/types'

const COLUMN_COUNT = 7

/**
 * One team's scoreboard: the team name, its score and a Winner badge in the table header, then a row per player,
 * most kills first (players with equal kills keep the order the API gave them).
 */
export default function StatsTable({ team }: { team: TeamStatsResponse }) {
  const players = [...team.players].sort((a, b) => b.kills - a.kills)
  return (
    // The shadcn Table puts the caption below the table (`caption-bottom`, inherited); the team header goes on top.
    <Table className="caption-top">
      <TableCaption className="mt-0 mb-2 text-left text-foreground">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium">{team.name ?? 'Team'}</h2>
          {team.win && <Badge className={WIN_BADGE_CLASS}>Winner</Badge>}
          <span className="ml-auto font-mono text-lg tabular-nums">
            <span className="sr-only">Score:</span> {team.score}
          </span>
        </div>
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Player</TableHead>
          <TableHead className="text-right">K</TableHead>
          <TableHead className="text-right">D</TableHead>
          <TableHead className="text-right">A</TableHead>
          <TableHead className="text-right">HS</TableHead>
          <TableHead className="text-right">K/D</TableHead>
          <TableHead className="text-right">ADR</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {players.length === 0 ? (
          <TableRow>
            <TableCell colSpan={COLUMN_COUNT} className="text-center text-muted-foreground">
              No player stats
            </TableCell>
          </TableRow>
        ) : (
          players.map((player) => (
            <TableRow key={player.playerId}>
              <TableCell>
                <Link
                  to={`/players/${encodeURIComponent(player.playerId)}`}
                  className="font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {player.nickname}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">{player.kills}</TableCell>
              <TableCell className="text-right tabular-nums">{player.deaths}</TableCell>
              <TableCell className="text-right tabular-nums">{player.assists}</TableCell>
              <TableCell className="text-right tabular-nums">{player.headshots}</TableCell>
              <TableCell className="text-right tabular-nums">{player.kdRatio.toFixed(2)}</TableCell>
              <TableCell className="text-right tabular-nums">{player.adr.toFixed(1)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
