// A FACEIT match id: `1-` and a UUID (the twin of the backend's `demo/DemoFileName.matchId`).
const MATCH_ID = '1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// FACEIT names the file it hands out `<match id>-<map number>-<half number>.dem`, and the demo may be compressed
// (`.dem.zst`, `.dem.gz`): the match id is the start, and what follows it is what it takes to be a demo. A browser that
// saves a file again adds a counter (`… (1).dem.zst`, or `…(1).dem.zst` without the space), before the extensions,
// between them or after them.
const COPY = '(?: ?\\(\\d+\\))?'
const DEMO_NAME = new RegExp(`^(${MATCH_ID})(?:-\\d+-\\d+)?${COPY}\\.dem${COPY}(?:\\.[a-z0-9]+${COPY})*$`, 'i')

// Valve names the replay of a matchmaking match `<match id>_<number>.dem.bz2`, the match id written with leading zeros
// (`003744426367741165791_1234567890.dem.bz2`). Its match on this site is `mm-` and the id without them, as the
// coordinator gives it.
const VALVE_DEMO_NAME = new RegExp(`^0*(\\d{1,20})_\\d+${COPY}\\.dem${COPY}(?:\\.[a-z0-9]+${COPY})*$`, 'i')

/**
 * The match a demo file belongs to, from its name: `<FACEIT match id>-1-1.dem`, `….dem.zst` or `….dem.gz`, or Valve's
 * `<match id>_<number>.dem.bz2` for a matchmaking match (`mm-<match id>`). The folders before the name (a pasted path)
 * are ignored. Null for a name that carries no match id: a demo the visitor has renamed.
 */
export function matchIdFromDemoName(name: string): string | null {
  const file = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const faceit = DEMO_NAME.exec(file)
  if (faceit) {
    return faceit[1].toLowerCase()
  }
  const valve = VALVE_DEMO_NAME.exec(file)
  return valve ? `mm-${valve[1]}` : null
}

/**
 * The match a pasted link names, by the file name at the end of its path (the query and the fragment are not part of
 * it). Null when the text is not a link, or the file in it carries no match id.
 */
export function matchIdFromDemoLink(link: string): string | null {
  try {
    const { pathname } = new URL(link.trim())
    return matchIdFromDemoName(decodeURIComponent(pathname))
  } catch {
    return null
  }
}
