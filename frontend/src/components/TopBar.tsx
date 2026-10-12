import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useMe } from '@/api/auth'
import AccountMenu from '@/components/AccountMenu'
import LanguageSwitch from '@/components/LanguageSwitch'
import Logo, { WORDMARK } from '@/components/Logo'
import SignInDialog from '@/components/SignInDialog'
import TopBarSearch from '@/components/TopBarSearch'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
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
 * (matches, clips, statistics), the player ones when a FACEIT player is linked. The parts that depend on the answer
 * of `/auth/me` wait for it, so that nothing is drawn for a moment and then moved.
 */
export default function TopBar() {
  const t = useT()
  const me = useMe()
  const { pathname } = useLocation()
  const [signInOpen, setSignInOpen] = useState(false)
  const settled = !me.isPending
  // A failed answer is a visitor who is not signed in: the bar still has to work when the backend does not.
  const user = me.data ?? null
  const home = pathname === '/'
  // The landing page's bar is the lighter one: anchors of 44px and a right side that does not wrap by itself.
  const landing = home && user === null
  const playerPath = user?.playerId ? `/players/${encodeURIComponent(user.playerId)}` : null

  const itemClass = cn(ITEM, landing ? 'min-h-11' : 'min-h-17')
  let navigation = null
  if (settled && landing) {
    navigation = (
      <nav aria-label={t.auth.sectionsLabel} className="flex flex-auto flex-wrap gap-1">
        {ANCHORS.map(({ href, label }) => (
          <a key={href} href={href} className={itemClass}>
            {t.auth[label]}
          </a>
        ))}
      </nav>
    )
  } else if (settled) {
    navigation = (
      <nav aria-label={t.nav.label} className="flex flex-auto flex-wrap gap-1 self-stretch">
        {playerPath && (
          <NavLink to={`${playerPath}/matches`} className={cn(itemClass, CURRENT)}>
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
    <header className="border-b border-border">
      {/* The line spans the window, the content sits in the page column; on a narrow screen the parts wrap. */}
      <div className={cn('container-page flex min-h-17 flex-wrap items-center gap-x-7', landing && 'gap-y-1')}>
        {/* The name starts with the visible wordmark, so that saying what is on the screen reaches the link. */}
        <Link to="/" aria-label={`${WORDMARK} · ${t.app.homeLink}`} className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
        {/* The navigation takes the free room (`flex-auto`: from its own width, so that on a narrow screen it wraps as
            a whole to a row of its own and does not squeeze in beside the logo). Until the answer is here the room is
            kept, so that the right side stays on the right. */}
        {navigation ?? <div className="flex-1" />}
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', landing ? 'gap-x-2' : 'py-3')}>
          {!home && <TopBarSearch />}
          <LanguageSwitch />
          {settled &&
            (user ? (
              <AccountMenu me={user} />
            ) : (
              <Button type="button" variant="outline" onClick={() => setSignInOpen(true)}>
                {t.auth.signIn}
              </Button>
            ))}
        </div>
      </div>
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </header>
  )
}
