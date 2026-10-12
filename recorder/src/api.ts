import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Config } from './config.js'
import { log } from './log.js'

/** The stages of a clip that a recorder reports; the others of `ClipStatus` (waiting, finished) are the backend's. */
export type Stage = 'RECORDING' | 'ENCODING' | 'UPLOADING'

/** A stretch of the demo, in ticks, both ends included (`ClipSegment`). */
export interface Segment {
  startTick: number
  endTick: number
}

/** The clip a recorder has taken (`WorkerJob`); the field names are the backend's. */
export interface WorkerJob {
  clipId: number
  kind: string
  matchId: string
  mapName: string | null
  /** The SteamID of the player the camera follows. */
  focusSteamId: string
  tickRate: number
  /** One after the other, in the order of the list; the video is all of them joined. */
  segments: Segment[]
  width: number
  height: number
  fps: number
  /** The size of the stored (zstd) demo, which the download must match exactly. */
  demoSizeBytes: number
  /** Names this version of the demo file: epoch milliseconds as a string, so a demo kept under it is still the one. */
  demoVersion: string
}

/** Σ(endTick − startTick) / tickRate: how long the video of the job is, in seconds. */
export function videoSeconds(job: WorkerJob): number {
  return job.segments.reduce((sum, segment) => sum + (segment.endTick - segment.startTick), 0) / job.tickRate
}

/** The backend holds the clip for no one but this recorder: the one signal that says to stop working on the clip. */
export class ClaimLostError extends Error {
  readonly clipId: number

  constructor(clipId: number, detail: string) {
    super(`The backend does not hold clip ${clipId} for this recorder any more (${detail})`)
    this.name = 'ClaimLostError'
    this.clipId = clipId
  }
}

/** An answer the recorder cannot go on with, or no answer at all after the tries: `status` is 0 then. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  /** The backend does not take the worker token: `CLIP_WORKER_TOKEN` here is not the one the backend runs with. */
  get tokenRefused(): boolean {
    return this.status === 401 || this.status === 403
  }
}

/** The backend sent a job the recorder cannot read; `clipId` is set when even that much could be read. */
export class MalformedJobError extends Error {
  readonly clipId: number | undefined

  constructor(message: string, clipId: number | undefined) {
    super(`The job could not be read: ${message}`)
    this.name = 'MalformedJobError'
    this.clipId = clipId
  }
}

/** The demo as the backend sends it, still compressed: `contentLength` is what its `Content-Length` says. */
export interface DemoStream {
  body: ReadableStream<Uint8Array>
  contentLength: number | null
}

export interface FinishedVideo {
  durationMs: number
  width: number
  height: number
}

/** What a request may be told besides what it asks: when to give up, how often to try again, how long one try is. */
export interface RequestOptions {
  signal?: AbortSignal
  retries?: number
  timeoutMs?: number
}

/** One function for each request of the worker API (`/api/worker/v1`); the recorder knows no other. */
export interface Api {
  /** The clip to record, or `undefined` when none is waiting. */
  claim(options?: RequestOptions): Promise<WorkerJob | undefined>
  progress(clipId: number, stage: Stage, percent: number, options?: RequestOptions): Promise<void>
  openDemo(clipId: number, options?: RequestOptions): Promise<DemoStream>
  uploadVideo(clipId: number, file: string, options?: RequestOptions): Promise<void>
  uploadThumbnail(clipId: number, file: string, options?: RequestOptions): Promise<void>
  complete(clipId: number, video: FinishedVideo, options?: RequestOptions): Promise<void>
  fail(clipId: number, error: string, retryable: boolean, options?: RequestOptions): Promise<void>
  heartbeat(state: 'IDLE' | 'WORKING', clipId: number | null, options?: RequestOptions): Promise<void>
}

/** A request that got no answer, or a 5xx, is tried again this many times, waiting twice as long before each. */
const MAX_RETRIES = 5
const FIRST_DELAY_MS = 1000
/** The longest one try of a small request may take; a download or an upload has no limit but its signal. */
const REQUEST_TIMEOUT_MS = 30_000
/**
 * An upload that moves no data and gets no answer for this long is given up (the connection is dead). The backend
 * answers only after the file is stored, so this is as long as the Nginx in front of it waits (`frontend/nginx.conf`).
 */
const UPLOAD_IDLE_TIMEOUT_MS = 600_000
/** The most of an error body that is read: it is only for a message. */
const ERROR_BODY_LIMIT = 2000
/** The longest error text the backend keeps (`WorkerService.MAX_ERROR_LENGTH`); it cuts anything longer. */
const MAX_ERROR_LENGTH = 2000

