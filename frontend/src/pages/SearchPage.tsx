import { type SyntheticEvent, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlayerSearch } from '@/api/queries'
import ClipKindsSection from '@/components/landing/ClipKindsSection'
import ClosingCall from '@/components/landing/ClosingCall'
import HeroIllustration from '@/components/landing/HeroIllustration'
import StatisticsSection from '@/components/landing/StatisticsSection'
import StepsSection from '@/components/landing/StepsSection'
import PlayerHeader from '@/components/PlayerHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'

/** What the backend accepts as a nickname; anything else would only come back as a 400. */
const NICKNAME_PATTERN = /^[A-Za-z0-9_-]{2,32}$/

/**
 * The home page (spec 4, screen 1): the player search, which is also the call to action of the landing page built
 * around it. Under the hero come what the product does (three steps, two kinds of clip, statistics) and a last call
 * that leads back to the field. The sections only tell about what a search leads to: none of them has a link.
 */
export default function SearchPage() {
  const t = useT()
  const [input, setInput] = useState('')
  const [nickname, setNickname] = useState('')
  // A flag, not the message: the text is looked up on every render, so a language switch changes it at once.
  const [invalidNickname, setInvalidNickname] = useState(false)
  const search = usePlayerSearch(nickname)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const candidate = input.trim()
    if (!NICKNAME_PATTERN.test(candidate)) {
      setInvalidNickname(true)
      setNickname('')
      return
    }
    setInvalidNickname(false)
    if (candidate === nickname) {
      // The query key is unchanged, so asking again has to be explicit (the last attempt may have failed).
      void search.refetch()
    } else {
      setNickname(candidate)
    }
  }

  /** The button at the foot of the page: puts the visitor in the search field, wherever on the page they are. */
  function focusSearch() {
    const field = inputRef.current
    if (field) {
      // Centred first, and the focus is told not to scroll again: the field is not left at an edge of the window.
      field.scrollIntoView({ block: 'center' })
      field.focus({ preventScroll: true })
    }
  }

  return (
    <main>
      {/* The hero (spec 4, screen 1): the search is its call to action, and beside it, from `lg` up, a picture of what
          the product makes. In the code the search comes first, so that it is the first stop of the keyboard. */}
      <section className="container-page pt-18 pb-22">
        {/* The columns take their widths from the mockup: 400px and 480px to start from, the free room shared 1 to
            1.35. */}
        <div className="flex flex-col gap-x-14 gap-y-12 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-col items-start gap-6 lg:flex-[1_1_400px]">
            <p className="label-mono">{t.home.eyebrow}</p>
            <h1 className="text-[clamp(40px,5vw,72px)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
              {t.home.title}
            </h1>
            <p className="max-w-[30em] text-lg text-pretty text-muted-foreground">{t.home.subtitle}</p>
            <div className="w-full">
              {/* The field and the button share a row from 640px up and stack below that. */}
              <form onSubmit={handleSubmit} className="flex max-w-[560px] flex-col gap-3 sm:flex-row">
                {/* A real label, hidden: the placeholder is not a name, and it goes away as soon as something is
                    typed. */}
                <label htmlFor="nickname" className="sr-only">
                  {t.home.nicknameLabel}
                </label>
                {/* FACEIT's nickname lookup is case-sensitive: a phone must not capitalise or correct what is
                    typed. */}
                <Input
                  id="nickname"
                  name="nickname"
                  ref={inputRef}
                  className="h-13"
                  placeholder={t.home.placeholder}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  aria-invalid={invalidNickname ? true : undefined}
                  aria-describedby={invalidNickname ? 'nickname-error' : undefined}
                />
                <Button type="submit" size="lg" className="w-full sm:w-auto">
                  {t.home.submit}
                </Button>
              </form>
              {/* Always in the page, so that what lands in it is announced; it takes room only when it holds
                  something. */}
              <div aria-live="polite" className="flex max-w-[560px] flex-col gap-2 not-empty:mt-6">
                {invalidNickname && (
                  <p id="nickname-error" className="text-sm text-destructive">
                    {t.home.invalidNickname}
                  </p>
                )}
                {search.isLoading && (
                  <>
                    <p className="label-mono">{t.home.searching}</p>
                    <Skeleton className="h-20 w-full" />
                  </>
                )}
                {search.isError && <p className="text-sm text-destructive">{errorMessage(search.error, t)}</p>}
                {search.data && (
                  <Link to={`/players/${encodeURIComponent(search.data.playerId)}`} className="block">
                    <PlayerHeader player={search.data} />
                  </Link>
                )}
              </div>
            </div>
          </div>
          <HeroIllustration className="lg:flex-[1.35_1_480px]" />
        </div>
      </section>
      <StepsSection />
      <ClipKindsSection />
      <StatisticsSection />
      <ClosingCall onFindPlayer={focusSearch} />
    </main>
  )
}
