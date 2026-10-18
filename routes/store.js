const express = require('express');
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_CATEGORIES = ['specials', 'quick-wins', 'seedling', 'sprout', 'harvest'];

// GET /api/store/items — all authenticated users can view
router.get('/items', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM store_items ORDER BY sort_order ASC, category ASC, cost ASC, created_at ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/store/items/import — admin only; replaces all items or appends
// Body: { items: [{category, name, cost, icon}], replace: true|false }
router.post('/items/import', ...requireRole('admin'), async (req, res) => {
  const { items, replace = false } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' });

  const errors = [];
  const valid  = [];

  items.forEach((item, i) => {
    const cat  = (item.category || '').toLowerCase().trim();
    const name = (item.name || '').trim();
    const cost = parseInt(item.cost || item.points || 0);
    const icon = (item.icon || '').trim();
    if (!VALID_CATEGORIES.includes(cat)) { errors.push(`Row ${i+1}: invalid category "${cat}"`); return; }
    if (!name)                           { errors.push(`Row ${i+1}: missing name`); return; }
    if (isNaN(cost) || cost < 1)         { errors.push(`Row ${i+1}: invalid cost`); return; }
    valid.push({ category: cat, name, cost, icon, sort_order: i });
  });

  try {
    if (replace) {
      await pool.query('DELETE FROM store_items');
    }

    const inserted = [];
    for (const item of valid) {
      const id = 'si' + uuid().replace(/-/g,'').slice(0,10);
      const { rows: [row] } = await pool.query(
        `INSERT INTO store_items (id, category, name, cost, icon, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, item.category, item.name, item.cost, item.icon, item.sort_order]
      );
      inserted.push(row);
    }

    const { rows: all } = await pool.query(
      'SELECT * FROM store_items ORDER BY sort_order ASC, category ASC, cost ASC'
    );
    res.json({ ok: true, added: inserted.length, errors, total: all.length, items: all });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/store/items — admin only; wipe all store items
router.delete('/items', ...requireRole('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM store_items');
    res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/store/items/:id — admin only; remove a single item
router.delete('/items/:id', ...requireRole('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM store_items WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
