'use strict';

// Valve publishes the file of a match some minutes after the match, and keeps it for a limited time. A match without
// a replay address that ended less than this long ago is therefore "not yet", and an older one is "gone".
const REPLAY_PUBLISH_WINDOW_MS = 2 * 60 * 60 * 1000;

// What the coordinator said about a match, in the two shapes both modes produce:
//   { kind: 'unknown' }                                            the coordinator knows no such match
//   { kind: 'match', matchId, matchTime: Date, replayUrl: string|null }
// as the answer of the HTTP interface: { status, body }.
function toAnswer(outcome, now = Date.now()) {
  if (outcome.kind === 'unknown') {
    return { status: 404, body: { code: 'MATCH_UNKNOWN' } };
  }

  const matchTime = outcome.matchTime.toISOString();
  if (outcome.replayUrl) {
    return { status: 200, body: { matchId: outcome.matchId, replayUrl: outcome.replayUrl, matchTime } };
  }
  const recent = now - outcome.matchTime.getTime() < REPLAY_PUBLISH_WINDOW_MS;
  return recent
    ? { status: 409, body: { code: 'REPLAY_NOT_READY', matchTime } }
    : { status: 410, body: { code: 'REPLAY_EXPIRED', matchTime } };
}

module.exports = { toAnswer };
