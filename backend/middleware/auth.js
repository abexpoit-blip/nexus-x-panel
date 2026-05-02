// JWT authentication middleware
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../lib/db');

// ── JWT_SECRET resolution ────────────────────────────────────────────────
// Priority:
//   1) process.env.JWT_SECRET (when set AND >= 32 chars)         → use it
//   2) settings.jwt_secret in SQLite (auto-generated, persisted) → use it
//   3) Generate a new 96-char hex secret, persist it to settings → use it
//
// This means a fresh VPS deploy never needs a manual .env edit:
// the backend self-heals on first boot and keeps the same secret across
// restarts. JWT_SECRET in .env still wins if you want rotation control.
function resolveJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) return { secret: fromEnv, source: 'env' };

  let stored = null;
  try {
    stored = db.prepare("SELECT value FROM settings WHERE key='jwt_secret'").get()?.value || null;
  } catch (_) { /* settings table may not exist yet on very first boot */ }

  if (stored && stored.length >= 32) return { secret: stored, source: 'settings' };

  const generated = crypto.randomBytes(48).toString('hex'); // 96 hex chars
  try {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('jwt_secret', ?, strftime('%s','now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%s','now')
    `).run(generated);
    console.log('🔐 JWT_SECRET auto-generated and persisted to settings.jwt_secret');
  } catch (e) {
    console.error('⚠️  Could not persist auto-generated JWT_SECRET:', e.message);
  }
  return { secret: generated, source: 'generated' };
}

const { secret: SECRET, source: SECRET_SOURCE } = resolveJwtSecret();
if (SECRET_SOURCE !== 'env') {
  console.log(`🔐 JWT_SECRET source: ${SECRET_SOURCE} (length=${SECRET.length})`);
}

function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: '30d' }
  );
}

function recordSession(userId, token, req) {
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  db.prepare(`
    INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, hashToken(token), req.ip || null, req.headers['user-agent'] || null, expiresAt);
}

// Cookie name used for httpOnly JWT
const COOKIE_NAME = 'nexus_token';

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,                    // HTTPS only in prod
    sameSite: isProd ? 'lax' : 'lax',  // 'lax' works for top-level navigations + same-site XHR
    path: '/',
    maxAge: 30 * 24 * 3600 * 1000,     // 30 days
  };
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
}

function extractToken(req) {
  // Priority: cookie > Authorization header (so cookie clients win seamlessly)
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function authRequired(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.status === 'pending') return res.status(403).json({ error: 'Account pending admin approval' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account suspended' });
    req.user = user;
    req.token = token;
    // Pass impersonation context (set by login-as)
    if (payload.act) req.impersonator = payload.act; // { id, username }

    // Update session last_seen (best effort)
    db.prepare("UPDATE sessions SET last_seen_at = strftime('%s','now') WHERE token_hash = ?")
      .run(hashToken(token));

    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function signImpersonationToken(targetUser, adminUser) {
  return jwt.sign(
    {
      sub: targetUser.id,
      username: targetUser.username,
      role: targetUser.role,
      act: { id: adminUser.id, username: adminUser.username }, // "actor" claim
    },
    SECRET,
    { expiresIn: '2h' }   // shorter for safety
  );
}

module.exports = {
  authRequired, adminOnly, signToken, recordSession, hashToken,
  JWT_SECRET: SECRET, COOKIE_NAME, setAuthCookie, clearAuthCookie,
  extractToken, signImpersonationToken,
};
