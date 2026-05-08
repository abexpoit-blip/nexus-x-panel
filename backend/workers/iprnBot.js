// IPRN-SMS Bot — scrapes https://panel.iprn-sms.com
//
// Flow:
//   1. GET /login → parse _csrf_token from form
//   2. POST /login_check (_username, _password, _csrf_token, _remember_me, _submit)
//      → captures PHPSESSID via cookie jar; redirected to dashboard.
//   3. For each distinct currency_id needed by enabled iprn ranges:
//        GET /api/helper/premium-number/stats/sms.json
//          ?date_from=DD/MM/YYYY%20HH&date_to=DD/MM/YYYY%20HH&currency_id=N&...
//      → returns { aaData: [ { source, name, short_code, phone_number, payout, message, notified, created } ... ] }
//   4. Match each row by phone_number suffix to active allocations.
//
// Currency map (verified manually 2026-05-06):
//   EUR=1, USD=2, GBP=3
//
// Settings (DB first, .env fallback):
//   iprn_enabled        true|false
//   iprn_base_url       https://panel.iprn-sms.com
//   iprn_username       Sam_Shovon
//   iprn_password       cuenf3455
//   iprn_otp_interval   8  (sec between polls — min 5)
//   iprn_session_cookie (auto-saved PHPSESSID for restart)

const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const db = require('../lib/db');
const { markOtpReceived } = require('../routes/numbers');
const { logOtpAudit } = require('../lib/otpAudit');
const { findMatchingAllocation, hasSeenSourceMessage } = require('../lib/allocationMatcher');
const { Telemetry } = require('./_botTelemetry');
const tel = new Telemetry();

const QUIET = process.env.NODE_ENV === 'production';
const log  = (...a) => console.log('[iprn-bot]', ...a);
const dlog = (...a) => { if (!QUIET) console.log('[iprn-bot]', ...a); };
const warn = (...a) => console.warn('[iprn-bot]', ...a);

const CURRENCY_MAP = { EUR: 1, USD: 2, GBP: 3 };

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
  const fb = 'https://panel.iprn-sms.com';
  if (!raw) return fb;
  let s = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}
function resolveCfg() {
  const dbEnabled = readSetting('iprn_enabled');
  return {
    ENABLED: (dbEnabled !== null ? dbEnabled : (process.env.IPRN_ENABLED || 'false'))
              .toString().toLowerCase() === 'true',
    BASE_URL: normalizeBase(readSetting('iprn_base_url') || process.env.IPRN_BASE_URL),
    USERNAME: readSetting('iprn_username') || process.env.IPRN_USERNAME || '',
    PASSWORD: readSetting('iprn_password') || process.env.IPRN_PASSWORD || '',
    INTERVAL: Math.max(5, +(readSetting('iprn_otp_interval') || process.env.IPRN_OTP_INTERVAL || 8)),
  };
}

let _client = null, _jar = null;
let _loggedIn = false, _running = false, _stopFlag = false;
let _lastTickAt = null, _lastError = null, _consecFail = 0, _otpDelivered = 0;
let _seenIds = new Set();
const SEEN_MAX = 5000;

