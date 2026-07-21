require('dotenv').config();
const { Pool } = require('pg');

// Railway uses different variable names depending on setup — try all of them
const connStr =
  process.env.DATABASE_URL ||
  process.env.DATABASE_PRIVATE_URL ||
  process.env.POSTGRES_URL ||
  process.env.RAILWAY_DATABASE_URL ||
  process.env.POSTGRESQL_URL ||
  null;

const pool = new Pool({
  connectionString: connStr,
  ssl: connStr ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                   TEXT PRIMARY KEY,
      username             TEXT UNIQUE NOT NULL,
      password_hash        TEXT NOT NULL,
      role                 TEXT NOT NULL DEFAULT 'student',
      name                 TEXT NOT NULL,
      house_id             TEXT DEFAULT '',
      grade                TEXT DEFAULT '',
      parent_first_name    TEXT DEFAULT '',
      parent_last_name     TEXT DEFAULT '',
      parent_email         TEXT DEFAULT '',
      email                TEXT DEFAULT '',
      points               INTEGER DEFAULT 0,
      must_change_password BOOLEAN DEFAULT FALSE,
      created_at           TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id          TEXT PRIMARY KEY,
      student_id  TEXT NOT NULL,
      delta       INTEGER NOT NULL,
      reason      TEXT DEFAULT '',
      teacher_id  TEXT DEFAULT '',
      created_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id          TEXT PRIMARY KEY,
      student_id  TEXT NOT NULL,
      item_id     TEXT NOT NULL,
      item_name   TEXT NOT NULL,
      cost        INTEGER NOT NULL,
      created_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      pts        INTEGER NOT NULL,
      icon       TEXT DEFAULT '📌',
      active     BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- FERPA: immutable audit trail of all access and mutations
    CREATE TABLE IF NOT EXISTS audit_log (
      id           TEXT PRIMARY KEY,
      actor_id     TEXT,
      actor_role   TEXT,
      actor_name   TEXT,
      action       TEXT NOT NULL,
      resource     TEXT NOT NULL,
      resource_id  TEXT,
      detail       TEXT,
      ip           TEXT,
      created_at   TIMESTAMP DEFAULT NOW()
    );

    -- FERPA: deletion requests (soft-delete with reason)
    CREATE TABLE IF NOT EXISTS deletion_requests (
      id           TEXT PRIMARY KEY,
      student_id   TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      reason       TEXT DEFAULT '',
      status       TEXT DEFAULT 'pending',
      created_at   TIMESTAMP DEFAULT NOW(),
      resolved_at  TIMESTAMP
    );
  `);

  console.log('[db] Tables ready');
}

module.exports = { pool, init };
