// A FACEIT match id: `1-` and a UUID (the twin of the backend's `demo/DemoFileName.matchId`).
const MATCH_ID = '1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// FACEIT names the file it hands out `<match id>-<map number>-<half number>.dem`, and the demo may be compressed
// (`.dem.zst`, `.dem.gz`): the match id is the start, and what follows it is what it takes to be a demo. A browser that
// saves a file again adds a counter (`… (1).dem.zst`, or `…(1).dem.zst` without the space), before the extensions,
// between them or after them.
const COPY = '(?: ?\\(\\d+\\))?'
const DEMO_NAME = new RegExp(`^(${MATCH_ID})(?:-\\d+-\\d+)?${COPY}\\.dem${COPY}(?:\\.[a-z0-9]+${COPY})*$`, 'i')

// The two names Valve gives the demo of a matchmaking match, read as the backend's `demo/DemoFileName` reads them (plan
// 6c): its replay servers' `<match id>_<number>.dem.bz2` (`003744426367741165791_1234567890.dem.bz2`), also without
// the compression or with another one, and the CS2 client's `match730_<match id>_<number>_<number>.dem`. The match id
// is zero-padded to 21 digits; what follows `.dem` is at most one more extension, and either may carry a browser's
// counter.
const VALVE_TAIL = `${COPY}\\.dem${COPY}(?:\\.[a-z0-9]+${COPY})?`
const VALVE_REPLAY_NAME = new RegExp(`^(\\d{1,32})_\\d{1,20}${VALVE_TAIL}$`, 'i')
const VALVE_CLIENT_NAME = new RegExp(`^match730_(\\d{1,32})_\\d{1,20}_\\d{1,20}${VALVE_TAIL}$`, 'i')

/** The largest Valve match id: an unsigned 64-bit number. */
const MAX_VALVE_MATCH_ID = 2n ** 64n - 1n

/**
 * The match of this site that a Valve match id written in a file name stands for: `mm-` and the id without the zeros
 * Valve pads it with. A real id is 15 to 20 digits and fits in 64 bits; anything else is no Valve match (a date, or a
 * counter a visitor named the file by), and the name then carries no match id.
 */
function matchmakingId(digits: string): string | null {
  const id = digits.replace(/^0+/, '')
  return id.length >= 15 && id.length <= 20 && BigInt(id) <= MAX_VALVE_MATCH_ID ? `mm-${id}` : null
}

/**
 * The match a demo file belongs to, from its name: `<FACEIT match id>-1-1.dem`, `….dem.zst` or `….dem.gz`, or one of
 * Valve's two names of a matchmaking match (`mm-<match id>`). The folders before the name (a pasted path) are ignored.
 * Null for a name that carries no match id: a demo the visitor has renamed.
 */
export function matchIdFromDemoName(name: string): string | null {
  const file = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const faceit = DEMO_NAME.exec(file)
  if (faceit) {
    return faceit[1].toLowerCase()
  }
  const valve = VALVE_REPLAY_NAME.exec(file) ?? VALVE_CLIENT_NAME.exec(file)
  return valve ? matchmakingId(valve[1]) : null
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
