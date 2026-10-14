import { Link } from 'react-router-dom'
import SceneryBand from '@/components/SceneryBand'
import { useT } from '@/i18n'
import { mapSceneryUrl } from '@/lib/mapArt'
import { useLoadedUrl } from '@/lib/useLoadedUrl'

/** The picture behind the page's header: Dust2. */
const SCENERY = mapSceneryUrl('de_dust2')

/**
 * The catch-all route: a mistyped URL gets a message and a way back instead of a blank page. The header stands on the
 * scenery of Dust2 (`SceneryBand`), at least 96px high, with a large mono `404` above the title, both on a scrim of the
 * page's colour.
 */
export default function NotFoundPage() {
  const t = useT()
  const [shown, onLoad] = useLoadedUrl(SCENERY)
  return (
    <main className="container-page flex flex-col items-start gap-6 pt-9 pb-18">
      <div className="relative isolate flex min-h-24 w-full flex-col justify-center">
        {SCENERY && <SceneryBand url={SCENERY} shown={shown} onLoad={onLoad} />}
        <div className="scenery-scrim flex flex-col gap-2 self-start [--scrim-bleed-x:0.75rem] [--scrim-color:var(--background)] [--scrim-fade-x:0.75rem]">
          <p className="score-big text-subtle">404</p>
          <h1 className="heading-page">{t.notFound.title}</h1>
        </div>
      </div>
      <Link
        to="/"
        className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-muted-foreground"
      >
        {t.notFound.back}
      </Link>
    </main>
  )
}
