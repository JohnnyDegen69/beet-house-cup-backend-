const { pool } = require('../db');
const { v4: uuid } = require('uuid');

// Strip PII from anything going to console
const PII_PATTERN = /("password[_\w]*"\s*:\s*)"[^"]+"/gi;
function redact(str) {
  return String(str).replace(PII_PATTERN, '$1"[REDACTED]"');
}

// Override console.log/error so PII never leaks into Railway logs
const _log   = console.log.bind(console);
const _error = console.error.bind(console);
console.log   = (...args) => _log(...args.map(a => typeof a === 'string' ? redact(a) : a));
console.error = (...args) => _error(...args.map(a => typeof a === 'string' ? redact(a) : a));

/**
 * writeAudit — fire-and-forget insert into audit_log.
 * Never throws; audit failures must not break the request.
 */
async function writeAudit({ actorId, actorRole, actorName, action, resource, resourceId, detail, ip }) {
  try {
    await pool.query(
      `INSERT INTO audit_log
         (id, actor_id, actor_role, actor_name, action, resource, resource_id, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        'al' + uuid().replace(/-/g,'').slice(0,10),
        actorId  || 'anonymous',
        actorRole|| 'unknown',
        actorName|| 'unknown',
        action,
        resource,
        resourceId || null,
        detail     || null,
        ip         || null,
      ]
    );
  } catch (err) {
    // Log the failure but never crash the request
    _error('[audit] Failed to write audit log:', err.message);
  }
}

/**
 * auditMiddleware — automatically logs every mutating request (POST/PATCH/DELETE)
 * that touches student data, plus all GET requests to sensitive resources.
 */
function auditMiddleware(req, res, next) {
  const sensitive = ['/api/users', '/api/transactions', '/api/purchases', '/api/admin'];
  const isSensitive = sensitive.some(p => req.path.startsWith(p));
  const isMutating  = ['POST','PATCH','PUT','DELETE'].includes(req.method);

  if (!isSensitive && !isMutating) return next();

  // Capture response finish to log outcome
  const origEnd = res.end.bind(res);
  res.end = function(...args) {
    origEnd(...args);
    if (!req.user) return; // not authenticated — login failures handled separately

    const resourceId = req.params?.id || null;
    const action = `${req.method} ${req.path}`;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress;

    writeAudit({
      actorId:   req.user.id,
      actorRole: req.user.role,
      actorName: req.user.username,
      action,
      resource:  req.path,
      resourceId,
      detail:    res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,
      ip,
    });
  };

  next();
}

module.exports = { auditMiddleware, writeAudit };
