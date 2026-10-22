'use strict';

// Demo seed: pre-activate 3 Souls with distinct trait combos + a small feed.
// Usage: npm run seed
// Uses deterministic fallback generation (no API key / RPC needed).

require('dotenv').config();
const crypto = require('crypto');
const { migrate } = require('./migrate');
const { run, get, closeDb, nowIso } = require('../lib/db');
const { fallbackPersonality, fallbackPost } = require('../lib/ai');
const { demoAvatarFor } = require('../lib/avatars');

const START_BALANCE = parseInt(process.env.SOUL_TOKEN_START_BALANCE || '10', 10);

const DEMO_SOULS = [
  {
    tokenId: 1,
    owner: '0x1111111111111111111111111111111111111111',
    traits: { Background: 'Purple', Eyes: 'XD', Mouth: 'Rainbow Puke', Head: 'BTC Cap', Tier: 'Uncommon', Skin: 'Pink' },
    steer: 'memecoins and roasting bad takes',
    posts: ['regular', 'trade_idea', 'regular'],
  },
  {
    tokenId: 2,
    owner: '0x2222222222222222222222222222222222222222',
    traits: { Background: 'Blue', Eyes: 'Tired', Mouth: 'Grit', Head: 'Dollar Cap', Tier: 'Rare', Skin: 'Green' },
    steer: 'Monad ecosystem and diamond-hands philosophy',
    posts: ['regular', 'regular', 'trade_idea'],
  },
  {
    tokenId: 3,
    owner: '0x3333333333333333333333333333333333333333',
    traits: { Background: 'Black', Eyes: 'Laser', Mouth: 'Smile', Head: 'Crown', Tier: 'Legendary', Skin: 'Gold' },
    steer: 'market outlook with regal confidence',
    posts: ['trade_idea', 'regular'],
  },
];

async function seed() {
  await migrate();
  for (const demo of DEMO_SOULS) {
    const existing = await get('SELECT * FROM souls WHERE token_id = $1', [demo.tokenId]);
    if (existing) {
      console.log(`Soul #${demo.tokenId} already exists, skipping.`);
      continue;
    }
    const history = { mintDate: '2024-01-01T00:00:00.000Z', transferCount: 2, currentHoldingDuration: '6 months' };
    const { personality } = fallbackPersonality(demo.traits, history);
    const now = nowIso();
    const soulId = crypto.randomUUID();
    await run(
      `INSERT INTO souls (id, token_id, owner_address, personality, steer, display_name, avatar_url, soul_balance, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [soulId, demo.tokenId, demo.owner, personality, demo.steer, `Chog #${demo.tokenId}`, demoAvatarFor(demo.tokenId), START_BALANCE, now, now]
    );
    await run('INSERT INTO transactions (id, soul_id, amount, reason, created_at) VALUES ($1,$2,$3,$4,$5)', [
      crypto.randomUUID(),
      soulId,
      START_BALANCE,
      'genesis_grant',
      now,
    ]);
    const recent = [];
    for (const postType of demo.posts) {
      const content = fallbackPost({ personality, steer: demo.steer, postType, recentPosts: recent });
      recent.push(content);
      await run('INSERT INTO posts (id, soul_id, token_id, post_type, content, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
        crypto.randomUUID(),
        soulId,
        demo.tokenId,
        postType,
        content,
        nowIso(),
      ]);
      await run('UPDATE souls SET soul_balance = soul_balance - 1 WHERE id = $1', [soulId]);
      await run('INSERT INTO transactions (id, soul_id, amount, reason, created_at) VALUES ($1,$2,$3,$4,$5)', [
        crypto.randomUUID(),
        soulId,
        -1,
        'post_cost',
        nowIso(),
      ]);
    }
    console.log(`Seeded Soul #${demo.tokenId} (${demo.posts.length} posts).`);
  }
  await closeDb();
  console.log('Seed complete.');
}

if (require.main === module) {
  seed().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}

module.exports = { seed };
