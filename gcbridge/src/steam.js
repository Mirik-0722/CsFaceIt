'use strict';

const GlobalOffensive = require('globaloffensive');
const SteamTotp = require('steam-totp');
const SteamUser = require('steam-user');

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

// The results with which Steam ends a sign-in for good: trying again would not change the answer, and trying again
// and again could get the account or the address blocked. The bridge stays up and says so in /health and in its log;
// someone has to fix the account or the settings and start it again. (LoggedInElsewhere and LogonSessionReplaced mean
// that somebody else signed in with this account: signing in again would only throw them out in turn.)
const NO_RETRY = new Set([
  'InvalidPassword', 'AccountNotFound', 'AccountDisabled', 'AccessDenied', 'Expired', 'Revoked', 'Banned', 'IPBanned',
  'InvalidLoginAuthCode', 'LoggedInElsewhere', 'LogonSessionReplaced',
].map((name) => SteamUser.EResult[name]).filter((result) => result !== undefined));

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
// account is { refreshToken } or { username, password, sharedSecret }. requestTimeoutMs is a parameter only so that it
// can be shortened when this is tried against fake libraries.
function createSteamCoordinator({ account, dataDir, log, requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
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

  const ready = () => state.steam && state.gc;

  function failPending(error) {
    if (pending) {
      const request = pending;
      pending = null;
      clearTimeout(request.timer);
      request.reject(error);
    }
  }

  function lost(reason) {
    state.steam = false;
    state.gc = false;
    failPending(unavailable(reason));
  }

  function scheduleRetry() {
    if (stopped || retryTimer) {
      return;
    }
    const seconds = Math.round(retryDelayMs / 1000);
    log.warn(`Signing in again in ${seconds} s.`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      signIn();
    }, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
  }

  async function signIn() {
    if (stopped) {
      return;
    }
    try {
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
    if (NO_RETRY.has(error.eresult)) {
      log.error(`Steam refused the account: ${describeError(error, SteamUser.EResult)}. The bridge does not try again `
        + 'by itself: fix the account or the settings and start it again.');
      return;
    }
    log.warn(`The sign-in ended: ${describeError(error, SteamUser.EResult)}.`);
    scheduleRetry();
  });

  // Only the account name and password need this: Steam asks for a code with this event. Without a listener
  // steam-user would ask on the terminal and wait for ever.
  client.on('steamGuard', (domain, callback, lastCodeWrong) => {
    if (domain || !account.sharedSecret) {
      log.error(domain
        ? `Steam wants a code that it sent by e-mail (to ${domain}), which the bridge cannot give. Sign in once with "node src/login.js" and use the refresh token it prints.`
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
  });

  csgo.on('connectedToGC', () => {
    state.gc = true;
    log.info('The session with the game coordinator is open.');
  });

  csgo.on('disconnectedFromGC', (reason) => {
    state.gc = false;
    failPending(unavailable('the session with the game coordinator was lost'));
    if (!stopped) {
      log.warn(`The session with the game coordinator was lost (reason ${reason}); globaloffensive opens it again by itself.`);
    }
  });

  // Fatal for the session (for example the coordinator refuses the account). Without a listener the process would end.
  csgo.on('error', (error) => {
    state.gc = false;
    failPending(unavailable('the game coordinator refused the account'));
    log.error(`The game coordinator refused the account: ${describeError(error)}.`);
  });

  // The answer to requestGame. The event can come at other times too, so it is taken for the answer only when it names
  // the match that was asked for, or when it is empty (the coordinator knows no such match).
  csgo.on('matchList', (matches) => {
    const request = pending;
    if (!request) {
      return;
    }
    const list = Array.isArray(matches) ? matches : [];
    const info = list.find((candidate) => sameMatch(candidate.matchid, request.matchId));
    if (!info && list.length > 0) {
      log.warn(`A match list of ${list.length} matches arrived, none of them the one asked for; waiting for the answer.`);
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

    start() {
      return signIn();
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
