import type { EditorKill, EditorRound, EditorSource, MontageAspect, MontageRequest } from '@/api/editorTypes'
import type { ClipFps, ClipQuality } from '@/api/types'

// The montage editor's own rules (spec 4, "Montaj muharriri"), kept out of the components: how a kill becomes a
// segment, how segments are trimmed and played one after another, what the backend will refuse, and the draft that
// the browser keeps. Times are in ticks of the demo; seconds come from the source's tick rate.

/** How long the intro card plays before the first segment. */
export const INTRO_SECONDS = 2

/** The step of a trim: a dragged edge lands on it, and a stepper moves an edge by it. */
export const STEP_SECONDS = 0.5

/** The shortest a segment can be trimmed to. */
export const MIN_SEGMENT_SECONDS = 0.5

/** A segment of the montage: a part of one round, in ticks. `id` tells segments apart while they are edited. */
export interface Segment {
  id: number
  round: number
  startTick: number
  endTick: number
  slowMo: boolean
}

/** What the montage is besides its segments. The title is kept as typed; it is trimmed when the montage is ordered. */
export interface MontageOptions {
  title: string
  intro: boolean
  musicTrack: string | null
  quality: ClipQuality
  fps: ClipFps
  aspect: MontageAspect
}

/** The montage as the editor holds it: the segments in the order they play, and the options. */
export interface Montage {
  segments: Segment[]
  options: MontageOptions
}

/** A kill of the source together with its round. */
export interface LibraryKill {
  round: EditorRound
  kill: EditorKill
}

/** The kinds of kill the library can be narrowed to. */
export type KillFilter = 'all' | 'headshots' | 'awp' | 'highlights'

export const KILL_FILTERS: readonly KillFilter[] = ['all', 'headshots', 'awp', 'highlights']

function ticksOf(seconds: number, tickRate: number): number {
  return Math.round(seconds * tickRate)
}

/** Ticks as seconds of the demo. */
export function secondsOf(ticks: number, tickRate: number): number {
  return ticks / tickRate
}

/**
 * The options a montage starts with: no title, no intro, no music, the higher quality, 60 fps and landscape when
 * offered.
 */
export function emptyMontage(source: EditorSource): Montage {
  const { qualities, frameRates, aspects } = source.limits
  return {
    segments: [],
    options: {
      title: '',
      intro: false,
      musicTrack: null,
      quality: qualities.includes('1080p') ? '1080p' : (qualities[0] ?? '1080p'),
      fps: frameRates.includes(60) ? 60 : (frameRates[0] ?? 60),
      aspect: aspects.includes('16:9') ? '16:9' : (aspects[0] ?? '16:9'),
    },
  }
}

/** The round with that number, if the source has it. */
export function roundOf(source: EditorSource, number: number): EditorRound | undefined {
  return source.rounds.find((round) => round.number === number)
}

/** Every kill of the source, round by round, in tick order. */
export function allKills(source: EditorSource): LibraryKill[] {
  return [...source.rounds]
    .sort((a, b) => a.number - b.number)
    .flatMap((round) => [...round.kills].sort((a, b) => a.tick - b.tick).map((kill) => ({ round, kill })))
}

/** The numbers of the rounds that hold a highlight of the player. */
export function highlightRounds(source: EditorSource): Set<number> {
  return new Set(source.highlights.map((highlight) => highlight.roundNumber))
}

/** Whether a kill is of the kind a filter of the library shows. */
export function matchesFilter(item: LibraryKill, filter: KillFilter, withHighlight: Set<number>): boolean {
  switch (filter) {
    case 'headshots':
      return item.kill.headshot
    case 'awp':
      return item.kill.weapon.toLowerCase().replace(/^weapon_/, '') === 'awp'
    case 'highlights':
      return withHighlight.has(item.round.number)
    default:
      return true
  }
}

/** The part of its round a kill gives: `preSeconds` before it to `postSeconds` after it, cut at the round's ends. */
export function killWindow(source: EditorSource, round: EditorRound, tick: number): [number, number] {
  const { preSeconds, postSeconds } = source.limits
  return [
    Math.max(round.startTick, tick - ticksOf(preSeconds, source.tickRate)),
    Math.min(round.endTick, tick + ticksOf(postSeconds, source.tickRate)),
  ]
}

/** The segment that holds the kill, if one does. */
export function segmentWith(segments: Segment[], round: number, tick: number): Segment | undefined {
  return segments.find((segment) => segment.round === round && segment.startTick <= tick && tick <= segment.endTick)
}

function nextId(segments: Segment[]): number {
  return segments.reduce((highest, segment) => Math.max(highest, segment.id), 0) + 1
}

