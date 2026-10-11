import { Link } from 'react-router-dom'
import { useT } from '@/i18n'

/** The catch-all route: a mistyped URL gets a message and a way back instead of a blank page. */
export default function NotFoundPage() {
  const t = useT()
  return (
    <main className="container-page flex flex-col items-start gap-6 pt-9 pb-18">
      <h1 className="text-[30px] leading-[1.2] font-semibold tracking-[-0.02em]">{t.notFound.title}</h1>
      <Link
        to="/"
        className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-muted-foreground"
      >
        {t.notFound.back}
      </Link>
    </main>
  )
}
