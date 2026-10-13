// A FACEIT match id: `1-` and a UUID (the twin of the backend's `demo/DemoFileName.matchId`).
const MATCH_ID = '1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// FACEIT names the file it hands out `<match id>-<map number>-<half number>.dem`, and the demo may be compressed
// (`.dem.zst`, `.dem.gz`): the match id is the start, and what follows it is what it takes to be a demo. A browser that
// saves a file again adds a counter (`… (1).dem.zst`), before the extensions or after them.
const COPY = '(?: \\(\\d+\\))?'
const DEMO_NAME = new RegExp(`^(${MATCH_ID})(?:-\\d+-\\d+)?${COPY}\\.dem(?:\\.[a-z0-9]+)*${COPY}$`, 'i')

/**
 * The match a demo file belongs to, from its name: `<FACEIT match id>-1-1.dem`, `….dem.zst` or `….dem.gz`. The folders
 * before the name (a pasted path) are ignored. Null for a name that carries no match id: a demo the visitor has
 * renamed, or one that does not come from FACEIT.
 */
export function matchIdFromDemoName(name: string): string | null {
  const file = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const found = DEMO_NAME.exec(file)
  return found ? found[1].toLowerCase() : null
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
