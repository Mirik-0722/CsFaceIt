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
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">{t.home.title}</h1>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          name="nickname"
          aria-label={t.home.nicknameLabel}
          placeholder={t.home.placeholder}
          autoComplete="off"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-invalid={invalidNickname ? true : undefined}
          aria-describedby={invalidNickname ? 'nickname-error' : undefined}
        />
        <Button type="submit">{t.home.submit}</Button>
      </form>
      <div aria-live="polite" className="flex flex-col gap-2">
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
          <Link
            to={`/players/${encodeURIComponent(search.data.playerId)}`}
            className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <PlayerHeader player={search.data} />
          </Link>
        )}
      </div>
    </main>
  )
}
