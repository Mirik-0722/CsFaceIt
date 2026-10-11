import { type SyntheticEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlayerSearch } from '@/api/queries'
import PlayerHeader from '@/components/PlayerHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errorMessage'

/** What the backend accepts as a nickname; anything else would only come back as a 400. */
const NICKNAME_PATTERN = /^[A-Za-z0-9_-]{2,32}$/

export default function SearchPage() {
  const t = useT()
  const [input, setInput] = useState('')
  const [nickname, setNickname] = useState('')
  // A flag, not the message: the text is looked up on every render, so a language switch changes it at once.
  const [invalidNickname, setInvalidNickname] = useState(false)
  const search = usePlayerSearch(nickname)

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

  return (
    <main className="container-page pt-18 pb-18">
      {/* The hero of spec 6: a mono label, the headline, one sentence, then the search itself. */}
      <p className="label-mono">{t.home.eyebrow}</p>
      <h1 className="mt-4 text-[clamp(40px,5vw,72px)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
        {t.home.title}
      </h1>
      <p className="mt-5 max-w-[30em] text-lg text-pretty text-muted-foreground">{t.home.subtitle}</p>
      {/* The field and the button share a row from 640px up and stack below that. */}
      <form onSubmit={handleSubmit} className="mt-9 flex max-w-[560px] flex-col gap-3 sm:flex-row">
        <Input
          name="nickname"
          className="h-13"
          aria-label={t.home.nicknameLabel}
          placeholder={t.home.placeholder}
          autoComplete="off"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-invalid={invalidNickname ? true : undefined}
          aria-describedby={invalidNickname ? 'nickname-error' : undefined}
        />
        <Button type="submit" size="lg" className="w-full sm:w-auto">
          {t.home.submit}
        </Button>
      </form>
      <div aria-live="polite" className="mt-6 flex max-w-[560px] flex-col gap-2">
        {invalidNickname && (
          <p id="nickname-error" className="text-sm text-destructive">
            {t.home.invalidNickname}
          </p>
        )}
        {search.isLoading && (
          <>
            <Skeleton className="h-20 w-full" />
            <span className="sr-only">{t.home.searching}</span>
          </>
        )}
        {search.isError && <p className="text-sm text-destructive">{errorMessage(search.error, t)}</p>}
        {search.data && (
          <Link to={`/players/${encodeURIComponent(search.data.playerId)}`} className="block">
            <PlayerHeader player={search.data} />
          </Link>
        )}
      </div>
    </main>
  )
}
