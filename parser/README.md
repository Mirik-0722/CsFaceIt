# Demo parser worker

A Rust worker that turns a stored CS2 demo into raw facts. It consumes `demo.parse` from RabbitMQ, reads the demo from
the S3-compatible storage (MinIO), parses it and writes rounds, the players of every round, kills, damages and
position heat bins to PostgreSQL, then publishes `demo.parsed`. It shares nothing with the backend but those three
services, and it only reports what the demo says: highlights and statistics are computed elsewhere.

```
demo.parse {demoId, faceitMatchId, storageKey}
   -> download demos/<match>.dem.zst to a temporary file -> decompress (zstd) -> parse -> heat bins
   -> one transaction: players, rounds, round_players, kills, damages, heat_bins, matches.map_name,
      demos.status = PARSED
   -> demo.parsed {demoId, faceitMatchId} -> ack
```

## Configuration

Everything comes from the environment. The worker refuses to start, naming the variable, when a required one is
missing or malformed.

| Variable | Meaning | In the compose stack |
| --- | --- | --- |
| `AMQP_URL` | RabbitMQ URL. | `amqp://guest:guest@rabbitmq:5672/%2f` |
| `DATABASE_URL` | PostgreSQL URL. | `postgres://csfaceit:csfaceit@postgres:5432/csfaceit` |
| `S3_ENDPOINT` | Address of the S3-compatible server; it is addressed path-style. | `http://minio:9000` |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Credentials of the storage. | the `MINIO_*` values |
| `S3_BUCKET` | Bucket the backend stores the demos in. | `csfaceit` |
| `S3_REGION` | Region to sign requests for; MinIO accepts any. | `us-east-1` |
| `PARSER_MAX_DEMO_BYTES` | Optional. The most a stored object may be and the most it may decompress to, in bytes. | `2147483648` (2 GiB, also the default) |

`RUST_LOG` (optional) sets the log filter, for example `RUST_LOG=csfaceit_parser=debug`; the default is
`warn,lapin::channel=off,csfaceit_parser=info`. The worker logs one INFO line per message with the demo id, the outcome, the duration and
the counts, and never logs a credential or a whole connection URL.

Compose builds `AMQP_URL` and `DATABASE_URL` from `RABBITMQ_USER`/`RABBITMQ_PASSWORD` and `DB_USER`/`DB_PASSWORD`. A
password containing a character that is special in a URL (`@ : / ? # %`) must be percent-encoded there.

## What the worker guarantees

- **It declares nothing on the broker.** The backend declares the exchange and the queues when it first connects. The
  worker checks for `demo.parse` every few seconds until it exists and takes one message at a time. The backend
  applies its Flyway migrations (`V3__analysis.sql` adds the table `round_players` and the column
  `rounds.decided_tick`) before it connects to the broker, so on a new stack the worker, which waits for the queue,
  never writes to a database without them; when you upgrade a stack whose broker still holds the queue, bring the
  backend up first. Whenever the broker cannot be reached, the connection is lost, or its work fails (a `demo.parsed`
  that is not confirmed, say), it connects again after a pause. The pause starts at one second and doubles up to 30
  seconds from one failure to the next; it starts over once a message has been settled.
- **A message is acted on only while its demo is `STORED`.** Deliveries repeat and a demo can be announced again at
  any time (a redelivery, another upload). The worker reads the demo's status first and acknowledges the message
  without doing anything unless it is `STORED`. When it writes, it locks the `demos` row and writes only if the demo
  is still `STORED` and has not been touched since the work began (`updated_at` is the version); a demo that was
  stored again meanwhile is left to the message of that upload.
- **A new parse replaces the old one.** All writes for a demo are one transaction: the players are resolved, the
  match's `heat_bins`, `damages`, `kills`, `round_players` and `rounds` are deleted and inserted again,
  `matches.map_name` is filled when it is empty, and the demo becomes `PARSED` with its `tick_rate`. Nothing is
  deleted before the new demo has been parsed, so a demo that fails leaves the facts of an earlier parse of the
  match as they are.
