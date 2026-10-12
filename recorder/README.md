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
  queue to the player in the browser, can be built and tried on any machine, in Docker, without a game. This is the
  mode that exists today and the one this document is about.
- `csdm` is the recorder that drives CS2 on a Windows machine. It is not part of this version: the program ends at
  start with a message that says so.

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
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe` | The two tools, found on the `PATH` unless a path is given. |
| `ERROR_BACKOFF_SECONDS` | `300` | The longest pause after failed clips (see [After a failure](#after-a-failure)), and the pause after a failure of the machine itself, which is this long at once (0 to 86400; never less than `POLL_SECONDS`). |
| `FAKE_SPEED` | `1` | Fake mode only. Seconds of video made per second of wall time: `1` is real time, `2` twice as fast, `0` as fast as ffmpeg goes. A real recording takes its time, and so does this, so that a clip can be watched going from state to state and a recorder that is stopped "while it records" can be caught. |

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

## What it writes where

Under `WORK_DIR`, and nowhere else:

- `demos/<matchId>-<demoVersion>.dem`: the demo cache. `demoVersion` is the version of the file that the backend names
  in the job, so a demo that was uploaded again is a new file. A download goes to a `.part` file first, is checked
  (the bytes received must equal both the `Content-Length` and the size the job names) and is moved into place, so a
  file that is there is a whole one. A `.part` that a killed run left is removed at the next start, and a file of no
  length, which is what a crash or a full disk can leave, is not a demo: it is removed and the demo is downloaded again.
- `jobs/<clipId>/`: the scratch directory of the clip being recorded (the MP4, the thumbnail). It is emptied after
  every clip, whatever became of it, and at start.

In the Compose service `WORK_DIR` is `/work`, a volume, so the demos survive a recreated container.

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
| `SIGINT` or `SIGTERM` | Stops asking for work, kills ffmpeg, gives the clip back with `fail` and `retryable = true` (the backend queues it again at once), and exits within a few seconds. A second signal exits at once. |
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
