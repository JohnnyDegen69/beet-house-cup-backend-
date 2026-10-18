const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendEmail, epictivityEmailHtml } = require('../mailer');

const router = express.Router();

// Helper: compute today's EPICtivity score for a student from the DB
async function getStudentScore(studentId) {
  // Get today's date in local-ish terms — use UTC date for consistency with frontend
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC

  const { rows } = await pool.query(
    `SELECT delta, reason FROM transactions
     WHERE student_id=$1 AND epic_cat='epictivity'
     AND DATE(created_at) = $2`,
    [studentId, today]
  );
  const totalDeduction = rows.reduce((s, t) => s + Math.abs(t.delta || 0), 0);
  return {
    score:       Math.max(0, 100 - totalDeduction),
    infractions: rows,
  };
}

// GET /api/epictivity/settings — returns setting for the calling teacher
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const key = `auto_notify_below_80:${req.user.id}`;
    const { rows } = await pool.query(
      'SELECT value FROM app_settings WHERE key=$1', [key]
    );
    const autoNotify = rows[0]?.value === 'true';
    res.json({ auto_notify_below_80: autoNotify });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/epictivity/settings — saves setting for the calling teacher only
router.patch('/settings', ...requireRole('admin', 'teacher'), async (req, res) => {
  const { auto_notify_below_80 } = req.body;
  if (auto_notify_below_80 === undefined) return res.status(400).json({ error: 'auto_notify_below_80 required' });
  try {
    const key = `auto_notify_below_80:${req.user.id}`;
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
      [key, auto_notify_below_80 ? 'true' : 'false']
    );
    res.json({ ok: true, auto_notify_below_80: !!auto_notify_below_80 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/epictivity/notify — send parent email for a student
// Body: { studentId }
router.post('/notify', ...requireRole('admin', 'teacher'), async (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  try {
    // Fetch student + parent info
    const { rows: [student] } = await pool.query(
      `SELECT id, name, parent_first_name, parent_last_name, parent_email
       FROM users WHERE id=$1 AND role='student'`,
      [studentId]
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!student.parent_email) return res.status(400).json({ error: `No parent email on file for ${student.name}` });

    const { score, infractions } = await getStudentScore(studentId);

    // Fetch teacher name
    const teacherName = req.user?.name || req.user?.username || '';

    const parentName = [student.parent_first_name, student.parent_last_name].filter(Boolean).join(' ') || 'Parent/Guardian';
    const date       = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

    const html = epictivityEmailHtml({
      studentName: student.name,
      parentName,
      score,
      infractions,
      teacherName,
      date,
    });

    await sendEmail({
      to:      student.parent_email,
      toName:  parentName,
      subject: `EPICtivity Update: ${student.name} is at ${score}% today`,
      html,
    });

    res.json({ ok: true, to: student.parent_email, score, studentName: student.name });
  } catch (err) {
    console.error('[epictivity/notify]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
