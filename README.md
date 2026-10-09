# CS2 FACEIT Analytics

A web app for looking up Counter-Strike 2 players on [FACEIT](https://www.faceit.com): search a player by nickname,
see the profile and the recent match history, and open a match to read the per-team stats tables (kills, deaths,
assists, headshots, K/D, K/R, ADR).

```
Browser --> Nginx (frontend container) --/api/--> Spring Boot backend --> FACEIT Data API v4
                                                        |   |
                                                  PostgreSQL  Redis (FACEIT response cache)
```

- `backend/` - Spring Boot 3.5 (Java 21): REST API, FACEIT client with retries and timeouts, Redis cache, PostgreSQL
  persistence (Flyway migrations), Actuator and Prometheus metrics.
- `frontend/` - React + TypeScript single-page app built with Vite. In production Nginx serves it and proxies `/api/`
  to the backend.
- `docker-compose.yml` - PostgreSQL 17, Redis 8, the backend and the frontend.
- `docker-compose.fake.yml` and `dev/fake-faceit/` - an override that replaces FACEIT with a local WireMock fake, for
  running the stack without an API key.

## Prerequisites

| Tool | Needed for |
| --- | --- |
| Docker with Compose v2 | running the stack; also the backend tests (Testcontainers) |
| Java 21 | running and testing the backend outside Docker |
| Node 22 and npm | running and testing the frontend outside Docker |
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

`DB_URL`, `REDIS_HOST`, `REDIS_PORT` and `CORS_ALLOWED_ORIGINS` describe a backend running on your machine (dev mode).
Inside Docker Compose they are replaced for the backend container: it connects to the `postgres` and `redis`
services and allows the origin `http://localhost:${WEB_PORT}`.

## Run with Docker Compose

```bash
docker compose up -d --build --wait
```

Open <http://localhost:3000> (or the port you set in `WEB_PORT`).

- Of the application services, only the web UI is published; postgres and redis are published on 127.0.0.1 for
  development (`127.0.0.1:5432` and `127.0.0.1:6379`). The backend is reachable through Nginx at `/api/`
  (for example <http://localhost:3000/api/v1/players?nickname=s1mple>); its Actuator endpoints are not exposed.
- If the backend container exits right after starting, read `docker compose logs backend`. The usual cause is an
  empty `FACEIT_API_KEY`, reported as `Property: faceit.apiKey ... must not be blank`. If lookups answer 502 instead,
  the log line `FACEIT rejected the request (check FACEIT_API_KEY)` means FACEIT refused the key.
- Stop the stack with `docker compose down`; the database lives in the `pgdata` volume and survives. Add `-v` to
  delete it as well.

## Running without a FACEIT key

A WireMock server can play FACEIT, so the whole stack starts with no API key and no `.env`:

```bash
docker compose -f docker-compose.yml -f docker-compose.fake.yml up -d --build --wait
```

Open <http://localhost:3000> and search for `s1mple`. The admin key for protected requests is `dev-admin-key`
(`X-API-Key` header). Stop it with `docker compose -f docker-compose.yml -f docker-compose.fake.yml down`.
The fake ids, what it serves and how to serve a real demo file are described in
[`dev/fake-faceit/README.md`](dev/fake-faceit/README.md).

## Run in dev mode

Run PostgreSQL and Redis in Docker and the backend and frontend on your machine.

```bash
# 1. Infrastructure (works without a .env as well)
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

Base URL: <http://localhost:3000> with Docker Compose, <http://localhost:8080> in dev mode. All endpoints are `GET`,
open, and return JSON. Errors have the shape `{"code": "...", "message": "..."}`.

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
| 400 | `VALIDATION_ERROR` | A nickname, id or paging parameter is malformed. |
| 401 | `UNAUTHORIZED` | A protected request is missing a valid `X-API-Key` header. |
| 404 | `PLAYER_NOT_FOUND`, `MATCH_NOT_FOUND` | FACEIT does not know the player or match. |
| 502 | `FACEIT_UNAVAILABLE` | FACEIT failed or timed out after retries, or refused the request (for example a rejected `FACEIT_API_KEY`, which is not retried), and no cached copy exists. |

FACEIT responses are cached in Redis (player profile 5 minutes, match history 2 minutes, finished match 24 hours),
and an expired copy is served when FACEIT is down.

Operational endpoints (`/actuator/health`, `/actuator/prometheus`) are served by the backend on port 8080 and are
only reachable directly in dev mode, not through Nginx.
