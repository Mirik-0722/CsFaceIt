# gcbridge: the bridge to the CS2 game coordinator

A match from Valve's own matchmaking (Premier, Competitive, Wingman) has no page at FACEIT. What a player has of it is
the **match sharing code**, `CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx`, which names the match but not the place of its replay
file. The place can only be found out by asking the CS2 **game coordinator**, and the game coordinator answers a Steam
account that is signed in and "playing" Counter-Strike 2, nobody else. This service is that account. It holds the
session and answers two HTTP calls; the backend of CsFaceIt calls it, and nothing else in the repository knows the
credentials of the account.

It is made of unofficial parts: it uses Steam the way a game client does, with the libraries
[`steam-user`](https://github.com/DoctorMcKay/node-steam-user) and
[`globaloffensive`](https://github.com/DoctorMcKay/node-globaloffensive). **Valve can restrict this at any time, or
ban the account that does it.** Use an account of its own, never yours, and see [Unofficial use of Steam](#unofficial-use-of-steam).

Node 22, no web framework, no build step. The files are in `src/`: `server.js` starts it, `app.js` is the HTTP side,
`steam.js` the real coordinator, `fake.js` the fake one, `queue.js` the line the calls wait in, `login.js` the
sign-in helper.

## The two calls

Every answer is JSON with `Content-Type: application/json`. Any other path, and any other method on these two, is
`404 {"code":"NOT_FOUND"}`.

### `GET /health`

No token. `200 {"steam": true, "gc": true}` when the account is signed in **and** the session with the game
coordinator is open; otherwise `503` with the same two fields (for example `{"steam": true, "gc": false}`). In the fake
mode it is always `200`. This is what the `HEALTHCHECK` of the image asks.

### `POST /resolve`

The header `X-Bridge-Token` carries `BRIDGE_TOKEN`; the body is `{"shareCode": "CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"}`
(the content type of the request is not looked at).

| Status | Body | When |
| --- | --- | --- |
| 200 | `{"matchId": "497977367312933230", "replayUrl": "http://replay…valve.net/730/….dem.bz2", "matchTime": "2026-10-13T10:37:29.000Z"}` | The match is known and its replay address is there. `matchId` is the id of the match as a decimal string, `matchTime` is when the match was played (ISO-8601, UTC). |
| 400 | `{"code":"BAD_REQUEST"}` | The body is not JSON (or is larger than 2 KiB), or `shareCode` is missing or does not match `^CSGO(-[A-Za-z0-9]{5}){5}$`. In the real mode also a code that has the right shape but is not a sharing code (a character outside the alphabet of sharing codes, which has no `0`, `1`, `I`, `l` and `g`). |
| 401 | `{"code":"UNAUTHORIZED"}` | `X-Bridge-Token` is missing or wrong. The comparison takes the same time whatever is sent. |
| 404 | `{"code":"MATCH_UNKNOWN"}` | The game coordinator knows no such match. |
| 409 | `{"code":"REPLAY_NOT_READY","matchTime":"…"}` | The match is known and has no replay address, and its time is **less than 2 hours** ago: Valve publishes the file some minutes after the match. Ask again later. |
| 410 | `{"code":"REPLAY_EXPIRED","matchTime":"…"}` | The match is known and has no replay address, and it ended **2 hours or more** ago: Valve keeps the files for a limited time only. |
| 429 | `{"code":"BUSY"}` | 20 requests are already waiting for their turn. |
| 503 | `{"code":"GC_UNAVAILABLE"}` | Steam or the game coordinator is not ready, or the game coordinator did not answer within 15 seconds, or its answer for a known match had no match time. |
| 500 | `{"code":"INTERNAL_ERROR"}` | A bug of the bridge (it is logged). |

The requests to the game coordinator go **one at a time, at least 1.1 seconds apart**, through a queue of at most 20
waiting requests; a request therefore can wait a long time, and the caller's timeout should allow for it. Of 25
requests that arrive at once, one is served at once, 20 wait for their turn and 4 get `429`.

### Where the replay address is in the coordinator's answer

`requestGame` of `globaloffensive` is answered by its event `matchList`, with the match list message of the game
coordinator (`CMsgGCCStrike15_v2_MatchList`) whose `matches` are `CDataGCCStrike15_v2_MatchInfo`. For the match that was
asked for, the bridge reads:

- the match id from **`matchid`**, which must equal the id decoded from the sharing code (a list that does not contain
  it is not taken for the answer, and an empty list means "no such match");
- the time from **`matchtime`** (seconds since 1970);
- the replay address from the **`map` field of the last element of `roundstatsall`**, the round statistics of the match.
  It counts only when it is an `http:` or `https:` address: in a match without a published replay that field holds a
  map name or nothing, and then the answer is 409 or 410 by the time of the match.

Nothing else of the answer is used. These three are what to compare with a real answer when there is an account (see
[What could not be tried](#what-could-not-be-tried-without-a-real-account)).

## Settings

Environment variables. A variable that is set but empty counts as not set. A setting that is missing or wrong ends the
program at start (exit code 2) with a message that names every problem. **No credential, refresh token, bridge token or
two-factor code is ever logged or returned**, and a sharing code is logged only by its first nine characters.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BRIDGE_TOKEN` | none, required | The secret that callers send as `X-Bridge-Token`. The bridge refuses to start without it. |
| `PORT` | `8090` | The port the bridge listens on. |
| `BRIDGE_HOST` | `0.0.0.0` | The address it listens on. In the container it has to be left alone; on a development machine `127.0.0.1` keeps it off the network. |
| `STEAM_BOT_REFRESH_TOKEN` | none | The refresh token of the bot account. **Preferred** when set. Get it with the sign-in helper below. |
| `STEAM_BOT_USERNAME`, `STEAM_BOT_PASSWORD`, `STEAM_BOT_SHARED_SECRET` | none | Used when there is no refresh token, and then all three are needed: the account name, the password, and the shared secret of the account's mobile authenticator, from which the two-factor code is made (with the time of Steam, so that a clock that is a few seconds off does not matter). |
| `BRIDGE_DATA_DIR` | `/data` | Where the Steam library keeps the little it needs between restarts (such as the id of the region it last connected to). The refresh token and the password are not kept there. The image makes it a volume. |
| `BRIDGE_FAKE` | `0` | `1` turns the [fake mode](#the-fake-mode) on: no connection to Steam at all, and no account needed. |
| `BRIDGE_FAKE_REPLAY_URL` | a made-up address | The replay address that the fake mode answers with. |
| `BRIDGE_FAKE_DELAY_MS` | `300` | How long one fake answer takes, so that the queue can be seen working. |

The real mode with none of the account settings stops at start:

```
gcbridge cannot start:
  - BRIDGE_TOKEN is not set. The bridge refuses to start without it: callers send it as X-Bridge-Token.
  - There is no Steam account to sign in with. Set STEAM_BOT_REFRESH_TOKEN (preferred; "node src/login.js" makes one), or all of STEAM_BOT_USERNAME, STEAM_BOT_PASSWORD and STEAM_BOT_SHARED_SECRET. Not set: STEAM_BOT_USERNAME, STEAM_BOT_PASSWORD, STEAM_BOT_SHARED_SECRET. To run without Steam at all, set BRIDGE_FAKE=1.
```

A refresh token is looked at before anything is started: one that is not a Steam refresh token for the Steam client, or
has expired, stops the bridge with a message that names `STEAM_BOT_REFRESH_TOKEN` (without printing it). The date until
which a valid one lasts is logged at start.

## The fake mode

`BRIDGE_FAKE=1` gives the same two calls with fixed answers, chosen by **the last group of the sharing code**, so that
the other parts of CsFaceIt and a reviewer can call every answer without an account. The answers go through the same
queue as the real ones (so the same pacing, and the same `429` when 20 are waiting), each taking `BRIDGE_FAKE_DELAY_MS`;
only `BUSY5` and `DOWN5` are refused at the door, at once, as the real mode refuses a full queue and a coordinator that
is not ready.

| Last group | Answer |
| --- | --- |
| `READY` | 200: the match id decoded from the code, `replayUrl` = `BRIDGE_FAKE_REPLAY_URL`, `matchTime` = 30 minutes ago |
| `NOTYT` | 409 `REPLAY_NOT_READY` (a match from 30 minutes ago without an address) |
| `GONE5` | 410 `REPLAY_EXPIRED` (a match from 30 days ago without an address) |
| `UNKWN` | 404 `MATCH_UNKNOWN` |
| `BUSY5` | 429 `BUSY` |
| `DOWN5` | 503 `GC_UNAVAILABLE` |
| anything else | 200, like `READY` |

These codes need not decode to anything real: when the decoder cannot read the code, the match id comes from a hash of
the code (the same code always gets the same id). The 200, 409 and 410 are made by the same code that makes the real
ones, from a match with or without an address and with its time.

```bash
cd gcbridge && npm ci
BRIDGE_FAKE=1 BRIDGE_TOKEN=made-up-token BRIDGE_HOST=127.0.0.1 PORT=8090 node src/server.js
curl -s -X POST http://127.0.0.1:8090/resolve -H 'X-Bridge-Token: made-up-token' \
  -d '{"shareCode":"CSGO-Qw7Mn-Zp5Xc-Hy9Rt-Ab3Kd-READY"}'
```

## Running it

In the stack, as an overlay of the main Compose file (the service is `gcbridge`, built from this directory, on the
default network of the stack, **with no published port**, with a named volume for `BRIDGE_DATA_DIR`):

```bash
# .env: BRIDGE_TOKEN=<openssl rand -hex 32>, and the account (below), or BRIDGE_FAKE=1
docker compose -f docker-compose.yml -f docker-compose.cs2.yml up -d --build gcbridge
docker compose -f docker-compose.yml -f docker-compose.cs2.yml logs gcbridge
```

The backend reaches it at `http://gcbridge:8090`. Keep the port unpublished: the bridge is not made to be seen from
outside the stack, and `BRIDGE_TOKEN` is the only thing that guards it.

The log of a healthy start (the account's SteamID is public; nothing secret appears):

```
INFO  Listening on 0.0.0.0:8090 in the real mode.
INFO  The refresh token is valid until 2027-04-21T10:52:27.000Z.
INFO  Signing in to Steam with the refresh token.
INFO  Signed in to Steam as 76561190000000000.
INFO  The session with the game coordinator is open.
```

## Making the bot account ready

The bridge needs a Steam account that is **not yours**. While the bridge runs, the account is "in game": Steam lets one
session play at a time, so you could not play on it, and if you did, one of you would be thrown out. (The bridge says
so in its log when another session is playing, and goes on when that stops.)

1. **Make a new Steam account** for the bridge, with an e-mail address of its own.
2. **Add Counter-Strike 2 to its library.** The game is free: open its page in the Steam store while signed in with the
   bot account and choose *Play Game*. It does not have to be installed.
3. **Turn on Steam Guard with the mobile authenticator** for it (the Steam mobile app). The bridge cannot use Steam Guard
   by e-mail: it has nobody to read the mail.
4. **Get a refresh token with the sign-in helper**, which signs in once as a Steam client and prints the token:

   ```bash
   docker compose -f docker-compose.cs2.yml run --rm gcbridge node src/login.js
   # or, with Node 22 and after `npm ci`, in this directory:  node src/login.js
   ```

   It asks on the terminal for the account name, the password (not shown as you type) and, when Steam wants one, the
   Steam Guard code, then prints the refresh token with one line that says which setting it goes into, and exits. It
   writes nothing to disk and logs nothing else. The question for the code comes only when the account needs it; leave
   the answer empty to confirm the sign-in in the Steam mobile app instead. (Compose wants `BRIDGE_TOKEN` to be set for
   every command with this file, the helper's included; any value will do for this.)
5. **Put the token into `.env`** as `STEAM_BOT_REFRESH_TOKEN`, and start the bridge (above). The account name, the
   password and the shared secret are then not needed. A value with a `$` in it goes between single quotes in `.env`.
6. **Look at `/health`** from inside the stack, for example
   `docker compose -f docker-compose.yml -f docker-compose.cs2.yml exec gcbridge wget -qO- http://127.0.0.1:8090/health`:
   `{"steam":true,"gc":true}` is the account in the game.

A refresh token lasts about 200 days (the documentation of `steam-user` says so); the bridge logs its date at every
start. Run the helper again before then. The bridge does not renew it by itself, because a renewed token would make the
one in `.env` invalid.

The other way is the account name and the password with the shared secret of the mobile authenticator, which you need
other tools to get. It signs in with a full password login on every start; the refresh token does not.

### What the bridge does when something goes wrong

| Case | What happens |
| --- | --- |
| The connection to Steam drops | `/health` is 503, calls get 503; the library signs in again by itself and the bridge says again that the account plays Counter-Strike 2. |
| A sign-in ends for a reason that may pass (Steam is down, no network) | It is tried again after 30 seconds, then 60, 120, … up to 10 minutes. |
| Steam refuses the account (wrong password, revoked or expired token, banned, signed in elsewhere) | **No new attempt**: trying again would not help, and trying again and again could get the account or the address blocked. The bridge stays up, `/health` is 503 and the log says why. Fix the account or the settings and start it again. |
| Steam asks for a two-factor code (password route) | It is made from the shared secret. After a wrong one the next comes after 30 seconds (as the documentation of `steam-user` demands), and after the third wrong one the bridge stops trying. An e-mail code cannot be given. |
| The game coordinator refuses the account | `/health` is `{"steam":true,"gc":false}` and the log says why. |
| `SIGTERM` (`docker stop`) | It signs out of Steam and ends. |

## Unofficial use of Steam

Valve offers no interface for this. The bridge does what a game client does: it signs in, says it is playing app 730
(Counter-Strike 2), and sends one message to the game coordinator that the game itself sends when a player opens a
match from a sharing code. That is unofficial use, and Valve can change the protocol, rate-limit the account, or ban it,
without notice. That is why the account is one of its own, why there is a pause of at least 1.1 seconds between
requests, and why a refused account is not retried. Do not give it a valuable account.

## What could not be tried without a real account

Everything above was exercised in the fake mode and with the libraries replaced by fakes (the sign-in, the session, the
answers of the coordinator, the retries, the queue, and the prompts of the sign-in helper). Not one byte of it has gone
to the real Steam. Until the first real account is used, these are **assumptions that come from the documentation of
the libraries and are unproven**:

- that the sign-in with a refresh token, and with the account name, the password and the shared secret, works as
  described, and that the sign-in helper's `LoginSession` (platform `SteamClient`) gives a token that `steam-user`
  accepts;
- that `gamesPlayed([730])` is enough for the game coordinator to open its session (`connectedToGC`) for a new account,
  and whether a **limited** account (one that has not spent anything on Steam) or one without Prime status is answered
  at all;
- that the Steam Guard / two-factor path of the password route works with the code made by `steam-totp`;
- the shape of a real `matchList` answer: that `matchid` equals the id decoded from the code, that `matchtime` is there,
  and that the last element of `roundstatsall` carries the replay address in `map` (the field is read as the brief
  said; compare it with a real answer first);
- what the coordinator answers for **an unknown match** (an empty list, which the bridge turns into 404, or nothing at
  all, which becomes 503 after 15 seconds) and for **an expired replay** (a known match whose last `map` is not an
  address, which becomes 410);
- that 1.1 seconds between requests is slow enough for the coordinator;
- that the files on `replay…valve.net` really are `.dem.bz2` under `/730/` and can be fetched without more than the
  address.

## The libraries, and where the calls are documented

| Call | Documented in |
| --- | --- |
| `new SteamUser({ dataDirectory })`, `logOn({ refreshToken })`, `logOn({ accountName, password, twoFactorCode })`, `gamesPlayed([730])`, `logOff()`; the events `loggedOn`, `disconnected`, `error`, `steamGuard`, `playingState`; the option `autoRelogin` and `renewRefreshTokens` | `node_modules/steam-user/README.md` (Options, `logOn`, `gamesPlayed`, Events) |
| `new GlobalOffensive(steamUser)`, `requestGame(…)`, the events `connectedToGC`, `disconnectedFromGC`, `error`, `matchList` | `node_modules/globaloffensive/README.md` (Setup, `requestGame`, Events) |
| The sharing code decoder `new ShareCode(code).decode()` (what `requestGame` uses inside) | `node_modules/globaloffensive-sharecode/README.md` |
| `SteamTotp.getAuthCode(sharedSecret, callback)` | `node_modules/steam-totp/README.md` |
| `LoginSession`, `startWithCredentials`, `submitSteamGuardCode`, the events `authenticated`, `timeout`, `error` | `node_modules/steam-session/README.md` |

The exact versions are pinned in `package.json` and `package-lock.json`.
