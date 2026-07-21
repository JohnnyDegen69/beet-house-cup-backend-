require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
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
  `);

  console.log('[db] Tables ready');
}

module.exports = { pool, init };
