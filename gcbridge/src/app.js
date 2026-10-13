'use strict';

const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const { toAnswer } = require('./answer');
const { BridgeError, badRequest } = require('./errors');
const { isWellFormed, shortCode } = require('./sharecode');

// A valid body is under a hundred bytes. Anything much larger is not from the backend.
const MAX_BODY_BYTES = 2048;

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

// The body of the request as parsed JSON. Rejects with BAD_REQUEST when it is too large (and then marks the error, so
// that the connection can be closed instead of reading the rest) or when it is not JSON.
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on('error', () => reject(badRequest('the body could not be read')));
    req.on('end', () => {
      if (tooLarge) {
        const error = badRequest('the body is too large');
        error.closeConnection = true;
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(badRequest('the body is not JSON'));
      }
    });
  });
}

// The request listener of the HTTP server. coordinator is the real or the fake one (health, admit, lookup) and queue
// the line that the calls to it wait in.
function createApp({ token, coordinator, queue, log }) {
  // Both sides are hashed first so that the comparison takes the same time whatever the length of what was sent, and
  // timingSafeEqual (which wants equal lengths) can be used.
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  const expected = digest(token);
  const tokenMatches = (sent) => typeof sent === 'string' && crypto.timingSafeEqual(digest(sent), expected);

  async function resolve(req, res, request) {
    if (!tokenMatches(req.headers['x-bridge-token'])) {
      send(res, 401, { code: 'UNAUTHORIZED' });
      return;
    }

    const body = await readJson(req);
    const shareCode = body !== null && typeof body === 'object' ? body.shareCode : undefined;
    if (!isWellFormed(shareCode)) {
      throw badRequest('shareCode is missing or is not a sharing code');
    }
    request.code = shortCode(shareCode);

    coordinator.admit(shareCode);
    const outcome = await queue.submit(() => coordinator.lookup(shareCode));
    const answer = toAnswer(outcome);
    send(res, answer.status, answer.body);
  }

  return function handle(req, res) {
    const path = (req.url || '').split('?', 1)[0];

    if (req.method === 'GET' && path === '/health') {
      const health = coordinator.health();
      send(res, health.steam && health.gc ? 200 : 503, { steam: health.steam, gc: health.gc });
      return;
    }
    if (req.method !== 'POST' || path !== '/resolve') {
      send(res, 404, { code: 'NOT_FOUND' });
      return;
    }

    // One line per request: the status, how long it took and the beginning of the code. Not the token, not the body.
    const started = performance.now();
    const request = { code: null };
    res.on('finish', () => {
      const ms = Math.round(performance.now() - started);
      log.info(`POST /resolve ${res.statusCode} in ${ms} ms${request.code ? ` (${request.code})` : ''}`);
    });

    resolve(req, res, request).catch((error) => {
      if (res.headersSent) {
        return;
      }
      if (error instanceof BridgeError) {
        if (error.closeConnection) {
          res.setHeader('Connection', 'close');
        }
        send(res, error.status, { code: error.code });
        return;
      }
      // A bug of ours. What the error says is not passed on to the caller.
      log.error(`POST /resolve failed unexpectedly: ${error && error.stack ? error.stack : error}`);
      send(res, 500, { code: 'INTERNAL_ERROR' });
    });
  };
}

module.exports = { createApp };
