import { Popover } from '@base-ui/react/popover'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type MeResponse, useLogout } from '@/api/auth'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * A row of the menu: 44px under a 1px line (the first sits under the nickname), so 45 in all, as the mockup draws it;
 * the brighter shade on hover.
 */
const ROW =
  'flex min-h-[45px] w-full items-center border-t border-border px-4 text-left text-sm font-medium text-foreground hover:bg-secondary focus-visible:-outline-offset-2'

/**
 * What stands in the circle: the FACEIT picture, or the first letter of the nickname when there is none or it does
 * not load. The address that failed is remembered, not a flag, so another picture is tried afresh.
 */
function Face({ me }: { me: MeResponse }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (me.avatarUrl && me.avatarUrl !== failedSrc) {
    const src = me.avatarUrl
    return <img src={src} alt="" onError={() => setFailedSrc(src)} className="size-full object-cover" />
  }
  return <>{me.nickname.charAt(0).toUpperCase()}</>
}

/**
 * The round button of a signed-in visitor and the menu under it (spec 6): the nickname, the player's own statistics
 * when there is a player, the clips, and the way out. A popover, not a `menu` role: it holds a heading and links to
 * pages, which Tab walks through, and it closes on Escape, on a click outside and on following a link.
 */
export default function AccountMenu({ me, onSignedOut }: { me: MeResponse; onSignedOut: () => void }) {
  const t = useT()
  const logout = useLogout(onSignedOut)
  const [open, setOpen] = useState(false)

  // The error of a sign-out that failed is told in the menu, and goes when the menu closes (not while a sign-out is
  // still on its way, which is not an error).
  function close() {
    setOpen(false)
    if (logout.isError) {
      logout.reset()
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <Popover.Trigger
        aria-label={t.auth.accountMenu(me.nickname)}
        className="inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line-strong bg-border text-sm font-semibold text-foreground transition-colors aria-expanded:border-foreground"
      >
        <Face me={me} />
      </Popover.Trigger>
      <Popover.Portal>
        {/* 12px under the button, the right edges level (the mockup puts the panel 56px under the top of a 44px button). */}
        <Popover.Positioner side="bottom" align="end" sideOffset={12} className="z-50">
          <Popover.Popup className="flex w-70 max-w-[calc(100vw-2rem)] flex-col border border-line-strong bg-card text-foreground outline-none">
            <div className="flex items-center gap-3 p-4">
              <span
                aria-hidden="true"
                className="inline-flex size-10.5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line-strong bg-secondary text-[15px] font-semibold"
              >
                <Face me={me} />
              </span>
              <Popover.Title render={<p />} className="min-w-0 truncate text-[15px] font-semibold">
                {me.nickname}
              </Popover.Title>
            </div>
            {/* The links close the menu themselves: a closer of the library would make each of them a `button`. */}
            {me.playerId && (
              <Link to={`/players/${encodeURIComponent(me.playerId)}`} onClick={close} className={ROW}>
                {t.auth.myStatistics}
              </Link>
            )}
            <Link to="/clips" onClick={close} className={ROW}>
              {t.nav.clips}
            </Link>
            {/* Not a closer: the menu stays until the backend has answered, so that a failure is told where it was asked
                for. A success takes the visitor out of the cache, and with them this menu. */}
            <button
              type="button"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
              className={cn(ROW, 'text-muted-foreground disabled:opacity-50')}
            >
              {t.auth.signOut}
            </button>
            {logout.isError && (
              <p role="alert" className="border-t border-border px-4 py-3 text-[13px] text-destructive">
                {t.errors.generic}
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
