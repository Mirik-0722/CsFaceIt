# Fake FACEIT (WireMock)

A [WireMock](https://wiremock.org) server that plays the FACEIT Data API v4, so the whole stack runs locally without a
FACEIT API key and without network access to FACEIT. The backend is pointed at it by `docker-compose.fake.yml`; no
application code changes. The same server also plays Steam's sign-in (see [The fake Steam](#the-fake-steam)).

## Start and stop

From the repository root:

```bash
docker compose -f docker-compose.yml -f docker-compose.fake.yml up -d --build --wait
```

- Web UI and API: <http://localhost:3000>. The admin key is `dev-admin-key` (header `X-API-Key`); set `APP_API_KEY` to
  use another one. The recorder's API (`/api/worker/v1`) takes another credential, the worker token `dev-worker-token`
  (header `X-Worker-Token`); set `CLIP_WORKER_TOKEN` to use another one.
- The fake itself: <http://localhost:8089> (published on `127.0.0.1` only; `FAKE_FACEIT_PORT` changes the port, and the
  address the browser is sent to for the fake Steam follows it). Inside the stack it is `http://fake-faceit:8080`, which
  is the address the backend and the demo URLs use. `GET /__admin/mappings` on the published port lists every stub.

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
| `GET /players?game=cs2&game_player_id=76561198000000001` | The same profile, found by its SteamID (what signing in uses to link a FACEIT player). |
| `GET /players/11111111-1111-1111-1111-111111111111/history` | Two finished matches, for any query string. |
| `GET /matches/{id}` | Match details of one of the three fake matches below. |
| `GET /matches/{id}/stats` | Per-player stats of one of the three fake matches (10 players). |
| `GET /demos/sample.dem` | A 1 KiB placeholder file. |
| `GET /demos/forbidden.dem` | HTTP 403. |
| `GET /demos/missing.dem` | HTTP 404. |
| `POST /download/v2/demos/download` with `Authorization: Bearer fake-downloads-token` and the body `{"resource_url": "http://fake-faceit:8080/demos/sample.dem"}` | FACEIT's Downloads API for the main match: `{"payload": {"download_url": "http://fake-faceit:8080/demos/sample.dem?signature=made-up-signature"}}`, an address that serves the placeholder above. |
| The same with `"resource_url": "http://fake-faceit:8080/demos/missing.dem"` | HTTP 404 with a FACEIT-style error body. |
| any other `POST /download/v2/demos/download` (another `resource_url`, another or no token) | HTTP 403 `{"errors":[{"code":"err_f0","message":"no valid scope provided"}]}`, what FACEIT answers a token without the scope for the file (and the Data API key). |
| any other `/players` (another nickname, another SteamID), `/players/...`, `/matches/...` | HTTP 404 with a FACEIT-style JSON error body (the backend maps it to `PLAYER_NOT_FOUND` / `MATCH_NOT_FOUND`, and a sign-in with a SteamID that gets it signs in unlinked). |

The data are copies of the backend's test fixtures (`backend/src/test/resources/faceit/`), so their shape is known to
deserialize.

### Fake ids

| What | Id | `demo_url` |
| --- | --- | --- |
| Player `s1mple` | `11111111-1111-1111-1111-111111111111` | |
| Main match (`de_mirage`, 13:9) | `1-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` | `http://fake-faceit:8080/demos/sample.dem` |
| Match whose demo download is forbidden (with the token: the Downloads API refuses it, 403) | `1-ffffffff-0000-0000-0000-000000000403` | `http://fake-faceit:8080/demos/forbidden.dem` |
| Match whose demo is missing | `1-ffffffff-0000-0000-0000-000000000404` | `http://fake-faceit:8080/demos/missing.dem` |
| Match whose demo address does not resolve, as FACEIT's private cloud addresses do not (with the token: the Downloads API refuses it, 403) | `1-ffffffff-0000-0000-0000-000000000502` | `https://demos.faceit-cdn.invalid/cs2/1-ffffffff-0000-0000-0000-000000000502.dem.zst` (`.invalid` never resolves) |

The three failure matches exist to exercise the error paths of a demo download; apart from the id and `demo_url` they are
copies of the main match. They are not listed in the player's history. The second match in the history
(`1-bbbbbbbb-cccc-dddd-eeee-ffffffffffff`) has no details stub and answers 404.

