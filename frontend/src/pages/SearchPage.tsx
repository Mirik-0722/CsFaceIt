import { type SyntheticEvent, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMe } from '@/api/auth'
import { usePlayerSearch } from '@/api/queries'
import ClipKindsSection from '@/components/landing/ClipKindsSection'
import ClosingCall from '@/components/landing/ClosingCall'
import HeroIllustration from '@/components/landing/HeroIllustration'
import HeroSignIn from '@/components/landing/HeroSignIn'
import StatisticsSection from '@/components/landing/StatisticsSection'
import StepsSection from '@/components/landing/StepsSection'
import PlayerHeader from '@/components/PlayerHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'
import { cn } from '@/lib/utils'

/** What the backend accepts as a nickname; anything else would only come back as a 400. */
const NICKNAME_PATTERN = /^[A-Za-z0-9_-]{2,32}$/

/**
 * The home page (spec 4, screen 1): the landing page. Its hero offers signing in first and, under a line, the player
 * search for a visitor who does not want to. Under the hero come what the product does (three steps, two kinds of
 * clip, statistics) and a last call. The sections only tell about what the product does: none of them has a link.
 *
 * Two things arrive in the address. `?q=` is the nickname that the top bar's search handed over: the search for it
 * runs at once. `?login=failed` is a sign-in that did not work: the hero says so once, and the address is cleaned.
 */
export default function SearchPage() {
  const t = useT()
  const me = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  // Read once, when the page opens: what the visitor types afterwards is theirs, and the address does not follow it.
  const [handedOver] = useState(() => (searchParams.get('q') ?? '').trim())
  const [input, setInput] = useState(handedOver)
  const [nickname, setNickname] = useState(() => (NICKNAME_PATTERN.test(handedOver) ? handedOver : ''))
  // A flag, not the message: the text is looked up on every render, so a language switch changes it at once.
  const [invalidNickname, setInvalidNickname] = useState(() => handedOver !== '' && !NICKNAME_PATTERN.test(handedOver))
  // The failure is kept in the state, and the address is cleaned (below), so that a reload or a shared link does not
  // repeat it.
  const [loginFailed] = useState(() => searchParams.get('login') === 'failed')
  const search = usePlayerSearch(nickname)
  const inputRef = useRef<HTMLInputElement>(null)

  const loginInAddress = searchParams.has('login')
  useEffect(() => {
    if (loginInAddress) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.delete('login')
          return next
        },
        { replace: true },
      )
    }
  }, [loginInAddress, setSearchParams])

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
      {/* The hero (spec 4, screen 1): signing in is its call to action, the nickname search sits under a line for the
          visitor who does not want to, and beside them, from `lg` up, a picture of what the product makes. In the code
          the buttons come first, so that they are the first stops of the keyboard after the top bar. */}
      <section className="container-page pt-18 pb-22">
        {/* The columns take their widths from the mockup: 400px and 480px to start from, the free room shared 1 to
            1.35. They are top-aligned: the column on the left grows with a search (the skeleton, the card, an error),
            and a centred column would move the headline and the field when it did. */}
        <div className="flex flex-col gap-x-14 gap-y-12 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-col items-start gap-6 lg:flex-[1_1_400px]">
            <p className="label-mono">{t.home.eyebrow}</p>
            <h1 className="text-[clamp(40px,5vw,72px)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
              {t.home.title}
            </h1>
            <p className="max-w-[30em] text-lg text-pretty text-muted-foreground">{t.home.subtitle}</p>
            <HeroSignIn failed={loginFailed} />
            <div className="mt-1 w-full border-t border-border pt-5">
              {/* The words that introduce the search, read before it. They are not the field's label (that is `nickname`,
                  below) and do not name the form: a second label would make two things of the page answer to the name
                  of the field. A visitor who is signed in is not told "or without signing in"; until the answer is
                  here the words are not shown. */}
              <p className={cn('label-mono mb-2.5', me.isPending && 'invisible')}>
                {me.data ? t.auth.byNickname : t.auth.orByNickname}
              </p>
              {/* The field and the button share a row where they fit and wrap where they do not. */}
              <form role="search" onSubmit={handleSubmit} className="flex flex-wrap gap-3">
                {/* A real label, hidden: the placeholder is not a name, and it goes away as soon as something is
                    typed. */}
                <label htmlFor="nickname" className="sr-only">
                  {t.home.nicknameLabel}
                </label>
                {/* FACEIT's nickname lookup is case-sensitive: a phone must not capitalise or correct what is
                    typed. The text is the mockup's 15px from `sm` up and 16px below, because an iPhone zooms the page
                    into a field under 16px. */}
                <Input
                  id="nickname"
                  name="nickname"
                  ref={inputRef}
                  className="flex-[1_1_260px] text-base sm:text-[15px]"
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
                <Button type="submit" variant="outline">
                  {t.home.submit}
                </Button>
              </form>
              {/* Always in the page, so that what lands in it is announced; it takes room only when it holds
                  something. */}
              <div aria-live="polite" className="flex flex-col gap-2 not-empty:mt-6">
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
