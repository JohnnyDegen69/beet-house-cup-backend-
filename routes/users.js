const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { pool } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const VALID_HOUSES = ['ruby','golden','ring','sugar','mangel','silver'];

function sanitize(u) {
  const { password_hash, ...safe } = u;
  return safe;
}

function generateUsername(base, existingUsernames) {
  const parts = base.toLowerCase().trim().replace(/[^a-z0-9\s]/g,'').split(/\s+/);
  let uname = parts.length >= 2 ? `${parts[0]}.${parts[parts.length-1]}` : parts[0];
  let candidate = uname, n = 2;
  while (existingUsernames.has(candidate)) { candidate = uname + n; n++; }
  return candidate;
}

// GET /api/users — all users (admin only)
router.get('/', ...requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY role, name');
    res.json(rows.map(sanitize));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/students — all students (teacher+)
router.get('/students', ...requireRole('admin','teacher'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE role = 'student' ORDER BY name"
    );
    res.json(rows.map(sanitize));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/house-totals — summed points per house (all authed)
router.get('/house-totals', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT house_id, COALESCE(SUM(points),0)::int AS total
        FROM users WHERE role = 'student'
       GROUP BY house_id
    `);
    const totals = {};
    rows.forEach(r => { totals[r.house_id] = r.total; });
    res.json(totals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/me — current user info
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(sanitize(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id — update points or info (admin)
router.patch('/:id', ...requireRole('admin'), async (req, res) => {
  const { points, house_id, grade, name } = req.body;
  try {
    const sets = [], vals = [];
    if (points  !== undefined) { sets.push(`points=$${sets.length+1}`);   vals.push(points);   }
    if (house_id!== undefined) { sets.push(`house_id=$${sets.length+1}`); vals.push(house_id); }
    if (grade   !== undefined) { sets.push(`grade=$${sets.length+1}`);    vals.push(grade);    }
    if (name    !== undefined) { sets.push(`name=$${sets.length+1}`);     vals.push(name);     }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`,
      vals
    );
    res.json(sanitize(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/import/students — bulk import (admin)
router.post('/import/students', ...requireRole('admin'), async (req, res) => {
  const { rows: inputRows } = req.body;
  if (!Array.isArray(inputRows) || !inputRows.length) {
    return res.status(400).json({ error: 'rows array required' });
  }

  const { rows: existing } = await pool.query('SELECT username FROM users');
  const usernames = new Set(existing.map(u => u.username));

  const added = [], updated = [], errors = [], creds = [];

  for (let i = 0; i < inputRows.length; i++) {
    const r = inputRows[i];
    const firstName       = (r.firstName||r.firstname||'').trim();
    const lastName        = (r.lastName||r.lastname||'').trim();
    const crew            = (r.crew||r.house||'').toLowerCase().trim();
    const grade           = (r.grade||'').trim();
    const parentFirstName = (r.parentFirstName||r.parentfirstname||'').trim();
    const parentLastName  = (r.parentLastName||r.parentlastname||'').trim();
    const parentEmail     = (r.parentEmail||r.parentemail||'').trim();

    if (!firstName)       { errors.push(`Row ${i+1}: missing firstName`);       continue; }
    if (!lastName)        { errors.push(`Row ${i+1}: missing lastName`);        continue; }
    if (!parentFirstName) { errors.push(`Row ${i+1}: missing parentFirstName`); continue; }
    if (!parentLastName)  { errors.push(`Row ${i+1}: missing parentLastName`);  continue; }
    if (!VALID_HOUSES.includes(crew)) {
      errors.push(`Row ${i+1}: invalid crew "${crew}"`); continue;
    }

    const name     = `${firstName} ${lastName}`;
    const username = generateUsername(name, usernames);
    const tempPass = 'Beet' + (Math.floor(Math.random()*9000)+1000);
    const hash     = await bcrypt.hash(tempPass, 10);
    const id       = 'u' + uuid().replace(/-/g,'').slice(0,12);

    try {
      const { rows: existing } = await pool.query(
        'SELECT id FROM users WHERE username=$1', [username]
      );
      if (existing.length) {
        await pool.query(
          `UPDATE users SET name=$1,house_id=$2,grade=$3,
            parent_first_name=$4,parent_last_name=$5,parent_email=$6
           WHERE username=$7`,
          [name,crew,grade,parentFirstName,parentLastName,parentEmail,username]
        );
        updated.push(name);
      } else {
        await pool.query(
          `INSERT INTO users
            (id,username,password_hash,role,name,house_id,grade,
             parent_first_name,parent_last_name,parent_email,
             must_change_password)
           VALUES($1,$2,$3,'student',$4,$5,$6,$7,$8,$9,TRUE)`,
          [id,username,hash,name,crew,grade,parentFirstName,parentLastName,parentEmail]
        );
        usernames.add(username);
        added.push(name);
        creds.push({ name, grade, crew, username, tempPassword: tempPass });
      }
    } catch (err) {
      errors.push(`Row ${i+1} (${name}): ${err.message}`);
    }
  }

  res.json({ added: added.length, updated: updated.length, errors, credentials: creds });
});

// POST /api/users/import/teachers — bulk import (admin)
router.post('/import/teachers', ...requireRole('admin'), async (req, res) => {
  const { rows: inputRows } = req.body;
  if (!Array.isArray(inputRows) || !inputRows.length) {
    return res.status(400).json({ error: 'rows array required' });
  }

  const { rows: existing } = await pool.query('SELECT username FROM users');
  const usernames = new Set(existing.map(u => u.username));

  const added = [], updated = [], errors = [], creds = [];

  for (let i = 0; i < inputRows.length; i++) {
    const r = inputRows[i];
    const firstName = (r.firstName||r.firstname||'').trim();
    const lastName  = (r.lastName||r.lastname||'').trim();
    const crew      = (r.crew||r.house||'').toLowerCase().trim();
    const email     = (r.email||'').trim();
    const grade     = (r.grade||'').trim();

    if (!firstName) { errors.push(`Row ${i+1}: missing firstName`); continue; }
    if (!lastName)  { errors.push(`Row ${i+1}: missing lastName`);  continue; }
    if (!crew)      { errors.push(`Row ${i+1}: missing crew`);      continue; }
    if (!VALID_HOUSES.includes(crew)) {
      errors.push(`Row ${i+1}: invalid crew "${crew}"`); continue;
    }

    const name     = `${firstName} ${lastName}`;
    const username = generateUsername(name, usernames);
    const tempPass = 'Beet' + (Math.floor(Math.random()*9000)+1000);
    const hash     = await bcrypt.hash(tempPass, 10);
    const id       = 't' + uuid().replace(/-/g,'').slice(0,12);

    try {
      const { rows: ex } = await pool.query(
        'SELECT id FROM users WHERE username=$1', [username]
      );
      if (ex.length) {
        await pool.query(
          'UPDATE users SET name=$1,house_id=$2,email=$3,grade=$4 WHERE username=$5',
          [name,crew,email,grade,username]
        );
        updated.push(name);
      } else {
        await pool.query(
          `INSERT INTO users
            (id,username,password_hash,role,name,house_id,email,grade,must_change_password)
           VALUES($1,$2,$3,'teacher',$4,$5,$6,$7,TRUE)`,
          [id,username,hash,name,crew,email,grade]
        );
        usernames.add(username);
        added.push(name);
        creds.push({ name, grade, crew, email, username, tempPassword: tempPass });
      }
    } catch (err) {
      errors.push(`Row ${i+1} (${name}): ${err.message}`);
    }
  }

  res.json({ added: added.length, updated: updated.length, errors, credentials: creds });
});

module.exports = router;
