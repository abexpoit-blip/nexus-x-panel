const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const {
  authRequired, adminOnly,
  signImpersonationToken, recordSession, setAuthCookie,
} = require('../middleware/auth');
const { logFromReq } = require('../lib/audit');

const router = express.Router();
router.use(authRequired, adminOnly);

// POST /api/admin/login-as/:id — admin starts impersonation
router.post('/login-as/:id', (req, res) => {
  const id = +req.params.id;
  const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'agent'").get(id);
  if (!target) return res.status(404).json({ error: 'Agent not found' });
  if (target.status !== 'active') return res.status(403).json({ error: 'Agent suspended' });

  const token = signImpersonationToken(target, req.user);
  recordSession(target.id, token, req);
  setAuthCookie(res, token);

  logFromReq(req, 'impersonation_start', {
    targetType: 'user', targetId: target.id, meta: { username: target.username },
  });

  const { password_hash, ...safe } = target;
  res.json({ token, user: safe, impersonator: { id: req.user.id, username: req.user.username } });
});

// GET /api/admin/impersonations
router.get('/impersonations', (req, res) => {
  const limit = Math.min(+req.query.limit || 200, 500);
  const rows = db.prepare(`
    SELECT a.id, a.created_at, a.action, a.user_id AS admin_id,
           a.target_id AS agent_id, a.ip, a.meta,
           ua.username AS admin_username,
           ut.username AS agent_username
    FROM audit_logs a
    LEFT JOIN users ua ON ua.id = a.user_id
    LEFT JOIN users ut ON ut.id = a.target_id
    WHERE a.action IN ('impersonation_start', 'impersonation_end')
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(limit);
  res.json({ impersonations: rows });
});

// GET /api/admin/stats — dashboard KPIs
router.get('/stats', (req, res) => {
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const totalAgents = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'agent'").get().c;
  const activeAgents = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'agent' AND status = 'active'").get().c;
  const totalAlloc = db.prepare("SELECT COUNT(*) c FROM allocations").get().c;
  const activeAlloc = db.prepare("SELECT COUNT(*) c FROM allocations WHERE status = 'active'").get().c;
  const totalOtp = db.prepare("SELECT COUNT(*) c FROM cdr WHERE status = 'billed'").get().c;
  const todayOtp = db.prepare("SELECT COUNT(*) c FROM cdr WHERE status = 'billed' AND created_at >= ?").get(todayStart).c;
  const todayRevenue = db.prepare("SELECT COALESCE(SUM(price_bdt),0) s FROM cdr WHERE status = 'billed' AND created_at >= ?").get(todayStart).s;
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(price_bdt),0) s FROM cdr WHERE status = 'billed'").get().s;
  const todayCommission = db.prepare(
    "SELECT COALESCE(SUM(amount_bdt),0) s FROM payments WHERE type = 'credit' AND created_at >= ?"
  ).get(todayStart).s;
  const totalCommission = db.prepare(
    "SELECT COALESCE(SUM(amount_bdt),0) s FROM payments WHERE type = 'credit'"
  ).get().s;
  const pendingWithdrawals = db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status = 'pending'").get().c;

  const since24h = Math.floor(Date.now() / 1000) - 86400;
  const delivered24h = db.prepare(
    "SELECT COUNT(*) c FROM allocations WHERE status='received' AND allocated_at >= ?"
  ).get(since24h).c;
  const expired24h = db.prepare(
    "SELECT COUNT(*) c FROM allocations WHERE status='expired' AND allocated_at >= ?"
  ).get(since24h).c;
  const released24h = db.prepare(
    "SELECT COUNT(*) c FROM allocations WHERE status='released' AND allocated_at >= ?"
  ).get(since24h).c;
  const total24h = delivered24h + expired24h + released24h;
  const successRate24h = total24h > 0 ? +((delivered24h / total24h) * 100).toFixed(1) : 0;

  res.json({
    totalAgents, activeAgents, totalAlloc, activeAlloc,
    totalOtp, todayOtp, todayRevenue, totalRevenue,
    todayCommission, totalCommission, pendingWithdrawals,
    delivered24h, expired24h, released24h, total24h, successRate24h,
  });
});

// GET /api/admin/system-health
router.get('/system-health', (req, res) => {
  const fs = require('fs');
  const path = require('path');

  const mem = process.memoryUsage();
  const uptime_sec = Math.floor(process.uptime());

  let db_size_bytes = 0, db_path = process.env.DB_PATH || './data/nexus.db';
  try {
    const resolved = path.isAbsolute(db_path) ? db_path : path.resolve(process.cwd(), db_path);
    db_size_bytes = fs.statSync(resolved).size;
  } catch (_) {}

  let last_backup = null;
  const backupDir = process.env.BACKUP_DIR || '/opt/nexus/backups';
  try {
    if (fs.existsSync(backupDir)) {
      const files = fs.readdirSync(backupDir)
        .filter((f) => /^nexus-.*\.db(\.gz)?$/.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(backupDir, f));
          return { name: f, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) };
        })
        .sort((a, b) => b.mtime - a.mtime);
      if (files[0]) last_backup = files[0];
    }
  } catch (_) {}

  // Provider bot snapshots
  let seven1tel = null;
  try { seven1tel = require('../workers/seven1telBot').getStatus?.() || null; } catch (_) {}
  let xisora = null;
  try { xisora = require('../workers/xisoraBot').getStatus?.() || null; } catch (_) {}
  let ims = null;
  try { ims = require('../workers/imsBot').getStatus?.() || null; } catch (_) {}
  let smshadi = null;
  try { smshadi = require('../workers/smshadiBot').getStatus?.() || null; } catch (_) {}

  const pendingWithdrawals = db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE status='pending'").get().c;
  const activeSessions = db.prepare("SELECT COUNT(*) c FROM sessions WHERE expires_at > strftime('%s','now')").get().c;

  // JWT secret status (env / persisted-settings / generated)
  let jwt_status = { source: 'unknown', length: 0, strong: false };
  try {
    const fromEnv = process.env.JWT_SECRET || '';
    if (fromEnv && fromEnv.length >= 32) {
      jwt_status = { source: 'env', length: fromEnv.length, strong: true };
    } else {
      const stored = db.prepare("SELECT value FROM settings WHERE key='jwt_secret'").get()?.value || '';
      if (stored && stored.length >= 32) {
        jwt_status = { source: 'settings', length: stored.length, strong: true };
      }
    }
  } catch (_) {}

  // CDR pulse — last real OTP, today's count
  let cdr_pulse = { last_real_at: null, last_any_at: null, total_today: 0 };
  try {
    cdr_pulse.last_real_at = db.prepare(`
      SELECT created_at FROM cdr WHERE COALESCE(note,'') NOT LIKE 'fake:%'
      ORDER BY id DESC LIMIT 1
    `).get()?.created_at || null;
    cdr_pulse.last_any_at = db.prepare(`SELECT created_at FROM cdr ORDER BY id DESC LIMIT 1`).get()?.created_at || null;
    cdr_pulse.total_today = db.prepare(`
      SELECT COUNT(*) AS n FROM cdr
      WHERE created_at >= strftime('%s', 'now', 'start of day')
        AND COALESCE(note,'') NOT LIKE 'fake:%'
    `).get()?.n || 0;
  } catch (_) {}

  let fake_otp = null;
  try { fake_otp = require('../workers/fakeOtpBroadcaster').getStatus?.() || null; } catch (_) {}

  res.json({
    server: {
      uptime_sec,
      node_version: process.version,
      env: process.env.NODE_ENV || 'development',
      memory_mb: {
        rss: +(mem.rss / 1048576).toFixed(1),
        heap_used: +(mem.heapUsed / 1048576).toFixed(1),
        heap_total: +(mem.heapTotal / 1048576).toFixed(1),
      },
      jwt: jwt_status,
    },
    database: {
      size_bytes: db_size_bytes,
      size_mb: +(db_size_bytes / 1048576).toFixed(2),
      path: db_path,
      last_backup,
      backup_dir: backupDir,
    },
    seven1tel_bot: seven1tel,
    xisora_bot: xisora,
    ims_bot: ims,
    smshadi_bot: smshadi,
    fake_otp_bot: fake_otp,
    cdr_pulse,
    counts: {
      pending_withdrawals: pendingWithdrawals,
      active_sessions: activeSessions,
      active_allocations: db.prepare(`SELECT COUNT(*) c FROM allocations WHERE status='active'`).get().c,
    },
  });
});

// GET /api/admin/leaderboard
router.get('/leaderboard', (req, res) => {
  const leaderboard = db.prepare(`
    SELECT u.id, u.username, u.otp_count,
      (SELECT COUNT(*) FROM allocations a WHERE a.user_id = u.id) AS numbers_used,
      (SELECT COALESCE(SUM(price_bdt),0) FROM cdr c WHERE c.user_id = u.id AND c.status='billed') AS earnings_bdt
    FROM users u
    WHERE u.role = 'agent'
    ORDER BY u.otp_count DESC LIMIT 20
  `).all();
  res.json({ leaderboard });
});

// GET /api/admin/agents
router.get('/agents', (req, res) => {
  const agents = db.prepare(`
    SELECT id, username, role, full_name, phone, telegram, balance, otp_count,
           daily_limit, per_request_limit, rl_per_min, rl_concurrent, status, created_at
    FROM users WHERE role = 'agent'
    ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
      created_at DESC
  `).all();
  res.json({ agents });
});

router.post('/agents/:id/approve', (req, res) => {
  const id = +req.params.id;
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'agent'").get(id);
  if (!u) return res.status(404).json({ error: 'Agent not found' });
  if (u.status !== 'pending') return res.status(400).json({ error: 'Agent is not pending' });
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(id);
  db.prepare(`
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (?, 'Account approved', 'Your account has been approved by an admin. You can now log in.', 'success')
  `).run(id);
  logFromReq(req, 'agent_approved', { targetType: 'user', targetId: id, meta: { username: u.username } });
  res.json({ ok: true });
});

router.post('/agents/:id/reject', (req, res) => {
  const id = +req.params.id;
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'agent' AND status = 'pending'").get(id);
  if (!u) return res.status(404).json({ error: 'Pending agent not found' });
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  logFromReq(req, 'agent_rejected', { targetType: 'user', targetId: id, meta: { username: u.username } });
  res.json({ ok: true });
});

router.post('/agents', (req, res) => {
  const { username, password, full_name, phone, telegram, daily_limit = 500, per_request_limit = 500, status = 'active' } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Username already taken' });
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, phone, telegram, daily_limit, per_request_limit, status)
    VALUES (?, ?, 'agent', ?, ?, ?, ?, ?, ?)
  `).run(username, hash, full_name || null, phone || null, telegram || null, daily_limit, per_request_limit, status);
  logFromReq(req, 'agent_created', { targetType: 'user', targetId: result.lastInsertRowid, meta: { username } });
  const agent = db.prepare('SELECT id, username, role, full_name, balance, status FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ agent });
});

router.patch('/agents/:id', (req, res) => {
  const id = +req.params.id;
  const allowed = ['full_name', 'phone', 'telegram', 'daily_limit', 'per_request_limit', 'rl_per_min', 'rl_concurrent', 'status', 'balance'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (k in req.body) {
      sets.push(`${k} = ?`);
      vals.push(
        k === 'balance' ? +req.body[k] || 0 :
        (k === 'rl_per_min' || k === 'rl_concurrent')
          ? (req.body[k] === '' || req.body[k] == null ? null : +req.body[k] || null)
          : req.body[k]
      );
    }
  }
  if (req.body.password) {
    sets.push('password_hash = ?');
    vals.push(bcrypt.hashSync(req.body.password, 10));
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  vals.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND role = 'agent'`).run(...vals);
  logFromReq(req, 'agent_updated', { targetType: 'user', targetId: id, meta: req.body });
  res.json({ ok: true });
});

router.delete('/agents/:id', (req, res) => {
  const id = +req.params.id;
  db.prepare("DELETE FROM users WHERE id = ? AND role = 'agent'").run(id);
  logFromReq(req, 'agent_deleted', { targetType: 'user', targetId: id });
  res.json({ ok: true });
});

router.get('/allocations', (req, res) => {
  const allocations = db.prepare(`
    SELECT a.*, u.username FROM allocations a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.allocated_at DESC LIMIT 500
  `).all();
  res.json({ allocations });
});

router.get('/commission-trend', (req, res) => {
  const days = Math.min(Math.max(+req.query.days || 14, 1), 60);
  const now = new Date();
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const start = Math.floor(d.getTime() / 1000);
    const end = start + 86400;
    const row = db.prepare(
      "SELECT COALESCE(SUM(amount_bdt),0) s, COUNT(*) c FROM payments WHERE type = 'credit' AND created_at >= ? AND created_at < ?"
    ).get(start, end);
    series.push({
      label: d.toISOString().slice(5, 10),
      value: Math.round(row.s * 100) / 100,
      count: row.c,
    });
  }
  res.json({ series });
});

// =============================================================
// Fake OTP Broadcaster — admin-only realism layer
// =============================================================
const fakeBot = require('../workers/fakeOtpBroadcaster');

router.get('/fake-otp', (req, res) => {
  const status = fakeBot.getStatus();
  // Live count from DB
  const count = db.prepare("SELECT COUNT(*) c FROM cdr WHERE note='fake:broadcast'").get().c;
  res.json({ ...status, total_in_db: count });
});

router.put('/fake-otp', (req, res) => {
  const { enabled, min_sec, max_sec, burst, services, range_ids } = req.body || {};
  const set = (key, val) => db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%s','now')
  `).run(key, String(val));
  if (typeof enabled === 'boolean') set('fake_otp_enabled', enabled);
  if (Number.isFinite(+min_sec))    set('fake_otp_min_sec', Math.max(5, +min_sec));
  if (Number.isFinite(+max_sec))    set('fake_otp_max_sec', Math.max(10, +max_sec));
  if (Number.isFinite(+burst))      set('fake_otp_burst',   Math.max(1, Math.min(5, +burst)));
  if (services !== undefined) {
    // Accept array, csv string, or 'all'
    let v;
    if (Array.isArray(services)) v = services.length ? services.map(s => String(s).toLowerCase()).join(',') : 'all';
    else if (typeof services === 'string') v = services.trim() || 'all';
    else v = 'all';
    set('fake_otp_services', v);
  }
  if (range_ids !== undefined) {
    const ids = Array.isArray(range_ids)
      ? range_ids.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n) && n > 0)
      : String(range_ids || '').split(',').map(n => parseInt(n, 10)).filter(n => Number.isFinite(n) && n > 0);
    set('fake_otp_range_ids', ids.join(','));
  }
  logFromReq(req, 'fake_otp_settings_updated', { meta: req.body });
  res.json({ ok: true });
});

