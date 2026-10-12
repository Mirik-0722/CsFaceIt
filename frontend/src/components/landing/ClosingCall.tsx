import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

const TITLE_ID = 'home-closing-title'

/**
 * The last word of the page: one line and the button that takes the visitor back to the search field. It is a button,
 * not a link: it acts on this page, and the page has no link but the card of the player that was found.
 */
export default function ClosingCall({ onFindPlayer }: { onFindPlayer: () => void }) {
  const t = useT()
  return (
    <section aria-labelledby={TITLE_ID} className="border-t border-border">
      <div className="container-page flex flex-wrap items-center justify-between gap-x-10 gap-y-6 py-16">
        <h2
          id={TITLE_ID}
          className="flex-1 basis-[420px] text-[clamp(28px,3.2vw,44px)] leading-[1.08] font-semibold tracking-[-0.03em] text-balance"
        >
          {t.home.closing.line}
        </h2>
        <Button type="button" size="lg" className="w-full sm:w-auto" onClick={onFindPlayer}>
          {t.home.closing.button}
        </Button>
      </div>
    </section>
  )
}
