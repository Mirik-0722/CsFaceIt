'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'signin-attempts.json';

// A process that dies at start and is started again by the restart policy would sign in to Steam every few seconds,
// which is what gets an account or an address blocked. So the times of the last sign-in attempts are kept in the data
// directory, and a bridge that finds a recent one waits before it signs in: a minute after the last attempt, and ten
// minutes when three attempts fall inside the last ten minutes. Only times are kept, nothing secret.
const MIN_GAP_MS = 60 * 1000;
const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_SIZE = 3;
const KEPT = 10;

function fileOf(dir) {
  return path.join(dir, FILE_NAME);
}

// The times (milliseconds since 1970) of the attempts, oldest first; an empty list when there is no usable file.
function readAttempts(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((time) => Number.isFinite(time)).sort((a, b) => a - b) : [];
  } catch {
    return [];
  }
}

// Adds one attempt. Returns false when the file could not be written (the guard is then without memory, which is no
// reason to stop).
function recordAttempt(dir, now = Date.now()) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const times = [...readAttempts(dir), now].slice(-KEPT);
    fs.writeFileSync(fileOf(dir), JSON.stringify(times));
    return true;
  } catch {
    return false;
  }
}

// How long to wait before the next sign-in, given the times of the earlier attempts.
function waitBeforeSignIn(attempts, now = Date.now()) {
  const recent = attempts.filter((time) => time <= now && now - time < BURST_WINDOW_MS);
  if (recent.length === 0) {
    return 0;
  }
  const last = recent[recent.length - 1];
  const gap = recent.length >= BURST_SIZE ? BURST_WINDOW_MS : MIN_GAP_MS;
  return Math.max(0, last + gap - now);
}

module.exports = { readAttempts, recordAttempt, waitBeforeSignIn };
