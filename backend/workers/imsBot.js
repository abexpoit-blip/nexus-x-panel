// IMS Bot — scraper for https://www.imssms.org
//
// Login:   POST /signin with { etkk (hidden token from /login), username,
//          password, capt (math captcha answer) }.
// CDR:     GET /client/res/data_smscdr.php?...&sesskey=<from page>
//          (DataTables JSON: aaData = [[datetime, range, number, cli, msg,
//          currency, payout], ...])
//
// IMPORTANT — IMS rate limit:
//   The portal explicitly warns: "Don't refresh CDR & stats page frequently
//   within 15 seconds". Violating it returns 503 / a warning row. We hard-cap
//   the poll interval at MIN 16s and back off harder on any 4xx/5xx.
//
// Settings (DB first, .env fallback):
//   ims_enabled        true|false
//   ims_base_url       https://www.imssms.org
//   ims_username       Shovonkhan7
//   ims_password       Shovonkhan7
//   ims_otp_interval   18   (sec — minimum 16 enforced)
//   ims_session_cookie auto-saved PHPSESSID for fast restart
//   ims_cookie_header  optional manual cookie override (skips captcha login)

const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const db = require('../lib/db');
const { markOtpReceived } = require('../routes/numbers');
const { logOtpAudit } = require('../lib/otpAudit');
const { Telemetry } = require('./_botTelemetry');
const tel = new Telemetry();

const QUIET = process.env.NODE_ENV === 'production';
const log  = (...a) => console.log('[ims-bot]', ...a);
const dlog = (...a) => { if (!QUIET) console.log('[ims-bot]', ...a); };
const warn = (...a) => console.warn('[ims-bot]', ...a);

const MIN_INTERVAL = 16; // hard floor — IMS warns at <15s

