const express = require('express');
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const DEFAULT_TASKS = [
  { name:'Class Participation', pts:5,  icon:'🙋' },
  { name:'Homework Complete',   pts:10, icon:'📚' },
  { name:'Acts of Kindness',    pts:15, icon:'💚' },
  { name:'Perfect Score',       pts:25, icon:'💯' },
  { name:'Helping a Classmate', pts:10, icon:'🤝' },
];

// GET /api/tasks — all tasks (any authed user)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks ORDER BY pts ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/:id — toggle active or update (teacher+)
router.patch('/:id', ...requireRole('admin','teacher'), async (req, res) => {
  const { active, name, pts, icon } = req.body;
  try {
    const sets = [], vals = [];
    if (active !== undefined) { sets.push(`active=$${sets.length+1}`); vals.push(active); }
    if (name   !== undefined) { sets.push(`name=$${sets.length+1}`);   vals.push(name);   }
    if (pts    !== undefined) { sets.push(`pts=$${sets.length+1}`);    vals.push(pts);    }
    if (icon   !== undefined) { sets.push(`icon=$${sets.length+1}`);   vals.push(icon);   }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE tasks SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`,
      vals
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id (admin)
router.delete('/:id', ...requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/import — bulk import (admin)
router.post('/import', ...requireRole('admin'), async (req, res) => {
  const { rows: inputRows } = req.body;
  if (!Array.isArray(inputRows) || !inputRows.length) {
    return res.status(400).json({ error: 'rows array required' });
  }
  const added = [], errors = [];
  for (let i = 0; i < inputRows.length; i++) {
    const r = inputRows[i];
    const name = (r.name||r.taskname||'').trim();
    const pts  = parseInt(r.points||r.pts||0);
    const icon = r.icon||r.emoji||'📌';
    if (!name)     { errors.push(`Row ${i+1}: missing name`);          continue; }
    if (pts <= 0)  { errors.push(`Row ${i+1}: invalid points "${pts}"`); continue; }
    const id = 'tk' + uuid().replace(/-/g,'').slice(0,8);
    try {
      await pool.query(
        'INSERT INTO tasks (id,name,pts,icon) VALUES($1,$2,$3,$4)',
        [id, name, pts, icon]
      );
      added.push(name);
    } catch (err) {
      errors.push(`Row ${i+1} (${name}): ${err.message}`);
    }
  }
  res.json({ added: added.length, errors });
});

module.exports = router;
