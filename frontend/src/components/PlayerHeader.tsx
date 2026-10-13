import type { ReactNode } from 'react'
import PlayerAvatar, { type AvatarSize } from '@/components/PlayerAvatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { useLocale, useT } from '@/i18n'
import { countryName } from '@/lib/countryName'
import type { PlayerResponse } from '@/api/types'

type Size = Exclude<AvatarSize, 'sm'>

/** The found player of a search: a card with the avatar, the nickname, the country and ELO, and the level as a tag. */
function PlayerCard({ player }: { player: PlayerResponse }) {
  const t = useT()
  const hasCs2Data = player.elo !== null || player.level !== null
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <PlayerAvatar nickname={player.nickname} avatar={player.avatar} size="default" />
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
 * it one mono line (the country by name, FACEIT level, ELO; "No CS2 data" instead of the last two without CS2 data),
 * and `aside` on the right edge. The aside drops below the rest where there is no room for both.
 */
function ProfileHeader({ player, aside }: { player: PlayerResponse; aside?: ReactNode }) {
  const t = useT()
  const locale = useLocale()
  const country = player.country ? countryName(player.country, locale) : null
  const hasCs2Data = player.elo !== null || player.level !== null
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5">
      <div className="flex min-w-0 items-center gap-4.5">
        <PlayerAvatar nickname={player.nickname} avatar={player.avatar} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          {/* The page's h1 only names the page (for screen readers): the nickname is the heading of the section. */}
          <h2 className="heading-page truncate">{player.nickname}</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
            {/* The country by name; where there is none, FACEIT's code (it sends it in lower case) as a code. */}
            {player.country && (
              <span className={country === null ? 'uppercase' : undefined}>{country ?? player.country}</span>
            )}
            {player.level !== null && <span>{t.player.faceitLevel(player.level)}</span>}
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
