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

// Some waits must outlive the process: Steam rate-limited the sign-in (no attempt for an hour), or the previous run ended
// because the game coordinator stayed unavailable (no attempt for 30 minutes). The time before which no sign-in is to be
// made is kept in a second small file; a start finds it and waits. A hold is never longer than HOLD_CAP_MS from now:
// one written under a clock that ran ahead would otherwise keep the bridge from signing in for days (and a wait of more
// than about 24.8 days overflows setTimeout, which then fires at once). A stored hold that is further ahead than the cap
// counts as the cap.
const HOLD_FILE_NAME = 'signin-not-before.json';
const HOLD_CAP_MS = 60 * 60 * 1000;

function readStoredHold(dir) {
  try {
    const time = JSON.parse(fs.readFileSync(path.join(dir, HOLD_FILE_NAME), 'utf8'));
    return Number.isFinite(time) ? time : 0;
  } catch {
    return 0;
  }
}

// The time before which not to sign in, at most HOLD_CAP_MS after now; 0 when there is none.
function readHold(dir, now = Date.now()) {
  return Math.min(readStoredHold(dir), now + HOLD_CAP_MS);
}

// No sign-in before `time` (at most HOLD_CAP_MS from now). The stored hold is replaced by the new one; the later of the
// two is kept only when both are within the cap, so that a far-future value written by a wrong clock never survives.
// False when the file could not be written.
function holdSignInUntil(dir, time, now = Date.now()) {
  try {
    const limit = now + HOLD_CAP_MS;
    const stored = readStoredHold(dir);
    const next = Math.min(time, limit);
    const kept = stored > now && stored <= limit ? Math.max(stored, next) : next;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, HOLD_FILE_NAME), JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}

module.exports = { HOLD_CAP_MS, readAttempts, recordAttempt, waitBeforeSignIn, readHold, holdSignInUntil };
