'use strict';

// An error that has a ready answer for the caller: the HTTP status and the code of the JSON body. Anything else that is
// thrown while a request is handled is a bug of ours and becomes a plain 500.
class BridgeError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.code = code;
  }
}

// The caller sent something that cannot be a sharing code.
const badRequest = (message) => new BridgeError(400, 'BAD_REQUEST', message);

// Steam or the game coordinator is not ready, or did not answer in time. The caller should ask again later.
const unavailable = (message) => new BridgeError(503, 'GC_UNAVAILABLE', message);

// The queue of waiting requests is full.
const busy = () => new BridgeError(429, 'BUSY', 'too many requests are waiting');

module.exports = { BridgeError, badRequest, unavailable, busy };
