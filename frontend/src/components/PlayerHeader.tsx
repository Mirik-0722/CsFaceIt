import { type ReactNode, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PlayerResponse } from '@/api/types'

type Size = 'default' | 'lg'

/** The picture of the player; the initial in a circle when he has none, or when the picture does not load. */
function Avatar({ player, size }: { player: PlayerResponse; size: Size }) {
  const box = size === 'lg' ? 'size-18' : 'size-14'
  // The address that failed, not a flag: another player's address (this component is reused for the next player)
  // is tried afresh, and fails to the initial in its turn.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (player.avatar && player.avatar !== failedSrc) {
    const src = player.avatar
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailedSrc(src)}
        className={cn(box, 'shrink-0 rounded-full object-cover')}
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        box,
        'flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-secondary font-semibold',
        size === 'lg' ? 'text-[28px]' : 'text-xl',
      )}
    >
      {player.nickname.charAt(0).toUpperCase()}
    </div>
  )
}

/** The found player of a search: a card with the avatar, the nickname, the country and ELO, and the level as a tag. */
function PlayerCard({ player }: { player: PlayerResponse }) {
  const t = useT()
  const hasCs2Data = player.elo !== null || player.level !== null
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <Avatar player={player} size="default" />
        {/* Everything beside the avatar wraps as one: when the row is too narrow for the name (at least `basis-44`)
            and the tag side by side, the tag drops below the name and its line and the name keeps the full width. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 grow basis-44 flex-col gap-1">
            <CardTitle className="truncate text-xl leading-[1.3]">{player.nickname}</CardTitle>
            {(player.country || player.elo !== null) && (
              <div className="flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground">
                {/* FACEIT sends the country code in lower case; it is shown as a code. */}
                {player.country && <span className="uppercase">{player.country}</span>}
                {player.elo !== null && <span>{t.player.elo(player.elo)}</span>}
              </div>
            )}
          </div>
          {hasCs2Data ? (
            player.level !== null && <Badge variant="outline">{t.player.level(player.level)}</Badge>
          ) : (
            <Badge variant="secondary">{t.player.noCs2Data}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The header of the player's page, as the board draws it: no card, the avatar, the nickname as a 30px heading and under
 * it one mono line (country, FACEIT level, ELO; "No CS2 data" instead of the last two without CS2 data), and `aside` on
 * the right edge. The aside drops below the rest where there is no room for both.
 */
function ProfileHeader({ player, aside }: { player: PlayerResponse; aside?: ReactNode }) {
  const t = useT()
  const hasCs2Data = player.elo !== null || player.level !== null
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
      <div className="flex min-w-0 items-center gap-4.5">
        <Avatar player={player} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          {/* The page's own h1 is the small label above this header, so the nickname is the heading of the section. */}
          <h2 className="heading-page truncate">{player.nickname}</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
            {/* FACEIT sends the country code in lower case; it is shown as a code. */}
            {player.country && <span className="uppercase">{player.country}</span>}
            {player.level !== null && <span>FACEIT {t.player.level(player.level)}</span>}
            {player.elo !== null && <span>{t.player.elo(player.elo)}</span>}
            {!hasCs2Data && <span>{t.player.noCs2Data}</span>}
          </div>
        </div>
      </div>
      {aside}
    </div>
  )
}

interface PlayerHeaderProps {
  player: PlayerResponse
  size?: Size
  /** Something for the right of the large header (the form strip of the profile); the card has no room for one. */
  aside?: ReactNode
}

/**
 * One player: `elo` and `level` are null without CS2 data. `size="lg"` is the header of the player page, which the board
 * draws without a card; the default is the card of a search result.
 */
export default function PlayerHeader({ player, size = 'default', aside }: PlayerHeaderProps) {
  return size === 'lg' ? <ProfileHeader player={player} aside={aside} /> : <PlayerCard player={player} />
}
