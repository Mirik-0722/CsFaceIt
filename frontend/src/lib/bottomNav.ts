import type { MeResponse } from '@/api/auth'
import { playerPath, steamPlayerId } from '@/lib/matchSource'

/** An item of the phone's bottom navigation (spec 3.2 of the phone view). */
export type BottomNavItem = {
  key: 'home' | 'matches' | 'highlights' | 'clips' | 'profile' | 'signIn'
  /** Where the item leads; `null` for "Sign in", which is a button that opens the sign-in dialog. */
  href: string | null
  /** Whether the page on screen is the item's (the bar marks it with `aria-current="page"`). */
  current: boolean
}

/** The montage editor of a match, which has a sticky order bar of its own at the bottom of a phone's screen. */
const MONTAGE_PATH = /^\/matches\/[^/]+\/montaj\/?$/

/**
 * Whether the bottom navigation is drawn on this page. Not in the montage editor, whose order bar takes the bottom of
 * the screen, and not on the landing page of a visitor who is not signed in, whose hero is the way in. A visitor whose
 * `/auth/me` has not answered yet counts as not signed in (the common case): the bar comes on the home page only if
 * the answer says otherwise.
 */
export function hasBottomNav(signedIn: boolean, pathname: string): boolean {
  if (MONTAGE_PATH.test(pathname)) {
    return false
  }
  return signedIn || pathname !== '/'
}

/**
 * The items of the bottom navigation for the visitor on the page at `pathname`. A signed-in visitor with a player (the
 * FACEIT one, else the one its SteamID is known by: the rule of `ownMatchesPath`) has the pages of that player and the
 * clips; a visitor who is not signed in (`null`, or `undefined` while `/auth/me` has not answered) has the home page,
 * the clips and the way in; a signed-in account with neither a player nor a SteamID has the home page and the clips.
 */
export function bottomNavItems(me: MeResponse | null | undefined, pathname: string): BottomNavItem[] {
  const playerId = me ? (me.playerId ?? (me.steamId ? steamPlayerId(me.steamId) : null)) : null
  let items: [BottomNavItem['key'], string | null][]
  if (playerId !== null) {
    items = [
      ['matches', playerPath(playerId, 'matches')],
      ['highlights', playerPath(playerId, 'highlights')],
      ['clips', '/clips'],
      ['profile', playerPath(playerId)],
    ]
  } else if (me) {
    items = [
      ['home', '/'],
      ['clips', '/clips'],
    ]
  } else {
    items = [
      ['home', '/'],
      ['clips', '/clips'],
      ['signIn', null],
    ]
  }
  return items.map(([key, href]) => ({ key, href, current: isCurrent(key, href, pathname) }))
}

/**
 * Whether the page at `pathname` is the item's: its own address, or a page under it (`/clips/:id` is in "Clips"). A
 * match is reached from the list of matches, so `/matches/:id` is in "Matches" too. The profile is its own address only:
 * the pages under it are the matches and the highlights, which have items of their own. The home page is `/` only,
 * which every address starts with.
 */
function isCurrent(key: BottomNavItem['key'], href: string | null, pathname: string): boolean {
  if (href === null) {
    return false
  }
  if (key === 'profile' || key === 'home') {
    return pathname === href
  }
  if (key === 'matches' && pathname.startsWith('/matches/')) {
    return true
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}
