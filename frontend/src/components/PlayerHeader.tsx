import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import FaceitTag from '@/components/FaceitTag'
import LevelRing from '@/components/LevelRing'
import MapEmblem from '@/components/MapEmblem'
import PlayerAvatar, { type AvatarSize } from '@/components/PlayerAvatar'
import SceneryBand from '@/components/SceneryBand'
import { MatchmakingTag } from '@/components/SourceTag'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardTitle } from '@/components/ui/card'
import { useLocale, useT } from '@/i18n'
import { countryName } from '@/lib/countryName'
import { formatInteger } from '@/lib/formatNumber'
import { mapLabel } from '@/lib/mapTint'
import { isSteamPlayer } from '@/lib/matchSource'
import { useLoadedUrl } from '@/lib/useLoadedUrl'
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
 * The first row of the profile's header is at least this high, and so is the loading block that stands in for it (see
 * PlayerPage): 114px from `sm` (the 48px name, 4px, the 32px mono line with the ring, 8px and the 22px row of the tag),
 * 122px on a phone, where the mono line with the ring wraps onto two lines (36 + 4 + 52 + 8 + 22).
 */
const PROFILE_HEAD_ROW = 'min-h-30.5 sm:min-h-28.5'

/**
 * The third line of the header: where the player's matches are from (FACEIT, or CS2 matchmaking for a player known only
 * from demos), and the map the player has played most.
 */
function HeadTags({ mainMap, steam }: { mainMap: string | null | undefined; steam: boolean }) {
  const t = useT()
  const name = mapLabel(mainMap ?? null)
  return (
    // As tall as the tag, with or without the map, so that nothing moves when the map arrives.
    <div className="mt-1 flex h-5.5 min-w-0 items-center gap-3">
      {steam ? <MatchmakingTag /> : <FaceitTag />}
      {name && (
        <span className="flex min-w-0 items-center gap-2">
          <span className="label-mono whitespace-nowrap">{t.lively.mainMap}</span>
          <MapEmblem mapName={mainMap ?? null} size={20} fallback="none" />
          <span className="truncate text-[13px] font-semibold">{name}</span>
        </span>
      )}
    </div>
  )
}

interface ProfileHeaderProps {
  player: PlayerResponse
  aside?: ReactNode
  scenery?: string | null
  mainMap?: string | null
  nameLink?: string
}

/**
 * The header of the player's page, as the board draws it and as the third step of the lively style enlarged it: no
 * card, the 96px avatar (72px on a phone), the nickname as a 40px heading (30px on a phone) and under it one mono line
 * (the country by name, FACEIT level with its ring, ELO; "No CS2 data" instead of the last two without CS2 data), then a
 * line with the `FACEIT` tag and the map the player has played most (`mainMap`, once it is known), and `aside` on the
 * right edge. The aside drops below the rest where there is no room for both. With a `scenery` (the picture of the
 * player's map) the header stands on it (`SceneryBand`): the picture is not part of the header's size or position;
 * once it shows, the name and the lines get a scrim (`scenery-scrim`) and the aside, which marks itself through
 * `group-data-[scenery=shown]/head`, a plate of its own. With `nameLink` the nickname is a link (the way back to the
 * profile from the player's highlights).
 */
function ProfileHeader({ player, aside, scenery, mainMap, nameLink }: ProfileHeaderProps) {
  const t = useT()
  const locale = useLocale()
  const [shown, onLoad] = useLoadedUrl(scenery ?? null)
  const country = player.country ? countryName(player.country, locale) : null
  const hasCs2Data = player.elo !== null || player.level !== null
  // A player known only from demos has no FACEIT profile: no level, no ELO, and no "No CS2 data" either (the player's
  // CS2 matches are the reason the page exists).
  const steam = isSteamPlayer(player.playerId)
  return (
    <div
      data-scenery={shown ? 'shown' : undefined}
      // Under `md` the aside (the form strip) always takes a row of its own below the name and the lines (a column), so
      // that the head's height does not depend on whether the name and its lines leave room for the strip: with a level
      // the line is wider, and the strip would drop below it at about 640-700px but not without one. The first row is
      // as high as `PROFILE_HEAD_ROW` whatever the player is, and the loading block (see PlayerPage) is made of the same
      // parts. From `md` the strip stands beside the name where there is room, and drops below it where there is not.
      className="group/head relative isolate flex flex-wrap items-center justify-between gap-x-8 gap-y-5 max-md:flex-col max-md:items-start"
    >
      {scenery && <SceneryBand url={scenery} shown={shown} onLoad={onLoad} />}
      <div className={cn('flex min-w-0 items-center gap-4.5 sm:gap-6', PROFILE_HEAD_ROW)}>
        <PlayerAvatar nickname={player.nickname} avatar={player.avatar} size="lg" />
        {/* The scrim reaches 12px beyond the block: on a phone the block runs to 16px from the screen's edge, and a wider
            bleed would make the page scroll sideways. */}
        <div className="flex min-w-0 flex-col gap-1 [--scrim-bleed-x:0.75rem] [--scrim-color:var(--background)] [--scrim-fade-x:0.75rem] group-data-[scenery=shown]/head:scenery-scrim">
          {/* The page's h1 only names the page (for screen readers): the nickname is the heading of the section. */}
          <h2 className="heading-page truncate sm:text-[40px]">
            {nameLink ? (
              <Link to={nameLink} className="underline-offset-[6px] hover:underline">
                {player.nickname}
              </Link>
            ) : (
              player.nickname
            )}
          </h2>
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
            {!hasCs2Data && !steam && <span>{t.player.noCs2Data}</span>}
          </div>
          <HeadTags mainMap={mainMap} steam={steam} />
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
  /** The map the player has played most, for the large header's third line (null or absent: only the tag). */
  mainMap?: string | null
  /** Makes the large header's nickname a link to this address. */
  nameLink?: string
}

/**
 * One player: `elo` and `level` are null without CS2 data. `size="lg"` is the header of the player page, which the board
 * draws without a card; the default is the card of a search result.
 */
export default function PlayerHeader({ player, size = 'default', aside, scenery, mainMap, nameLink }: PlayerHeaderProps) {
  return size === 'lg' ? (
    <ProfileHeader player={player} aside={aside} scenery={scenery} mainMap={mainMap} nameLink={nameLink} />
  ) : (
    <PlayerCard player={player} />
  )
}
