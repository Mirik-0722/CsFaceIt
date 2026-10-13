'use strict';

const GlobalOffensive = require('globaloffensive');
const SteamTotp = require('steam-totp');
const SteamUser = require('steam-user');

const { HOLD_CAP_MS, holdSignInUntil, readAttempts, readHold, recordAttempt, waitBeforeSignIn } = require('./attempts');
const { describeError } = require('./log');
const { badRequest, unavailable } = require('./errors');
const { decode } = require('./sharecode');

const CS2_APP_ID = 730;

// How long the coordinator may take to answer one request.
const REQUEST_TIMEOUT_MS = 15 * 1000;

// When a sign-in ends for a reason that may pass (Steam is down, the network is), it is tried again after this long,
// and then after twice as long each time, up to the maximum.
const RETRY_FIRST_MS = 30 * 1000;
const RETRY_MAX_MS = 10 * 60 * 1000;

// Steam asks for a new two-factor code after a wrong one only if it is a different code, which takes 30 seconds to
// come. steam-user's documentation says that asking again sooner makes a login loop that gets the IP address banned.
const WRONG_CODE_WAIT_MS = 30 * 1000;
const MAX_WRONG_CODES = 3;

// The time of Steam is asked for so that a clock that is a few seconds off does not make the code wrong; it is not
// worth waiting for longer than this.
const TIME_QUERY_TIMEOUT_MS = 10 * 1000;

// How Steam's results are told apart when a sign-in ends. Only the ones that say "not now" are tried again; for anything
// else (a wrong password, a revoked token, a locked or suspended account, somebody else signed in with the account, a
// result nobody has seen) trying again would not change the answer, and trying again and again could get the account or
// the address blocked. Then the bridge stays up, /health says 503, and someone has to fix the cause and restart it.
//   transient  an error without a result (no server list, no network) and the results below: the back-off above
//   slow       Steam is rate-limiting this account or address: one new attempt per hour, never faster
const TRANSIENT = new Set(['Fail', 'NoConnection', 'Timeout', 'ServiceUnavailable', 'TryAnotherCM', 'BadResponse']
  .map((name) => SteamUser.EResult[name]));
const SLOW = new Set(['RateLimitExceeded', 'AccountLoginDeniedThrottle'].map((name) => SteamUser.EResult[name]));
const RETRY_SLOW_MS = 60 * 60 * 1000;

// The library reconnects to the coordinator by itself after a lost session, but never after a fatal error of the
// coordinator (globaloffensive/handlers.js: ClientLogonFatalError). A bridge that is signed in and has been without the
// coordinator for this long ends, and the restart policy of the container starts it again.
const COORDINATOR_DOWN_EXIT_MS = 10 * 60 * 1000;

// After the bridge ended because the coordinator stayed unavailable, the next start waits this long before it signs in.
// With the 10 minutes of waiting for the coordinator, a lasting problem costs one sign-in about every 40 minutes.
const AFTER_COORDINATOR_EXIT_WAIT_MS = 30 * 60 * 1000;

// A request that timed out may still be answered, and an answer has no id to tell which request it belongs to. For this
// long after the last timeout an empty match list is therefore never taken for "no such match"; see the match list handler.
const LATE_ANSWER_WINDOW_MS = 60 * 1000;

// A two-factor code for the account, made from the shared secret of its mobile authenticator. steam-totp can ask Steam
// for the time and allow for the difference of the clocks (its documentation: getAuthCode with a callback); when Steam
// does not answer, the clock of this machine is used.
function twoFactorCode(sharedSecret, log) {
  return new Promise((resolve) => {
    let finished = false;
    let timer = null;
    const finish = (code) => {
      // getTimeOffset can call back twice on a malformed answer.
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve(code);
      }
    };
    const fromLocalClock = (why) => {
      log.warn(`Could not read the time of Steam (${why}); the two-factor code is made with the clock of this machine.`);
      finish(SteamTotp.generateAuthCode(sharedSecret));
    };

    timer = setTimeout(() => fromLocalClock('no answer'), TIME_QUERY_TIMEOUT_MS);
    SteamTotp.getAuthCode(sharedSecret, (error, code) => (error ? fromLocalClock(error.message) : finish(code)));
  });
}

