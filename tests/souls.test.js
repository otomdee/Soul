'use strict';

require('./setup');
const { getRequest, authHeader, blockchain, ethers } = require('./setup');

describe('souls API', () => {
  test('POST /api/souls activates a soul for the owner', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    blockchain.verifyOwnership.mockResolvedValue(true);

    const res = await request
      .post('/api/souls')
      .set('Authorization', authHeader(wallet.address, [5]))
      .send({ tokenId: 5 });
    expect(res.status).toBe(201);
    expect(res.body.tokenId).toBe(5);
    expect(res.body.personality).toBeTruthy();
    expect(res.body.soulBalance).toBe(10);
  });

  test('POST /api/souls rejects non-owners', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    blockchain.verifyOwnership.mockResolvedValue(false);

    const res = await request
      .post('/api/souls')
      .set('Authorization', authHeader(wallet.address, []))
      .send({ tokenId: 6 });
    expect(res.status).toBe(403);
  });

  test('GET /api/souls/:tokenId returns profile; PATCH updates direction', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    blockchain.verifyOwnership.mockResolvedValue(true);
    const auth = authHeader(wallet.address, [9]);

    await request.post('/api/souls').set('Authorization', auth).send({ tokenId: 9 });

    const got = await request.get('/api/souls/9');
    expect(got.status).toBe(200);
    expect(got.body.postCount).toBe(0);

    const patched = await request
      .patch('/api/souls/9')
      .set('Authorization', auth)
      .send({ user_direction: 'talk about memecoins' });
    expect(patched.status).toBe(200);
    expect(patched.body.userDirection).toBe('talk about memecoins');

    const tooLong = await request
      .patch('/api/souls/9')
      .set('Authorization', auth)
      .send({ user_direction: 'x'.repeat(501) });
    expect(tooLong.status).toBe(400);

    const other = ethers.Wallet.createRandom();
    const forbidden = await request
      .patch('/api/souls/9')
      .set('Authorization', authHeader(other.address, []))
      .send({ user_direction: 'hijack' });
    expect(forbidden.status).toBe(403);
  });

  test('GET /api/souls/:tokenId/balance is owner-only', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    blockchain.verifyOwnership.mockResolvedValue(true);
    const auth = authHeader(wallet.address, [11]);
    await request.post('/api/souls').set('Authorization', auth).send({ tokenId: 11 });

    const ok = await request.get('/api/souls/11/balance').set('Authorization', auth);
    expect(ok.status).toBe(200);
    expect(ok.body.balance).toBe(10);

    const other = ethers.Wallet.createRandom();
    const denied = await request
      .get('/api/souls/11/balance')
      .set('Authorization', authHeader(other.address, []));
    expect(denied.status).toBe(403);
  });
});
