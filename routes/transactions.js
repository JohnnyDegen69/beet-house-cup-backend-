const express = require('express');
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/transactions — all (teacher+), or own student's
router.get('/', requireAuth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'student') {
      ({ rows } = await pool.query(
        'SELECT * FROM transactions WHERE student_id=$1 ORDER BY created_at DESC',
        [req.user.id]
      ));
    } else {
      ({ rows } = await pool.query(
        'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 500'
      ));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transactions — award/deduct points (teacher+)
router.post('/', ...requireRole('admin','teacher'), async (req, res) => {
  const { studentId, delta, reason } = req.body;
  if (!studentId || delta === undefined || delta === 0) {
    return res.status(400).json({ error: 'studentId and non-zero delta required' });
  }
  try {
    const id = 'tx' + uuid().replace(/-/g,'').slice(0,10);
    // Insert transaction
    const { rows: [txn] } = await pool.query(
      `INSERT INTO transactions (id,student_id,delta,reason,teacher_id)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [id, studentId, delta, reason||'', req.user.id]
    );
    // Update student's points
    const { rows: [student] } = await pool.query(
      `UPDATE users SET points = GREATEST(0, points + $1)
       WHERE id=$2 AND role='student' RETURNING id,name,points,house_id`,
      [delta, studentId]
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ transaction: txn, student });
  } catch (err) {
    console.error('[transactions/post]', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/transactions/:id — undo a transaction (admin only)
router.delete('/:id', ...requireRole('admin'), async (req, res) => {
  try {
    const { rows: [txn] } = await pool.query(
      'SELECT * FROM transactions WHERE id=$1', [req.params.id]
    );
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    // Reverse the points
    await pool.query(
      'UPDATE users SET points = GREATEST(0, points - $1) WHERE id=$2',
      [txn.delta, txn.student_id]
    );
    await pool.query('DELETE FROM transactions WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
