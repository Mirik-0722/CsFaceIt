import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { useT } from '@/i18n'
import type { PlayerResponse } from '@/api/types'

function Avatar({ player }: { player: PlayerResponse }) {
  if (player.avatar) {
    return <img src={player.avatar} alt="" className="size-14 shrink-0 rounded-full object-cover" />
  }
  return (
    <div
      aria-hidden="true"
      className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground"
    >
      {player.nickname.charAt(0).toUpperCase()}
    </div>
  )
}

/** Avatar, nickname, country and CS2 rating of one player; `elo` and `level` are null without CS2 data. */
export default function PlayerHeader({ player }: { player: PlayerResponse }) {
  const t = useT()
  const hasCs2Data = player.elo !== null || player.level !== null
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <Avatar player={player} />
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-lg">{player.nickname}</CardTitle>
          {player.country && <CardDescription>{player.country}</CardDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasCs2Data ? (
            <>
              {player.elo !== null && <span className="text-sm font-medium">{t.player.elo(player.elo)}</span>}
              {player.level !== null && <Badge>{t.player.level(player.level)}</Badge>}
            </>
          ) : (
            <Badge variant="secondary">{t.player.noCs2Data}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
