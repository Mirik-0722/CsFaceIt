'use strict';

const { performance } = require('node:perf_hooks');

const { busy } = require('./errors');

// The game coordinator is asked one request at a time, and no two requests closer together than minGapMs, because it
// answers a client that asks too fast by not answering, and Valve can ban an account that keeps doing it. At most
// maxWaiting requests wait for their turn (the one that is being served does not count); the next one is refused at
// once with BUSY instead of waiting for minutes.
function createQueue({ minGapMs, maxWaiting }) {
  const waiting = [];
  let running = false;
  let lastStart = -Infinity;
  let timer = null;

  function pump() {
    if (running || timer !== null || waiting.length === 0) {
      return;
    }
    const wait = lastStart + minGapMs - performance.now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        pump();
      }, wait);
      return;
    }

    const item = waiting.shift();
    running = true;
    // The task is started here and now, and the gap is counted from the moment it has started, which is at the latest
    // the moment it sent its request: the next request can then never be closer than minGapMs to this one. (A timer may
    // fire up to a millisecond early; that is why pump looks at the clock again instead of trusting the timer.)
    let result;
    try {
      result = Promise.resolve(item.task());
    } catch (error) {
      result = Promise.reject(error);
    }
    lastStart = performance.now();
    result.then(item.resolve, item.reject).finally(() => {
      running = false;
      pump();
    });
  }

  // Runs task when it is its turn and returns what it returns. Rejects with BUSY when the queue is full.
  function submit(task) {
    return new Promise((resolve, reject) => {
      if (waiting.length >= maxWaiting) {
        reject(busy());
        return;
      }
      waiting.push({ task, resolve, reject });
      pump();
    });
  }

  return { submit, size: () => waiting.length + (running ? 1 : 0) };
}

module.exports = { createQueue };
