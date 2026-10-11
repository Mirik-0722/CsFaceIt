interface MapTint {
  /** Fills a map square next to the map's name. */
  tile: string
  /** Tints the frame of a clip recorded on the map. */
  scene: string
}

// The design's map colours (docs/superpowers/specs/2026-10-11-web-ui-design.md, section 2.1).
const TINTS = new Map<string, MapTint>([
  ['mirage', { tile: '#4A3B22', scene: '#3A2F1C' }],
  ['inferno', { tile: '#4A2A1E', scene: '#3B2219' }],
  ['ancient', { tile: '#22402F', scene: '#1D3326' }],
  ['nuke', { tile: '#223647', scene: '#1C2B3A' }],
  ['anubis', { tile: '#4A3F1F', scene: '#3A311A' }],
  ['dust2', { tile: '#4D4428', scene: '#3B3421' }],
])
const OTHER_MAP: MapTint = { tile: '#2A2F35', scene: '#1E2226' }

/**
 * `de_mirage` → `mirage`: FACEIT's map name in lower case without its two-letter game-mode prefix (`de_`, `cs_`,
 * `ar_`: `cs_office` → `office`); null when there is no name.
 */
export function mapKey(mapName: string | null): string | null {
  if (!mapName) {
    return null
  }
  return mapName.toLowerCase().replace(/^[a-z]{2}_/, '')
}

function tintOf(mapName: string | null): MapTint {
  const key = mapKey(mapName)
  return (key !== null ? TINTS.get(key) : undefined) ?? OTHER_MAP
}

/** The colour of the map's square; a map the design has no colour for gets the neutral one. */
export function mapTile(mapName: string | null): string {
  return tintOf(mapName).tile
}

/** The colour a clip frame of the map is tinted with. */
export function mapScene(mapName: string | null): string {
  return tintOf(mapName).scene
}

/** `de_mirage` → `Mirage`: the map's name as a title; null when there is nothing to show. */
export function mapLabel(mapName: string | null): string | null {
  const key = mapKey(mapName)
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : null
}