interface Call {
  method: 'GET' | 'POST' | 'PUT'
  /** Relative to `/api/worker/v1`. */
  path: string
  query?: Record<string, string>
  json?: unknown
  file?: { path: string; type: string }
  /** The clip the request is about: a 409 on it means the claim is lost. */
  clipId?: number
  /** A download or an upload, which no timer may cut short. */
  long?: boolean
  /** Says what the request was in a message: `POST /claim`. */
  label: string
}

export function createApi(config: Config, version: string): Api {
  const worker = config.workerName

  /**
   * Sends the request, and again while there is no answer or the answer is a 5xx, at most `retries` more times. Any
   * other answer is returned as it is, for `accept` to judge. A try is abandoned when it takes longer than
   * `timeoutMs` (the backend hangs); a request whose `signal` aborts ends at once with the signal's reason.
   */
  async function send(call: Call, options: RequestOptions = {}): Promise<Response> {
    const { signal, retries = MAX_RETRIES, timeoutMs = REQUEST_TIMEOUT_MS } = options
    const url = new URL(`${config.backendUrl}/api/worker/v1${call.path}`)
    for (const [name, value] of Object.entries(call.query ?? {})) {
      url.searchParams.set(name, value)
    }
    for (let attempt = 0; ; attempt++) {
      const outcome = await tryOnce(call, url, signal, call.long ? undefined : timeoutMs)
      if (typeof outcome === 'string') {
        if (attempt >= retries) {
          throw new ApiError(`${call.label} got no answer: ${outcome}`, 0)
        }
        await pause(call, attempt, `no answer: ${outcome}`, signal)
      } else if (outcome.status >= 500) {
        if (attempt >= retries) {
          throw await refusalOf(outcome, call)
        }
        await outcome.body?.cancel()
        await pause(call, attempt, `answered ${outcome.status}`, signal)
      } else {
        return outcome
      }
    }
  }

  /** One try: the response, or the reason there was none. An abort of the caller's own `signal` is thrown. */
  async function tryOnce(
    call: Call,
    url: URL,
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined,
  ): Promise<Response | string> {
    const headers = headersOf(call, config.workerToken, version)
    // A file that is not there is the recorder's own problem and no reason to try again: it is not looked at in the try.
    const size = call.file === undefined ? 0 : (await stat(call.file.path)).size
    try {
      if (call.file !== undefined) {
        return await uploadFile(url, headers, call.file.path, size, signal)
      }
      const limits = [signal, timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)]
      return await fetch(url, {
        method: call.method,
        headers,
        body: call.json === undefined ? undefined : JSON.stringify(call.json),
        // A redirect would send the token to wherever it points; it is a wrong BACKEND_URL, and is reported as such.
        redirect: 'manual',
        signal: AbortSignal.any(limits.filter((limit) => limit !== undefined)),
      })
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason
      }
      return describeNetworkError(error)
    }
  }

  async function pause(call: Call, attempt: number, why: string, signal: AbortSignal | undefined): Promise<void> {
    const delay = FIRST_DELAY_MS * 2 ** attempt
    log.warn(`${call.label}: ${why}; trying again in ${delay / 1000} s (retry ${attempt + 1} of ${MAX_RETRIES})`)
    try {
      await sleep(delay, undefined, signal === undefined ? undefined : { signal })
    } catch {
      throw signal?.reason
    }
  }

  /** Lets a 2xx answer through, and turns any other into the error it stands for. */
  async function accept(response: Response, call: Call): Promise<Response> {
    if (response.ok) {
      return response
    }
    throw await refusalOf(response, call)
  }

  /** An answer with nothing in it that matters; closing the body lets the connection be used again. */
  async function noContent(call: Call, options: RequestOptions | undefined): Promise<void> {
    const response = await accept(await send(call, options), call)
    await response.body?.cancel()
  }

  function uploadCall(clipId: number, what: 'video' | 'thumbnail', path: string, type: string): Call {
    return {
      method: 'PUT',
      path: `/clips/${clipId}/${what}`,
      query: { worker },
      file: { path, type },
      clipId,
      long: true,
      label: `PUT /clips/${clipId}/${what}`,
    }
  }

  return {
    async claim(options) {
      const call: Call = {
        method: 'POST',
        path: '/claim',
        json: { worker, version, mode: config.mode, qualities: config.qualities },
        label: 'POST /claim',
      }
      const response = await send(call, options)
      if (response.status === 204) {
        await response.body?.cancel()
        return undefined
      }
      return parseJob(await (await accept(response, call)).json())
    },

    progress(clipId, stage, percent, options) {
      return noContent(
        {
          method: 'POST',
          path: `/clips/${clipId}/progress`,
          json: { worker, stage, progress: percent },
          clipId,
          label: `POST /clips/${clipId}/progress`,
        },
        options,
      )
    },

    async openDemo(clipId, options) {
      const call: Call = {
        method: 'GET',
        path: `/clips/${clipId}/demo`,
        query: { worker },
        clipId,
        long: true,
        label: `GET /clips/${clipId}/demo`,
      }
      const response = await accept(await send(call, options), call)
      if (response.body === null) {
        throw new ApiError(`${call.label} answered ${response.status} without a body`, response.status)
      }
      const declared = response.headers.get('content-length')
      return {
        body: response.body,
        contentLength: declared !== null && /^\d+$/.test(declared) ? Number(declared) : null,
      }
    },

    uploadVideo(clipId, file, options) {
      return noContent(uploadCall(clipId, 'video', file, 'video/mp4'), options)
    },

    uploadThumbnail(clipId, file, options) {
      return noContent(uploadCall(clipId, 'thumbnail', file, 'image/jpeg'), options)
    },

    complete(clipId, video, options) {
      return noContent(
        {
          method: 'POST',
          path: `/clips/${clipId}/complete`,
          json: { worker, durationMs: video.durationMs, width: video.width, height: video.height },
          clipId,
          label: `POST /clips/${clipId}/complete`,
        },
        options,
      )
    },

    fail(clipId, error, retryable, options) {
      return noContent(
        {
          method: 'POST',
          path: `/clips/${clipId}/fail`,
          json: { worker, error: error.slice(0, MAX_ERROR_LENGTH), retryable },
          clipId,
          label: `POST /clips/${clipId}/fail`,
        },
        options,
      )
    },

    heartbeat(state, clipId, options) {
      return noContent(
        {
          method: 'POST',
          path: '/heartbeat',
          json: { worker, version, mode: config.mode, state, clipId },
          label: 'POST /heartbeat',
        },
        options,
      )
    },
  }
}

