'use strict';

require('./setup');
const { getRequest, blockchain, ethers } = require('./setup');
const { buildSignMessage } = require('../lib/auth');

describe('auth routes', () => {
  test('GET /api/auth/nonce returns a nonce', async () => {
    const request = getRequest();
    const res = await request.get('/api/auth/nonce');
    expect(res.status).toBe(200);
    expect(res.body.nonce).toMatch(/^soul-/);
  });

  test('POST /api/auth/verify with valid signature returns JWT', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    const nonceRes = await request.get('/api/auth/nonce');
    const nonce = nonceRes.body.nonce;
    const message = buildSignMessage(wallet.address, nonce);
    const signature = await wallet.signMessage(message);
    blockchain.getOwnedTokenIds.mockResolvedValue([7, 42]);

    const res = await request.post('/api/auth/verify').send({ address: wallet.address, signature, nonce });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.tokenIds).toEqual([7, 42]);
  });

  test('POST /api/auth/verify accepts lowercase (non-checksummed) address casing', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    const nonceRes = await request.get('/api/auth/nonce');
    const nonce = nonceRes.body.nonce;
    const lower = wallet.address.toLowerCase();
    const message = buildSignMessage(lower, nonce);
    const signature = await wallet.signMessage(message);
    blockchain.getOwnedTokenIds.mockResolvedValue([7]);

    const res = await request.post('/api/auth/verify').send({ address: lower, signature, nonce });
    expect(res.status).toBe(200);
    expect(res.body.address).toBe(wallet.address);
  });

  test('POST /api/auth/verify rejects bad signature', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    const nonceRes = await request.get('/api/auth/nonce');
    const res = await request
      .post('/api/auth/verify')
      .send({ address: wallet.address, signature: '0xdead', nonce: nonceRes.body.nonce });
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me requires auth and returns address', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    blockchain.getOwnedTokenIds.mockResolvedValue([1]);
    const { createToken } = require('../lib/auth');
    const token = createToken({ address: wallet.address, tokenIds: [1] });

    const anon = await request.get('/api/auth/me');
    expect(anon.status).toBe(401);

    const me = await request.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.address).toBe(wallet.address);
    expect(me.body.tokenIds).toEqual([1]);
  });
});
