import { Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useMe } from '@/api/auth'
import AccountMenu from '@/components/AccountMenu'
import LanguageSwitch from '@/components/LanguageSwitch'
import Logo, { WORDMARK } from '@/components/Logo'
import TopBarSearch from '@/components/TopBarSearch'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { ownMatchesPath } from '@/lib/matchSource'
import { cn } from '@/lib/utils'

// An item of the navigation (spec 3). The ring is drawn inside, because the item reaches the edges of the bar.
const ITEM =
  'flex items-center px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:-outline-offset-2'
// The page the visitor is on is brighter and has the 2px line along the foot of the bar, so the state is not carried
// by colour alone.
const CURRENT = 'aria-[current=page]:text-foreground aria-[current=page]:shadow-[inset_0_-2px_0_var(--foreground)]'

/** What the landing page's anchors lead to: the ids of its sections. */
const ANCHORS = [
  { href: '#steps', label: 'howItWorks' },
  { href: '#kinds', label: 'clipKinds' },
  { href: '#stats', label: 'statistics' },
] as const

/**
 * The bar above every page (spec 6): the logo, the navigation, and on the right the player search, the language and
 * the visitor's way in. The navigation depends on who is looking. A visitor who is not signed in finds, on the home
 * page, the sections of the landing page; elsewhere "Clips". A signed-in visitor always has the pages of their own
 * (matches, clips, statistics), the player ones when a FACEIT player is linked; an account without FACEIT has its
 * matches too, those of its SteamID (CS2 matchmaking).
 *
 * On a phone (under `md`, spec 3.1 of the phone view) the bar is one row of 56px: the logo and, on the right, the
 * search button and the account. The navigation is the bottom bar's (`BottomNav`) and the language is in the account
 * menu and the footer; the search opens under the bar from its button. Off the home page the bar stays at the top of
 * the screen while the page scrolls under it.
 *
 * Until `/auth/me` has answered, the bar of a visitor who is not signed in (the common case) is drawn at its real size
 * but cannot be seen, reached or read (`invisible`, `aria-hidden`, `inert`). When the answer says "not signed in",
 * nothing moves; a signed-in visitor gets the one change, the avatar and the longer navigation.
 */
