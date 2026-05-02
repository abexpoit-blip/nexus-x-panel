// XISORA Bot — REST API poller with portal-cookie fallback.
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
//   xisora_portal_url     http://94.23.31.29/sms
//   xisora_cookie_header  PHPSESSID=...  (fallback when token is unavailable)
//   xisora_otp_interval   10  (sec between polls — min 5)
//
// Flow:
//   1. tickOnce() → GET mdr.php with last 10-min window, records=200
//   2. for each row → match `number` against active allocation (suffix-9)
//   3. extract OTP from `message` body → markOtpReceived()
//
// No login, no cookie persistence. The token IS the credential.

const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
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
function writeSetting(key, value) {
  try {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%s','now')
    `).run(key, String(value));
  } catch (e) { warn('writeSetting failed:', e.message); }
}
function normalizeBase(raw) {
  const fb = 'http://51.38.148.122/crapi/reseller/mdr.php';
  if (!raw) return fb;
  let s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s;
}
function normalizePortalBase(raw) {
  const fb = 'http://94.23.31.29/sms';
  if (!raw) return fb;
  let s = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/client(?:\/.*)?$/i, '').replace(/\/SignIn$/i, '');
  return s;
}
function resolveCfg() {
  const dbEnabled = readSetting('xisora_enabled');
  return {
    ENABLED: (dbEnabled !== null ? dbEnabled : (process.env.XISORA_ENABLED || 'false'))
              .toString().toLowerCase() === 'true',
    BASE_URL: normalizeBase(readSetting('xisora_base_url') || process.env.XISORA_BASE_URL),
    TOKEN:    readSetting('xisora_token') || process.env.XISORA_TOKEN || '',
    PORTAL_URL: normalizePortalBase(readSetting('xisora_portal_url') || process.env.XISORA_PORTAL_URL),
    USERNAME: readSetting('xisora_username') || process.env.XISORA_USERNAME || '',
    PASSWORD: readSetting('xisora_password') || process.env.XISORA_PASSWORD || '',
    COOKIE_HEADER: readSetting('xisora_cookie_header') || process.env.XISORA_COOKIE_HEADER || '',
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
let _portalClient = null;
let _portalJar = null;
let _portalLoggedIn = false;
let _source = 'api';

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

function buildPortalClient(baseURL) {
  _portalJar = new tough.CookieJar();
  const manual = String(readSetting('xisora_cookie_header') || '').trim();
  const saved = String(readSetting('xisora_session_cookie') || '').trim();
  const cookieHeader = manual || saved;
  if (cookieHeader) {
    for (const part of cookieHeader.split(/;\s*/)) {
      if (!part) continue;
      try { _portalJar.setCookieSync(part + '; Path=/', baseURL); }
      catch (e) { warn('portal cookie parse failed for', part.slice(0, 40), e.message); }
    }
    dlog(`loaded ${manual ? 'manual' : 'saved'} portal cookie`);
  }
  return wrapper(axios.create({
    baseURL,
    jar: _portalJar,
    withCredentials: true,
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: (s) => s < 500,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }));
}

async function persistPortalCookie() {
  try {
    const cookies = await _portalJar.getCookies(_portalClient.defaults.baseURL);
    const sess = cookies.find(c => /^PHPSESSID/i.test(c.key));
    if (sess) writeSetting('xisora_session_cookie', sess.cookieString());
  } catch (e) { warn('persistPortalCookie failed:', e.message); }
}

function mapPortalRow(row) {
  if (!Array.isArray(row)) return null;
  const datetime = row[0] ? String(row[0]) : '';
  const number = row[2] ? String(row[2]).replace(/\D/g, '') : '';
  const cli = row[3] ? String(row[3]) : '';
  const message = row[10] ? String(row[10]) : '';
  if (!number || !message) return null;
  return { datetime, number, cli, message };
}

async function portalLogin() {
  const { PORTAL_URL, USERNAME, PASSWORD, COOKIE_HEADER } = resolveCfg();
  if (!_portalClient) _portalClient = buildPortalClient(PORTAL_URL);
  if (COOKIE_HEADER) {
    const probe = await _portalClient.get('/client/Reports');
    const html = String(probe.data || '');
    if (probe.status === 200 && !/Enter Credentials|name=["']?password/i.test(html)) {
      _portalLoggedIn = true;
      _source = 'portal-cookie';
      return true;
    }
    throw new Error('xisora_cookie_expired');
  }
  if (!USERNAME || !PASSWORD) throw new Error('xisora_token_or_cookie_missing');
  throw new Error('xisora_captcha_login_manual_cookie_required');
}

async function fetchPortalRows() {
  if (!_portalLoggedIn) await portalLogin();
  const now = new Date();
  const past = new Date(now.getTime() - 10 * 60_000);
  const params = new URLSearchParams({
    fdate1: fmtDate(past),
    fdate2: fmtDate(now),
    ftermination: '', fclient: '', fnum: '', fcli: '',
    fgdate: '0', fgtermination: '0', fgclient: '0', fgnumber: '0', fgcli: '0', fg: '0',
    sEcho: String(Date.now() % 100000),
    iColumns: '11', sColumns: ',,,,,,,,,,',
    iDisplayStart: '0', iDisplayLength: '100',
    mDataProp_0: '0', sSearch_0: '', bRegex_0: 'false', bSearchable_0: 'true', bSortable_0: 'true',
    sSearch: '', bRegex: 'false', iSortCol_0: '0', sSortDir_0: 'desc', iSortingCols: '1',
    _: String(Date.now()),
  });
  const r = await _portalClient.get(`/client/ajax/dt_reports.php?${params.toString()}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': `${_portalClient.defaults.baseURL}/client/Reports`, 'Accept': 'application/json, text/javascript, */*; q=0.01' },
  });
  if (r.status === 401 || r.status === 403) throw new Error('xisora_portal_unauthorized');
  if (typeof r.data === 'string' && /Enter Credentials|name=["']?password/i.test(r.data)) throw new Error('xisora_portal_session_lost');
  await persistPortalCookie();
  return (r.data?.aaData || []).map(mapPortalRow).filter(Boolean);
}

async function fetchAnyRows() {
  const { TOKEN } = resolveCfg();
  if (TOKEN) {
    _source = 'api';
    return fetchRows();
  }
  _source = 'portal-cookie';
  return fetchPortalRows();
}

// Verify token is valid (used by Health Check button).
async function login() {
  const { TOKEN, BASE_URL } = resolveCfg();
  const rows = await fetchAnyRows();
  log(TOKEN
    ? `✓ token OK · ${rows.length} rows in last 10min @ ${BASE_URL}`
    : `✓ portal cookie OK · ${rows.length} rows in last 10min`);
  return true;
}

// ───────── tick ─────────
async function tickOnce() {
  const rows = await fetchAnyRows();
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