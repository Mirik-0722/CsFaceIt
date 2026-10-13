'use strict';

const { ShareCode } = require('globaloffensive-sharecode');

// What a caller may send: CSGO and five groups of five letters and digits. Not every such string is a sharing code
// (the alphabet of a real one is smaller, see decode), but nothing else may even be tried.
const PATTERN = /^CSGO(-[A-Za-z0-9]{5}){5}$/;

function isWellFormed(code) {
  return typeof code === 'string' && PATTERN.test(code);
}

// The part of a code that is safe to put in a log. A sharing code is enough to ask for the match, so it is not logged
// whole.
function shortCode(code) {
  return `${String(code).slice(0, 9)}...`;
}

// Decodes a sharing code with the decoder of the globaloffensive package (the very one its requestGame uses, so that
// what is asked for is what is decoded here). Returns { matchId, outcomeId, token } with the numbers as decimal
// strings, or null when the string is not a sharing code. The decoder does not refuse a character that is outside the
// alphabet of sharing codes, it decodes it into garbage; that check is made here with the decoder's own alphabet.
function decode(code) {
  if (!isWellFormed(code)) {
    return null;
  }
  const decoder = new ShareCode(code);
  const groups = code.slice('CSGO-'.length).replace(/-/g, '');
  if (![...groups].every((character) => decoder.DICTIONARY.includes(character))) {
    return null;
  }
  const decoded = decoder.decode();
  return decoded || null;
}

module.exports = { isWellFormed, shortCode, decode };
