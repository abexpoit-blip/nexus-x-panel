// Seven1Tel Bot — lightweight axios + tough-cookie scraper for the
// "ints" SMS panel at http://94.23.120.156/ints.
//
// Why no headless browser:
//   The /ints panel is plain PHP — no Cloudflare, no JS challenge, no captcha
//   for the user/agent role. A simple POST /ints/signin with PHPSESSID cookie
//   is enough to stay logged in and poll the AJAX CDR endpoint. This keeps
//   VPS RAM/CPU near zero (vs ~150MB for puppeteer).
//
// Settings (DB first, .env fallback):
//   seven1tel_enabled            true|false
//   seven1tel_base_url           http://94.23.120.156/ints
//   seven1tel_username           Sayedahmed
//   seven1tel_password           Rumon1275
//   seven1tel_otp_interval       4   (sec between CDR polls — min 3)
//   seven1tel_session_cookie     (auto-saved PHPSESSID for fast restart)
//
// Flow:
//   1. login()       → POST /signin, capture PHPSESSID
//   2. fetchCdr()    → GET /res/data_smscdr.php?fdate1=...&fdate2=...
//   3. processRows() → for each new SMS, find matching active allocation
//                      by phone_number suffix-match → markOtpReceived().

const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const db = require('../lib/db');
const { markOtpReceived } = require('../routes/numbers');
const { Telemetry } = require('./_botTelemetry');
const tel = new Telemetry();

const QUIET = process.env.NODE_ENV === 'production';
const log  = (...a) => console.log('[seven1tel-bot]', ...a);
const dlog = (...a) => { if (!QUIET) console.log('[seven1tel-bot]', ...a); };
const warn = (...a) => console.warn('[seven1tel-bot]', ...a);

