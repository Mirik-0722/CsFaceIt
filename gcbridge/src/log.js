'use strict';

// Anything shorter than this is not cut out of a line: a secret of one or two characters would mangle every message
// and is not a secret worth the name anyway.
const MIN_SECRET_LENGTH = 6;

// A logger that cannot leak what it was told is secret. The code never passes a secret to it on purpose; this is the
// second wall, for the case that an error message of a library or a future edit carries one along. Every secret is cut
// out of every line before it is written.
function createLogger({ secrets = [], stdout = process.stdout, stderr = process.stderr } = {}) {
  const hidden = secrets.filter((secret) => typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH);

  function write(stream, level, message) {
    let line = `${new Date().toISOString()} ${level} ${message}`;
    for (const secret of hidden) {
      line = line.split(secret).join('[hidden]');
    }
    stream.write(`${line}\n`);
  }

  return {
    info: (message) => write(stdout, 'INFO ', message),
    warn: (message) => write(stderr, 'WARN ', message),
    error: (message) => write(stderr, 'ERROR', message),
  };
}

// What may be said about an error of a library: its message, and the name of the Steam result when it has one. Never
// the error object itself, which can carry request details.
function describeError(error, resultNames) {
  if (!error) {
    return 'unknown error';
  }
  const result = resultNames && error.eresult !== undefined ? resultNames[error.eresult] : undefined;
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : String(error);
  return result && result !== message ? `${message} (${result})` : message;
}

module.exports = { createLogger, describeError };
