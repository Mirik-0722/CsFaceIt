import KillFeedRow from '@/components/KillFeedRow'
import KillTimeline from '@/components/KillTimeline'
import { Badge } from '@/components/ui/badge'
import ViewfinderFrame from '@/components/ViewfinderFrame'
import { useT } from '@/i18n'
import { formatDuration, highlightLabel } from '@/lib/highlightLabels'
import { mapLabel } from '@/lib/mapTint'
import { cn } from '@/lib/utils'
import { weaponLabel } from '@/lib/weapons'

// The sample clip: an ace by a player who does not exist. Nothing in it is real, and the label above the picture says
// so.
const KILLER = 'temur1k'
const WEAPON = 'ak47'
const VICTIMS = [
  { nickname: 'qora_bori', headshot: true },
  { nickname: 'shoxa', headshot: true },
  { nickname: 'abror1', headshot: false },
  { nickname: 'Jasur_x', headshot: true },
  { nickname: 'd1yor', headshot: false },
]
const CLIP_SECONDS = 16
// Where the five kills are in the clip, in milliseconds: the unit of a track that is the video itself.
const KILL_MARKS_MS = [3000, 6000, 8000, 11000, 14000]

// The labels of a large frame are 12px, which does not fit in the corners of a phone-sized one. The frame is a
// container (see below), so what is drawn in it follows its width, not the width of the window: under 448px (`@md`)
// the text is 9px, and the kill feed is made smaller and hangs below the REC label instead of beside it.
const LABEL_SIZE = 'text-[9px] @md:text-xs'
const FEED_ROW = 'gap-1.5 px-1.5 py-0 text-[9px] @md:gap-2 @md:px-2 @md:py-0.5 @md:text-xs'

/** The crosshair of the game in the middle of the frame: two 2px strokes, 18px long. A narrow frame leaves it out. */
function Crosshair() {
  return (
    <span className="relative hidden size-4.5 @min-[480px]:block">
      <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-foreground" />
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-foreground" />
    </span>
  )
}

/**
 * The picture beside the search (mockup, screen 1): what the product makes. A frame of the game with the REC timecode,
 * the kill feed of an ace and the crosshair; under it the line of the clip with its five kills, and what the clip is.
 * It is a drawing of an example, so it is hidden from assistive technology as a whole and marked as a sample. Its
 * content is always the same; only the corner label names the map whose turn it is on the page (`mapName`).
 */
export default function HeroIllustration({ mapName, className }: { mapName: string; className?: string }) {
  const t = useT()
  const headshots = VICTIMS.filter((victim) => victim.headshot).length
  return (
    // `scenery-plate`: the page's backdrop is behind the sample, and its small grey lines need a darker ground.
    <div aria-hidden="true" className={cn('scenery-plate flex min-w-0 flex-col gap-3.5', className)}>
      <p className="label-mono">{t.home.sample}</p>
      <ViewfinderFrame
        // The frame itself does not follow the map: the page's backdrop is the map's picture, the frame a drawing.
        mapName="de_mirage"
        scenery={false}
        size="large"
        className="@container border border-border"
        topLeft={
          <span className={cn('flex items-center gap-2 font-medium', LABEL_SIZE)}>
            <span className="size-2 shrink-0 animate-rec rounded-full bg-rec" />
            REC 00:11:42
          </span>
        }
        topRight={
          // The corner label is one line high and centres what it holds: the feed is taller and hangs from the top.
          <div className="mt-5 flex flex-col items-end gap-1 self-start tracking-normal whitespace-nowrap normal-case @md:mt-0">
            {VICTIMS.map((victim) => (
              <KillFeedRow
                key={victim.nickname}
                className={FEED_ROW}
                killer={KILLER}
                killerSide="T"
                weapon={weaponLabel(WEAPON)}
                headshot={victim.headshot}
                victim={victim.nickname}
                victimSide="CT"
              />
            ))}
          </div>
        }
        center={<Crosshair />}
        bottomLeft={
          <span className={cn('text-muted-foreground', LABEL_SIZE)}>
            {t.home.frameRound((mapLabel(mapName) ?? '').toUpperCase())}
          </span>
        }
        bottomRight={<span className={LABEL_SIZE}>1080p · 60 FPS</span>}
      />
      {/* The clip itself is the track: from its first second to its last, with a red mark per kill. */}
      <div className="flex items-center gap-3 font-mono text-[11px] text-subtle tabular-nums">
        <span>{formatDuration(0)}</span>
        <div className="min-w-0 flex-1">
          <KillTimeline start={0} end={CLIP_SECONDS * 1000} marks={KILL_MARKS_MS} />
        </div>
        <span>{formatDuration(CLIP_SECONDS)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge className="normal-case">{highlightLabel('ACE', t)}</Badge>
        <span className="text-sm font-medium">
          {`${KILLER} · ${weaponLabel(WEAPON)} ×${VICTIMS.length} · ${t.highlight.headshots(headshots)}`}
        </span>
        <span className="ml-auto font-mono text-xs text-subtle">
          {`${formatDuration(CLIP_SECONDS)} · 21.4 MB · MP4`}
        </span>
      </div>
    </div>
  )
}
