import { WORDMARK } from '@/components/Logo'
import { useT } from '@/i18n'

// Read when the page loads, not on every render (a render has to give the same result each time).
const YEAR = new Date().getFullYear()

/** The foot of every page: the name with the year, and the notice that it is not affiliated with Valve, Steam or FACEIT. */
export default function Footer() {
  const t = useT()
  return (
    <footer className="border-t border-border">
      <div className="container-page flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 py-6 text-xs leading-normal text-subtle">
        <p className="font-mono">{`${WORDMARK} · ${YEAR}`}</p>
        <p>{t.footer.disclaimer}</p>
      </div>
    </footer>
  )
}
