'use strict';

const express = require('express');
const { ethers } = require('ethers');
const { generateNonce, buildSignMessage, verifySignature, createToken } = require('../lib/auth');
const { authMiddleware } = require('../lib/middleware');
const { getOwnedTokenIds } = require('../lib/blockchain');

const router = express.Router();

// In-memory nonces: nonce -> { addressHint, expiresAt }
const nonces = new Map();
const NONCE_TTL_MS = 10 * 60 * 1000;

function pruneNonces() {
  const now = Date.now();
  for (const [k, v] of nonces) {
    if (v.expiresAt < now) nonces.delete(k);
  }
}

// GET /api/auth/nonce — returns { nonce, message? }. Client signs buildSignMessage(address, nonce).
router.get('/nonce', (req, res) => {
  pruneNonces();
  const nonce = generateNonce();
  nonces.set(nonce, { expiresAt: Date.now() + NONCE_TTL_MS });
  res.json({ nonce });
});

// POST /api/auth/verify — { address, signature, nonce }
router.post('/verify', async (req, res) => {
  try {
    pruneNonces();
    const { address, signature, nonce } = req.body || {};
    if (!address || !signature || !nonce) {
      return res.status(400).json({ error: 'address, signature and nonce are required' });
    }
    let checksum;
    try {
      checksum = ethers.getAddress(address);
    } catch {
      return res.status(400).json({ error: 'Invalid address' });
    }
    const record = nonces.get(nonce);
    if (!record) return res.status(400).json({ error: 'Invalid or expired nonce' });
    nonces.delete(nonce);

    // The frontend may sign with the address in any casing (some wallets return
    // all-lowercase accounts). Accept the checksummed message or the as-sent one.
    const candidates = [buildSignMessage(checksum, nonce)];
    if (address !== checksum) candidates.push(buildSignMessage(address, nonce));
    const ok = candidates.some((message) => verifySignature(message, signature, checksum));
    if (!ok) {
      return res.status(401).json({ error: 'Signature verification failed' });
    }

    let tokenIds = [];
    try {
      tokenIds = await getOwnedTokenIds(checksum);
    } catch (err) {
      console.error('getOwnedTokenIds failed:', err.message);
      tokenIds = [];
    }

    const token = createToken({ address: checksum, tokenIds });
    res.json({ token, address: checksum, tokenIds });
  } catch (err) {
    console.error('auth verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// GET /api/auth/me — protected
router.get('/me', authMiddleware, async (req, res) => {
  let tokenIds = req.user.tokenIds || [];
  // Re-check onchain so transfers are reflected
  try {
    tokenIds = await getOwnedTokenIds(req.user.address);
  } catch {
    // fall back to JWT copy
  }
  res.json({ address: req.user.address, tokenIds });
});

module.exports = router;
module.exports._nonces = nonces;
