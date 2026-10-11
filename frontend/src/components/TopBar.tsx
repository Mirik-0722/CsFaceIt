import { Link } from 'react-router-dom'
import LanguageSwitch from '@/components/LanguageSwitch'
import Logo from '@/components/Logo'
import { useT } from '@/i18n'

/** The bar above every page: the logo (a link home) and the language buttons. Navigation comes with later plans. */
export default function TopBar() {
  const t = useT()
  return (
    <header className="border-b border-border">
      {/* The line spans the window, the content sits in the page column; on a narrow screen the items wrap. */}
      <div className="container-page flex min-h-17 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
        <Link to="/" aria-label={t.app.homeLink} className="inline-flex min-h-11 items-center">
          <Logo />
        </Link>
        <LanguageSwitch />
      </div>
    </header>
  )
}
