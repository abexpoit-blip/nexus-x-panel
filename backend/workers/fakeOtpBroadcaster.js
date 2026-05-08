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
// Random alphanumeric token like "H7QFsnxSr" used in real Facebook/Google
// password-reset SMS as a tracking suffix.
function token(n) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Each service has multiple realistic message variants (login + reset/recovery)
// to mirror what real provider portals scrape. msgs() returns a randomly
// chosen variant for the given OTP.
const SERVICES = [
  { cli: 'WhatsApp', otp: () => digits(6), msgs: (o) => [
    `Your WhatsApp code: ${o}\n\nDon't share this code\n4sgLq1p5sV6`,
    `<#> ${o} is your WhatsApp code\n\n4sgLq1p5sV6`,
  ]},
  { cli: 'Telegram', otp: () => digits(5), msgs: (o) => [
    `Telegram code: ${o}\n\nYou can also tap on this link to cancel your password: https://t.me/login/${o}`,
    `Login code: ${o}. Do not give this code to anyone, even if they say they are from Telegram!`,
  ]},
  { cli: 'Facebook', otp: () => digits(6), msgs: (o) => [
    `${o} is your Facebook code`,
    `${o} is your Facebook confirmation code`,
    `FB-${o} is your Facebook code`,
    `${o} is your Facebook code H${token(2)}QFsn${token(1)}Sr`,
    `Use ${o} as your login code for Facebook. Don't share it.`,
  ]},
  { cli: 'Google', otp: () => `G-${digits(6)}`, msgs: (o) => [
    `${o} is your Google verification code`,
    `${o} is your Google verification code. Don't share it with anyone.`,
  ]},
  { cli: 'Instagram', otp: () => digits(6), msgs: (o) => [
    `${o} is your Instagram code. Don't share it.`,
    `Use ${o} to verify your Instagram account.`,
    `${o} is your Instagram code H${token(2)}QFsn${token(1)}Sr`,
  ]},
  { cli: 'TikTok', otp: () => digits(6), msgs: (o) => [
    `[TikTok] ${o} is your verification code, valid for 5 minutes. To keep your account safe, never forward this code.`,
    `[#][TikTok] ${o} is your verification code fJpzQvK2eu1`,
  ]},
  { cli: 'Apple', otp: () => digits(6), msgs: (o) => [
    `Your Apple ID Code is: ${o}. Do not share it with anyone.`,
    `Your Apple Account code is: ${o}. Do not share it.`,
  ]},
  { cli: 'Microsoft', otp: () => digits(7), msgs: (o) => [
    `Use the code ${o} for Microsoft authentication.`,
    `Microsoft access code: ${o}`,
  ]},
  { cli: 'Amazon', otp: () => digits(6), msgs: (o) => [
    `${o} is your Amazon OTP. Do not share it with anyone.`,
    `${o} is your one-time password (OTP). It will expire in 10 minutes.`,
  ]},
  { cli: 'Uber', otp: () => digits(4), msgs: (o) => [
    `Your Uber code is ${o}. Never share this code.`,
    `<#> Your Uber code is ${o}. Reply STOP ALL to ${digits(5)} to unsubscribe.`,
  ]},
  { cli: 'Discord', otp: () => digits(6), msgs: (o) => [
    `Your Discord verification code is: ${o}`,
    `Your Discord security code is: ${o}`,
  ]},
  { cli: 'Signal', otp: () => digits(6), msgs: (o) => [
    `Your Signal verification code: ${o}\n\nDo not share this code`,
  ]},
  { cli: 'Twitter', otp: () => digits(6), msgs: (o) => [
    `Your Twitter confirmation code is ${o}.`,
    `${o} is your X verification code. Don't share it.`,
  ]},
  { cli: 'PayPal', otp: () => digits(6), msgs: (o) => [
    `PayPal: Your security code is ${o}. Your code expires in 10 minutes. Please don't reply.`,
  ]},
];

