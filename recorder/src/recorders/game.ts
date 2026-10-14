import { execFile } from 'node:child_process'
import { open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { childEnvironment } from '../machine.js'

/**
 * CS2 on the recording machine, as far as the CS Demo Manager recorder needs to know it besides what CS Demo Manager
 * does itself: where the game is, which build it is, what the game plugin of CS Demo Manager writes to its log while it
 * plays a demo, how to stop the game, and which patch of the game a demo was recorded with. Everything here is
 * best-effort: a value that cannot be found is `undefined`, and the recorder then does without it.
 */

const execFileAsync = promisify(execFile)

/** Where a Steam library keeps CS2, which Steam still installs under the name of CS:GO. */
const CS2_IN_LIBRARY = ['steamapps', 'common', 'Counter-Strike Global Offensive']
/** The game's executable inside its folder. */
const CS2_EXECUTABLE = ['game', 'bin', 'win64', 'cs2.exe']
/** How long the small Windows tools (`reg`, `taskkill`) may take. */
const TOOL_TIMEOUT_MS = 15_000
/** The bytes at the start of a demo that hold its header: CS Demo Manager reads as many. */
const HEADER_BYTES = 4096

/**
 * The folder of CS2: `given` (`CS2_PATH`) as it is, or the library of Steam that holds the game, found the way CS Demo
 * Manager finds it (`get-csgo-folder-path.ts`): Steam's folder from the registry, then its `libraryfolders.vdf`.
 */
export async function findCs2Folder(given: string | undefined): Promise<string | undefined> {
  if (given !== undefined) {
    return given
  }
  const steam = await steamFolder()
  if (steam === undefined) {
    return undefined
  }
  const libraries = [steam]
  const vdf = await readFile(join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8').catch(() => '')
  for (const match of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
    libraries.push((match[1] ?? '').replace(/\\\\/g, '\\'))
  }
  for (const library of libraries) {
    const folder = join(library, ...CS2_IN_LIBRARY)
    if (await exists(join(folder, ...CS2_EXECUTABLE))) {
      return folder
    }
  }
  return undefined
}

/** Steam's folder, from `HKCU\Software\Valve\Steam\SteamPath` (written with forward slashes, which Windows takes). */
async function steamFolder(): Promise<string | undefined> {
  if (process.platform !== 'win32') {
    return undefined
  }
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      windowsHide: true,
      timeout: TOOL_TIMEOUT_MS,
      env: childEnvironment(),
    })
    return /SteamPath\s+REG_\w+\s+(.+)$/m.exec(stdout)?.[1]?.trim()
  } catch {
    return undefined
  }
}

/**
 * The build of the installed game, from its `game\csgo\steam.inf` (`PatchVersion=1.41.6.8`, else `ClientVersion=`).
 * Only ever compared for equality: it says whether the game is still the one a demo was played on before.
 */
export async function gameBuild(cs2Folder: string): Promise<string | undefined> {
  const inf = await readFile(join(cs2Folder, 'game', 'csgo', 'steam.inf'), 'utf8').catch(() => '')
  return (/^PatchVersion=(.+)$/m.exec(inf)?.[1] ?? /^ClientVersion=(.+)$/m.exec(inf)?.[1])?.trim() || undefined
}

/** The log of CS Demo Manager's game plugin, which it writes beside the game's executable and empties at each start. */
export function pluginLogPath(cs2Folder: string): string {
  return join(cs2Folder, 'game', 'bin', 'win64', 'csdm.log')
}

/** What the plugin's log says of a playback (`cs2-server-plugin/main.cpp` in CS Demo Manager's repository). */
export interface PluginLog {
  /** `[tick] Demo playback started, sequences N`: the game plays the demo. */
  playbackStarted: boolean
  /** `[tick] Executing: mirv_streams record start` and `... record end`: HLAE began and finished a sequence. */
  sequencesStarted: number
  sequencesEnded: number
}

/**
 * Reads the plugin's log, if it was written since `since` (epoch milliseconds): an older file is the log of another
 * game start. The log also holds a copy of the actions file, whose lines are `"cmd": "..."` and never `Executing:`.
 */