export default function TopBar({ onSignIn }: { onSignIn: () => void }) {
  const t = useT()
  const me = useMe()
  const location = useLocation()
  const { pathname } = location
  const pending = me.isPending
  // A failed answer is a visitor who is not signed in: the bar still has to work when the backend does not.
  const user = me.data ?? null

  // After a sign-out the focus goes to the button that takes the avatar's place: the avatar it was on is gone, and the
  // browser would drop it on the body. Only a sign-out the visitor chose (`afterSignOut`) does that: a session that
  // ends by itself must not take the focus from whatever the visitor is doing.
  const signInRef = useRef<HTMLButtonElement>(null)
  const afterSignOut = useRef(false)
  useEffect(() => {
    if (afterSignOut.current && user === null) {
      afterSignOut.current = false
      signInRef.current?.focus()
    }
  }, [user])

  // The phone's search, open under the bar. A search that is sent closes it; so does going to another page (a link of
  // the bottom bar), for which it is reset while rendering when the location changes, before the new page is drawn.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLocation, setSearchLocation] = useState(location.key)
  if (searchLocation !== location.key) {
    setSearchLocation(location.key)
    setSearchOpen(false)
  }
  const searchPanelId = useId()
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // The focus goes into the field once it is on screen.
  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus()
    }
  }, [searchOpen])
  // Escape closes the search and gives the focus back to the button that opened it.
  function closeSearch() {
    setSearchOpen(false)
    searchButtonRef.current?.focus()
  }

  const home = pathname === '/'
  // The landing page's bar is the lighter one: anchors of 44px, closer rows and a right side without padding of its own.
  const landing = home && user === null
  const playerPath = user?.playerId ? `/players/${encodeURIComponent(user.playerId)}` : null
  // The visitor's own matches: the FACEIT player's, or for an account without FACEIT those its SteamID is known by
  // (CS2 matchmaking, plan 6c).
  const matchesPath = ownMatchesPath(user)

  // From `md` up the bar is the one of the mockup's desktop (68px, the navigation beside the logo). On a phone the
  // navigation is left to the bottom bar, and the anchors of the landing page to the page itself, which scrolls.
  const itemClass = cn(ITEM, landing ? 'min-h-11' : 'min-h-11 md:min-h-17')
  let navigation
  if (landing) {
    navigation = (
      <nav
        aria-label={t.auth.sectionsLabel}
        aria-hidden={pending || undefined}
        inert={pending}
        className={cn('flex flex-auto flex-wrap gap-1 max-md:hidden', pending && 'invisible')}
      >
        {ANCHORS.map(({ href, label }) => (
          <a key={href} href={href} className={itemClass}>
            {t.auth[label]}
          </a>
        ))}
      </nav>
    )
  } else {
    navigation = (
      <nav
        aria-label={t.nav.label}
        aria-hidden={pending || undefined}
        inert={pending}
        className={cn('flex flex-auto flex-wrap gap-1 self-stretch max-md:hidden', pending && 'invisible')}
      >
        {matchesPath && (
          <NavLink to={matchesPath} className={cn(itemClass, CURRENT)}>
            {t.auth.matches}
          </NavLink>
        )}
        <NavLink to="/clips" className={cn(itemClass, CURRENT)}>
          {t.nav.clips}
        </NavLink>
        {playerPath && (
          <NavLink to={playerPath} end className={cn(itemClass, CURRENT)}>
            {t.auth.statistics}
          </NavLink>
        )}
      </nav>
    )
  }

  return (
    // On a phone, off the home page, the bar stays at the top of the screen, over the page (and under the dialogs and
    // menus, z-50); its ground is the page's own (`top-bar-ground`), so it cannot be told from the page until something
    // scrolls under it. On the home page the landing page's backdrop is behind the bar, so it scrolls with the page.
    <header
      className={cn('border-b border-border', !home && 'max-md:top-bar-ground max-md:sticky max-md:top-0 max-md:z-40')}
    >
      {/* The line spans the window, the content sits in the page column; on a narrow screen the parts wrap. */}
      <div
        className={cn(
          'container-page flex min-h-14 flex-wrap items-center gap-x-7 md:min-h-17',
          landing && 'gap-y-1',
        )}
      >
        {/* The name starts with the visible wordmark, so that saying what is on the screen reaches the link. */}
        <Link to="/" aria-label={`${WORDMARK} · ${t.app.homeLink}`} className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
        {/* The navigation takes the free room (`flex-auto`: from its own width, so that on a narrow screen it wraps as
            a whole to a row of its own and does not squeeze in beside the logo). */}
        {navigation}
        <div
          className={cn(
            'ml-auto flex flex-wrap items-center gap-x-3 gap-y-2',
            landing ? 'gap-x-2' : 'py-1.5 md:py-3',
          )}
        >
          {!home && (
            <>
              {/* The phone's way to the search: it opens the panel under the bar, and closes it again. */}
              <Button
                ref={searchButtonRef}
                type="button"
                variant="ghost"
                size="icon"
                aria-expanded={searchOpen}
                aria-controls={searchPanelId}
                aria-label={searchOpen ? t.topBar.searchClose : t.topBar.searchOpen}
                onClick={() => setSearchOpen((open) => !open)}
                className="text-muted-foreground hover:text-foreground aria-expanded:text-foreground md:hidden"
              >
                {searchOpen ? (
                  <X className="size-5" strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <Search className="size-5" strokeWidth={1.75} aria-hidden="true" />
                )}
              </Button>
              {/* From `md` up the search stands in the bar. On a phone it is the panel under the bar, across the
                  window, while it is open; it comes in from above unless the visitor asked for less motion. */}
              <div
                id={searchPanelId}
                className={cn(
                  // The side padding is the page column's gutter (`container-page`).
                  'max-md:absolute max-md:inset-x-0 max-md:top-full max-md:border-b max-md:border-border max-md:bg-card',
                  'max-md:px-[clamp(16px,4vw,40px)] max-md:py-3',
                  searchOpen
                    ? 'max-md:motion-safe:animate-in max-md:motion-safe:fade-in-0 max-md:motion-safe:slide-in-from-top-2 max-md:motion-safe:duration-150'
                    : 'max-md:hidden',
                )}
              >
                <TopBarSearch
                  inputRef={searchInputRef}
                  onEscape={searchOpen ? closeSearch : undefined}
                  onSearch={() => setSearchOpen(false)}
                />
              </div>
            </>
          )}
          <LanguageSwitch className="max-md:hidden" />
          {user ? (
            <AccountMenu
              me={user}
              onSignedOut={() => {
                afterSignOut.current = true
              }}
            />
          ) : (
            <Button
              ref={signInRef}
              type="button"
              variant="outline"
              aria-hidden={pending || undefined}
              inert={pending}
              className={pending ? 'invisible' : undefined}
              onClick={onSignIn}
            >
              {t.auth.signIn}
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
