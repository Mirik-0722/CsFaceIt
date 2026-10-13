import type { Messages } from '@/i18n'
import type { HighlightKill, HighlightResponse, HighlightType } from '@/api/types'
import { isKnife, weaponLabel } from '@/lib/weapons'

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

/** The group of a highlight type; a type this build does not know yet counts as special, so that it is never lost. */
export function highlightGroup(type: HighlightType): HighlightGroup {
  return GROUP_OF[type] ?? 'special'
}

export function isHighlightType(value: string): value is HighlightType {
  return HIGHLIGHT_TYPES.some((type) => type === value)
}

/**
 * The tag of a highlight, written as it is shown (the tag does not change its case): `ACE`, `4K`, `3K`,
 * `1v3 CLUTCH`, `NO-SCOPE`, `WALLBANG`, `DEFUSE`. Game terms are the same in every language; the two kinds that are
 * plain words come from the dictionary. `NINJA_DEFUSE` is the name of the type in the API; the rule behind it is only
 * that the bomb was defused while an enemy was alive, so its tag says no more than `DEFUSE`.
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
      return 'DEFUSE'
    case 'KNIFE_KILL':
      return t.highlight.knifeKill
    case 'SMOKE_KILL':
      return t.highlight.smokeKill
    default:
      // CLUTCH_1V3 → 1v3 CLUTCH
      return `${type.slice('CLUTCH_'.length).toLowerCase()} CLUTCH`
  }
}

/**
 * The kind of a highlight as a word in a list of kinds (a player's highlights by kind), where the board writes it in
 * sentence case: `3K`, `ACE`, `No-scope`, `Wallbang`, `Defuse`; the two plain words come from the dictionary. The tags
 * of the cards and the filters keep {@link highlightLabel}. A clutch is a tag only (`1v3 CLUTCH`): a list that
 * counts clutches names them as a group.
 */
export function highlightKindName(type: HighlightType, t: Messages): string {
  switch (type) {
    case 'NO_SCOPE':
      return 'No-scope'
    case 'WALLBANG':
      return 'Wallbang'
    case 'NINJA_DEFUSE':
      return 'Defuse'
    case 'KNIFE_KILL':
      return t.highlight.knife
    case 'SMOKE_KILL':
      return t.highlight.smokeName
    default:
      return highlightLabel(type, t)
  }
}

/** `AK-47 ×3, Desert Eagle · 2 headshots`: the weapons in the order they first killed, then the headshots if any. */
function describeKills(kills: HighlightKill[], t: Messages): string {
  const counts = new Map<string, number>()
  for (const kill of kills) {
    // Item names are the same in every language; the knife is a plain word and comes from the dictionary.
    const weapon = isKnife(kill.weapon) ? t.highlight.knife : weaponLabel(kill.weapon)
    counts.set(weapon, (counts.get(weapon) ?? 0) + 1)
  }
  const weapons = [...counts].map(([weapon, count]) => (count > 1 ? `${weapon} ×${count}` : weapon)).join(', ')
  const headshots = kills.filter((kill) => kill.headshot).length
  return headshots > 0 ? `${weapons} · ${t.highlight.headshots(headshots)}` : weapons
}

/**
 * One line about what happened in the highlight, from its kills. A defuse always starts with what it is (the bomb was
 * defused with an enemy alive) and goes on with the weapons when its window holds kills; any other highlight without a
 * kill says so.
 */
export function describeHighlight(highlight: HighlightResponse, t: Messages): string {
  const kills = highlight.kills.length > 0 ? describeKills(highlight.kills, t) : null
  if (highlight.type === 'NINJA_DEFUSE') {
    return kills ? `${t.highlight.bombDefused} · ${kills}` : t.highlight.bombDefused
  }
  return kills ?? t.highlight.noKills
}

/** Seconds as `m:ss`. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
