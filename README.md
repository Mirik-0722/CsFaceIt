# CS2 FACEIT Analytics

A web app for looking up Counter-Strike 2 players on [FACEIT](https://www.faceit.com): search a player by nickname,
see the profile and the recent match history, and open a match to read the per-team stats tables (kills, deaths,
assists, headshots, K/D, K/R, ADR). Behind that sits a demo pipeline: the demo (`.dem`) of a match is downloaded or
uploaded, stored, and parsed by a Rust worker into rounds, kills, damages and position heat bins, which later
sub-projects turn into highlights and statistics.

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
  persistence (Flyway migrations), the demo import worker and the RabbitMQ listeners, Actuator and Prometheus metrics.
- `parser/` - the Rust worker that parses stored demos ([`parser/README.md`](parser/README.md)).
- `frontend/` - React + TypeScript single-page app built with Vite. In production Nginx serves it and proxies `/api/`
  to the backend.
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
| `DEMO_RETENTION_CRON` | When that clean-up runs: Spring's six cron fields (second minute hour day month weekday), server time. Normally left alone. Commented out in `.env.example`. | `0 0 4 * * *` |
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

- Of the application services, only the web UI is published. The infrastructure is published on `127.0.0.1` only, for
  development: PostgreSQL `5432`, Redis `6379`, RabbitMQ `5672` (AMQP) and `15672` (management UI), MinIO `9000` (S3 API)
  and `9001` (console). The backend is reachable through Nginx at `/api/` (for example
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
(`X-API-Key` header). Stop it with `docker compose -f docker-compose.yml -f docker-compose.fake.yml down`.
The fake ids, what it serves and how to serve a real demo file are described in
[`dev/fake-faceit/README.md`](dev/fake-faceit/README.md). The override needs Docker Compose 2.24.4 or newer, and
`down` the stack before you switch between the real and the fake mode (see [Operational notes](#operational-notes)).

## Run in dev mode

Run PostgreSQL and Redis in Docker and the backend and frontend on your machine. The backend starts without RabbitMQ
and MinIO (with `STORAGE_TYPE=local` it does not need MinIO at all); the demo endpoints need the broker to queue work.

```bash
# 1. Infrastructure (works without a .env as well); add rabbitmq minio to try the demo pipeline too
docker compose up -d postgres redis

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
```

## API

Base URL: <http://localhost:3000> with Docker Compose, <http://localhost:8080> in dev mode. Everything returns JSON,
and errors have the shape `{"code": "...", "message": "..."}`. The player and match endpoints below are `GET` and open;
the three [demo endpoints](#demo-pipeline) are described in their own section, and the two that change something
(`POST`) need the `X-API-Key` header.

| Endpoint | Description |
| --- | --- |
| `GET /api/v1/players?nickname=` | Find a player by FACEIT nickname (2-32 letters, digits, `_` or `-`). |
| `GET /api/v1/players/{playerId}` | Player profile: nickname, avatar, country, ELO and level. |
| `GET /api/v1/players/{playerId}/history?offset=0&limit=20` | A page of the player's matches (`offset` 0-1000, `limit` 1-100). |
| `GET /api/v1/matches/{matchId}` | Match details: map, status, times, teams and winner. |
| `GET /api/v1/matches/{matchId}/stats` | Per-team, per-player stats of a match. |

```bash
curl "http://localhost:3000/api/v1/players?nickname=s1mple"
curl "http://localhost:3000/api/v1/players/<playerId>"
curl "http://localhost:3000/api/v1/players/<playerId>/history?offset=0&limit=20"
curl "http://localhost:3000/api/v1/matches/<matchId>"
curl "http://localhost:3000/api/v1/matches/<matchId>/stats"
```

Replace `<playerId>` and `<matchId>` with the ids returned by the previous calls.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | A nickname, id or paging parameter is malformed; for the upload also a bad file name, an empty or corrupt file, or a multipart body that is malformed or was cut off. |
| 401 | `UNAUTHORIZED` | A protected request is missing a valid `X-API-Key` header. |
| 404 | `PLAYER_NOT_FOUND`, `MATCH_NOT_FOUND`, `DEMO_NOT_FOUND` | FACEIT does not know the player or match, or the match has no demo record yet. |
| 409 | `DEMO_URL_UNAVAILABLE` | A demo import was requested but FACEIT has no demo for the match (yet). |
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
  -> Rust parser: read from MinIO, parse, write rounds / kills / damages / heat_bins -> PARSED -> demo.parsed
  -> backend listener: logs and counts the message (the analysis of a later sub-project moves PARSED to ANALYZED)
```

The status of a demo is one of:

| Status | Meaning |
| --- | --- |
| `QUEUED` | The import is requested and waits for (or is in) the download. |
| `STORED` | The file is in storage (always as `demos/<matchId>.dem.zst`) and waits for the parser. |
| `PARSED` | The parser has written the facts of the demo to the database. |
| `ANALYZED` | Reserved for the analysis of a later sub-project; nothing sets it yet. |
| `FAILED` | Something went wrong; `error` says what, in one sentence. Importing or uploading again starts over. |

The allowed moves are `QUEUED` -> `STORED` -> `PARSED` -> `ANALYZED`, any status -> `FAILED`, and `FAILED` -> `QUEUED`
(import again) or `STORED` (manual upload). A message that arrives late or twice never undoes progress: delivery is at
least once, so every worker checks the status first. A message that fails three times (one second apart, then two) is
sent to the dead-letter queue `demo.dlq`; the backend marks the demo `FAILED` only if it is still in the status that
queue's work starts from (`QUEUED` for `demo.import`, `STORED` for `demo.parse`, `PARSED` for `demo.parsed`).

### Endpoints

All three are under `/api/v1/matches/{matchId}`, where `matchId` is the FACEIT match id (letters, digits and `-`, at
most 64 characters). The two `POST` endpoints need the admin key in the `X-API-Key` header (`APP_API_KEY`; in the
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

Importing needs the FACEIT API (or its fake), because the match and the SteamIDs of its roster are loaded first; the
parser knows the players by SteamID only. Through Nginx an upload may be up to 1 GB (see `DEMO_UPLOAD_MAX_SIZE`).

### Try it without a FACEIT key

With the [fake FACEIT](dev/fake-faceit/README.md) the main match's demo URL serves a 1 KiB placeholder that is not a real
demo, so its import ends in `FAILED` at the parser; the matches `1-ffffffff-0000-0000-0000-000000000403` and
`...000404` end in `FAILED` at the download. To see a demo parsed to the end, serve a real demo through the fake as
dev/fake-faceit/README.md describes, or upload one with the command above.

### Retention

A job removes the stored demo files that are older than `DEMO_RETENTION_DAYS` (default 30) once a day at 04:00 server
time. It deletes the file and clears `demos.storage_key`; the status and the parsed facts (`rounds`, `kills`,
`damages`, `heat_bins`) stay. It does nothing when the variable is `0`. A demo whose file is gone can be brought back by
uploading it again.

## Metrics and dashboards

The backend exports Micrometer metrics at `/actuator/prometheus`, among them the demo pipeline's:

| Metric (Prometheus name) | Meaning |
| --- | --- |
| `demo_pipeline_stage_duration_seconds_count`, `_sum`, `_max` (`stage="import"`) | How long an import took, from taking over the message to the announcement on `demo.parse`, failed imports included. |
| `demo_pipeline_failed_total` (`stage` = `import`, `parse` or `analyze`) | Demos the backend marked `FAILED`: the import worker for a rejected download, the dead-letter listener for a message that failed three times in that stage. A parse failure that the parser itself records is not counted here; watch the dead-letter queue instead. |
| `demo_pipeline_parsed_total` | `demo.parsed` messages received for a `PARSED` demo. |

The length of the queues, the dead-letter queue `demo.dlq` and the consumers come from RabbitMQ's own Prometheus
endpoint (port `15692`, the `rabbitmq_prometheus` plugin the `rabbitmq:4-management` image enables). Prometheus reads
its `/metrics/per-object` variant, which has a series for every queue, for example
`rabbitmq_queue_messages_ready{queue="demo.dlq"}`; the plain `/metrics` adds the queues up.

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

### Local addresses

All of them are published on `127.0.0.1` only.

| What | Address | Login |
| --- | --- | --- |
| Web UI and API | <http://localhost:3000> | `X-API-Key` for `POST` |
| RabbitMQ management | <http://localhost:15672> | `RABBITMQ_USER` / `RABBITMQ_PASSWORD` (`guest` / `guest`) |
| MinIO console (S3 API on `9000`) | <http://localhost:9001> | `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` (`minioadmin` / `minioadmin`) |
| Prometheus (profile `observability`) | <http://localhost:9090> | none; targets under Status -> Targets |
| Grafana (profile `observability`) | <http://localhost:3001> | `admin` / `GRAFANA_ADMIN_PASSWORD` |

## Operational notes

- **Docker Compose 2.24.4 or newer** is needed for `docker-compose.fake.yml`: it uses the `!override` tag to replace
  the frontend's port mapping instead of adding a second one.
- **RabbitMQ and MinIO credentials are applied only when their volumes are first created.** Changing `RABBITMQ_USER`,
  `RABBITMQ_PASSWORD`, `MINIO_ACCESS_KEY` or `MINIO_SECRET_KEY` later has no effect on the existing data and the
  backend can no longer log in; start over with `docker compose down -v` (this deletes the database, the queues and
  the stored demos too).
- **Run `down` before switching between real and fake mode.** The two modes configure the same services differently
  (the backend's FACEIT address and key, the published web port); `docker compose down`, then `up` with the other set
  of files.
- **The MinIO image.** `minio/minio` no longer exists on Docker Hub, which is why the default is `alpine/minio`, a
  community build of the MinIO server, pinned by tag and digest in `docker-compose.yml`. To run another build set
  `MINIO_IMAGE` (for example in `.env`) to a full image reference; the command, the ports and the volume stay as
  they are.
- **A `QUEUED` demo whose message was lost** (the process died between the database commit and the publish, or the
  queue was purged) can be queued again: repeat the import request after 10 minutes. Within 10 minutes the request
  only reports the demo, because a download in progress also looks like that.
- **Building the parser on the host needs `protoc`** (the protobuf compiler) and a one-time `./seed-protos.sh`; see
  [`parser/README.md`](parser/README.md). The Docker build needs neither.