function readSetting(k) {
  try { return db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || null; }
  catch (_) { return null; }
}
function writeSetting(k, v) {
  try {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%s','now')
    `).run(k, String(v));
  } catch (e) { warn('writeSetting failed:', e.message); }
}
function normalizeBase(raw) {
  const fb = 'https://www.imssms.org';
  if (!raw) return fb;
  let s = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}
function resolveCfg() {
  const dbEnabled = readSetting('ims_enabled');
  const interval = +(readSetting('ims_otp_interval') || process.env.IMS_OTP_INTERVAL || 18);
  return {
    ENABLED: (dbEnabled !== null ? dbEnabled : (process.env.IMS_ENABLED || 'false'))
              .toString().toLowerCase() === 'true',
    BASE_URL: normalizeBase(readSetting('ims_base_url') || process.env.IMS_BASE_URL),
    USERNAME: readSetting('ims_username') || process.env.IMS_USERNAME || '',
    PASSWORD: readSetting('ims_password') || process.env.IMS_PASSWORD || '',
    INTERVAL: Math.max(MIN_INTERVAL, interval),
  };
}

let _client = null, _jar = null;
let _loggedIn = false, _running = false, _stopFlag = false;
let _lastTickAt = null, _lastError = null, _consecFail = 0, _otpDelivered = 0;
let _sesskey = null;
let _seenIds = new Set();
const SEEN_MAX = 5000;
let _rateLimitStreak = 0;   // consecutive 503/15s errors → grow interval
let _nextCdrAllowedAt = 0;   // IMS forbids CDR/stats refreshes inside the cooldown window
let _lastRateLimitWarnAt = 0;

async function waitForCdrGate() {
  const now = Date.now();
  if (_nextCdrAllowedAt > now) {
    await new Promise(r => setTimeout(r, _nextCdrAllowedAt - now));
  }
  _nextCdrAllowedAt = Date.now() + (MIN_INTERVAL * 1000);
}

function registerRateLimitCooldown() {
  const penaltyMs = Math.min(90_000, 20_000 * Math.min(Math.max(_rateLimitStreak, 1), 4));
  _nextCdrAllowedAt = Math.max(_nextCdrAllowedAt, Date.now() + penaltyMs);
  const now = Date.now();
  if (now - _lastRateLimitWarnAt > 60_000) {
    warn(`IMS CDR rate-limited — cooling down ${Math.ceil(penaltyMs / 1000)}s`);
    _lastRateLimitWarnAt = now;
  }
  return Math.ceil(penaltyMs / 1000);
}

function buildClient(baseURL) {
  _jar = new tough.CookieJar();
  const manual = String(readSetting('ims_cookie_header') || '').trim();
  if (manual) {
    for (const part of manual.split(/;\s*/)) {
      if (!part) continue;
      try { _jar.setCookieSync(part + '; Path=/', baseURL); }
      catch (e) { warn('manual cookie parse failed:', e.message); }
    }
    dlog('loaded manual cookie header');
  } else {
    const saved = readSetting('ims_session_cookie');
    if (saved) {
      try { _jar.setCookieSync(saved, baseURL); dlog('restored saved session'); }
      catch (e) { warn('cookie restore failed:', e.message); }
    }
  }
  return wrapper(axios.create({
    baseURL, jar: _jar, withCredentials: true, timeout: 20000, maxRedirects: 5,
    validateStatus: (s) => s < 600,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }));
}

async function persistSessionCookie() {
  try {
    const cookies = await _jar.getCookies(_client.defaults.baseURL);
    const sess = cookies.find(c => /^PHPSESSID/i.test(c.key));
    if (sess) writeSetting('ims_session_cookie', sess.cookieString());
  } catch (e) { warn('persistSession failed:', e.message); }
}

function solveCaptcha(html) {
  const m = html.match(/What\s+is\s+(\d+)\s*([+\-x*\/])\s*(\d+)/i);
  if (!m) return null;
  const a = +m[1], b = +m[3], op = m[2].toLowerCase();
  if (op === '+') return String(a + b);
  if (op === '-') return String(a - b);
  if (op === '*' || op === 'x') return String(a * b);
  if (op === '/') return String(Math.floor(a / b));
  return null;
}

async function refreshSesskey() {
  await waitForCdrGate();
  const probe = await _client.get('/client/SMSCDRStats');
  if (probe.status !== 200) throw new Error(`cdr_page_${probe.status}`);
  const html = String(probe.data || '');
  if (/<form[^>]+action=['"]?signin/i.test(html)) {
    _loggedIn = false;
    throw new Error('cdr_session_lost');
  }
  const m = html.match(/data_smscdr\.php\?[^'"]*sesskey=([^&'"\s]+)/);
  if (!m) throw new Error('sesskey_not_found');
  _sesskey = m[1];
  dlog('refreshed sesskey:', _sesskey);
  return _sesskey;
}

async function login() {
  const { BASE_URL, USERNAME, PASSWORD } = resolveCfg();
  const manualCookie = String(readSetting('ims_cookie_header') || '').trim();
  if (!USERNAME && !PASSWORD && !manualCookie) {
    throw new Error('ims_creds_missing (set username/password OR cookie header)');
  }
  tel.recordLoginAttempt();
  if (!_client) _client = buildClient(BASE_URL);

  // Try saved/manual cookie first — covers both auto-resume after restart
  // and cookie-only login (admin pasted PHPSESSID, no credentials).
  if (_jar) {
    try {
      const probe = await _client.get('/client/SMSCDRStats');
      const html = String(probe.data || '');
      if (probe.status === 200 && !/<form[^>]+action=['"]?signin/i.test(html)) {
        const m = html.match(/data_smscdr\.php\?[^'"]*sesskey=([^&'"\s]+)/);
        if (m) {
          _sesskey = m[1];
          _loggedIn = true;
          tel.recordLoginSuccess();
          log(`✓ ${manualCookie ? 'cookie-header' : 'session-reuse'} OK (skipped captcha login)`);
          return true;
        }
      }
    } catch (_) { /* fall through */ }
  }

  // No usable cookie → must have credentials to do the captcha login
  if (!USERNAME || !PASSWORD) {
    throw new Error(manualCookie
      ? 'ims_cookie_expired (paste a fresh PHPSESSID or add username/password)'
      : 'ims_creds_missing');
  }

  const r1 = await _client.get('/login');
  const html = String(r1.data || '');
  const etkk = html.match(/name=['"]etkk['"]\s+value=['"]([^'"]+)['"]/)?.[1];
  const captAns = solveCaptcha(html);
  dlog('login page', r1.status, 'etkk=', etkk ? '✓' : '✗', 'capt=', captAns);

  const form = new URLSearchParams();
  if (etkk) form.set('etkk', etkk);
  form.set('username', USERNAME);
  form.set('password', PASSWORD);
  if (captAns != null) form.set('capt', captAns);

  const r2 = await _client.post('/signin', form.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE_URL}/login`, 'Origin': BASE_URL,
    },
  });
  dlog('POST /signin →', r2.status, 'final', r2.request?.res?.responseUrl || '?');

  await refreshSesskey();
  await persistSessionCookie();
  _loggedIn = true;
  tel.recordLoginSuccess();
  log('✓ login OK as', USERNAME);
  return true;
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function fetchCdrRows() {
  if (!_sesskey) await refreshSesskey();
  // ±2h window: covers TZ skew, keeps response small
  const now  = new Date(Date.now() + 2 * 60 * 60_000);
  const past = new Date(Date.now() - 2 * 60 * 60_000);
  const params = new URLSearchParams({
    fdate1: fmtDate(past), fdate2: fmtDate(now),
    frange: '', fnum: '', fcli: '',
    fgdate: '', fgmonth: '', fgrange: '', fgnumber: '', fgcli: '', fg: '0',
    sesskey: _sesskey,
    sEcho: String(Date.now() % 100000),
    iColumns: '6', sColumns: ',,,,,',
    iDisplayStart: '0', iDisplayLength: '300',
    iSortCol_0: '0', sSortDir_0: 'desc', iSortingCols: '1',
    _: String(Date.now()),
  });
  for (let i = 0; i < 6; i++) {
    params.set(`mDataProp_${i}`, String(i));
    params.set(`sSearch_${i}`, '');
    params.set(`bRegex_${i}`, 'false');
    params.set(`bSearchable_${i}`, 'true');
    params.set(`bSortable_${i}`, 'true');
  }
  await waitForCdrGate();
  const r = await _client.get(`/client/res/data_smscdr.php?${params.toString()}`, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${_client.defaults.baseURL}/client/SMSCDRStats`,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    },
  });
  if (r.status === 401 || r.status === 403) throw new Error('cdr_unauthorized');
  if (r.status === 503) throw new Error('cdr_rate_limited');  // IMS 15s rule
  if (r.status >= 400) throw new Error(`cdr_http_${r.status}`);
  if (typeof r.data === 'string') {
    if (/<form[^>]+action=['"]?signin/i.test(r.data)) throw new Error('cdr_session_lost');
    if (/15\s*second/i.test(r.data)) throw new Error('cdr_rate_limited');
    throw new Error('cdr_bad_response');
  }
  return r.data?.aaData || [];
}

// IMS row layout: [datetime, range, number, cli, message, currency, payout]
function parseRow(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const datetime = String(row[0] || '');
  const range = String(row[1] || '');
  const phone = String(row[2] || '').replace(/\D/g, '');
  const cli = String(row[3] || '');
  const msg = String(row[4] || '');
  if (!phone || !msg) return null;
  const otpMatch = msg.replace(/[\s\-]/g, '').match(/\b(\d{4,8})\b/);
  return {
    phone, otp: otpMatch ? otpMatch[1] : null,
    msg, cli, range, datetime,
    dedup_key: `${datetime}|${phone}|${msg.slice(0, 60)}`,
  };
}

function findActiveAllocation(phone) {
  const tail = String(phone).slice(-9);
  if (!tail) return null;
  const GRACE_SEC = 300, RESEND_SEC = 600;
  const now = Math.floor(Date.now() / 1000);
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
  `).get(`%${tail}`, now - GRACE_SEC, now - RESEND_SEC);
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
      const arr = Array.from(_seenIds);
      _seenIds = new Set(arr.slice(arr.length / 2));
    }
    const alloc = findActiveAllocation(r.phone);
    if (!alloc) {
      dlog('no active alloc for', r.phone, '→ skip');
      tel.recordMiss(r.phone, `OTP "${r.otp}" arrived but no active allocation matched suffix-9`);
      logOtpAudit({
        source: 'ims', source_msg_id: r.dedup_key,
        phone_number: r.phone, cli: r.cli, otp_code: r.otp, sms_text: r.msg,
        outcome: 'mismatch',
        miss_reason: 'no active allocation matched (suffix-9)',
      });
      continue;
    }
    try {
      await markOtpReceived(alloc, r.otp, r.cli, r.msg,
        { source: 'ims', source_msg_id: r.dedup_key });
      delivered++; _otpDelivered++;
      tel.recordOtpDelivered();
      log(`✓ OTP ${r.phone} → ${r.otp} (alloc#${alloc.id}, agent#${alloc.user_id})`);
    } catch (e) {
      warn('markOtpReceived failed:', e.message);
      tel.recordError(`markOtpReceived: ${e.message}`);
      logOtpAudit({
        source: 'ims', source_msg_id: r.dedup_key,
        phone_number: r.phone, cli: r.cli, otp_code: r.otp, sms_text: r.msg,
        allocation_id: alloc.id, user_id: alloc.user_id,
        outcome: 'error', miss_reason: `markOtpReceived: ${e.message}`,
      });
    }
  }
  return delivered;
}

