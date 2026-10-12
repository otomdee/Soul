'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || '';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'soul.db');

const isPostgres = DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://');

let sqliteDb = null;
let pgPool = null;

function getSqliteDb(dbPath = DB_PATH) {
  if (sqliteDb) return sqliteDb;
  const Database = require('better-sqlite3');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  return sqliteDb;
}

function getPgPool() {
  if (pgPool) return pgPool;
  const { Pool } = require('pg');
  pgPool = new Pool({ connectionString: DATABASE_URL });
  return pgPool;
}

// Convert $1-style params to ? for sqlite
function toSqliteParams(sql) {
  return sql.replace(/\$\d+/g, '?');
}

/**
 * Run a statement, return { lastID, changes } (sqlite) or pg result meta.
 */
async function run(sql, params = []) {
  if (isPostgres) {
    const pool = getPgPool();
    const res = await pool.query(sql, params);
    return { changes: res.rowCount, lastID: null, rows: res.rows };
  }
  const db = getSqliteDb();
  const stmt = db.prepare(toSqliteParams(sql));
  const info = stmt.run(...params);
  return { changes: info.changes, lastID: info.lastInsertRowid };
}

async function get(sql, params = []) {
  if (isPostgres) {
    const pool = getPgPool();
    const res = await pool.query(sql, params);
    return res.rows[0] || null;
  }
  const db = getSqliteDb();
  const stmt = db.prepare(toSqliteParams(sql));
  return stmt.get(...params) || null;
}

async function all(sql, params = []) {
  if (isPostgres) {
    const pool = getPgPool();
    const res = await pool.query(sql, params);
    return res.rows;
  }
  const db = getSqliteDb();
  const stmt = db.prepare(toSqliteParams(sql));
  return stmt.all(...params);
}

function nowIso() {
  return new Date().toISOString();
}

async function closeDb() {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
}

module.exports = {
  isPostgres,
  getSqliteDb,
  getPgPool,
  run,
  get,
  all,
  nowIso,
  closeDb,
};
