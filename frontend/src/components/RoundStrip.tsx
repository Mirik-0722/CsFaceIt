import { useT } from '@/i18n'
import { firstTeamSide, rostersOf, roundWinner } from '@/lib/matchRounds'
import { cn } from '@/lib/utils'
import type { BreakdownRound, RoundSide } from '@/api/breakdownTypes'
import type { TeamStatsResponse } from '@/api/types'

// The square of a won round is filled with the colour of the side that won it; the legend under the strip and the
// words of every round say the same, so the colour is never the only sign.
const WON: Record<RoundSide, string> = { CT: 'border-side-ct bg-side-ct', T: 'border-side-t bg-side-t' }
// A round a team won on a side the demo does not tell.
const WON_UNKNOWN_SIDE = 'border-ring bg-ring'
const EMPTY = 'border-border'

interface RoundStripProps {
  /** The rounds of the match, in the order they were played. */
  rounds: BreakdownRound[]
  /** The teams of the scoreboard, once the stats have arrived: they give the strip its two rows. */
  teams: TeamStatsResponse[] | undefined
  /** The numbers of the rounds that have a highlight. */
  highlightRounds: ReadonlySet<number>
}

/**
 * The rounds of a match as a strip (spec 3, RoundStrip): a column per round with its number, and a row per team. The
 * square of a round is in the row of the team that won it, in the colour of the winning side; a red dot under the
 * number marks a round that has a highlight, and the strip opens a little where the teams changed sides. As soon as
 * one round cannot be given to a team (the players of the demo are not linked to the roster, or both rosters hold a
 * winner) there is one row, coloured by the winning side. The squares are a picture: every round says the same in
 * words to a screen reader. On a narrow screen
 * the strip scrolls inside its box, and the names of the teams stay in place.
 */
export default function RoundStrip({ rounds, teams, highlightRounds }: RoundStripProps) {
  const t = useT()
  const rosters = rostersOf(teams)
  const winners = rounds.map((round) => roundWinner(round, rosters))
  // Two rows only when every round has its team: a blank pair of squares would say that nobody won the round.
  const rows = teams && winners.length > 0 && winners.every((winner) => winner !== null) ? teams : null
  // The side of the first team round by round: where it differs from the round before, the teams changed sides.
  const changedSides: boolean[] = []
  let sideBefore: RoundSide | null = null
  for (const round of rounds) {
    const side = firstTeamSide(round, rosters)
    changedSides.push(side !== null && sideBefore !== null && side !== sideBefore)
    sideBefore = side ?? sideBefore
  }
  return (
    // Not announced when it arrives inside a live region: every round is a sentence of its own.
    <div aria-live="off" className="flex flex-col gap-3">
      {/* Positioned, so that the words only a screen reader hears are clipped with the strip when it scrolls. */}
      <div className="relative overflow-x-auto">
        <div className="mx-auto flex w-max">
          {rows && (
            <div
              aria-hidden="true"
              className="sticky left-0 z-10 flex flex-col gap-1 bg-card pr-3 text-right font-mono text-[11px] text-subtle"
            >
              {rows.map((team) => (
                // A long name is cut, shorter on a phone, so that it leaves the rounds most of the box.
                <span key={team.teamId} className="block h-5.5 max-w-24 truncate leading-[22px] sm:max-w-40">
                  {team.name ?? t.stats.team}
                </span>
              ))}
            </div>
          )}
          <ol aria-label={t.match.rounds} className="flex gap-1">
            {rounds.map((round, index) => {
              const winner = winners[index]
              const marked = highlightRounds.has(round.number)
              const won = round.winnerSide ? WON[round.winnerSide] : WON_UNKNOWN_SIDE
              const winnerName = rows && winner !== null ? (rows[winner].name ?? t.stats.team) : null
              return (
                <li
                  key={round.number}
                  className={cn('flex flex-col items-center gap-1', changedSides[index] && 'ml-3.5')}
                >
                  <span className="sr-only">
                    {t.match.roundSummary(round.number, winnerName, round.winnerSide, marked)}
                  </span>
                  {rows ? (
                    rows.map((team, row) => (
                      <span
                        key={team.teamId}
                        aria-hidden="true"
                        className={cn('block size-5.5 border', winner === row ? won : EMPTY)}
                      />
                    ))
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn('block size-5.5 border', round.winnerSide ? won : EMPTY)}
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'font-mono text-[10px] leading-[14px] tabular-nums',
                      marked ? 'text-foreground' : 'text-subtle',
                    )}
                  >
                    {round.number}
                  </span>
                  <span aria-hidden="true" className={cn('block size-1 rounded-full', marked && 'bg-rec')} />
                </li>
              )
            })}
          </ol>
        </div>
      </div>
      {/* The key to the colours of the picture; the words of each round already say what its square shows. */}
      <div
        aria-hidden="true"
        className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 font-mono text-[11px] tracking-[0.06em] text-subtle uppercase"
      >
        <span className="inline-flex items-center gap-2">
          <span className="block size-2.5 bg-side-ct" />
          {t.match.legend.ct}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="block size-2.5 bg-side-t" />
          {t.match.legend.t}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="block size-1 rounded-full bg-rec" />
          {t.match.legend.highlight}
        </span>
      </div>
    </div>
  )
}