/**
 * Folds the segments of the same round that now overlap or touch the one at `index` into it, as long as the result is
 * not longer than `maxTicks`; the folded ones leave the list, the one at `index` keeps its place.
 */
function foldInto(segments: Segment[], index: number, maxTicks: number): Segment[] {
  let list = segments
  let target = list[index]
  for (;;) {
    const other = list.find(
      (segment) =>
        segment.id !== target.id &&
        segment.round === target.round &&
        segment.startTick <= target.endTick &&
        target.startTick <= segment.endTick &&
        Math.max(segment.endTick, target.endTick) - Math.min(segment.startTick, target.startTick) <= maxTicks,
    )
    if (!other) {
      return list
    }
    const merged: Segment = {
      ...target,
      startTick: Math.min(other.startTick, target.startTick),
      endTick: Math.max(other.endTick, target.endTick),
      slowMo: target.slowMo || other.slowMo,
    }
    list = list.filter((segment) => segment.id !== other.id).map((segment) => (segment.id === target.id ? merged : segment))
    target = merged
  }
}

/**
 * Adds kills to the montage. Each kill gives its window ({@link killWindow}); a window that overlaps or touches a
 * segment of the same round extends that segment instead of adding another, unless the extended segment would be longer
 * than `maxSegmentSeconds`: then the kill gets a segment of its own, starting where the other one ends (or ending where
 * it starts). A kill that a segment holds already changes nothing. New segments go to the end. Returns the list and the
 * id of the segment the last kill landed in.
 */
export function addKills(
  segments: Segment[],
  source: EditorSource,
  kills: LibraryKill[],
): { segments: Segment[]; landed: number | null } {
  const maxTicks = ticksOf(source.limits.maxSegmentSeconds, source.tickRate)
  let list = segments
  let landed: number | null = null
  for (const { round, kill } of kills) {
    const holder = segmentWith(list, round.number, kill.tick)
    if (holder) {
      landed = holder.id
      continue
    }
    let [start, end] = killWindow(source, round, kill.tick)
    const index = list.findIndex(
      (segment) => segment.round === round.number && segment.startTick <= end && start <= segment.endTick,
    )
    if (index >= 0) {
      const near = list[index]
      const from = Math.min(near.startTick, start)
      const to = Math.max(near.endTick, end)
      if (to - from <= maxTicks) {
        list = foldInto(
          list.map((segment, at) => (at === index ? { ...segment, startTick: from, endTick: to } : segment)),
          index,
          maxTicks,
        )
        landed = near.id
        continue
      }
      // Too long together: the kill's own segment starts where the other ends, or ends where it starts.
      if (kill.tick > near.endTick) {
        start = near.endTick
      } else {
        end = near.startTick
      }
    }
    const id = nextId(list)
    list = [...list, { id, round: round.number, startTick: start, endTick: end, slowMo: false }]
    landed = id
  }
  return { segments: list, landed }
}

/** The kills of the source that a segment holds, in tick order. */
export function segmentKills(source: EditorSource, segment: Segment): EditorKill[] {
  const round = roundOf(source, segment.round)
  return (round?.kills ?? [])
    .filter((kill) => segment.startTick <= kill.tick && kill.tick <= segment.endTick)
    .sort((a, b) => a.tick - b.tick)
}

/** How long a segment is in the demo, in seconds. */
export function segmentSeconds(segment: Segment, tickRate: number): number {
  return secondsOf(segment.endTick - segment.startTick, tickRate)
}

/** How long a segment plays in the video: twice its length in the demo when it is in slow motion. */
export function playSeconds(segment: Segment, tickRate: number): number {
  return segmentSeconds(segment, tickRate) * (segment.slowMo ? 2 : 1)
}

/** One segment on the timeline of the video: where it starts and ends, in seconds of the video. */
export interface Part {
  index: number
  segment: Segment
  from: number
  to: number
}

/** The timeline of the video: the intro (when there is one) and then every segment, end to end. */
export interface Layout {
  introEnd: number
  parts: Part[]
  total: number
}

/** Lays the montage out as the video will play it. */
export function layoutOf(montage: Montage, tickRate: number): Layout {
  const introEnd = montage.options.intro ? INTRO_SECONDS : 0
  let at = introEnd
  const parts = montage.segments.map((segment, index) => {
    const from = at
    at += playSeconds(segment, tickRate)
    return { index, segment, from, to: at }
  })
  return { introEnd, parts, total: at }
}

/** The length of the whole video: the segments (slow motion twice) and the intro. */
export function totalSeconds(montage: Montage, tickRate: number): number {
  return layoutOf(montage, tickRate).total
}

