require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt    = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { pool, init } = require('./db');
const { auditMiddleware } = require('./middleware/audit');

const authRouter         = require('./routes/auth');
const usersRouter        = require('./routes/users');
const transactionsRouter = require('./routes/transactions');
const purchasesRouter    = require('./routes/purchases');
const tasksRouter        = require('./routes/tasks');
const adminRouter        = require('./routes/admin');

const app = express();

// ── Security headers (FERPA-aligned) ──
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──
app.use(cors());
app.options('*', cors());

// ── Rate limiting ──
// Global: 300 req/15min per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));

// Stricter limit on auth endpoints: 20 attempts/15min (brute-force protection)
app.use('/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again in 15 minutes.' },
}));

app.use(express.json());

// ── FERPA audit middleware ──
app.use(auditMiddleware);

// ── Routes ──
app.use('/auth',              authRouter);
app.use('/api/users',         usersRouter);
app.use('/api/transactions',  transactionsRouter);
app.use('/api/purchases',     purchasesRouter);
app.use('/api/tasks',         tasksRouter);
app.use('/api/admin',         adminRouter);

// ── Health ──
app.get('/health', (req, res) => res.json({ ok: true, service: 'Beet House Cup API' }));

// ── DB test ──
app.get('/db-test', async (req, res) => {
  const dbUrl = process.env.DATABASE_URL;
  try {
    const { rows } = await pool.query('SELECT NOW() as time');
    res.json({ ok: true, time: rows[0].time });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || '(empty)',
      code: err.code || null,
      dbUrlSet: !!dbUrl,
      dbUrlPrefix: dbUrl ? dbUrl.slice(0, 20) + '...' : 'NOT SET',
    });
  }
});

// ── Seed admin + default tasks on first start ──
const DEFAULT_TASKS = [
  { name:'Class Participation', pts:5,  icon:'🙋' },
  { name:'Homework Complete',   pts:10, icon:'📚' },
  { name:'Acts of Kindness',    pts:15, icon:'💚' },
  { name:'Perfect Score',       pts:25, icon:'💯' },
  { name:'Helping a Classmate', pts:10, icon:'🤝' },
];

async function seedIfNeeded() {
  // Admin user
  const { rows } = await pool.query("SELECT id FROM users WHERE username='admin'");
  if (!rows.length) {
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = await bcrypt.hash(adminPass, 10);
    await pool.query(
      `INSERT INTO users (id,username,password_hash,role,name,must_change_password)
       VALUES($1,'admin',$2,'admin','Administrator',FALSE)`,
      ['admin-' + uuid().replace(/-/g,'').slice(0,8), hash]
    );
    console.log(`[seed] Admin user created (password: ${adminPass})`);
  }

  // Default tasks
  const { rows: taskRows } = await pool.query('SELECT id FROM tasks LIMIT 1');
  if (!taskRows.length) {
    for (const t of DEFAULT_TASKS) {
      const id = 'tk' + uuid().replace(/-/g,'').slice(0,8);
      await pool.query(
        'INSERT INTO tasks (id,name,pts,icon) VALUES($1,$2,$3,$4)',
        [id, t.name, t.pts, t.icon]
      );
    }
    console.log('[seed] Default tasks created');
  }
}

// ── Start ──
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await init();
    await seedIfNeeded();
  } catch (err) {
    console.error('[startup] Error:', err.message);
  }
  app.listen(PORT, () => {
    console.log(`🥬 Beet House Cup API running on port ${PORT}`);
  });
}

start().catch(console.error);