// The address of the replay in the message of the match list: the string is a web address, or it is not (in a round
// that has no replay the field holds a map name).
function isWebAddress(value) {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// One match of the match list (CDataGCCStrike15_v2_MatchInfo) as an outcome:
//   matchid        the id of the match (a decimal string)
//   matchtime      when the match was played, in seconds since 1970
//   roundstatsall  the statistics of the rounds; the map field of the LAST element holds the address of the replay
//                  file when Valve has published one
function toOutcome(info) {
  const seconds = Number(info.matchtime);
  const rounds = Array.isArray(info.roundstatsall) ? info.roundstatsall : [];
  const last = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  return {
    kind: 'match',
    matchId: BigInt(info.matchid).toString(),
    matchTime: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null,
    replayUrl: last && isWebAddress(last.map) ? last.map : null,
  };
}

function sameMatch(a, b) {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

// The coordinator of the real mode: a Steam account that is signed in and "playing" Counter-Strike 2, and through it
// the game coordinator. Calls follow the documentation of the packages: steam-user (logOn, gamesPlayed and the events
// loggedOn, disconnected, error, steamGuard, playingState), globaloffensive (requestGame and the events connectedToGC,
// disconnectedFromGC, error, matchList) and steam-totp (getAuthCode).
//
// account is { refreshToken } or { username, password, sharedSecret }. onFatal is called when the bridge should end so
// that it is started again. requestTimeoutMs is a parameter only so that it can be shortened when this is tried against
// fake libraries.
function createSteamCoordinator({ account, dataDir, log, requestTimeoutMs = REQUEST_TIMEOUT_MS, onFatal = () => {} }) {
  // steam-user reconnects by itself after a lost connection (its option autoRelogin is on by default) and writes what
  // it needs between restarts to dataDirectory. It does not renew the refresh token (renewRefreshTokens is off by
  // default): a renewed token would make the one in the settings invalid.
  const client = new SteamUser({ dataDirectory: dataDir });
  const csgo = new GlobalOffensive(client);

  const state = { steam: false, gc: false };
  let pending = null; // the one request that waits for the match list: { matchId, resolve, reject, timer }
  let retryTimer = null;
  let retryDelayMs = RETRY_FIRST_MS;
  let wrongCodes = 0;
  let blocked = false;
  let stopped = false;
  let lastTimeoutAt = null; // when a request last timed out (not when one was refused at once)
  let holdWriteFailed = false;
  let downTimer = null;

  const ready = () => state.steam && state.gc;

  function failPending(error) {
    if (pending) {
      const request = pending;
      pending = null;
      clearTimeout(request.timer);
      request.reject(error);
    }
  }

  // Writes down that no sign-in is to be made for the next `ms`, for a restart to honour. A write that fails is said once.
  function hold(ms) {
    if (!holdSignInUntil(dataDir, Date.now() + ms) && !holdWriteFailed) {
      holdWriteFailed = true;
      log.warn(`The wait before the next sign-in could not be written to ${dataDir}; a restart would not keep it.`);
    }
  }

  // Signed in, but without the coordinator and not by somebody else's game: after a while the bridge ends (see
  // COORDINATOR_DOWN_EXIT_MS). Looked at again whenever one of the two states changes.
  function watchCoordinator() {
    const down = state.steam && !state.gc && !blocked && !stopped;
    if (down && downTimer === null) {
      downTimer = setTimeout(() => {
        log.error('Signed in to Steam, but the game coordinator has been unavailable for '
          + `${COORDINATOR_DOWN_EXIT_MS / 60000} minutes and the library does not open the session again. The bridge ends so that it is started again.`);
        // The restart must not sign in at once: the next start waits (see start()).
        hold(AFTER_COORDINATOR_EXIT_WAIT_MS);
        onFatal();
      }, COORDINATOR_DOWN_EXIT_MS);
    } else if (!down && downTimer !== null) {
      clearTimeout(downTimer);
      downTimer = null;
    }
  }

  function lost(reason) {
    state.steam = false;
    state.gc = false;
    failPending(unavailable(reason));
    watchCoordinator();
  }

  // Signs in again after delayMs; without one, after the back-off that doubles with every attempt.
  function scheduleRetry(delayMs) {
    if (stopped || retryTimer) {
      return;
    }
    const wait = delayMs === undefined ? retryDelayMs : delayMs;
    if (delayMs === undefined) {
      retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
    }
    log.warn(`Signing in again in ${Math.round(wait / 1000)} s.`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      signIn();
    }, wait);
  }

  async function signIn() {
    if (stopped) {
      return;
    }
    try {
      if (!recordAttempt(dataDir)) {
        log.warn(`The time of this sign-in could not be written to ${dataDir}; a restart loop would not be slowed down.`);
      }
      if (account.refreshToken) {
        log.info('Signing in to Steam with the refresh token.');
        client.logOn({ refreshToken: account.refreshToken });
      } else {
        log.info('Signing in to Steam with the account name and password.');
        const code = await twoFactorCode(account.sharedSecret, log);
        client.logOn({ accountName: account.username, password: account.password, twoFactorCode: code });
      }
    } catch (error) {
      log.error(`Could not start the sign-in: ${describeError(error)}`);
      scheduleRetry();
    }
  }

  client.on('loggedOn', () => {
    state.steam = true;
    watchCoordinator();
    retryDelayMs = RETRY_FIRST_MS;
    wrongCodes = 0;
    log.info(`Signed in to Steam as ${client.steamID.getSteamID64()}.`);
    // Tell Steam the account is playing Counter-Strike 2; globaloffensive then opens the session with the coordinator
    // by itself. A new sign-in forgets this, so it is said again after every one.
    client.gamesPlayed([CS2_APP_ID]);
  });

  client.on('disconnected', (eresult) => {
    lost('the connection to Steam was lost');
    if (!stopped) {
      log.warn(`Disconnected from Steam (${SteamUser.EResult[eresult] || eresult}); the library signs in again by itself.`);
    }
  });

  client.on('error', (error) => {
    lost('the sign-in to Steam ended');
    if (stopped) {
      return;
    }
    const result = SteamUser.EResult[error.eresult];
    if (SLOW.has(error.eresult)) {
      log.warn(`Steam is rate-limiting the sign-in (${result}); the next attempt is in ${RETRY_SLOW_MS / 3600000} hour.`);
      // A restart must keep this wait too.
      hold(RETRY_SLOW_MS);
      scheduleRetry(RETRY_SLOW_MS);
      return;
    }
    if (error.eresult === undefined || TRANSIENT.has(error.eresult)) {
      log.warn(`The sign-in ended: ${describeError(error, SteamUser.EResult)}.`);
      scheduleRetry();
      return;
    }
    log.error(`Steam ended the sign-in with ${describeError(error, SteamUser.EResult)}. The bridge does not try again by `
      + 'itself: fix the cause (the account, its password or token, the settings) and restart the bridge.');
  });

  // Only the account name and password need this: Steam asks for a code with this event. Without a listener
  // steam-user would ask on the terminal and wait for ever.
  client.on('steamGuard', (domain, callback, lastCodeWrong) => {
    if (domain || !account.sharedSecret) {
      log.error(domain
        ? 'Steam wants a code that it sent by e-mail, which the bridge cannot give. Sign in once with "node src/login.js" and use the refresh token it prints.'
        : 'Steam wants a two-factor code and the bridge has no STEAM_BOT_SHARED_SECRET to make it from.');
      return;
    }
    if (lastCodeWrong) {
      wrongCodes += 1;
      if (wrongCodes >= MAX_WRONG_CODES) {
        log.error(`Steam refused the two-factor code ${wrongCodes} times. Check STEAM_BOT_SHARED_SECRET and the clock of this machine.`);
        return;
      }
      log.warn(`Steam refused the two-factor code; the next one is made in ${WRONG_CODE_WAIT_MS / 1000} s.`);
      setTimeout(() => twoFactorCode(account.sharedSecret, log).then(callback), WRONG_CODE_WAIT_MS);
      return;
    }
    twoFactorCode(account.sharedSecret, log).then(callback);
  });

  // The account is playing a game in another session: Steam allows one game at a time, so the bridge cannot play
  // Counter-Strike 2 until that stops. When it does, the bridge says again that it is playing.
  client.on('playingState', (isBlocked, playingApp) => {
    if (isBlocked && !blocked) {
      log.warn(`This account is playing app ${playingApp} in another session, so the bridge cannot use the game coordinator `
        + 'until that stops. The bridge should have an account of its own.');
    } else if (!isBlocked && blocked) {
      log.info('The other session stopped playing.');
      client.gamesPlayed([CS2_APP_ID]);
    }
    blocked = isBlocked;
    watchCoordinator();
  });

  csgo.on('connectedToGC', () => {
    state.gc = true;
    watchCoordinator();
    log.info('The session with the game coordinator is open.');
  });

  csgo.on('disconnectedFromGC', (reason) => {
    state.gc = false;
    watchCoordinator();
    failPending(unavailable('the session with the game coordinator was lost'));
    if (!stopped) {
      log.warn(`The session with the game coordinator was lost (reason ${reason}); globaloffensive opens it again by itself.`);
    }
  });

  // Fatal for the session (for example the coordinator refuses the account). Without a listener the process would end.
  csgo.on('error', (error) => {
    state.gc = false;
    watchCoordinator();
    failPending(unavailable('the game coordinator refused the account'));
    log.error(`The game coordinator refused the account: ${describeError(error)}.`);
  });

  // The answer to requestGame. The event can come at other times too, and a list has no id of the request it answers, so:
  // - a list that names the match asked for is the answer;
  // - a non-empty list of other matches is ignored;
  // - an empty list means "no such match" - except for LATE_ANSWER_WINDOW_MS after a request timed out, when it may well
  //   be the late answer to that request. It is then never taken for the answer of the request that waits (that would be
  //   a final 404 for a match that was never asked about): that request is refused at once with 503, which the caller may
  //   ask again, and when no request waits the list is ignored. A refusal is not a timeout and does not extend the
  //   window, so nothing chains on beyond one window after the last real timeout.
  csgo.on('matchList', (matches) => {
    const request = pending;
    const list = Array.isArray(matches) ? matches : [];
    if (!request) {
      return;
    }
    const info = list.find((candidate) => sameMatch(candidate.matchid, request.matchId));
    if (!info && list.length > 0) {
      log.warn(`A match list of ${list.length} matches arrived, none of them the one asked for; waiting for the answer.`);
      return;
    }
    if (!info && lastTimeoutAt !== null && Date.now() - lastTimeoutAt < LATE_ANSWER_WINDOW_MS) {
      log.warn('An empty match list arrived soon after a request had timed out; it may be the late answer to that one, '
        + 'so it is not taken for "no such match" and the request is refused with 503.');
      failPending(unavailable('an empty answer soon after a timeout cannot be told from a late one'));
      return;
    }

    pending = null;
    clearTimeout(request.timer);
    if (!info) {
      request.resolve({ kind: 'unknown' });
      return;
    }
    const outcome = toOutcome(info);
    if (outcome.matchTime === null) {
      log.warn('The coordinator knows the match but its answer has no match time.');
      request.reject(unavailable('the answer of the coordinator has no match time'));
      return;
    }
    request.resolve(outcome);
  });

  return {
    health: () => ({ steam: state.steam, gc: ready() }),

    // Refuses at the door what cannot be answered: a string that is not a sharing code (400), and a bridge that is not
    // in the game (503).
    admit(shareCode) {
      if (!decode(shareCode)) {
        throw badRequest('not a sharing code');
      }
      if (!ready()) {
        throw unavailable('Steam or the game coordinator is not ready');
      }
    },

    // Asks the coordinator about one match. The queue lets only one call at a time through, so there is never more
    // than one request waiting for the match list.
    lookup(shareCode) {
      const details = decode(shareCode);
      if (!details) {
        return Promise.reject(badRequest('not a sharing code'));
      }
      if (!ready()) {
        return Promise.reject(unavailable('Steam or the game coordinator is not ready'));
      }
      return new Promise((resolve, reject) => {
        const request = { matchId: details.matchId, resolve, reject, timer: null };
        request.timer = setTimeout(() => {
          if (pending === request) {
            pending = null;
          }
          // Its answer may still come: see the match list handler.
          lastTimeoutAt = Date.now();
          reject(unavailable('the game coordinator did not answer in time'));
        }, requestTimeoutMs);
        pending = request;
        try {
          csgo.requestGame(details);
        } catch (error) {
          pending = null;
          clearTimeout(request.timer);
          reject(unavailable(`the request could not be sent: ${describeError(error)}`));
        }
      });
    },

    // Signs in, after a wait when the bridge was started again soon after a sign-in, or when an earlier run asked for a
    // pause (see attempts.js).
    start() {
      const now = Date.now();
      const sinceAttempts = waitBeforeSignIn(readAttempts(dataDir), now);
      const sinceHold = Math.max(0, readHold(dataDir, now) - now);
      // Never more than the cap, so the timer cannot overflow whatever the files say.
      const wait = Math.min(Math.max(sinceAttempts, sinceHold), HOLD_CAP_MS);
      if (wait <= 0) {
        return signIn();
      }
      log.warn(`${sinceHold >= sinceAttempts
        ? 'An earlier run asked for a pause before the next sign-in (Steam was rate-limiting it, or the game coordinator stayed unavailable)'
        : 'The last sign-in attempt was recent'}; waiting ${Math.ceil(wait / 1000)} s before signing in again, `
        + 'so that a bridge that is restarted over and over does not sign in over and over.');
      retryTimer = setTimeout(() => {
        retryTimer = null;
        signIn();
      }, wait);
      return Promise.resolve();
    },

    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      retryTimer = null;
      failPending(unavailable('the bridge is shutting down'));
      client.logOff();
    },
  };
}

module.exports = { createSteamCoordinator };
