import { mapSceneryUrl } from '@/lib/mapArt'
import type { MapOverview } from '@/api/overview'

/**
 * The scenery of the map the player has played most, among the maps that have a scenery: a map without one is passed
 * over however often it was played. On a tie the map that comes first in `maps` (the API's order) wins. Null when no
 * map has one.
 */
export function mostPlayedScenery(maps: readonly MapOverview[]): string | null {
  let best: { matches: number; url: string } | null = null
  for (const map of maps) {
    const url = mapSceneryUrl(map.mapName)
    if (url !== null && (best === null || map.matches > best.matches)) {
      best = { matches: map.matches, url }
    }
  }
  return best?.url ?? null
}

/**
 * The map the player has played most, scenery or not (the header's "main map"); on a tie the one that comes first in
 * `maps`. Null for a player without a stored match.
 */
export function mostPlayedMap(maps: readonly MapOverview[]): string | null {
  let best: MapOverview | null = null
  for (const map of maps) {
    if (best === null || map.matches > best.matches) {
      best = map
    }
  }
  return best?.mapName ?? null
}
