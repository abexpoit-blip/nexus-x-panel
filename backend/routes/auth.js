const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const {
  signToken, recordSession, authRequired, hashToken,
  setAuthCookie, clearAuthCookie, signImpersonationToken,
} = require('../middleware/auth');
const { log, logFromReq } = require('../lib/audit');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (username.length > 64 || password.length > 200) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    log({ action: 'login_failed', ip: req.ip, meta: { username: username.slice(0, 32) } });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    log({ userId: user.id, action: 'login_failed', ip: req.ip });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.status === 'pending') {
    return res.status(403).json({ error: 'Your account is pending admin approval. Please wait for approval before logging in.' });
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'Account suspended' });

  const token = signToken(user);
  recordSession(user.id, token, req);
  setAuthCookie(res, token);                                   // ⬅ httpOnly cookie
  log({ userId: user.id, action: 'login', ip: req.ip, userAgent: req.headers['user-agent'] });

  const { password_hash, ...safe } = user;
  res.json({ token, user: safe });                             // token also returned for legacy clients
});

// POST /api/auth/register
router.post('/register', (req, res) => {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'signup_enabled'").get();
  if (setting?.value !== 'true') return res.status(403).json({ error: 'Registration disabled' });

  const { username, password, full_name, phone, telegram } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username: 3-32 chars, alphanumeric + underscore only' });
  }
  if (password.length < 5 || password.length > 200) {
    return res.status(400).json({ error: 'Password must be 5-200 characters' });
  }
  if (full_name && (typeof full_name !== 'string' || full_name.length > 120)) {
    return res.status(400).json({ error: 'Invalid full_name' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Username already taken' });

  const hash = bcrypt.hashSync(password, 10);
  // Read admin-configured defaults at signup time so new agents are NOT
  // pinned to the original column DEFAULT (some legacy DBs had 100 / 5).
  const readSetting = (k) => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
  const dailyDefault  = Math.max(1, +(readSetting('daily_limit_default')     || 500));
  const perReqDefault = Math.max(1, +(readSetting('per_request_max_default') || 5));
  // Admin can flip this to auto-approve new signups (status='active', direct login)
  const autoApprove = readSetting('auto_approve_signups') === 'true';
  const initialStatus = autoApprove ? 'active' : 'pending';
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, phone, telegram, status, daily_limit, per_request_limit)
    VALUES (?, ?, 'agent', ?, ?, ?, ?, ?, ?)
  `).run(username, hash, full_name || null, phone || null, telegram || null, initialStatus, dailyDefault, perReqDefault);

  log({
    userId: result.lastInsertRowid,
    action: autoApprove ? 'register_auto_approved' : 'register_pending',
    ip: req.ip,
    meta: { username },
  });

  // Notify all admins about the new pending signup
  try {
    const admins = db.prepare("SELECT id FROM users WHERE role='admin'").all();
    const ins = db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, 'info')");
    for (const a of admins) {
      ins.run(
        a.id,
        autoApprove ? 'New agent signup (auto-approved)' : 'New agent signup',
        `${username} (${full_name || 'no name'})${autoApprove ? ' joined.' : ' is awaiting approval.'}`,
      );
    }
  } catch (e) { console.warn('admin notify failed:', e.message); }

  if (autoApprove) {
    // Auto-approve flow — issue token + cookie so the user is logged in directly.
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = signToken(user);
    recordSession(user.id, token, req);
    setAuthCookie(res, token);
    const { password_hash, ...safe } = user;
    return res.status(201).json({
      pending: false,
      token,
      user: safe,
      message: 'Account created — you are now signed in.',
    });
  }

  // Manual-approval flow — agent waits for admin
  res.status(201).json({
    pending: true,
    message: 'Your account has been created and is awaiting admin approval. You will be notified once approved.',
  });
});

// GET /api/auth/me — also returns impersonator info if applicable
router.get('/me', authRequired, (req, res) => {
  const { password_hash, ...safe } = req.user;
  res.json({
    user: safe,
    impersonator: req.impersonator || null,
  });
});

// POST /api/auth/logout
router.post('/logout', authRequired, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(req.token));
  clearAuthCookie(res);
  logFromReq(req, 'logout');
  res.json({ ok: true });
});

// POST /api/auth/exit-impersonation — restore original admin
router.post('/exit-impersonation', authRequired, (req, res) => {
  if (!req.impersonator) return res.status(400).json({ error: 'Not impersonating' });
  const admin = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(req.impersonator.id);
  if (!admin) return res.status(404).json({ error: 'Original admin not found' });

  const token = signToken(admin);
  recordSession(admin.id, token, req);
  setAuthCookie(res, token);

  logFromReq(req, 'impersonation_end', {
    targetType: 'user', targetId: req.user.id, meta: { agent: req.user.username },
  });

  const { password_hash, ...safe } = admin;
  res.json({ token, user: safe });
});

// POST /api/auth/change-password — any authenticated user changes their own password
router.post('/change-password', authRequired, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof current_password !== 'string' || typeof new_password !== 'string') {
    return res.status(400).json({ error: 'current_password and new_password required' });
  }
  if (new_password.length < 5 || new_password.length > 200) {
    return res.status(400).json({ error: 'New password must be 5-200 characters' });
  }
  if (new_password === current_password) {
    return res.status(400).json({ error: 'New password must differ from current' });
  }
  if (!bcrypt.compareSync(current_password, req.user.password_hash)) {
    logFromReq(req, 'password_change_failed');
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);

  // Revoke all OTHER sessions on this account (keep current session alive)
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
    .run(req.user.id, hashToken(req.token));

  logFromReq(req, 'password_changed');
  res.json({ ok: true, message: 'Password changed. Other devices have been signed out.' });
});

module.exports = router;