async function loop() {
  if (_running) return;
  _running = true;
  while (!_stopFlag) {
    const cfg = resolveCfg();
    if (!cfg.ENABLED) { _running = false; log('disabled — stopping'); return; }
    const hasCookie = !!String(readSetting('ims_cookie_header') || '').trim();
    if (!hasCookie && (!cfg.USERNAME || !cfg.PASSWORD)) {
      _lastError = 'set ims_username/ims_password OR ims_cookie_header in admin Settings';
      await new Promise(r => setTimeout(r, 30_000)); continue;
    }
    try {
      const n = await tickOnce();
      tel.recordTick();
      _lastTickAt = Math.floor(Date.now() / 1000);
      _lastError = null; _consecFail = 0;
      if (n) log('delivered', n, 'OTPs this tick');
      _rateLimitStreak = 0;   // healthy tick clears the rate-limit streak
    } catch (e) {
      warn('tick error:', e.message);
      _lastError = e.message;
      tel.recordError(e.message);
      _consecFail++;
      if (/session_lost|unauthorized|login_failed|sesskey/i.test(e.message)) {
        _loggedIn = false; _sesskey = null;
      }
      // IMS rate-limit handling: portal forbids any action <15s apart.
      // Grow penalty exponentially each consecutive hit (20s → 40s → 60s → cap 90s)
      // so we stop hammering and self-recover instead of staying stuck.
      let penalty = 0;
      if (/rate_limited/i.test(e.message)) {
        _rateLimitStreak++;
        penalty = registerRateLimitCooldown();
      } else {
        _rateLimitStreak = 0;
      }
      const backoff = Math.min(60, 5 + _consecFail * 2) + penalty;
      log(`backoff ${backoff}s (consec=${_consecFail}, rl_streak=${_rateLimitStreak})`);
      await new Promise(r => setTimeout(r, backoff * 1000));
    }
    await new Promise(r => setTimeout(r, cfg.INTERVAL * 1000));
  }
  _running = false;
}

function start() {
  const cfg = resolveCfg();
  if (!cfg.ENABLED) { log('disabled (ims_enabled=false) — not starting'); return; }
  if (_running) { log('already running — skip start'); return; }
  _stopFlag = false;
  log(`starting…  base=${cfg.BASE_URL}  interval=${cfg.INTERVAL}s (min ${MIN_INTERVAL}s enforced)`);
  loop().catch(e => warn('fatal:', e.message));
}
function stop() { _stopFlag = true; _loggedIn = false; _sesskey = null; }
function getStatus() {
  const cfg = resolveCfg();
  return {
    enabled: cfg.ENABLED, running: _running, logged_in: _loggedIn,
    base_url: cfg.BASE_URL,
    username: cfg.USERNAME ? cfg.USERNAME.replace(/.(?=.{2})/g, '*') : null,
    last_tick_at: _lastTickAt, last_error: _lastError,
    consec_fail: _consecFail, otps_delivered: _otpDelivered,
    interval_sec: cfg.INTERVAL, min_interval_sec: MIN_INTERVAL,
    sesskey_loaded: !!_sesskey,
    ...tel.snapshot(),
  };
}

module.exports = { start, stop, login, tickOnce, getStatus };
