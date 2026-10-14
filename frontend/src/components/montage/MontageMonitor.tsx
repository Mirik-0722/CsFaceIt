import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import type { EditorSource } from '@/api/editorTypes'
import KillFeedRow from '@/components/KillFeedRow'
import ViewfinderFrame from '@/components/ViewfinderFrame'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { mapSceneryUrl } from '@/lib/mapArt'
import { mapLabel } from '@/lib/mapTint'
import { type Layout, type Montage, formatTimecode, killMoments, partAt, roundOf } from '@/lib/montage'
import { cn } from '@/lib/utils'
import { isKnife, weaponLabel } from '@/lib/weapons'

/** How long a kill stays in the feed, in seconds of the video, and how many lines the feed shows at most. */
const FEED_SECONDS = 6
const FEED_LINES = 5

const OTHER_SIDE = { CT: 'T', T: 'CT' } as const

interface MontageMonitorProps {
  source: EditorSource
  montage: Montage
  layout: Layout
  /** The playhead, in seconds of the video. */
  time: number
  playing: boolean
  onTogglePlay: () => void
  /** Goes to the start of the segment (or the intro) before the playhead; null when there is none. */
  onPrevious: (() => void) | null
  /** Goes to the start of the next segment; null when there is none. */
  onNext: (() => void) | null
  /** Puts every kill of the source in the empty montage. */
  onStartWithAll: () => void
}

/**
 * The monitor of the montage editor (spec 3, `MontageMonitor`): a schematic view of the moment under the playhead,
 * never a video. The map's scenery stands for the picture; over it the corner labels, the title, the kill feed of the
 * segment, and in the middle the line that says it is schematic. The transport row under it plays the montage in real
 * time; it never starts by itself.
 */
