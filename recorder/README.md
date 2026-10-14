# Recorder

The recorder is the program that turns a clip that was asked for into a video. The backend keeps a queue of clips (see
[Video clips](../README.md#video-clips) in the main README); the recorder takes one, gets the demo of its match,
records the clip, and uploads the MP4 and a thumbnail. It is small, written in TypeScript for Node.js, has no runtime
dependency, and only ever talks to the backend, through the worker API (`/api/worker/v1/**`, the paths and the
answers are in [Worker API](../README.md#worker-api-the-recorder)). It never takes a connection and never touches
PostgreSQL, RabbitMQ or MinIO, so it can run on any machine that can reach the backend, behind NAT included: the
machine with the game, which is the point of it.

It records in one of two modes, `RECORDER_MODE`:

- `fake` makes a test pattern with ffmpeg instead of playing the demo. It exists so that the whole chain, from the
  queue to the player in the browser, can be built and tried on any machine, in Docker, without a game.
- `csdm` plays the demo in CS2 on a Windows machine and records it, driven by the command line of
  [CS Demo Manager](https://cs-demo-manager.com) with HLAE and FFmpeg. It is written from CS Demo Manager's source and
  has **not run on a real Windows machine yet**: see [Windows (real recording)](#windows-real-recording), whose first
  trial is also the first test of the mode.

## How a clip goes

| Step | What the recorder does | What the backend shows |
| --- | --- | --- |
| Claim | `POST /claim` every `POLL_SECONDS` while there is nothing to do; `204` means nothing is waiting. | `QUEUED`, then `RECORDING` 0% |
| Demo | The demo is kept as `<WORK_DIR>/demos/<matchId>-<demoVersion>.dem`. If it is not there it is downloaded (zstd), unpacked as a stream and moved into place; the clips of one match after the first find it. | `RECORDING` |
| Record | The recorder makes the video of the segments, one after the other. | `RECORDING` with the percent |
| Encode | A thumbnail (the frame at one second, 640 pixels wide) and the length and size of the video, read with ffprobe. | `ENCODING` |
| Upload | `PUT` the video, then the thumbnail, then `POST .../complete`. The files are sent from the disk, never held in memory. | `UPLOADING`, then `DONE` |

While it holds a clip the recorder reports its stage and the last known percent every 3 seconds in every stage, the
upload and the download of the demo included, because the backend takes a clip back when it hears nothing for
`clip.stale-after` (3 minutes) and an upload from a slow line can last longer than that. The percent belongs to the
recording; the stages after it report 100. Besides that, a heartbeat goes out every `HEARTBEAT_SECONDS` whether or not
there is a clip, which is what `GET /api/v1/recorder/status` shows as the recorder being online.

## Settings

All of them are environment variables. A variable that is set but empty counts as not set. A missing or wrong value
that matters ends the program at start with a message that names every problem. A setting in seconds is a whole number
of at most 86400 (one day): it becomes a timer, and a number that is too large would make Node run it at once.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKEND_URL` | none, required | The address of the backend, such as `http://backend:8080` (Compose) or `https://clips.example.com`. A redirect is an error, not followed: the token would go wherever it points. |
| `CLIP_WORKER_TOKEN` | none, required | The secret the backend runs with (`CLIP_WORKER_TOKEN` there). It is sent in the `X-Worker-Token` header and is never written to the log. ffmpeg and ffprobe are started without it in their environment. |
| `RECORDER_MODE` | none, required | `fake` or `csdm` (see above). There is no default on purpose: a recorder that was meant to play the game must not quietly make test patterns. |
| `WORKER_NAME` | the host name | The name of this recorder: 1 to 64 characters, only letters, digits, `.`, `_` and `-`. The backend answers every request of a recorder with another name with a `400`, so the program refuses it at start. The host name, which is the default, may hold other characters (a space, an accent): then `WORKER_NAME` has to be set. The backend keeps the name with the clip the recorder holds, so two recorders need two names. |
| `WORK_DIR` | `./work` | Where the recorder keeps its files (see below). It must be writable. |
| `POLL_SECONDS` | `5` | How long it waits before it asks for work again, after `204` or after an error (1 to 86400). It is also the shortest pause after a failed clip. |
| `HEARTBEAT_SECONDS` | `30` | How often it says it is there (1 to 86400). |
| `DEMO_CACHE_ITEMS` | `5` | How many unpacked demos are kept; the least recently used go first. A demo is a few hundred megabytes. |
| `QUALITIES` | `720p,1080p` | The qualities it can record, comma separated. The backend hands it clips of these only. |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe`; in `csdm` mode the ones CS Demo Manager installs, `%USERPROFILE%\.csdm\ffmpeg\bin\ffmpeg.exe` and `ffprobe.exe` | The two tools, found on the `PATH` unless a path is given. |
| `ERROR_BACKOFF_SECONDS` | `300` | The longest pause after failed clips (see [After a failure](#after-a-failure)), and the pause after a failure of the machine itself, which is this long at once (0 to 86400; never less than `POLL_SECONDS`). |
| `FAKE_SPEED` | `1` | Fake mode only. Seconds of video made per second of wall time: `1` is real time, `2` twice as fast, `0` as fast as ffmpeg goes. A real recording takes its time, and so does this, so that a clip can be watched going from state to state and a recorder that is stopped "while it records" can be caught. |
| `CSDM_PATH` | `%LOCALAPPDATA%\Programs\cs-demo-manager\csdm.cmd` | `csdm` mode only. The `csdm.cmd` of CS Demo Manager (its install folder works too). The recorder starts what that file starts, `cs-demo-manager.exe resources\app.asar\cli.js` with `ELECTRON_RUN_AS_NODE=1`, and refuses to start when they are not there. |
| `CSDM_MIN_TIMEOUT_SECONDS` | `600` | `csdm` mode only. The shortest time limit of a clip (60 to 86400). |
| `CSDM_TIMEOUT_FACTOR` | `6` | `csdm` mode only. A clip may take `max(CSDM_MIN_TIMEOUT_SECONDS, CSDM_TIMEOUT_FACTOR x the seconds of demo it records)`, from the analysis to the finished file; then CS Demo Manager, the game and HLAE are killed and the clip is given back to be tried again (1 to 100). |
| `CSDM_PLAYBACK_START_SECONDS` | `180` | `csdm` mode only. How long the game may take from its start until it plays the demo, read from the log of CS Demo Manager's game plugin; `0` does not watch it (see [When the game does not play the demo](#when-the-game-does-not-play-the-demo)). |
| `CS2_PATH` | found through Steam | `csdm` mode only. The CS2 folder, `...\steamapps\common\Counter-Strike Global Offensive`. Without it the recorder asks the registry where Steam is and looks in its libraries, as CS Demo Manager does. It only reads two files there (the game's build and the plugin's log); CS Demo Manager finds the game by itself. |

## Running the fake mode

**With Compose.** The service `recorder-fake` is in `docker-compose.fake.yml`, so the fake stack starts it with the rest:

```bash
docker compose -f docker-compose.yml -f docker-compose.fake.yml up -d --build --wait
docker compose -f docker-compose.yml -f docker-compose.fake.yml logs -f recorder-fake
```

It uses the token `dev-worker-token` (the backend of the fake stack runs with it) and the name `fake-1`, waits for the
backend to be healthy, and is started again after a crash. `FAKE_SPEED` can be set in the environment of the
command. Ask for a clip of a highlight of the fake stack's match, and watch it go:

```bash
curl -X POST -H 'X-API-Key: dev-admin-key' -H 'Content-Type: application/json' -d '{"quality": "720p"}' \
  http://localhost:3000/api/v1/highlights/<highlightId>/clips
curl http://localhost:3000/api/v1/clips/<clipId>
```

The video and the thumbnail are at `/api/v1/clips/<clipId>/video` and `/thumbnail`, and the clip is a page in the web
UI. Stopping the service (`docker compose ... stop recorder-fake`) gives the clip it holds back to the queue at once;
killing it (`kill`) leaves the clip to be taken back after `clip.stale-after`.

**By hand.** It needs Node.js 22.15 or newer (the demo is unpacked with the zstd stream of `node:zlib`, which came
with it) and `ffmpeg` and `ffprobe` with libx264 and the `drawtext` filter and a monospace font that fontconfig knows:

```bash
cd recorder
npm ci
npm run build
BACKEND_URL=http://localhost:3000 CLIP_WORKER_TOKEN=dev-worker-token RECORDER_MODE=fake npm start
```

`npm run lint` runs oxlint, `npm run build` the TypeScript compiler; there is nothing else to install.

## What the fake recording is

ffmpeg's `testsrc2` pattern and a quiet sine tone, at the width, height and frame rate of the job and as long as its
segments add up to (`Σ(endTick − startTick) / tickRate`), as H.264 `yuv420p` and AAC with `+faststart`, so that a
browser can start playing before the file has arrived. The frames carry the clip id, the SteamID of the player and, at
the bottom, the segment and the tick of the demo that the frame stands for. That makes the clip checkable: a mark of a
kill on the clip page takes the video to a frame whose tick is the tick of the kill. The demo itself is downloaded
and kept like any other but not played.

## Windows (real recording)

`RECORDER_MODE=csdm` records the clips with the game. It runs on a Windows PC of its own, signed in to a Steam account
of its own, and reaches the site over HTTP(S) like any recorder. It was written from the source of CS Demo Manager
(CS:DM) 3.20.1, the version its installer gives today, without a Windows machine: nothing below has run on one yet, and
[The first trial](#the-first-trial) is what proves it (it replaces the manual trial of plan 5, Task 0).

### How a clip is recorded

1. **The demo** is downloaded and kept as in the fake mode (`WORK_DIR\demos`).
2. **Analysis, once per demo.** `csdm analyze <demo>` puts the match into CS:DM's own database, which the video step
   needs to know the players (the camera follows a player by his place in the match, looked up by SteamID). The
   analysis of version 3.20.1 ends with exit code 0 even when it failed, so the recorder runs it again and counts the
   demo as analyzed only when CS:DM answers "already in database"; a file `<demo>.csdm-analyzed` beside the demo
   remembers it, so only the first clip of a match waits for it.
3. **Recording.** The recorder writes the configuration of `csdm video --config-file` from
   [`csdm-config.template.jsonc`](csdm-config.template.jsonc): one sequence per segment of the clip, the camera on the
   clip's player from the first tick of each, HLAE as the recording system, FFmpeg as the encoder, MP4, the game
   closed at the end. CS:DM starts CS2 through HLAE in a window of the size it records, plays the demo, records the
   sequences and quits the game; each sequence becomes `sequence-<n>-tick-<a>-to-<b>.mp4`. Steam must be running.
4. **The clip's video.** The recorder joins the sequences in the order of the clip, as H.264 `yuv420p` with AAC and
   `+faststart` (the index first, so that a browser starts playing at once). When nothing has to change, the streams are
   copied, which takes a moment. A montage is encoded once more, with ffmpeg:
   - **Slow motion** plays a segment at half speed (`setpts`, and `atempo` for its sound). CS:DM records a sequence at
     the game's own speed and has no time scale per sequence, so a slow segment shows every frame twice: it is half as
     smooth as the game could make it.
   - **9:16.** The game always records a 16:9 picture: a 9:16 clip is recorded at its quality on its side (1280x720
     for 720x1280) and its middle is cut out and scaled up, 1.78 times. A 9:16 clip at 1080p looks clearly better than
     one at 720p.
   - **The intro and the title** are written in Arial Bold from the fonts of Windows: a black card of 2 seconds with
     the title in the middle, then the title on the top line over the rest of the video, as the fake mode does. Any
     letter Arial has is shown, Uzbek and Cyrillic included.
   - **Music is not mixed in.** The job names a track only by its id in the backend's `clip.music-tracks`, and no audio
     file comes with it, so a montage with music is recorded without it. Laying a track under the video is one ffmpeg
     step once the recorder can get the file.
5. **Thumbnail, upload, done**, as in the fake mode.

The time limit of a clip is `max(CSDM_MIN_TIMEOUT_SECONDS, CSDM_TIMEOUT_FACTOR x its length)`, 10 minutes for a
highlight with the defaults and 30 minutes for a compilation of 5 minutes, from the analysis to the finished file. At the
limit the recorder kills CS:DM's process tree, `cs2.exe` and `hlae.exe` (HLAE starts the game and exits, so the game is
not in CS:DM's tree; CS:DM itself ends any running `cs2.exe` the same way before it starts one) and gives the clip back.

The template is the place to change how clips look: x-ray (off), the kill feed only (on, 5 seconds), the voices of the
players (off: they are other people's conversations), the game's sound (on), the quality of the recorded sequences
(`constantRateFactor` 18). The recorder sets whatever it depends on itself (HLAE, FFmpeg, MP4, the size, the frame rate,
the sequences, the player). Only whole lines may be comments, and no value may hold a `#` or two slashes: CS:DM cuts
both out of the file as comments, inside strings too. A change counts from the next clip.

#### What CS:DM's source says

The recorder relies on these, read in [akiver/cs-demo-manager](https://github.com/akiver/cs-demo-manager) at tag
`v3.20.1` (and on its `master` of 2026-10-04, which is still unreleased):

- `csdm video --config-file <file>` reads every option from the file (`VideoCommandConfig` in
  `src/cli/commands/video-command.ts`) and the rest from CS:DM's `settings.json`; flags are not read with a file. Exit
  code 0 when the video is made, 1 after printing the reason (`Steam is not running`, `HLAE error`, `Game error`, ...).
- Sequences are recorded in the order of their start ticks and joined in the order of their numbers; the game restarts
  the demo from tick 0 for each, so they may overlap and come in any order.
- CS:DM keeps its files in `%USERPROFILE%\.csdm` (settings, HLAE, FFmpeg), installs itself for the user in
  `%LOCALAPPDATA%\Programs\cs-demo-manager` and puts that folder on the user's `PATH`.
- Version 3.20.1 needs a PostgreSQL server (its settings: `127.0.0.1:5432`, user `postgres`). The next version keeps its
  database itself and runs the work in a background process; the recorder works with both (the next one puts its files
  one folder deeper, which the recorder looks into).
- CS:DM's game plugin is built for the game's builds (`src/common/types/cs2-plugin-version.ts`), so after an update of
  CS2 CS:DM may need an update too. While the game runs the plugin writes `game\bin\win64\csdm.log` in the CS2 folder.

### What the machine needs

- **Windows 10 or 11, 64-bit**, and a graphics card that runs CS2 smoothly at the clips' size (a GTX 1060 or RX 580
  for 720p, more for 1080p at 60 fps), 16 GB of memory, and an SSD with 60 GB free: CS2 is about 35 GB, a demo about
  400 MB (`DEMO_CACHE_ITEMS` of them are kept), and CS:DM's database grows with every match it analyzes.
- **A wired network connection** to the site. The video of a clip is tens of megabytes, a demo a hundred or more.
- **A Steam account for recording only**, not one you play on: CS:DM ends any running CS2 at every clip, and the game
  runs with `-insecure` (no VAC servers) while it records.
- The machine does nothing else while it records, and is not used to play.

### Installing, in this order

1. **Steam and CS2.** Install Steam, sign in to the recording account with "Remember me", and in Steam's settings let
   it start with Windows. Install CS2 and **start it once by hand**: let it finish its first start (it prepares its
   shaders), set the graphics to what the clips should look like, and quit.
2. **PostgreSQL** (CS:DM 3.20.1 needs it): the Windows installer from <https://www.postgresql.org/download/windows/>,
   with the default port 5432. Note the password you give the user `postgres`.
3. **CS Demo Manager** from <https://cs-demo-manager.com>. At its first start give it the database (`127.0.0.1`, 5432,
   `postgres` and that password). In its settings, under About, turn off the automatic download of updates: an update in
   the middle of a recording would break it, so update it by hand (see [After an update of CS2](#after-an-update-of-cs2)).
4. **HLAE and FFmpeg** come with CS:DM's first video: do [the first trial](#the-first-trial) now, or make one video in
   the app (a match, Video, HLAE and FFmpeg).
5. **Node.js 22 LTS** (22.15 or newer) from <https://nodejs.org>, with the installer's defaults.
6. **The recorder.** Put the `recorder` folder of this repository on the machine, by `git clone` (Git for Windows) or
   as a copy, in a path without spaces or letters outside English, for example `C:\csfaceit\CsFaceIt\recorder`.
7. **The env file.** Copy `recorder\windows\recorder.env.example` to `C:\csfaceit\recorder.env` and fill it in (see
   below for `BACKEND_URL`; `CLIP_WORKER_TOKEN` is the value of the site's `.env`).
8. **Install and start** in PowerShell, which builds the recorder and has Task Scheduler start it at every sign-in:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\csfaceit\CsFaceIt\recorder\windows\install.ps1 `
     -EnvFile C:\csfaceit\recorder.env -StartNow
   ```

   The task runs `windows\run.cmd`, which writes the log to `recorder\logs\recorder-<date>.log` and starts the recorder
   again a minute after a crash; a recorder that cannot start (a wrong setting, exit code 2) is not started again. To see
   the log as it grows: `Get-Content -Wait C:\csfaceit\CsFaceIt\recorder\logs\recorder-<date>.log`. By hand, without the
   task: `windows\run.cmd C:\csfaceit\recorder.env` in the `recorder` folder, or
   `node --env-file=C:\csfaceit\recorder.env dist\main.js` to have the log in the window. Ctrl+C in its window gives the
   clip it holds back at once; ending the task in Task Scheduler kills it, and the site takes the clip back after
   `clip.stale-after` (3 minutes).

**How to know it works.** The log starts with `Recorder ... starts as 'windows-1' in mode csdm` and names the CS:DM it
found; no line says `refused the worker token` or `No clip taken`. On the site, the clips page shows the recorder online
(`GET /api/v1/recorder/status` answers `"online": true`). Order a clip of a highlight: the log shows the claim, the
demo, `CS Demo Manager: Recording in progress...`, the sequences, `ENCODING`, `UPLOADING` and `DONE`, and the clip
plays on its page from the player's eyes.

### The first trial

Before the recorder takes clips, try CS:DM by hand with a **fresh** FACEIT demo (from the last days: a demo of an older
build of the game may not play any more; the sample demo of the dev stack, `local.dem`, is of patch 14068, a build of
2025, older than the "Animgraph 2" update of April 2026 that CS:DM's plugin table names). In PowerShell:

```powershell
mkdir C:\csfaceit\trial
# put the demo there as C:\csfaceit\trial\demo.dem, then:
csdm analyze C:\csfaceit\trial\demo.dem        # "Inserting match into database ..."
csdm analyze C:\csfaceit\trial\demo.dem        # "... already in database, skipping this demo."
copy C:\csfaceit\CsFaceIt\recorder\csdm-config.template.jsonc C:\csfaceit\trial\trial.jsonc
notepad C:\csfaceit\trial\trial.jsonc          # the ticks and the player, see below
csdm video --config-file C:\csfaceit\trial\trial.jsonc
```

In `trial.jsonc` set `startTick` to about 3 seconds (192 ticks at 64 per second) before a kill and `endTick` to about
2 seconds after it, the camera's `tick` to `startTick`, and `playerSteamId` to the SteamID64 of the killer. The ticks of
a kill: a match's Video page in CS:DM builds sequences from the kills on its timeline, or, once the demo is on the site,
`tickStart` and `tickEnd` of a highlight in `GET /api/v1/matches/<matchId>/highlights` are exactly such a window. The
SteamID64: the player's page in CS:DM, or his Steam profile. The game opens, plays, records and closes, and
`C:\csfaceit\trial\sequence-1-tick-<a>-to-<b>.mp4` should show the kill from the player's eyes about 3 seconds in. Note
for plan 5: the build of CS2 (`PatchVersion` in `game\csgo\steam.inf`), the versions of CS:DM and HLAE, how long the
command took, whether it records with the window in the background or the screen locked, and whether `local.dem`
plays.

### `BACKEND_URL`: where the site is

**A Windows PC on the same network as the Mac that runs the stack.** The site is the Mac's address on that network and
the web port: `BACKEND_URL=http://192.168.1.20:3000` with the Mac's own address. Find it on the Mac in System Settings,
Wi-Fi (or Network, Ethernet), Details, "IP address", or in Terminal with `ipconfig getifaddr en0` (`en1` when the
first one prints nothing). Check from the Windows PC in PowerShell:

```powershell
curl.exe http://192.168.1.20:3000/api/v1/recorder/status
```

It must print JSON such as `{"online":false,...}`. If it waits and fails, the Mac does not let the connection in:
in System Settings, Network, Firewall, Options, allow incoming connections for Docker. The Mac must be awake while
clips are recorded (it serves the site), and its address may change when the router restarts: reserve it in the router
(a fixed DHCP address) or put the new one in the env file.

What the stack lets in: Compose publishes the web port on all the Mac's interfaces (`"${WEB_PORT:-3000}:80"` in
`docker-compose.yml`), Nginx answers any host name (`server_name _` in `frontend/nginx.conf`) and passes `/api/worker/`
on like the rest of `/api/`, and the backend asks a recorder for its `X-Worker-Token` and nothing else: no list of
addresses, and the CORS and `Origin` rules concern browsers and the session cookie, which a recorder does not send.
So the PC is let in as soon as the token matches. The stack's `CLIP_WORKER_TOKEN` must be set in the Mac's `.env` (a
long random value, `openssl rand -hex 32`; while it is empty every recorder is refused), and the backend recreated to
take it (`docker compose up -d backend`). Over plain HTTP the token crosses the home network unencrypted. Do not point
the Windows PC at the stack of `docker-compose.fake.yml`: it publishes the port on the Mac itself only, its token is
public, and its own `recorder-fake` would take the clips too.

**The site on a server.** `BACKEND_URL=https://<domain>` (way A of the deployment in the main README), or
`http://<address of the server>` without a domain (way B; the token then crosses the internet unencrypted). Set
`CLIP_WORKER_TOKEN` in the server's `.env` and put the same value in the env file.

### Keeping it recording

- **Sign-in.** The task starts the recorder when the user signs in, on his desktop, which the game needs. For the
  recorder to come back after a restart of Windows without anyone at the keyboard, turn on automatic sign-in for the
  recording user (Microsoft's Sysinternals Autologon). Until the first trial shows that the game records with the screen
  locked, do not let the screen lock either.
- **No sleep.** Settings, System, Power: screen and sleep "Never" when plugged in, or in PowerShell
  `powercfg /change standby-timeout-ac 0` and `powercfg /change hibernate-timeout-ac 0`.
- **No updates while recording.** Windows Update: set active hours to the hours the recorder works, or pause updates.
  Steam: let it update games only at night (Settings, Downloads). CS:DM: automatic updates off (above). Graphics
  driver: update by hand.
- Steam stays running and signed in: CS:DM checks it before every clip.

### After an update of CS2

An update of CS2 often stops the tools that drive it until they are updated too, and it can make older demos
unplayable. The clips that fail meanwhile say why ("HLAE could not start the game", "The game did not start playing the
demo") and go back to the queue; after `clip.max-attempts` they are `FAILED`, and "Retry" on the site orders them
again.

1. Let Steam update CS2, then start CS2 once by hand and quit it.
2. Update CS:DM (its download page) and HLAE (a match's Video page in CS:DM offers the update of HLAE when there is one).
3. Make one video in CS:DM, or repeat [the first trial](#the-first-trial).
4. Start the recorder again (`Start-ScheduledTask -TaskName 'CsFaceIt recorder'`) if you stopped it.

### When the game does not play the demo

While the game runs, the recorder reads the log of CS:DM's game plugin (`game\bin\win64\csdm.log` in the CS2 folder).
When the plugin has started but `Demo playback started` does not come within `CSDM_PLAYBACK_START_SECONDS`, the game,
HLAE and CS:DM are stopped, and the recorder decides whose fault it is:

- If, on the same build of the game, it has already recorded a demo of a later patch of the game, the game works and this
  demo is too old for it: the clip is `FAILED` at once with "This demo was recorded on a game version the recorder can no
  longer play". The patch of a demo is in its header; the build of the game in `game\csgo\steam.inf`; what the game has
  recorded is kept in `WORK_DIR\csdm-playable.json`.
- Otherwise nobody can tell the demo from the machine (a plugin of CS:DM that does not fit a new build of the game stops
  every demo the same way): "The game did not start playing the demo", tried again, and the recorder pauses as after any
  failure of its machine.

Without the CS2 folder (not found, and no `CS2_PATH`) the game is not watched, and a demo that does not play ends at the
time limit.

### When something goes wrong on Windows

The reason on the clip's page, and what to do. The ones marked "machine" pause the recorder for `ERROR_BACKOFF_SECONDS`
(see [After a failure](#after-a-failure)); all but the last two are tried again while the clip has attempts left.

| Reason | What it means, what to do |
| --- | --- |
| Steam is not running on the recorder | Machine. Start Steam and sign in; let it start with Windows. |
| The recorder cannot find CS2 | Machine. CS:DM did not find `cs2.exe`: install CS2, or give its place in CS:DM's settings. |
| HLAE could not start the game | Machine. Usually after an update of CS2: update HLAE in CS:DM. |
| The game closed with an error | Machine. The game crashed or was closed; see `game\bin\win64\csdm.log` and the recorder's log. |
| The game did not start playing the demo | Machine. See [When the game does not play the demo](#when-the-game-does-not-play-the-demo). |
| CS Demo Manager cannot reach its database | Machine. Start the PostgreSQL service; check the database settings in CS:DM. |
| CS Demo Manager could not be started | Machine. `CSDM_PATH` is wrong, or CS:DM is broken: reinstall it. |
| The recorder has no font to write the title with | Machine. Arial is missing from `C:\Windows\Fonts`. |
| The recording did not finish in time | The game hung, or the machine is slower than the limit: watch a clip in its window; raise `CSDM_TIMEOUT_FACTOR` or `CSDM_MIN_TIMEOUT_SECONDS`. |
| CS Demo Manager could not analyze the demo / could not record the clip / could not encode the recording / made no video of the clip | The recorder's log has CS:DM's own words in square brackets. |
| The demo file is damaged | Final. CS:DM's analysis says the demo ends too early. |
| This demo was recorded on a game version the recorder can no longer play | Final. See above. |

If CS:DM's database is emptied or replaced, delete the files `WORK_DIR\demos\*.csdm-analyzed`: CS:DM would otherwise be
asked for videos of matches it does not know, and the camera would not follow the player.

### What has not been tried

Nothing of this mode has run on Windows, with CS:DM, HLAE or CS2: not the start of CS:DM's command line, the analysis,
the recording and the camera on the player, whether the kill comes at the third second of a segment (Task 0, step 5),
how long a clip takes, recording in the background or with the screen locked, the Steam registry lookup, the reading
of `steam.inf` and of the plugin's log, the time limits, `taskkill`, `run.cmd`, `install.ps1` and the task, or Arial.
What was tried, on a Mac and in a Linux container: the settings and their messages; and the whole recorder against a
stand-in for CS:DM's command line that prints and names its files as the source of 3.20.1 does: the analysis and its
marker, the configuration it writes, the joining with streams copied, a montage (9:16, slow motion, intro, a title with
letters outside ASCII and quotes, the stand-in's files one folder deeper as in the next CS:DM), a sequence without
sound, the failures (Steam, the time limit, a stop, the demo that does not play, judged both ways) and the reading of a
real demo's header.

## What it writes where

Under `WORK_DIR`, and nowhere else:

- `demos/<matchId>-<demoVersion>.dem`: the demo cache. `demoVersion` is the version of the file that the backend names
  in the job, so a demo that was uploaded again is a new file. A download goes to a `.part` file first, is checked
  (the bytes received must equal both the `Content-Length` and the size the job names) and is moved into place, so a
  file that is there is a whole one. A `.part` that a killed run left is removed at the next start, and a file of no
  length, which is what a crash or a full disk can leave, is not a demo: it is removed and the demo is downloaded again.
- `jobs/<clipId>/`: the scratch directory of the clip being recorded (the MP4, the thumbnail; in `csdm` mode also
  CS:DM's configuration `csdm-video.json`, its output `csdm\`, and the font and the texts of a title). It is emptied after
  every clip, whatever became of it, and at start.
- `csdm` mode only: `demos/<name>.dem.csdm-analyzed`, the mark that CS:DM's database has the demo's match, and, while a
  clip is recorded, CS:DM's actions file `demos/<name>.dem.json`. Both go with their demo when the cache removes it.
  `csdm-playable.json` notes the build of the game and the newest demo it recorded (see
  [When the game does not play the demo](#when-the-game-does-not-play-the-demo)).

In the Compose service `WORK_DIR` is `/work`, a volume, so the demos survive a recreated container. On Windows
`windows\run.cmd` writes the log to `logs\recorder-<date>.log` in the recorder's folder, outside `WORK_DIR`.

A work directory belongs to one recorder. A start empties `jobs/` and removes the `.part` files of `demos/`, the
downloads that a killed run left behind, so two recorders on one directory would wipe the clip the other is recording
and the demo it is downloading: a second recorder on the same machine, or a throwaway one for a test, gets its own
`WORK_DIR` (and its own `WORKER_NAME`).

## When something goes wrong

The log has one line per event: the start with the settings (not the token), each claim, whether the demo came from
the cache or was downloaded, each stage, the upload, the end of the clip, and every failure with its reason.

| What happens | What the recorder does |
| --- | --- |
| `409` on any request about a clip, the report of progress that goes out every 3 seconds included: the backend does not hold it for this recorder any more (it was taken back, or deleted) | Stops at once: kills ffmpeg, cuts off the download or the upload that is on its way (the connection is reset, so that what is queued on the line is dropped: the other side would only throw it away), removes the scratch directory, sends nothing, and asks for the next clip. |
| `410` for the demo: the file is no longer stored | `fail` with `retryable = false`: "The demo file is no longer stored". |
| `413` for an upload: the file is larger than the backend takes | `fail` with `retryable = false`. |
| `401` or `403`: the token is wrong | One line on every try that says so, and goes on: it keeps asking every `POLL_SECONDS`, and works as soon as the token is put right. It does not exit. |
| No answer, or a `5xx` | The same request again after 1, 2, 4, 8 and 16 seconds. Then a `claim` waits for the next poll, and a request about a clip ends the clip with a best-effort `fail` with `retryable = true`. |
| ffmpeg fails, or the recording is not a video | `fail` with the reason, `retryable = true`; then the pause of [After a failure](#after-a-failure). |
| `csdm` mode: CS:DM, Steam, the game or HLAE fail, the time limit is reached, the game does not play the demo | See [When something goes wrong on Windows](#when-something-goes-wrong-on-windows). |
| `SIGINT` or `SIGTERM` | Stops asking for work, kills ffmpeg (in `csdm` mode CS:DM, the game and HLAE), gives the clip back with `fail` and `retryable = true` (the backend queues it again at once), and exits within a few seconds. A second signal exits at once. |
| The process is killed, or the machine goes to sleep | Nothing can be sent. The backend takes the clip back after `clip.stale-after` and counts the attempt. |

A clip whose attempts are used up (`clip.max-attempts`) ends as `FAILED` with the last reason, which the clip page shows.

### After a failure

A clip that goes back to the queue keeps its place at the head of it, so a recorder that asked again at once would take
the same clip again at once, and with a fault that does not go away it would use up the attempts of every clip in the
queue before anyone could look at it. After every clip that failed the recorder therefore takes no new clip for a pause:

- The first failure after a finished clip (or after the start) waits `POLL_SECONDS`, and each further failure in a row
  waits twice as long as the one before, up to `ERROR_BACKOFF_SECONDS`. With the defaults: 5, 10, 20, 40, 80, 160, 300,
  300, ... seconds.
- A finished clip puts the row back to the start. A clip whose claim was lost, and a stop, neither count as a failure nor
  reset the row.
- A failure of the machine itself (below) waits `ERROR_BACKOFF_SECONDS` at once, and counts as a failure in the row.
- The pause is never shorter than `POLL_SECONDS` (`ERROR_BACKOFF_SECONDS` may be 0): after a failure the recorder asks
  no sooner than an idle one does. A stop ends the pause at once.
- One log line says it: `Taking no new clip for 20 s: 3 failures in a row`, or, for the machine's own fault,
  `Taking no new clip for 300 s: the failure is of this machine, not the clip's`.

**What counts as the machine's own failure**, whichever step it happens in (the directory of the clip, its thumbnail,
the demo cache and its temporary files, ffmpeg and ffprobe), because the next clip would meet the same fault:

- a system error with the code `ENOSPC` (no room left), `EROFS` (a read-only file system), `EACCES` or `EPERM` (no
  permission) from the recorder's own file work;
- ffmpeg or ffprobe ending with an error whose output says `No space left on device`, `Permission denied` or `Read-only
  file system`;
- a tool that is not there, or that this machine does not let run.

The reason sent to the backend for such a failure is fixed ("The recorder could not write its files", "ffmpeg could not
be started") and holds no path; the system's message and the output of the tool are in the log. A recorder for another
mode gets the same rule from `src/machine.ts`.

**The reason of a failure is public.** The text the recorder sends with `fail` is kept on the clip, and `GET /api/v1/clips/{id}`
shows it to every visitor. It is therefore a short reason that anyone may read ("ffmpeg exited with code 1", "The demo
file is no longer stored", "The recorder could not reach the backend"), with nothing of this machine in it: no path, no
output of a tool, no stack, no address, no setting. What the operator needs is in the log of the recorder, in square
brackets after the reason: `Clip 7: failed while recording, another attempt may do better: ffmpeg exited with code 1
[Error opening output file ...]`. A recorder for another mode follows the same rule: `RecorderError` takes the reason as
its message and the rest as `detail`.
