import MapEmblem from '@/components/MapEmblem'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useT } from '@/i18n'
import { mapLabel } from '@/lib/mapTint'
import type { MapOverview } from '@/api/overview'

/**
 * The player's stored matches by map (spec 3, the maps table): the map with its emblem, how many matches, the share won as
 * a bar with its percentage, K/D and ADR. The rows come in the order given, most played first. A map without a stored ADR
 * shows a dash. The columns are 12px apart and the box has 16px at its sides: each number column is as wide as its
 * figures plus the 12px before it. The table is as wide as that needs and scrolls in its box on a phone, as a scoreboard
 * does.
 */
export default function MapsTable({ maps, labelledBy }: { maps: MapOverview[]; labelledBy: string }) {
  const t = useT()
  return (
    <div className="border border-border bg-card">
      <Table aria-labelledby={labelledBy} className="min-w-160 table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="pr-0 pl-4">{t.matches.maps.map}</TableHead>
            <TableHead className="w-23 pr-0 pl-3 text-right">{t.matches.maps.matches}</TableHead>
            <TableHead className="w-50.5 pr-0 pl-3">{t.matches.maps.winRate}</TableHead>
            <TableHead className="w-21 pr-0 pl-3 text-right">{t.matches.maps.kd}</TableHead>
            <TableHead className="w-25 pr-4 pl-3 text-right">{t.matches.maps.adr}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {maps.map((map) => {
            const wonShare = map.matches > 0 ? Math.round((map.wins / map.matches) * 100) : 0
            return (
              // The rows say something, they do not do anything: no hover colour.
              <TableRow key={map.mapName} className="number-mono hover:bg-transparent">
                <TableCell className="py-0 pr-0 pl-4">
                  <span className="flex items-center gap-3 font-sans text-sm font-semibold">
                    <MapEmblem mapName={map.mapName} size={28} />
                    <span className="truncate">{mapLabel(map.mapName) ?? map.mapName}</span>
                  </span>
                </TableCell>
                <TableCell className="py-0 pr-0 pl-3 text-right text-muted-foreground">{map.matches}</TableCell>
                <TableCell className="py-0 pr-0 pl-3">
                  <span className="flex items-center gap-3">
                    <span aria-hidden="true" className="block h-[3px] flex-1 bg-line-strong">
                      <span className="block h-full bg-foreground" style={{ width: `${wonShare}%` }} />
                    </span>
                    <span className="w-9 text-right">{wonShare}%</span>
                  </span>
                </TableCell>
                <TableCell className="py-0 pr-0 pl-3 text-right">{map.kd.toFixed(2)}</TableCell>
                <TableCell className="py-0 pr-4 pl-3 text-right">
                  {map.adr === null ? (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">{t.statsCards.noData}</span>
                    </>
                  ) : (
                    map.adr.toFixed(1)
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
