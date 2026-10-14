import { Popover } from '@base-ui/react/popover'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { type MeResponse, useLogout } from '@/api/auth'
import { usePlayer } from '@/api/queries'
import { useLocale, useT } from '@/i18n'
import { formatInteger } from '@/lib/formatNumber'
import { ownMatchesPath } from '@/lib/matchSource'
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
 * The line under the nickname, as the board draws it: the FACEIT level and the ELO of the visitor's player in mono,
 * upper case. `/auth/me` carries neither, so they come from the player query the player's page uses; this component is
 * mounted by the open menu only, so nothing is asked for until the visitor opens it. The line keeps its height whether
 * it has a text or not (while the answer is on its way, when it fails, for a player without CS2 data), so that nothing
 * in the menu moves when the text arrives.
 */
function LevelLine({ playerId }: { playerId: string }) {
  const t = useT()
  const locale = useLocale()
  const player = usePlayer(playerId)
  const level = player.data?.level ?? null
  const elo = player.data?.elo ?? null
  const parts: string[] = []
  if (level !== null) {
    parts.push(t.player.faceitLevel(level))
  }
  if (elo !== null) {
    parts.push(t.player.elo(formatInteger(elo, locale)))
  }
  return (
    // The line takes the padding on its right as well (`-mr-4`; the nickname above it does not, so a long one stops where
    // the room beside the picture ends): "FACEIT 10-DARAJA · 3 500 ELO" is a little wider than that room, and cut short
    // it would lose the ELO it ends with.
    <span className="-mr-4 block h-4 truncate font-mono text-[11px] leading-4 tracking-[0.06em] text-subtle uppercase">
      {parts.join(' · ')}
    </span>
  )
}

/**
 * The round button of a signed-in visitor and the menu under it (spec 6): the nickname with the player's FACEIT level
 * and ELO under it when there is a player, the player's own statistics (without FACEIT: the account's matches), the
 * clips, and the way out. A popover, not a `menu` role: it holds a heading and links to
 * pages, which Tab walks through, and it closes on Escape, on a click outside and on following a link.
 */
export default function AccountMenu({ me, onSignedOut }: { me: MeResponse; onSignedOut: () => void }) {
  const t = useT()
  const logout = useLogout(onSignedOut)
  const [open, setOpen] = useState(false)
  const matchesPath = ownMatchesPath(me)

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
              <div className="flex min-w-0 flex-col gap-0.5">
                <Popover.Title render={<p />} className="truncate text-[15px] font-semibold">
                  {me.nickname}
                </Popover.Title>
                {me.playerId && <LevelLine playerId={me.playerId} />}
              </div>
            </div>
            {/* The links close the menu themselves: a closer of the library would make each of them a `button`. */}
            {me.playerId && (
              <Link to={`/players/${encodeURIComponent(me.playerId)}`} onClick={close} className={ROW}>
                {t.auth.myStatistics}
              </Link>
            )}
            {/* An account without FACEIT has no statistics page of its own, but has its matches: those of its SteamID
                (CS2 matchmaking), where its demos are brought and its matchmaking games linked. */}
            {!me.playerId && matchesPath && (
              <Link to={matchesPath} onClick={close} className={ROW}>
                {t.auth.matches}
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
