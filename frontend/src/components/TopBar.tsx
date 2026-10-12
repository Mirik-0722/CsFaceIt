import { Link, NavLink } from 'react-router-dom'
import LanguageSwitch from '@/components/LanguageSwitch'
import Logo, { WORDMARK } from '@/components/Logo'
import { useT } from '@/i18n'

/**
 * The bar above every page: the logo (a link home), the navigation and the language buttons. The navigation has the
 * one page that is not reached from a player or a match; the other items of the mockup come with later plans.
 */
export default function TopBar() {
  const t = useT()
  return (
    <header className="border-b border-border">
      {/* The line spans the window, the content sits in the page column; on a narrow screen the items wrap. */}
      <div className="container-page flex min-h-17 flex-wrap items-center gap-x-7 gap-y-2 py-3">
        {/* The name starts with the visible wordmark, so that saying what is on the screen reaches the link. */}
        <Link to="/" aria-label={`${WORDMARK} · ${t.app.homeLink}`} className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
        <nav aria-label={t.nav.label} className="-mx-3 flex flex-wrap">
          {/* The page the visitor is on is brighter and underlined, so the state is not carried by colour alone. */}
          <NavLink
            to="/clips"
            className="inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground"
          >
            {t.nav.clips}
          </NavLink>
        </nav>
        <LanguageSwitch />
      </div>
    </header>
  )
}