function headersOf(call: Call, token: string, version: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Worker-Token': token,
    'User-Agent': `csfaceit-recorder/${version}`,
    // The backend sends its errors as JSON and the demo as `application/zstd`.
    Accept: call.long ? '*/*' : 'application/json',
  }
  if (call.json !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (call.file !== undefined) {
    headers['Content-Type'] = call.file.type
  }
  if (call.long) {
    // The byte counts of a download and the length of an upload are the file's own; nothing may re-encode them.
    headers['Accept-Encoding'] = 'identity'
  }
  return headers
}

/**
 * Sends a file as the body of a request, from the disk in chunks and at the pace of the connection, so that it is never
 * held in memory. `fetch` cannot do that: whatever the body is, a file-backed Blob or a stream, it takes the whole of
 * it in first (measured: 154 MB of memory more for a 126 MB file), and a video can be several hundred megabytes.
 * `node:http` with a piped read stream stays about 50 MB above its start for any size (51 MB for 629 MB). The answer
 * comes back as a `Response`, like that of every other request.
 */
function uploadFile(
  url: URL,
  headers: Record<string, string>,
  path: string,
  size: number,
  signal: AbortSignal | undefined,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request(
      url,
      {
        method: 'PUT',
        headers: { ...headers, 'Content-Length': String(size) },
        ...(signal === undefined ? {} : { signal }),
      },
      (answer) => resolve(responseOf(answer)),
    )
    request.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error(`no data moved for ${UPLOAD_IDLE_TIMEOUT_MS / 1000} s`))
    })
    request.on('error', reject)
    // An answer that comes before the file is all sent (a 413, say) settles the promise first; what the pipeline
    // reports after that, the connection that is closed on it, changes nothing.
    pipeline(createReadStream(path), request).catch(reject)
  })
}

/** An answer of `node:http` as the `Response` that `fetch` would have given. */
function responseOf(answer: IncomingMessage): Response {
  const headers = new Headers()
  for (const [name, value] of Object.entries(answer.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }
  }
  const status = answer.statusCode ?? 0
  if (status === 204 || status === 205 || status === 304) {
    // These statuses have no body, and a `Response` of them may not be given one.
    answer.resume()
    return new Response(null, { status, headers })
  }
  return new Response(Readable.toWeb(answer) as NodeReadableStream<Uint8Array>, { status, headers })
}

