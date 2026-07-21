const express = require('express');
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/purchases — all (teacher+), or own student's
router.get('/', requireAuth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'student') {
      ({ rows } = await pool.query(
        'SELECT * FROM purchases WHERE student_id=$1 ORDER BY created_at DESC',
        [req.user.id]
      ));
    } else {
      ({ rows } = await pool.query(
        'SELECT * FROM purchases ORDER BY created_at DESC'
      ));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/purchases — redeem item (student only)
router.post('/', requireAuth, async (req, res) => {
  const { itemId, itemName, cost } = req.body;
  if (!itemId || !itemName || !cost) {
    return res.status(400).json({ error: 'itemId, itemName, and cost required' });
  }
  // Resolve student id — teachers can redeem on behalf of a student
  const studentId = req.body.studentId || req.user.id;
  try {
    // Check balance
    const { rows: [student] } = await pool.query(
      "SELECT id,name,points FROM users WHERE id=$1 AND role='student'",
      [studentId]
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (student.points < cost) {
      return res.status(400).json({ error: `Not enough points (have ${student.points}, need ${cost})` });
    }
    // Deduct points
    const { rows: [updated] } = await pool.query(
      'UPDATE users SET points=points-$1 WHERE id=$2 RETURNING id,name,points',
      [cost, studentId]
    );
    // Record purchase
    const id = 'p' + uuid().replace(/-/g,'').slice(0,10);
    const { rows: [purchase] } = await pool.query(
      `INSERT INTO purchases (id,student_id,item_id,item_name,cost)
       VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [id, studentId, itemId, itemName, cost]
    );
    res.json({ purchase, student: updated });
  } catch (err) {
    console.error('[purchases/post]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