router.post('/fake-otp/fire', (req, res) => {
  // Manual "fire one now" — useful for previewing in CDR feed
  const ok = fakeBot.insertOne();
  logFromReq(req, 'fake_otp_manual_fire', {});
  res.json({ ok });
});

router.post('/fake-otp/purge', (req, res) => {
  const removed = fakeBot.purgeAll();
  logFromReq(req, 'fake_otp_purged', { meta: { removed } });
  res.json({ ok: true, removed });
});

// =============================================================
// Unified Bots Control — status + start/stop/restart for every worker
// =============================================================
function loadBots() {
  const bots = {};
  try { bots.seven1tel = require('../workers/seven1telBot'); } catch (_) {}
  try { bots.xisora    = require('../workers/xisoraBot'); } catch (_) {}
  try { bots.ims       = require('../workers/imsBot'); } catch (_) {}
  try { bots.smshadi   = require('../workers/smshadiBot'); } catch (_) {}
  try { bots.fake_otp = require('../workers/fakeOtpBroadcaster'); } catch (_) {}
  return bots;
}

const BOT_LABELS = {
  seven1tel: { name: 'Seven1Tel Bot',         desc: 'Scrapes seven1tel SMS portal for live OTPs' },
  xisora:    { name: 'XISORA Bot',            desc: 'Polls XISORA API or portal-cookie MDR fallback for live OTPs' },
  ims:       { name: 'IMS Bot',               desc: 'Scrapes imssms.org CDR for live OTPs (15s rate-limit aware)' },
  smshadi:   { name: 'SMS Hadi Bot',          desc: 'Scrapes 2.59.169.96/ints (SMS Hadi) CDR — no rate-limit, sesskey AJAX' },
  fake_otp:  { name: 'Fake OTP Broadcaster',  desc: 'Synthetic CDR rows to keep the public feed warm' },
};

