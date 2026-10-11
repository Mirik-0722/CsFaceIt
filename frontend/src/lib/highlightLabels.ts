import type { Messages } from '@/i18n'
import type { HighlightKill, HighlightResponse, HighlightType } from '@/api/types'
import { weaponLabel } from '@/lib/weapons'

/** The groups the match page filters by. */
export type HighlightGroup = 'multi' | 'clutch' | 'special'

/** Every highlight type with its group, in the order the type filter lists them. */
const GROUP_OF: Record<HighlightType, HighlightGroup> = {
  ACE: 'multi',
  K4: 'multi',
  K3: 'multi',
  CLUTCH_1V5: 'clutch',
  CLUTCH_1V4: 'clutch',
  CLUTCH_1V3: 'clutch',
  CLUTCH_1V2: 'clutch',
  CLUTCH_1V1: 'clutch',
  NINJA_DEFUSE: 'special',
  NO_SCOPE: 'special',
  WALLBANG: 'special',
  SMOKE_KILL: 'special',
  KNIFE_KILL: 'special',
}

export const HIGHLIGHT_TYPES = Object.keys(GROUP_OF) as HighlightType[]

export function highlightGroup(type: HighlightType): HighlightGroup {
  return GROUP_OF[type]
}

export function isHighlightType(value: string): value is HighlightType {
  return value in GROUP_OF
}

/**
 * The tag of a highlight, written as it is shown (the tag does not change its case): `ACE`, `4K`, `3K`,
 * `1v3 CLUTCH`, `NO-SCOPE`, `WALLBANG`, `NINJA DEFUSE`. Game terms are the same in every language; the two kinds that
 * are plain words come from the dictionary.
 */
export function highlightLabel(type: HighlightType, t: Messages): string {
  switch (type) {
    case 'ACE':
      return 'ACE'
    case 'K4':
      return '4K'
    case 'K3':
      return '3K'
    case 'NO_SCOPE':
      return 'NO-SCOPE'
    case 'WALLBANG':
      return 'WALLBANG'
    case 'NINJA_DEFUSE':
      return 'NINJA DEFUSE'
    case 'KNIFE_KILL':
      return t.highlight.knifeKill
    case 'SMOKE_KILL':
      return t.highlight.smokeKill
    default:
      // CLUTCH_1V3 → 1v3 CLUTCH
      return `${type.slice('CLUTCH_'.length).toLowerCase()} CLUTCH`
  }
}

/** `AK-47 ×3, Desert Eagle · 2 headshots`: the weapons in the order they first killed, then the headshots if any. */
function describeKills(kills: HighlightKill[], t: Messages): string {
  const counts = new Map<string, number>()
  for (const kill of kills) {
    const weapon = weaponLabel(kill.weapon)
    counts.set(weapon, (counts.get(weapon) ?? 0) + 1)
  }
  const weapons = [...counts].map(([weapon, count]) => (count > 1 ? `${weapon} ×${count}` : weapon)).join(', ')
  const headshots = kills.filter((kill) => kill.headshot).length
  return headshots > 0 ? `${weapons} · ${t.highlight.headshots(headshots)}` : weapons
}

/** One line about what happened in the highlight, from its kills; a highlight without a kill says what it was. */
export function describeHighlight(highlight: HighlightResponse, t: Messages): string {
  if (highlight.kills.length > 0) {
    return describeKills(highlight.kills, t)
  }
  return highlight.type === 'NINJA_DEFUSE' ? t.highlight.bombDefused : t.highlight.noKills
}

/** Seconds as `m:ss`. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
