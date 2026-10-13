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