router.get('/bots', (req, res) => {
  const bots = loadBots();
  const out = {};
  for (const [key, mod] of Object.entries(bots)) {
    let status = null;
    try { status = mod.getStatus?.() || null; } catch (e) { status = { error: e.message }; }
    out[key] = {
      key,
      label: BOT_LABELS[key]?.name || key,
      description: BOT_LABELS[key]?.desc || '',
      status,
    };
  }
  res.json({ bots: out });
});

router.post('/bots/:bot/:action(start|stop|restart)', (req, res) => {
  const { bot, action } = req.params;
  const bots = loadBots();
  const mod = bots[bot];
  if (!mod) return res.status(404).json({ error: `Unknown bot: ${bot}` });
  // Map bot key → settings flag the worker reads on start().
  // Clicking Start must persist enabled=true so the worker's internal
  // `cfg.ENABLED` check passes; Stop must persist enabled=false so it
  // does not auto-resume on next tick / restart.
  const ENABLED_KEY = {
    seven1tel: 'seven1tel_enabled',
    xisora:    'xisora_enabled',
    ims:       'ims_enabled',
    smshadi:   'smshadi_enabled',
    fake_otp:  'fake_otp_enabled',
  }[bot];
  const setFlag = (val) => {
    if (!ENABLED_KEY) return;
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%s','now')
    `).run(ENABLED_KEY, String(!!val));
  };
  try {
    if (action === 'start') {
      if (typeof mod.start !== 'function') throw new Error('bot does not support start');
      setFlag(true);
      mod.start();
    } else if (action === 'stop') {
      if (typeof mod.stop !== 'function') throw new Error('bot does not support stop');
      setFlag(false);
      mod.stop();
    } else if (action === 'restart') {
      try { mod.stop?.(); } catch (_) {}
      setFlag(true);
      // Small delay so the worker tick can drain before restarting.
      setTimeout(() => { try { mod.start?.(); } catch (_) {} }, 500);
    }
    logFromReq(req, `bot_${action}`, { meta: { bot } });
    res.json({ ok: true, bot, action });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health probe — actually attempts a login() against the live portal and
// reports OK / failure reason. Use this from the Settings UI before saving.
router.post('/bots/:bot/health', async (req, res) => {
  const { bot } = req.params;
  const bots = loadBots();
  const mod = bots[bot];
  if (!mod) return res.status(404).json({ error: `Unknown bot: ${bot}` });
  if (typeof mod.login !== 'function') {
    return res.status(400).json({ error: 'bot does not support health check' });
  }
  const t0 = Date.now();
  try {
    await mod.login();
    const status = mod.getStatus?.() || {};
    logFromReq(req, 'bot_health_ok', { meta: { bot, ms: Date.now() - t0 } });
    res.json({ ok: true, bot, ms: Date.now() - t0, status });
  } catch (e) {
    logFromReq(req, 'bot_health_fail', { meta: { bot, error: e.message } });
    res.status(200).json({ ok: false, bot, ms: Date.now() - t0, error: e.message });
  }
});

// POST /api/admin/bots/:bot/ping
// Live-tests the actual CDR scrape endpoint (not just login). Returns latency,
// delivered-rows count from this tick, and last_otp_at from worker status.
// Use this when agents complain "no OTPs are arriving" — it confirms whether
// the provider's AJAX endpoint is reachable, returning data, and whether any
// row matched an active allocation.
router.post('/bots/:bot/ping', async (req, res) => {
  const { bot } = req.params;
  const bots = loadBots();
  const mod = bots[bot];
  if (!mod) return res.status(404).json({ error: `Unknown bot: ${bot}` });
  if (typeof mod.tickOnce !== 'function') {
    return res.status(400).json({ error: 'bot does not support scrape ping' });
  }
  const t0 = Date.now();
  try {
    const delivered = await mod.tickOnce();
    const status = mod.getStatus?.() || {};
    logFromReq(req, 'bot_ping_ok', { meta: { bot, ms: Date.now() - t0, delivered } });
    res.json({
      ok: true, bot, ms: Date.now() - t0,
      delivered: typeof delivered === 'number' ? delivered : null,
      last_otp_at: status.last_otp_at || null,
      last_login_at: status.last_login_at || null,
      consec_fail: status.consec_fail || 0,
    });
  } catch (e) {
    logFromReq(req, 'bot_ping_fail', { meta: { bot, error: e.message } });
    res.status(200).json({ ok: false, bot, ms: Date.now() - t0, error: e.message });
  }
});

// GET /api/admin/bots/:bot/logs?level=error|warn|miss|all&limit=80
// Returns the failure-only event ring captured by the bot's Telemetry.
// Used by Provider Ranges → "Logs" dialog so admins can see *why* an OTP
// from a specific provider didn't reach an agent (e.g. "no active alloc",
// scrape errors, login failures) without trawling pm2 logs.
router.get('/bots/:bot/logs', (req, res) => {
  const { bot } = req.params;
  const bots = loadBots();
  const mod = bots[bot];
  if (!mod) return res.status(404).json({ error: `Unknown bot: ${bot}` });
  const status = (typeof mod.getStatus === 'function' ? mod.getStatus() : {}) || {};
  const all = Array.isArray(status.events) ? status.events : [];
  const level = String(req.query.level || 'all').toLowerCase();
  const limit = Math.min(200, Math.max(1, +req.query.limit || 80));
  const filtered = (level === 'all' ? all : all.filter(e => e.level === level)).slice(0, limit);
  res.json({
    bot,
    events: filtered,
    counters: {
      total_misses: status.total_misses || 0,
      total_delivered: status.total_delivered || 0,
      consec_fail: status.consec_fail || 0,
      last_otp_at: status.last_otp_at || null,
      last_login_at: status.last_login_at || null,
    },
  });
});

// =============================================================
// SMS Hadi — admin OTP history (SMSCDRReports proxy with paging)
// No 15s rate-limit on this panel, so we can serve filtered pages live.
// =============================================================
router.get('/smshadi/cdr', async (req, res) => {
  let mod;
  try { mod = require('../workers/smshadiBot'); }
  catch (e) { return res.status(500).json({ error: 'smshadi worker not loaded: ' + e.message }); }
  if (typeof mod.fetchCdrPage !== 'function') {
    return res.status(500).json({ error: 'smshadi worker missing fetchCdrPage' });
  }
  const page = Math.max(1, +req.query.page || 1);
  const pageSize = Math.max(10, Math.min(200, +req.query.page_size || 50));
  try {
    const out = await mod.fetchCdrPage({
      fdate1: req.query.from || '',
      fdate2: req.query.to || '',
      fnum:   req.query.number || '',
      fcli:   req.query.cli || '',
      frange: req.query.range || '',
      start:  (page - 1) * pageSize,
      length: pageSize,
    });
    res.json({
      rows: out.rows,
      page, page_size: pageSize,
      total: out.total,
      filtered: out.filtered,
      total_pages: Math.max(1, Math.ceil(out.filtered / pageSize)),
    });
  } catch (e) {
    res.status(502).json({ error: e.message || String(e) });
  }
});


// =============================================================
// GET /api/admin/otp-audit — end-to-end OTP audit log.
// Query: ?source=ims&outcome=mismatch&phone=...&limit=200&offset=0
// =============================================================
router.get('/otp-audit', (req, res) => {
  const limit  = Math.min(500, Math.max(1, +req.query.limit  || 100));
  const offset = Math.max(0, +req.query.offset || 0);
  const where = []; const args = [];
  if (req.query.source)  { where.push('source = ?');         args.push(String(req.query.source)); }
  if (req.query.outcome) { where.push('outcome = ?');        args.push(String(req.query.outcome)); }
  if (req.query.phone)   { where.push('phone_number LIKE ?'); args.push(`%${String(req.query.phone).replace(/\D/g,'')}%`); }
  if (req.query.since)   { where.push('created_at >= ?');    args.push(+req.query.since); }
  const sql = `SELECT * FROM otp_audit_log
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...args, limit, offset);
  const counts = db.prepare(`
    SELECT outcome, COUNT(*) AS n FROM otp_audit_log
    WHERE created_at >= strftime('%s','now') - 86400 GROUP BY outcome
  `).all();
  res.json({ rows, counts_24h: counts, limit, offset });
});

module.exports = router;
