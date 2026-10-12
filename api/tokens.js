'use strict';

const express = require('express');
const crypto = require('crypto');
const { authMiddleware } = require('../lib/middleware');
const { get, run, nowIso } = require('../lib/db');

const router = express.Router();

// POST /api/tokens/purchase — stub: credits soul tokens without real $CHOG verification.
// TODO(post-hackathon): verify an onchain $CHOG transfer (tx hash, sender, amount)
// against the Monad RPC before crediting. See PRD "Real $CHOG payment integration".
router.post('/purchase', authMiddleware, async (req, res) => {
  try {
    const { tokenId, amount } = req.body || {};
    if (tokenId === undefined || Number.isNaN(Number(tokenId))) {
      return res.status(400).json({ error: 'tokenId is required' });
    }
    const qty = Number(amount || 10);
    if (!Number.isInteger(qty) || qty <= 0 || qty > 1000) {
      return res.status(400).json({ error: 'amount must be an integer between 1 and 1000' });
    }
    const tid = Number(tokenId);
    const soul = await get('SELECT * FROM souls WHERE token_id = $1', [tid]);
    if (!soul) return res.status(404).json({ error: 'Soul not found' });
    if (soul.owner_address.toLowerCase() !== req.user.address.toLowerCase()) {
      return res.status(403).json({ error: 'Only the owner can purchase tokens for this Soul' });
    }

    const now = nowIso();
    await run('UPDATE souls SET soul_balance = soul_balance + $1, updated_at = $2 WHERE id = $3', [qty, now, soul.id]);
    await run('INSERT INTO transactions (id, soul_id, amount, reason, created_at) VALUES ($1,$2,$3,$4,$5)', [
      crypto.randomUUID(),
      soul.id,
      qty,
      'purchase',
      now,
    ]);
    const updated = await get('SELECT * FROM souls WHERE id = $1', [soul.id]);
    res.json({ balance: updated.soul_balance, tokenId: tid, purchased: qty });
  } catch (err) {
    console.error('POST /tokens/purchase error:', err);
    res.status(500).json({ error: 'Purchase failed' });
  }
});

module.exports = router;