/** The segment that plays at that moment of the video; null in the intro, and with nothing to play. */
export function partAt(layout: Layout, time: number): Part | null {
  if (time < layout.introEnd || layout.parts.length === 0) {
    return null
  }
  return layout.parts.find((part) => time < part.to) ?? layout.parts[layout.parts.length - 1]
}

/** The tick of the demo that a moment of the video inside a part shows. */
export function tickAt(part: Part, time: number, tickRate: number): number {
  const into = Math.min(Math.max(time - part.from, 0), part.to - part.from)
  return part.segment.startTick + (into / (part.segment.slowMo ? 2 : 1)) * tickRate
}

/** A kill on the timeline of the video: when it happens in the video, and in which part. */
export interface KillMoment {
  time: number
  part: Part
  kill: EditorKill
}

/** Every kill of the montage at its moment of the video, in the order they play. */
export function killMoments(layout: Layout, source: EditorSource): KillMoment[] {
  return layout.parts.flatMap((part) =>
    segmentKills(source, part.segment).map((kill) => ({
      time: part.from + secondsOf(kill.tick - part.segment.startTick, source.tickRate) * (part.segment.slowMo ? 2 : 1),
      part,
      kill,
    })),
  )
}

/**
 * Moves one edge of a segment to `tick`: onto the step of {@link STEP_SECONDS} from the round's start when `snap` (a
 * dragged edge), and always inside the round, at least {@link MIN_SEGMENT_SECONDS} long and at most
 * `maxSegmentSeconds`.
 */
export function trimSegment(
  segment: Segment,
  edge: 'start' | 'end',
  tick: number,
  source: EditorSource,
  snap: boolean,
): Segment {
  const round = roundOf(source, segment.round)
  if (!round) {
    return segment
  }
  const rate = source.tickRate
  const step = STEP_SECONDS * rate
  const min = ticksOf(MIN_SEGMENT_SECONDS, rate)
  const max = ticksOf(source.limits.maxSegmentSeconds, rate)
  const wanted = Math.round(snap ? round.startTick + Math.round((tick - round.startTick) / step) * step : tick)
  if (edge === 'start') {
    const low = Math.max(round.startTick, segment.endTick - max)
    const high = segment.endTick - min
    return { ...segment, startTick: Math.min(Math.max(wanted, low), high) }
  }
  const low = segment.startTick + min
  const high = Math.min(round.endTick, segment.startTick + max)
  return { ...segment, endTick: Math.max(Math.min(wanted, high), low) }
}

/** Moves one edge of a segment by `seconds` (a stepper of the inspector), within the same bounds as a trim. */
export function nudgeSegment(segment: Segment, edge: 'start' | 'end', seconds: number, source: EditorSource): Segment {
  const from = edge === 'start' ? segment.startTick : segment.endTick
  return trimSegment(segment, edge, from + ticksOf(seconds, source.tickRate), source, false)
}

/** Whether an edge can still move by `seconds`: false at the round's end, at the shortest and at the longest. */
export function canNudge(segment: Segment, edge: 'start' | 'end', seconds: number, source: EditorSource): boolean {
  const moved = nudgeSegment(segment, edge, seconds, source)
  return moved.startTick !== segment.startTick || moved.endTick !== segment.endTick
}

/** The list with the segment at `from` moved to `to`. */
export function moveSegment(segments: Segment[], from: number, to: number): Segment[] {
  if (from === to || from < 0 || from >= segments.length) {
    return segments
  }
  const list = [...segments]
  const [moved] = list.splice(from, 1)
  list.splice(Math.min(Math.max(to, 0), list.length), 0, moved)
  return list
}

/** Why the backend would refuse the montage as it is; the order is offered only without any. */
export type Problem =
  | { kind: 'empty' }
  | { kind: 'tooManySegments'; count: number; max: number }
  | { kind: 'tooLong'; total: number; max: number }
  | { kind: 'segmentTooLong'; number: number; max: number }
  | { kind: 'titleTooLong'; max: number }

/** The rules of the backend (plan 7, "Shartnoma"), checked before the order: an empty list is a montage that fits. */
export function problemsOf(montage: Montage, source: EditorSource): Problem[] {
  const { maxSegments, maxDurationSeconds, maxSegmentSeconds, titleMaxLength } = source.limits
  const problems: Problem[] = []
  const count = montage.segments.length
  if (count === 0) {
    problems.push({ kind: 'empty' })
  }
  if (count > maxSegments) {
    problems.push({ kind: 'tooManySegments', count, max: maxSegments })
  }
  const total = totalSeconds(montage, source.tickRate)
  if (total > maxDurationSeconds) {
    problems.push({ kind: 'tooLong', total, max: maxDurationSeconds })
  }
  montage.segments.forEach((segment, index) => {
    if (segmentSeconds(segment, source.tickRate) > maxSegmentSeconds) {
      problems.push({ kind: 'segmentTooLong', number: index + 1, max: maxSegmentSeconds })
    }
  })
  if (montage.options.title.trim().length > titleMaxLength) {
    problems.push({ kind: 'titleTooLong', max: titleMaxLength })
  }
  return problems
}

