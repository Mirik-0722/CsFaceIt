// The answer of `GET /api/v1/matches/{matchId}/editor?playerId=` and the body of `POST /api/v1/matches/{matchId}/montages`
// (plan 7, "Shartnoma"). Kept apart from types.ts, as breakdownTypes.ts is, so that the file other work is changing
// stays as it is.
import type { ClipQuality, HighlightType } from './types'

/** The two shapes a montage can be recorded in: landscape and vertical. */
export type MontageAspect = '16:9' | '9:16'

/**
 * One enemy kill of the player, by the tick of the demo it happened at. `weapon` is the raw name from the demo
 * (`ak47`); the four flags say how the kill was made.
 */
export interface EditorKill {
  tick: number
  weapon: string
  headshot: boolean
  wallbang: boolean
  noscope: boolean
  throughSmoke: boolean
  victimNickname: string
}

/**
 * One round of the match in which the player killed somebody (rounds without a kill of the player are not sent), with
 * its first and last tick and the player's side in it (`null` when the demo does not say).
 */
export interface EditorRound {
  number: number
  startTick: number
  endTick: number
  side: 'CT' | 'T' | null
  kills: EditorKill[]
}

/** A highlight of the player in the match, for the tags of its round in the library. */
export interface EditorHighlight {
  id: number
  type: HighlightType
  roundNumber: number
  tickStart: number
  tickEnd: number
}

/** A piece of music a montage can have under it: only its id and its name (there is no audio on the site). */
export interface MusicTrack {
  id: string
  name: string
}

/**
 * What the backend accepts in a montage. A segment of a kill starts `preSeconds` before it and ends `postSeconds` after
 * it; a segment is at most `maxSegmentSeconds` long, the whole montage (slow-motion segments twice, the intro 2 s) at
 * most `maxDurationSeconds`, and has at most `maxSegments` segments.
 */
export interface EditorLimits {
  preSeconds: number
  postSeconds: number
  maxSegmentSeconds: number
  maxDurationSeconds: number
  maxSegments: number
  qualities: ClipQuality[]
  aspects: MontageAspect[]
  titleMaxLength: number
  musicTracks: MusicTrack[]
}

/** What the montage editor is made from: the player's kills in one match, by round, and the rules of a montage. */
export interface EditorSource {
  matchId: string
  mapName: string | null
  tickRate: number
  player: { playerId: string; nickname: string }
  rounds: EditorRound[]
  highlights: EditorHighlight[]
  limits: EditorLimits
}

/** One part of the match in a montage, in ticks of the demo; a slow-motion part plays at half speed. */
export interface MontageSegment {
  startTick: number
  endTick: number
  slowMo: boolean
}

/** The order of a montage: the segments in the order they are to be played, and the options. */
export interface MontageRequest {
  playerId: string
  quality: ClipQuality
  aspect: MontageAspect
  title: string | null
  intro: boolean
  musicTrack: string | null
  segments: MontageSegment[]
}
