'use strict';

const express = require('express');
const crypto = require('crypto');
const { authMiddleware } = require('../lib/middleware');
const { get, run, nowIso } = require('../lib/db');
const { verifyOwnership, getTokenMetadata, getTokenHistory } = require('../lib/blockchain');
const { generatePersonality } = require('../lib/ai');

const router = express.Router();

const START_BALANCE = parseInt(process.env.SOUL_TOKEN_START_BALANCE || '10', 10);

function publicSoul(row) {
  if (!row) return null;
  return {
    id: row.id,
    tokenId: row.token_id,
    ownerAddress: row.owner_address,
    personality: row.personality,
    steer: row.steer,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    soulBalance: row.soul_balance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// POST /api/souls — activate a Soul for a token ID (owner only)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { tokenId } = req.body || {};
    if (tokenId === undefined || tokenId === null || Number.isNaN(Number(tokenId))) {
      return res.status(400).json({ error: 'tokenId is required' });
    }
    const tid = Number(tokenId);
    if (!Number.isInteger(tid) || tid < 0) {
      return res.status(400).json({ error: 'Invalid tokenId' });
    }

    const existing = await get('SELECT * FROM souls WHERE token_id = $1', [tid]);
    if (existing) {
      // If the NFT moved, allow the new owner to claim it
      const owns = await verifyOwnership(req.user.address, tid).catch(() => false);
      if (!owns) return res.status(403).json({ error: 'You do not own this token' });
      if (existing.owner_address.toLowerCase() !== req.user.address.toLowerCase()) {
        await run('UPDATE souls SET owner_address = $1, updated_at = $2 WHERE id = $3', [
          req.user.address,
          nowIso(),
          existing.id,
        ]);
        const updated = await get('SELECT * FROM souls WHERE id = $1', [existing.id]);
        return res.json(publicSoul(updated));
      }
      return res.status(409).json({ error: 'Soul already exists for this token', soul: publicSoul(existing) });
    }

    // Fresh activation: must own the token onchain
    let owns = false;
    try {
      owns = await verifyOwnership(req.user.address, tid);
    } catch (err) {
      console.error('verifyOwnership failed:', err.message);
    }
    // Also accept JWT-listed ownership as fallback (helps local dev without RPC)
    if (!owns && (req.user.tokenIds || []).map(Number).includes(tid)) owns = true;
    if (!owns) return res.status(403).json({ error: 'You do not own this token' });

    // Fetch traits + history (best-effort; fall back to empty so activation never hard-fails)
    let traits = {};
    let image = '';
    try {
      const meta = await getTokenMetadata(tid);
      traits = meta.traits || {};
      image = meta.image || '';
    } catch (err) {
      console.error('getTokenMetadata failed:', err.message);
    }
    let history = {};
    try {
      history = await getTokenHistory(tid);
    } catch (err) {
      console.error('getTokenHistory failed:', err.message);
    }

    const { personality } = await generatePersonality(traits, history);

    const now = nowIso();
    const soul = {
      id: crypto.randomUUID(),
      token_id: tid,
      owner_address: req.user.address,
      personality,
      steer: '',
      display_name: `Chog #${tid}`,
      avatar_url: image,
      soul_balance: START_BALANCE,
      created_at: now,
      updated_at: now,
    };
    await run(
      `INSERT INTO souls (id, token_id, owner_address, personality, steer, display_name, avatar_url, soul_balance, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [soul.id, soul.token_id, soul.owner_address, soul.personality, soul.steer, soul.display_name, soul.avatar_url, soul.soul_balance, soul.created_at, soul.updated_at]
    );
    await run(
      `INSERT INTO transactions (id, soul_id, amount, reason, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [crypto.randomUUID(), soul.id, START_BALANCE, 'genesis_grant', now]
    );

    const created = await get('SELECT * FROM souls WHERE id = $1', [soul.id]);
    res.status(201).json(publicSoul(created));
  } catch (err) {
    console.error('POST /souls error:', err);
    res.status(500).json({ error: 'Failed to activate Soul' });
  }
});

// GET /api/souls/:tokenId — public profile + post count
router.get('/:tokenId', async (req, res) => {
  const tid = Number(req.params.tokenId);
  if (!Number.isInteger(tid)) return res.status(400).json({ error: 'Invalid tokenId' });
  const soul = await get('SELECT * FROM souls WHERE token_id = $1', [tid]);
  if (!soul) return res.status(404).json({ error: 'Soul not found' });
  const countRow = await get('SELECT COUNT(*) as count FROM posts WHERE soul_id = $1', [soul.id]);
  res.json({ ...publicSoul(soul), postCount: Number(countRow?.count || 0) });
});

// PATCH /api/souls/:tokenId — owner only, updatable: steer (≤280), display_name (≤120)
router.patch('/:tokenId', authMiddleware, async (req, res) => {
  const tid = Number(req.params.tokenId);
  if (!Number.isInteger(tid)) return res.status(400).json({ error: 'Invalid tokenId' });
  const soul = await get('SELECT * FROM souls WHERE token_id = $1', [tid]);
  if (!soul) return res.status(404).json({ error: 'Soul not found' });
  if (soul.owner_address.toLowerCase() !== req.user.address.toLowerCase()) {
    return res.status(403).json({ error: 'Only the owner can update this Soul' });
  }
  const { steer, display_name, displayName } = req.body || {};
  const newSteer = steer ?? soul.steer;
  const dname = display_name ?? displayName ?? soul.display_name;
  if (typeof newSteer === 'string' && newSteer.length > 280) {
    return res.status(400).json({ error: 'steer must be ≤280 chars' });
  }
  if (typeof dname === 'string' && dname.length > 120) {
    return res.status(400).json({ error: 'display_name must be ≤120 chars' });
  }
  await run('UPDATE souls SET steer = $1, display_name = $2, updated_at = $3 WHERE id = $4', [
    newSteer,
    dname,
    nowIso(),
    soul.id,
  ]);
  const updated = await get('SELECT * FROM souls WHERE id = $1', [soul.id]);
  res.json(publicSoul(updated));
});

// GET /api/souls/:tokenId/balance — owner only
router.get('/:tokenId/balance', authMiddleware, async (req, res) => {
  const tid = Number(req.params.tokenId);
  if (!Number.isInteger(tid)) return res.status(400).json({ error: 'Invalid tokenId' });
  const soul = await get('SELECT * FROM souls WHERE token_id = $1', [tid]);
  if (!soul) return res.status(404).json({ error: 'Soul not found' });
  if (soul.owner_address.toLowerCase() !== req.user.address.toLowerCase()) {
    return res.status(403).json({ error: 'Only the owner can view the balance' });
  }
  res.json({ balance: soul.soul_balance, tokenId: tid });
});

module.exports = router;