/**
 * The text without its control characters (a pasted tab or line break): the backend refuses a title that has one, and
 * would say so as a wrong option. The title field drops them as they are typed or pasted.
 */
export function withoutControls(text: string): string {
  return text.replace(/\p{Cc}/gu, '')
}

/** The order of the montage as the backend takes it: the segments in their order, an empty title as none. */
export function toRequest(montage: Montage, playerId: string): MontageRequest {
  const { title, intro, musicTrack, quality, fps, aspect } = montage.options
  // A draft kept before the field dropped control characters may still hold one.
  const trimmed = withoutControls(title).trim()
  return {
    playerId,
    quality,
    fps,
    aspect,
    title: trimmed.length > 0 ? trimmed : null,
    intro,
    musicTrack,
    segments: montage.segments.map(({ startTick, endTick, slowMo }) => ({ startTick, endTick, slowMo })),
  }
}

/** The `localStorage` key of the draft of a player's montage in a match (plan 7, "Shartnoma"). */
export function draftKey(matchId: string, playerId: string): string {
  return `csfaceit.montage.${matchId}.${playerId}`
}

/**
 * The draft as it is stored: the segments without their ids and rounds (both are found again), and the options. A draft
 * kept before the frame rate could be chosen has no `fps`, and is read as 60.
 */
interface StoredDraft {
  version: 1
  segments: { startTick: number; endTick: number; slowMo: boolean }[]
  title: string
  intro: boolean
  musicTrack: string | null
  quality: ClipQuality
  fps: ClipFps
  aspect: MontageAspect
}

/** The montage as the text the browser keeps. */
export function serializeDraft(montage: Montage): string {
  const stored: StoredDraft = {
    version: 1,
    segments: montage.segments.map(({ startTick, endTick, slowMo }) => ({ startTick, endTick, slowMo })),
    ...montage.options,
  }
  return JSON.stringify(stored)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * The montage of a stored draft, if it still fits the source: every segment inside one round of it, and the music, the
 * quality, the frame rate (60 for a draft without one) and the aspect among those it offers. Anything else (no draft,
 * another shape, a source that changed) is null, and the editor starts afresh. A title longer than the source allows is
 * cut.
 */
export function parseDraft(raw: string | null, source: EditorSource): Montage | null {
  if (!raw) {
    return null
  }
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(stored) || stored.version !== 1 || !Array.isArray(stored.segments)) {
    return null
  }
  const { limits } = source
  const { title, intro, musicTrack, quality, aspect } = stored
  const fps = stored.fps === undefined ? 60 : stored.fps
  if (
    typeof title !== 'string' ||
    typeof intro !== 'boolean' ||
    !(musicTrack === null || limits.musicTracks.some((track) => track.id === musicTrack)) ||
    !limits.qualities.some((offered) => offered === quality) ||
    !limits.frameRates.some((offered) => offered === fps) ||
    !limits.aspects.some((offered) => offered === aspect)
  ) {
    return null
  }
  const segments: Segment[] = []
  for (const item of stored.segments) {
    if (!isRecord(item)) {
      return null
    }
    const { startTick, endTick, slowMo } = item
    if (
      typeof startTick !== 'number' ||
      typeof endTick !== 'number' ||
      typeof slowMo !== 'boolean' ||
      !Number.isInteger(startTick) ||
      !Number.isInteger(endTick) ||
      startTick >= endTick
    ) {
      return null
    }
    const round = source.rounds.find((candidate) => candidate.startTick <= startTick && endTick <= candidate.endTick)
    if (!round) {
      return null
    }
    segments.push({ id: segments.length + 1, round: round.number, startTick, endTick, slowMo })
  }
  return {
    segments,
    options: {
      title: title.slice(0, limits.titleMaxLength),
      intro,
      musicTrack: musicTrack as string | null,
      quality: quality as ClipQuality,
      fps: fps as ClipFps,
      aspect: aspect as MontageAspect,
    },
  }
}

/** Seconds of the video as a timecode: `0:12.5`, `1:04.0`. */
export function formatTimecode(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10))
  const minutes = Math.floor(tenths / 600)
  const rest = (tenths % 600) / 10
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
}
