// The names a demo gives the weapons, without the `weapon_` prefix, and the names players know them by. In a CS2 demo
// `m4a1` is the M4A4; the silenced rifle is `m4a1_silencer`.
const LABELS = new Map<string, string>([
  ['ak47', 'AK-47'],
  ['m4a1', 'M4A4'],
  ['m4a4', 'M4A4'],
  ['m4a1_silencer', 'M4A1-S'],
  ['galilar', 'Galil AR'],
  ['famas', 'FAMAS'],
  ['sg556', 'SG 553'],
  ['aug', 'AUG'],
  ['awp', 'AWP'],
  ['ssg08', 'SSG 08'],
  ['g3sg1', 'G3SG1'],
  ['scar20', 'SCAR-20'],
  ['deagle', 'Desert Eagle'],
  ['revolver', 'R8 Revolver'],
  ['usp_silencer', 'USP-S'],
  ['hkp2000', 'P2000'],
  ['glock', 'Glock-18'],
  ['p250', 'P250'],
  ['fiveseven', 'Five-SeveN'],
  ['tec9', 'Tec-9'],
  ['cz75a', 'CZ75-Auto'],
  ['elite', 'Dual Berettas'],
  ['mac10', 'MAC-10'],
  ['mp9', 'MP9'],
  ['mp7', 'MP7'],
  ['mp5sd', 'MP5-SD'],
  ['ump45', 'UMP-45'],
  ['p90', 'P90'],
  ['bizon', 'PP-Bizon'],
  ['nova', 'Nova'],
  ['xm1014', 'XM1014'],
  ['mag7', 'MAG-7'],
  ['sawedoff', 'Sawed-Off'],
  ['m249', 'M249'],
  ['negev', 'Negev'],
  ['hegrenade', 'HE Grenade'],
  ['molotov', 'Molotov'],
  ['incgrenade', 'Incendiary'],
  // What a kill by the fire of a molotov or an incendiary grenade is recorded as.
  ['inferno', 'Molotov'],
  ['flashbang', 'Flashbang'],
  ['smokegrenade', 'Smoke'],
  ['decoy', 'Decoy'],
  ['taser', 'Zeus x27'],
  ['planted_c4', 'C4'],
  ['c4', 'C4'],
])

/**
 * The name of a weapon as players know it (`ak47` → `AK-47`). Every knife model is `Knife`; a weapon that is not in
 * the list keeps the name the demo gave it.
 */
export function weaponLabel(weapon: string): string {
  const name = weapon.toLowerCase().replace(/^weapon_/, '')
  if (name.startsWith('knife') || name.startsWith('bayonet')) {
    return 'Knife'
  }
  return LABELS.get(name) ?? weapon
}
