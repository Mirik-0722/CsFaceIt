import { mapTile } from '@/lib/mapTint'
import { cn } from '@/lib/utils'

/**
 * A square in the map's colour: what `MapEmblem` shows, in the emblem's box, for a map that has no emblem. Decoration,
 * so it is hidden from assistive technology. The box's size comes with `className`.
 */
export default function MapTile({ mapName, className }: { mapName: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block shrink-0 border border-line-strong', className)}
      style={{ backgroundColor: mapTile(mapName) }}
    />
  )
}
