import { Download, Link2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useClip, useDeleteClip, useMatchClips } from '@/api/queries'
import KillTimeline from '@/components/KillTimeline'
import StatusChip from '@/components/StatusChip'
import ViewfinderFrame from '@/components/ViewfinderFrame'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale, useT, type Messages } from '@/i18n'
import { setAdminKey, useAdminKey } from '@/lib/adminKey'
import { copyText } from '@/lib/clipboard'
import { clipLabel, formatBytes, isFinished } from '@/lib/clips'
import { errorMessage } from '@/lib/errorMessage'
import { formatDate, formatDateTime } from '@/lib/formatDate'
import { formatDuration } from '@/lib/highlightLabels'
import { mapLabel, mapScene } from '@/lib/mapTint'
import { cn } from '@/lib/utils'
import { isKnife, weaponLabel } from '@/lib/weapons'
import type { ApiError } from '@/api/client'
import type { ClipKill, ClipResponse } from '@/api/types'

/** How long "Link copied" stays in place of "Copy link". */
const COPIED_MS = 2000

/** Item names are the same in every language; the knife is a plain word and comes from the dictionary. */
function weaponName(weapon: string, t: Messages): string {
  return isKnife(weapon) ? t.highlight.knife : weaponLabel(weapon)
}

/** `4K · AK-47 · Mirage`: what the clip shows, the weapon most of its kills were made with, and the map. */
function clipTitle(clip: ClipResponse, t: Messages): string {
  const counts = new Map<string, number>()
  for (const kill of clip.kills) {
    const weapon = weaponName(kill.weapon, t)
    counts.set(weapon, (counts.get(weapon) ?? 0) + 1)
  }
  // Of two weapons with as many kills, the one that killed first.
  const weapon = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  return [clipLabel(clip, t), weapon, mapLabel(clip.mapName)].filter(Boolean).join(' · ')
}

/**
 * Where the video will be, while there is none: the frame of the map with the state of the clip in it, the percentage
 * while it is being recorded, and the reason under it when it failed.
 */
function ClipPlaceholder({ clip }: { clip: ClipResponse }) {
  const t = useT()
  const recording = clip.status === 'RECORDING'
  return (
    // The state changes by itself (the clip is asked for again every three seconds); a change is announced.
    <div aria-live="polite" className="flex flex-col gap-3">
      <div className="relative border border-border">
        <ViewfinderFrame
          size="large"
          mapName={clip.mapName}
          topLeft={`${mapLabel(clip.mapName) ?? t.match.unknownMap} · ${
            clip.roundNumber !== null ? `R${clip.roundNumber}` : 'MATCH'
          }`}
          bottomRight={clip.quality}
          center={
            <span className="flex flex-col items-center gap-3">
              {recording && (
                // A picture of the progress bar below, which is what assistive technology reads the percentage from.
                <span aria-hidden="true" className="score-big">
                  {clip.progress}%
                </span>
              )}
              <span className="border border-ring bg-background/80 px-3 py-1.5">
                {/* Without the percentage: it stands large above the chip, and the chip is announced when the state
                    changes, not with every percent. */}
                <StatusChip clip={clip} percent={false} />
              </span>
            </span>
          }
        />
        {recording && (
          <span
            role="progressbar"
            aria-label={t.clip.status.RECORDING}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clip.progress}
            className="absolute bottom-0 left-0 h-0.75 bg-rec"
            style={{ width: `${clip.progress}%` }}
          />
        )}
      </div>
      {/* The recorder's own words about what went wrong, as they are: a technical message. */}
      {clip.status === 'FAILED' && clip.error && (
        <p className="font-mono text-xs break-words text-negative">{clip.error}</p>
      )}
    </div>
  )
}

/**
 * Deletes the clip, after a second click that confirms it. Offered only while the page holds the admin key; a key the
 * backend rejects is forgotten, and the control goes with it.
 */
function DeleteControl({ clip, apiKey }: { clip: ClipResponse; apiKey: string }) {
  const t = useT()
  const navigate = useNavigate()
  const remove = useDeleteClip()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ApiError | null>(null)

  function confirm() {
    setFailure(null)
    remove.mutate(
      { apiKey, clip },
      {
        // The clip is gone, and so is its page: back to the match it was recorded from.
        onSuccess: () => navigate(`/matches/${encodeURIComponent(clip.matchId)}`),
        onError: (error) => {
          if (error.status === 401) {
            setAdminKey(null)
            remove.reset()
          } else {
            setFailure(error)
          }
        },
      },
    )
  }

  if (!confirming) {
    return (
      <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
        {t.clip.page.delete}
      </Button>
    )
  }
  return (
    <div role="group" aria-label={t.clip.page.delete} className="flex basis-full flex-wrap items-center gap-3">
      <p className="text-sm">{t.clip.page.confirmDelete}</p>
      <Button type="button" variant="destructive" disabled={remove.isPending} onClick={confirm}>
        {t.clip.page.confirmYes}
      </Button>
      <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => setConfirming(false)}>
        {t.clip.page.keep}
      </Button>
      <p aria-live="polite" className="basis-full text-sm text-destructive empty:hidden">
        {failure && errorMessage(failure, t)}
      </p>
    </div>
  )
}

