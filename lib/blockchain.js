'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

const CHOG_CONTRACT_ADDRESS =
  process.env.CHOG_CONTRACT_ADDRESS || '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
const MONAD_RPC_URL = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';

// Minimal ERC-721 + Enumerable ABI
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

let provider = null;
let contract = null;

function getProvider() {
  if (!provider) provider = new ethers.JsonRpcProvider(MONAD_RPC_URL);
  return provider;
}

function getContract() {
  if (!contract) contract = new ethers.Contract(CHOG_CONTRACT_ADDRESS, ERC721_ABI, getProvider());
  return contract;
}

// Monad testnet caps eth_getLogs at a 100-block range, so full-chain scans
// (block 0 → latest) fail there. LOG_WINDOW_SIZE/MAX_WINDOWS bound the
// fallback scan used when the unlimited query is rejected.
const LOG_WINDOW_SIZE = 90;
const LOG_MAX_WINDOWS = 500;
const LOG_BATCH_SIZE = 25;

function isRangeLimitError(err) {
  const msg = (err && err.message ? err.message : String(err)).toLowerCase();
  return msg.includes('limited to') || msg.includes('block range') || msg.includes('exceeds') || msg.includes('too many blocks');
}

/**
 * Query a filter over recent history in small windows, newest first.
 * Returns { events (ascending), complete (true when block 0 was reached) }.
 */
async function boundedQueryFilter(contract, buildFilter) {
  const latest = await getProvider().getBlockNumber();
  const allEvents = [];
  let reachedGenesis = false;
  for (let w = 0; w < LOG_MAX_WINDOWS; w += LOG_BATCH_SIZE) {
    const jobs = [];
    for (let i = w; i < Math.min(w + LOG_BATCH_SIZE, LOG_MAX_WINDOWS); i++) {
      const to = latest - i * LOG_WINDOW_SIZE;
      if (to < 0) break;
      const from = Math.max(0, to - LOG_WINDOW_SIZE + 1);
      jobs.push(contract.queryFilter(buildFilter(), from, to));
      if (from === 0) {
        // Last window needed; mark and stop queueing further windows after this batch
        reachedGenesis = true;
      }
    }
    if (jobs.length === 0) break;
    const batches = await Promise.all(jobs);
    for (const b of batches) allEvents.push(...b);
    if (reachedGenesis) break;
  }
  allEvents.sort((a, b) => a.blockNumber - b.blockNumber);
  return { events: allEvents, complete: reachedGenesis };
}

/** Full-range query with automatic fallback to the bounded windowed scan. */
async function tolerantQueryFilter(contract, buildFilter) {
  try {
    const events = await contract.queryFilter(buildFilter(), 0, 'latest');
    return { events, complete: true };
  } catch (err) {
    if (!isRangeLimitError(err)) throw err;
    return boundedQueryFilter(contract, buildFilter);
  }
}

function _reset() {
  provider = null;
  contract = null;
}

// For tests: allow injecting a mock contract/provider
function _setTestOverrides({ testProvider, testContract } = {}) {
  if (testProvider !== undefined) provider = testProvider;
  if (testContract !== undefined) contract = testContract;
}

/**
 * Return array of token IDs owned by walletAddress.
 * Uses ERC721Enumerable when available; falls back to Transfer-event scan.
 */
async function getOwnedTokenIds(walletAddress) {
  const addr = ethers.getAddress(walletAddress);
  const c = getContract();
  try {
    const bal = await c.balanceOf(addr);
    const count = Number(bal);
    const ids = [];
    for (let i = 0; i < count; i++) {
      const id = await c.tokenOfOwnerByIndex(addr, i);
      ids.push(Number(id));
    }
    return ids;
  } catch (err) {
    // Fallback: scan Transfer events to compute current holdings
    return getOwnedTokenIdsViaEvents(addr);
  }
}

