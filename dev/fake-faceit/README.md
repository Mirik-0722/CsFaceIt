# Fake FACEIT (WireMock)

A [WireMock](https://wiremock.org) server that plays the FACEIT Data API v4, so the whole stack runs locally without a
FACEIT API key and without network access to FACEIT. The backend is pointed at it by `docker-compose.fake.yml`; no
application code changes.

## Start and stop

From the repository root:

```bash
docker compose -f docker-compose.yml -f docker-compose.fake.yml up -d --build --wait
```

- Web UI and API: <http://localhost:3000>. The admin key is `dev-admin-key` (header `X-API-Key`); set `APP_API_KEY` to
  use another one. The recorder's API (`/api/worker/v1`) takes another credential, the worker token `dev-worker-token`
  (header `X-Worker-Token`); set `CLIP_WORKER_TOKEN` to use another one.
- The fake itself: <http://localhost:8089> (published on `127.0.0.1` only). Inside the stack it is
  `http://fake-faceit:8080`, which is the address the backend and the demo URLs use. `GET /__admin/mappings` on the
  published port lists every stub.

```bash
docker compose -f docker-compose.yml -f docker-compose.fake.yml down
```

No `.env` is needed. The override sets `FACEIT_BASE_URL=http://fake-faceit:8080` and `FACEIT_API_KEY=fake` for the
backend (the fake does not check the key).

## What it serves

| Request | Answer |
| --- | --- |
| `GET /players?nickname=s1mple` | The `s1mple` profile (CS2 ELO 3500). |
| `GET /players/11111111-1111-1111-1111-111111111111` | The same profile, by id. |
| `GET /players/11111111-1111-1111-1111-111111111111/history` | Two finished matches, for any query string. |
| `GET /matches/{id}` | Match details of one of the three fake matches below. |
| `GET /matches/{id}/stats` | Per-player stats of one of the three fake matches (10 players). |
| `GET /demos/sample.dem` | A 1 KiB placeholder file. |
| `GET /demos/forbidden.dem` | HTTP 403. |
| `GET /demos/missing.dem` | HTTP 404. |
| any other `/players`, `/players/...`, `/matches/...` | HTTP 404 with a FACEIT-style JSON error body (the backend maps it to `PLAYER_NOT_FOUND` / `MATCH_NOT_FOUND`). |

The data are copies of the backend's test fixtures (`backend/src/test/resources/faceit/`), so their shape is known to
deserialize.

### Fake ids

| What | Id | `demo_url` |
| --- | --- | --- |
| Player `s1mple` | `11111111-1111-1111-1111-111111111111` | |
| Main match (`de_mirage`, 13:9) | `1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` | `http://fake-faceit:8080/demos/sample.dem` |
| Match whose demo download is forbidden | `1-ffffffff-0000-0000-0000-000000000403` | `http://fake-faceit:8080/demos/forbidden.dem` |
| Match whose demo is missing | `1-ffffffff-0000-0000-0000-000000000404` | `http://fake-faceit:8080/demos/missing.dem` |

The two failure matches exist to exercise the error paths of a demo download; apart from the id and `demo_url` they are
copies of the main match. They are not listed in the player's history. The second match in the history
(`1-bbbbbbbb-cccc-dddd-eeee-ffffffffffff`) has no details stub and answers 404.

The other players of the fake matches are `playerA2`..`playerA5` (ids `2222...` to `5555...`) and `playerB1`..`playerB5`
(ids `6666...`, `7777...`, `8888...`, `9999...`, `aaaaaaaa-...`). Every roster player carries a `game_player_id`
(a SteamID64): `76561198000000001` for `s1mple`, then `...002` to `...010` in roster order, the same in every match.

## The placeholder demo

`__files/demos/sample.dem` is 1024 bytes of arbitrary data starting with a text banner. It is **not** a real CS2 demo,
so a demo parser rejects it; it is only there so that a download has something to fetch. It is not gzip or zstd data
either.

### Serving a real demo instead

Put a real `.dem` next to the placeholder under another name and add a higher-priority stub for `sample.dem` that is
ignored by git, so the real demo is never committed (demos are large):

```bash
cp /path/to/match.dem dev/fake-faceit/__files/demos/local.dem
cat > dev/fake-faceit/mappings/local-sample-dem.json <<'JSON'
{
  "name": "Local real demo",
  "priority": 1,
  "request": {"method": "GET", "urlPath": "/demos/sample.dem"},
  "response": {
    "status": 200,
    "headers": {"Content-Type": "application/octet-stream"},
    "bodyFileName": "demos/local.dem"
  }
}
JSON
docker compose -f docker-compose.yml -f docker-compose.fake.yml restart fake-faceit
```

Both files match patterns in `.gitignore` (`dev/fake-faceit/__files/demos/local.dem` and
`dev/fake-faceit/mappings/local-*.json`). `GET http://localhost:8089/demos/sample.dem` now returns your demo. To go
back to the placeholder, delete the two files and restart `fake-faceit` again.