/**
 * The kills of the clip in the order of the video. In a finished clip a row is a button that takes the video to its
 * kill, which is what a click on a mark of the line under the video does.
 */
function KillList({ kills, onSeek }: { kills: ClipKill[]; onSeek: ((offsetMs: number) => void) | undefined }) {
  const t = useT()
  if (kills.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.clip.page.noKills}</p>
  }
  return (
    <ol className="border-t border-border">
      {kills.map((kill, index) => {
        const time = formatDuration(kill.offsetMs / 1000)
        const row = (
          <>
            <span className="number-mono text-muted-foreground">{time}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
              <span className="min-w-0 truncate font-semibold">{kill.victimNickname}</span>
              <span className="text-muted-foreground">{weaponName(kill.weapon, t)}</span>
            </span>
            {/* A game term, the same in every language. */}
            <span className="font-mono text-[11px] tracking-[0.06em]">{kill.headshot && 'HEADSHOT'}</span>
          </>
        )
        const layout = 'grid min-h-11 w-full grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-4 text-left text-sm'
        return (
          // Two kills can share a moment, so the position in the list is the key.
          <li key={index} className="border-b border-border">
            {onSeek ? (
              <button
                type="button"
                title={t.clip.page.seek(time)}
                onClick={() => onSeek(kill.offsetMs)}
                className={cn(layout, '-outline-offset-2 hover:bg-secondary')}
              >
                {row}
              </button>
            ) : (
              <div className={layout}>{row}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The facts of the clip as a two-column list; a fact the clip does not have yet is left out. */
function ClipFacts({ clip }: { clip: ClipResponse }) {
  const t = useT()
  const locale = useLocale()
  const facts: [string, string][] = [[t.clip.page.quality, `${clip.quality} · ${t.clip.page.fps(clip.fps)}`]]
  if (clip.durationMs !== null) {
    facts.push([t.clip.page.duration, formatDuration(clip.durationMs / 1000)])
  }
  if (clip.sizeBytes !== null) {
    facts.push([t.clip.page.size, formatBytes(clip.sizeBytes)])
  }
  if (clip.status === 'DONE' && clip.finishedAt) {
    facts.push([t.clip.page.recorded, formatDateTime(clip.finishedAt, locale)])
  } else {
    facts.push([t.clip.page.requested, formatDateTime(clip.createdAt, locale)])
  }
  if (clip.expiresAt) {
    facts.push([t.clip.page.keptUntil, t.clip.page.until(formatDate(clip.expiresAt, locale))])
  }
  return (
    <section className="flex flex-col gap-3.5 border border-border bg-card p-5">
      <h3 className="label-mono">{t.clip.page.about}</h3>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
        {facts.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{name}</dt>
            <dd className="text-right font-mono">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The other clips of the match as rows that link to them. Without any there is no section. */
function MatchClips({ clip }: { clip: ClipResponse }) {
  const t = useT()
  const clips = useMatchClips(clip.matchId)
  const others = clips.data?.filter((other) => other.id !== clip.id) ?? []
  if (others.length === 0) {
    return null
  }
  return (
    <section className="flex flex-col gap-3">
      <h3 className="label-mono">{t.clip.page.fromMatch}</h3>
      <ul className="border-b border-border">
        {others.map((other) => (
          <li key={other.id} className="border-t border-border">
            <Link
              to={`/clips/${other.id}`}
              className="flex min-h-17.5 items-center gap-3.5 py-2 -outline-offset-2 hover:bg-secondary"
            >
              {/* A small still of the clip, or the scene of its map: decoration beside the words. */}
              <span
                aria-hidden="true"
                className="block h-13.5 w-24 shrink-0 border border-border bg-cover bg-center"
                style={{
                  backgroundImage: other.thumbnailUrl
                    ? `url("${other.thumbnailUrl}")`
                    : `radial-gradient(90% 80% at 35% 45%, ${mapScene(other.mapName)} 0%, #15130F 55%, #0E1013 85%)`,
                }}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-semibold">{clipLabel(other, t)}</span>
                <span className="truncate text-[13px] text-muted-foreground">
                  {other.nickname}
                  {other.roundNumber !== null && ` · ${t.highlight.round(other.roundNumber)}`}
                </span>
                <StatusChip clip={other} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One clip: the video (or its state while there is none), what it shows, what can be done with it, and its facts. */
function ClipView({ clip }: { clip: ClipResponse }) {
  const t = useT()
  const locale = useLocale()
  const adminKey = useAdminKey()
  const video = useRef<HTMLVideoElement>(null)
  const [copied, setCopied] = useState(false)
  const ready = clip.status === 'DONE' && clip.videoUrl !== null

  useEffect(() => {
    if (!copied) {
      return
    }
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  /** Takes the video to a moment and plays from there; on a phone the video may be above the screen by then. */
  function seek(offsetMs: number) {
    const player = video.current
    if (!player) {
      return
    }
    player.currentTime = offsetMs / 1000
    // Playing can be refused (the browser's own rules); the video then waits at the moment it was taken to.
    void player.play().catch(() => {})
    player.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="flex flex-wrap items-start gap-8">
      <div className="flex min-w-0 flex-[999_1_40rem] flex-col gap-5">
        {ready ? (
          <div className="flex flex-col gap-2">
            {/* The browser's own controls: full screen and the phone's player come with them (spec 8). */}
            <video
              ref={video}
              controls
              playsInline
              preload="metadata"
              poster={clip.thumbnailUrl ?? undefined}
              src={clip.videoUrl ?? undefined}
              className="aspect-video w-full border border-border bg-black"
            />
            {clip.durationMs !== null && clip.kills.length > 0 && (
              <KillTimeline
                start={0}
                end={clip.durationMs}
                marks={clip.kills.map((kill) => kill.offsetMs)}
                onSeek={seek}
              />
            )}
          </div>
        ) : (
          <ClipPlaceholder clip={clip} />
        )}
        <div className="flex flex-col gap-1">
          <h2 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.02em]">{clipTitle(clip, t)}</h2>
          <div className="flex flex-wrap items-center gap-x-3.5 text-sm text-muted-foreground">
            {/* A player the backend knows only from the demo has no profile to link to. */}
            {clip.playerId.startsWith('steam:') ? (
              <span className="inline-flex min-h-11 items-center font-semibold text-foreground">{clip.nickname}</span>
            ) : (
              <Link
                to={`/players/${encodeURIComponent(clip.playerId)}`}
                className="inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:underline"
              >
                {clip.nickname}
              </Link>
            )}
            <Link
              to={`/matches/${encodeURIComponent(clip.matchId)}`}
              className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
            >
              {t.clip.page.match}
            </Link>
            <span>
              {clip.roundNumber !== null && `${t.highlight.round(clip.roundNumber)} · `}
              <time dateTime={clip.createdAt}>{formatDate(clip.createdAt, locale)}</time>
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {ready && (
            <a href={`${clip.videoUrl}?download=1`} download className={cn(buttonVariants())}>
              <Download aria-hidden="true" />
              {t.clip.page.download}
              {clip.sizeBytes !== null && (
                <span className="font-mono text-xs font-medium opacity-70">{formatBytes(clip.sizeBytes)}</span>
              )}
            </a>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => void copyText(window.location.href).then((done) => setCopied(done))}
          >
            <Link2 aria-hidden="true" />
            <span aria-live="polite">{copied ? t.clip.page.copied : t.clip.page.copyLink}</span>
          </Button>
          {/* A clip that is being recorded cannot be deleted (the backend answers 409), so it is not offered then. */}
          {adminKey !== null && (isFinished(clip.status) || clip.status === 'QUEUED') && (
            <DeleteControl clip={clip} apiKey={adminKey} />
          )}
        </div>
        <section className="flex flex-col gap-2.5 pt-2">
          <h3 className="text-lg leading-[1.4] font-semibold">{t.clip.page.kills}</h3>
          <KillList kills={clip.kills} onSeek={ready ? seek : undefined} />
        </section>
      </div>
      <aside className="flex min-w-0 flex-[1_1_18.75rem] flex-col gap-7">
        <ClipFacts clip={clip} />
        <MatchClips clip={clip} />
      </aside>
    </div>
  )
}

function ClipDetails({ clipId }: { clipId: number }) {
  const t = useT()
  const clip = useClip(clipId)
  return (
    <>
      <div aria-live="polite" className="empty:hidden">
        {clip.isPending && (
          <>
            <p className="label-mono mb-2">{t.clip.loading}</p>
            <Skeleton className="aspect-video w-full max-w-4xl" />
          </>
        )}
        {clip.isError && !clip.data && <p className="text-sm text-destructive">{errorMessage(clip.error, t)}</p>}
      </div>
      {clip.data && <ClipView clip={clip.data} />}
    </>
  )
}

/** One clip on a page of its own, so that its address can be shared (spec 8). */
export default function ClipPage() {
  const t = useT()
  const { clipId } = useParams()
  // A clip id is a number; anything else in the address is a clip that does not exist.
  const id = clipId !== undefined && /^[0-9]{1,15}$/.test(clipId) ? Number(clipId) : null
  return (
    // The line about what the clip shows is the page's big title, so the h1 is a small label above everything.
    <main className="container-page flex flex-col gap-4 pt-9 pb-18">
      <h1 className="label-mono">{t.clip.title}</h1>
      {id !== null ? (
        // Keyed by the clip: the confirmation of a deletion does not follow the visitor to another clip.
        <ClipDetails key={id} clipId={id} />
      ) : (
        <p className="text-sm text-destructive">{t.clip.notFound}</p>
      )}
    </main>
  )
}
