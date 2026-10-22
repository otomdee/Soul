'use strict';

require('./setup');
const { getRequest, authHeader, blockchain } = require('./setup');

describe('sponsored Chog claim API', () => {
  test('POST /api/chog/claim requires auth', async () => {
    const request = getRequest();
    const res = await request.post('/api/chog/claim').send({});
    expect(res.status).toBe(401);
  });

  test('POST /api/chog/claim mints to the authenticated wallet', async () => {
    const request = getRequest();
    const wallet = '0x1111111111111111111111111111111111111111';
    blockchain.getOwnedTokenIds.mockResolvedValue([]);
    blockchain.mintChogTo.mockResolvedValue({
      tokenId: 42,
      txHash: '0xabc',
      traits: { Tier: 'Rare' },
    });

    const res = await request
      .post('/api/chog/claim')
      .set('Authorization', authHeader(wallet))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.tokenId).toBe(42);
    expect(res.body.txHash).toBe('0xabc');
    expect(res.body.address).toBe(wallet);
    expect(blockchain.mintChogTo).toHaveBeenCalledWith(wallet, expect.any(Object));
  });

  test('POST /api/chog/claim rejects wallets that already own a Chog', async () => {
    const request = getRequest();
    blockchain.getOwnedTokenIds.mockResolvedValue([0]);

    const res = await request
      .post('/api/chog/claim')
      .set('Authorization', authHeader('0x2222222222222222222222222222222222222222'))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.tokenIds).toEqual([0]);
    expect(blockchain.mintChogTo).not.toHaveBeenCalled();
  });

  test('POST /api/chog/claim reports an unconfigured minter', async () => {
    const request = getRequest();
    blockchain.getOwnedTokenIds.mockResolvedValue([]);
    const err = new Error('TEST_WALLET_PK is not configured');
    err.code = 'MINT_NOT_CONFIGURED';
    blockchain.mintChogTo.mockRejectedValue(err);

    const res = await request
      .post('/api/chog/claim')
      .set('Authorization', authHeader('0x3333333333333333333333333333333333333333'))
      .send({});
    expect(res.status).toBe(503);
  });
});
