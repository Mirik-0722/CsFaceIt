# CS2 FACEIT Analytics

A web app for looking up Counter-Strike 2 players on [FACEIT](https://www.faceit.com): search a player by nickname,
see the profile and the recent match history, and open a match to read the per-team stats tables (kills, deaths,
assists, headshots, K/D, K/R, ADR). Behind that sits a demo pipeline: the demo (`.dem`) of a match is downloaded or
uploaded, stored, and parsed by a Rust worker into rounds, the players of every round, kills, damages and position
heat bins, from which the backend computes the statistics of every player of the match.

```
Browser --> Nginx (frontend container) --/api/--> Spring Boot backend --> FACEIT Data API v4
                                                     |   |   |   |
                                          PostgreSQL  Redis  |   MinIO (demo files)
                                                (FACEIT cache)|        ^
                                                          RabbitMQ     |
                                                              |        |
                                                      Rust parser worker --> PostgreSQL (facts)

Prometheus --scrapes--> backend /actuator/prometheus, RabbitMQ :15692;  Grafana --reads--> Prometheus
```

- `backend/` - Spring Boot 3.5 (Java 21): REST API, FACEIT client with retries and timeouts, Redis cache, PostgreSQL
  persistence (Flyway migrations), the demo import worker, the analysis of parsed demos and the RabbitMQ listeners,
  Actuator and Prometheus metrics.
- `parser/` - the Rust worker that parses stored demos ([`parser/README.md`](parser/README.md)).
- `frontend/` - React + TypeScript single-page app built with Vite. In production Nginx serves it and proxies `/api/`
  to the backend. Its look follows the "A · REC" design: colours, type, components and screens are specified in
  [`docs/superpowers/specs/2026-10-11-web-ui-design.md`](docs/superpowers/specs/2026-10-11-web-ui-design.md), which
  also links the mockups. The interface is in Uzbek (the default) and English: the copy lives in `frontend/src/i18n`,
  and the choice made with the `UZ` / `EN` buttons is kept in the browser under the `csfaceit.lang` key.
- `docker-compose.yml` - PostgreSQL 17, Redis 8, RabbitMQ 4, MinIO, the backend, the parser and the frontend; with
  `--profile observability` also Prometheus and Grafana (`ops/` holds their configuration).
- `docker-compose.fake.yml` and `dev/fake-faceit/` - an override that replaces FACEIT with a local WireMock fake, for
  running the stack without an API key.

## Prerequisites

| Tool | Needed for |
| --- | --- |
| Docker with Compose v2 (2.24.4 or newer for the fake-FACEIT override, see below) | running the stack; also the backend tests (Testcontainers) |
| Java 21 | running and testing the backend outside Docker |
| Node 22 and npm | running and testing the frontend outside Docker |
| Rust 1.90 and `protoc` | building the parser on the host only; the Docker image needs neither (see [`parser/README.md`](parser/README.md)) |
| A FACEIT Data API key | every real lookup; create one in the [FACEIT Developer Portal](https://developers.faceit.com) |

## Configuration

All settings come from environment variables. Docker Compose reads them from a `.env` file next to
`docker-compose.yml`; the file is git-ignored, so secrets never reach the repository.

```bash
cp .env.example .env
```

Then edit `.env`:

| Variable | Meaning | Default in `.env.example` |
| --- | --- | --- |
| `FACEIT_API_KEY` | **Required.** Your FACEIT Data API key. The backend refuses to start when it is empty. | empty |
| `APP_API_KEY` | **Required.** Secret that clients send in the `X-API-Key` header. Everything except `GET`/`HEAD` on `/api/v1/**`, `/actuator/health` and `/actuator/prometheus` requires it. Choose a long random value, for example `openssl rand -hex 32`. While it is empty the backend logs a warning and rejects every protected request. | empty |
| `FACEIT_BASE_URL` | FACEIT Data API address; override it only to point the backend at a fake FACEIT. Commented out in `.env.example`. | `https://open.faceit.com/data/v4` |
| `FACEIT_HISTORY_LOOKBACK` | How far back a player's match history reaches (`faceit.history-lookback`). FACEIT itself returns only the last month unless the request names a start time, so the backend always sends one. Commented out in `.env.example`. | `365d` |
| `DB_URL` | JDBC URL of PostgreSQL. | `jdbc:postgresql://localhost:5432/csfaceit` |
| `DB_USER`, `DB_PASSWORD` | PostgreSQL credentials; the `postgres` service is created with them. | `csfaceit` / `csfaceit` |
| `REDIS_HOST`, `REDIS_PORT` | Redis address. | `localhost` / `6379` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the API. | `http://localhost:5173` (the Vite dev server) |
| `WEB_PORT` | Host port the web UI is published on when running with Docker Compose. | `3000` |
| `RABBITMQ_HOST`, `RABBITMQ_PORT` | RabbitMQ address (dev mode; Compose points the backend at the `rabbitmq` service). | `localhost` / `5672` |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD` | RabbitMQ credentials; the `rabbitmq` service is created with them. | `guest` / `guest` |
| `STORAGE_TYPE` | Where demo files are kept: `local` (files under `STORAGE_LOCAL_DIR`) or `minio`. Compose always runs the backend with `minio`. | `local` |
| `STORAGE_LOCAL_DIR` | Directory of the `local` storage, relative to the backend's working directory. | `./data/storage` |
| `MINIO_ENDPOINT` | Address of the S3-compatible server (dev mode; Compose points the backend at the `minio` service). | `http://localhost:9000` |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | MinIO credentials; the `minio` service is created with them, the backend and the parser log in with them. | `minioadmin` / `minioadmin` |
| `MINIO_BUCKET` | Bucket the demo files go to; the backend creates it when it is missing. | `csfaceit` |
| `MINIO_IMAGE` | MinIO server image of the Compose stack (see [Operational notes](#operational-notes)). Commented out in `.env.example`. | a digest-pinned `alpine/minio` build |
| `DEMO_UPLOAD_MAX_SIZE` | The most a manual demo upload may be, and the most a gzip upload may expand to: a size with a unit such as `1GB` or `512MB`. Nginx accepts 1 GB for the upload path (`frontend/nginx.conf`); raise both to allow more. | `1GB` |
| `DEMO_RETENTION_DAYS` | Stored demo files older than this many days are deleted once a day; the parsed facts and the demo's status stay. `0` keeps the files forever. | `30` |
| `DEMO_RETENTION_CRON` | When that clean-up runs: Spring's six cron fields (second minute hour day month weekday), server time. Normally left alone. Commented out in `.env.example`; keep the quotes there, the value has spaces and asterisks. | `0 0 4 * * *` |
| `PARSER_MAX_DEMO_BYTES` | The most a demo may be once the parser has decompressed it, in bytes. A larger demo is marked `FAILED` as too large. | `2147483648` (2 GiB) |
| `GRAFANA_ADMIN_PASSWORD` | Password of the Grafana user `admin`. Needed only with `--profile observability`; there is no default and the `grafana` service stops with a message while it is empty. | empty |

`DB_URL`, `REDIS_HOST`, `REDIS_PORT`, `RABBITMQ_HOST`, `RABBITMQ_PORT`, `STORAGE_TYPE`, `STORAGE_LOCAL_DIR`,
`MINIO_ENDPOINT` and `CORS_ALLOWED_ORIGINS` describe a backend running on your machine (dev mode). Inside Docker
Compose they are replaced for the backend container: it connects to the `postgres`, `redis`, `rabbitmq` and `minio`
services, stores demos in MinIO and allows the origin `http://localhost:${WEB_PORT}`. The parser's own settings
(`AMQP_URL`, `DATABASE_URL`, `S3_*`) are put together by Compose from the variables above; see
[`parser/README.md`](parser/README.md).

## Run with Docker Compose

```bash
docker compose up -d --build --wait
```

Open <http://localhost:3000> (or the port you set in `WEB_PORT`).

- Of the application services, only the web UI is published, on all interfaces of the machine (`docker-compose.fake.yml`
  narrows it to `127.0.0.1`, see [Local addresses](#local-addresses)). The infrastructure is published on `127.0.0.1`
  only, for development: PostgreSQL `5432`, Redis `6379`, RabbitMQ `5672` (AMQP) and `15672` (management UI), MinIO
  `9000` (S3 API) and `9001` (console). The backend is reachable through Nginx at `/api/` (for example
  <http://localhost:3000/api/v1/players?nickname=s1mple>); its Actuator endpoints are not exposed. The parser serves
  nothing and has no port.
- If the backend container exits right after starting, read `docker compose logs backend`. The usual cause is an
  empty `FACEIT_API_KEY`, reported as `Property: faceit.apiKey ... must not be blank`. If lookups answer 502 instead,
  the log line `FACEIT rejected the request (check FACEIT_API_KEY)` means FACEIT refused the key.
- Stop the stack with `docker compose down`; the database, the broker's data and the stored demo files live in the
  volumes `pgdata`, `rabbitmqdata` and `miniodata` and survive. Add `-v` to delete them as well.
- The `parser` image is built from the Rust sources on the first `up --build`, which takes several minutes.

## Running without a FACEIT key

A WireMock server can play FACEIT, so the whole stack starts with no API key and no `.env`:

```bash
docker compose -f docker-compose.yml -f docker-compose.fake.yml up -d --build --wait
```

Open <http://localhost:3000> and search for `s1mple`. The admin key for protected requests is `dev-admin-key`
(`X-API-Key` header); because it is public, this mode publishes the web port on `127.0.0.1` only. Stop it with
`docker compose -f docker-compose.yml -f docker-compose.fake.yml down`.
The fake ids, what it serves and how to serve a real demo file are described in
[`dev/fake-faceit/README.md`](dev/fake-faceit/README.md). The override needs Docker Compose 2.24.4 or newer, and the
stack has to be taken down with `down -v` before you switch between the real and the fake mode (see
[Operational notes](#operational-notes)).

## Run in dev mode

Run PostgreSQL and Redis in Docker and the backend and frontend on your machine. The backend starts without RabbitMQ
and MinIO (with `STORAGE_TYPE=local` it does not need MinIO at all); the demo endpoints need the broker to queue work.

```bash
# 1. Infrastructure (works without a .env as well)
docker compose up -d postgres redis
#    To try the demo pipeline as well, start the broker, the object store and the parser too, and set
#    STORAGE_TYPE=minio in your .env: the parser reads demos from MinIO only, so with the default STORAGE_TYPE=local
#    it finds no file and marks the demo FAILED ("the stored file is missing"); a demo stays STORED only while no
#    parser runs. (The first build of the parser image takes several minutes.)
#    docker compose up -d --build postgres redis rabbitmq minio parser

# 2. Backend on http://localhost:8080 (the shell must export the variables from .env)
set -a && source .env && set +a
cd backend && ./mvnw spring-boot:run

# 3. Frontend on http://localhost:5173 (second terminal); /api is proxied to localhost:8080
cd frontend && npm install && npm run dev
```

## Run the tests

```bash
# Backend: unit and integration tests. Needs a running Docker daemon: Testcontainers starts PostgreSQL 17
# and Redis 8, and a WireMock server stands in for FACEIT, so no API key is needed.
cd backend && ./mvnw test

# Frontend: unit and component tests (Vitest)
cd frontend && npm test -- --run

# Frontend: end-to-end search-to-match flow (Playwright, API mocked in the browser).
# Install the browser once; the Vite dev server is started by the test run itself.
cd frontend && npx playwright install chromium && npm run e2e

# Frontend: screenshots of every page into frontend/shots/, to compare the interface with the design spec:
# several data scenarios at 1440 and 390 px in Uzbek, the default one in English as well.
cd frontend && SHOTS=1 npx playwright test e2e/shots.spec.ts
```

## API

Base URL: <http://localhost:3000> with Docker Compose, <http://localhost:8080> in dev mode. Everything returns JSON,
and errors have the shape `{"code": "...", "message": "..."}`. The player and match endpoints below are `GET` and open;
the four [demo endpoints](#demo-pipeline) are described in their own section, and the three that change something
(`POST`) need the `X-API-Key` header.

| Endpoint | Description |
| --- | --- |
| `GET /api/v1/players?nickname=` | Find a player by FACEIT nickname (2-32 letters, digits, `_` or `-`). |
| `GET /api/v1/players/{playerId}` | Player profile: nickname, avatar, country, ELO and level. |
| `GET /api/v1/players/{playerId}/history?offset=0&limit=20` | A page of the player's matches (`offset` 0-1000, `limit` 1-100). |
| `GET /api/v1/matches/{matchId}` | Match details: map, status, times, teams and winner. |
| `GET /api/v1/matches/{matchId}/stats` | Per-team, per-player stats of a match. |
| `GET /api/v1/matches/{matchId}/highlights?type=&playerId=` | The highlights the analysis found in the match's demo (see [Highlights and statistics](#highlights-and-statistics)). |
| `GET /api/v1/players/{playerId}/highlights?type=&offset=0&limit=50` | A page of the player's highlights over all his analyzed matches, the newest match first (`offset` 0-10000, `limit` 1-100). |
| `GET /api/v1/players/{playerId}/stats` | The player's statistics over the matches the backend has stored: K/D, HS%, ADR, KAST, entry and trade kills, clutch %, win rate. |

```bash
curl "http://localhost:3000/api/v1/players?nickname=s1mple"
curl "http://localhost:3000/api/v1/players/<playerId>"
curl "http://localhost:3000/api/v1/players/<playerId>/history?offset=0&limit=20"
curl "http://localhost:3000/api/v1/matches/<matchId>"
curl "http://localhost:3000/api/v1/matches/<matchId>/stats"
curl "http://localhost:3000/api/v1/matches/<matchId>/highlights?type=K3"
curl "http://localhost:3000/api/v1/players/<playerId>/highlights?offset=0&limit=10"
curl "http://localhost:3000/api/v1/players/<playerId>/stats"
```

Replace `<playerId>` and `<matchId>` with the ids returned by the previous calls.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | A nickname, id, highlight `type` or paging parameter is malformed; for the upload also a bad file name, an empty or corrupt file, or a multipart body that is malformed or was cut off. |
| 401 | `UNAUTHORIZED` | A protected request is missing a valid `X-API-Key` header. |
| 404 | `PLAYER_NOT_FOUND`, `MATCH_NOT_FOUND`, `DEMO_NOT_FOUND` | FACEIT does not know the player or match, or the match has no demo record yet. |
| 409 | `DEMO_URL_UNAVAILABLE`, `DEMO_NOT_PARSED` | A demo import was requested but FACEIT has no demo for the match (yet); or an analysis was requested but the demo is not `PARSED` or `ANALYZED`. |
| 413 | `PAYLOAD_TOO_LARGE` | An uploaded demo is larger than `DEMO_UPLOAD_MAX_SIZE` (also when a gzip file expands beyond it). |
| 502 | `FACEIT_UNAVAILABLE` | FACEIT failed or timed out after retries, or refused the request (for example a rejected `FACEIT_API_KEY`, which is not retried), and no cached copy exists. |

FACEIT responses are cached in Redis (player profile 5 minutes, match history 2 minutes, finished match 24 hours),
and an expired copy is served when FACEIT is down.

Operational endpoints (`/actuator/health`, `/actuator/prometheus`) are served by the backend on port 8080 and are
only reachable directly in dev mode, not through Nginx. In the Compose stack Prometheus reads them over the internal
network (see [Metrics and dashboards](#metrics-and-dashboards)).

## Demo pipeline

The demo (`.dem`) of a match goes through a chain of workers connected by RabbitMQ; the files live in MinIO and the
facts in PostgreSQL.

```
POST .../demo/import  (or .../demo/upload with a file)
  -> demos row QUEUED -> demo.import
  -> backend import worker: download from FACEIT, compress to zstd, store in MinIO  -> STORED -> demo.parse
  -> Rust parser: read from MinIO, parse, write rounds / round_players / kills / damages / heat_bins
     -> PARSED -> demo.parsed
  -> backend listener: analyze the facts into the statistics of every player -> ANALYZED  (see "Analysis")
```

The status of a demo is one of:

| Status | Meaning |
| --- | --- |
| `QUEUED` | The import is requested and waits for (or is in) the download. |
| `STORED` | The file is in storage (always as `demos/<matchId>.dem.zst`) and waits for the parser. |
| `PARSED` | The parser has written the facts of the demo to the database; the analysis is next. It is also the status of a demo whose analysis failed, then `error` says so (see [Analysis](#analysis)). |
| `ANALYZED` | The facts have been analyzed and the statistics of the players are stored. |
| `FAILED` | Something went wrong; `error` says what, in one sentence. Importing or uploading again starts over. |

The allowed moves are `QUEUED` -> `STORED` -> `PARSED` -> `ANALYZED`, any status -> `FAILED`, `FAILED` -> `QUEUED`
(import again), and, for a manual upload, any status -> `STORED` (a `PARSED` or `ANALYZED` demo is then parsed again).
An analysis that fails is not a move: the demo stays `PARSED` or `ANALYZED` (see [Analysis](#analysis)).
A message that arrives late or twice never undoes progress: delivery is at least once, so every worker checks the
status first. A message that fails in a backend listener (`demo.import`, `demo.parsed`) is tried three times, one
second apart and then two, and then sent to the dead-letter queue `demo.dlq`.
The parser does not retry a demo it cannot parse: it records `FAILED` itself and rejects the `demo.parse` message on the
first failure, which dead-letters it too (a storage or database outage is waited out instead: the message goes back to
the queue and nothing is dead-lettered).
The backend marks a dead-lettered demo `FAILED` only if it is still in the status that queue's work starts from
(`QUEUED` for `demo.import`, `STORED` for `demo.parse`), so a stale or made-up dead letter never undoes progress; a
demo the parser has already marked `FAILED` is left as it is, and counted. A dead letter from `demo.parsed` is an
analysis that failed three times: it never marks the demo `FAILED`, because the parsed facts are intact (see
[Analysis](#analysis)).

### Endpoints

All four are under `/api/v1/matches/{matchId}`, where `matchId` is the FACEIT match id (letters, digits and `-`, at
most 64 characters). The three `POST` endpoints need the admin key in the `X-API-Key` header (`APP_API_KEY`; in the
[fake-FACEIT mode](#running-without-a-faceit-key) it is `dev-admin-key`). The examples use the Compose address and the
fake main match.

Request the import of the demo FACEIT has for the match. The answer is `202` with the demo as it is now; repeating the
request is safe and queues nothing new while the demo is `QUEUED`, `STORED`, `PARSED` or `ANALYZED`:

```bash
curl -X POST -H 'X-API-Key: dev-admin-key' \
  http://localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/demo/import
# {"demoId":1,"matchId":"1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","status":"QUEUED","error":null,"updatedAt":"..."}
```

Read the status (open, no key needed; `404 DEMO_NOT_FOUND` before the first import or upload):

```bash
curl http://localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/demo
# {"demoId":1,"matchId":"...","status":"PARSED","error":null,"updatedAt":"..."}
```

Upload the demo yourself when FACEIT's cannot be downloaded (no demo URL, a `403`, a `404`). The multipart part is
named `file` and the file name must end in `.dem`, `.dem.gz` or `.dem.zst`; it is stored as zstd whatever it came as.
The demo becomes `STORED` at once, from any status, and is announced to the parser. Uploading for a `PARSED` demo
deliberately parses it again, and the rows of the earlier parse are replaced:

```bash
curl -X POST -H 'X-API-Key: dev-admin-key' -F 'file=@match.dem' \
  http://localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/demo/upload
```

Both the import and the upload need the FACEIT API (or its fake, or a cached answer of an earlier request): the match
and the SteamIDs of its roster are loaded before anything else, because the parser knows the players by SteamID only,
so an upload for a match FACEIT does not know is a `404 MATCH_NOT_FOUND`. The upload replaces only the download of the
demo file. Through Nginx an upload may be up to 1 GB (see `DEMO_UPLOAD_MAX_SIZE`).

Have a parsed demo analyzed again (see [Analysis](#analysis)). The answer is `202` with the demo as it is now, before the
analysis has run: it needs neither FACEIT nor the demo file, only the parsed facts, so it also works after the retention
job has removed the file. `404 DEMO_NOT_FOUND` when the match has no demo, `409 DEMO_NOT_PARSED` when the demo is not
`PARSED` or `ANALYZED`. Repeating the request is safe:

```bash
curl -X POST -H 'X-API-Key: dev-admin-key' \
  http://localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/demo/analyze
# {"demoId":1,"matchId":"...","status":"PARSED","error":null,"updatedAt":"..."}   (read GET .../demo for the result)
```

### Try it without a FACEIT key

With the [fake FACEIT](dev/fake-faceit/README.md) the main match's demo URL serves a 1 KiB placeholder that is not a real
demo, so its import ends in `FAILED` at the parser; the matches `1-ffffffff-0000-0000-0000-000000000403` and
`...000404` end in `FAILED` at the download. To see a demo parsed to the end, serve a real demo through the fake as
dev/fake-faceit/README.md describes, or upload one with the command above.

### The facts

The parser writes what the demo says and interprets none of it; [`parser/README.md`](parser/README.md#the-facts) has
the exact definitions. For each match it writes:

- `rounds`: one row per counted round, with the winner and the reason, `start_tick` (the round went live),
  `decided_tick` (the tick of the `round_end` that closed the round), `end_tick` (the last tick before the next round
  starts, so it also covers the seconds after the round was decided) and the bomb ticks.
- `round_players`: who played each counted round and on which side, `CT` or `T`. These are the players that have a
  sampled position in the round (every 32 ticks, living players only), with the side of the earliest one, so the side
  follows the swap at halftime.
- `kills`, `damages` and `heat_bins` (where the players stood, counted in squares of 64 map units).

`round_players` and `rounds.decided_tick` come with the migration `V3__analysis.sql`. The backend applies its
migrations before it connects to RabbitMQ and declares `demo.parse`, and the parser waits for that queue, so on a new
stack the parser never writes to a database that lacks them (when you upgrade a running stack, bring the backend up
first). A demo parsed before `V3` stays without them: upload the demo file again, and the new parse replaces the old
one.

### Analysis

When the parser announces a demo on `demo.parsed`, the backend analyzes it: it reads the facts of the match from the
database, computes the statistics of every player who played a round, writes them to `player_match_stats` (one row per
player and match), finds the highlights of the match and writes them to `highlights` (see "Highlights" below), and
moves the demo to `ANALYZED`. The analysis needs neither the demo file nor FACEIT, only the facts,
and it is idempotent: the same facts give the same rows, so it can be repeated at any time with
`POST .../demo/analyze` (see [Endpoints](#endpoints)) and a `demo.parsed` that arrives twice does no harm. A demo that
was uploaded or parsed again while it was being analyzed is not overwritten with the old result: the new upload
announces itself.

Who played a round, and on which side, is the roster of the round: its `round_players` rows, plus the players that the
kill events of the round name with their side and the roster does not list. Where the two disagree the roster wins. A
player who is not in the roster did not play the round, and a round counts for a player only if he is in it. (A demo
parsed before `V3` has no roster rows, so only the players its kill events name are found: upload the demo file again
before relying on its numbers.) Two players of one round on different sides are enemies; players on the same side are
teammates.

What is computed for each player of the match:

| Column of `player_match_stats` | Meaning |
| --- | --- |
| `kills`, `headshots` | Kills of an enemy, and the headshots among them. A kill counts only if the killer is a player other than the victim who played the round on the other side than the victim: a team kill, a kill of oneself and a death by the world or the bomb are not kills. |
| `deaths` | Every kill row the player is the victim of, whoever caused the death. |
| `assists` | The kill rows the player is named as the assister of, whose victim was his enemy. |
| `rounds_played` | The number of rounds the player is in the roster of. A row whose `rounds_played` is set was analyzed from the current facts of the demo. Without it the row holds FACEIT's numbers, or the numbers of an earlier analysis that did not mention the player (a new parse can have a different roster). |
| `adr` | The damage the player did to enemies per round played, with two decimals. Within a round every player starts with 100 health and the hits are taken in the order they happened. A hit takes no more than the health its victim had left, whoever dealt it (an AWP headshot of over 400 is 100 at most, and damage a teammate or the world did earlier is health the victim no longer has), and only what was taken from an enemy is the attacker's damage. |
| `won` | Whether the player's team won the match. The team that wins the last round of the demo has won the match, so this is the side of the player in the last round compared with the winner of that round; it stays empty for a player who is not in the roster of the last round and when the round has no known winner. It is written only into a row that has no result yet: FACEIT's own result, stored whenever `GET /api/v1/matches/{matchId}/stats` is called, is the official one and replaces it, but only when FACEIT names exactly one winning team (statistics without a "Team Win", or with several, leave `won` as it is). |
| `kast` | The share of the rounds the player played in which he had a kill, gave an assist, survived or had his death traded (K, A, S, T), in percent with two decimals, from 0 to 100. A round counts once however many of the four apply. A kill and an assist are those of `kills` and `assists` (an assist counts when the assister is an enemy of the victim, whoever killed him, even if the row is a team kill, a kill of oneself or a death by the world). *Survived* means that no kill row of the round has the player as its victim, whoever caused the death and whenever it happened. *Traded* means that a teammate killed the player's killer in time (see `trade_kills`). |
| `entry_kills` | The number of rounds in which the player made the first kill of an enemy, the first by `(tick, id)`. A round has at most one entry kill, and none when nobody killed an enemy in it: a team kill, a kill of oneself or a death by the world does not open a round. |
| `trade_kills` | The kills of an enemy that traded the death of a teammate: the victim had killed a teammate of the killer (never the killer himself) in the same round at most `analysis.trade-window-seconds` seconds, as ticks of the demo, before the kill or on its tick. A kill counts once however many teammates its victim had killed in that time, and each of those teammates has his death traded. |
| `clutch_attempts`, `clutch_wins` | The rounds in which the player was the last of his side alive against at least one living enemy (a clutch), and the ones of them his side won, also when he died after the clutch began. A player has at most one clutch in a round; the rules for when a clutch begins are below. |

**The round timeline.** Everybody in the roster of a round is alive when it starts. The deaths are the rows of `kills`,
whoever caused them (an enemy, a teammate, the player himself, the world or the bomb), in the order of `(tick, id)`; a
player is dead from his first death on, and the deaths of one tick happen together. A player who is not in the roster is
never alive. The round is decided at `rounds.decided_tick` (at `end_tick` for a round parsed without it). A death on that
very tick belongs to the round, since it is the kill that ends a round won by killing the last enemy, but a death after
it, such as a player killed in the seconds after the bomb has exploded, is not part of the fight: it creates no clutch.
It still is a death for `deaths` and for the S of KAST.

A clutch begins at the tick at which a side goes from several players alive to exactly one, while at least one enemy is
alive, if that tick is not after the tick the round was decided. There is none for a side that falls from several
players to none on one tick, for a side that was a single player from the start, when no enemy is left at that moment,
and when the player is left alone only after the round was decided. When both sides are down to one player each of them
has a clutch. The enemies of a clutch are the ones alive at its beginning, at most five. A round without a known winner
is won by nobody.

Each analysis first clears `rounds_played`, `kast` and the entry, trade and clutch counts of every row of the match and
then writes all of them for every player who played a round (a count of 0 is written as 0), so a row that has them was
analyzed from the current facts and a row this analysis did not write holds `NULL` there. Calling
`GET /api/v1/matches/{matchId}/stats` does not disturb an analyzed row: FACEIT's kills, deaths, assists, headshots and
ADR are written only into a row that was not analyzed from a demo, so every number of an analyzed row comes from the
same facts. The demo's players are not necessarily FACEIT's: a SteamID that no roster knows is stored as a placeholder
player `steam:<SteamID>`, so a match can have both analyzed rows (placeholders) and FACEIT rows.

**Highlights.** The same analysis finds the moments of the match that are worth a clip and stores them in
`highlights`: one row per highlight, with the player it belongs to (`player_id`), its type, the round, and the first and
last tick of the clip (`tick_start`, `tick_end`). Only the kills of an enemy take part in a highlight (see `kills`
above): a team kill, a kill of oneself and a death by the world or the bomb never do.

| Type | Rule | The event lasts |
| --- | --- | --- |
| `ACE` | Five or more kills of an enemy by one player in a round. | From the first of those kills to the last. |
| `K4`, `K3` | Exactly four, or exactly three, kills of an enemy by one player in a round. A player has only the highest type of a round, so an ace is no `K4` as well. | From the first of those kills to the last. |
| `CLUTCH_1V1` to `CLUTCH_1V5` | A clutch (see above) that the player's side won; the number is how many enemies were alive when he was left alone, at most five. A clutch that was lost is no highlight, it only counts in `clutch_attempts`. | From the tick he was left alone to the tick the round was decided. |
| `NO_SCOPE` | A kill of an enemy that the parser flagged `noscope`, with an `awp`, `ssg08`, `g3sg1` or `scar20`. | The tick of the kill. |
| `KNIFE_KILL` | A kill of an enemy with a weapon whose name starts with `knife` or is `bayonet`. | The tick of the kill. |
| `WALLBANG` | A kill of an enemy that the parser flagged `wallbang`. | The tick of the kill. |
| `SMOKE_KILL` | A kill of an enemy that the parser flagged `thrusmoke`. | The tick of the kill. |
| `NINJA_DEFUSE` | The bomb was defused by a player of the round's roster while at least one player of the other side was alive at that tick (one who dies on that very tick is not). The highlight belongs to the defuser. | From `analysis.ninja.defuse-seconds` before the defuse to the tick of the defuse. |

One kill can be several highlights (a wallbang through smoke is a `WALLBANG` and a `SMOKE_KILL`), and the kills of a
multi-kill can be special kills as well. Weapon names are compared without regard to case.

**What `NINJA_DEFUSE` does not check.** A ninja defuse in the game's sense is a defuse that is finished while the
enemies are away from the bomb. The parser stores no position per tick, so this rule only knows that an enemy was alive
when the bomb was defused, not whether he was near it when the defuse began. A defuse that is finished with an enemy
right beside the bomb is a `NINJA_DEFUSE` here too, so expect more of them than the game would call by the name. A
stricter rule needs positions in the facts and a new parse of the demo.

The clip starts `analysis.clip.pre-seconds` before the first tick of the event and ends `analysis.clip.post-seconds`
after its last, as ticks of the demo (64 per second when the demo does not say), but never outside the round:
`tick_start = max(round start, first tick - pre x tick rate)` and `tick_end = min(round end, last tick + post x tick
rate)`, where the round's start and end are its `start_tick` and `end_tick` (an event that lies wholly outside its round,
which the parser's facts do not produce, is not stored). Every analysis replaces the highlights of
the match as a whole, in the same transaction that stores the statistics: the earlier rows are deleted and the new ones
inserted, so repeating an analysis leaves no duplicates, and an analysis that fails leaves the earlier highlights as they
were. The API lists the highlights of a match only while its demo is `ANALYZED` (see
[Highlights and statistics](#highlights-and-statistics)).

The thresholds of the analysis are the `analysis` block of `backend/src/main/resources/application.yml`. They are
validated when the backend starts (all must be positive) and are meant to be changed there, not in `.env`; Spring's
relaxed binding does accept environment variables such as `ANALYSIS_TRADE_WINDOW_SECONDS` on the backend container.

| Setting | Default | Meaning |
| --- | --- | --- |
| `analysis.clip.pre-seconds` | 3 | How many seconds a highlight clip starts before the first tick of its highlight. |
| `analysis.clip.post-seconds` | 2 | How many seconds it ends after the last tick. |
| `analysis.trade-window-seconds` | 5 | How soon after a teammate's death the killer has to be killed for that kill to be a trade. |
| `analysis.ninja.defuse-seconds` | 10 | How long a defuse takes in the rules of the ninja defuse highlight. |

All four are read: `analysis.trade-window-seconds` by `trade_kills` and the T of KAST, `analysis.clip.pre-seconds` and
`analysis.clip.post-seconds` by the clip of every highlight, and `analysis.ninja.defuse-seconds` by `NINJA_DEFUSE`.
Seconds become ticks with the tick rate of the demo (64 when the demo does not say).

**When the analysis fails.** The backend tries the `demo.parsed` message three times (an exception in the analysis
itself, say, from facts it cannot handle; every failed attempt is logged at `ERROR` with the exception and its stack
trace) and then gives up. The demo is not marked `FAILED`, because the facts the parser wrote are intact and a re-upload
would be wasted work (and impossible once the retention job has removed the file). A `PARSED` demo stays `PARSED` and its
`error` becomes `Analyzing the demo failed after 3 attempts. The parsed data is kept; start the analysis again.`. Start
the analysis again with `POST .../demo/analyze`: a successful analysis moves the demo to `ANALYZED` and clears the error,
and uploading the file again clears it too. An `ANALYZED` demo whose repeated analysis fails is not changed at all: it
keeps the statistics and the highlights of the earlier analysis, and the failure shows only in the backend log. In both
cases `demo_pipeline_failed_total{stage="analyze"}` counts the failed analysis.

The one failure that leaves nothing on the demo is the database being unavailable for so long that the error cannot be
noted either: the dead letter is tried three times, then dropped with an `ERROR` line ("Dropping a dead-lettered
message ..."), the demo stays as it was, with no `error`, and `demo_pipeline_failed_total` does not count it. Start the
analysis again with `POST .../demo/analyze` once the database is back.

### Highlights and statistics

Three `GET` endpoints serve what the analysis stored. They are open (no key) and read the database only (nothing is
asked of FACEIT). An id the database does not know is not an error: the lists are empty and the statistics say
`matches: 0`. The examples use the Compose address; `<playerId>` is a FACEIT player id.

| Endpoint | Answer |
| --- | --- |
| `GET /api/v1/matches/{matchId}/highlights?type=&playerId=` | An array of the highlights of the match, by round and, within a round, by the first tick of the clip. `type` (one of the highlight types above) and `playerId` narrow the list; both are optional. |
| `GET /api/v1/players/{playerId}/highlights?type=&offset=0&limit=50` | `{"items": [...], "offset": 0, "limit": 50}`: a page of the highlights of the player over all his matches, the newest match first (a match with no start time last), then by round and clip. `type` as above, `offset` 0-10000, `limit` 1-100. |
| `GET /api/v1/players/{playerId}/stats` | The statistics of the player over the matches the backend has stored. |

```bash
curl "http://localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/highlights"
curl "http://localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/highlights?type=K3&playerId=<playerId>"
curl "http://localhost:3000/api/v1/players/<playerId>/highlights?type=ACE&offset=0&limit=10"
curl "http://localhost:3000/api/v1/players/<playerId>/stats"
```

**The list is empty until the demo is analyzed (again).** The highlights of a match are served only while its demo is
`ANALYZED`. An analysis is the only thing that replaces them, so after the demo was uploaded again (it is `STORED`, then
`PARSED`, then `ANALYZED`) or was parsed again and ended `FAILED`, the set of the earlier analysis is still in the
table, but it was found in a file that is no longer the stored one, and a clip is cut from the stored file by these
ticks. Until a new analysis has run, a match whose demo is in any other status, or that has no demo at all, gives `[]` on
the match endpoint and adds nothing to the page of a player. The statistics endpoint is not affected.

A `type` that is not one of the highlight types, an `offset` or `limit` out of range and a `playerId` that is not made of
letters, digits and `-` are a `400 VALIDATION_ERROR`. A player known only from a demo has the id `steam:<SteamID>`, whose
colon that rule does not allow: such a player cannot be asked for by id, and his highlights can only be read from the
highlights of the match (where `playerId` is the `steam:` id).

A highlight, here a `K3` (the player's id is shortened):

```json
{"id": 3, "type": "K3", "playerId": "...", "nickname": "garnet", "roundNumber": 5, "side": "CT",
 "tickStart": 33246, "tickEnd": 35467, "roundStartTick": 32605, "roundEndTick": 38673, "durationSeconds": 35,
 "kills": [{"tick": 33438, "weapon": "awp", "headshot": false, "victimNickname": "ashen"}, "..."],
 "matchId": "1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "mapName": "de_mirage", "startedAt": "2023-11-14T22:13:20Z"}
```

| Field | Meaning |
| --- | --- |
| `id` | The id of the highlight. It changes whenever the match is analyzed again, so do not keep it. |
| `type` | One of the types in the table above. |
| `playerId`, `nickname` | The player the highlight belongs to: his FACEIT id (`steam:<SteamID>` for a player known only from the demo) and nickname. |
| `roundNumber` | The round of the demo, counted from 1. |
| `side` | `"CT"` or `"T"`: the side the player played that round on, from his `round_players` row. `null` when there is no such row, as for a demo parsed before the roster of a round was recorded. |
| `tickStart`, `tickEnd` | The clip, in ticks of the demo; both lie inside the round. |
| `roundStartTick`, `roundEndTick` | The `start_tick` and `end_tick` of the round. |
| `durationSeconds` | The length of the clip, `tickEnd - tickStart` over the tick rate of the demo (64 when it does not say), rounded to the nearest whole second. |
| `kills` | The kills of an enemy the player made from `tickStart` to `tickEnd`, both included, in the order they happened (a team kill, a kill of oneself and a death by the world are not kills, as in the rest of the analysis). `weapon` is the weapon as the demo names it. The array is empty when the clip holds no such kill. Reading a page costs one more statement for the kills of all its highlights, not one for each. |
| `matchId`, `mapName`, `startedAt` | The FACEIT match id, and the map and start time of the match, `null` while the match has none. |

The statistics, here of a player with one analyzed match:

```json
{"playerId": "...", "matches": 1, "analyzedMatches": 1, "winRate": 100.0, "kd": 1.71, "hsPercent": 65.5, "adr": 117.4,
 "kast": 83.3, "entryKillsPerMatch": 4.0, "tradeKillsPerMatch": 4.0, "clutchPercent": 0.0, "clutchAttempts": 2,
 "clutchWins": 0}
```

| Field | Meaning |
| --- | --- |
| `matches`, `analyzedMatches` | The matches the player has a row of statistics for, and how many of those were analyzed from a demo (`rounds_played` is set). The others hold FACEIT's own numbers only. |
| `winRate` | The percent of the matches with a known result (`won`) that the player's team won. |
| `kd` | All kills over all deaths (over 1 for a player who never died), with two decimals. |
| `hsPercent` | The percent of all kills that were headshots, 0 without a kill. |
| `adr` | The mean of the ADR of the matches that have one, with one decimal; a match counts once whatever its length. |
| `kast` | The percent of the rounds played in the analyzed matches in which the player had a kill, an assist, survived or was traded: the KAST of each match weighted by the rounds he played in it. |
| `entryKillsPerMatch`, `tradeKillsPerMatch` | The entry kills, and the trade kills, per analyzed match, with two decimals. |
| `clutchPercent` | The percent of the player's clutches that his side won. Every situation in which he is the last of his side alive against an enemy is a clutch, so a few percent is normal. |
| `clutchAttempts`, `clutchWins` | The clutches he played, and the ones his side won. |

`kd`, `hsPercent` and `adr` use every row, FACEIT's numbers included; the other figures come from analyzed matches only.
A percentage is 0 to 100 with one decimal. A figure with no data behind it is `null`, never 0: `winRate` while no result
of the player is known, `adr` without a stored ADR, `kast` and the two per-match figures without an analyzed match and
`clutchPercent` without a clutch. A player the database does not know has `matches: 0` and all of these `null`.

### Retention

A job removes the stored demo files that are older than `DEMO_RETENTION_DAYS` (default 30) once a day at 04:00 server
time. It deletes the file and clears `demos.storage_key`; the status and the parsed facts (`rounds`, `round_players`,
`kills`, `damages`, `heat_bins`) stay. It does nothing when the variable is `0`. A demo whose file is gone can be
brought back by uploading it again.

## Metrics and dashboards

The backend exports Micrometer metrics at `/actuator/prometheus`, among them the demo pipeline's:

| Metric (Prometheus name) | Meaning |
| --- | --- |
| `demo_pipeline_stage_duration_seconds_count`, `_sum`, `_max` (`stage="import"`) | How long an import took, from taking over the message to the announcement on `demo.parse`, failed imports included. |
| `demo_pipeline_stage_duration_seconds_count`, `_sum`, `_max` (`stage="analyze"`) | How long one handling of a `demo.parsed` message took, the analysis of the demo from reading its facts to storing the statistics; an attempt that failed and a message that found nothing to analyze are included. |
| `demo_pipeline_failed_total` (`stage` = `import`, `parse` or `analyze`) | Failures, each counted once, in the stage it failed in. `import`: a rejected download, a dead letter from `demo.import`, and a demo whose `demo.import` or `demo.parse` message could not be published because the broker was unavailable. `parse`: the parser's own failures (it records `FAILED` and rejects the message; the backend counts the rejection when it reads the dead letter) and a dead letter from `demo.parse` for a demo that was still `STORED`. These demos went to `FAILED`. `analyze`: an analysis that failed three times (a dead letter from `demo.parsed`) for a demo that is `PARSED` or `ANALYZED`; the demo does not go to `FAILED` (see [Analysis](#analysis)). A demo set to `FAILED` by hand in the database is not counted. |
| `demo_pipeline_parsed_total` | `demo.parsed` messages handled by the backend, each time the listener handles one: a message whose analysis fails is tried three times and counts three times. It also counts messages for a demo that is not there or is no longer `PARSED`, which the analysis skips. |

The meters live in the backend's memory and start from 0 after a restart; `rate()` and `increase()` in Prometheus
allow for that.

The length of the queues and the consumers come from RabbitMQ's own Prometheus endpoint (port `15692`, the
`rabbitmq_prometheus` plugin the `rabbitmq:4-management` image enables). Prometheus reads its `/metrics/per-object`
variant, which has a series for every queue, for example `rabbitmq_queue_messages_ready{queue="demo.parse"}` (demos
waiting for the parser); the plain `/metrics` adds the queues up. The dead-letter queue `demo.dlq` is not a signal of
failed demos: the backend's dead-letter listener empties it at once, so
`rabbitmq_queue_messages_ready{queue="demo.dlq"}` reads 0 whenever the backend runs (it grows only while no backend
is there to drain it). Watch `demo_pipeline_failed_total` for failed demos.

Prometheus and Grafana are in the Compose profile `observability`, so a plain `docker compose up` does not start them.
Set `GRAFANA_ADMIN_PASSWORD` (in `.env` or the environment) and add the profile:

```bash
GRAFANA_ADMIN_PASSWORD=choose-one docker compose --profile observability up -d --wait
# with the fake FACEIT: docker compose -f docker-compose.yml -f docker-compose.fake.yml --profile observability up -d --wait
```

Without the password the `grafana` service stops at once with the message `GRAFANA_ADMIN_PASSWORD is not set`
(`docker compose logs grafana`) instead of starting with a default password. Stop it with
`docker compose --profile observability down` (a `down` without the profile leaves these two containers running).
Grafana has the Prometheus data source from its first start; no dashboards are provisioned yet.

Grafana keeps the admin password of its first start in the `grafanadata` volume, so changing `GRAFANA_ADMIN_PASSWORD`
later does not change the password of an existing Grafana. Set a new one with
`docker compose --profile observability exec grafana grafana cli admin reset-admin-password <new>`, or remove the
volume (`docker compose --profile observability down`, then `docker volume rm <project>_grafanadata`, where `<project>`
is the name Compose gives the stack, `csfaceit` by default) and start again; whatever you built in Grafana goes with it.
Prometheus keeps its data (15 days) in the `prometheusdata` volume.

### Local addresses

The infrastructure and the observability tools are published on `127.0.0.1` only: they are reachable from this machine
and not from the network. The web UI follows `WEB_PORT` and the files you start with: `docker-compose.yml` publishes it
on all interfaces (`"${WEB_PORT:-3000}:80"`), and `docker-compose.fake.yml`, whose admin key is public, narrows it to
`127.0.0.1`.

| What | Address | Published on | Login |
| --- | --- | --- | --- |
| Web UI and API | <http://localhost:3000> | all interfaces (default stack), `127.0.0.1` (fake mode) | `X-API-Key` for `POST` |
| RabbitMQ management | <http://localhost:15672> | `127.0.0.1` | `RABBITMQ_USER` / `RABBITMQ_PASSWORD` (`guest` / `guest`) |
| MinIO console (S3 API on `9000`) | <http://localhost:9001> | `127.0.0.1` | `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` (`minioadmin` / `minioadmin`) |
| Prometheus (profile `observability`) | <http://localhost:9090> | `127.0.0.1` | none; targets under Status -> Targets |
| Grafana (profile `observability`) | <http://localhost:3001> | `127.0.0.1` | `admin` / `GRAFANA_ADMIN_PASSWORD` |

## Operational notes

- **Docker Compose 2.24.4 or newer** is needed for `docker-compose.fake.yml`: it uses the `!override` tag to replace
  the frontend's port mapping instead of adding a second one.
- **RabbitMQ and MinIO credentials are applied only when their volumes are first created.** Changing `RABBITMQ_USER`,
  `RABBITMQ_PASSWORD`, `MINIO_ACCESS_KEY` or `MINIO_SECRET_KEY` later has no effect on the existing data and the
  backend can no longer log in; start over with `docker compose down -v` (this deletes the database, the queues and
  the stored demos too).
- **Run `down -v` before switching between real and fake mode.** The two modes configure the same services differently
  (the backend's FACEIT address and key, the published web port) and use the same volumes. `down` alone keeps them
  (`pgdata`, `rabbitmqdata`, `miniodata`), so the fake players, the fake matches and the demo files and facts imported
  through the fake would still be there in real mode. `docker compose down -v` removes them, and everything else they
  hold; then `up` with the other set of files.
- **The MinIO image.** `minio/minio` no longer exists on Docker Hub, which is why the default is `alpine/minio`, a
  community build of the MinIO server, pinned by tag and digest in `docker-compose.yml`. To run another build set
  `MINIO_IMAGE` (for example in `.env`) to a full image reference; the command, the ports and the volume stay as
  they are.
- **A `QUEUED` demo whose message was lost** (the process died between the database commit and the publish, the queue
  was purged, or the database was away for a few seconds while the import worker and then the dead-letter listener
  gave up on the message, which leaves the demo neither `FAILED` nor counted) can be queued again: repeat the import
  request after 10 minutes. Within 10 minutes the request only reports the demo, because a download in progress also
  looks like that.
- **A `STORED` demo that the parser never took** (its status stays `STORED` for much longer than a parse takes, and
  `docker compose logs parser` has no line with its demo id, because its `demo.parse` message was lost) is announced
  to the parser again when you repeat the import request once it has been untouched for 10 minutes; the answer is `202`
  with the status `STORED`. Within 10 minutes the request only reports the demo, because a demo that waits behind
  others looks the same. A demo whose file the retention job has removed is not announced; upload it again.
- **Building the parser on the host needs `protoc`** (the protobuf compiler) and a one-time `./seed-protos.sh`; see
  [`parser/README.md`](parser/README.md). The Docker build needs neither.