// ───────── settings helpers ─────────
function readSetting(key) {
  try { return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || null; }
  catch (_) { return null; }
}
function writeSetting(key, value) {
  try {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%s','now')
    `).run(key, String(value));
  } catch (e) { warn('writeSetting failed:', e.message); }
}
function normalizeBase(raw) {
  const fb = 'http://94.23.120.156/ints';
  if (!raw) return fb;
  let s = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s;
}
function resolveCfg() {
  const dbEnabled = readSetting('seven1tel_enabled');
  return {
    ENABLED: (dbEnabled !== null ? dbEnabled : (process.env.SEVEN1TEL_ENABLED || 'false'))
              .toString().toLowerCase() === 'true',
    BASE_URL: normalizeBase(readSetting('seven1tel_base_url') || process.env.SEVEN1TEL_BASE_URL),
    USERNAME: readSetting('seven1tel_username') || process.env.SEVEN1TEL_USERNAME || '',
    PASSWORD: readSetting('seven1tel_password') || process.env.SEVEN1TEL_PASSWORD || '',
    INTERVAL: Math.max(3, +(readSetting('seven1tel_otp_interval') || process.env.SEVEN1TEL_OTP_INTERVAL || 4)),
  };
}

// ───────── http client w/ cookie jar ─────────
let _client = null;
let _jar = null;
let _loggedIn = false;
let _running = false;
let _stopFlag = false;
let _lastTickAt = null;
let _lastError = null;
let _consecFail = 0;
let _otpDelivered = 0;
let _seenIds = new Set();   // de-dupe processed CDR rows in-process
const SEEN_MAX = 5000;

function buildClient(baseURL) {
  _jar = new tough.CookieJar();
  // 1) Manual cookie header (admin-pasted) wins — lets us bypass captcha entirely.
  const manual = String(readSetting('seven1tel_cookie_header') || '').trim();
  if (manual) {
    for (const part of manual.split(/;\s*/)) {
      if (!part) continue;
      try { _jar.setCookieSync(part + '; Path=/', baseURL); }
      catch (e) { warn('manual cookie parse failed for', part.slice(0, 40), e.message); }
    }
    dlog('loaded manual cookie header (' + manual.split(';').length + ' cookies)');
  } else {
    // 2) Otherwise restore the auto-saved PHPSESSID from last successful login
    const saved = readSetting('seven1tel_session_cookie');
    if (saved) {
      try {
        _jar.setCookieSync(saved, baseURL);
        dlog('restored saved session cookie');
      } catch (e) { warn('cookie restore failed:', e.message); }
    }
  }
  const c = wrapper(axios.create({
    baseURL,
    jar: _jar,
    withCredentials: true,
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: (s) => s < 500,   // let us inspect 4xx
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }));
  return c;
}

async function persistSessionCookie() {
  try {
    const cookies = await _jar.getCookies(_client.defaults.baseURL);
    const sess = cookies.find(c => /^PHPSESSID/i.test(c.key));
    if (sess) writeSetting('seven1tel_session_cookie', sess.cookieString());
  } catch (e) { warn('persistSession failed:', e.message); }
}

// ───────── login ─────────
async function login() {
  const { BASE_URL, USERNAME, PASSWORD } = resolveCfg();
  if (!USERNAME || !PASSWORD) throw new Error('seven1tel creds missing');
  tel.recordLoginAttempt();

  if (!_client) _client = buildClient(BASE_URL);

  // 1) GET login page (sets initial PHPSESSID + may include CSRF)
  const r1 = await _client.get('/login');
  const loginHtml = String(r1.data || '');
  dlog('GET /login →', r1.status, 'len', loginHtml.length);

  const captcha = loginHtml.match(/What\s+is\s+(\d+)\s*([+\-*x\/])\s*(\d+)\s*=\s*\?/i);
  const captchaName = loginHtml.match(/<input[^>]+name=["']([^"']+)["'][^>]+placeholder=["']Answer["']/i)?.[1] || 'capt';
  const solveCaptcha = () => {
    if (!captcha) return null;
    const a = Number(captcha[1]), b = Number(captcha[3]), op = captcha[2].toLowerCase();
    if (op === '+') return String(a + b);
    if (op === '-') return String(a - b);
    if (op === '*' || op === 'x') return String(a * b);
    if (op === '/') return String(Math.floor(a / b));
    return null;
  };

  // The "ints" panel uses a plain form: name="username", name="password",
  // optional name="captcha". We send only user/pass (matches old MSI bot).
  const form = new URLSearchParams();
  form.set('username', USERNAME);
  form.set('password', PASSWORD);
  const captchaAnswer = solveCaptcha();
  if (captchaAnswer) form.set(captchaName, captchaAnswer);
  // Some builds use "/signin", others "/signin.php" — try both.
  const trySubmit = async (path) => {
    const r = await _client.post(path, form.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${BASE_URL}/login`,
        'Origin': BASE_URL,
      },
    });
    dlog('POST', path, '→', r.status, 'final', r.request?.res?.responseUrl || '?');
    return r;
  };
  let r2 = await trySubmit('/signin');
  if (r2.status === 404) r2 = await trySubmit('/signin.php');

  // Verify by hitting the agent dashboard. Do not reject dashboard pages just
  // because they contain a password field in account/change-password markup.
  const probe = await _client.get('/agent/SMSDashboard');
  const html = String(probe.data || '');
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1] || '';
  const loginForm = /<form[^>]+action=["']?signin/i.test(html) || /placeholder=["']Username["']/i.test(html) || /name=["']capt["']/i.test(html);
  const ok = probe.status === 200 && !loginForm && /Dashboard|SMS CDR|Seven1Tel/i.test(title + html.slice(0, 1000));
  if (!ok) {
    // dump tiny preview for debugging
    log('login probe FAIL — status', probe.status,
        'title:', title || '-', 'preview:', html.slice(0, 250).replace(/\s+/g, ' '));
    throw new Error('login_failed');
  }

  await persistSessionCookie();
  _loggedIn = true;
  tel.recordLoginSuccess();
  log('✓ login OK as', USERNAME);
  return true;
}