The other players of the fake matches are `playerA2`..`playerA5` (ids `2222...` to `5555...`) and `playerB1`..`playerB5`
(ids `6666...`, `7777...`, `8888...`, `9999...`, `aaaaaaaa-...`). Every roster player carries a `game_player_id`
(a SteamID64): `76561198000000001` for `s1mple`, then `...002` to `...010` in roster order, the same in every match.

## The fake Downloads API

The real import asks FACEIT's Downloads API for a signed address (see "How the import gets the file" in the main README).
`docker-compose.fake.yml` gives the backend the made-up token `fake-downloads-token` and the fake's own address for the API
(`FACEIT_DOWNLOADS_URL`), so the stack takes the same way: the main match is downloaded through the signed address in the
table above, the forbidden and the unresolvable matches fail at once with the code `DOWNLOAD_NEEDS_ACCESS` (the API
refuses them with the real 403 body), and the missing one fails at once with a plain sentence. `GET /__admin/requests`
lists what the fake was asked, including each POST with its `Authorization` header and `resource_url`.

To see the import without access, start the backend with an empty token, for example with a file of your own passed as a
third `-f`:

```yaml
services:
  backend:
    environment:
      FACEIT_DOWNLOADS_TOKEN: ""
```

The import then fetches each `demo_url` as it is: the main match still downloads, the forbidden one answers 403 and the
unresolvable one does not resolve, and both end `FAILED` at once with `DOWNLOAD_NEEDS_ACCESS`.

## The fake Steam

The backend signs a visitor in with Steam's OpenID 2.0 (see "Signing in" in the main README). Steam's login page cannot be
used without a Steam account, so the same WireMock plays it, and the whole flow can be driven in a browser or with `curl`.
`docker-compose.fake.yml` points the backend's two Steam settings at it: `AUTH_STEAM_LOGIN_URL`, the address the **browser**
is sent to (the published port: `http://localhost:8089/steam/openid/login`), and `AUTH_STEAM_VERIFY_URL`, the address the
**backend** asks whether an answer is genuine (inside the stack: `http://fake-faceit:8080/steam/openid/login`).

| Request | Answer |
| --- | --- |
| `GET /steam/openid/login?openid.mode=checkid_setup&openid.return_to=...` | A 302 straight back to `openid.return_to`, with a complete positive answer for the SteamID `76561198000000001`: `openid.mode=id_res`, `openid.op_endpoint` the address of this very request, `openid.claimed_id` and `openid.identity` `https://steamcommunity.com/openid/id/76561198000000001`, the `return_to` that was asked for, and a nonce, a handle, a list of signed fields and a signature that mean nothing. There is no login page, no password and no choice of account. |
| `POST /steam/openid/login` with `openid.mode=check_authentication` | `is_valid:true`, for every answer, whatever it holds. |

SteamID `76561198000000001` is the `game_player_id` of the player `s1mple` (see above), so signing in links the visitor to
`s1mple`. To try a visitor FACEIT does not know, or a FACEIT that fails, begin a sign-in as usual, take the callback address
the fake answers with and change the SteamID in its `openid.claimed_id` and `openid.identity` before calling it, with the
same cookie jar (the fake confirms the changed answer all the same). `GET /players?game=cs2&game_player_id=<that SteamID>`
is then a 404, and a stub with a higher priority can make it a 500:

```bash
# FACEIT answers 500 for this SteamID; "reset" brings back the stubs of mappings/ and removes this one.
curl -X POST http://localhost:8089/__admin/mappings -H 'Content-Type: application/json' -d '{
  "priority": 1,
  "request": {"method": "GET", "urlPath": "/players", "queryParameters": {"game_player_id": {"equalTo": "76561198000000500"}}},
  "response": {"status": 500}}'
curl -X POST http://localhost:8089/__admin/mappings/reset
```

The same works for the confirmation: a stub with a higher priority for `POST /steam/openid/login` whose body is
`ns:http://specs.openid.net/auth/2.0` and `is_valid:false` (one per line) makes every sign-in refused.

**This is for a development machine only, and must never be used on a server.** The fake confirms every answer without
looking at it, so whoever can reach it can sign in as `s1mple`, and with an answer made by hand as anybody. That is why
`docker-compose.fake.yml` publishes it on `127.0.0.1` only, and why the backend's own settings default to Steam's real
addresses: a stack started without this override signs in with the real Steam.

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
