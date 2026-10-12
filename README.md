# CS2 FACEIT Analytics

A web app for looking up Counter-Strike 2 players on [FACEIT](https://www.faceit.com): search a player by nickname,
see the profile and the recent match history, and open a match to read the per-team stats tables (kills, deaths,
assists, headshots, K/D, K/R, ADR). Behind that sits a demo pipeline: the demo (`.dem`) of a match is downloaded or
uploaded, stored, and parsed by a Rust worker into rounds, the players of every round, kills, damages and position
heat bins, from which the backend computes the statistics of every player of the match and finds its highlights.

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
- `recorder/` - the recorder that turns the clips that were asked for into videos: it takes them from the backend's
  worker API, records them and uploads the MP4 and a thumbnail ([`recorder/README.md`](recorder/README.md)). Its fake
  recording mode, a test pattern made by ffmpeg, runs the whole chain; the mode that plays the demo in CS2 on Windows
  is not written yet (see [Video clips](#video-clips)).
- `frontend/` - React + TypeScript single-page app built with Vite. In production Nginx serves it and proxies `/api/`
  to the backend. Its look follows the "A · REC" design: colours, type, components and screens are specified in
  [`docs/superpowers/specs/2026-10-11-web-ui-design.md`](docs/superpowers/specs/2026-10-11-web-ui-design.md), which
  also links the mockups. The interface is in Uzbek (the default) and English: the copy lives in `frontend/src/i18n`,
  and the choice made with the `UZ` / `EN` buttons is kept in the browser under the `csfaceit.lang` key.
- `docker-compose.yml` - PostgreSQL 17, Redis 8, RabbitMQ 4, MinIO, the backend, the parser and the frontend; with
  `--profile observability` also Prometheus and Grafana (`ops/` holds their configuration).
- `docker-compose.fake.yml` and `dev/fake-faceit/` - an override that replaces FACEIT with a local WireMock fake, for
  running the stack without an API key. It also starts `recorder-fake`, the recorder in its fake recording mode, so
  that a clip that is asked for is recorded (as a test pattern) without a game.
- `docker-compose.prod.yml` and `ops/caddy/` - an override for a server with a domain: Caddy in front of the web UI
  serves HTTPS, the web port is no longer open to the network, and every service starts again after a reboot (see
  [Deploying on a server](#deploying-on-a-server)).

## Pages

- `/` - search for a player by FACEIT nickname.
- `/players/{playerId}` - the profile: the statistics over the stored matches as eight tiles (K/D, HS%, ADR, KAST,
  entry and trade kills per match, clutch %, win rate), the six newest highlights, the player's clips and the match
  history. A figure without data behind it is a dash; the four that come from demos say so until one of the player's
  demos is analyzed.
- `/players/{playerId}/highlights` - every highlight of the player, newest match first, with a filter by type that the
  server answers.
- `/matches/{matchId}` - the score, the demo panel, the highlights of the match with a filter by kind (multi-kill,
  clutch, special), each with the state of its clip, the compilation panel, the clips of the match and a scoreboard
  per team.
- `/clips` - whether a recorder is online and how long the queue is, and the finished clips of every player, newest
  first.
- `/clips/{clipId}` - one clip: the video, a line under it with a mark per kill (a click on a mark takes the video
  there), what the clip shows, download, copy link, the list of its kills (a row takes the video to its kill), the
  facts of the clip and the other clips of its match. Until there is a video the page shows the state of the clip in
  its place.

The demo panel shows the status of the match's demo to everyone. Behind "Manage" it has the requests that need the
admin key (`X-API-Key`): import from FACEIT (not offered for a parsed or analyzed demo, for which the backend
ignores it; for a queued or stored one it revives a demo that has stood still for ten minutes), upload a file, and analyze (offered for a `PARSED` demo, as "Re-analyze" for an
`ANALYZED` one). The key is typed once and kept in the memory of the page only - never in `localStorage`,
`sessionStorage` or a cookie - so reloading the page forgets it, and a key the backend rejects is forgotten at once.

Every highlight card of the match page ends with a row about its clip. "Record clip" opens the order: the quality
(720p or 1080p), the length of the queue, and a field for the admin key while the page holds none. A clip on its way
shows its place in the queue, or the stage and the percentage of the recording; a finished one links to its page; a
failed one says why and offers another attempt. The compilation panel orders one video of every kill of a chosen
player in the same way. Recording needs the admin key, as every write does; watching does not. While a clip is
unfinished the page asks for its state again every three seconds. On the page of a clip, "Delete" is offered only
while the page holds the admin key.

## Prerequisites

| Tool | Needed for |
| --- | --- |
| Docker with Compose v2 (2.24.4 or newer for the fake-FACEIT and the production override, see below) | running the stack; also the backend tests (Testcontainers) |
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
| `APP_API_KEY` | **Required.** Secret that clients send in the `X-API-Key` header. Everything except `GET`/`HEAD` on `/api/v1/**`, `/actuator/health` and `/actuator/prometheus` requires it, and `/api/worker/**`, which takes the worker token instead (`CLIP_WORKER_TOKEN`). Choose a long random value, for example `openssl rand -hex 32`. While it is empty the backend logs a warning and rejects every protected request. | empty |
| `CLIP_WORKER_TOKEN` | The secret the recorder sends in the `X-Worker-Token` header (see [Worker API](#worker-api-the-recorder)). It opens `/api/worker/**` and nothing else, and the admin key does not open that. Choose a long random value, for example `openssl rand -hex 32`, and give the same one to the recorder. While it is empty the backend logs a warning and rejects every request of a recorder. The fake-FACEIT mode sets `dev-worker-token`. | empty |
| `FACEIT_BASE_URL` | FACEIT Data API address; override it only to point the backend at a fake FACEIT. Commented out in `.env.example`. | `https://open.faceit.com/data/v4` |
| `FACEIT_HISTORY_LOOKBACK` | How far back a player's match history reaches (`faceit.history-lookback`). FACEIT itself returns only the last month unless the request names a start time, so the backend always sends one. Commented out in `.env.example`. | `365d` |
| `FAKE_SPEED` | Only for the stack without a FACEIT key (`docker-compose.fake.yml`): the seconds of video its `recorder-fake` makes per second of real time. `1` is real time, `0` is as fast as ffmpeg goes (see [The fake recorder](#the-fake-recorder)). Commented out in `.env.example`. | `1` |
| `DB_URL` | JDBC URL of PostgreSQL. | `jdbc:postgresql://localhost:5432/csfaceit` |
| `DB_USER`, `DB_PASSWORD` | PostgreSQL credentials; the `postgres` service is created with them. | `csfaceit` / `csfaceit` |
| `REDIS_HOST`, `REDIS_PORT` | Redis address. | `localhost` / `6379` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the API. | `http://localhost:5173` (the Vite dev server) |
| `WEB_PORT` | Host port the web UI is published on when running with Docker Compose. | `3000` |
| `PUBLIC_ORIGIN` | The browser origin the backend allows in the Compose stack (scheme and host, plus the port when it is not the default one), such as `https://example.com`. Set it when a proxy of your own in front of the web port terminates HTTPS; without it the browser's writes (uploads, analyses, clip orders) are refused with `403` (see [Deploying on a server](#deploying-on-a-server)). Not needed over plain HTTP on the web port, and not used with `docker-compose.prod.yml`, which allows `https://${DOMAIN}`. Commented out in `.env.example`. | `http://localhost:${WEB_PORT}` |
| `DOMAIN` | Only with `docker-compose.prod.yml`: the host name of the server, such as `example.com`, without `https://`. Caddy gets the certificate for it and the backend allows `https://${DOMAIN}`. **Required** there: the stack does not start without it. Its DNS `A` record must point at the server. Commented out in `.env.example`. | none |
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
| `CLIP_UPLOAD_MAX_SIZE` | The most a recorder may upload for one clip (the video and the thumbnail each): a size with a unit such as `1GB` or `512MB`. Nginx accepts 1 GB for the upload path (`frontend/nginx.conf`); raise both to allow more. | `1GB` |
| `CLIP_RETENTION_DAYS` | A finished clip is kept this many days (`clip.retention-days`); `0` keeps every clip. | `30` |
| `CLIP_RETENTION_CRON` | When the clean-up of old clips runs: Spring's six cron fields, server time. Normally left alone. Commented out in `.env.example`; keep the quotes there. | `0 30 4 * * *` |
| `PARSER_MAX_DEMO_BYTES` | The most a demo may be once the parser has decompressed it, in bytes. A larger demo is marked `FAILED` as too large. | `2147483648` (2 GiB) |
| `GRAFANA_ADMIN_PASSWORD` | Password of the Grafana user `admin`. Needed only with `--profile observability`; there is no default and the `grafana` service stops with a message while it is empty. | empty |

`DB_URL`, `REDIS_HOST`, `REDIS_PORT`, `RABBITMQ_HOST`, `RABBITMQ_PORT`, `STORAGE_TYPE`, `STORAGE_LOCAL_DIR`,
`MINIO_ENDPOINT` and `CORS_ALLOWED_ORIGINS` describe a backend running on your machine (dev mode). Inside Docker
Compose they are replaced for the backend container: it connects to the `postgres`, `redis`, `rabbitmq` and `minio`
services, stores demos in MinIO and allows the origin `http://localhost:${WEB_PORT}` (`PUBLIC_ORIGIN` when that is set,
`https://${DOMAIN}` with `docker-compose.prod.yml`). The parser's own settings
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
(`X-API-Key` header) and the worker token of a recorder `dev-worker-token` (`X-Worker-Token` header, see
[Worker API](#worker-api-the-recorder)); because they are public, this mode publishes the web port on `127.0.0.1` only. Stop it with
`docker compose -f docker-compose.yml -f docker-compose.fake.yml down`.
The fake ids, what it serves and how to serve a real demo file are described in
[`dev/fake-faceit/README.md`](dev/fake-faceit/README.md). The override needs Docker Compose 2.24.4 or newer, and the
stack has to be taken down with `down -v` before you switch between the real and the fake mode (see
[Operational notes](#operational-notes)).

The override also starts `recorder-fake`, the [recorder](recorder/README.md) in its fake recording mode, so that the
clips that are asked for (see [Video clips](#video-clips)) are recorded, as a test pattern, without a game; how it goes
and what `FAKE_SPEED` does are in [The fake recorder](#the-fake-recorder).

## Deploying on a server

This takes a fresh Linux server (Ubuntu is assumed) to the site on the internet, with Docker Compose. It is the minimum
for going live and not a hardened production setup: what is still missing is listed at the end.

### What the server needs

- **Docker Engine with Compose v2.24.4 or newer.** A fresh server has neither: install Docker from Docker's own package
  repository (<https://docs.docker.com/engine/install/ubuntu/>), not from the packages of the distribution, which can
  be older or come without the Compose plugin. Check with `docker compose version`, and stop here if it prints less
  than 2.24.4.
- **About 2 CPU cores and 4 GB of memory.** The first build, which compiles the Rust parser and the backend, asks for
  more than the running stack does. With 4 GB, add a swap file of 2 to 4 GB before the first build (the compilation of
  the parser is what runs out of memory) and build the parser by itself first: `docker compose build parser`, then the
  `up` below.
- **Disk:** about 10 GB for the Docker images and the build, plus the data. A demo file is about 400 MB before it is
  compressed for storage, and a clip is a video of tens of megabytes. By default demo files and clips are deleted after
  30 days (`DEMO_RETENTION_DAYS`, `CLIP_RETENTION_DAYS`).
- **Ports 80 and 443 open to the internet, and nothing else** except SSH: 80 and 443 over TCP, and 443 over UDP too if
  you want HTTP/3. Nothing else on the server may listen on them. Open them in the firewall of your provider and in
  `ufw` if you use it. Docker publishes ports around `ufw`, so the stack is built not to rely on it: with
  `docker-compose.prod.yml` only Caddy listens on all interfaces, and everything else is bound to `127.0.0.1`.

### Getting the code and the settings

```bash
git clone <the URL of this repository> csfaceit && cd csfaceit
cp .env.example .env && chmod 600 .env
```

Edit `.env`. Make every secret with `openssl rand -hex 32`: hexadecimal has no character that is special in the URLs
the parser connects with.

| Variable | What to do |
| --- | --- |
| `FACEIT_API_KEY` | **Must be set.** Your FACEIT Data API key; the backend does not start without it. |
| `APP_API_KEY` | **Must be set.** The admin key, sent in `X-API-Key` by whoever uploads a demo, has it analyzed or orders a clip. `docker-compose.prod.yml` refuses to start without it. |
| `CLIP_WORKER_TOKEN` | **Must be set to have clips recorded**, by the recorder you connect (see the end of this section). While it is empty every request of a recorder is refused. |
| `DB_PASSWORD` | **Should be changed.** The default is public. |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD` | **Should be changed.** The defaults are `guest` / `guest`. |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | **Should be changed.** The defaults are `minioadmin` / `minioadmin`. |

These services are published on `127.0.0.1` only, so the defaults cannot be reached from the network, but there is no
reason to keep them on a server. Change them **before the first start**: the database, RabbitMQ and MinIO take their
credentials only when their volumes are created, and a value changed afterwards leaves the existing data with the old
one and the backend can no longer log in (see [Operational notes](#operational-notes)).

### Way A: with a domain (HTTPS)

1. **Point the domain at the server.** Create an `A` record for it with the address of the server (an `AAAA` record only
   if the server really answers on that IPv6 address) and check from your own computer that `dig +short example.com`
   prints that address before you go on. Caddy asks for its certificate as soon as it starts, and the certificate
   authority refuses a name that does not point at the server yet and limits how often you may try again.
2. **Set the domain and the files of the stack in `.env`:**

   ```bash
   DOMAIN=example.com
   COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
   ```

   `DOMAIN` is the bare host name: no `https://`, no path, and exactly the name people will type. The site answers on
   this one name only; `www.example.com` or the address of the server get no certificate and fail. `COMPOSE_FILE` makes
   every `docker compose` command in this directory use the production override, so that none of them can start the
   stack without it by mistake. `docker compose config --services` must now list `caddy`.
3. **Start the stack:**

   ```bash
   docker compose up -d --build --wait
   ```

   The first start builds the images and takes several minutes. Then open `https://example.com`; port 80 redirects to
   HTTPS. If the browser reports a certificate error, read what Caddy says (`docker compose logs caddy`); usually the
   DNS record is wrong or something blocks port 80 or 443. After you have corrected the record,
   `docker compose restart caddy` makes Caddy ask again at once. Do not recreate the stack again and again instead:
   the certificate authority limits failed attempts.
4. **Check it.** From your own computer, a write without the admin key must be refused for the missing key and not
   for its origin:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Origin: https://example.com' \
     https://example.com/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/demo/analyze
   ```

   `401` is right. `403` means that `DOMAIN` in `.env` is not the name in the address bar (or has `https://` in it).
   On the server, `sudo ss -tulnp | grep -v -E '127\.0\.0\.|\[::1\]'` must show only SSH and the ports 80 and 443.

`docker-compose.prod.yml` adds Caddy (`ops/caddy/Caddyfile`), which serves HTTPS for `DOMAIN` with a certificate it
gets and renews by itself, and passes every request to the Nginx of the stack without limiting the size of a body or
the time of a transfer; the certificates are kept in the volume `caddy_data`. It also takes the web port off the
network (it stays on `127.0.0.1:3000` for a look from the server itself), makes `DOMAIN` and `APP_API_KEY` required,
has the backend allow `https://example.com` as its origin, and gives every service `restart: unless-stopped`, so that
the stack comes back after a reboot of the server.

**Keep the `COMPOSE_FILE` line.** A `docker compose` command that does not see both files (the line removed, or
`-f docker-compose.yml` typed by hand) starts the stack without the override: the web port is published on all
interfaces again, the restart policies are gone, every write over HTTPS is refused with `403`, and Caddy is left
running as an orphan. And never add `docker-compose.fake.yml` on a server: it replaces FACEIT with canned answers and
falls back to a recorder token that is public.

### Way B: without a domain (plain HTTP)

On a server, use the production override here too, with a port in the place of the host name. In `.env`:

```bash
DOMAIN=:80
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

Then `docker compose up -d --build --wait`, and open `http://<address of the server>`. With `:80` Caddy serves plain
HTTP on port 80 under whatever name or address the server is reached by, and asks for no certificate. The rest is as
in way A: only Caddy listens on the network, `APP_API_KEY` is required, and every service comes back after a reboot.
The check of step 4 works here as well, with `http://<address of the server>` in both places. When you have a domain,
point it at the server (way A, step 1), change `DOMAIN` to it and run the same `up` again.

Without the override, a plain `docker compose up -d --build --wait` (no `COMPOSE_FILE` line) is the stack of the
[Run with Docker Compose](#run-with-docker-compose): the site is at `http://<address of the server>:3000` (the port is `WEB_PORT`; open it in
the firewall of your provider if it has one), and most services do not start again by themselves after a reboot.

Either way everything works over plain HTTP because the page and the API are one origin. **The admin key then travels
unencrypted**: the page sends it in a header with every upload, analysis and clip order, and anyone on the way between
the browser and the server can read it. Use this way for a trial or on a network you trust, not for a site that other
people use, and change the key when you move to HTTPS.

If a proxy of your own terminates HTTPS in front of the web port (Cloudflare, or an Nginx or Traefik you run), set
`PUBLIC_ORIGIN=https://example.com`, the address the browser shows. Without it the page loads and the reads work, but
every upload, analysis and clip order is refused with `403`: the browser sends `Origin: https://example.com` with a
write, the backend sees plain `http` behind the Nginx of the stack and takes the write for one from another site.

### Updating, logs and backups

The commands below are plain `docker compose …`: right for way B, and for way A because of the `COMPOSE_FILE` line in
`.env`.

Update with the same `up -d --build` after pulling:

```bash
git pull
docker compose up -d --build --wait
```

This rebuilds what changed, recreates the containers whose image or settings changed and applies new database
migrations when the backend starts; the data volumes stay as they are. Take a backup first. A container that keeps
running its old image after a rebuild (the change is not there, and `docker compose ps` shows an old start time) is
recreated by name: `docker compose up -d --build --force-recreate backend`. Now and then, also refresh the images the
stack does not build itself, above all the one that faces the internet (`docker compose pull caddy` before the `up`),
and remove the images an update left behind with `docker image prune -f`.

Look at the stack and its logs:

```bash
docker compose ps
docker compose logs -f --tail 100 backend      # also: caddy, frontend, parser, postgres
```

An error line of Caddy carries the headers of the request that failed, the admin key (`X-API-Key`) and a recorder's
token (`X-Worker-Token`) among them. Read such lines, but do not paste them anywhere without removing those values,
and change a key that got out.

Docker keeps the logs of a container without a size limit unless you set one. To cap them, put
`{"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "3"}}` in `/etc/docker/daemon.json` and
restart Docker (`sudo systemctl restart docker`); the cap applies to containers created afterwards
(`docker compose up -d --force-recreate`).

**Backup of the database.** It holds everything the analysis made: the matches, the players, the facts of the demos,
the statistics, the highlights and the records of the clips. Dump it into a file and keep the file off the server
(`-U` is your `DB_USER`, `csfaceit` unless you changed it):

```bash
set -o pipefail   # so that a dump that fails is not hidden by gzip, which would still write a small valid file
docker compose exec -T postgres pg_dump -U csfaceit --clean --if-exists csfaceit | gzip > csfaceit-$(date +%F).sql.gz
```

To restore it, stop the programs that write, replay the file and start them again. Because of `--clean --if-exists` it
also replays onto a database that already has the tables:

```bash
docker compose stop backend parser
gunzip -c csfaceit-<date>.sql.gz | docker compose exec -T postgres psql -U csfaceit csfaceit
docker compose start backend parser
```

If the site answers `502` after the backend has been started again, restart the Nginx of the stack, which looks up
the address of the backend only when it starts: `docker compose restart frontend`.

**Where the files are.** The demo files and the clip videos are not in the dump; they are in MinIO, in the Docker volume
`miniodata` (bucket `csfaceit`). `docker volume ls` shows it as `<project>_miniodata`, where the project is the name of
the directory you cloned into (`csfaceit_miniodata` for `csfaceit`, as above). To copy it, stop the stack first, then
archive the volume:
`docker run --rm -v csfaceit_miniodata:/data:ro -v "$PWD":/backup alpine tar czf /backup/miniodata.tgz -C /data .`
To put it back, into the empty volume of a stack that is stopped:
`docker run --rm -v csfaceit_miniodata:/data -v "$PWD":/backup alpine tar xzf /backup/miniodata.tgz -C /data`

Never run `docker compose down -v` on a server: `-v` deletes the volumes, and with them the database and the files.
Plain `docker compose down` removes the containers and keeps the data.

The consoles of RabbitMQ (15672) and MinIO (9001), and Prometheus and Grafana if you start them, listen on `127.0.0.1`
of the server only. Reach one through an SSH tunnel, for instance `ssh -L 15672:127.0.0.1:15672 <user>@<server>`.
Set `GRAFANA_ADMIN_PASSWORD` before you start the observability profile on a server: with the restart policy of the
override, Grafana without a password does not stop with its message but restarts in a loop.

### What this deployment does not do yet

- **No clip is recorded.** "Record clip" queues a clip, but no recorder runs on the server. The recorder that plays the
  demo in CS2 on Windows is not written yet (see [Video clips](#video-clips)), and the fake recorder, which makes a test
  pattern, is not started by `docker-compose.prod.yml`. An ordered clip waits in the queue (up to 50, then the API
  answers `429`) and never finishes. A recorder, when there is one, runs on another machine and uses the API of the
  site with `CLIP_WORKER_TOKEN`.
- **Demo files are uploaded by an admin.** The import from FACEIT needs access to FACEIT's Downloads API, which a Data
  API key does not give: such an import ends `FAILED`, with a message that says to upload the file. Upload the `.dem`
  of a match on its page, under "Manage", with the admin key.
- **There is no rate limiting.** Reads are public and anyone may send as many as they like; each lookup that is not in
  the cache uses the quota of your FACEIT key.
- **There are no automatic backups and no alerts when something fails**, and all recorders share one token
  (`CLIP_WORKER_TOKEN`) instead of having one each. It is one server, with nothing to take over when it is down.

## Run in dev mode

Run PostgreSQL and Redis in Docker and the backend and frontend on your machine. The backend starts without RabbitMQ
and MinIO (with `STORAGE_TYPE=local` it does not need MinIO at all); the demo endpoints need the broker to queue work.

```bash
# 1. Infrastructure (works without a .env as well)
docker compose up -d postgres redis
#    To try the demo pipeline as well, start the broker, the object store and the parser too, and set
#    STORAGE_TYPE=minio in your .env: the parser reads demos from MinIO only, so with the default STORAGE_TYPE=local
#    it finds no file and marks the demo FAILED ("the stored file is missing"); a demo stays STORED only while no
#    parser runs. (The first build of the parser image takes several minutes.) `--no-deps` matters: in the full stack
#    the parser waits for the backend container, and without the flag naming the parser would build and start that
#    container too - a second backend beside the one you run in step 2, taking part of the queue's messages.
#    docker compose up -d --build --no-deps postgres redis rabbitmq minio parser

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
the four [demo endpoints](#demo-pipeline) and the [clip endpoints](#video-clips) are described in their own sections,
and the requests that change something (`POST`, `DELETE`) need the `X-API-Key` header.

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
| 401 | `UNAUTHORIZED` | A protected request is missing a valid `X-API-Key` header; a request to the recorder's API (`/api/worker/**`) a valid `X-Worker-Token` header. |
| 403 | `FORBIDDEN` | The request has a valid credential that its path does not accept: the admin key on the recorder's API. |
| 404 | `PLAYER_NOT_FOUND`, `MATCH_NOT_FOUND`, `DEMO_NOT_FOUND` | FACEIT does not know the player or match, or the match has no demo record yet. The request for the compilation of a player's kills does not ask FACEIT: there the first two say that the database has no such match or player; see [Video clips](#video-clips). |
| 404 | `HIGHLIGHT_NOT_FOUND`, `CLIP_NOT_FOUND` | There is no such highlight (or its demo is not `ANALYZED`) or clip; see [Video clips](#video-clips). |
| 409 | `DEMO_URL_UNAVAILABLE`, `DEMO_NOT_PARSED` | A demo import was requested but FACEIT has no demo for the match (yet); or an analysis was requested but the demo is not `PARSED` or `ANALYZED`. |
| 409 | `DEMO_NOT_AVAILABLE`, `PLAYER_STEAM_ID_UNKNOWN`, `NO_KILLS`, `CLIP_TOO_LONG` | A new clip was requested but the demo file is not stored, the player's SteamID is unknown, the player made no kill of an enemy in the match (a compilation), or the clip would be longer than allowed; see [Video clips](#video-clips). |
| 409 | `CLIP_IN_PROGRESS` | A clip was to be deleted while a recorder works on it; see [Video clips](#video-clips). |
| 413 | `PAYLOAD_TOO_LARGE` | An uploaded demo is larger than `DEMO_UPLOAD_MAX_SIZE` (also when a gzip file expands beyond it), or a recorder's video or thumbnail is larger than `CLIP_UPLOAD_MAX_SIZE`. |
| 416 | `RANGE_NOT_SATISFIABLE` | The `Range` of a request for a clip's video starts at or beyond its end; see [Video clips](#video-clips). |
| 429 | `CLIP_QUEUE_FULL` | A new clip was requested but the queue of clips is full; see [Video clips](#video-clips). |
| 502 | `FACEIT_UNAVAILABLE` | FACEIT failed or timed out after retries, or refused the request (for example a rejected `FACEIT_API_KEY`, which is not retried), and no cached copy exists. |
| 503 | `STORAGE_UNAVAILABLE` | The storage cannot do what a request needs: a recorder's (see [Worker API](#worker-api-the-recorder)), or the request for the video or the thumbnail of a clip (see [Video clips](#video-clips)). |

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
  -> backend listener: analyze the facts into the statistics and the highlights of the players -> ANALYZED
     (see "Analysis")
```

The status of a demo is one of:

| Status | Meaning |
| --- | --- |
| `QUEUED` | The import is requested and waits for (or is in) the download. |
| `STORED` | The file is in storage (always as `demos/<matchId>.dem.zst`) and waits for the parser. |
| `PARSED` | The parser has written the facts of the demo to the database; the analysis is next. It is also the status of a demo whose analysis failed, then `error` says so (see [Analysis](#analysis)). |
| `ANALYZED` | The facts have been analyzed and the statistics of the players and the highlights of the match are stored. |
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

**Upgrading from a version without the analysis.** A demo that an earlier version left `PARSED` is not analyzed by
itself: only a new `demo.parsed` message starts an analysis, and the parser sends it when it has parsed a demo. Have such
a demo analyzed with `POST .../demo/analyze` (see [Endpoints](#endpoints)). If it was parsed without round rosters (the
parse is older than `V3`, see [The facts](#the-facts)), that request answers `202` as always, but nothing is analyzed:
the demo stays `PARSED` and its `error` says that the file has to be uploaded again. Upload it, and the new parse
writes the rosters and is analyzed on its own.

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
`PARSED` or `ANALYZED`. The answer is `202` also for a demo that was parsed without round rosters: nothing is analyzed
then, and the demo's `error` says to upload the file again (see [Analysis](#analysis)). Repeating the request is safe:

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
migrations before it connects to RabbitMQ and declares `demo.parse`, and the parser waits for that queue (in the
Compose stack it also waits for the backend to be healthy), so on a new stack the parser never writes to a database that
lacks them (when you upgrade a running stack, bring the backend up first). A demo parsed before `V3` stays without
them, and is not analyzed until the demo file is uploaded again and the new parse replaces the old one (see
[Analysis](#analysis)).

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
player who is not in the roster did not play the round, and a round counts for a player only if he is in it. Two
players of one round on different sides are enemies; players on the same side are teammates.

A match that has no roster row at all (a demo parsed before `V3`, an older parser, or a demo whose positions could not
be read) is **not analyzed**: the sides of a round would be only what its kill events name, and `rounds_played`, ADR,
KAST and the clutches computed from that would be wrong. Nothing is stored and one warning is logged; this is a property
of the facts, so there is no retry and no dead letter. A `PARSED` demo stays `PARSED` and its `error` becomes `The demo
was parsed without round rosters: upload the demo file again` (an `ANALYZED` demo is left as it is, like for any analysis
that does not run). Upload the demo file again: the new parse writes the rosters, is announced on `demo.parsed` and is
analyzed. The fallback for a single player that an otherwise recorded roster lacks (one who died before the first
sampled position) stays.

What is computed for each player of the match:

| Column of `player_match_stats` | Meaning |
| --- | --- |
| `kills`, `headshots` | Kills of an enemy, and the headshots among them. A kill counts only if the killer is a player other than the victim who played the round on the other side than the victim: a team kill, a kill of oneself and a death by the world or the bomb are not kills. |
| `deaths` | Every kill row the player is the victim of, whoever caused the death. |
| `assists` | The kill rows the player is named as the assister of, whose victim was his enemy. |
| `rounds_played` | The number of rounds the player is in the roster of. A row whose `rounds_played` is set was analyzed from the current facts of the demo. Without it the row holds FACEIT's numbers only. |
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

Each analysis first deletes the rows of the match that an analysis wrote (`rounds_played` is set) for a player this
analysis does not mention: a new parse can have a different roster, or a wrong demo can have been uploaded to the match
and corrected, and such a row would keep the kills, deaths, ADR and result of the old facts for good, and be counted in
the player's totals. Rows that only FACEIT's numbers fill (`rounds_played` is `NULL`) are never deleted, and FACEIT's
writer recreates the row of a FACEIT player that was deleted the next time `GET /api/v1/matches/{matchId}/stats` is
called. Then the analysis clears `rounds_played`, `kast` and the entry, trade and clutch counts of the rows that stay
and writes all of them for every player who played a round (a count of 0 is written as 0), so a row that has them was
analyzed from the current facts. Calling
`GET /api/v1/matches/{matchId}/stats` does not disturb an analyzed row: FACEIT's kills, deaths, assists, headshots and
ADR are written only into a row that was not analyzed from a demo, so every number of an analyzed row comes from the
same facts. The demo's players are not necessarily FACEIT's: a SteamID that no roster knows is stored as a placeholder
player `steam:<SteamID>`, so a match can have both analyzed rows (placeholders) and FACEIT rows.

**Highlights.** The same analysis finds the moments of the match that are worth a clip and stores them in
`highlights`: one row per highlight, with the player it belongs to (`player_id`), its type, the round, and the first and
last tick of the clip (`tick_start`, `tick_end`). A multi-kill (`ACE`, `K4`, `K3`) and a special kill (`NO_SCOPE`,
`KNIFE_KILL`, `WALLBANG`, `SMOKE_KILL`) is made of kills of an enemy only (see `kills` above): a team kill, a kill of
oneself and a death by the world or the bomb are none. A clutch and a ninja defuse rest on the timeline of the round
instead, in which every death counts, whoever caused it.

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
multi-kill can be special kills as well. A special kill is one highlight per moment, not per victim: two kills of one
player on the same tick with the same flag (a bullet that goes through two players behind a wall) are one `WALLBANG`,
stored once, and both kills show in its `kills`. Weapon names are compared without regard to case.

**What `NINJA_DEFUSE` does not check.** A ninja defuse in the game's sense is a defuse that is finished while the
enemies are away from the bomb. The parser stores no position per tick, so this rule only knows that an enemy was alive
when the bomb was defused, not whether he was near it when the defuse began. A defuse that is finished with an enemy
right beside the bomb is a `NINJA_DEFUSE` here too, so expect more of them than the game would call by the name. A
stricter rule needs positions in the facts and a new parse of the demo. The web interface is as modest: it tags these
highlights `DEFUSE` and starts the description with "Bomb defused with an enemy alive".

The clip starts `analysis.clip.pre-seconds` before the first tick of the event and ends `analysis.clip.post-seconds`
after its last, as ticks of the demo (64 per second when the demo does not say), but never outside the round:
`tick_start = max(round start, first tick - pre x tick rate)` and `tick_end = min(round end, last tick + post x tick
rate)`, where the round's start and end are its `start_tick` and `end_tick` (an event that lies wholly outside its round,
which the parser's facts do not produce, is not stored and is logged at `WARN`). Every analysis replaces the highlights of
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

**Changing `analysis.clip.pre-seconds` changes the identity of a highlight.** The two clip settings decide its
`tick_start` (`pre-seconds`) and `tick_end` (`post-seconds`), and a highlight is told apart from the others by its match,
player, type, round and `tick_start` (its `id` changes with every analysis, so it is no handle; whatever is made from a
highlight, a clip, finds it again by these five). Once clips exist, changing `pre-seconds` and analyzing again gives the
highlights other `tick_start` values, and the clips made before no longer find theirs: change it before clips are made,
or make the clips again. `post-seconds` only moves where a clip ends. Once clips exist, neither is changed; see
[Video clips](#video-clips).

**When the analysis fails.** The backend tries the `demo.parsed` message three times (an exception in the analysis
itself, say, from facts it cannot handle; every failed attempt is logged at `ERROR` with the exception and its stack
trace) and then gives up. The demo is not marked `FAILED`, because the facts the parser wrote are intact and parsing
the file again would be wasted work (an upload always works, also after the retention job has removed the file: it
restores the demo, see [Retention](#retention)). A `PARSED` demo stays `PARSED` and its
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
| `GET /api/v1/matches/{matchId}/highlights?type=&playerId=` | An array of the highlights of the match, by round and, within a round, by the first tick of the clip. `type` (one of the types in the table of highlight types in [Analysis](#analysis)) and `playerId` narrow the list; both are optional. |
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
colon that rule does not allow: as a path variable and as `?playerId=steam:...` of the match endpoint such an id is a
`400` too, so this player cannot be asked for by id. His highlights are in the list of the match without that filter:
the `playerId` of each of its items is the `steam:` id.

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
| `type` | One of the types in the table of highlight types in [Analysis](#analysis). |
| `playerId`, `nickname` | The player the highlight belongs to: his FACEIT id (`steam:<SteamID>` for a player known only from the demo) and nickname. |
| `roundNumber` | The round of the demo, counted from 1. |
| `side` | `"CT"` or `"T"`: the side the player played that round on, from his `round_players` row. `null` when there is no such row: a player missing from the recorded roster of that round (a demo without any roster is not analyzed, so it has no highlights). |
| `tickStart`, `tickEnd` | The clip, in ticks of the demo; both lie inside the round. |
| `roundStartTick`, `roundEndTick` | The `start_tick` and `end_tick` of the round. |
| `durationSeconds` | The length of the clip, `tickEnd - tickStart` over the tick rate of the demo (64 when it does not say), rounded to the nearest whole second. |
| `kills` | The kills of an enemy the player made from `tickStart` to `tickEnd`, both included, in the order they happened (a team kill, a kill of oneself and a death by the world are not kills, as in the rest of the analysis): what a clip of the highlight would show. They can be more than the kills that earned the tag, since a clip also holds the other kills of the player that fall in its window. `weapon` is the weapon as the demo names it. The array is empty when the clip holds no such kill. Reading a page costs one more statement for the kills of all its highlights, not one for each. |
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
| `adr` | The mean of the ADR of the matches that have one, with one decimal; a match counts once whatever its length. A stored ADR of 0 is no ADR: FACEIT's numbers hold `0.00` for a match whose statistics carry none, so such a row is left out of the mean (`null` when no row has an ADR above zero). |
| `kast` | The percent of the rounds played in the analyzed matches in which the player had a kill, an assist, survived or was traded: the KAST of each match weighted by the rounds he played in it. |
| `entryKillsPerMatch`, `tradeKillsPerMatch` | The entry kills, and the trade kills, per analyzed match, with two decimals. |
| `clutchPercent` | The percent of the player's clutches that his side won. Every situation in which he is the last of his side alive against an enemy is a clutch, so a few percent is normal. |
| `clutchAttempts`, `clutchWins` | The clutches he played, and the ones his side won. |

`matches` counts every stored row, and `winRate`, `kd`, `hsPercent` and `adr` use every stored row, FACEIT's numbers
included (`winRate` the rows whose result is known); only `kast`, the two per-match figures and the clutch figures come
from analyzed matches. A percentage is 0 to 100 with one decimal. A figure with no data behind it is `null`, never 0:
`winRate` while no result of the player is known, `adr` without a stored ADR above zero, `kast` and the two per-match
figures without an analyzed match and `clutchPercent` without a clutch. `kd` and `hsPercent` are the exception: they are
numbers, `0.0` for a player without a stored row (and `hsPercent` for one without a kill), so a consumer that has to tell
"no data" from "zero" tests `matches > 0`. A player the database does not know has `matches`, `analyzedMatches`,
`clutchAttempts` and `clutchWins` at `0`, `kd` and `hsPercent` at `0.0`, and the other figures `null`.

### Retention

A job removes the stored demo files that are older than `DEMO_RETENTION_DAYS` (default 30) once a day at 04:00 server
time. It deletes the file and clears `demos.storage_key`; the status and the parsed facts (`rounds`, `round_players`,
`kills`, `damages`, `heat_bins`) stay. It does nothing when the variable is `0`. A demo whose file is gone can be
brought back by uploading it again. Clips have a clean-up of their own, at 04:30 and by `CLIP_RETENTION_DAYS`; see
[Video clips](#video-clips).

## Video clips

A clip is a video of a moment of a match, cut from the stored demo of the match. There are two kinds: the clip of one
**highlight** (a moment the analysis found, see [Highlights and statistics](#highlights-and-statistics)) and the
**compilation** of every kill of one player in a match. Asking for either puts a row in the `clips` table with the
status `QUEUED` and the **segments** of the demo the video is made of. A recorder, a separate program, takes the queued
clips one at a time, records them and uploads an MP4 and a thumbnail (see [Worker API](#worker-api-the-recorder)). The
recorder that plays the demo in CS2 on a Windows machine is not written yet; the fake recorder, which makes a test
pattern with ffmpeg in its place, runs the whole chain (see [The fake recorder](#the-fake-recorder) and
[Limits](#limits)).

The two requests and the `DELETE` need the admin key in the `X-API-Key` header, the reads are open and answer from the
database only (nothing is asked of FACEIT), except the video and the thumbnail, which come from the storage. The
examples use the Compose address; `<highlightId>` is the `id` of an item of `GET /api/v1/matches/{matchId}/highlights`.

### The chain

```
POST /api/v1/highlights/{id}/clips  (or POST /api/v1/matches/{id}/clips for a compilation)
  -> backend: check the demo file, work out the segments, insert a clips row            QUEUED
Recorder, a separate program that only calls /api/worker/v1 with the header X-Worker-Token:
  -> POST /claim: the oldest queued clip of the qualities it can record                 RECORDING
  -> GET .../demo: the demo as stored (zstd), kept on its disk under the job's demoVersion
  -> record the segments one after the other, POST .../progress at least every 10 s     RECORDING, ENCODING
  -> PUT .../video, PUT .../thumbnail: into the storage (MinIO)                         UPLOADING
  -> POST .../complete                                                                  DONE
Browser: GET /api/v1/clips/{clipId}, GET .../video (Range), GET .../thumbnail
```

### Statuses

| Status | Meaning | A clip gets there by |
| --- | --- | --- |
| `QUEUED` | Waits for a recorder. `queuePosition` is its place: 1 is the clip a recorder takes next, the oldest request first. | The request. Or back from an active status: the recorder gave an attempt up and said it may be repeated (`fail` with `retryable`) and the clip has attempts left, the recorder went silent for `clip.stale-after`, or the answer to a `claim` could not be made because the storage could not be asked (that attempt is not counted). |
| `RECORDING` | A recorder holds the clip: it downloads the demo and records the segments. | `POST /claim`, or a progress report that names this stage. |
| `ENCODING` | The recorder makes the thumbnail and reads the length and size of the video. | A progress report that names this stage. |
| `UPLOADING` | The recorder sends the video and the thumbnail. It reports this stage before the first byte goes out, so the video is in the storage only once the upload of the video has ended (`sizeBytes` is set then); the clip stays here until `complete`. | A progress report that names this stage, or the upload of the video. |
| `DONE` | The video is ready and is served. Final. | `POST .../complete`, which needs the video of this attempt to be uploaded. |
| `FAILED` | Given up; `error` says why. Final: a new request for the same clip queues a new one. | `fail` without `retryable`, or with the attempts used up; a recorder that went silent with the attempts used up; a `claim` that finds the demo file gone or the player's SteamID unknown (not retried). |

`RECORDING`, `ENCODING` and `UPLOADING` are the active statuses, the ones in which a recorder holds the clip. A recorder
may report any active stage at any time, also an earlier one. A status changes only under the lock of the clip's row, so
of a recorder's report and the check that takes a silent clip back, whichever comes first wins and the other finds the
clip as it was left: it is answered with `409 CLIP_NOT_CLAIMED` and changes nothing. The `attempts` column of the `clips`
table counts the claims. A clip that goes back to the queue keeps its count, forgets the claim, the progress and the
files of the attempt, and shows the reason in `error` until it is claimed again; at `clip.max-attempts` it is `FAILED`
instead.

### Requests and reads

| Endpoint | Answer |
| --- | --- |
| `POST /api/v1/highlights/{highlightId}/clips` | Queues the clip of the highlight. The body is `{"quality": "720p"}` or `{"quality": "1080p"}`; no body, or `{}`, is 720p. `201` and the clip when this request queued it, `200` and the clip that already stands for the highlight at that quality when there is one. |
| `POST /api/v1/matches/{matchId}/clips` | Queues the compilation of a player's kills in the match: one video of every kill of an enemy he made, round by round (see **A compilation** below). The body is `{"playerId": "...", "quality": "720p"}`; `playerId` is required, `quality` is as above. `201` and the clip (its `kind` is `COMPILATION`) when this request queued it, `200` and the one that already stands for the player at that quality when there is one. |
| `GET /api/v1/clips/{clipId}` | One clip, with the `kills` its video shows. `404 CLIP_NOT_FOUND`. |
| `GET /api/v1/matches/{matchId}/clips` | An array of the clips of the match, whatever their status, the newest first. Empty for a match the database does not know. |
| `GET /api/v1/players/{playerId}/clips?offset=0&limit=20` | `{"items": [...], "offset": 0, "limit": 20}`: a page of the clips of the player over all his matches, whatever their status, the newest first. `offset` 0-10000, `limit` 1-100. Empty for a player the database does not know. |
| `GET /api/v1/clips?offset=0&limit=20` | The same page, of the clips that are `DONE` only, the most recently finished first. |
| `GET /api/v1/clips/{clipId}/video` | The video of a `DONE` clip, `video/mp4`, with `Accept-Ranges: bytes`, its `Content-Length` and `Cache-Control: public, max-age=86400`; `HEAD` answers the same without the body. A single `Range` is answered with `206`, see "The video and the thumbnail" below. With `?download=1` a browser saves the file under a name of its own instead of playing it. `404 CLIP_NOT_FOUND`, `416 RANGE_NOT_SATISFIABLE`, `503 STORAGE_UNAVAILABLE`. |
| `GET /api/v1/clips/{clipId}/thumbnail` | The thumbnail of a `DONE` clip, `image/jpeg`, `Cache-Control: public, max-age=86400`; `HEAD` works too. `404 CLIP_NOT_FOUND`, `503 STORAGE_UNAVAILABLE`. |
| `DELETE /api/v1/clips/{clipId}` | Deletes the clip and its files: `204`, no body. `404 CLIP_NOT_FOUND`; `409 CLIP_IN_PROGRESS` while a recorder works on it (`RECORDING`, `ENCODING` or `UPLOADING`). A clip that is only `QUEUED` can be deleted, which withdraws the request. |
| `GET /api/v1/recorder/status` | `{"online": true, "lastSeenAt": "...", "queued": 2, "active": 1}`: whether a recorder is there to take the clips that wait. `online` is true when some recorder was seen (it claimed, reported or sent a heartbeat) within `clip.worker-online-within`; `lastSeenAt` is the latest sighting, `null` if there never was one; `queued` clips are `QUEUED`, `active` ones are `RECORDING`, `ENCODING` or `UPLOADING`. |

```bash
curl -X POST -H 'X-API-Key: dev-admin-key' -H 'Content-Type: application/json' -d '{"quality": "1080p"}' \
  http://localhost:3000/api/v1/highlights/<highlightId>/clips
curl -X POST -H 'X-API-Key: dev-admin-key' -H 'Content-Type: application/json' \
  -d '{"playerId": "<playerId>", "quality": "720p"}' \
  http://localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/clips
curl http://localhost:3000/api/v1/clips/<clipId>
curl http://localhost:3000/api/v1/matches/1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/clips
curl "http://localhost:3000/api/v1/players/<playerId>/clips?offset=0&limit=20"
curl "http://localhost:3000/api/v1/clips?limit=10"
curl http://localhost:3000/api/v1/recorder/status
curl -I http://localhost:3000/api/v1/clips/<clipId>/video
curl -H 'Range: bytes=0-99' -o first-100-bytes.mp4 http://localhost:3000/api/v1/clips/<clipId>/video
curl -OJ "http://localhost:3000/api/v1/clips/<clipId>/video?download=1"
curl -o thumbnail.jpg http://localhost:3000/api/v1/clips/<clipId>/thumbnail
curl -X DELETE -H 'X-API-Key: dev-admin-key' http://localhost:3000/api/v1/clips/<clipId>
```

A clip, here a queued one of a `K3` (ids shortened):

```json
{"id": 1, "kind": "HIGHLIGHT", "status": "QUEUED", "progress": 0, "matchId": "1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
 "mapName": "de_mirage", "playerId": "steam:...", "nickname": "garnet", "highlightType": "K3", "roundNumber": 5,
 "tickStart": 33246, "quality": "720p", "fps": 60, "durationMs": null, "sizeBytes": null, "error": null,
 "queuePosition": 1, "videoUrl": null, "thumbnailUrl": null, "createdAt": "...", "finishedAt": null,
 "expiresAt": null, "kills": []}
```

| Field | Meaning |
| --- | --- |
| `kind` | `HIGHLIGHT`, the clip of one highlight, or `COMPILATION`, all the kills of a player in a match. A compilation has no `highlightType`, `roundNumber` or `tickStart`. |
| `status`, `progress` | `QUEUED`, `RECORDING`, `ENCODING`, `UPLOADING`, `DONE` or `FAILED`; see [Statuses](#statuses). `progress` is the percent done of the attempt that is running. |
| `matchId`, `playerId`, `nickname`, `mapName` | The FACEIT match id, the FACEIT player id (`steam:<SteamID>` for a player known only from a demo), his nickname and the map. |
| `highlightType`, `roundNumber`, `tickStart` | The highlight the clip was made for (see [Analysis](#analysis)): its type, its round, and the first tick of its window. |
| `quality`, `fps` | The size of the picture (`"720p"` is 1280x720, `"1080p"` is 1920x1080) and the frames per second (`clip.fps`, as it was when the clip was requested). |
| `queuePosition` | While the clip is `QUEUED`: its place in the queue, 1 for the clip a recorder takes next. `null` in every other status. |
| `error` | Why the clip failed, or why its last attempt did while it waits to be recorded again. |
| `durationMs`, `sizeBytes` | The length of the finished video, and the size of its file (known from the upload on). |
| `videoUrl`, `thumbnailUrl` | Where the video and its thumbnail are served from (`/api/v1/clips/{id}/video`, `/api/v1/clips/{id}/thumbnail`); `null` until the clip is `DONE`, and `thumbnailUrl` also when the recorder uploaded no thumbnail. |
| `createdAt`, `finishedAt`, `expiresAt` | When the clip was requested, when it became `DONE` or `FAILED`, and when the clean-up of old clips removes it (`finishedAt` plus `clip.retention-days`; `null` for a clip that is not `DONE`, or when the setting is 0). |
| `kills` | The kills of an enemy the video shows, each `{"offsetMs", "weapon", "headshot", "victimNickname"}`, in the order of the video. `offsetMs` is the place on the timeline of the finished video: the length of the segments before the kill's own plus its distance from the start of that segment. Only `GET /api/v1/clips/{clipId}` fills it; the lists and the answer to the `POST` carry `[]`. |

**One clip per highlight and quality.** The clip of a highlight is told apart from the others by the match, the player,
the type, the round and the first tick of the highlight, and its quality (the highlight's `id` changes with every
analysis, so the clip does not keep it). A second request for the same highlight, also at the same moment from another
browser, finds the clip that is there and answers `200` with it; nothing is recorded twice. It does so also when the
demo file is gone (demo files are removed after `DEMO_RETENTION_DAYS` days, a clip is kept `clip.retention-days` days
after it is finished). A clip that ended `FAILED` does not count: asking again queues a new one. The same highlight at
the other quality is another clip. After the demo was analyzed again the old highlight id is a
`404 HIGHLIGHT_NOT_FOUND`, and asking with the id the same event now has finds the clip that was made before.

**The segments.** The video is made of the kills of the player inside the window of the highlight (`tickStart` to
`tickEnd`). Each kill of an enemy gets a segment from `clip.pre-seconds` before it to `clip.post-seconds` after it, cut to
the window; segments less than `clip.merge-gap-seconds` apart (or overlapping) become one, so kills in quick succession
are one continuous stretch. A window with no kill of the player in it (a clutch won without a kill, a defuse) is shown
whole. A kill of an enemy is a kill where the player is the killer, did not kill himself, and killer and victim were not
on the same side. Seconds become ticks with the tick rate of the demo (64 when it does not say). The segments are kept
in `clips.segments` as `[{"startTick": ..., "endTick": ...}, ...]`.

**A compilation.** `POST /api/v1/matches/{matchId}/clips` asks for the second kind of clip: one video of every kill of an
enemy that one player made in the match, not of one moment. `<playerId>` in the example above is the `playerId` of a
player of `GET /api/v1/matches/{matchId}/stats` or of an item of `GET /api/v1/matches/{matchId}/highlights`. It is
required, and is a FACEIT player id or `steam:<SteamID>` (1 to 20 digits) for a player the backend knows only from a demo:
the id travels in the body, so the colon that the id rule of a URL path does not allow is no obstacle here. `quality` is
as for a highlight, 720p when left out. There is one compilation per match, player and quality, and it is told apart like
the clip of a highlight: a second request, also at the same moment from another browser, finds the one that is there and
answers `200` with it, and a compilation that ended `FAILED` does not count.

The segments are worked out round by round. In every round in which the player made a kill of an enemy, in the order of
the rounds, each kill gets a segment as above, cut to its round (from the first tick of the round to its last) and merged
with the others of that round; nothing is merged from one round into the next. A round in which he made no kill adds
nothing (a window with no kill is shown whole only for a highlight). The video is the segments one after the other, so its
length is their sum, and `GET /api/v1/clips/{clipId}` places every kill on its timeline. The demo only has to be parsed
(`PARSED` or `ANALYZED`): the kills are the facts of the parser, and no highlight is read.

**The video and the thumbnail.** Only a `DONE` clip has either. For a clip that is not `DONE`, one that does not exist,
a thumbnail the recorder did not upload, and a `DONE` clip whose file is missing from the storage (a warning is logged
then), the answer is `404 CLIP_NOT_FOUND`. The video is `Content-Type: video/mp4`, always with `Accept-Ranges: bytes`
and a `Content-Length` of the bytes sent. The files are the ones the row of the clip names (`video_key`,
`thumbnail_key`: every attempt to record a clip uploads under keys of its own, and the row says which attempt's files are
the clip's), and the length of the video is what the storage says for that key, not `sizeBytes`. Without a
`Range` header the whole file comes with `200`. One range, in the form `bytes=a-b` or `bytes=a-`, is answered with `206`
and `Content-Range: bytes a-b/size` (an end beyond the last byte is cut to it); a start at or beyond the end is a `416`
with `Content-Range: bytes */size`. Any other `Range` (several ranges, the last n bytes as in `bytes=-n`, another unit,
anything that is no range) is ignored and the whole file comes with `200`, which HTTP allows. `HEAD` gives the headers
that `GET` would. With `?download=1` the answer also carries `Content-Disposition: attachment; filename="..."`, and the
ranges work the same. The name is `<nickname>-<type>-r<round>.mp4`, the type in lower case with `-` for `_` (`k4`,
`clutch-1v3`, `smoke-kill`; `defuse` for a ninja defuse, as in the interface), and `<nickname>-compilation.mp4` for a
compilation; every character of the nickname that is not a letter, a digit, `.`, `_` or `-` becomes `_`. The bytes are
streamed from the storage and never held in memory; a browser that seeks drops the request it no longer needs, which is
not an error in the log. In the Compose stack Nginx passes the video on as it arrives (`proxy_buffering off` in
`frontend/nginx.conf`). The thumbnail is always sent whole.

Both files are sent with `Cache-Control: public, max-age=86400`, since the files of a finished clip never change: on
every successful answer (`200`, `206` and `HEAD`, with and without `download`), so that a visit of a shared clip does
not fetch the video again within the day. An error answer carries no such header. A storage that cannot be asked for the
file (it cannot be reached, or it fails for another reason than the file being gone) is a `503 STORAGE_UNAVAILABLE`
with a fixed text, and one warning without a stack trace in the log; it is not a `500`. A file that is simply missing
from the storage stays a `404`.

**Deleting and retention.** `DELETE` removes the row first, in one transaction under its lock, and then the files from
the storage: the video and the thumbnail of every attempt the clip had (`clips/{id}-{attempt}.mp4` and
`clips/{id}-{attempt}.jpg`, attempts counted from 1), and the files the row names if they are not among those. An attempt
that was given up leaves its files in the storage, and a clip that went back to the queue has lost the keys of the row
but not its objects, which is why the files are removed by their names and not by the row alone. A file the storage
cannot remove is a warning in the log, the file stays, and the answer is `204` all the same. A job removes the clips that
finished more than `clip.retention-days` days ago (`DONE` and `FAILED` ones, both have a finish time) in the same way,
once a day at 04:30 server time (`clip.retention-cron`), and logs one line with the number it removed; a clip it cannot
remove does not stop it. It does not run against a storage that is down: before the first clip it asks the storage
whether a key exists, and if that fails the whole run is skipped with one warning, the rows stay and the next run takes
them (every expired clip would otherwise lose its row and keep its files for good, since nothing sweeps `clips/`). `0`
days switches the job off, and then `expiresAt` is `null`.

### Checks and errors

Besides `200`, `201` and `204`, the requests above are answered with:

| Status | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | The `quality` is not `"720p"` or `"1080p"`, the body cannot be read, the `playerId` of a compilation is missing or is neither a FACEIT player id nor `steam:<SteamID>`, or an id or paging parameter is malformed. A player known only from a demo has the id `steam:<SteamID>`, whose colon the id rule does not allow, so `GET /api/v1/players/{playerId}/clips` cannot name him (as for his highlights); his clips are in the list of the match. |
| 401 | `UNAUTHORIZED` | The `POST` or the `DELETE` is missing a valid `X-API-Key` header. |
| 404 | `HIGHLIGHT_NOT_FOUND` | There is no highlight with that id, or the demo of its match is not `ANALYZED` (a highlight is served only then, see [Highlights and statistics](#highlights-and-statistics)). |
| 404 | `MATCH_NOT_FOUND`, `PLAYER_NOT_FOUND` | A compilation was requested for a match or a player the database does not know. |
| 404 | `CLIP_NOT_FOUND` | There is no clip with that id; for the video and the thumbnail also: the clip is not `DONE`, it has no thumbnail, or its file is missing from the storage. |
| 409 | `DEMO_NOT_AVAILABLE` | A clip would have to be queued, but the demo file of the match is not in storage (the retention job removed it, see [Retention](#retention); upload the demo again) or the demo is not `PARSED` or `ANALYZED`. A request for a clip that exists is answered with that clip all the same. |
| 409 | `PLAYER_STEAM_ID_UNKNOWN` | The backend does not know the SteamID of the player, and a recorder follows a player by it. |
| 409 | `NO_KILLS` | A compilation was requested for a player who made no kill of an enemy in the match (he did not play in it, or got none). |
| 409 | `CLIP_TOO_LONG` | The segments add up to more than `clip.max-duration-seconds`. |
| 409 | `CLIP_IN_PROGRESS` | The clip to delete is being recorded, encoded or uploaded. Delete it when it is `DONE` or `FAILED`, or while it still waits. |
| 416 | `RANGE_NOT_SATISFIABLE` | The `Range` of a request for the video starts at or beyond its end; `Content-Range: bytes */size` says how long it is. |
| 429 | `CLIP_QUEUE_FULL` | `clip.max-queued` clips are waiting already. Ask again later. The limit is soft: two requests at the same moment may both get in. |
| 503 | `STORAGE_UNAVAILABLE` | The video or the thumbnail was asked for while the storage could not be asked for the file (it cannot be reached, or it fails for another reason than the file being gone). Ask again later. |

The `POST` for a highlight checks in this order, and the first that fails ends the request: the highlight; the clip that is there
already (answered with `200`, whatever became of the demo file and however long the queue is); the demo file; the SteamID
of the player; the queue; and last the length of the segments.

A compilation is checked in this order, and the first check that fails ends the request: the match and then the player,
in the database only (`404 MATCH_NOT_FOUND`, `404 PLAYER_NOT_FOUND`; FACEIT is not asked); the compilation that is there
already (answered with `200`, whatever became of the demo file and however long the queue is); the demo file; the SteamID
of the player; that he made a kill of an enemy in the match (`409 NO_KILLS`); the queue; and last the length of the
segments.

### Worker API (the recorder)

The recorder is a separate program on a PC that can run the game; it sits behind NAT, so it never takes a connection, it
only calls this API. It knows nothing else of the backend: everything it does is a request to `/api/worker/v1/**`, and
every request carries the header `X-Worker-Token: <CLIP_WORKER_TOKEN>`. The paths below are relative to
`/api/worker/v1`; the examples use the fake stack's token, `dev-worker-token`, and its address.

**Access.** The token opens the worker API and nothing else, and the admin key does not open the worker API. Every
method of it needs the token, `GET`s included.

| Request | Answer |
| --- | --- |
| A worker path with no token, or a wrong one (also while `CLIP_WORKER_TOKEN` is empty: nothing matches then) | `401 UNAUTHORIZED` |
| A worker path with the admin key (`X-API-Key`) and no valid token | `403 FORBIDDEN` |
| `/api/v1/**` with the worker token (a `POST` there needs the admin key) | `401 UNAUTHORIZED` |

**The conversation.** A recorder asks for work with `POST /claim` until it gets a job (`200`; on `204` it waits a few
seconds and asks again). For the job it downloads the demo (`GET .../demo`; the file can be kept under the job's
`demoVersion` and reused for the next clip of the same match), records the `segments` one after the other, encodes the
video, uploads it (`PUT .../video`) and a thumbnail (`PUT .../thumbnail`), and finishes with `POST .../complete`. Or it
gives the clip up with `POST .../fail`. All through, it reports with `POST .../progress`.

**A clip is the recorder's only while it reports.** The progress report is the sign of life: send one at most every 10
seconds in every stage, while downloading the demo, recording, encoding and uploading too (an upload is one long
request, so the reports go out on a timer of their own). A clip that has had no report for `clip.stale-after` (3 minutes)
is taken back by a job that runs every 30 seconds: it goes back to the queue with the error "The recorder stopped
responding", or is `FAILED` with it when it has had `clip.max-attempts` attempts. An attempt is counted when the clip is
claimed. **A `409 CLIP_NOT_CLAIMED` to any request about a clip means: stop working on it, and abort an upload that is in
flight.** The clip is not held by that `worker` (it was taken back, finished, failed or deleted, or there is no such
clip), or not in the attempt that the request began in (an upload of an earlier attempt, after the recorder has claimed
the clip again). The row of the clip is never changed by such a late request. The body of an upload that arrives after
the claim was lost is normally not stored at all; one that was already on its way to the storage is stored under the key
of its own attempt (`clips/{clipId}-{attempt}.mp4`), which no later attempt writes and no row names: nothing reads it,
and deleting the clip removes it. Every attempt uploads under keys of its own, so an earlier attempt can never replace
the file that the clip's row names.

| Method and path | Request | Success | Errors |
| --- | --- | --- | --- |
| `POST /claim` | JSON `{"worker": "pc-1", "version": "1.0", "mode": "game", "qualities": ["720p", "1080p"]}`. `worker` is the name of the recorder (required, at most 64 characters), `version` (at most 32) and `mode` (at most 16) are for the operator; all three are made only of letters, digits, `.`, `_` and `-`, anything else is a `400`, `qualities` are the qualities it can record (left out or empty: every quality). | `200` and the job (below): the oldest waiting clip of those qualities, now `RECORDING` with `progress` 0, held by `worker`, one more attempt counted. `204`, no body, when none is waiting. | `400 VALIDATION_ERROR`, `503 STORAGE_UNAVAILABLE` (the storage could not be asked for the size of the demo: the clip goes back to the queue with its attempt, and the recorder waits a while before it asks again) |
| `POST /clips/{clipId}/progress` | JSON `{"worker": "pc-1", "stage": "RECORDING", "progress": 40}`. `stage` is `RECORDING`, `ENCODING` or `UPLOADING` (the clip takes it as its status, so an earlier stage is possible too), `progress` the percent done, 0 to 100. | `204`. The clip shows the stage and percent in `GET /api/v1/clips/{clipId}`. | `400 VALIDATION_ERROR`, `409 CLIP_NOT_CLAIMED` |
| `GET /clips/{clipId}/demo?worker=pc-1` | The name of the recorder in the query. | `200`, `Content-Type: application/zstd`, `Content-Length` of the job's `demoSizeBytes`: the demo as it is stored, compressed with zstd (`zstd -d` gives the `.dem`). Streamed. | `400 VALIDATION_ERROR` (no `worker`), `409 CLIP_NOT_CLAIMED`, `410 DEMO_NOT_AVAILABLE` (the file is not stored any more, or the demo is not parsed), `503 STORAGE_UNAVAILABLE` (the storage cannot be read; if it fails with part of the file sent, the connection is broken instead, so a download that ends short of its `Content-Length` is a failed download) |
| `PUT /clips/{clipId}/video?worker=pc-1` | The MP4 file as the raw body, `Content-Type: video/mp4`; not empty, and not larger than `CLIP_UPLOAD_MAX_SIZE` (a `Content-Length` above it is refused before the body is read). | `204`. The video is stored as `clips/{clipId}-{attempt}.mp4`, `attempt` being the number of the attempt the clip is in (its `attempts`, counted from 1), and the clip becomes `UPLOADING` with `sizeBytes`. A video that is sent again in the same attempt replaces the first. | `400 VALIDATION_ERROR` (empty body, or cut off), `409 CLIP_NOT_CLAIMED` (also when the clip was taken back while the file was on its way, or the recorder has claimed it again meanwhile: nothing is recorded then), `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `503 STORAGE_UNAVAILABLE` |
| `PUT /clips/{clipId}/thumbnail?worker=pc-1` | The JPEG file as the raw body, `Content-Type: image/jpeg`; the same limits. | `204`. Stored as `clips/{clipId}-{attempt}.jpg`; the status of the clip stays. | As for the video |
| `POST /clips/{clipId}/complete` | JSON `{"worker": "pc-1", "durationMs": 14500, "width": 1280, "height": 720}`; all three numbers are positive. | `204`. The clip is `DONE`, `progress` 100, with `durationMs`, and `videoUrl` is set. | `400 VALIDATION_ERROR`, `409 CLIP_NOT_CLAIMED`, `409 CLIP_VIDEO_MISSING` (no video was uploaded in this attempt) |
| `POST /clips/{clipId}/fail` | JSON `{"worker": "pc-1", "error": "The game crashed", "retryable": true}`. `error` is kept on the clip (cut to 2000 characters), and `GET /api/v1/clips/{clipId}` shows it to everyone: it must hold no local path and no stack trace. | `204`. With `retryable` true and fewer than `clip.max-attempts` attempts so far the clip goes back to the queue (`QUEUED`, the claim, the progress and the uploaded files forgotten, the `error` kept until it is claimed again); otherwise it is `FAILED` with the `error`. | `400 VALIDATION_ERROR`, `409 CLIP_NOT_CLAIMED` |
| `POST /heartbeat` | JSON `{"worker": "pc-1", "version": "1.0", "mode": "game", "state": "IDLE", "clipId": null}`. `state` is `IDLE` or `WORKING`; `clipId` is the clip it works on, if any. | `204`. The recorder counts as seen (`GET /api/v1/recorder/status`). It does not keep a clip alive; progress reports do. | `400 VALIDATION_ERROR` |

`claim` and `progress` count as a sighting of the recorder too, so a recorder that asks for work every few seconds
needs no heartbeat while it is idle.

**An answer can arrive before the body is sent.** The backend refuses an upload without reading the rest of its body (a
clip that is not the recorder's: `409`; a body that is too large: `413`; a wrong token: `401`), and Nginx passes the
answer on at once. `curl` shows the JSON answer when it comes, after the first megabytes of a 350 MiB body. A client that
sends the whole body before it reads the answer may see a broken connection instead of the answer: it then asks about
the clip with a `progress` call, whose answer (`204`, or `409 CLIP_NOT_CLAIMED`) says whether the claim still holds.

**The name of a recorder** (`worker`) has to be unique among the recorders that run at the same time: the check that a
clip is the recorder's rests on it, and two recorders with one name would be taken for one. A `claim` whose answer was
lost on the way may still have claimed a clip: it is `RECORDING` for a recorder that never saw the job, and comes back to
the queue by the stale check after `clip.stale-after`, with the attempt counted.

The job that `claim` answers with:

```json
{"clipId": 7, "kind": "HIGHLIGHT", "matchId": "1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "mapName": "de_mirage",
 "focusSteamId": "76561198000000008", "tickRate": 64,
 "segments": [{"startTick": 33246, "endTick": 33566}, {"startTick": 34604, "endTick": 35467}],
 "width": 1280, "height": 720, "fps": 60, "demoSizeBytes": 412345678, "demoVersion": "1791760220485"}
```

`segments` are the stretches of the demo to record, in ticks (the demo runs at `tickRate` per second), both ends
included, one after the other in the order of the list; the video is all of them joined. `focusSteamId` is the player to
follow. `width`, `height` and `fps` are what the clip is recorded at. `demoVersion` names this version of the demo file
(the time it was last changed in the database, in epoch milliseconds, as a string): a file kept under it is the one to
use again, and a new version means the demo was uploaded or imported again.

A clip that cannot be recorded is never given out. At the moment of the claim a clip whose demo has no stored file
(or is not parsed), or whose player's SteamID is not known, is set to `FAILED` ("The demo file is no longer stored",
"The player's Steam ID is not known"; not retried), and the next waiting clip is taken instead. The same happens to a
clip whose file is named by the database but is missing in the storage. Several recorders may ask at the same moment: a
clip goes to exactly one of them, the others get the next one, or `204`.

```bash
H='X-Worker-Token: dev-worker-token'
curl -X POST -H "$H" -H 'Content-Type: application/json' -d '{"worker": "pc-1"}' http://localhost:3000/api/worker/v1/claim
curl -H "$H" -o demo.dem.zst "http://localhost:3000/api/worker/v1/clips/7/demo?worker=pc-1"
curl -X POST -H "$H" -H 'Content-Type: application/json' -d '{"worker": "pc-1", "stage": "RECORDING", "progress": 40}' \
  http://localhost:3000/api/worker/v1/clips/7/progress
curl -X PUT -H "$H" -H 'Content-Type: video/mp4' -T clip.mp4 "http://localhost:3000/api/worker/v1/clips/7/video?worker=pc-1"
curl -X PUT -H "$H" -H 'Content-Type: image/jpeg' -T thumb.jpg "http://localhost:3000/api/worker/v1/clips/7/thumbnail?worker=pc-1"
curl -X POST -H "$H" -H 'Content-Type: application/json' -d '{"worker": "pc-1", "durationMs": 14500, "width": 1280, "height": 720}' \
  http://localhost:3000/api/worker/v1/clips/7/complete
```

### The fake recorder

`recorder-fake` is the [recorder](recorder/README.md) in its fake recording mode, a service of `docker-compose.fake.yml`,
so the fake-FACEIT stack (see [Running without a FACEIT key](#running-without-a-faceit-key)) starts it with everything
else. It claims the queued clips like any recorder (as `fake-1`, with the token `dev-worker-token`), downloads the
demo, and makes a test pattern with ffmpeg in place of playing it: the frames carry the clip id, the SteamID of the
player and the tick of the demo they stand for, so a mark of a kill on the clip page takes the video to the frame of
that tick. It uploads the video and a thumbnail and completes the clip, so that the whole chain from the button to the
player can be tried without a game.

It records in real time by default: a clip of ten seconds takes about ten seconds, long enough to watch it go from
state to state. `FAKE_SPEED` is the seconds of video it makes per second of real time, and `0` makes it as fast as ffmpeg
goes. Set it in the environment of the `docker compose` command:

```bash
docker compose -f docker-compose.yml -f docker-compose.fake.yml logs -f recorder-fake
FAKE_SPEED=0 docker compose -f docker-compose.yml -f docker-compose.fake.yml up -d recorder-fake
docker compose -f docker-compose.yml -f docker-compose.fake.yml stop recorder-fake
```

Stopping the service gives the clip it holds back to the queue at once; killing it (`kill`) leaves the clip to be taken
back after `clip.stale-after`. The recorder's own settings (`BACKEND_URL`, `RECORDER_MODE`, `WORKER_NAME`, `FAKE_SPEED`
and the rest), what it writes where and what it does when something goes wrong are in
[`recorder/README.md`](recorder/README.md).

### Settings

The `clip` block of `backend/src/main/resources/application.yml`. The four with an environment variable are set in
`.env` (see [Configuration](#configuration)); the others are changed in the file. They are checked when the backend
starts: a count, a time span or a size that is not positive is refused (`retention-days` may be 0).

| Setting | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `clip.worker-token` | `CLIP_WORKER_TOKEN` | empty | The secret of the recorder's API; see [Worker API](#worker-api-the-recorder). While it is empty every request of a recorder is refused. |
| `clip.fps` | | 60 | Frames per second of a recording. |
| `clip.pre-seconds`, `clip.post-seconds` | | 3, 2 | How long a segment starts before a kill and ends after it. |
| `clip.merge-gap-seconds` | | 4 | Segments less than this far apart are one. |
| `clip.max-duration-seconds` | | 300 | The most the segments of one clip may add up to. |
| `clip.max-queued` | | 50 | How many clips may wait in the queue. |
| `clip.max-attempts` | | 3 | How many times a clip is recorded before it is given up (`FAILED`). |
| `clip.stale-after` | | 3m | An active clip whose recorder has reported nothing for this long is taken back. |
| `clip.worker-online-within` | | 90s | A recorder seen this recently counts as online. |
| `clip.upload-max-size` | `CLIP_UPLOAD_MAX_SIZE` | 1GB | The most a recorder may upload for one clip (the video and the thumbnail each). |
| `clip.retention-days` | `CLIP_RETENTION_DAYS` | 30 | Days a finished clip (`DONE` or `FAILED`) is kept before the clean-up removes it with its files; `expiresAt` is worked out from it. `0` keeps every clip. |
| `clip.retention-cron` | `CLIP_RETENTION_CRON` | `0 30 4 * * *` | When the clean-up runs: Spring's six cron fields, server time. Normally left alone. |

The counters, gauges and the timer of the clip pipeline are listed under [Metrics and dashboards](#metrics-and-dashboards).

### Limits

**A clip needs the stored demo file.** The recorder cuts the clip from that file, and the retention job removes the stored
demo files after `DEMO_RETENTION_DAYS` days (30, see [Retention](#retention)); the parsed facts and the status of the
demo stay. From then on a request for a new clip is a `409 DEMO_NOT_AVAILABLE`, a clip that still waits is `FAILED` when
a recorder claims it ("The demo file is no longer stored", not retried), and the demo has to be uploaded again. A clip
that is `DONE` is a file of its own and stays until `clip.retention-days` have passed since it finished.

**A demo that the storage keeps failing on holds up the queue.** A `claim` that cannot ask the storage for the size of
the demo gives the clip back to the queue with its attempt and answers `503`. That is right for an outage, which ends
and lets the next `claim` go on. If the storage instead keeps answering with an error for the demo object of the clip at
the head of the queue (an object it cannot look up, say), every `claim` takes that clip first, gives it back and ends in
a `503`, and the clips behind it wait; no attempt is used up, so `clip.max-attempts` never fails it. It shows in the log
of the backend as the warning "The storage could not be asked for the demo of clip N: it is back in the queue", which
names the same clip at every poll of the recorder, and in the metrics as `clips_queue_size` staying above 0 while the
recorder is online (`clips_recorder_online` is 1) and `clips_active` is 0; `GET /api/v1/recorder/status` shows the same
figures. Delete the waiting clip (`DELETE /api/v1/clips/{clipId}`; a clip that is only `QUEUED` can be deleted), or
upload the demo of its match again.

**One recorder records one clip at a time.** At the default `FAKE_SPEED` the fake recorder takes as long as the video
lasts, so a queue of `clip.max-queued` (50) clips is a long wait, and a compilation of a player with many kills is
minutes of video (`clip.max-duration-seconds` is 300). More than one recorder may serve the queue, each under a name of
its own; in practice there is one, the machine with the game.

**Do not change `analysis.clip.pre-seconds` or `analysis.clip.post-seconds` once a clip exists.** A clip finds its
highlight by the first tick of the highlight's window (`tick_start`), and that tick is worked out from `pre-seconds`
(see [Analysis](#analysis)): after a change and a new analysis the highlights have other first ticks, the clips made
before no longer find theirs, and a request for the same event queues a second clip. A changed `post-seconds` moves the
end of every highlight's window, so the clips made before would have been cut to another window than their highlight
has now. Change them before the first clip is made. If they have to change later, the highlight must first get the ticks
of the event itself (a new migration), and the clip's key has to move to them.

**Real recording is not implemented.** The recorder that plays the demo in CS2 on a Windows machine
(`RECORDER_MODE=csdm`) is not written: the program ends at start with a message that says so, and every clip made today
is the test pattern of the fake recorder.

## Metrics and dashboards

The backend exports Micrometer metrics at `/actuator/prometheus`, among them those of the demo pipeline and of the clip
pipeline:

| Metric (Prometheus name) | Meaning |
| --- | --- |
| `demo_pipeline_stage_duration_seconds_count`, `_sum`, `_max` (`stage="import"`) | How long an import took, from taking over the message to the announcement on `demo.parse`, failed imports included. |
| `demo_pipeline_stage_duration_seconds_count`, `_sum`, `_max` (`stage="analyze"`) | How long one handling of a `demo.parsed` message took, the analysis of the demo from reading its facts to storing the statistics and the highlights; an attempt that failed and a message that found nothing to analyze are included. |
| `demo_pipeline_failed_total` (`stage` = `import`, `parse` or `analyze`) | Failures, each counted once, in the stage it failed in. `import`: a rejected download, a dead letter from `demo.import`, and a demo whose `demo.import` or `demo.parse` message could not be published because the broker was unavailable. `parse`: the parser's own failures (it records `FAILED` and rejects the message; the backend counts the rejection when it reads the dead letter) and a dead letter from `demo.parse` for a demo that was still `STORED`. These demos went to `FAILED`. `analyze`: an analysis that failed three times (a dead letter from `demo.parsed`) for a demo that is `PARSED` or `ANALYZED`; the demo does not go to `FAILED` (see [Analysis](#analysis)). A demo set to `FAILED` by hand in the database is not counted. |
| `demo_pipeline_parsed_total` | `demo.parsed` messages handled by the backend, each time the listener handles one: a message whose analysis fails is tried three times and counts three times. It also counts messages for a demo that is not there or is no longer `PARSED`, which the analysis skips. |
| `clips_requested_total` (`kind` = `HIGHLIGHT` or `COMPILATION`) | Requests that queued a new clip. A request answered with the clip that was already there (a repeated request, also one from a second browser) is not counted, and neither is one that was refused. |
| `clips_finished_total` (`status` = `DONE` or `FAILED`) | Every arrival of a clip in a final status, whoever caused it: a recorder's `complete`; a recorder's `fail` that may not be retried or has no attempt left; the check that takes back the clip of a silent recorder when no attempt is left; a `claim` that found the demo file gone or the player's SteamID unknown. A clip deleted, by a request or by the retention job, is not counted. |
| `clips_requeued_total` | Every return of a clip to the queue after an attempt: a `fail` with `retryable` while an attempt is left, and a clip taken back from a recorder that went silent. A claim that was given back because the storage could not be asked for the demo is not counted: no attempt was made, the attempt is handed back with the clip (that outage is the `503` of `/claim` and a warning in the log). |
| `clips_record_duration_seconds_count`, `_sum`, `_max` | How long a clip that became `DONE` was held by its recorder: from `claimed_at` to `finished_at` of the attempt that succeeded, so the download of the demo (when the recorder does not have it yet), the recording, the encoding and the upload. Only clips that became `DONE` are in it. |
| `clips_queue_size`, `clips_active` | Gauges: the clips that are `QUEUED`, and the clips that are `RECORDING`, `ENCODING` or `UPLOADING`. |
| `clips_recorder_online` | A gauge: 1 when some recorder was seen (it claimed, reported or sent a heartbeat) within `clip.worker-online-within`, else 0. |

The counters and the timer live in the backend's memory and start from 0 after a restart; `rate()` and `increase()` in
Prometheus allow for that. The three clip gauges are the figures `GET /api/v1/recorder/status` gives. A job reads them
from the database every 10 seconds and a scrape reads the last figures, so a scrape never waits for the database. A
scrape that did would wait for a connection while the database is down, and the pool waits 30 seconds for one, longer
than Prometheus waits for a scrape (10 seconds by default): the backend's other metrics would be lost with it, just when
they are wanted. When a read fails the gauges are `NaN`, "unknown", and not the last figure, until a read succeeds; the
first read to fail has waited for the pool, so that is up to about 40 seconds after the database went away. The backend
logs the outage once, and the end of it once.

The Actuator endpoints are not published, so to look at the clip metrics without Prometheus ask the backend from inside
the stack:

```bash
docker compose exec -T backend curl -s http://localhost:8080/actuator/prometheus | grep '^clips_'
```

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
`127.0.0.1`. `docker-compose.prod.yml` narrows it too: there Caddy, on ports 80 and 443, is the way in (see
[Deploying on a server](#deploying-on-a-server)).

| What | Address | Published on | Login |
| --- | --- | --- | --- |
| Web UI and API | <http://localhost:3000> | all interfaces (default stack), `127.0.0.1` (fake mode, `docker-compose.prod.yml`) | `X-API-Key` for `POST`; `X-Worker-Token` for `/api/worker/**` |
| RabbitMQ management | <http://localhost:15672> | `127.0.0.1` | `RABBITMQ_USER` / `RABBITMQ_PASSWORD` (`guest` / `guest`) |
| MinIO console (S3 API on `9000`) | <http://localhost:9001> | `127.0.0.1` | `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` (`minioadmin` / `minioadmin`) |
| Prometheus (profile `observability`) | <http://localhost:9090> | `127.0.0.1` | none; targets under Status -> Targets |
| Grafana (profile `observability`) | <http://localhost:3001> | `127.0.0.1` | `admin` / `GRAFANA_ADMIN_PASSWORD` |

## Operational notes

- **Docker Compose 2.24.4 or newer** is needed for `docker-compose.fake.yml` and `docker-compose.prod.yml`: they use
  the `!override` tag to replace the frontend's port mapping instead of adding a second one.
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