export async function readPluginLog(path: string, since: number): Promise<PluginLog | undefined> {
  const info = await stat(path).catch(() => undefined)
  if (info === undefined || info.mtimeMs < since) {
    return undefined
  }
  const text = await readFile(path, 'utf8').catch(() => undefined)
  if (text === undefined) {
    return undefined
  }
  const count = (pattern: RegExp) => text.match(pattern)?.length ?? 0
  return {
    playbackStarted: /Demo playback started/.test(text),
    sequencesStarted: count(/Executing: mirv_streams record start/g),
    sequencesEnded: count(/Executing: mirv_streams record end/g),
  }
}

/**
 * The patch of the game a CS2 demo was recorded with: field 2 (`patch_version`, once `network_protocol`) of the
 * `CDemoFileHeader` message, which follows the stamp `PBDEMS2\0` and 8 bytes of offsets as a varint command (1), a
 * varint tick and a varint length. 14068 for a demo of the game's patch 1.40.6.8. `undefined` for anything else.
 */
export async function demoPatchVersion(demoPath: string): Promise<number | undefined> {
  const header = Buffer.alloc(HEADER_BYTES)
  let length: number
  try {
    const file = await open(demoPath, 'r')
    try {
      length = (await file.read(header, 0, HEADER_BYTES, 0)).bytesRead
    } finally {
      await file.close()
    }
  } catch {
    return undefined
  }
  if (header.toString('latin1', 0, 8) !== 'PBDEMS2\0') {
    return undefined
  }
  let position = 16
  const varint = (): number | undefined => {
    let value = 0
    for (let shift = 0; shift < 35 && position < length; shift += 7) {
      const byte = header[position++] ?? 0
      value += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) {
        return value
      }
    }
    return undefined
  }
  const command = varint()
  varint()
  const size = varint()
  if (command !== 1 || size === undefined) {
    return undefined
  }
  const end = Math.min(length, position + size)
  while (position < end) {
    const key = varint()
    if (key === undefined) {
      return undefined
    }
    const field = Math.floor(key / 8)
    const wireType = key % 8
    if (wireType === 0) {
      const value = varint()
      if (field === 2) {
        return value
      }
    } else if (wireType === 2) {
      // The length is read first: `position += varint()` would add it to the position before the length's own bytes.
      const skip = varint()
      position = skip === undefined ? end : position + skip
    } else {
      return undefined
    }
  }
  return undefined
}

/** Ends a process and every process it started that is still its child (`taskkill /T`), at once (`/F`). */
export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // It is gone already.
    }
    return
  }
  await taskkill(['/PID', String(pid)])
}

/**
 * Ends the game and HLAE wherever they are, with what they started (the ffmpeg that HLAE records with runs under the
 * game). HLAE starts the game and exits, so the game is not in the process tree of CS Demo Manager and has to be found
 * by its name; CS Demo Manager itself ends any running `cs2.exe` the same way before it starts one.
 */
export async function killGame(): Promise<void> {
  if (process.platform !== 'win32') {
    return
  }
  await taskkill(['/IM', 'cs2.exe'])
  await taskkill(['/IM', 'hlae.exe'])
}

/** `taskkill /F /T` with the given target; a process that is not there is no error worth a word. */
async function taskkill(target: string[]): Promise<void> {
  await execFileAsync('taskkill', ['/F', '/T', ...target], {
    windowsHide: true,
    timeout: TOOL_TIMEOUT_MS,
    env: childEnvironment(),
  }).catch(() => undefined)
}

/**
 * What the recorder has learned about which demos the installed game plays: the newest patch of a demo it recorded on
 * the current build of the game. A demo of an older patch that the game will not play, on a build that played a newer
 * demo, is the demo's fault and not the machine's (see the recorder). A new build of the game starts the record anew.
 */
export interface PlayableDemos {
  newest(build: string): Promise<number | undefined>
  remember(build: string, patch: number): Promise<void>
}

export function playableDemos(workDir: string): PlayableDemos {
  const path = join(workDir, 'csdm-playable.json')

  async function load(): Promise<{ build: string; newestPatch: number } | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'))
      const { build, newestPatch } = (value ?? {}) as Record<string, unknown>
      return typeof build === 'string' && typeof newestPatch === 'number' ? { build, newestPatch } : undefined
    } catch {
      return undefined
    }
  }

  return {
    async newest(build) {
      const known = await load()
      return known?.build === build ? known.newestPatch : undefined
    },

    async remember(build, patch) {
      const known = await load()
      if (known?.build === build && known.newestPatch >= patch) {
        return
      }
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify({ build, newestPatch: patch }))
      await rename(temporary, path)
    },
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined
}
