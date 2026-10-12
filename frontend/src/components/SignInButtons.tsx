import { useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { type AuthProvider, signInUrl, useAuthProviders } from '@/api/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** The arrow into a doorway at the start of the Steam button (spec 3): decoration, the words beside it say the rest. */
function SignInIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" className="size-4.5">
      <path
        d="M7.5 3H4.5A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15h3M11 5.5 14.5 9 11 12.5M14 9H7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Once a sign-in has been started the page is on its way to the provider, and every sign-in button is off: a second
// press, on the same button or on the other, would start a second sign-in. One flag for the whole page, because the
// hero and the dialog each have their buttons.
let leaving = false
const listeners = new Set<() => void>()

function setLeaving(next: boolean) {
  leaving = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Back from the provider's page the browser may bring this page back as it was left (the back/forward cache), buttons
// off and all: the visitor has to be able to start again.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    setLeaving(false)
  }
})

/**
 * Takes the whole page to the provider and, once the visitor is back, to the page they were on (path and query). It is
 * a navigation, not a request of the app: the provider's own page asks for the confirmation. `leaving` is true from
 * the first press on.
 */
function useSignIn(provider: AuthProvider) {
  const { pathname, search } = useLocation()
  const isLeaving = useSyncExternalStore(subscribe, () => leaving)
  function signIn() {
    if (leaving) {
      return
    }
    setLeaving(true)
    window.location.assign(signInUrl(provider, `${pathname}${search}`))
  }
  return { signIn, leaving: isLeaving }
}

/**
 * Where the buttons stand. In the hero they have the width of their words, side by side; in the dialog each takes the
 * row. The mockup gives them 22px and 20px of padding on the sides.
 */
type Layout = 'hero' | 'dialog'

const LAYOUT: Record<Layout, string> = { hero: 'px-5.5', dialog: 'w-full px-5' }

/** "Sign in with Steam": the filled button, in the dialog and in the hero. */
export function SteamSignInButton({ layout }: { layout: Layout }) {
  const t = useT()
  const { signIn, leaving } = useSignIn('steam')
  return (
    <Button type="button" size="lg" disabled={leaving} onClick={signIn} className={cn('gap-3', LAYOUT[layout])}>
      <SignInIcon />
      {t.auth.steamSignIn}
    </Button>
  )
}

/**
 * The muted box that stands for "Sign in with FACEIT" while the backend does not have the provider turned on: the tag
 * says it is coming, and there is nothing to press, so nothing that fails. It does not ask for the providers, so the
 * hero can draw it, unseen, before it is known whether the visitor needs it.
 */
export function FaceitComingSoon({ layout }: { layout: Layout }) {
  const t = useT()
  return (
    // The box is the dialog's (20px of padding) also in the hero, where the mockup draws no such state: the two buttons
    // then still share a row in English, whose words are a little longer.
    <div
      className={cn(
        'inline-flex min-h-13 items-center justify-center gap-3 rounded-lg border border-line-strong px-5 text-[15px] font-semibold text-subtle',
        layout === 'dialog' && 'w-full',
      )}
    >
      <span>{t.auth.faceitSignIn}</span>
      <Badge variant="outline" className="text-muted-foreground">
        {t.auth.comingSoon}
      </Badge>
    </div>
  )
}

/**
 * "Sign in with FACEIT": the outline button once the backend has the provider turned on; until then (and when the
 * answer cannot be had) the muted box.
 */
export function FaceitSignInButton({ layout }: { layout: Layout }) {
  const t = useT()
  const providers = useAuthProviders()
  const { signIn, leaving } = useSignIn('faceit')
  if (providers.data?.faceit) {
    return (
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={leaving}
        onClick={signIn}
        className={LAYOUT[layout]}
      >
        {t.auth.faceitSignIn}
      </Button>
    )
  }
  return <FaceitComingSoon layout={layout} />
}
