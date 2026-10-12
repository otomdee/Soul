'use strict';

// Shared test setup: isolated sqlite DB, mocked blockchain, supertest app.

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.JWT_SECRET = 'test-secret';
process.env.SOUL_TOKEN_START_BALANCE = '10';
process.env.SOUL_TOKEN_POST_COST = '1';
delete process.env.AI_API_KEY; // force deterministic fallback AI

jest.mock('../lib/blockchain', () => {
  const actual = jest.requireActual('../lib/blockchain');
  return {
    ...actual,
    getOwnedTokenIds: jest.fn(async () => []),
    verifyOwnership: jest.fn(async () => false),
    getTokenMetadata: jest.fn(async (tokenId) => ({
      traits: { Eyes: 'XD', Mouth: 'Rainbow Puke', Head: 'BTC Cap', Tier: 'Uncommon', Skin: 'Pink', Background: 'Purple' },
      image: `https://example.com/chog/${tokenId}.png`,
      name: `Chog #${tokenId}`,
      raw: {},
    })),
    getTokenHistory: jest.fn(async () => ({
      mintDate: '2024-01-01T00:00:00.000Z',
      transferCount: 2,
      currentHoldingSince: '2024-06-01T00:00:00.000Z',
      currentHoldingDuration: '3 months',
      currentOwner: null,
      ownerCount: 2,
    })),
  };
});

const blockchain = require('../lib/blockchain');
const { migrate } = require('../scripts/migrate');
const { run } = require('../lib/db');
const { createToken } = require('../lib/auth');
const { ethers } = require('ethers');

let app;
let request;

async function cleanDb() {
  await run('DELETE FROM posts');
  await run('DELETE FROM transactions');
  await run('DELETE FROM souls');
}

function authHeader(address, tokenIds = []) {
  const token = createToken({ address, tokenIds });
  return `Bearer ${token}`;
}

beforeAll(async () => {
  await migrate();
  app = require('../server');
  request = require('supertest')(app);
});

beforeEach(async () => {
  await cleanDb();
  jest.clearAllMocks();
  // Default mock: empty ownership; individual tests override
  blockchain.getOwnedTokenIds.mockResolvedValue([]);
  blockchain.verifyOwnership.mockResolvedValue(false);
});

afterAll(async () => {
  const { closeDb } = require('../lib/db');
  await closeDb();
});

module.exports = { getApp: () => app, getRequest: () => request, cleanDb, authHeader, blockchain, ethers };