- **`demo.parsed` is not lost.** It is published as persistent JSON with publisher confirms before `demo.parse` is
  acknowledged. If the worker dies in between, the redelivered message finds the demo `PARSED` and the announcement
  is made again.
- **A bad demo fails alone.** Parsing runs on a blocking thread; a panic of the parser library is caught and fails
  that demo. The temporary files live in `csfaceit-parser/` under the system's temporary directory, are removed in
  every outcome, and whatever a killed worker left there is removed at the next start (so each worker needs a
  temporary directory of its own, which a container gives it).
- **`SIGTERM`** stops the consuming; the demo in progress is finished first. Compose gives the worker 60 seconds for
  that (`stop_grace_period`), which is ample: a demo takes a few seconds. A worker that is killed before it is done
  has not acknowledged its message, so the broker delivers it again.

### Failures

`demos.error` is shown to users, so it only ever holds one of these sentences; the technical detail is logged.

| `demos.error` | When |
| --- | --- |
| `Demo could not be parsed: the file is not a valid CS2 demo.` | The object is not a zstd stream, the content is not a CS2 demo, the parser gave up or panicked on it, or the demo holds no completed round (an aborted match, a recording of the warmup only, a recording cut off before its first round ended). |
| `Demo could not be parsed: the stored file is missing.` | The storage has no object under the key. |
| `Demo could not be parsed: the file is too large.` | The object, or what it decompresses to, exceeds `PARSER_MAX_DEMO_BYTES`. |
| `Demo could not be parsed: internal error.` | The storage refused the request (a 4xx answer other than a missing object, 408 or 429), or the database refused the facts. |

After marking the demo `FAILED` the worker rejects the message without requeue, which dead-letters it; the backend's
dead-letter listener leaves a demo that is already `FAILED` as it is. A message that cannot be read (not JSON, a
field missing), or that names a demo that does not exist, is rejected the same way.

Storage or the database being unreachable is not the demo's fault: it never marks a demo `FAILED` and never loses
its message. The worker tries again after 5, 10, 20 and 40 seconds and then puts the message back in the queue, from
where it returns at once for another round, so an outage of any length is waited out. (Rejecting the message instead
would lose it exactly when nobody can record that: while the database is away the backend's dead-letter listener
cannot mark the demo either, and the demo would stay `STORED` with nothing left to announce it.) Only failures to
reach a service are treated this way (for the storage that includes its 5xx, 408 and 429 answers), because such a
message holds up the ones behind it for as long as it fails.

## The facts

- **Rounds.** A round is counted when it ends outside the warmup; a demo without a single counted round is not parsed
  but fails as not a valid demo. `round_number` is one more than the rounds the game had played when the round
  started, so it starts at 1 and continues through overtime; when a match is restarted (a knife round followed by the
  real match, a round rolled back by an admin) the rounds that are played again replace the earlier ones. `start_tick`
  is the tick the freeze time ended. `decided_tick` is the tick of the `round_end` event that closed the round (the
  first of them, when the demo reports the end of a round twice), so `start_tick <= decided_tick <= end_tick`.
  `end_tick` is the last tick before the next round starts, so the seconds after a round is decided, from
  `decided_tick` on, belong to it and the kills made then count, as they do on the scoreboard; the last round ends when
  the match does. `winner_side` is `CT` or `T`, `win_reason` a name such as `bomb_defused`, `t_killed` or
  `time_ran_out`. A bomb planted after the round was decided is not recorded.
- **Round players** (`round_players`). For every counted round, each player that has a sampled position in it (see
  Positions) and the side the player was on: `CT` or `T`, taken from the earliest sampled position of the player in
  that round, so it follows the swaps at halftime and in overtime. A round holds one row per player. Only the living
  are sampled, so a player who is not alive at the first sampled tick of a round (up to 31 ticks after it went live)
  is not listed. A demo whose positions cannot be read is still parsed, with a warning in the log, but has no round
  players (and no movement heat bins).
- **Kills, damages and positions** belong to the round whose tick range contains their tick; anything else (warmup,
  freeze time, after the match) is dropped. A side is the side at that tick, so it follows the swaps at halftime and
  in overtime.
