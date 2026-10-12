import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { once } from 'node:events'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import * as zlib from 'node:zlib'
import { ApiError, type Api, type DemoStream, type WorkerJob } from './api.js'
import type { Config } from './config.js'
import { log } from './log.js'
import { RecorderError } from './recorders/recorder.js'

export interface DemoCache {
  /**
   * Where the demo of the job is, as a `.dem` file the game can read. A demo that is kept is used as it is; any other
   * is downloaded and unpacked first, and the least recently used files beyond `DEMO_CACHE_ITEMS` are removed. Several
   * clips of one match, one after the other, cost one download.
   *
   * @throws RecorderError the demo cannot be had (it is gone, the download broke off, the disk is full)
   */
  ensure(job: WorkerJob, signal?: AbortSignal): Promise<string>
}

/**
 * Both parts of the file name come from the backend, so they are checked before they are put into a path: the id of a
 * FACEIT match is letters, digits and dashes, and the version of a demo is the epoch milliseconds of its last change.
 */
const MATCH_ID = /^[A-Za-z0-9-]{1,64}$/
const DEMO_VERSION = /^[0-9]{1,20}$/
/**
 * The zstd stream of `node:zlib` came with Node.js 22.15. It is looked at through the namespace, not imported by name,
 * so that an older Node ends the start with a clear message instead of a failure to link the module.
 */
export const zstdAvailable = typeof zlib.createZstdDecompress === 'function'
/** A file of the cache, as opposed to a download that is not finished (`.part`). */
const CACHED_DEMO = /^[A-Za-z0-9-]{1,64}-[0-9]{1,20}\.dem$/

export function createDemoCache(config: Config, api: Pick<Api, 'openDemo'>): DemoCache {
  const dir = join(config.workDir, 'demos')

  async function ensure(job: WorkerJob, signal?: AbortSignal): Promise<string> {
    if (!MATCH_ID.test(job.matchId) || !DEMO_VERSION.test(job.demoVersion)) {
      throw new RecorderError(
        `The job names a demo that cannot be kept as a file (match ${shown(job.matchId)}, ` +
          `version ${shown(job.demoVersion)})`,
        false,
      )
    }
    const name = `${job.matchId}-${job.demoVersion}.dem`
    const path = join(dir, name)
    await mkdir(dir, { recursive: true })
    if (await isFile(path)) {
      // The cache gives up the file that was used longest ago, and this one has just been used.
      const now = new Date()
      await utimes(path, now, now)
      log.info(`Demo ${name}: found in the cache, nothing downloaded`)
      return path
    }
    await download(job, name, path, signal)
    await prune(name)
    return path
  }

  async function download(job: WorkerJob, name: string, path: string, signal?: AbortSignal): Promise<void> {
    const started = Date.now()
    const demo = await open(job, signal)
    const temporary = join(dir, `${name}.${process.pid}-${started}.part`)
    let received = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length
        done(null, chunk)
      },
    })
    let file: WriteStream | undefined
    try {
      // The announced length is the stored size the job names; a demo of another size is not the one that was meant.
      if (demo.contentLength === null) {
        throw new RecorderError('The backend sent the demo without saying how long it is', true)
      }
      if (demo.contentLength !== job.demoSizeBytes) {
        throw new RecorderError(
          `The backend announced a demo of ${demo.contentLength} bytes but the job says ${job.demoSizeBytes}`,
          true,
        )
      }
      file = createWriteStream(temporary, { flags: 'wx' })
      await pipeline(
        [Readable.fromWeb(demo.body as NodeReadableStream), counter, zlib.createZstdDecompress(), file],
        signal === undefined ? {} : { signal },
      )
      // The decompressor takes a stream that stops short for a finished one, so the bytes are counted.
      if (received !== job.demoSizeBytes) {
        throw new RecorderError(`The demo download stopped at ${received} of ${job.demoSizeBytes} bytes`, true)
      }
      if (file.bytesWritten === 0) {
        throw new RecorderError('The stored demo unpacks to nothing', false)
      }
      await rename(temporary, path)
      log.info(
        `Demo ${name}: downloaded ${received} bytes, unpacked to ${file.bytesWritten} bytes in ` +
          `${((Date.now() - started) / 1000).toFixed(1)} s`,
      )
    } catch (error) {
      await demo.body.cancel().catch(() => undefined)
      // A file is created by the stream asynchronously, so it is removed only once the stream has closed.
      if (file !== undefined) {
        file.destroy()
        if (!file.closed) {
          await once(file, 'close').catch(() => undefined)
        }
      }
      await rm(temporary, { force: true })
      throw explain(error, signal)
    }
  }

  /** Asks for the demo; 410 is the backend saying the file is not stored any more, which no attempt will change. */
  async function open(job: WorkerJob, signal?: AbortSignal): Promise<DemoStream> {
    try {
      return await api.openDemo(job.clipId, signal === undefined ? undefined : { signal })
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) {
        throw new RecorderError('The demo file is no longer stored', false)
      }
      throw error
    }
  }

  /** Removes what the run that was stopped half way left, then the files beyond the number to keep. */
  async function prune(justUsed: string): Promise<void> {
    const entries = await readdir(dir)
    for (const leftover of entries.filter((entry) => entry.endsWith('.part'))) {
      await rm(join(dir, leftover), { force: true })
    }
    const others: { name: string; usedAt: number }[] = []
    for (const name of entries.filter((entry) => CACHED_DEMO.test(entry) && entry !== justUsed)) {
      const info = await stat(join(dir, name)).catch(() => undefined)
      if (info !== undefined) {
        others.push({ name, usedAt: info.mtimeMs })
      }
    }
    others.sort((a, b) => b.usedAt - a.usedAt)
    for (const { name } of others.slice(config.demoCacheItems - 1)) {
      await rm(join(dir, name), { force: true })
      log.info(`Demo ${name}: removed from the cache, which keeps ${config.demoCacheItems}`)
    }
  }

  return { ensure }
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() ?? false
}

/** A value of the job as it goes into a message: cut short and quoted, as it is not known to be harmless. */
function shown(value: string): string {
  return JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}...` : value)
}

/** Says what a download that failed means: the caller's own abort, the demo itself, the disk or the connection. */
function explain(error: unknown, signal: AbortSignal | undefined): unknown {
  if (signal?.aborted) {
    return signal.reason
  }
  if (error instanceof RecorderError || error instanceof ApiError) {
    return error
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'ENOSPC') {
    return new RecorderError('The disk of the recorder is full', true, true)
  }
  if (code?.startsWith('ZSTD_')) {
    return new RecorderError(`The stored demo is not zstd data this recorder can unpack (${message})`, false)
  }
  return new RecorderError(`The demo download broke off: ${message}`, true)
}
