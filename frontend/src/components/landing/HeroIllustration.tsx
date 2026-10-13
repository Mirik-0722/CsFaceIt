import KillFeedRow from '@/components/KillFeedRow'
import KillTimeline from '@/components/KillTimeline'
import { Badge } from '@/components/ui/badge'
import ViewfinderFrame from '@/components/ViewfinderFrame'
import { useT } from '@/i18n'
import { formatDuration, highlightLabel } from '@/lib/highlightLabels'
import { mapOfSceneryUrl, mapSceneryUrl } from '@/lib/mapArt'
import { mapLabel } from '@/lib/mapTint'
import { sampleClipSources } from '@/lib/sampleClip'
import { cn } from '@/lib/utils'
import { weaponLabel } from '@/lib/weapons'
import SampleScenery from './SampleScenery'
import SampleVideo from './SampleVideo'
import type { SceneStack } from './useSceneStack'

/**
 * What the sample clip is: its map and round, the ace in it and the facts under it. The corner label, the drawn kill
 * feed and the caption are made from this. The values are an ace by a player who does not exist, and the label above the
 * picture says so. When a real video is put in `src/assets/landing/` (see the README there) it replaces the drawing, and
 * this is edited to say what is in that video: the map and round of the corner label, its REC timecode, the quality
 * named at the bottom right, who got the kills and with what, how long the file is, how big, and where in it the kills
 * are.
 */
const SAMPLE_CLIP = {
  mapName: 'de_mirage',
  round: 14,
  /** The REC timecode of the frame's corner. */
  timecode: '00:11:42',
  quality: '1080p · 60 FPS',
  killer: 'temur1k',
  weapon: 'ak47',
  victims: [
    { nickname: 'qora_bori', headshot: true },
    { nickname: 'shoxa', headshot: true },
    { nickname: 'abror1', headshot: false },
    { nickname: 'Jasur_x', headshot: true },
    { nickname: 'd1yor', headshot: false },
  ],
  seconds: 16,
  sizeMb: 21.4,
  /** Where the kills are in the clip, in milliseconds: the unit of a track that is the video itself. */
  killMarksMs: [3000, 6000, 8000, 11000, 14000],
}

// Whether a video of the clip has been put in the assets. It is known when the page is built.
const HAS_VIDEO = sampleClipSources().length > 0

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
 * It is a drawing of an example, so it is hidden from assistive technology as a whole and marked as a sample.
 *
 * The frame is not empty: it shows the scenery of the map whose turn it is on the page, in step with the page's
 * backdrop (`scenes`), drifting slowly (`driftPaused` holds it where it is while the turn is held). The corner label
 * names the map of the picture that is shown (`mapName`, the turn's, only when the stack has none to name), and the rest
 * of the sample is always the same. When a video of the clip exists it plays in the frame
 * instead: the drawn kill feed and crosshair are left out (the video has its own), and the corner label and the caption
 * say what the clip is, whichever map has its turn.
 */
export default function HeroIllustration({
  mapName,
  scenes,
  driftPaused,
  className,
}: {
  mapName: string
  scenes: SceneStack
  driftPaused: boolean
  className?: string
}) {
  const t = useT()
  const headshots = SAMPLE_CLIP.victims.filter((victim) => victim.headshot).length
  // The label names the map of the picture that is shown, which is the turn's only once that picture has come in: a late
  // or failed one leaves the previous map's on top (see `useSceneStack`). A video is the clip's own map.
  const frameMap = HAS_VIDEO ? SAMPLE_CLIP.mapName : (mapOfSceneryUrl(scenes.over) ?? mapName)
  return (
    // The whole sample stands on one panel (`glass-panel`): from `lg` it is frosted glass, the page's backdrop behind it
    // blurred; below that it is a plain dark panel. Its small grey lines need a ground of their own either way. The
    // picture shows around the panel.
    <div aria-hidden="true" className={cn('glass-panel flex min-w-0 flex-col gap-3.5 border border-border p-4', className)}>
      <p className="label-mono text-muted-foreground">{t.home.sample}</p>
      <ViewfinderFrame
        // The tint behind the picture is the clip's map: the picture covers it, and shows only while it comes in.
        mapName={SAMPLE_CLIP.mapName}
        scenery={false}
        picture={
          HAS_VIDEO ? (
            <SampleVideo poster={mapSceneryUrl(SAMPLE_CLIP.mapName)} />
          ) : (
            <SampleScenery scenes={scenes} paused={driftPaused} />
          )
        }
        size="large"
        className="@container border border-border"
        topLeft={
          <span className={cn('flex items-center gap-2 font-medium', LABEL_SIZE)}>
            <span className="size-2 shrink-0 animate-rec rounded-full bg-rec" />
            REC {SAMPLE_CLIP.timecode}
          </span>
        }
        topRight={
          // The video has its own kill feed. The corner label is one line high and centres what it holds: the feed is
          // taller and hangs from the top.
          !HAS_VIDEO && (
            <div className="mt-5 flex flex-col items-end gap-1 self-start tracking-normal whitespace-nowrap normal-case @md:mt-0">
              {SAMPLE_CLIP.victims.map((victim) => (
                <KillFeedRow
                  key={victim.nickname}
                  className={FEED_ROW}
                  killer={SAMPLE_CLIP.killer}
                  killerSide="T"
                  weapon={weaponLabel(SAMPLE_CLIP.weapon)}
                  headshot={victim.headshot}
                  victim={victim.nickname}
                  victimSide="CT"
                />
              ))}
            </div>
          )
        }
        center={!HAS_VIDEO && <Crosshair />}
        bottomLeft={
          <span className={cn('text-muted-foreground', LABEL_SIZE)}>
            {t.home.frameRound((mapLabel(frameMap) ?? '').toUpperCase(), SAMPLE_CLIP.round)}
          </span>
        }
        bottomRight={<span className={LABEL_SIZE}>{SAMPLE_CLIP.quality}</span>}
      />
      {/* The clip itself is the track: from its first second to its last, with a red mark per kill. */}
      <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground tabular-nums">
        <span>{formatDuration(0)}</span>
        <div className="min-w-0 flex-1">
          <KillTimeline start={0} end={SAMPLE_CLIP.seconds * 1000} marks={SAMPLE_CLIP.killMarksMs} />
        </div>
        <span>{formatDuration(SAMPLE_CLIP.seconds)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge className="normal-case">{highlightLabel('ACE', t)}</Badge>
        <span className="text-sm font-medium">
          {[
            SAMPLE_CLIP.killer,
            `${weaponLabel(SAMPLE_CLIP.weapon)} ×${SAMPLE_CLIP.victims.length}`,
            t.highlight.headshots(headshots),
          ].join(' · ')}
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {`${formatDuration(SAMPLE_CLIP.seconds)} · ${SAMPLE_CLIP.sizeMb.toFixed(1)} MB · MP4`}
        </span>
      </div>
    </div>
  )
}
