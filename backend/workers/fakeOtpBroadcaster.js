// Fake OTP Broadcaster — generates realistic-looking OTP activity in the
// public CDR feed (`/api/cdr/feed`) so agents believe the platform is busy
// and which ranges are "hot" right now. Fakes are:
//
//   • Marked with note='fake:broadcast' (hidden from admin CDR view by toggle)
//   • Owned by admin user_id=1 (NEVER credit a real agent)
//   • Use REAL phone prefixes from enabled provider_ranges (so range labels match)
//   • Use REAL service names (WhatsApp, Telegram, Facebook, Google, etc.)
//   • Use REAL OTP formats (6-digit, 4-digit, alphanumeric for some services)
//   • Spread randomly between settings.fake_otp_min_sec and fake_otp_max_sec
//   • Optional burst mode: every cycle drops 1-{burst} fakes back-to-back
//
// Settings (DB key=value):
//   fake_otp_enabled        true|false   (default false)
//   fake_otp_min_sec        15           (min seconds between fakes)
//   fake_otp_max_sec        90           (max seconds between fakes)
//   fake_otp_burst          1            (max fakes per tick, 1=single)

const db = require('../lib/db');
const { Telemetry } = require('./_botTelemetry');
const tel = new Telemetry();

const QUIET = process.env.NODE_ENV === 'production';
const log  = (...a) => console.log('[fake-otp]', ...a);
const dlog = (...a) => { if (!QUIET) console.log('[fake-otp]', ...a); };
const warn = (...a) => console.warn('[fake-otp]', ...a);

function readSetting(key, fallback) {
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return r?.value ?? fallback;
  } catch { return fallback; }
}
function cfg() {
  const enabled = (readSetting('fake_otp_enabled', 'false') === 'true');
  const servicesRaw = String(readSetting('fake_otp_services', 'all') || 'all').trim();
  const services = servicesRaw === '' || servicesRaw.toLowerCase() === 'all'
    ? null
    : servicesRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const rangeIdsRaw = String(readSetting('fake_otp_range_ids', '') || '').trim();
  const rangeIds = rangeIdsRaw
    ? rangeIdsRaw.split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0)
    : null;
  return {
    enabled,
    minSec: Math.max(5, +readSetting('fake_otp_min_sec', '15')),
    maxSec: Math.max(10, +readSetting('fake_otp_max_sec', '90')),
    burst:  Math.max(1, Math.min(5, +readSetting('fake_otp_burst', '1'))),
    services, rangeIds,
  };
}

// ────────────────────── Realism: services & message templates ──────────────────────
//
// Each service has:
//   cli      — sender ID exactly as it shows in real CDRs
//   pattern  — function returning a realistic OTP code
//   msg      — function returning a realistic message body
//
const SERVICES = [
  { cli: 'WhatsApp', otp: () => digits(6),
    msg: (o) => `Your WhatsApp code: ${o}\n\nDon't share this code\n4sgLq1p5sV6` },
  { cli: 'Telegram', otp: () => digits(5),
    msg: (o) => `Telegram code: ${o}\n\nYou can also tap on this link to cancel your password: https://t.me/login/${o}` },
  { cli: 'Facebook', otp: () => digits(6),
    msg: (o) => `${o} is your Facebook confirmation code` },
  { cli: 'Google', otp: () => `G-${digits(6)}`,
    msg: (o) => `${o} is your Google verification code` },
  { cli: 'Instagram', otp: () => digits(6),
    msg: (o) => `${o} is your Instagram code. Don't share it.` },
  { cli: 'TikTok', otp: () => digits(6),
    msg: (o) => `[TikTok] ${o} is your verification code, valid for 5 minutes. To keep your account safe, never forward this code.` },
  { cli: 'Apple', otp: () => digits(6),
    msg: (o) => `Your Apple ID Code is: ${o}. Do not share it with anyone.` },
  { cli: 'Microsoft', otp: () => digits(7),
    msg: (o) => `Use the code ${o} for Microsoft authentication.` },
  { cli: 'Amazon', otp: () => digits(6),
    msg: (o) => `${o} is your Amazon OTP. Do not share it with anyone.` },
  { cli: 'Uber', otp: () => digits(4),
    msg: (o) => `Your Uber code is ${o}. Never share this code.` },
  { cli: 'Discord', otp: () => digits(6),
    msg: (o) => `Your Discord verification code is: ${o}` },
  { cli: 'Signal', otp: () => digits(6),
    msg: (o) => `Your Signal verification code: ${o}\n\nDo not share this code` },
  { cli: 'Twitter', otp: () => digits(6),
    msg: (o) => `Your Twitter confirmation code is ${o}.` },
  { cli: 'PayPal', otp: () => digits(6),
    msg: (o) => `PayPal: Your security code is ${o}. Your code expires in 10 minutes. Please don't reply.` },
];

