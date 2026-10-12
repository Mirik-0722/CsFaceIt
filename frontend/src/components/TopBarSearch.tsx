import { useId, useState, type SyntheticEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'

/**
 * The player search of the top bar (every page but the home page, which has its own): a field with the magnifier. The
 * search itself is the home page's: Enter takes the visitor there with the nickname in the address (`/?q=…`), and the
 * page looks it up.
 */
export default function TopBarSearch() {
  const t = useT()
  const navigate = useNavigate()
  const fieldId = useId()
  const [value, setValue] = useState('')

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const nickname = value.trim()
    if (nickname !== '') {
      void navigate(`/?q=${encodeURIComponent(nickname)}`)
    }
  }

  return (
    <form role="search" onSubmit={handleSubmit} className="relative flex items-center">
      {/* A real label, hidden: the placeholder is not a name, and it goes away as soon as something is typed. */}
      <label htmlFor={fieldId} className="sr-only">
        {t.auth.searchLabel}
      </label>
      {/* Decorative: the label names the field. */}
      <svg
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="pointer-events-none absolute left-3 size-4 text-subtle"
      >
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {/* FACEIT's nickname lookup is case-sensitive: a phone must not capitalise or correct what is typed. The text is
          the mockup's 14px from `sm` up and 16px below, because an iPhone zooms the page into a field under 16px. */}
      <Input
        id={fieldId}
        name="q"
        type="search"
        className="w-50 pr-3 pl-9 text-base sm:text-sm"
        placeholder={t.auth.searchPlaceholder}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  )
}