// ───────── CDR poll ─────────
//
// The "ints" SMSCDRStats DataTable uses an AJAX endpoint:
//   /res/data_smscdr.php?fdate1=YYYY-MM-DD HH:MM:SS&fdate2=YYYY-MM-DD HH:MM:SS&iDisplayLength=N
// Returns DataTables JSON: { aaData: [ [date, range, number, cli, msg], ... ] }
// Column order can vary slightly between builds — we detect the phone column
// by regex (digits with optional +, length >= 7).
//
function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function fetchCdrRows() {
  // Window: -2h … +2h around the VPS clock. This covers any TZ skew up to
  // ±2 hours (Seven1Tel server is in BD/UTC+6, our VPS is UTC) while keeping
  // the response small AND avoiding wrong-agent matches on recycled numbers.
  // 12-hour windows previously matched a 6-hour-old SMS to a brand-new
  // allocation with the same MSISDN.
  const now  = new Date(Date.now() + 2 * 60 * 60_000);
  const past = new Date(Date.now() - 2 * 60 * 60_000);
  const params = new URLSearchParams({
    fdate1: fmtDate(past),
    fdate2: fmtDate(now),
    iDisplayLength: '300',
    iDisplayStart: '0',
    sEcho: String(Date.now() % 100000),
  });
  const r = await _client.get(`/res/data_smscdr.php?${params.toString()}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': `${_client.defaults.baseURL}/agent/SMSCDRStats` },
  });
  if (r.status === 401 || r.status === 403) throw new Error('cdr_unauthorized');
  if (typeof r.data === 'string' && /name=["']password["']/i.test(r.data)) {
    throw new Error('cdr_session_lost');
  }
  const rows = (r.data && r.data.aaData) || [];
  return rows;
}

// Detect phone & otp from a CDR row (column-position-agnostic).
function parseRow(row) {
  if (!Array.isArray(row)) return null;
  let phone = null, msg = null, range = null, cli = null, dateCol = null;
  for (const cell of row) {
    if (cell == null) continue;
    const s = String(cell).trim();
    // date like "2026-05-01 12:34:56"
    if (!dateCol && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) { dateCol = s; continue; }
    // phone — digits 7+ with optional + (and not too long → exclude unix ts)
    if (!phone && /^\+?\d{7,15}$/.test(s.replace(/[\s-]/g, ''))) {
      phone = s.replace(/[\s-]/g, '').replace(/^\+/, '');
      continue;
    }
    // message: longest cell with letters
    if (/[a-z]/i.test(s) && (!msg || s.length > msg.length)) msg = s;
    // range: short alphanum tag
    if (!range && /^[A-Z0-9_\-]{2,20}$/i.test(s) && s.length < (msg?.length || 999)) range = s;
  }
  // CLI = sender id often in 2nd column. Pull whatever isn't phone/msg/date.
  for (const cell of row) {
    const s = String(cell || '').trim();
    if (!s || s === phone || s === msg || s === dateCol) continue;
    if (s.length <= 20 && !cli) cli = s;
  }
  if (!phone || !msg) return null;
  // OTP extract — first 4-8 digit run in message
  const otpMatch = msg.match(/\b(\d{4,8})\b/);
  return {
    phone,
    otp: otpMatch ? otpMatch[1] : null,
    msg,
    cli,
    range,
    dedup_key: `${phone}|${(msg || '').slice(0, 60)}`,
  };
}

function findActiveAllocation(phone) {
  // Match the most recent allocation for this MSISDN (suffix-9, handles +44 vs 44),
  // accepting any of:
  //   • status='active'                           — normal in-window delivery
  //   • status='expired' within GRACE_SEC         — SMS arrived seconds late
  //   • status='received' within RESEND_SEC       — site sent a 2nd OTP
  // The agent who originally held the number still gets credited.
  const GRACE_SEC  = 300;  // 5 min late tolerance
  const RESEND_SEC = 600;  // 10 min re-confirm window
  const tail = phone.slice(-9);
  const cutoffActive   = Math.floor(Date.now() / 1000);  // anything still 'active' is fine
  const cutoffExpired  = cutoffActive - GRACE_SEC;
  const cutoffReceived = cutoffActive - RESEND_SEC;
  return db.prepare(`
    SELECT id, user_id, phone_number, provider, country_code, operator, service_id, status, allocated_at
    FROM allocations
    WHERE phone_number LIKE ?
      AND (
            status = 'active'
         OR (status = 'expired'  AND allocated_at >= ?)
         OR (status = 'received' AND allocated_at >= ?)
      )
    ORDER BY allocated_at DESC LIMIT 1
  `).get(`%${tail}`, cutoffExpired, cutoffReceived);
}

async function tickOnce() {
  if (!_loggedIn) await login();
  const rows = await fetchCdrRows();
  let delivered = 0;
  for (const raw of rows) {
    const r = parseRow(raw);
    if (!r || !r.otp) continue;
    if (_seenIds.has(r.dedup_key)) continue;
    _seenIds.add(r.dedup_key);
    if (_seenIds.size > SEEN_MAX) {
      // reset oldest half
      const arr = Array.from(_seenIds);
      _seenIds = new Set(arr.slice(arr.length / 2));
    }
    const alloc = findActiveAllocation(r.phone);
    if (!alloc) {
      dlog('no active alloc for', r.phone, '→ skip');
      tel.recordMiss(r.phone, `OTP "${r.otp}" arrived but no active allocation matched suffix-9`);
      continue;
    }
    try {
      await markOtpReceived(alloc, r.otp, r.cli);
      delivered++;
      _otpDelivered++;
      tel.recordOtpDelivered();
      log(`✓ OTP ${r.phone} → ${r.otp} (alloc#${alloc.id}, agent#${alloc.user_id})`);
    } catch (e) {
      warn('markOtpReceived failed:', e.message);
      tel.recordError(`markOtpReceived: ${e.message}`);
    }
  }
  return delivered;
}

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
    try {
      const n = await tickOnce();
      tel.recordTick();
      _lastTickAt = Math.floor(Date.now() / 1000);
      _lastError = null;
      _consecFail = 0;
      if (n) log('delivered', n, 'OTPs this tick');
    } catch (e) {
      warn('tick error:', e.message);
      _lastError = e.message;
      tel.recordError(e.message);
      _consecFail++;
      if (/session_lost|unauthorized|login_failed/i.test(e.message)) {
        _loggedIn = false;
      }
      // back off harder after repeated fails
      const backoff = Math.min(60, 5 + _consecFail * 2);
      await new Promise(r => setTimeout(r, backoff * 1000));
    }
    await new Promise(r => setTimeout(r, cfg.INTERVAL * 1000));
  }
  _running = false;
}

function start() {
  const cfg = resolveCfg();
  if (!cfg.ENABLED) { log('disabled (seven1tel_enabled=false) — not starting'); return; }
  if (_running) { log('already running — skip start'); return; }
  _stopFlag = false;
  log('starting…  base=', cfg.BASE_URL, 'interval=', cfg.INTERVAL, 's');
  loop().catch(e => warn('fatal:', e.message));
}
function stop() { _stopFlag = true; _loggedIn = false; }
function getStatus() {
  const cfg = resolveCfg();
  return {
    enabled: cfg.ENABLED,
    running: _running,
    logged_in: _loggedIn,
    base_url: cfg.BASE_URL,
    username: cfg.USERNAME ? cfg.USERNAME.replace(/.(?=.{2})/g, '*') : null,
    last_tick_at: _lastTickAt,
    last_error: _lastError,
    consec_fail: _consecFail,
    otps_delivered: _otpDelivered,
    interval_sec: cfg.INTERVAL,
    ...tel.snapshot(),
  };
}

module.exports = { start, stop, login, tickOnce, getStatus };