function buildClient(baseURL) {
  _jar = new tough.CookieJar();
  const saved = readSetting('iprn_session_cookie');
  if (saved) {
    try { _jar.setCookieSync(saved, baseURL); dlog('restored saved session cookie'); }
    catch (e) { warn('cookie restore failed:', e.message); }
  }
  return wrapper(axios.create({
    baseURL,
    jar: _jar,
    withCredentials: true,
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: (s) => s < 500,
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
    if (sess) writeSetting('iprn_session_cookie', sess.cookieString());
  } catch (e) { warn('persistSession failed:', e.message); }
}

async function login() {
  const { BASE_URL, USERNAME, PASSWORD } = resolveCfg();
  if (!USERNAME || !PASSWORD) throw new Error('iprn creds missing');
  tel.recordLoginAttempt();

  if (!_client) _client = buildClient(BASE_URL);

  // 1) GET /login → CSRF
  const r1 = await _client.get('/login');
  const html = String(r1.data || '');
  const csrf = html.match(/name=["']_csrf_token["']\s+value=["']([^"']+)["']/i)?.[1];
  dlog('GET /login →', r1.status, 'csrf', csrf ? 'found' : 'MISSING');
  if (!csrf) throw new Error('iprn_csrf_missing');

  // 2) POST /login_check
  const form = new URLSearchParams();
  form.set('_csrf_token', csrf);
  form.set('_username', USERNAME);
  form.set('_password', PASSWORD);
  form.set('_remember_me', 'on');
  form.set('_submit', 'Login');
  const r2 = await _client.post('/login_check', form.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE_URL}/login`,
      'Origin': BASE_URL,
    },
  });
  const finalUrl = r2.request?.res?.responseUrl || '?';
  dlog('POST /login_check →', r2.status, 'final', finalUrl);

  // 3) Verify by hitting stats page
  const probe = await _client.get('/premium_number/stats/sms');
  const probeHtml = String(probe.data || '');
  const stillLogin = /name=["']_username["']/i.test(probeHtml) || /id=["']loginform["']/i.test(probeHtml);
  if (probe.status !== 200 || stillLogin) {
    log('login probe FAIL — status', probe.status, 'preview:', probeHtml.slice(0, 200).replace(/\s+/g, ' '));
    throw new Error('iprn_login_failed');
  }

  await persistSessionCookie();
  _loggedIn = true;
  tel.recordLoginSuccess();
  log('✓ login OK as', USERNAME);
  return true;
}

// IPRN expects "DD/MM/YYYY HH" (hour only).
function fmtIprnDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}`;
}

function buildStatsParams(currencyId) {
  // Today's full window in UTC (panel is GMT+0).
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0));
  const dayEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23));
  const p = new URLSearchParams({
    date_from: fmtIprnDate(dayStart),
    date_to:   fmtIprnDate(dayEnd),
    currency_id: String(currencyId),
    draw: '1',
    start: '0',
    length: '100',
    'search[value]': '',
    'search[regex]': 'false',
    _: String(Date.now()),
  });
  // Required DataTables column metadata (mirrors what the panel sends).
  const cols = ['source','name','short_code','phone_number','payout','message','notified','created'];
  cols.forEach((d, i) => {
    p.set(`columns[${i}][data]`, d);
    p.set(`columns[${i}][name]`, '');
    p.set(`columns[${i}][searchable]`, 'true');
    p.set(`columns[${i}][orderable]`, 'true');
    p.set(`columns[${i}][search][value]`, '');
    p.set(`columns[${i}][search][regex]`, 'false');
  });
  return p;
}

// Discover which currencies our enabled iprn ranges actually use.
function activeCurrencies() {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT UPPER(COALESCE(currency,'EUR')) AS cur
      FROM provider_ranges
      WHERE provider='iprn' AND enabled=1
    `).all();
    const ids = [];
    for (const r of rows) {
      const id = CURRENCY_MAP[r.cur];
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids.length ? ids : [1]; // default EUR if no ranges yet
  } catch (_) { return [1]; }
}

async function fetchCdrRows(currencyId) {
  const params = buildStatsParams(currencyId);
  const url = `/api/helper/premium-number/stats/sms.json?${params.toString()}`;
  const r = await _client.get(url, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Referer': `${_client.defaults.baseURL}/premium_number/stats/sms`,
    },
  });
  if (r.status === 401 || r.status === 403) throw new Error('iprn_unauthorized');
  if (r.status === 404) throw new Error('iprn_not_found');
  if (typeof r.data === 'string') throw new Error('iprn_session_lost');
  return Array.isArray(r.data?.aaData) ? r.data.aaData : [];
}

function findActiveAllocation(phone) {
  return findMatchingAllocation({ provider: 'iprn', phone, lateGraceSec: 300, resendSec: 600 });
}

function extractOtp(msg) {
  if (!msg) return null;
  const m = String(msg).replace(/[\s\-]/g, '').match(/\b(\d{4,8})\b/);
  return m ? m[1] : null;
}

async function tickOnce() {
  if (!_loggedIn) await login();
  let delivered = 0;
  for (const cur of activeCurrencies()) {
    let rows;
    try { rows = await fetchCdrRows(cur); }
    catch (e) {
      if (/unauthorized|session_lost/i.test(e.message)) { _loggedIn = false; throw e; }
      throw e;
    }
    for (const row of rows) {
      const phone = String(row.phone_number || '').replace(/\D/g, '');
      const msg   = String(row.message || '');
      if (!phone || !msg) continue;
      const dedup = `${row.created || ''}|${phone}|${msg.slice(0, 60)}`;
      if (_seenIds.has(dedup) || hasSeenSourceMessage('iprn', dedup)) continue;
      _seenIds.add(dedup);
      if (_seenIds.size > SEEN_MAX) {
        const arr = Array.from(_seenIds);
        _seenIds = new Set(arr.slice(arr.length / 2));
      }
      const otp = extractOtp(msg);
      if (!otp) continue;
      const cli = row.source || row.name || null;
      const alloc = findActiveAllocation(phone);
      if (!alloc) {
        tel.recordMiss(phone, `OTP "${otp}" arrived but no active allocation matched suffix-9`);
        logOtpAudit({
          source: 'iprn', source_msg_id: dedup,
          phone_number: phone, cli, otp_code: otp, sms_text: msg,
          outcome: 'mismatch', miss_reason: 'no active allocation matched (suffix-9)',
        });
        continue;
      }
      try {
        await markOtpReceived(alloc, otp, cli, msg, { source: 'iprn', source_msg_id: dedup });
        delivered++; _otpDelivered++; tel.recordOtpDelivered();
        log(`✓ OTP ${phone} → ${otp} (cur=${cur} alloc#${alloc.id} agent#${alloc.user_id})`);
      } catch (e) {
        warn('markOtpReceived failed:', e.message);
        tel.recordError(`markOtpReceived: ${e.message}`);
        logOtpAudit({
          source: 'iprn', source_msg_id: dedup,
          phone_number: phone, cli, otp_code: otp, sms_text: msg,
          allocation_id: alloc.id, user_id: alloc.user_id,
          outcome: 'error', miss_reason: `markOtpReceived: ${e.message}`,
        });
      }
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
    try {
      const n = await tickOnce();
      tel.recordTick();
      _lastTickAt = Math.floor(Date.now() / 1000);
      _lastError = null; _consecFail = 0;
      if (n) log('delivered', n, 'OTPs this tick');
    } catch (e) {
      warn('tick error:', e.message);
      _lastError = e.message; tel.recordError(e.message); _consecFail++;
      if (/session_lost|unauthorized|login_failed|csrf/i.test(e.message)) _loggedIn = false;
      const backoff = Math.min(60, 5 + _consecFail * 2);
      await new Promise(r => setTimeout(r, backoff * 1000));
    }
    await new Promise(r => setTimeout(r, cfg.INTERVAL * 1000));
  }
  _running = false;
}

function start() {
  const cfg = resolveCfg();
  if (!cfg.ENABLED) { log('disabled (iprn_enabled=false) — not starting'); return; }
  if (_running) { log('already running — skip start'); return; }
  if (!cfg.USERNAME || !cfg.PASSWORD) {
    warn('REFUSING TO START — iprn_username / iprn_password not set in admin Settings');
    _lastError = 'credentials missing';
    return;
  }
  _stopFlag = false;
  log('starting…  base=', cfg.BASE_URL, 'interval=', cfg.INTERVAL, 's', 'currencies=', activeCurrencies());
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
    active_currency_ids: activeCurrencies(),
    ...tel.snapshot(),
  };
}

module.exports = { start, stop, login, tickOnce, getStatus };
