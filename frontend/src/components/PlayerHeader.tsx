import { type ReactNode, useState } from 'react'
import LevelRing from '@/components/LevelRing'
import PlayerAvatar, { type AvatarSize } from '@/components/PlayerAvatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { useLocale, useT } from '@/i18n'
import { countryName } from '@/lib/countryName'
import { formatInteger } from '@/lib/formatNumber'
import { cn } from '@/lib/utils'
import type { PlayerResponse } from '@/api/types'

type Size = Exclude<AvatarSize, 'sm'>

/**
 * The found player of a search: a card with the avatar, the nickname, the country and ELO, and the level as a ring with
 * its tag.
 */
function PlayerCard({ player }: { player: PlayerResponse }) {
  const t = useT()
  const locale = useLocale()
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
                {player.elo !== null && <span>{t.player.elo(formatInteger(player.elo, locale))}</span>}
              </div>
            )}
          </div>
          {hasCs2Data ? (
            player.level !== null && (
              <span className="flex items-center gap-2.5">
                <LevelRing level={player.level} size={32} />
                <Badge variant="outline">{t.player.level(player.level)}</Badge>
              </span>
            )
          ) : (
            <Badge variant="secondary">{t.player.noCs2Data}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The scenery of the map the player has played most, behind the header of the profile. It spans the page's column,
 * from the top bar's line (the page's own 36px of padding above the header) to a little under the header, and goes over
 * into the page's ground at its bottom: a mask lets the real ground show, as the landing page's backdrop does. A veil
 * in the ground's colour lies over the picture, heavy at the left where the name stands and light at the right where the
 * picture is to be seen. It fades in once the picture has arrived (`onLoad`); a phone gets a band behind the first
 * lines instead of the whole height. Nothing here is in the header's flow, so nothing moves when it comes.
 */
function HeaderScenery({ url, shown, onLoad }: { url: string; shown: boolean; onLoad: () => void }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'scenery-fade-head pointer-events-none absolute inset-x-0 -top-9 -bottom-9 -z-10 transition-opacity duration-700 motion-reduce:transition-none max-sm:bottom-auto max-sm:h-32',
        shown ? 'opacity-100' : 'opacity-0',
      )}
    >
      <img
        src={url}
        alt=""
        decoding="async"
        onLoad={onLoad}
        className="size-full object-cover object-[50%_35%]"
      />
      <div className="scenery-veil-head absolute inset-0" />
    </div>
  )
}

/**
 * The header of the player's page, as the board draws it: no card, the avatar, the nickname as a 30px heading and under
 * it one mono line (the country by name, FACEIT level with its ring, ELO; "No CS2 data" instead of the last two without
 * CS2 data), and `aside` on the right edge. The aside drops below the rest where there is no room for both. With a
 * `scenery` (the picture of the player's map) the header stands on it: the picture is not part of the header's size or
 * position; once it shows, the name and the mono line get a scrim (`scenery-scrim`) and the aside, which marks itself
 * through `group-data-[scenery=shown]/head`, a plate of its own.
 */
function ProfileHeader({ player, aside, scenery }: { player: PlayerResponse; aside?: ReactNode; scenery?: string | null }) {
  const t = useT()
  const locale = useLocale()
  // The address that has arrived, not a flag: another map's picture is waited for afresh.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const shown = !!scenery && loadedUrl === scenery
  const country = player.country ? countryName(player.country, locale) : null
  const hasCs2Data = player.elo !== null || player.level !== null
  return (
    <div
      data-scenery={shown ? 'shown' : undefined}
      // Under `sm` the header is at least 92px high: with the ring the mono line wraps on most phones (below about 417px)
      // and the header is 92px, so every header is, and the loading skeleton (see PlayerPage) is as tall.
      className="group/head relative isolate flex flex-wrap items-center justify-between gap-x-8 gap-y-5 max-sm:min-h-23"
    >
      {scenery && <HeaderScenery url={scenery} shown={shown} onLoad={() => setLoadedUrl(scenery)} />}
      <div className="flex min-w-0 items-center gap-4.5">
        <PlayerAvatar nickname={player.nickname} avatar={player.avatar} size="lg" />
        {/* The scrim reaches 12px beyond the block: on a phone the block runs to 16px from the screen's edge, and a wider
            bleed would make the page scroll sideways. */}
        <div className="flex min-w-0 flex-col gap-1 [--scrim-bleed-x:0.75rem] [--scrim-color:var(--background)] [--scrim-fade-x:0.75rem] group-data-[scenery=shown]/head:scenery-scrim">
          {/* The page's h1 only names the page (for screen readers): the nickname is the heading of the section. */}
          <h2 className="heading-page truncate">{player.nickname}</h2>
          {/* The ring is 32px, the height of the avatar less the heading and the gap: the line, and so the header, is
              as tall with it as without it. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
            {/* The country by name; where there is none, FACEIT's code (it sends it in lower case) as a code. */}
            {player.country && (
              <span className={country === null ? 'uppercase' : undefined}>{country ?? player.country}</span>
            )}
            {player.level !== null && (
              <span className="inline-flex items-center gap-2">
                <LevelRing level={player.level} size={32} />
                {t.player.faceitLevel(player.level)}
              </span>
            )}
            {player.elo !== null && <span>{t.player.elo(formatInteger(player.elo, locale))}</span>}
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
  /** The picture of the player's map for behind the large header (null: none); the card has no scenery. */
  scenery?: string | null
}

/**
 * One player: `elo` and `level` are null without CS2 data. `size="lg"` is the header of the player page, which the board
 * draws without a card; the default is the card of a search result.
 */
export default function PlayerHeader({ player, size = 'default', aside, scenery }: PlayerHeaderProps) {
  return size === 'lg' ? <ProfileHeader player={player} aside={aside} scenery={scenery} /> : <PlayerCard player={player} />
}
