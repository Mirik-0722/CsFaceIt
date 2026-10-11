import { mapTile } from '@/lib/mapTint'
import { cn } from '@/lib/utils'

/** A square in the map's colour, next to the map's name: decoration, so it is hidden from assistive technology. */
export default function MapTile({ mapName, size = 44 }: { mapName: string | null; size?: 36 | 44 }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block shrink-0 border border-line-strong', size === 36 ? 'size-9' : 'size-11')}
      style={{ backgroundColor: mapTile(mapName) }}
    />
  )
}
