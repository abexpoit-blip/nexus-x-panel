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
  return {
    enabled,
    minSec: Math.max(5, +readSetting('fake_otp_min_sec', '15')),
    maxSec: Math.max(10, +readSetting('fake_otp_max_sec', '90')),
    burst:  Math.max(1, Math.min(5, +readSetting('fake_otp_burst', '1'))),
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
function pickRangeAndPhone() {
  // Prefer enabled provider_ranges with a range_prefix set, fallback to country_code only.
  const ranges = db.prepare(`
    SELECT provider, country_code, country_name, range_label, range_prefix, operator, price_bdt
    FROM provider_ranges
    WHERE enabled = 1
    ORDER BY RANDOM() LIMIT 1
  `).all();
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
function insertOne() {
  const pick1 = pickRangeAndPhone();
  if (!pick1) { dlog('no enabled provider_ranges → skip'); return false; }
  const { row, phone } = pick1;
  const svc = pick(SERVICES);
  const otp = svc.otp();
  const msg = svc.msg(otp);

  // Use admin user_id (= 1). If the seeded admin id differs, look it up.
  const adminId = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get()?.id;
  if (!adminId) { dlog('no admin user → skip'); return false; }

  db.prepare(`
    INSERT INTO cdr (user_id, allocation_id, provider, country_code, operator,
                     phone_number, otp_code, cli, price_bdt, status, note)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0, 'billed', 'fake:broadcast')
  `).run(
    adminId, row.provider, row.country_code, row.operator || row.range_label,
    phone, otp, svc.cli
  );
  dlog(`✓ fake [${row.country_code}/${row.operator || row.range_label}] ${phone} → ${svc.cli}:${otp}`);
  return true;
}

// ────────────────────── Loop ──────────────────────
let _running = false;
let _stopFlag = false;
let _lastFireAt = null;
let _totalFired = 0;

async function loop() {
  if (_running) return;
  _running = true;
  while (!_stopFlag) {
    const c = cfg();
    if (!c.enabled) {
      // Idle check every 10s while disabled (so re-enabling is responsive)
      await new Promise(r => setTimeout(r, 10_000));
      continue;
    }
    try {
      const burst = 1 + Math.floor(Math.random() * c.burst);
      for (let i = 0; i < burst; i++) {
        if (insertOne()) {
          _totalFired++;
          _lastFireAt = Math.floor(Date.now() / 1000);
        }
        if (i < burst - 1) await new Promise(r => setTimeout(r, 600 + Math.random() * 1400));
      }
    } catch (e) { warn('insertOne error:', e.message); }

    // Sleep a randomized interval in [min, max]
    const sleepSec = c.minSec + Math.random() * (c.maxSec - c.minSec);
    await new Promise(r => setTimeout(r, sleepSec * 1000));
  }
  _running = false;
}

function start() {
  if (_running) { log('already running — skip start'); return; }
  _stopFlag = false;
  log('starting (will idle until fake_otp_enabled=true)…');
  loop().catch(e => warn('fatal:', e.message));
}
function stop() { _stopFlag = true; }
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
  };
}

// Admin "purge fakes" — remove all rows we ever inserted.
function purgeAll() {
  const r = db.prepare("DELETE FROM cdr WHERE note = 'fake:broadcast'").run();
  return r.changes || 0;
}

module.exports = { start, stop, getStatus, insertOne, purgeAll };
