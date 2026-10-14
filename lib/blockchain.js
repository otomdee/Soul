'use strict';

require('dotenv').config();
const { ethers } = require('ethers');
const { getMintRecord } = require('./deployments');

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
// fallback scan used when the unlimited query is rejected. The fallback is
// anchored at the contract's deployment block (found via getCode binary
// search) so coverage always reaches back to birth instead of an arbitrary
// recent window that goes stale within hours on fast chains.
const LOG_WINDOW_SIZE = 90;
const LOG_FORWARD_MAX_WINDOWS = 200;
const LOG_BATCH_SIZE = 25;

function isRangeLimitError(err) {
  const msg = (err && err.message ? err.message : String(err)).toLowerCase();
  return msg.includes('limited to') || msg.includes('block range') || msg.includes('exceeds') || msg.includes('too many blocks');
}

/**
 * Binary-search the first block where the contract has code (= deployment).
 * ~26 RPC calls for a 64M-block chain. Returns null when no code is found.
 */
async function findDeployBlock(contract) {
  const provider = getProvider();
  const address = await contract.getAddress();
  const latest = await provider.getBlockNumber();
  if ((await provider.getCode(address, latest)) === '0x') return null;
  let lo = 0;
  let hi = latest;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await provider.getCode(address, mid);
    if (code && code !== '0x') hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Query a filter from the deployment block forward in small windows.
 * Returns { events (ascending), complete (false when the window cap cut the scan) }.
 */
async function anchoredQueryFilter(contract, buildFilter) {
  const provider = getProvider();
  const latest = await provider.getBlockNumber();
  let from = 0;
  try {
    const deployed = await findDeployBlock(contract);
    from = deployed === null ? 0 : deployed;
  } catch (err) {
    console.error('findDeployBlock failed, scanning from genesis:', err.message);
    from = 0;
  }
  const allEvents = [];
  let cursor = from;
  let complete = true;
  while (cursor <= latest) {
    const jobs = [];
    let windowStart = cursor;
    for (let i = 0; i < LOG_BATCH_SIZE; i++) {
      if (windowStart > latest) break;
      if ((windowStart - from) / LOG_WINDOW_SIZE >= LOG_FORWARD_MAX_WINDOWS) break;
      const windowEnd = Math.min(windowStart + LOG_WINDOW_SIZE - 1, latest);
      jobs.push(contract.queryFilter(buildFilter(), windowStart, windowEnd));
      windowStart = windowEnd + 1;
    }
    if (jobs.length === 0) {
      complete = false;
      break;
    }
    const batches = await Promise.all(jobs);
    for (const b of batches) allEvents.push(...b);
    cursor = windowStart;
    if (cursor <= latest && (cursor - from) / LOG_WINDOW_SIZE >= LOG_FORWARD_MAX_WINDOWS) {
      complete = false;
      break;
    }
  }
  allEvents.sort((a, b) => a.blockNumber - b.blockNumber);
  return { events: allEvents, complete };
}

/** Full-range query with automatic fallback to the anchored windowed scan. */
async function tolerantQueryFilter(contract, buildFilter) {
  try {
    const events = await contract.queryFilter(buildFilter(), 0, 'latest');
    return { events, complete: true };
  } catch (err) {
    if (!isRangeLimitError(err)) throw err;
    return anchoredQueryFilter(contract, buildFilter);
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

  // Fast path: our own deployment record is ground truth for the mint.
  // Valid while the minter still holds the token (a later transfer would show
  // a different owner, and round-trips back are out of scope for the demo).
  try {
    const record = getMintRecord(CHOG_CONTRACT_ADDRESS, id);
    if (record && record.mintBlock) {
      const currentOwner = await c.ownerOf(id).catch(() => null);
      if (
        currentOwner &&
        record.minter &&
        currentOwner.toLowerCase() === String(record.minter).toLowerCase()
      ) {
        const mintBlock = await p.getBlock(Number(record.mintBlock));
        const mintDate = mintBlock ? new Date(Number(mintBlock.timestamp) * 1000).toISOString() : null;
        return {
          mintDate,
          transferCount: 1,
          currentHoldingSince: mintDate,
          currentHoldingDuration: mintDate ? formatDuration(Date.now() - new Date(mintDate).getTime()) : null,
          currentOwner,
          ownerCount: 1,
          historyComplete: true,
        };
      }
    }
  } catch (err) {
    console.error('deployment-record history failed, falling back to scan:', err.message);
  }

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
