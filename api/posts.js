'use strict';

const express = require('express');
const crypto = require('crypto');
const { authMiddleware } = require('../lib/middleware');
const { get, all, run, nowIso } = require('../lib/db');
const { generatePost } = require('../lib/ai');
const { demoAvatarFor, needsDemoAvatar } = require('../lib/avatars');

const router = express.Router();

const POST_COST = parseInt(process.env.SOUL_TOKEN_POST_COST || '1', 10);

const DESTINATIONS = ['feed', 'x'];

function parseDestination(value) {
  if (value === undefined || value === null || value === '') return 'feed';
  return DESTINATIONS.includes(value) ? value : null;
}

function buildXIntentUrl(content) {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(content)}`;
}

function formatPost(row) {
  return {
    id: row.id,
    soulId: row.soul_id,
    tokenId: row.token_id,
    postType: row.post_type,
    content: row.content,
    createdAt: row.created_at,
    soul: {
      avatarUrl: needsDemoAvatar(row.avatar_url) ? demoAvatarFor(row.token_id) : row.avatar_url,
      tokenId: row.token_id,
    },
  };
}

// POST /api/posts/preview — generate a preview without publishing or charging.
// Body: { tokenId, postType, destination? }. Returns { content, postType, tokenId, destination }.
router.post('/preview', authMiddleware, async (req, res) => {
  try {
    const { tokenId, postType, destination } = req.body || {};
    if (tokenId === undefined || Number.isNaN(Number(tokenId))) {
      return res.status(400).json({ error: 'tokenId is required' });
    }
    const tid = Number(tokenId);
    const type = postType || 'regular';
    if (!['regular', 'trade_idea'].includes(type)) {
      return res.status(400).json({ error: 'postType must be "regular" or "trade_idea"' });
    }
    const dest = parseDestination(destination);
    if (!dest) return res.status(400).json({ error: 'destination must be "feed" or "x"' });
    const soul = await get('SELECT * FROM souls WHERE token_id = $1', [tid]);
    if (!soul) return res.status(404).json({ error: 'Soul not found — activate it first' });
    if (soul.owner_address.toLowerCase() !== req.user.address.toLowerCase()) {
      return res.status(403).json({ error: 'Only the owner can preview for this Soul' });
    }
    const recent = await all('SELECT content FROM posts WHERE soul_id = $1 ORDER BY created_at DESC LIMIT 5', [soul.id]);
    const content = await generatePost(soul.personality, soul.steer, type, recent.map((r) => r.content));
    if (!content || !content.trim()) {
      return res.status(500).json({ error: 'Post generation failed' });
    }
    res.json({ content, postType: type, tokenId: tid, destination: dest });
  } catch (err) {
    console.error('POST /posts/preview error:', err);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

// POST /api/posts — publish (owner only, costs soul tokens).
// Body: { tokenId, postType, content?, destination? }. Without content the
// server generates one; with content the confirmed preview text is published
// as-is. destination "x" charges the post cost but returns an X compose intent
// URL instead of inserting the post into the Soul feed.
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { tokenId, postType, destination } = req.body || {};
    let content = req.body ? req.body.content : undefined;
    if (tokenId === undefined || Number.isNaN(Number(tokenId))) {
      return res.status(400).json({ error: 'tokenId is required' });
    }
    const tid = Number(tokenId);
    const type = postType || 'regular';
    if (!['regular', 'trade_idea'].includes(type)) {
      return res.status(400).json({ error: 'postType must be "regular" or "trade_idea"' });
    }
    const dest = parseDestination(destination);
    if (!dest) return res.status(400).json({ error: 'destination must be "feed" or "x"' });
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

    if (content === undefined) {
      content = await generatePost(soul.personality, soul.steer, type, recentPosts);
    } else if (typeof content !== 'string' || !content.trim() || content.length > 280) {
      return res.status(400).json({ error: 'content must be 1–280 chars' });
    } else {
      content = content.trim();
    }
    if (!content || !content.trim()) {
      return res.status(500).json({ error: 'Post generation failed' });
    }

    const now = nowIso();
    const reason = dest === 'x' ? 'post_cost_x' : 'post_cost';
    let postId = null;

    if (dest === 'feed') {
      postId = crypto.randomUUID();
      await run('INSERT INTO posts (id, soul_id, token_id, post_type, content, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
        postId,
        soul.id,
        tid,
        type,
        content,
        now,
      ]);
    }

    await run('UPDATE souls SET soul_balance = soul_balance - $1, updated_at = $2 WHERE id = $3', [POST_COST, now, soul.id]);
    await run('INSERT INTO transactions (id, soul_id, amount, reason, created_at) VALUES ($1,$2,$3,$4,$5)', [
      crypto.randomUUID(),
      soul.id,
      -POST_COST,
      reason,
      now,
    ]);

    const updated = await get('SELECT * FROM souls WHERE id = $1', [soul.id]);

    if (dest === 'x') {
      return res.status(201).json({
        destination: 'x',
        tokenId: tid,
        postType: type,
        content,
        xIntentUrl: buildXIntentUrl(content),
        balance: updated.soul_balance,
      });
    }

    const row = await get(
      `SELECT p.*, s.avatar_url FROM posts p JOIN souls s ON s.id = p.soul_id WHERE p.id = $1`,
      [postId]
    );
    res.status(201).json({ ...formatPost(row), balance: updated.soul_balance, destination: 'feed' });
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
      `SELECT p.*, s.avatar_url FROM posts p
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
    `SELECT p.*, s.avatar_url FROM posts p
     JOIN souls s ON s.id = p.soul_id WHERE p.id = $1`,
    [req.params.postId]
  );
  if (!row) return res.status(404).json({ error: 'Post not found' });
  res.json(formatPost(row));
});

module.exports = router;
