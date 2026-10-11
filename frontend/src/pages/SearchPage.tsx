import { type SyntheticEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlayerSearch } from '@/api/queries'
import PlayerHeader from '@/components/PlayerHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/errorMessage'

/** What the backend accepts as a nickname; anything else would only come back as a 400. */
const NICKNAME_PATTERN = /^[A-Za-z0-9_-]{2,32}$/
const INVALID_NICKNAME_MESSAGE = 'Nickname must be 2–32 characters: letters, digits, _ or -'

export default function SearchPage() {
  const [input, setInput] = useState('')
  const [nickname, setNickname] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const search = usePlayerSearch(nickname)

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const candidate = input.trim()
    if (!NICKNAME_PATTERN.test(candidate)) {
      setValidationError(INVALID_NICKNAME_MESSAGE)
      setNickname('')
      return
    }
    setValidationError(null)
    if (candidate === nickname) {
      // The query key is unchanged, so asking again has to be explicit (the last attempt may have failed).
      void search.refetch()
    } else {
      setNickname(candidate)
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Player search</h1>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          name="nickname"
          aria-label="nickname"
          placeholder="FACEIT nickname"
          autoComplete="off"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-invalid={validationError ? true : undefined}
          aria-describedby={validationError ? 'nickname-error' : undefined}
        />
        <Button type="submit">Search</Button>
      </form>
      <div aria-live="polite" className="flex flex-col gap-2">
        {validationError && (
          <p id="nickname-error" className="text-sm text-destructive">
            {validationError}
          </p>
        )}
        {search.isLoading && (
          <>
            <Skeleton className="h-20 w-full" />
            <span className="sr-only">Searching…</span>
          </>
        )}
        {search.isError && <p className="text-sm text-destructive">{errorMessage(search.error)}</p>}
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
