import { Link } from 'react-router-dom'
import { useMe } from '@/api/auth'
import { FaceitSignInButton, SteamSignInButton } from '@/components/SignInButtons'
import UnlinkedNotice from '@/components/UnlinkedNotice'
import { buttonVariants } from '@/components/ui/button'
import { useT } from '@/i18n'

/**
 * What the hero offers under its paragraph (spec 6). A visitor who is not signed in gets the two ways to sign in. A
 * signed-in one has no use for them: the way to their own statistics takes their place, or, when their Steam account
 * has no FACEIT player, the line that says so. Until `/auth/me` has answered the place is kept empty and as high as
 * the buttons, so that nothing under it moves when the answer comes. The providers are asked for by the FACEIT button,
 * which exists only for a visitor who needs it.
 *
 * `failed` is the sign-in that did not work (`/?login=failed`): one line above the buttons, in a polite live region.
 */
export default function HeroSignIn({ failed }: { failed: boolean }) {
  const t = useT()
  const me = useMe()
  const user = me.data ?? null
  const settled = !me.isPending

  let content = <div aria-hidden="true" className="min-h-13" />
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
  } else if (settled) {
    content = (
      <div className="flex flex-wrap gap-3">
        <SteamSignInButton layout="hero" />
        <FaceitSignInButton layout="hero" />
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
