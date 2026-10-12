import { mapTile } from '@/lib/mapTint'
import { cn } from '@/lib/utils'

const SIZE_CLASS = { 20: 'size-5', 36: 'size-9', 44: 'size-11' }

/**
 * A square in the map's colour, next to the map's name: decoration, so it is hidden from assistive technology. The
 * small one (20px) stands in a line of a table, the others beside a title.
 */
export default function MapTile({ mapName, size = 44 }: { mapName: string | null; size?: 20 | 36 | 44 }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block shrink-0 border border-line-strong', SIZE_CLASS[size])}
      style={{ backgroundColor: mapTile(mapName) }}
    />
  )
}
