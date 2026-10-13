'use strict';

const crypto = require('node:crypto');

const { busy, unavailable } = require('./errors');
const { decode } = require('./sharecode');

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The match id of a code that does not decode to anything real: a number of the size of a match id taken from the
// hash of the code, so that the same code always gets the same id.
function idFromHash(code) {
  const digest = crypto.createHash('sha256').update(code).digest();
  return digest.readBigUInt64BE(0).toString();
}

// The coordinator of the fake mode (BRIDGE_FAKE=1). It never touches Steam. The last group of the sharing code chooses
// the answer, so that every answer of the interface can be asked for by name:
//   READY  a match with a replay address       NOTYT  a match from 30 minutes ago without one
//   GONE5  a match from 30 days ago without one   UNKWN  no such match
//   BUSY5  the queue is full                   DOWN5  Steam or the coordinator is not ready
// and any other code answers like READY. The answers go through the same queue as the real ones, and each takes
// delayMs, which is what makes the queue visible.
function createFakeCoordinator({ replayUrl, delayMs }) {
  const lastGroup = (shareCode) => shareCode.slice(-5);

  return {
    health: () => ({ steam: true, gc: true }),

    // BUSY5 and DOWN5 are refused at the door, as the real mode refuses a full queue and an unready coordinator.
    admit(shareCode) {
      if (lastGroup(shareCode) === 'BUSY5') {
        throw busy();
      }
      if (lastGroup(shareCode) === 'DOWN5') {
        throw unavailable('the fake coordinator is down (the code ends in DOWN5)');
      }
    },

    async lookup(shareCode) {
      await sleep(delayMs);

      const group = lastGroup(shareCode);
      if (group === 'UNKWN') {
        return { kind: 'unknown' };
      }

      const decoded = decode(shareCode);
      const matchId = decoded ? decoded.matchId : idFromHash(shareCode);
      const now = Date.now();
      if (group === 'NOTYT') {
        return { kind: 'match', matchId, matchTime: new Date(now - 30 * MINUTE_MS), replayUrl: null };
      }
      if (group === 'GONE5') {
        return { kind: 'match', matchId, matchTime: new Date(now - 30 * DAY_MS), replayUrl: null };
      }
      return { kind: 'match', matchId, matchTime: new Date(now - 30 * MINUTE_MS), replayUrl };
    },

    stop() {},
  };
}

module.exports = { createFakeCoordinator };
