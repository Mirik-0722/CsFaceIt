'use strict';

// The sign-in helper: signs in to Steam once as a Steam client, with the account name, the password and the Steam Guard
// code that it asks for on the terminal, and prints the refresh token to put into STEAM_BOT_REFRESH_TOKEN. Nothing is
// written to disk and nothing else is logged. Run it as
//   docker compose -f docker-compose.yml -f docker-compose.cs2.yml run --rm gcbridge node src/login.js
// or, on a machine with Node, as "node src/login.js" in gcbridge/ (after npm ci).

const readline = require('node:readline');
const { Writable } = require('node:stream');

const { EAuthSessionGuardType, EAuthTokenPlatformType, LoginSession } = require('steam-session');

// Time to look at the Steam mobile app and approve the sign-in there.
const LOGIN_TIMEOUT_MS = 2 * 60 * 1000;

// Reads the terminal line by line. The questions go to stderr so that stdout holds nothing but the token, and the
// echo is switched off while the password is typed (readline writes the echo to a stream of ours, which drops it).
// The lines are queued, so that input that comes in all at once from a pipe is not lost between two questions.
function openTerminal() {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) {
        process.stderr.write(chunk);
      }
      callback();
    },
  });
  const reader = readline.createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });

  const lines = [];
  const waiting = [];
  reader.on('line', (line) => (waiting.length > 0 ? waiting.shift()(line) : lines.push(line)));
  reader.on('close', () => {
    while (waiting.length > 0) {
      waiting.shift()(null);
    }
  });

  return {
    async ask(question, { hidden = false } = {}) {
      process.stderr.write(question);
      muted = hidden;
      const line = lines.length > 0 ? lines.shift() : await new Promise((resolve) => waiting.push(resolve));
      muted = false;
      // Where the answer was not echoed (a password, or input from a pipe) the line is ended here.
      if (hidden || !process.stdin.isTTY) {
        process.stderr.write('\n');
      }
      if (line === null) {
        throw new Error('The input ended before all the questions were answered.');
      }
      return line;
    },
    close: () => reader.close(),
  };
}

async function signIn(terminal) {
  const accountName = (await terminal.ask('Steam account name: ')).trim();
  const password = await terminal.ask('Password (not shown): ', { hidden: true });
  if (accountName === '' || password === '') {
    throw new Error('The account name and the password are both needed.');
  }

  const session = new LoginSession(EAuthTokenPlatformType.SteamClient, { machineId: true });
  session.loginTimeout = LOGIN_TIMEOUT_MS;

  // Created before the session starts, so that an event that comes while a question is still open is not lost; the
  // catch keeps it from counting as unhandled until the answer is awaited below.
  const authenticated = new Promise((resolve, reject) => {
    session.on('authenticated', resolve);
    session.on('timeout', () => reject(new Error('Steam did not get the confirmation in time.')));
    session.on('error', reject);
  });
  authenticated.catch(() => {});

  try {
    const started = await session.startWithCredentials({ accountName, password });
    if (started.actionRequired) {
      const types = started.validActions.map((action) => action.type);
      const fromApp = types.includes(EAuthSessionGuardType.DeviceCode);
      const fromEmail = types.includes(EAuthSessionGuardType.EmailCode);
      const canConfirm = types.includes(EAuthSessionGuardType.DeviceConfirmation)
        || types.includes(EAuthSessionGuardType.EmailConfirmation);

      let code = '';
      if (fromApp || fromEmail) {
        const where = fromApp ? 'shown in the Steam mobile app' : 'that Steam sent by e-mail';
        const alternative = canConfirm ? ' (leave it empty to confirm the sign-in in the app instead)' : '';
        code = (await terminal.ask(`Steam Guard code ${where}${alternative}: `)).trim().toUpperCase();
      }
      if (code !== '') {
        await session.submitSteamGuardCode(code);
      } else if (canConfirm) {
        process.stderr.write('Confirm the sign-in in the Steam mobile app (or by the e-mail from Steam) now.\n');
      } else {
        throw new Error('Steam wants a Steam Guard code and none was given.');
      }
    }
    await authenticated;
    return session.refreshToken;
  } finally {
    session.cancelLoginAttempt();
  }
}

// Resolves when the text has been handed to the stream, so that the process can be ended without cutting it off.
const write = (stream, text) => new Promise((resolve) => stream.write(text, resolve));

async function main() {
  const terminal = openTerminal();
  let exitCode = 0;
  try {
    const refreshToken = await signIn(terminal);
    await write(process.stdout, `${refreshToken}\n`);
    await write(process.stderr, 'The line above is the refresh token: put it into the setting STEAM_BOT_REFRESH_TOKEN of the bridge.\n');
  } catch (error) {
    await write(process.stderr, `Sign-in failed: ${error.message}\n`);
    exitCode = 1;
  }
  terminal.close();
  // The connection to Steam may keep the process alive; there is nothing left to wait for.
  process.exit(exitCode);
}

main();
