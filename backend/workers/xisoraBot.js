// XISORA Bot — REST API poller (no scraping, no Puppeteer, no captcha).
//
// Provider exposes a token-authenticated MDR endpoint:
//   GET http://51.38.148.122/crapi/reseller/mdr.php
//        ?token=<TOKEN>
//        &fromdate=YYYY-MM-DD HH:MM:SS
//        &todate=YYYY-MM-DD HH:MM:SS
//        &records=200
//        &searchnumber=&searchcli=
//
// Returns:
//   { status: "Success", records: N, data: [
//       { datetime, number, cli, message }, ...
//   ]}
//
// Settings (DB first, .env fallback):
//   xisora_enabled        true|false
//   xisora_base_url       http://51.38.148.122/crapi/reseller/mdr.php
//   xisora_token          (the long token from your XISORA admin)
//   xisora_otp_interval   10  (sec between polls — min 5)
//
// Flow:
//   1. tickOnce() → GET mdr.php with last 10-min window, records=200
//   2. for each row → match `number` against active allocation (suffix-9)
//   3. extract OTP from `message` body → markOtpReceived()
//
// No login, no cookie persistence. The token IS the credential.

const axios = require('axios');
const db = require('../lib/db');
const { markOtpReceived } = require('../routes/numbers');

const QUIET = process.env.NODE_ENV === 'production';
const log  = (...a) => console.log('[xisora-bot]', ...a);
const dlog = (...a) => { if (!QUIET) console.log('[xisora-bot]', ...a); };
const warn = (...a) => console.warn('[xisora-bot]', ...a);

// ───────── settings helpers ─────────
function readSetting(key) {
  try { return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || null; }
  catch (_) { return null; }
}
function normalizeBase(raw) {
  const fb = 'http://51.38.148.122/crapi/reseller/mdr.php';
  if (!raw) return fb;
  let s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s;
}
function resolveCfg() {
  const dbEnabled = readSetting('xisora_enabled');
  return {
    ENABLED: (dbEnabled !== null ? dbEnabled : (process.env.XISORA_ENABLED || 'false'))
              .toString().toLowerCase() === 'true',
    BASE_URL: normalizeBase(readSetting('xisora_base_url') || process.env.XISORA_BASE_URL),
    TOKEN:    readSetting('xisora_token') || process.env.XISORA_TOKEN || '',
    INTERVAL: Math.max(5, +(readSetting('xisora_otp_interval') || process.env.XISORA_OTP_INTERVAL || 10)),
  };
}

// ───────── runtime state ─────────
let _running = false;
let _stopFlag = false;
let _lastTickAt = null;
let _lastError = null;
let _consecFail = 0;
let _otpDelivered = 0;
let _seenIds = new Set();   // de-dupe processed rows in-process
const SEEN_MAX = 5000;

// ───────── helpers ─────────
function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function buildUrl(BASE_URL, TOKEN) {
  const now = new Date();
  const past = new Date(now.getTime() - 10 * 60_000); // 10-min lookback window
  const params = new URLSearchParams({
    token: TOKEN,
    fromdate: fmtDate(past),
    todate:   fmtDate(now),
    records:  '200',
    searchnumber: '',
    searchcli:    '',
  });
  return `${BASE_URL}?${params.toString()}`;
}

// Match phone to an active allocation, suffix-9 (handles +44, leading 0, etc.)
function findActiveAllocation(phone) {
  const tail = String(phone).replace(/\D/g, '').slice(-9);
  if (!tail) return null;
  return db.prepare(`
    SELECT id, user_id, phone_number, provider, country_code, operator
    FROM allocations
    WHERE status = 'active' AND phone_number LIKE ?
    ORDER BY allocated_at DESC LIMIT 1
  `).get(`%${tail}`);
}

function extractOtp(message) {
  if (!message) return null;
  // First 4-8 digit run (handles "123-456" → "123456" too)
  const compact = String(message).replace(/[\s\-]/g, '');
  const m = compact.match(/\b(\d{4,8})\b/);
  return m ? m[1] : null;
}