/** The error a response that is not a success stands for. */
async function refusalOf(response: Response, call: Call): Promise<ApiError | ClaimLostError> {
  const { code, message } = await errorBodyOf(response)
  const status = response.status
  const answer = `${status}${code === undefined ? '' : ` ${code}`}`
  // `CLIP_VIDEO_MISSING` is the other 409 of a clip: the claim is held, but the video of this attempt is not there.
  if (status === 409 && call.clipId !== undefined && code !== 'CLIP_VIDEO_MISSING') {
    return new ClaimLostError(call.clipId, `${call.label} answered ${answer}`)
  }
  if (status === 401 || status === 403) {
    return new ApiError(
      `The backend refused the worker token (${call.label} answered ${answer}): CLIP_WORKER_TOKEN here is not the ` +
        'token the backend runs with',
      status,
      code,
    )
  }
  if (status >= 300 && status < 400) {
    const target = response.headers.get('location')
    return new ApiError(
      `${call.label} was redirected (${status}${target === null ? '' : ` to ${target}`}): BACKEND_URL should be the ` +
        'final address of the backend',
      status,
    )
  }
  return new ApiError(`${call.label} answered ${answer}${message === undefined ? '' : `: ${message}`}`, status, code)
}

/** The `code` and `message` of the backend's `ApiError` body, as far as it has one; the body is read and closed. */
async function errorBodyOf(response: Response): Promise<{ code?: string; message?: string }> {
  let text: string
  try {
    text = (await response.text()).slice(0, ERROR_BODY_LIMIT)
  } catch {
    return {}
  }
  try {
    const body: unknown = JSON.parse(text)
    if (typeof body === 'object' && body !== null) {
      const { code, message } = body as Record<string, unknown>
      return {
        ...(typeof code === 'string' ? { code } : {}),
        ...(typeof message === 'string' ? { message } : {}),
      }
    }
  } catch {
    // Not the backend's own error (a proxy's page, say): the text itself is the best message there is.
  }
  return text.trim() === '' ? {} : { message: text.trim() }
}

/** The reason a request got no answer: the system's own code (`ECONNREFUSED`, `ENOTFOUND`) helps most. */
function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    // `fetch` wraps the system's error as the cause of a plain "fetch failed"; `node:http` throws it as it is.
    const reason = error.cause instanceof Error ? error.cause : error
    const code = (reason as NodeJS.ErrnoException).code
    if (code !== undefined) {
      return `${code} (${reason.message})`
    }
    return error.name === 'TimeoutError' ? 'the backend did not answer in time' : reason.message
  }
  return String(error)
}

/**
 * Reads the answer of `claim`. It is checked field by field, because the recorder acts on it with a game or an ffmpeg
 * and a wrong number would show up far from here, as a strange video.
 *
 * @throws MalformedJobError a field is missing or has the wrong kind of value
 */
export function parseJob(value: unknown): WorkerJob {
  if (typeof value !== 'object' || value === null) {
    throw new MalformedJobError('the answer is not an object', undefined)
  }
  const fields = value as Record<string, unknown>
  const clipId = typeof fields.clipId === 'number' && Number.isSafeInteger(fields.clipId) ? fields.clipId : undefined
  const bad = (field: string, expected: string): MalformedJobError =>
    new MalformedJobError(`${field} is not ${expected}`, clipId)
  const whole = (field: string, min: number): number => {
    const number = fields[field]
    if (typeof number === 'number' && Number.isSafeInteger(number) && number >= min) {
      return number
    }
    throw bad(field, `a whole number of at least ${min}`)
  }
  const text = (field: string): string => {
    const string = fields[field]
    if (typeof string === 'string' && string !== '') {
      return string
    }
    throw bad(field, 'a text')
  }

  const rawSegments = fields.segments
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    throw bad('segments', 'a list with at least one segment')
  }
  const segments = rawSegments.map((raw: unknown, index): Segment => {
    const { startTick, endTick } = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    if (
      typeof startTick !== 'number' ||
      typeof endTick !== 'number' ||
      !Number.isSafeInteger(startTick) ||
      !Number.isSafeInteger(endTick) ||
      startTick < 0 ||
      endTick < startTick
    ) {
      throw bad(`segments[${index}]`, 'a pair of ticks with startTick not after endTick')
    }
    return { startTick, endTick }
  })

  const mapName = fields.mapName
  return {
    clipId: whole('clipId', 1),
    kind: text('kind'),
    matchId: text('matchId'),
    mapName: typeof mapName === 'string' ? mapName : null,
    focusSteamId: text('focusSteamId'),
    tickRate: whole('tickRate', 1),
    segments,
    width: whole('width', 1),
    height: whole('height', 1),
    fps: whole('fps', 1),
    demoSizeBytes: whole('demoSizeBytes', 0),
    demoVersion: text('demoVersion'),
  }
}
