import { useState } from 'react'
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

/**
 * Avatar, nickname, country and CS2 rating of one player; `elo` and `level` are null without CS2 data. `size="lg"` is
 * the header of the player page, the default is a search result.
 */
export default function PlayerHeader({ player, size = 'default' }: { player: PlayerResponse; size?: Size }) {
  const t = useT()
  const hasCs2Data = player.elo !== null || player.level !== null
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <Avatar player={player} size={size} />
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
