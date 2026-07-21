const express = require('express');
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();

// ── POST /api/admin/wipe-users — TEMPORARY, remove after use ─────────────────
router.post('/wipe-users', ...requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM transactions`);
    await pool.query(`DELETE FROM purchases`);
    await pool.query(`DELETE FROM users WHERE role IN ('student','teacher')`);
    res.json({ ok: true, message: 'All students and teachers deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/audit-log ──────────────────────────────────────────────────
// Returns paginated audit log. Admin only.
router.get('/audit-log', ...requireRole('admin'), async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || 100), 500);
  const offset = parseInt(req.query.offset || 0);
  const filter = req.query.actor || null; // filter by actor_id or username

  try {
    let query = `SELECT * FROM audit_log`;
    const vals = [];
    if (filter) {
      vals.push(`%${filter}%`);
      query += ` WHERE actor_name ILIKE $1 OR actor_id ILIKE $1`;
    }
    query += ` ORDER BY created_at DESC LIMIT $${vals.length+1} OFFSET $${vals.length+2}`;
    vals.push(limit, offset);

    const { rows } = await pool.query(query, vals);
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*) FROM audit_log');
    res.json({ total: parseInt(count), rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/export/student/:id ─────────────────────────────────────────
// FERPA: full data export for a single student (admin only).
// Returns all their records: profile, transactions, purchases.
router.get('/export/student/:id', ...requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: [student] } = await pool.query(
      'SELECT * FROM users WHERE id=$1 AND role=$2', [id, 'student']
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { rows: transactions } = await pool.query(
      'SELECT * FROM transactions WHERE student_id=$1 ORDER BY created_at DESC', [id]
    );
    const { rows: purchases } = await pool.query(
      'SELECT * FROM purchases WHERE student_id=$1 ORDER BY created_at DESC', [id]
    );

    // Strip password hash before returning
    const { password_hash, ...safeStudent } = student;

    // FERPA audit: log this export
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress;
    await writeAudit({
      actorId:    req.user.id,
      actorRole:  req.user.role,
      actorName:  req.user.username,
      action:     'FERPA_EXPORT',
      resource:   '/api/admin/export/student',
      resourceId: id,
      detail:     `Exported full record for student ${safeStudent.name}`,
      ip,
    });

    res.json({
      exportedAt:   new Date().toISOString(),
      ferpaNotice:  'This export contains protected student education records under FERPA (20 U.S.C. § 1232g). Handle accordingly.',
      student:      safeStudent,
      transactions,
      purchases,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/deletion-request ─────────────────────────────────────────
// FERPA: submit a request to delete a student's records.
// Creates a pending deletion request for review before hard delete.
router.post('/deletion-request', ...requireRole('admin'), async (req, res) => {
  const { studentId, reason } = req.body;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  try {
    const { rows: [student] } = await pool.query(
      "SELECT id,name FROM users WHERE id=$1 AND role='student'", [studentId]
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const id = 'dr' + uuid().replace(/-/g,'').slice(0,10);
    const { rows: [req_] } = await pool.query(
      `INSERT INTO deletion_requests (id,student_id,requested_by,reason)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [id, studentId, req.user.id, reason||'']
    );

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress;
    await writeAudit({
      actorId:    req.user.id,
      actorRole:  req.user.role,
      actorName:  req.user.username,
      action:     'FERPA_DELETION_REQUEST',
      resource:   '/api/admin/deletion-request',
      resourceId: studentId,
      detail:     `Deletion requested for student ${student.name}. Reason: ${reason||'none'}`,
      ip,
    });

    res.json({ ok: true, request: req_ });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/deletion-request/:id/confirm ─────────────────────────────
// FERPA: hard delete a student and all their records after request is confirmed.
router.post('/deletion-request/:id/confirm', ...requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: [request] } = await pool.query(
      "SELECT * FROM deletion_requests WHERE id=$1 AND status='pending'", [id]
    );
    if (!request) return res.status(404).json({ error: 'Pending deletion request not found' });

    const studentId = request.student_id;
    const { rows: [student] } = await pool.query('SELECT name FROM users WHERE id=$1', [studentId]);

    // Hard delete all student data
    await pool.query('DELETE FROM purchases    WHERE student_id=$1', [studentId]);
    await pool.query('DELETE FROM transactions WHERE student_id=$1', [studentId]);
    await pool.query('DELETE FROM users        WHERE id=$1',         [studentId]);

    // Mark request resolved
    await pool.query(
      "UPDATE deletion_requests SET status='completed', resolved_at=NOW() WHERE id=$1", [id]
    );

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress;
    await writeAudit({
      actorId:    req.user.id,
      actorRole:  req.user.role,
      actorName:  req.user.username,
      action:     'FERPA_DELETION_CONFIRMED',
      resource:   '/api/admin/deletion-request/confirm',
      resourceId: studentId,
      detail:     `All records permanently deleted for student: ${student?.name || studentId}`,
      ip,
    });

    res.json({ ok: true, deleted: student?.name || studentId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/deletion-requests ─────────────────────────────────────────
// List all deletion requests.
router.get('/deletion-requests', ...requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM deletion_requests ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
