import type { Messages } from '@/i18n'
import type { ClipQuality, ClipResponse, ClipStatus, HighlightResponse } from '@/api/types'
import { highlightLabel } from '@/lib/highlightLabels'
import { mapLabel } from '@/lib/mapTint'

/** The qualities a clip can be asked for in, the lower first. */
export const CLIP_QUALITIES: readonly ClipQuality[] = ['720p', '1080p']

/** A finished video first, then a clip that is on its way; a failed one only when there is nothing else. */
function statusRank(status: ClipStatus): number {
  if (status === 'DONE') {
    return 0
  }
  return status === 'FAILED' ? 2 : 1
}

/** The order of several clips of the same thing: see {@link clipFor}. */
function byPreference(a: ClipResponse, b: ClipResponse): number {
  return (
    statusRank(a.status) - statusRank(b.status) ||
    CLIP_QUALITIES.indexOf(b.quality) - CLIP_QUALITIES.indexOf(a.quality) ||
    b.createdAt.localeCompare(a.createdAt)
  )
}

/**
 * The clip of a highlight among the clips of its match, or undefined when it has none. A clip does not carry the id of
 * its highlight (a repeated analysis gives every highlight a new id), so it is found by what the highlight is: the
 * player, the type, the round and the tick its window starts at. Of several clips of one highlight (two qualities, or a
 * failed attempt and its retry) the finished one wins, then the higher quality, then the newer.
 */
export function clipFor(highlight: HighlightResponse, clips: ClipResponse[]): ClipResponse | undefined {
  return clips
    .filter(
      (clip) =>
        clip.kind === 'HIGHLIGHT' &&
        clip.playerId === highlight.playerId &&
        clip.highlightType === highlight.type &&
        clip.roundNumber === highlight.roundNumber &&
        clip.tickStart === highlight.tickStart,
    )
    .sort(byPreference)[0]
}

/**
 * The compilation of a player among the clips of a match, or undefined; of several the one {@link clipFor} would
 * choose.
 */
export function compilationFor(playerId: string, clips: ClipResponse[]): ClipResponse | undefined {
  return clips
    .filter((clip) => clip.kind === 'COMPILATION' && clip.playerId === playerId)
    .sort(byPreference)[0]
}

/** What a clip shows, as its tag says it: the label of its highlight (`4K`, `1v3 CLUTCH`), or the word for a compilation. */
export function clipLabel(clip: ClipResponse, t: Messages): string {
  return clip.highlightType ? highlightLabel(clip.highlightType, t) : t.clip.compilation
}

/**
 * Where a clip is from, as the corner of its frame says it: `Mirage · R14`, and `Mirage · MATCH` for a compilation.
 * `R14` and `MATCH` are marks on the frame, the same in every language, like the tags of the highlights.
 */
export function frameLabel(clip: Pick<ClipResponse, 'mapName' | 'roundNumber'>, t: Messages): string {
  const round = clip.roundNumber !== null ? `R${clip.roundNumber}` : 'MATCH'
  return `${mapLabel(clip.mapName) ?? t.match.unknownMap} · ${round}`
}

/** A file size as it is shown next to a download: `21.4 MB`, and `640 KB` below one megabyte. */
export function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  return megabytes >= 1 ? `${megabytes.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