function digits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ────────────────────── Pull a realistic phone number from enabled ranges ──────────────────────
function pickRangeAndPhone(rangeIds) {
  // If admin restricted to specific range IDs, honour them; else any enabled range.
  let ranges;
  if (rangeIds && rangeIds.length) {
    const placeholders = rangeIds.map(() => '?').join(',');
    ranges = db.prepare(`
      SELECT provider, country_code, country_name, range_label, range_prefix, operator, price_bdt
      FROM provider_ranges
      WHERE enabled = 1 AND id IN (${placeholders})
      ORDER BY RANDOM() LIMIT 1
    `).all(...rangeIds);
  } else {
    ranges = db.prepare(`
      SELECT provider, country_code, country_name, range_label, range_prefix, operator, price_bdt
      FROM provider_ranges
      WHERE enabled = 1
      ORDER BY RANDOM() LIMIT 1
    `).all();
  }
  if (!ranges.length) return null;
  const r = ranges[0];

  // Build a phone: range_prefix (digits only) + random tail to total ~10-13 digits.
  const prefix = String(r.range_prefix || '').replace(/\D/g, '');
  const target = 11 + Math.floor(Math.random() * 3);   // 11..13 digit total
  const tailLen = Math.max(4, target - prefix.length);
  const phone = prefix + digits(tailLen);
  return { row: r, phone };
}

// ────────────────────── Insert one fake CDR ──────────────────────
function insertOne(opts = {}) {
  const c = cfg();
  const rangeIds = opts.rangeIds || c.rangeIds;
  const allowedServices = opts.services || c.services;   // null = all
  const pick1 = pickRangeAndPhone(rangeIds);
  if (!pick1) { dlog('no enabled provider_ranges → skip'); return false; }
  const { row, phone } = pick1;
  const pool = allowedServices && allowedServices.length
    ? SERVICES.filter(s => allowedServices.includes(s.cli.toLowerCase()))
    : SERVICES;
  const svc = pick(pool.length ? pool : SERVICES);
  const otp = svc.otp();
  const msg = svc.msg(otp);

  // Route every fake through the "Nexus Telegram" virtual agent so the
  // public feed + leaderboard show one consistent branded name. Fall back
  // to admin id if the seed didn't run yet.
  const ownerId = db.prepare("SELECT id FROM users WHERE username = 'Nexus Telegram'").get()?.id
    ?? db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get()?.id;
  if (!ownerId) { dlog('no fake-owner user → skip'); return false; }

  db.prepare(`
    INSERT INTO cdr (user_id, allocation_id, provider, country_code, operator,
                     phone_number, otp_code, cli, price_bdt, status, note, sms_text)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0, 'billed', 'fake:broadcast', ?)
  `).run(
    ownerId, row.provider, row.country_code, row.operator || row.range_label,
    phone, otp, svc.cli, msg
  );
  dlog(`✓ fake [${row.country_code}/${row.operator || row.range_label}] ${phone} → ${svc.cli}:${otp}`);
  return true;
}

// ────────────────────── Loop ──────────────────────
let _running = false;
let _stopFlag = false;
let _lastFireAt = null;
let _totalFired = 0;
let _wakeResolve = null;   // lets start() interrupt the idle/sleep wait

function sleepInterruptible(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { _wakeResolve = null; resolve(); }, ms);
    _wakeResolve = () => { clearTimeout(t); _wakeResolve = null; resolve(); };
  });
}
function wake() { if (_wakeResolve) try { _wakeResolve(); } catch {} }

async function loop() {
  if (_running) return;
  _running = true;
  while (!_stopFlag) {
    const c = cfg();
    if (!c.enabled) {
      // Idle while disabled — wake immediately when start() flips the flag
      await sleepInterruptible(10_000);
      continue;
    }
    try {
      const burst = 1 + Math.floor(Math.random() * c.burst);
      for (let i = 0; i < burst; i++) {
        if (insertOne()) {
          _totalFired++;
          _lastFireAt = Math.floor(Date.now() / 1000);
          tel.recordOtpDelivered();
        }
        if (i < burst - 1) await new Promise(r => setTimeout(r, 600 + Math.random() * 1400));
      }
      tel.recordTick();
    } catch (e) {
      warn('insertOne error:', e.message);
      tel.recordError(e.message);
    }

    // Sleep a randomized interval in [min, max]
    const sleepSec = c.minSec + Math.random() * (c.maxSec - c.minSec);
    await sleepInterruptible(sleepSec * 1000);
  }
  _running = false;
}

function start() {
  _stopFlag = false;
  if (_running) {
    // Loop already alive — wake it so it picks up the new enabled flag now
    log('already running — waking idle loop');
    wake();
    return;
  }
  log('starting (will idle until fake_otp_enabled=true)…');
  loop().catch(e => warn('fatal:', e.message));
}
function stop() { _stopFlag = true; wake(); }
function getStatus() {
  const c = cfg();
  return {
    enabled: c.enabled,
    running: _running,
    last_fire_at: _lastFireAt,
    total_fired: _totalFired,
    min_sec: c.minSec,
    max_sec: c.maxSec,
    burst: c.burst,
    services: c.services,        // null = all
    range_ids: c.rangeIds || [],
    ...tel.snapshot(),
  };
}

// Admin "purge fakes" — remove all rows we ever inserted.
function purgeAll() {
  const r = db.prepare("DELETE FROM cdr WHERE note = 'fake:broadcast'").run();
  return r.changes || 0;
}

module.exports = { start, stop, getStatus, insertOne, purgeAll };
