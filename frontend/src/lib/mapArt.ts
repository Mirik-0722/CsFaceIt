import { mapKey } from '@/lib/mapTint'

/**
 * The game's own pictures of its maps (see src/assets/maps/README.md), looked up by the key of the map. The build
 * gives every file a hashed name; `no-inline` keeps the small ones files too, so that none of them is carried inside
 * the script. A map without a file is simply not in the lookup.
 */
function byMapKey(files: Record<string, string>): ReadonlyMap<string, string> {
  const urls = new Map<string, string>()
  for (const [path, url] of Object.entries(files)) {
    // `../assets/maps/emblems/de_mirage.webp` → `mirage`
    const key = mapKey(path.slice(path.lastIndexOf('/') + 1).replace(/\.webp$/, ''))
    if (key) {
      urls.set(key, url)
    }
  }
  return urls
}

// Vite reads these calls when it builds, so each one spells its options out (they cannot come from a variable).
const EMBLEMS = byMapKey(
  import.meta.glob<string>('../assets/maps/emblems/*.webp', { eager: true, query: '?url&no-inline', import: 'default' }),
)
const SCENES = byMapKey(
  import.meta.glob<string>('../assets/maps/scenes/*.webp', { eager: true, query: '?url&no-inline', import: 'default' }),
)
const SMALL_SCENES = byMapKey(
  import.meta.glob<string>('../assets/maps/scenes-sm/*.webp', { eager: true, query: '?url&no-inline', import: 'default' }),
)

function find(urls: ReadonlyMap<string, string>, mapName: string | null): string | null {
  const key = mapKey(mapName)
  return (key !== null ? urls.get(key) : undefined) ?? null
}

/** The map's emblem (128px, transparent), or null for a map that has none. */
export function mapEmblemUrl(mapName: string | null): string | null {
  return find(EMBLEMS, mapName)
}

/**
 * A view of the map: the large one (1600×900) for a backdrop, the small one (480×270) for a frame of a card. Null for a
 * map without scenery.
 */
export function mapSceneryUrl(mapName: string | null, size: 'large' | 'small' = 'large'): string | null {
  return find(size === 'large' ? SCENES : SMALL_SCENES, mapName)
}

/**
 * The map whose view a URL is, as its key (`mirage`; `mapLabel` and `mapSceneryUrl` take it as a map name too), or null
 * for an address that is no view of a map. For whoever holds only the picture that is shown and has to name its map.
 */
export function mapOfSceneryUrl(url: string | null): string | null {
  if (!url) {
    return null
  }
  for (const views of [SCENES, SMALL_SCENES]) {
    for (const [key, viewUrl] of views) {
      if (viewUrl === url) {
        return key
      }
    }
  }
  return null
}