async function getOwnedTokenIdsViaEvents(walletAddress) {
  const addr = ethers.getAddress(walletAddress);
  const c = getContract();
  const [toRes, fromRes] = await Promise.all([
    tolerantQueryFilter(c, () => c.filters.Transfer(null, addr)),
    tolerantQueryFilter(c, () => c.filters.Transfer(addr, null)),
  ]);
  const toEvents = toRes.events;
  const fromEvents = fromRes.events;
  const owned = new Set();
  for (const e of toEvents) owned.add(Number(e.args.tokenId));
  for (const e of fromEvents) {
    const id = Number(e.args.tokenId);
    // Re-check current owner to handle re-acquisitions correctly
    try {
      const owner = await c.ownerOf(id);
      if (owner.toLowerCase() !== addr.toLowerCase()) owned.delete(id);
    } catch {
      owned.delete(id);
    }
  }
  // Final verification pass for remaining candidates
  const result = [];
  for (const id of owned) {
    try {
      const owner = await c.ownerOf(id);
      if (owner.toLowerCase() === addr.toLowerCase()) result.push(id);
    } catch {
      // ignore burned/nonexistent
    }
  }
  return result.sort((a, b) => a - b);
}

/** Check onchain that walletAddress owns tokenId. */
async function verifyOwnership(walletAddress, tokenId) {
  try {
    const c = getContract();
    const owner = await c.ownerOf(Number(tokenId));
    return owner.toLowerCase() === ethers.getAddress(walletAddress).toLowerCase();
  } catch {
    return false;
  }
}

/** Read tokenURI and fetch metadata JSON. Returns { traits, image, name, raw }. */
async function getTokenMetadata(tokenId) {
  const c = getContract();
  const uri = await c.tokenURI(Number(tokenId));
  const meta = await fetchMetadataJson(uri);
  const traits = {};
  if (Array.isArray(meta.attributes)) {
    for (const attr of meta.attributes) {
      if (attr && attr.trait_type) traits[attr.trait_type] = attr.value;
    }
  }
  return {
    traits,
    image: meta.image || '',
    name: meta.name || `Chog #${tokenId}`,
    raw: meta,
  };
}

async function fetchMetadataJson(uri) {
  let url = uri;
  if (url.startsWith('ipfs://')) url = url.replace('ipfs://', 'https://ipfs.io/ipfs/');
  // Some contracts return base64 data URIs
  if (url.startsWith('data:application/json;base64,')) {
    const b64 = url.slice('data:application/json;base64,'.length);
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  }
  if (url.startsWith('data:application/json,')) {
    return JSON.parse(decodeURIComponent(url.slice('data:application/json,'.length)));
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Metadata fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Build onchain history: { mintDate, transferCount, currentHoldingDuration, currentOwner, firstOwner }.
 * Scans Transfer events for the token.
 */
async function getTokenHistory(tokenId) {
  const id = Number(tokenId);
  const c = getContract();
  const p = getProvider();
  const { events, complete } = await tolerantQueryFilter(c, () => c.filters.Transfer(null, null, id));
  const transferCount = events.length;
  let mintDate = null;
  let currentHoldingSince = null;
  let currentOwner = null;

  if (events.length > 0) {
    const firstBlock = await p.getBlock(events[0].blockNumber);
    mintDate = firstBlock ? new Date(Number(firstBlock.timestamp) * 1000).toISOString() : null;
    const lastBlock = await p.getBlock(events[events.length - 1].blockNumber);
    currentHoldingSince = lastBlock ? new Date(Number(lastBlock.timestamp) * 1000).toISOString() : null;
  }
  try {
    currentOwner = await c.ownerOf(id);
  } catch {
    currentOwner = null;
  }

  let currentHoldingDuration = null;
  if (currentHoldingSince) {
    const ms = Date.now() - new Date(currentHoldingSince).getTime();
    currentHoldingDuration = formatDuration(ms);
  }

  return {
    mintDate,
    transferCount,
    currentHoldingSince,
    currentHoldingDuration,
    currentOwner,
    ownerCount: transferCount > 0 ? transferCount : null, // transfers ≈ owner changes
    historyComplete: complete, // false when the RPC range limit truncated the scan
  };
}

function formatDuration(ms) {
  const days = Math.floor(ms / 86400000);
  if (days < 1) return 'less than a day';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'}`;
}

module.exports = {
  CHOG_CONTRACT_ADDRESS,
  MONAD_RPC_URL,
  ERC721_ABI,
  getProvider,
  getContract,
  getOwnedTokenIds,
  verifyOwnership,
  getTokenMetadata,
  getTokenHistory,
  _setTestOverrides,
  _reset,
};
