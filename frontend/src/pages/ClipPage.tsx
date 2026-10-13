import { Download, Link2 } from 'lucide-react'
import { type RefObject, useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useClip, useDeleteClip, useMatchClips, useMatchStats, usePlayer } from '@/api/queries'
import KillTimeline from '@/components/KillTimeline'
import PlayerAvatar from '@/components/PlayerAvatar'
import RecorderBanner from '@/components/RecorderBanner'
import StatusChip from '@/components/StatusChip'
import ViewfinderFrame from '@/components/ViewfinderFrame'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale, useT, type Messages } from '@/i18n'
import { setAdminKey, useAdminKey } from '@/lib/adminKey'
import { copyText } from '@/lib/clipboard'
import { clipLabel, formatBytes, frameLabel, qualityMark } from '@/lib/clips'
import { isFinished } from '@/lib/clipStatus'
import { errorMessage } from '@/lib/errorMessage'
import { formatDate, formatDateTime } from '@/lib/formatDate'
import { formatDuration } from '@/lib/highlightLabels'
import { mapLabel, mapScene } from '@/lib/mapTint'
import { cn } from '@/lib/utils'
import { useHasUnlinkedNotice } from '@/lib/viewer'
import { isKnife, weaponLabel } from '@/lib/weapons'
import type { ApiError } from '@/api/client'
import type { ClipKill, ClipResponse } from '@/api/types'

/** How long "Link copied", or that it could not be copied, stays in place of "Copy link". */
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
          size="clip"
          mapName={clip.mapName}
          topLeft={frameLabel(clip, t)}
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
      {/* Why a clip may be waiting: whether a recorder is there at all, and how long the queue is. */}
      {clip.status === 'QUEUED' && <RecorderBanner />}
    </div>
  )
}

interface DeleteControlProps {
  clip: ClipResponse
  apiKey: string
  /** The backend did not take the key: it is forgotten, this control goes with it, and the page says why. */
  onKeyRejected: () => void
}

/**
 * Deletes the clip, after a second click that confirms it. Offered only while the page holds the admin key; a key the
 * backend rejects is forgotten, and the control goes with it. The focus follows the question: to "Keep", the answer
 * that changes nothing, when it is asked (the question is the name of the group, so it is read then), and back to the
 * button when the clip is kept.
 */
