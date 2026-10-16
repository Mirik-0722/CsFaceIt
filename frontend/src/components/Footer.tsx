import LanguageSwitch from '@/components/LanguageSwitch'
import { WORDMARK } from '@/components/Logo'
import { useT } from '@/i18n'

// Read when the page loads, not on every render (a render has to give the same result each time).
const YEAR = new Date().getFullYear()

/**
 * The foot of every page: the name with the year, and the notice that it is not affiliated with Valve, Steam or FACEIT.
 * On a phone it also holds the language for everyone (the top bar has no room for it there), on a row of its own above
 * the two.
 */
export default function Footer() {
  const t = useT()
  return (
    <footer className="border-t border-border">
      <div className="container-page flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 py-6 text-xs leading-normal text-subtle">
        {/* The glyphs line up with the texts under them: the 44px targets reach past the column on the left. */}
        <LanguageSwitch className="-my-2.5 -ml-3 w-full md:hidden" />
        <p className="font-mono">{`${WORDMARK} · ${YEAR}`}</p>
        <p>{t.footer.disclaimer}</p>
      </div>
    </footer>
  )
}
