'use strict';

// Index of our own MockChog mints (contracts/deployments.json, committed, no secrets).
// Gives getTokenHistory an exact, 3-call fast path: our mint tx is ground truth
// for the mint block, so no log scanning is needed while the minter still holds
// the token. scripts/deploy-mock-chog.js appends new mints automatically.

const fs = require('fs');
const path = require('path');

const RECORD_PATH = path.join(__dirname, '..', 'contracts', 'deployments.json');

let cache = null;

function loadDeployments() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(RECORD_PATH, 'utf8'));
  } catch {
    cache = { tokens: {} };
  }
  return cache;
}

function _resetCache() {
  cache = null;
}

function getMintRecord(contractAddress, tokenId) {
  const d = loadDeployments();
  if (!d || !d.contract) return null;
  if (String(d.contract).toLowerCase() !== String(contractAddress).toLowerCase()) return null;
  return (d.tokens || {})[String(tokenId)] || null;
}

module.exports = { loadDeployments, getMintRecord, _resetCache };
