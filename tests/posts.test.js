'use strict';

require('./setup');
const { getRequest, authHeader, blockchain, ethers } = require('./setup');

async function activate(request, auth, tokenId) {
  const res = await request.post('/api/souls').set('Authorization', auth).send({ tokenId });
  expect(res.status).toBe(201);
  return res.body;
}

describe('posts + tokens API', () => {
  test('POST /api/posts generates a post and deducts balance', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    blockchain.verifyOwnership.mockResolvedValue(true);
    const auth = authHeader(wallet.address, [21]);
    await activate(request, auth, 21);

    const post = await request.post('/api/posts').set('Authorization', auth).send({ tokenId: 21, postType: 'regular' });
    expect(post.status).toBe(201);
    expect(post.body.content).toBeTruthy();
    expect(post.body.content.length).toBeLessThanOrEqual(280);
    expect(post.body.balance).toBe(9);

    const trade = await request
      .post('/api/posts')
      .set('Authorization', auth)
      .send({ tokenId: 21, postType: 'trade_idea' });
    expect(trade.status).toBe(201);
    expect(trade.body.content).toMatch(/\|/);
  });

  test('POST /api/posts rejects invalid postType and insufficient balance', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    blockchain.verifyOwnership.mockResolvedValue(true);
    const auth = authHeader(wallet.address, [22]);
    await activate(request, auth, 22);

    const bad = await request.post('/api/posts').set('Authorization', auth).send({ tokenId: 22, postType: 'nope' });
    expect(bad.status).toBe(400);

    // Drain balance: 10 posts at cost 1
    for (let i = 0; i < 10; i++) {
      const r = await request.post('/api/posts').set('Authorization', auth).send({ tokenId: 22 });
      expect(r.status).toBe(201);
    }
    const broke = await request.post('/api/posts').set('Authorization', auth).send({ tokenId: 22 });
    expect(broke.status).toBe(402);
  });

  test('GET /api/posts feed is paginated newest-first; single post fetch works', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    blockchain.verifyOwnership.mockResolvedValue(true);
    const auth = authHeader(wallet.address, [23]);
    await activate(request, auth, 23);
    const first = await request.post('/api/posts').set('Authorization', auth).send({ tokenId: 23 });
    await request.post('/api/posts').set('Authorization', auth).send({ tokenId: 23 });

    const feed = await request.get('/api/posts?page=1&limit=20');
    expect(feed.status).toBe(200);
    expect(feed.body.total).toBe(2);
    expect(feed.body.posts).toHaveLength(2);

    const single = await request.get(`/api/posts/${first.body.id}`);
    expect(single.status).toBe(200);
    expect(single.body.content).toBe(first.body.content);
  });

  test('POST /api/tokens/purchase credits balance (stub)', async () => {
    const request = getRequest();
    const wallet = ethers.Wallet.createRandom();
    blockchain.verifyOwnership.mockResolvedValue(true);
    const auth = authHeader(wallet.address, [24]);
    await activate(request, auth, 24);

    const res = await request.post('/api/tokens/purchase').set('Authorization', auth).send({ tokenId: 24, amount: 10 });
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(20);

    const bad = await request.post('/api/tokens/purchase').set('Authorization', auth).send({ tokenId: 24, amount: -5 });
    expect(bad.status).toBe(400);
  });
});
