'use strict';

const express = require('express');
const { authMiddleware } = require('../lib/middleware');
const { getOwnedTokenIds, mintChogTo } = require('../lib/blockchain');
const { randomTraits } = require('../lib/traits');

const router = express.Router();

// POST /api/chog/claim — sponsor a testnet Chog mint to the authenticated wallet.
// The deployer wallet pays gas, so testers never need testnet MON.
router.post('/claim', authMiddleware, async (req, res) => {
  try {
    let owned;
    try {
      owned = await getOwnedTokenIds(req.user.address);
    } catch (err) {
      console.error('claim ownership check failed:', err.message);
      return res.status(502).json({ error: 'Could not check ownership — please try again' });
    }
    if (owned.length > 0) {
      return res.status(409).json({
        error: 'This wallet already owns a Chog',
        tokenIds: owned,
      });
    }

    const traits = randomTraits();
    const result = await mintChogTo(req.user.address, traits);
    res.status(201).json({
      address: req.user.address,
      tokenId: result.tokenId,
      txHash: result.txHash,
      traits: result.traits,
    });
  } catch (err) {
    console.error('POST /chog/claim error:', err.message);
    if (err.code === 'MINT_NOT_CONFIGURED' || err.code === 'MINT_NOT_AUTHORIZED') {
      return res.status(503).json({ error: 'Free Chog claims are not available right now' });
    }
    res.status(502).json({ error: 'Mint failed — please try again' });
  }
});

module.exports = router;