function DeleteControl({ clip, apiKey, onKeyRejected }: DeleteControlProps) {
  const t = useT()
  const questionId = useId()
  const navigate = useNavigate()
  const remove = useDeleteClip()
  const [confirming, setConfirming] = useState(false)
  // The question was asked and answered with "Keep": the button it replaced takes the focus back.
  const [kept, setKept] = useState(false)
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
            onKeyRejected()
          } else {
            setFailure(error)
          }
        },
      },
    )
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="destructive"
        autoFocus={kept}
        onClick={() => setConfirming(true)}
        className="max-sm:h-12 max-sm:flex-1"
      >
        {t.clip.page.delete}
      </Button>
    )
  }
  return (
    <div role="group" aria-labelledby={questionId} className="flex basis-full flex-wrap items-center gap-3">
      <p id={questionId} className="text-sm">
        {t.clip.page.confirmDelete}
      </p>
      <Button type="button" variant="destructive" disabled={remove.isPending} onClick={confirm}>
        {t.clip.page.confirmYes}
      </Button>
      <Button
        type="button"
        variant="ghost"
        autoFocus
        disabled={remove.isPending}
        onClick={() => {
          setConfirming(false)
          setKept(true)
        }}
      >
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
      <h2 className="label-mono">{t.clip.page.about}</h2>
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
      <h2 className="label-mono">{t.clip.page.fromMatch}</h2>
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

interface ClipVideoProps {
  clip: ClipResponse
  video: RefObject<HTMLVideoElement | null>
  /** Whether the visitor has started the video: until then the frame covers it. */
  started: boolean
  /** The notice of an account without a FACEIT player stands above the page: the video keeps its distance from it. */
  belowNotice: boolean
  onStart: () => void
  onError: () => void
}

/**
 * The video of a finished clip, as the board draws it before it is started: the large viewfinder frame over the
 * player, with the clip's own thumbnail (the scene of the map without one), where the clip is from, how long it is, its
 * quality and a round play button. The video is in the page from the start but is not fetched (`preload="none"`; the
 * thumbnail is its picture), and, while the frame covers it, is neither focusable nor announced (`inert`). Once it is
 * started the frame is gone for good, and the browser's own controls are the player: full screen and the phone's player
 * come with them (spec 8). On a phone the player runs from edge to edge, right under the top bar (or under the notice
 * of an account without a FACEIT player, where the page's own top padding stays as the distance to it).
 */
function ClipVideo({ clip, video, started, belowNotice, onStart, onError }: ClipVideoProps) {
  const t = useT()
  return (
    // On a phone the page's gutter, and its top padding unless a notice is above, are cancelled.
    <div
      className={cn(
        'relative max-sm:-mx-(--page-gutter) sm:border sm:border-border',
        !belowNotice && 'max-sm:-mt-8',
      )}
    >
      <video
        ref={video}
        controls
        playsInline
        preload="none"
        inert={!started}
        aria-label={clipTitle(clip, t)}
        poster={clip.thumbnailUrl ?? undefined}
        src={clip.videoUrl ?? undefined}
        onError={onError}
        className="block aspect-video w-full bg-black"
      />
      {!started && (
        <ViewfinderFrame
          size="clip"
          className="absolute inset-0"
          // A click anywhere on the picture starts the video: the button below is the one control (it is a click on
          // the frame as well, when it is pressed or activated from the keyboard).
          onClick={onStart}
          mapName={clip.mapName}
          imageUrl={clip.thumbnailUrl}
          topLeft={frameLabel(clip, t, true)}
          bottomLeft={clip.durationMs !== null && formatDuration(clip.durationMs / 1000)}
          bottomRight={qualityMark(clip)}
          center={
            <button
              type="button"
              aria-label={t.clip.page.play}
              className="flex size-16 items-center justify-center rounded-full bg-primary transition-colors hover:bg-primary/80 sm:size-18"
            >
              <svg aria-hidden="true" viewBox="0 0 12 12" className="size-5 fill-primary-foreground sm:size-5.5">
                <path d="M3.5 1.5v9l7-4.5z" />
              </svg>
            </button>
          }
        />
      )}
    </div>
  )
}

/**
 * The line under the title as the board draws it: the player's picture and nickname (the link to the profile, which a
 * player the backend knows only from the demo does not have), the FACEIT level and ELO in mono, the link to the match
 * with the match itself as its text (`team_A 13 : 9 team_B`), then the round and the date. The level, the ELO and the
 * picture come from the player, the teams and the score from the stats of the match: both are asked for here, only as
 * decoration, so that while they load, or when one fails or has nothing (no FACEIT player, a match FACEIT does not
 * know), the line is what it has: the initial in the circle, no facts, the word "Match".
 */
function ClipByline({ clip }: { clip: ClipResponse }) {
  const t = useT()
  const locale = useLocale()
  // A player the backend knows only from the demo (`steam:<SteamID>`) is not one of FACEIT's: nothing to ask for.
  const profile = !clip.playerId.startsWith('steam:')
  const player = usePlayer(clip.playerId, profile).data
  const teams = useMatchStats(clip.matchId).data?.teams
  const elo = player && player.elo !== null ? new Intl.NumberFormat(locale).format(player.elo) : null
  const facts = player ? t.clip.page.faceitFacts(player.level, elo) : ''
  const match =
    teams?.length === 2
      ? `${teams[0].name ?? t.stats.team} ${teams[0].score} : ${teams[1].score} ${teams[1].name ?? t.stats.team}`
      : t.clip.page.match
  const who = (
    <>
      <PlayerAvatar nickname={clip.nickname} avatar={player?.avatar} size="sm" />
      {clip.nickname}
    </>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 text-sm text-muted-foreground">
      {/* On a phone the player has the first row to itself, as the phone board draws it, with the facts or without
          them yet, so that the line is two rows from the start and does not grow when the facts arrive. */}
      <div className="flex max-w-full flex-wrap items-center gap-x-3.5 max-sm:basis-full">
        {profile ? (
          <Link
            to={`/players/${encodeURIComponent(clip.playerId)}`}
            className="inline-flex min-h-11 items-center gap-2.5 font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {who}
          </Link>
        ) : (
          <span className="inline-flex min-h-11 items-center gap-2.5 font-semibold text-foreground">{who}</span>
        )}
        {facts && <span className="font-mono text-xs">{facts}</span>}
      </div>
      <Link
        to={`/matches/${encodeURIComponent(clip.matchId)}`}
        className="inline-flex min-h-11 max-w-full items-center text-foreground underline underline-offset-4 [overflow-wrap:anywhere]"
      >
        {match}
      </Link>
      <span>
        {clip.roundNumber !== null && `${t.highlight.round(clip.roundNumber)} · `}
        <time dateTime={clip.createdAt}>{formatDate(clip.createdAt, locale)}</time>
      </span>
    </div>
  )
}

/** One clip: the video (or its state while there is none), what it shows, what can be done with it, and its facts. */
function ClipView({ clip }: { clip: ClipResponse }) {
  const t = useT()
  const adminKey = useAdminKey()
  const belowNotice = useHasUnlinkedNotice()
  const video = useRef<HTMLVideoElement>(null)
  // What became of the last "Copy link", for as long as the button says it.
  const [copy, setCopy] = useState<'copied' | 'failed' | null>(null)
  // The browser could not load the video: its file is gone although the clip says it is done, or cannot be played here.
  const [videoFailed, setVideoFailed] = useState(false)
  // The visitor started the video (the play button, or a kill of the list): the frame over it is gone for good.
  const [started, setStarted] = useState(false)
  // The backend rejected the admin key of a deletion: the key is forgotten and "Delete" is gone, so the page says why.
  const [keyRejected, setKeyRejected] = useState(false)
  const ready = clip.status === 'DONE' && clip.videoUrl !== null

  useEffect(() => {
    if (copy === null) {
      return
    }
    const timer = setTimeout(() => setCopy(null), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copy])

  // The frame that went was the focus's place (its button), or the visitor pressed a kill below it: the video takes the
  // focus, which it could not while the frame covered it.
  useEffect(() => {
    if (started) {
      video.current?.focus()
    }
  }, [started])

  /** Starts the video from where it is, which is its beginning. */
  function start() {
    setStarted(true)
    // Playing can be refused (the browser's own rules); the video then waits, with its own controls to start it.
    void video.current?.play().catch(() => {})
  }

  /** Takes the video to a moment and plays from there; on a phone the video may be above the screen by then. */
  function seek(offsetMs: number) {
    const player = video.current
    if (!player) {
      return
    }
    setStarted(true)
    player.currentTime = offsetMs / 1000
    // Playing can be refused (the browser's own rules); the video then waits at the moment it was taken to.
    void player.play().catch(() => {})
    player.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="flex flex-wrap items-start gap-8">
      <div className="flex min-w-0 flex-[999_1_40rem] flex-col gap-6 sm:gap-5">
        {ready ? (
          // On a phone 4px less than the column's 24px gap under the player, so that the title is 20px under it.
          <div className="flex flex-col gap-2 max-sm:-mb-1">
            <ClipVideo
              clip={clip}
              video={video}
              started={started}
              belowNotice={belowNotice}
              onStart={start}
              onError={() => setVideoFailed(true)}
            />
            {/* An alert, so that it is announced although it was not on the page before. */}
            {videoFailed && (
              <p role="alert" className="text-sm text-destructive">
                {t.clip.page.videoFailed}
              </p>
            )}
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
        <div className="flex flex-col gap-1 sm:gap-2.5">
          {/* The page's own title: the line about what the clip shows. */}
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] sm:text-[26px] sm:leading-[1.2]">
            {clipTitle(clip, t)}
          </h1>
          <ClipByline clip={clip} />
        </div>
        {/* On a phone "Download" has a row of its own and the other actions share the next one; from `sm` up all of
            them are one row that wraps (the inner box then drops out of the layout). */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          {ready && (
            <a
              href={`${clip.videoUrl}?download=1`}
              download
              className={cn(buttonVariants(), 'max-sm:h-12 max-sm:text-[15px]')}
            >
              <Download aria-hidden="true" />
              {t.clip.page.download}
              {clip.sizeBytes !== null && (
                <span className="font-mono text-xs font-medium opacity-70">{formatBytes(clip.sizeBytes)}</span>
              )}
            </a>
          )}
          <div className="flex flex-wrap gap-2.5 sm:contents">
            <Button
              type="button"
              variant="outline"
              className="max-sm:h-12 max-sm:flex-1"
              onClick={() => void copyText(window.location.href).then((done) => setCopy(done ? 'copied' : 'failed'))}
            >
              <Link2 aria-hidden="true" />
              <span aria-live="polite">
                {copy === 'copied'
                  ? t.clip.page.copied
                  : copy === 'failed'
                    ? t.clip.page.copyFailed
                    : t.clip.page.copyLink}
              </span>
            </Button>
            {/* A clip that is being recorded cannot be deleted (the backend answers 409), so it is not offered then. */}
            {adminKey !== null && (isFinished(clip.status) || clip.status === 'QUEUED') && (
              <DeleteControl clip={clip} apiKey={adminKey} onKeyRejected={() => setKeyRejected(true)} />
            )}
            {keyRejected && adminKey === null && (
              <p role="alert" className="basis-full text-sm text-destructive">
                {t.demo.wrongKey}
              </p>
            )}
          </div>
        </div>
        <section className="flex flex-col gap-2.5 pt-2">
          <h2 className="text-lg leading-[1.4] font-semibold">{t.clip.page.kills}</h2>
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
  // The clip was there and is not any more (a clip that waits can be withdrawn while its page is open): what the page
  // still holds of it is not shown as if it were there.
  const gone = clip.isError && clip.error.status === 404
  const shown = clip.data && !gone ? clip.data : null
  return (
    <>
      {/* The clip's title is the page's h1 once the clip is there; until then, and without it, this names the page. */}
      {!shown && <h1 className="sr-only">{t.clip.title}</h1>}
      <div aria-live="polite" className="empty:hidden">
        {clip.isPending && (
          <>
            <p className="label-mono mb-2">{t.clip.loading}</p>
            <Skeleton className="aspect-video w-full max-w-4xl" />
          </>
        )}
        {clip.isError && (gone || !clip.data) && (
          <p className="text-sm text-destructive">{errorMessage(clip.error, t)}</p>
        )}
      </div>
      {shown && <ClipView clip={shown} />}
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
    // The board has no label above the video: the page starts with it, 32px under the top bar (on a phone the video
    // cancels the padding and runs from the very top).
    <main className="container-page flex flex-col gap-4 pt-8 pb-18">
      {id !== null ? (
        // Keyed by the clip: the confirmation of a deletion does not follow the visitor to another clip.
        <ClipDetails key={id} clipId={id} />
      ) : (
        <>
          <h1 className="sr-only">{t.clip.title}</h1>
          <p className="text-sm text-destructive">{t.clip.notFound}</p>
        </>
      )}
    </main>
  )
}
