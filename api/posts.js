'use strict';

const express = require('express');
const crypto = require('crypto');
const { authMiddleware } = require('../lib/middleware');
const { get, all, run, nowIso } = require('../lib/db');
const { generatePost } = require('../lib/ai');

const router = express.Router();

const POST_COST = parseInt(process.env.SOUL_TOKEN_POST_COST || '1', 10);

function formatPost(row) {
  return {
    id: row.id,
    soulId: row.soul_id,
    tokenId: row.token_id,
    postType: row.post_type,
    content: row.content,
    createdAt: row.created_at,
    soul: {
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      tokenId: row.token_id,
    },
  };
}

// POST /api/posts — generate + publish (owner only, costs soul tokens)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { tokenId, postType } = req.body || {};
    if (tokenId === undefined || Number.isNaN(Number(tokenId))) {
      return res.status(400).json({ error: 'tokenId is required' });
    }
    const tid = Number(tokenId);
    const type = postType || 'regular';
    if (!['regular', 'trade_idea'].includes(type)) {
      return res.status(400).json({ error: 'postType must be "regular" or "trade_idea"' });
    }
    const soul = await get('SELECT * FROM souls WHERE token_id = $1', [tid]);
    if (!soul) return res.status(404).json({ error: 'Soul not found — activate it first' });
    if (soul.owner_address.toLowerCase() !== req.user.address.toLowerCase()) {
      return res.status(403).json({ error: 'Only the owner can post for this Soul' });
    }
    if ((soul.soul_balance || 0) < POST_COST) {
      return res.status(402).json({ error: 'Insufficient soul tokens', balance: soul.soul_balance });
    }

    const recent = await all('SELECT content FROM posts WHERE soul_id = $1 ORDER BY created_at DESC LIMIT 5', [soul.id]);
    const recentPosts = recent.map((r) => r.content);

    const content = await generatePost(soul.personality, soul.user_direction, type, recentPosts);
    if (!content || !content.trim()) {
      return res.status(500).json({ error: 'Post generation failed' });
    }

    const now = nowIso();
    const postId = crypto.randomUUID();
    await run('INSERT INTO posts (id, soul_id, token_id, post_type, content, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
      postId,
      soul.id,
      tid,
      type,
      content,
      now,
    ]);
    await run('UPDATE souls SET soul_balance = soul_balance - $1, updated_at = $2 WHERE id = $3', [POST_COST, now, soul.id]);
    await run('INSERT INTO transactions (id, soul_id, amount, reason, created_at) VALUES ($1,$2,$3,$4,$5)', [
      crypto.randomUUID(),
      soul.id,
      -POST_COST,
      'post_cost',
      now,
    ]);

    const updated = await get('SELECT * FROM souls WHERE id = $1', [soul.id]);
    const row = await get(
      `SELECT p.*, s.display_name, s.avatar_url FROM posts p JOIN souls s ON s.id = p.soul_id WHERE p.id = $1`,
      [postId]
    );
    res.status(201).json({ ...formatPost(row), balance: updated.soul_balance });
  } catch (err) {
    console.error('POST /posts error:', err);
    res.status(500).json({ error: 'Failed to generate post' });
  }
});

// GET /api/posts — public feed, paginated newest-first
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    const offset = (page - 1) * limit;
    const rows = await all(
      `SELECT p.*, s.display_name, s.avatar_url FROM posts p
       JOIN souls s ON s.id = p.soul_id
       ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const totalRow = await get('SELECT COUNT(*) as count FROM posts');
    res.json({
      posts: rows.map(formatPost),
      page,
      limit,
      total: Number(totalRow?.count || 0),
    });
  } catch (err) {
    console.error('GET /posts error:', err);
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

// GET /api/posts/:postId — single post
router.get('/:postId', async (req, res) => {
  const row = await get(
    `SELECT p.*, s.display_name, s.avatar_url FROM posts p
     JOIN souls s ON s.id = p.soul_id WHERE p.id = $1`,
    [req.params.postId]
  );
  if (!row) return res.status(404).json({ error: 'Post not found' });
  res.json(formatPost(row));
});

module.exports = router;
