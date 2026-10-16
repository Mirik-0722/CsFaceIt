import { useId, useState, type KeyboardEvent, type Ref, type SyntheticEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'

interface TopBarSearchProps {
  /** The field, for the phone's top bar, which puts the focus there when it opens the search. */
  inputRef?: Ref<HTMLInputElement>
  /** Escape in the search: the phone's top bar closes it (on a wider screen, where it is always there, it is not set). */
  onEscape?: () => void
  /** A search was sent: the phone's top bar closes the panel it is in. */
  onSearch?: () => void
}

/**
 * The player search of the top bar (every page but the home page, which has its own): a field with the magnifier. The
 * search itself is the home page's: Enter takes the visitor there with the nickname in the address (`/?q=…`), and the
 * page looks it up. On a phone it is the panel that the top bar's search button opens under the bar, across the width.
 */
export default function TopBarSearch({ inputRef, onEscape, onSearch }: TopBarSearchProps) {
  const t = useT()
  const navigate = useNavigate()
  const fieldId = useId()
  const [value, setValue] = useState('')

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const nickname = value.trim()
    if (nickname !== '') {
      onSearch?.()
      void navigate(`/?q=${encodeURIComponent(nickname)}`)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault()
      onEscape()
    }
  }

  return (
    <form role="search" onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="relative flex items-center">
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
          the mockup's 14px from `sm` up and 16px below, because an iPhone zooms the page into a field under 16px. The
          field is 200px wide in the bar of a wider screen and takes the panel's width on a phone. */}
      <Input
        ref={inputRef}
        id={fieldId}
        name="q"
        type="search"
        className="pr-3 pl-9 text-base sm:text-sm md:w-50"
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
