import { House, List, LogIn, User, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMe } from '@/api/auth'
import { useT } from '@/i18n'
import { type BottomNavItem, bottomNavItems, hasBottomNav } from '@/lib/bottomNav'
import { cn } from '@/lib/utils'

const ICON = { size: 22, strokeWidth: 1.75, 'aria-hidden': true } as const

/** The clips' icon: a strip of film with the play mark in its frame (lucide has the two apart only). */
function FilmPlay() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 7.5h4M3 12h4M3 16.5h4M17 7.5h4M17 12h4M17 16.5h4" />
      <path d="M10.5 9.5v5l4-2.5z" />
    </svg>
  )
}

const ICONS: Record<BottomNavItem['key'], ReactNode> = {
  home: <House {...ICON} />,
  matches: <List {...ICON} />,
  highlights: <Zap {...ICON} />,
  clips: <FilmPlay />,
  profile: <User {...ICON} />,
  signIn: <LogIn {...ICON} />,
}

// An item takes its whole column and the bar's 64px, so the target is far over 44px. The focus ring is drawn inside,
// because the item reaches the edges of the bar. The current one is brighter and bolder and has the REC line at its
// top, so the state is not carried by colour alone.
const ITEM =
  'relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-4 text-subtle hover:text-foreground focus-visible:-outline-offset-2 aria-[current=page]:font-semibold aria-[current=page]:text-foreground'

/**
 * The bottom navigation of a phone (spec 3.2 of the phone view): the sections a visitor moves between, one tap away,
 * fixed to the bottom of the screen under `md`. What it holds depends on who is looking (`bottomNavItems`); "Sign in"
 * opens the sign-in dialog of the layout (`onSignIn`). It comes after the footer in the page, so Tab reaches it last.
 *
 * Until `/auth/me` has answered, the bar is drawn at its size with the items of a visitor who is not signed in (the
 * common case), which cannot be seen, reached or read: as the top bar does, nothing moves when the answer says "not
 * signed in", and a signed-in visitor gets the one change.
 */
export default function BottomNav({ onSignIn }: { onSignIn: () => void }) {
  const t = useT()
  const me = useMe()
  const { pathname } = useLocation()
  const pending = me.isPending
  // A failed answer is a visitor who is not signed in, as in the top bar.
  const user = me.data ?? null
  if (!hasBottomNav(user !== null, pathname)) {
    return null
  }
  const items = bottomNavItems(user, pathname)
  return (
    // Over the page and under the dialogs and menus (z-50). The safe area of a phone without a home button is added
    // under the 64px of the items, in the bar's colour, where the browser reports one (see `--bottom-nav-h`).
    <nav
      aria-label={t.bottomNav.label}
      aria-hidden={pending || undefined}
      inert={pending}
      data-bottom-nav=""
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {/* Equal columns, however many items the visitor has (two to four). */}
      <div className={cn('grid h-16 auto-cols-fr grid-flow-col', pending && 'invisible')}>
        {items.map((item) => {
          const content = (
            <>
              {/* The REC line along the top edge of the current item. */}
              {item.current && (
                <span aria-hidden="true" className="absolute top-0 left-1/2 h-0.5 w-7 -translate-x-1/2 bg-rec" />
              )}
              {ICONS[item.key]}
              <span className="max-w-full truncate">{t.bottomNav[item.key]}</span>
            </>
          )
          return item.href === null ? (
            <button key={item.key} type="button" onClick={onSignIn} className={ITEM}>
              {content}
            </button>
          ) : (
            <Link
              key={item.key}
              to={item.href}
              aria-current={item.current ? 'page' : undefined}
              className={ITEM}
            >
              {content}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