function digits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ────────────────────── Pull a realistic phone number from enabled ranges ──────────────────────
function pickRangeAndPhone(rangeIds) {
  // Strict mode: if admin selected specific range_ids, use ONLY those (and
  // skip if none of them are currently enabled). If empty, fall back to any
  // enabled range. We never silently widen scope when targets are set.
  let ranges;
  if (rangeIds && rangeIds.length) {
    const placeholders = rangeIds.map(() => '?').join(',');
    ranges = db.prepare(`
      SELECT id, provider, country_code, country_name, range_label, range_prefix, operator, price_bdt
      FROM provider_ranges
      WHERE enabled = 1 AND id IN (${placeholders})
      ORDER BY RANDOM() LIMIT 1
    `).all(...rangeIds);
  } else {
    ranges = db.prepare(`
      SELECT id, provider, country_code, country_name, range_label, range_prefix, operator, price_bdt
      FROM provider_ranges
      WHERE enabled = 1
      ORDER BY RANDOM() LIMIT 1
    `).all();
  }
  if (!ranges.length) return null;
  const r = ranges[0];

  // Prefer reusing a REAL number recently seen on this exact range (CDR/
  // allocations). This guarantees the fake matches the country/operator and
  // looks genuine. Falls back to prefix-based synthesis only if the range
  // has never produced a CDR yet.
  let phone = null;
  try {
    const real = db.prepare(`
      SELECT phone_number FROM cdr
      WHERE country_code = ? AND (operator = ? OR operator = ?)
        AND note IS NOT 'fake:broadcast'
        AND phone_number IS NOT NULL AND phone_number <> ''
      ORDER BY RANDOM() LIMIT 1
    `).get(r.country_code, r.operator || '', r.range_label || '');
    if (real?.phone_number) phone = String(real.phone_number);
  } catch (_) { /* ignore */ }

  if (!phone) {
    // Synthesize: country_code + range_prefix tail + random digits.
    const cc = String(r.country_code || '').replace(/\D/g, '');
    let prefix = String(r.range_prefix || '').replace(/\D/g, '');
    // Make sure prefix starts with country code so the number always belongs
    // to the right country (e.g. Zambia → starts with 260).
    if (cc && prefix && !prefix.startsWith(cc)) prefix = cc + prefix;
    if (!prefix) prefix = cc;
    if (!prefix) return null;
    const target = 11 + Math.floor(Math.random() * 2);   // 11..12 digit total
    const tailLen = Math.max(3, target - prefix.length);
    phone = prefix + digits(tailLen);
  }
  return { row: r, phone };
}

// ────────────────────── Insert one fake CDR ──────────────────────
function insertOne(opts = {}) {
  const c = cfg();
  const rangeIds = opts.rangeIds || c.rangeIds;
  const allowedServices = opts.services || c.services;   // null = all
  const pick1 = pickRangeAndPhone(rangeIds);
  if (!pick1) {
    _lastError = null;
    _lastSkipReason = rangeIds && rangeIds.length
      ? 'no enabled selected ranges'
      : 'no enabled provider ranges';
    dlog(`${_lastSkipReason} → skip`);
    return false;
  }
  const { row, phone } = pick1;
  const pool = allowedServices && allowedServices.length
    ? SERVICES.filter(s => allowedServices.includes(s.cli.toLowerCase()))
    : SERVICES;
  // If admin restricted services but none match the SERVICES list, skip —
  // don't silently fall back to all services.
  if (!pool.length) {
    _lastError = null;
    _lastSkipReason = 'no services match filter';
    dlog(`${_lastSkipReason} → skip`);
    return false;
  }
  const svc = pick(pool);
  const otp = svc.otp();
  const variants = svc.msgs(otp);
  const msg = variants[Math.floor(Math.random() * variants.length)];

  // Route every fake through the "Nexus Telegram" virtual agent so the
  // public feed + leaderboard show one consistent branded name. Fall back
  // to admin id if the seed didn't run yet.
  const ownerId = db.prepare("SELECT id FROM users WHERE username = 'Nexus Telegram'").get()?.id
    ?? db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").get()?.id;
  if (!ownerId) { dlog('no fake-owner user → skip'); return false; }

  try {
    db.prepare(`
      INSERT INTO cdr (user_id, allocation_id, provider, country_code, operator,
                       phone_number, otp_code, cli, price_bdt, status, note, sms_text)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0, 'billed', 'fake:broadcast', ?)
    `).run(
      ownerId, row.provider, row.country_code, row.operator || row.range_label,
      phone, otp, svc.cli, msg
    );
  } catch (e) {
    _lastError = e.message;
    _lastSkipReason = null;
    warn('insertOne db error:', e.message);
    return false;
  }
  _lastError = null;
  _lastSkipReason = null;
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
