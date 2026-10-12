import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

// A made-up scoreboard: the figures are as they are written in the mockup, ADR with its decimal and the percentages
// with their sign, because nothing here is computed.
const PLAYERS = [
  { nickname: 'temur1k', kills: 27, deaths: 15, adr: '98.4', headshots: '59%', kast: '79%' },
  { nickname: 'sarbon', kills: 21, deaths: 16, adr: '84.1', headshots: '43%', kast: '75%' },
  { nickname: 'zafar-', kills: 17, deaths: 15, adr: '71.6', headshots: '35%', kast: '71%' },
  { nickname: 'N1ZOM', kills: 13, deaths: 16, adr: '60.3', headshots: '46%', kast: '67%' },
  { nickname: 'bekzod7', kills: 10, deaths: 15, adr: '52.8', headshots: '30%', kast: '63%' },
]

// The number columns are as wide as their figures plus 8px each side on a phone, as in `StatsTable`, so that all of
// them fit next to a nickname in 320px; from `sm` up they have 16px each side.
const NAME_PADDING = 'px-3 sm:px-4'
const NUMBER_HEAD = 'px-2 text-right sm:px-4'
const NUMBER_CELL = 'number-mono px-2 text-right sm:px-4'

/**
 * The scoreboard of a match, as the statistics section shows it (mockup, screen 1): the same table as `StatsTable`
 * with the columns the analysis adds, and the player the section is about in the raised row. It is a picture of an
 * example, so it has no links and no hover, is hidden from assistive technology and is marked as a sample.
 */
export default function SampleScoreboard() {
  const t = useT()
  return (
    <div aria-hidden="true" className="min-w-0 border border-border bg-card">
      <Table className="caption-top">
        <TableCaption className="mt-0 p-0 text-left">
          <div className="label-mono flex items-center justify-between gap-3 px-4 py-3.5">
            <span>MIRAGE · 13 : 11</span>
            <span>{t.home.sample}</span>
          </div>
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className={cn('w-full', NAME_PADDING)}>{t.stats.player}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.kills}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.deaths}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.stats.adr}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.statsCards.hsPercent}</TableHead>
            <TableHead className={NUMBER_HEAD}>{t.statsCards.kast}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {PLAYERS.map((player, row) => (
            // The first row is the player the section is about: raised, and its name in the heavier weight.
            <TableRow key={player.nickname} className={row === 0 ? 'bg-secondary' : 'bg-card hover:bg-card'}>
              <TableCell className={cn(NAME_PADDING, 'py-0 font-medium', row === 0 && 'font-semibold')}>
                {player.nickname}
              </TableCell>
              <TableCell className={cn(NUMBER_CELL, 'font-semibold')}>{player.kills}</TableCell>
              <TableCell className={cn(NUMBER_CELL, 'text-muted-foreground')}>{player.deaths}</TableCell>
              <TableCell className={NUMBER_CELL}>{player.adr}</TableCell>
              <TableCell className={NUMBER_CELL}>{player.headshots}</TableCell>
              <TableCell className={NUMBER_CELL}>{player.kast}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
