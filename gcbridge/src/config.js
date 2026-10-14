'use strict';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8090;
const DEFAULT_DATA_DIR = '/data';
// Made up: it points at no real file, only has the shape of a replay address of Valve.
const DEFAULT_FAKE_REPLAY_URL = 'http://replay000.valve.net/730/000000000000000000_0000000000.dem.bz2';
const DEFAULT_FAKE_DELAY_MS = 300;

class ConfigError extends Error {}

const ON = ['1', 'true', 'yes', 'on'];
const OFF = ['', '0', 'false', 'no', 'off'];

// A setting that is not set, or is only blank, counts as not set: Compose passes an unset variable on as an empty one.
function readText(env, name) {
  const value = env[name];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function readTrimmed(env, name) {
  const value = readText(env, name);
  return value === undefined ? undefined : value.trim();
}

function readFlag(env, name, problems) {
  const raw = (env[name] === undefined ? '' : String(env[name])).trim().toLowerCase();
  if (ON.includes(raw)) {
    return true;
  }
  if (!OFF.includes(raw)) {
    problems.push(`${name} must be 1 or 0.`);
  }
  return false;
}

function readInteger(env, name, fallback, min, max, problems) {
  const raw = readTrimmed(env, name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} must be a whole number from ${min} to ${max}.`);
    return fallback;
  }
  return value;
}

// What can be known about a refresh token without asking Steam: it is a JWT, and steam-user refuses one that was not
// issued by Steam for the Steam client. It refuses by throwing inside a timer callback, which ends the process with a
// stack trace; checking here turns that into a message that names the setting, before anything touches the network.
// The token is never put into a message.
function inspectRefreshToken(token) {
  const parts = token.split('.');
  let payload;
  try {
    payload = parts.length === 3 ? JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) : null;
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== 'object') {
    throw new ConfigError('STEAM_BOT_REFRESH_TOKEN is not a token. Run "node src/login.js" to get one.');
  }
  if (payload.iss !== 'steam' || !Array.isArray(payload.aud) || !payload.aud.includes('client')) {
    throw new ConfigError(
      'STEAM_BOT_REFRESH_TOKEN is not a refresh token of Steam for the Steam client. Run "node src/login.js" to get one.');
  }
  if (typeof payload.exp !== 'number') {
    return { expiresAt: null };
  }
  const expiresAt = new Date(payload.exp * 1000);
  if (expiresAt.getTime() <= Date.now()) {
    throw new ConfigError(`STEAM_BOT_REFRESH_TOKEN expired on ${expiresAt.toISOString()}. Run "node src/login.js" for a new one.`);
  }
  return { expiresAt };
}

function readSteamAccount(env, problems) {
  const refreshToken = readTrimmed(env, 'STEAM_BOT_REFRESH_TOKEN');
  if (refreshToken !== undefined) {
    try {
      return { refreshToken, refreshTokenExpiresAt: inspectRefreshToken(refreshToken).expiresAt };
    } catch (error) {
      if (!(error instanceof ConfigError)) {
        throw error;
      }
      problems.push(error.message);
      return null;
    }
  }

  const username = readTrimmed(env, 'STEAM_BOT_USERNAME');
  const password = readText(env, 'STEAM_BOT_PASSWORD');
  const sharedSecret = readTrimmed(env, 'STEAM_BOT_SHARED_SECRET');
  const missing = [
    ['STEAM_BOT_USERNAME', username],
    ['STEAM_BOT_PASSWORD', password],
    ['STEAM_BOT_SHARED_SECRET', sharedSecret],
  ].filter(([, value]) => value === undefined).map(([name]) => name);
  if (missing.length > 0) {
    problems.push(
      'There is no Steam account to sign in with. Set STEAM_BOT_REFRESH_TOKEN (preferred; "node src/login.js" makes one), '
      + `or all of STEAM_BOT_USERNAME, STEAM_BOT_PASSWORD and STEAM_BOT_SHARED_SECRET. Not set: ${missing.join(', ')}. `
      + 'To run without Steam at all, set BRIDGE_FAKE=1.');
    return null;
  }
  return { username, password, sharedSecret };
}

// Reads the settings from the environment and refuses to go on when they cannot work: every problem is named, all at
// once, so that one restart fixes them all.
function loadConfig(env) {
  const problems = [];

  const bridgeToken = readTrimmed(env, 'BRIDGE_TOKEN');
  if (bridgeToken === undefined) {
    problems.push('BRIDGE_TOKEN is not set. The bridge refuses to start without it: callers send it as X-Bridge-Token.');
  }

  const host = readTrimmed(env, 'BRIDGE_HOST') || DEFAULT_HOST;
  const port = readInteger(env, 'PORT', DEFAULT_PORT, 1, 65535, problems);
  const dataDir = readTrimmed(env, 'BRIDGE_DATA_DIR') || DEFAULT_DATA_DIR;

  const fakeEnabled = readFlag(env, 'BRIDGE_FAKE', problems);
  const fake = { enabled: fakeEnabled, replayUrl: DEFAULT_FAKE_REPLAY_URL, delayMs: DEFAULT_FAKE_DELAY_MS };
  let steam = null;
  if (fakeEnabled) {
    // The settings of the fake mode are looked at only when it is on.
    // The address may hold {matchId}, which each answer replaces by the id of its match (see fake.js).
    fake.replayUrl = readTrimmed(env, 'BRIDGE_FAKE_REPLAY_URL') || DEFAULT_FAKE_REPLAY_URL;
    fake.delayMs = readInteger(env, 'BRIDGE_FAKE_DELAY_MS', DEFAULT_FAKE_DELAY_MS, 0, 60000, problems);
    try {
      const url = new URL(fake.replayUrl.split('{matchId}').join('0'));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('not http');
      }
    } catch {
      problems.push('BRIDGE_FAKE_REPLAY_URL must be an http or https address.');
    }
  } else {
    steam = readSteamAccount(env, problems);
  }

  if (problems.length > 0) {
    throw new ConfigError(`gcbridge cannot start:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
  }

  return {
    bridgeToken,
    host,
    port,
    dataDir,
    fake,
    steam,
    // Everything that must never reach a log: the credentials of the account, the token of the callers.
    secrets: [bridgeToken, steam && steam.refreshToken, steam && steam.username, steam && steam.password,
      steam && steam.sharedSecret].filter((secret) => typeof secret === 'string'),
  };
}

module.exports = { ConfigError, loadConfig };