- **Kills.** `killer` is absent when the world or the bomb killed the victim (weapon `world`, `planted_c4`, ...); a
  team kill or a kill of oneself with a weapon is kept as it is. `wallbang` means the bullet went through at least
  one surface.
- **Damages** carry the numbers of the game's `player_hurt` event unchanged, team and self damage included. Note that
  `damage_health` is the damage of the hit, not the health the victim lost: an AWP headshot is over 400. For damage
  per round as HLTV and FACEIT show it, cap each hit at the health the victim has left (100 at the start of the
  round, minus the earlier damage of that round).
- **Positions** of the living players are taken every 32 ticks. They are not stored as such: they give the round
  players, and they are stored as heat bins: squares of 64 world units, `bin = floor(coordinate / 64)`, counted per
  player, side and kind: `kill` (where the killer stood, for every kill that has a killer), `death` (where the victim
  stood) and `movement` (the sampled positions).
- **`tick_rate`** is the ticks played divided by the seconds played, from the file information the demo header
  points to; 64 when the demo has none.
- **Players** are found by `players.steam_id`. For a SteamID nobody has, a player `steam:<SteamID>` is created with
  the name from the demo.
- **Demos parsed before `V3__analysis.sql`** keep the facts they have: their rounds have no `decided_tick` and the
  match has no `round_players`, because the worker does not add facts to a stored parse. Upload the demo file again;
  the new parse replaces the old one.

## Building

### With Docker

`docker compose build parser` (or `up --build`). The image is a two-stage build with a non-root user.

### On the host

Needed: Rust 1.90 or newer, `git`, and the protobuf compiler `protoc` on the `PATH` (or its path in the `PROTOC`
variable), for example from `brew install protobuf` or `apt install protobuf-compiler libprotobuf-dev`.

```bash
./seed-protos.sh                                            # once per machine, see below
cargo build --release -p csgoproto && cargo build --release
cargo clippy -- -D warnings
```

Do not set `CARGO_TARGET_DIR`: the build of the demo parser dependency starts a second Cargo, which would wait
forever for the build directory of the first.

### The demo parser dependency

Demos are read with the `parser` crate of [LaihoE/demoparser](https://github.com/LaihoE/demoparser) (the Rust core of
demoparser2), a git dependency pinned to one commit in `Cargo.toml`. It is not written to be built as a dependency,
and two things follow:

- The build script of its protobuf crate compiles Valve's protobuf definitions on every build and, to get them,
  clones the head of [SteamDatabase/GameTracking-CS2](https://github.com/SteamDatabase/GameTracking-CS2) into its own
  source directory inside Cargo's checkout. A build therefore depends on what Valve shipped last, and those
  definitions do not always compile. `seed-protos.sh` puts the definitions there first, at the fixed commit named in
  the script, and the build script then leaves them alone. Run it before the first build and after changing the
  demoparser commit.
- Its build needs `protoc`, `git` and network access, and it must be built in two steps (`-p csgoproto` first)
  because the parser crate's build script regenerates sources of the protobuf crate through a second Cargo.

To move to a newer demoparser, change both `rev` values in `Cargo.toml`, run `cargo update -p parser -p csgoproto`
and `./seed-protos.sh`, build, and parse a real demo; move `GAMETRACKING_REV` in the script only if the new commit
needs newer definitions.

`Cargo.toml` names Rust 1.90 as the oldest supported toolchain, and `Cargo.lock` holds versions that build with it
(newer releases of the AWS SDK and of sqlx need Rust 1.94).

## Trying it with a real demo

The placeholder demo of the fake FACEIT stack is not a demo, so importing it ends in `FAILED`. To see a demo parsed,
serve a real one as described in [`dev/fake-faceit/README.md`](../dev/fake-faceit/README.md), or upload one:

```bash
curl -X POST -H 'X-API-Key: dev-admin-key' -F 'file=@match.dem' \
  http://localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/demo/upload
docker compose -f docker-compose.yml -f docker-compose.fake.yml logs -f parser
```
