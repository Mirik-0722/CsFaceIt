import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PlayerResponse } from '@/api/types'

type Size = 'default' | 'lg'

function Avatar({ player, size }: { player: PlayerResponse; size: Size }) {
  const box = size === 'lg' ? 'size-18' : 'size-14'
  if (player.avatar) {
    return <img src={player.avatar} alt="" className={cn(box, 'shrink-0 rounded-full object-cover')} />
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
