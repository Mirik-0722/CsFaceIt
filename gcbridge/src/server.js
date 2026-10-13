'use strict';

const fs = require('node:fs');
const http = require('node:http');

const { createApp } = require('./app');
const { ConfigError, loadConfig } = require('./config');
const { createFakeCoordinator } = require('./fake');
const { createLogger } = require('./log');
const { createQueue } = require('./queue');

// The queue in front of the coordinator, see queue.js.
const MIN_GAP_BETWEEN_REQUESTS_MS = 1100;
const MAX_WAITING_REQUESTS = 20;

// A request has to arrive within this long. (How long an answer takes is another matter: a request can wait in the
// queue for a long time.)
const RECEIVE_TIMEOUT_MS = 15 * 1000;
const SHUTDOWN_GRACE_MS = 5 * 1000;

// A request so broken that it is not HTTP at all gets the same kind of answer as every other one.
function answerBrokenRequest(error, socket) {
  if (socket.writable) {
    const body = JSON.stringify({ code: 'BAD_REQUEST' });
    socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n`
      + `Connection: close\r\n\r\n${body}`);
  } else {
    socket.destroy();
  }
}

function prepareDataDir(dir, log) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (error) {
    log.warn(`The data directory ${dir} cannot be written to (${error.code}). The Steam library will keep nothing `
      + 'between restarts, which it can do without.');
  }
}

function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      throw error;
    }
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }

  const log = createLogger({ secrets: config.secrets });

  let coordinator;
  if (config.fake.enabled) {
    coordinator = createFakeCoordinator({ replayUrl: config.fake.replayUrl, delayMs: config.fake.delayMs });
  } else {
    // Loaded only here: the fake mode must not even load the libraries of Steam.
    const { createSteamCoordinator } = require('./steam');
    prepareDataDir(config.dataDir, log);
    // onFatal: the coordinator never came back after a fatal error. Ending with a failure is what makes the restart policy
    // of the container start the bridge again (attempts.js keeps that from signing in in a loop).
    coordinator = createSteamCoordinator({
      account: config.steam,
      dataDir: config.dataDir,
      log,
      onFatal: () => {
        coordinator.stop();
        setTimeout(() => process.exit(1), 1000);
      },
    });
  }

  const queue = createQueue({ minGapMs: MIN_GAP_BETWEEN_REQUESTS_MS, maxWaiting: MAX_WAITING_REQUESTS });
  const server = http.createServer(createApp({ token: config.bridgeToken, coordinator, queue, log }));
  server.requestTimeout = RECEIVE_TIMEOUT_MS;
  server.headersTimeout = RECEIVE_TIMEOUT_MS;
  server.on('clientError', answerBrokenRequest);
  server.on('error', (error) => {
    log.error(`The HTTP server failed: ${error.message}`);
    process.exit(1);
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log.info(`${signal} received, shutting down.`);
    coordinator.stop();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Something that nobody expected. The service is started again by its restart policy rather than left half-working.
  const fatal = (error) => {
    log.error(`Unexpected error, stopping: ${error && error.stack ? error.stack : error}`);
    process.exit(1);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);

  server.listen(config.port, config.host, () => {
    if (config.fake.enabled) {
      log.info(`Listening on ${config.host}:${config.port} in the fake mode: there is no connection to Steam, and the `
        + 'last group of a sharing code chooses the answer.');
      return;
    }
    log.info(`Listening on ${config.host}:${config.port} in the real mode.`);
    if (config.steam.refreshTokenExpiresAt) {
      log.info(`The refresh token is valid until ${config.steam.refreshTokenExpiresAt.toISOString()}.`);
    }
    coordinator.start();
  });
}

main();
