import { Link } from 'react-router-dom'
import { useMe } from '@/api/auth'
import { FaceitComingSoon, FaceitSignInButton, SteamSignInButton } from '@/components/SignInButtons'
import UnlinkedNotice from '@/components/UnlinkedNotice'
import { buttonVariants } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * What the hero offers under its paragraph (spec 6). A visitor who is not signed in gets the two ways to sign in. A
 * signed-in one has no use for them: the way to their own statistics takes their place, or, when their Steam account
 * has no FACEIT player, the line that says so. Until `/auth/me` has answered, the buttons of a visitor who is not
 * signed in (the common case) are drawn at their real size but cannot be seen, reached or read, so that nothing under
 * them moves when the answer says so. The providers are asked for by the FACEIT button, which exists only once the
 * answer is here.
 *
 * `failed` is the sign-in that did not work (`/?login=failed`): one line above the buttons, in a polite live region.
 */
export default function HeroSignIn({ failed }: { failed: boolean }) {
  const t = useT()
  const me = useMe()
  const user = me.data ?? null
  const pending = me.isPending

  let content
  if (user?.playerId) {
    content = (
      <Link
        to={`/players/${encodeURIComponent(user.playerId)}`}
        className={buttonVariants({ size: 'lg', className: 'self-start px-5.5' })}
      >
        {t.auth.myStatistics}
      </Link>
    )
  } else if (user) {
    content = <UnlinkedNotice />
  } else {
    content = (
      <div aria-hidden={pending || undefined} inert={pending} className={cn('flex flex-wrap gap-3', pending && 'invisible')}>
        <SteamSignInButton layout="hero" />
        {pending ? <FaceitComingSoon layout="hero" /> : <FaceitSignInButton layout="hero" />}
      </div>
    )
  }

  return (
    <div className="mt-1 flex w-full flex-col">
      <div aria-live="polite" className="not-empty:mb-3">
        {failed && user === null && <p className="text-sm text-destructive">{t.auth.signInFailed}</p>}
      </div>
      {content}
    </div>
  )
}