export default function MontageMonitor({
  source,
  montage,
  layout,
  time,
  playing,
  onTogglePlay,
  onPrevious,
  onNext,
  onStartWithAll,
}: MontageMonitorProps) {
  const t = useT()
  const { options } = montage
  const vertical = options.aspect === '9:16'
  const empty = layout.parts.length === 0
  const inIntro = !empty && time < layout.introEnd
  const part = partAt(layout, time)
  const round = part ? roundOf(source, part.segment.round) : undefined
  const map = mapLabel(source.mapName)
  const scenery = mapSceneryUrl(source.mapName)
  const title = options.title.trim()
  const feed = part
    ? killMoments(layout, source)
        .filter((moment) => moment.part.index === part.index && moment.time <= time && time - moment.time < FEED_SECONDS)
        .slice(-FEED_LINES)
    : []
  const timecode = `${formatTimecode(time)} / ${formatTimecode(layout.total)}`

  const notice = (
    <p className="max-w-[min(30rem,86%)] border border-line-strong bg-background/80 px-2.5 py-1.5 text-center font-mono text-[11px] leading-snug tracking-[0.08em] text-muted-foreground uppercase max-sm:py-1 max-sm:text-[10px]">
      {t.montage.monitor.schematic}
    </p>
  )

  return (
    <section aria-label={t.montage.monitor.label} className="flex flex-col gap-2">
      {/* The stage: 16:9, and never taller than 56% of the window; a vertical montage stands in it at full height (on a
          phone the stage is square then, so the frame is not too small). */}
      <div
        className={cn(
          'mx-auto flex w-full max-w-[calc(56dvh*16/9)] items-stretch justify-center overflow-hidden border border-border bg-[#07080A]',
          vertical ? 'aspect-square sm:aspect-video' : 'aspect-video',
        )}
      >
        <ViewfinderFrame
          mapName={source.mapName}
          scenery={false}
          // A vertical frame is narrow: the small brackets leave its corner labels room.
          size={vertical ? 'card' : 'large'}
          className={cn(vertical ? 'aspect-[9/16] h-full w-auto' : 'size-full')}
          picture={
            <div aria-hidden="true" className="absolute inset-0">
              {scenery && <img src={scenery} alt="" decoding="async" className="absolute inset-0 size-full object-cover" />}
              <div className={cn('absolute inset-0', inIntro || empty ? 'bg-background/88' : 'scenery-veil-sample')} />
              {title && !inIntro && !empty && (
                // The recorder puts the title on the top line of the video, under the corner labels.
                <p
                  className={cn(
                    'absolute inset-x-0 flex justify-center px-6',
                    vertical ? 'top-11' : 'top-12',
                  )}
                >
                  <span className="max-w-full truncate bg-background/70 px-2 py-0.5 text-sm font-semibold max-sm:text-xs">{title}</span>
                </p>
              )}
              {feed.length > 0 && (
                // Under the corner label, or under the title when there is one. A landscape stage on a phone is too low
                // for that and the notice in the middle: there the newest two lines stand above the bottom corner labels.
                <div
                  className={cn(
                    'absolute right-4 flex flex-col items-end gap-1',
                    vertical
                      ? 'top-20'
                      : cn(
                          'max-sm:bottom-9 max-sm:[&>*:nth-last-child(n+3)]:hidden',
                          title && !inIntro ? 'sm:top-20' : 'sm:top-11',
                        ),
                  )}
                >
                  {feed.map((moment) => {
                    const side = round?.side ?? null
                    return (
                      <KillFeedRow
                        key={`${moment.part.segment.id}-${moment.kill.tick}`}
                        killer={source.player.nickname}
                        killerSide={side}
                        weapon={isKnife(moment.kill.weapon) ? t.highlight.knife : weaponLabel(moment.kill.weapon)}
                        headshot={moment.kill.headshot}
                        victim={moment.kill.victimNickname}
                        victimSide={side ? OTHER_SIDE[side] : null}
                        className={vertical ? 'text-[10px]' : 'max-sm:text-[10px]'}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          }
          topLeft={
            empty ? undefined : (
              <span aria-hidden="true">
                {inIntro ? t.montage.monitor.intro : [map, part && `R${part.segment.round}`].filter(Boolean).join(' · ')}
              </span>
            )
          }
          topRight={
            part && !inIntro ? (
              <span aria-hidden="true">{t.montage.monitor.segment(part.index + 1, layout.parts.length)}</span>
            ) : undefined
          }
          bottomLeft={
            // The vertical frame has no room for the whole length; the transport row says it.
            empty ? undefined : <span aria-hidden="true">{vertical ? formatTimecode(time) : timecode}</span>
          }
          bottomRight={<span aria-hidden="true">{`${options.quality} · ${options.aspect}`}</span>}
          center={
            <div className="flex max-w-full flex-col items-center gap-4 px-6">
              {empty && (
                <>
                  <p className="max-w-sm text-center text-sm text-foreground">{t.montage.monitor.empty}</p>
                  <Button type="button" onClick={onStartWithAll}>
                    {t.montage.monitor.startWithAll}
                  </Button>
                </>
              )}
              {inIntro && (
                <div aria-hidden="true" className="flex max-w-full flex-col items-center gap-2 text-center">
                  <span className="label-mono">{t.montage.monitor.intro}</span>
                  <span
                    className={cn(
                      'max-w-full font-semibold tracking-[-0.02em] break-words',
                      vertical ? 'text-xl' : 'text-[26px] leading-[1.2]',
                    )}
                  >
                    {title || source.player.nickname}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {[source.player.nickname, map].filter(Boolean).join(' · ')}
                  </span>
                </div>
              )}
              {notice}
            </div>
          }
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t.montage.monitor.previous}
          disabled={onPrevious === null}
          onClick={() => onPrevious?.()}
        >
          <SkipBack aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          aria-label={playing ? t.montage.monitor.pause : t.montage.monitor.play}
          disabled={empty}
          onClick={onTogglePlay}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t.montage.monitor.next}
          disabled={onNext === null}
          onClick={() => onNext?.()}
        >
          <SkipForward aria-hidden="true" />
        </Button>
        <p className="ml-2 font-mono text-[13px] text-muted-foreground tabular-nums">
          <span className="sr-only">{t.montage.monitor.time}: </span>
          {timecode}
        </p>
        {part?.segment.slowMo && !inIntro && (
          <Badge variant="outline" className="ml-auto normal-case" title={t.montage.monitor.slowMo}>
            <span aria-hidden="true">0.5×</span>
            <span className="sr-only">{t.montage.monitor.slowMo}</span>
          </Badge>
        )}
      </div>
    </section>
  )
}
