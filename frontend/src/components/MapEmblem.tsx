import MapTile from '@/components/MapTile'
import { mapEmblemUrl } from '@/lib/mapArt'
import { cn } from '@/lib/utils'

// The boxes an emblem is drawn in: 28px in a line of a table, 40px in the landing page's strip, 44px in a row of
// matches, 64px beside the title of a match.
const SIZE_CLASS = { 28: 'size-7', 40: 'size-10', 44: 'size-11', 64: 'size-16' }

interface MapEmblemProps {
  /** The map as the API names it (`de_mirage`); null when the map is not known. */
  mapName: string | null
  size: keyof typeof SIZE_CLASS
  /** Changes the box where the place needs to (a smaller one on a phone); the fallback square gets it too. */
  className?: string
}

/**
 * The game's emblem of a map, next to the map's name. It is decoration (the name says which map it is), so it has an
 * empty `alt` and is hidden from assistive technology; its box has its size before the picture arrives, so nothing
 * moves when it does. A map without an emblem, or no map at all, gets the square in the map's colour (`MapTile`) in the
 * same box.
 */
export default function MapEmblem({ mapName, size, className }: MapEmblemProps) {
  const url = mapEmblemUrl(mapName)
  if (!url) {
    return <MapTile mapName={mapName} className={cn(SIZE_CLASS[size], className)} />
  }
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
      draggable={false}
      className={cn('block shrink-0 object-contain', SIZE_CLASS[size], className)}
    />
  )
}
