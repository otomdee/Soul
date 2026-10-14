'use strict';

// Creates the three core tables. Works on SQLite (local dev) and Postgres (Vercel).
// Usage: npm run migrate

require('dotenv').config();
const { isPostgres, getSqliteDb, getPgPool, closeDb } = require('../lib/db');

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS souls (
  id TEXT PRIMARY KEY,
  token_id INTEGER UNIQUE NOT NULL,
  owner_address TEXT NOT NULL,
  personality TEXT NOT NULL DEFAULT '',
  steer TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  soul_balance INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  soul_id TEXT NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
  token_id INTEGER NOT NULL,
  post_type TEXT NOT NULL DEFAULT 'regular',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_soul_id ON posts(soul_id);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  soul_id TEXT NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_soul_id ON transactions(soul_id);
`;

const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS souls (
  id TEXT PRIMARY KEY,
  token_id INTEGER UNIQUE NOT NULL,
  owner_address TEXT NOT NULL,
  personality TEXT NOT NULL DEFAULT '',
  steer TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  soul_balance INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  soul_id TEXT NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
  token_id INTEGER NOT NULL,
  post_type TEXT NOT NULL DEFAULT 'regular',
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_soul_id ON posts(soul_id);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  soul_id TEXT NOT NULL REFERENCES souls(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_soul_id ON transactions(soul_id);
`;

async function migrate() {
  if (isPostgres) {
    const pool = getPgPool();
    await pool.query(POSTGRES_SCHEMA);
    await renameLegacyColumnPg(pool);
    console.log('Migration complete (postgres). Tables: souls, posts, transactions.');
  } else {
    const db = getSqliteDb();
    db.exec(SQLITE_SCHEMA);
    renameLegacyColumnSqlite(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    console.log('Migration complete (sqlite). Tables:', tables.map((t) => t.name).join(', '));
  }
  await closeDb();
}

// Existing DBs created before the direction→steer rename carry a
// user_direction column. Rename it so stored steers survive.
function renameLegacyColumnSqlite(db) {
  const cols = db.prepare('PRAGMA table_info(souls)').all().map((c) => c.name);
  if (cols.includes('user_direction') && !cols.includes('steer')) {
    db.exec('ALTER TABLE souls RENAME COLUMN user_direction TO steer');
    console.log('Renamed souls.user_direction → souls.steer (sqlite).');
  }
}

async function renameLegacyColumnPg(pool) {
  const res = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'souls'"
  );
  const cols = res.rows.map((r) => r.column_name);
  if (cols.includes('user_direction') && !cols.includes('steer')) {
    await pool.query('ALTER TABLE souls RENAME COLUMN user_direction TO steer');
    console.log('Renamed souls.user_direction → souls.steer (postgres).');
  }
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migrate };