// ───────── core fetch ─────────
async function fetchRows() {
  const { BASE_URL, TOKEN } = resolveCfg();
  if (!TOKEN) throw new Error('xisora_token_missing');

  const url = buildUrl(BASE_URL, TOKEN);
  const r = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'NexusX/1.0 (+xisora-bot)', 'Accept': 'application/json' },
    validateStatus: (s) => s < 500,
  });

  if (r.status === 401 || r.status === 403) throw new Error('xisora_unauthorized');
  if (typeof r.data === 'string') {
    // Sometimes PHP errors come back as HTML
    throw new Error(`xisora_bad_response_${r.status}`);
  }
  if (r.data?.status && /not authorized|invalid token/i.test(r.data.status)) {
    throw new Error('xisora_invalid_token');
  }
  const rows = Array.isArray(r.data?.data) ? r.data.data : [];
  return rows;
}

// Verify token is valid (used by Health Check button).
async function login() {
  const { TOKEN, BASE_URL } = resolveCfg();
  if (!TOKEN) throw new Error('token not configured');
  const rows = await fetchRows();
  log(`✓ token OK · ${rows.length} rows in last 10min @ ${BASE_URL}`);
  return true;
}

// ───────── tick ─────────
async function tickOnce() {
  const rows = await fetchRows();
  let delivered = 0;
  for (const row of rows) {
    if (!row || !row.number || !row.message) continue;
    const dedupKey = `${row.datetime}|${row.number}|${String(row.message).slice(0, 60)}`;
    if (_seenIds.has(dedupKey)) continue;
    _seenIds.add(dedupKey);
    if (_seenIds.size > SEEN_MAX) {
      const arr = Array.from(_seenIds);
      _seenIds = new Set(arr.slice(arr.length / 2));
    }
    const otp = extractOtp(row.message);
    if (!otp) continue;
    const alloc = findActiveAllocation(row.number);
    if (!alloc) {
      dlog('no active alloc for', row.number, '→ skip');
      continue;
    }
    try {
      await markOtpReceived(alloc, otp, row.cli || null);
      delivered++;
      _otpDelivered++;
      log(`✓ OTP ${row.number} → ${otp} (cli=${row.cli || '-'} alloc#${alloc.id} agent#${alloc.user_id})`);
    } catch (e) {
      warn('markOtpReceived failed:', e.message);
    }
  }
  return delivered;
}

// ───────── loop ─────────
async function loop() {
  if (_running) return;
  _running = true;
  while (!_stopFlag) {
    const cfg = resolveCfg();
    if (!cfg.ENABLED) {
      _running = false;
      log('disabled — stopping');
      return;
    }
    if (!cfg.TOKEN) {
      _lastError = 'token not set in admin Settings';
      // soft-wait: re-check every 30s without spamming logs
      await new Promise(r => setTimeout(r, 30_000));
      continue;
    }
    try {
      const n = await tickOnce();
      _lastTickAt = Math.floor(Date.now() / 1000);
      _lastError = null;
      _consecFail = 0;
      if (n) log('delivered', n, 'OTPs this tick');
    } catch (e) {
      warn('tick error:', e.message);
      _lastError = e.message;
      _consecFail++;
      const backoff = Math.min(60, 5 + _consecFail * 2);
      await new Promise(r => setTimeout(r, backoff * 1000));
    }
    await new Promise(r => setTimeout(r, cfg.INTERVAL * 1000));
  }
  _running = false;
}

function start() {
  const cfg = resolveCfg();
  if (!cfg.ENABLED) { log('disabled (xisora_enabled=false) — not starting'); return; }
  if (_running) { log('already running — skip start'); return; }
  _stopFlag = false;
  log('starting…  base=', cfg.BASE_URL, 'interval=', cfg.INTERVAL, 's',
      'token=', cfg.TOKEN ? cfg.TOKEN.slice(0, 4) + '…' + cfg.TOKEN.slice(-3) : '(none)');
  loop().catch(e => warn('fatal:', e.message));
}
function stop() { _stopFlag = true; }
function getStatus() {
  const cfg = resolveCfg();
  return {
    enabled: cfg.ENABLED,
    running: _running,
    logged_in: !!cfg.TOKEN,            // token-based: "logged in" = token present
    base_url: cfg.BASE_URL,
    username: cfg.TOKEN ? cfg.TOKEN.slice(0, 4) + '…' + cfg.TOKEN.slice(-3) : null,
    last_tick_at: _lastTickAt,
    last_error: _lastError,
    consec_fail: _consecFail,
    otps_delivered: _otpDelivered,
    interval_sec: cfg.INTERVAL,
  };
}

module.exports = { start, stop, login, tickOnce, getStatus };