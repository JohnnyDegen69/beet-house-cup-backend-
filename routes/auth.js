const express = require('express');
const bcrypt  = require('bcryptjs');
const { pool } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username.toLowerCase().trim()]
    );
    const user = rows[0];
    const ip   = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress;

    if (!user) {
      await writeAudit({ action:'LOGIN_FAILED', resource:'/auth/login', detail:`Unknown username: ${username}`, ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      await writeAudit({ actorId:user.id, actorRole:user.role, actorName:user.username, action:'LOGIN_FAILED', resource:'/auth/login', detail:'Bad password', ip });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    await writeAudit({ actorId:user.id, actorRole:user.role, actorName:user.username, action:'LOGIN_SUCCESS', resource:'/auth/login', ip });
    const token = signToken(user);
    res.json({ token, user: sanitize(user) });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/change-password  (requires token)
router.post('/change-password', requireAuth, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const { rows } = await pool.query(
      `UPDATE users
         SET password_hash = $1, must_change_password = FALSE
       WHERE id = $2
       RETURNING *`,
      [hash, req.user.id]
    );
    const token = signToken(rows[0]);
    res.json({ token, user: sanitize(rows[0]) });
  } catch (err) {
    console.error('[auth/change-password]', err);
    res.status(500).json({ error: err.message });
  }
});

function sanitize(u) {
  const { password_hash, ...safe } = u;
  return safe;
}

module.exports = router;
