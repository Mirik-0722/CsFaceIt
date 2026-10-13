# Map pictures

The files in this folder are the game's own artwork (Counter-Strike 2, © Valve Corporation). They were taken on
2026-10-13 from the public mirror <https://github.com/MurkyYT/cs2-map-icons> (`images/` for the emblems,
`images/thumbs/` for the scenery), resized and converted to WebP with `cwebp`:

| Folder | What | Size | `cwebp` quality |
|--------|------|------|-----------------|
| `emblems/` | the emblem of a map, with transparency (45 maps) | 128×128 | 86 |
| `scenes/` | a view of a map (9 maps) | 1600×900 | 62 |
| `scenes-sm/` | the same nine views | 480×270 | 58 |

A file is named by the map's id (`de_mirage.webp`). `src/lib/mapArt.ts` looks the files up by map; a map without a
file is not in the lookup, and the interface falls back to the map's colour (`src/lib/mapTint.ts`).
