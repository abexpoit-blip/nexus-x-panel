// SMS Hadi Bot — axios + tough-cookie scraper for the "ints" SMS panel
// at http://2.59.169.96/ints (SMS Hadi). Same software family as Seven1Tel
// but the AJAX CDR endpoint requires a per-session `sesskey` token scraped
// from /agent/SMSCDRStats and lives under /agent/res/, not /res/.
//
// Settings (DB first, .env fallback):
//   smshadi_enabled            true|false
//   smshadi_base_url           http://2.59.169.96/ints
//   smshadi_username           mamun999
//   smshadi_password           mamun999
//   smshadi_otp_interval       24  (sec between CDR polls — portal enforces 15s min)
//   smshadi_session_cookie     (auto-saved PHPSESSID for fast restart)
//   smshadi_sesskey            (auto-saved sesskey for the AJAX endpoint)

const axios = require('axios');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const db = require('../lib/db');
const { markOtpReceived } = require('../routes/numbers');
const { logOtpAudit } = require('../lib/otpAudit');
const { getOtpExpirySec } = require('../lib/settings');
const { Telemetry } = require('./_botTelemetry');
const tel = new Telemetry();

const QUIET = process.env.NODE_ENV === 'production';
const log  = (...a) => console.log('[smshadi-bot]', ...a);
const dlog = (...a) => { if (!QUIET) console.log('[smshadi-bot]', ...a); };
const warn = (...a) => console.warn('[smshadi-bot]', ...a);

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
  const fb = 'http://2.59.169.96/ints';
  if (!raw) return fb;
  let s = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s;
}
function resolveCfg() {
  const dbEnabled = readSetting('smshadi_enabled');
  return {
    ENABLED: (dbEnabled !== null ? dbEnabled : (process.env.SMSHADI_ENABLED || 'false'))
              .toString().toLowerCase() === 'true',
    BASE_URL: normalizeBase(readSetting('smshadi_base_url') || process.env.SMSHADI_BASE_URL),
    USERNAME: readSetting('smshadi_username') || process.env.SMSHADI_USERNAME || 'mamun999',
    PASSWORD: readSetting('smshadi_password') || process.env.SMSHADI_PASSWORD || 'mamun999',
    INTERVAL: Math.max(60, +(readSetting('smshadi_otp_interval') || process.env.SMSHADI_OTP_INTERVAL || 60)),
  };
}

let _client = null, _jar = null;
let _loggedIn = false, _running = false, _stopFlag = false;
let _lastTickAt = null, _lastError = null, _consecFail = 0, _otpDelivered = 0;
let _lastCdrSuccessAt = null;
let _provider503Count = 0, _last503At = null, _lastWarmupAt = null, _warmupCount = 0;
let _seenIds = new Set();
let _sesskey = null;
let _nextCdrAt = 0, _lastCdrRequestAt = 0, _cdrGate = Promise.resolve();
const SEEN_MAX = 5000;
const SMSHADI_MIN_CDR_GAP_MS = 60_000;
const SMSHADI_POST_LOGIN_COOLDOWN_MS = 20_000;
const SMSHADI_503_BASE_COOLDOWN_MS = 5 * 60_000;
const SMSHADI_503_MAX_COOLDOWN_MS = 30 * 60_000;
const SMSHADI_LATE_GRACE_SEC = 24 * 3600;
const RESEND_SEC = 600;
const SMSHADI_DASHBOARD_WARMUP_DELAY_MS = 15_000;
const WORKER_VERSION = '2026-05-06-smshadi-dashboard-warmup-v4';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function providerStatus(e) {
  const direct = Number(e?.response?.status || e?.status || 0);
  if (direct) return direct;
  const m = String(e?.message || '').match(/(?:status code|http_|provider_http_)(5\d\d)/i);
  return m ? Number(m[1]) : 0;
}
function isProvider5xxError(e) {
  const st = providerStatus(e);
  return (st >= 500 && st < 600) || /cdr_503|cdr_http_5\d\d|provider_http_5\d\d|status code 5\d\d/i.test(String(e?.message || e || ''));
}
function setCdrCooldown(ms) {
  _nextCdrAt = Math.max(_nextCdrAt || 0, Date.now() + Math.max(0, ms));
  writeSetting('smshadi_next_cdr_at_ms', String(_nextCdrAt));
  return Math.ceil(Math.max(0, _nextCdrAt - Date.now()) / 1000);
}
async function waitForCdrGate(reason = 'CDR') {
  const previousGate = _cdrGate.catch(() => {});
  let releaseGate;
  _cdrGate = new Promise(resolve => { releaseGate = resolve; });
  await previousGate;
  try {
    const persistedNext = +(readSetting('smshadi_next_cdr_at_ms') || 0);
    if (persistedNext > _nextCdrAt) _nextCdrAt = persistedNext;
    const until = Math.max(_nextCdrAt, _lastCdrRequestAt + SMSHADI_MIN_CDR_GAP_MS);
    const waitMs = until - Date.now();
    if (waitMs > 0) {
      const waitSec = Math.ceil(waitMs / 1000);
      warn(`${reason} rate gate — waiting ${waitSec}s before SMS Hadi CDR request`);
      await sleep(waitMs);
    }
    _lastCdrRequestAt = Date.now();
  } finally {
    releaseGate();
  }
}

function buildClient(baseURL) {
  _jar = new tough.CookieJar();
  const saved = readSetting('smshadi_session_cookie');
  if (saved) { try { _jar.setCookieSync(saved, baseURL); dlog('restored saved session cookie'); }
              catch (e) { warn('cookie restore failed:', e.message); } }
  const c = wrapper(axios.create({
    baseURL, jar: _jar, withCredentials: true, timeout: 15000, maxRedirects: 5,
    validateStatus: (s) => s < 600,
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }));
  return c;
}

async function persistSessionCookie() {
  try {
    const cookies = await _jar.getCookies(_client.defaults.baseURL);
    const sess = cookies.find(c => /^PHPSESSID/i.test(c.key));
    if (sess) writeSetting('smshadi_session_cookie', sess.cookieString());
  } catch (e) { warn('persistSession failed:', e.message); }
}

async function login() {
  const { BASE_URL, USERNAME, PASSWORD } = resolveCfg();
  if (!USERNAME || !PASSWORD) throw new Error('smshadi creds missing');
  tel.recordLoginAttempt();
  if (!_client) _client = buildClient(BASE_URL);

  const r1 = await _client.get('/login');
  const html = String(r1.data || '');
  dlog('GET /login →', r1.status, 'len', html.length);
  if (r1.status >= 500) throw new Error('provider_http_' + r1.status + '_login');

  // Math captcha: "What is 4 + 9 = ? :"
  const m = html.match(/What\s+is\s+(\d+)\s*([+\-*x\/])\s*(\d+)\s*=/i);
  let captAns = null;
  if (m) {
    const a = +m[1], b = +m[3], op = m[2].toLowerCase();
    captAns = op === '+' ? a + b : op === '-' ? a - b
            : (op === '*' || op === 'x') ? a * b
            : op === '/' ? Math.floor(a / b) : null;
  }
  const captName = html.match(/<input[^>]+name=["']([^"']+)["'][^>]+placeholder=["']Answer["']/i)?.[1] || 'capt';

  const form = new URLSearchParams();
  form.set('username', USERNAME);
  form.set('password', PASSWORD);
  if (captAns != null) form.set(captName, String(captAns));

  const r2 = await _client.post('/signin', form.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE_URL}/login`,
      'Origin': BASE_URL,
    },
  });
  dlog('POST /signin →', r2.status, 'final', r2.request?.res?.responseUrl || '?');
  if (r2.status >= 500) throw new Error('provider_http_' + r2.status + '_signin');

  // Verify by hitting the Reports page (this is what the admin UI mirrors,
  // and on /ints panels each page issues its own sesskey).
  let probe = await _client.get('/agent/SMSCDRReports');
  let phtml = String(probe.data || '');
  let isLogin = /<form[^>]+action=['"]?signin/i.test(phtml) || /placeholder=["']Username["']/i.test(phtml);
  if (probe.status === 404) {
    // Fallback to Stats page if Reports route is not present
    probe = await _client.get('/agent/SMSCDRStats');
    phtml = String(probe.data || '');
    isLogin = /<form[^>]+action=['"]?signin/i.test(phtml) || /placeholder=["']Username["']/i.test(phtml);
  }
  if (probe.status >= 500) throw new Error('provider_http_' + probe.status + '_probe');
  if (probe.status !== 200 || isLogin) {
    log('login probe FAIL — status', probe.status, 'preview:', phtml.slice(0, 200).replace(/\s+/g, ' '));
    throw new Error('login_failed');
  }
  // Pull sesskey out of sAjaxSource URL on the Reports page
  const sk = phtml.match(/sesskey=([A-Za-z0-9=+/]+)/);
  if (sk) {
    _sesskey = sk[1];
    writeSetting('smshadi_sesskey', _sesskey);
    dlog('captured sesskey', _sesskey);
  } else {
    warn('sesskey not found on /agent/SMSCDRReports');
  }
  await persistSessionCookie();
  _loggedIn = true;
  setCdrCooldown(SMSHADI_POST_LOGIN_COOLDOWN_MS);
  tel.recordLoginSuccess();
  log('✓ login OK as', USERNAME);
  return true;
}

// Mimic a real agent: open SMSDashboard, idle ~15s, then open SMSCDRReports
// (which refreshes the per-page sesskey). The provider serves the AJAX CDR
// endpoint much more reliably right after this navigation pattern.
async function dashboardWarmup() {
  if (!_client) return false;
  try {
    const dash = await _client.get('/agent/SMSDashboard', {
      headers: { 'Referer': `${_client.defaults.baseURL}/agent/SMSDashboard` },
    });
    dlog('warmup GET /agent/SMSDashboard →', dash.status);
    if (dash.status >= 500) { warn('warmup dashboard HTTP', dash.status); return false; }
    await sleep(SMSHADI_DASHBOARD_WARMUP_DELAY_MS);
    const rep = await _client.get('/agent/SMSCDRReports', {
      headers: { 'Referer': `${_client.defaults.baseURL}/agent/SMSDashboard` },
    });
    dlog('warmup GET /agent/SMSCDRReports →', rep.status);
    if (rep.status >= 500) { warn('warmup reports HTTP', rep.status); return false; }
    const html = String(rep.data || '');
    const sk = html.match(/sesskey=([A-Za-z0-9=+/]+)/);
    if (sk) {
      _sesskey = sk[1];
      writeSetting('smshadi_sesskey', _sesskey);
      dlog('warmup refreshed sesskey', _sesskey);
    }
    _lastWarmupAt = Math.floor(Date.now() / 1000);
    _warmupCount++;
    return true;
  } catch (e) {
    warn('warmup failed:', e.message);
    return false;
  }
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function fetchCdrRows() {
  if (!_sesskey) _sesskey = readSetting('smshadi_sesskey');
  if (!_sesskey) throw new Error('cdr_session_lost'); // forces re-login
  await waitForCdrGate('bot');
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const echo = String(Date.now() % 100000);
  const params = new URLSearchParams({
    fdate1: fmtDate(dayStart),
    fdate2: fmtDate(dayEnd),
    frange: '', fclient: '', fnum: '', fcli: '',
    fgdate: '', fgmonth: '', fgrange: '', fgclient: '', fgnumber: '', fgcli: '',
    fg: '0', sesskey: _sesskey,
    sEcho: echo,
    iColumns: '9',
    sColumns: ',,,,,,,,',
    iDisplayStart: '0',
    iDisplayLength: '25',
  });
  for (let i = 0; i < 9; i++) {
    params.set(`mDataProp_${i}`, String(i));
    params.set(`sSearch_${i}`, '');
    params.set(`bRegex_${i}`, 'false');
    params.set(`bSearchable_${i}`, 'true');
    params.set(`bSortable_${i}`, i === 8 ? 'false' : 'true');
  }
  params.set('sSearch', '');
  params.set('bRegex', 'false');
  params.set('iSortCol_0', '0');
  params.set('sSortDir_0', 'desc');
  params.set('iSortingCols', '1');
  params.set('_', String(Date.now()));
  let r;
  try {
    r = await _client.get(`/agent/res/data_smscdr.php?${params.toString()}`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': `${_client.defaults.baseURL}/agent/SMSCDRReports`,
      },
    });
  } catch (e) {
    // axios threw despite validateStatus — surface a stable error code so
    // the loop's cooldown branch can match it.
    const st = e?.response?.status;
    if (st === 503) { warn('CDR 503 (thrown) from panel'); throw new Error('cdr_503'); }
    if (st && st >= 500) throw new Error('cdr_http_' + st);
    if (st === 401 || st === 403) throw new Error('cdr_unauthorized');
    throw e;
  }
  const preview = (typeof r.data === 'string' ? r.data : JSON.stringify(r.data || {})).slice(0, 300).replace(/\s+/g, ' ');
  if (typeof r.data === 'string' && /Refresh must be done with atleast 15 second interval/i.test(r.data)) {
    warn('CDR portal rate warning — preview:', preview);
    throw new Error('cdr_rate_limited');
  }
  if (r.status === 401 || r.status === 403) throw new Error('cdr_unauthorized');
  if (r.status === 503) {
    warn('CDR 503 from panel — preview:', preview);
    throw new Error('cdr_503');
  }
  if (r.status === 404 || (typeof r.data === 'string' && /404 Not Found/i.test(r.data))) {
    // sesskey expired
    _sesskey = null;
    throw new Error('cdr_session_lost');
  }
  if (typeof r.data === 'string' && /name=["']password["']/i.test(r.data)) throw new Error('cdr_session_lost');
  if (r.status >= 400) {
    warn('CDR HTTP', r.status, '— preview:', preview);
    throw new Error('cdr_http_' + r.status);
  }
  if (!r.data || !Array.isArray(r.data.aaData)) {
    warn('CDR unexpected response — status', r.status, 'preview:', preview);
    throw new Error('cdr_bad_response');
  }
  const rows = (r.data && r.data.aaData) || [];
  return rows;
}

// Authenticated paginated fetch — used by admin OTP history UI (SMSCDRReports).
// No rate-limit on this panel, so we can serve filtered pages on-demand.
async function fetchCdrPage({ fdate1, fdate2, fnum = '', fcli = '', frange = '',
                              start = 0, length = 50 } = {}) {
  if (!_loggedIn) await login();
  if (!_sesskey) _sesskey = readSetting('smshadi_sesskey');
  if (!_sesskey) await login();
  await waitForCdrGate('admin history');
  const now  = new Date(Date.now() + 2 * 60 * 60_000);
  const past = new Date(Date.now() - 24 * 60 * 60_000);
  const params = new URLSearchParams({
    fdate1: fdate1 || fmtDate(past),
    fdate2: fdate2 || fmtDate(now),
    frange: String(frange || ''), fclient: '',
    fnum: String(fnum || ''), fcli: String(fcli || ''),
    fgdate: '', fgmonth: '', fgrange: '', fgclient: '', fgnumber: '', fgcli: '',
    fg: '0', sesskey: _sesskey,
    iDisplayLength: String(Math.max(10, Math.min(500, +length || 50))),
    iDisplayStart:  String(Math.max(0, +start || 0)),
    sEcho: String(Date.now() % 100000),
  });
  const doFetch = () => _client.get(`/agent/res/data_smscdr.php?${params.toString()}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest',
               'Referer': `${_client.defaults.baseURL}/agent/SMSCDRReports` },
  });
  let r = await doFetch();
  if (typeof r.data === 'string' && /Refresh must be done with atleast 15 second interval/i.test(r.data)) {
    throw new Error('sms_hadi_rate_limited_wait_15s');
  }
  if (r.status === 401 || r.status === 403 ||
      (typeof r.data === 'string' && (/404 Not Found/i.test(r.data) || /name=["']password["']/i.test(r.data)))) {
    _sesskey = null; _loggedIn = false;
    await login();
    params.set('sesskey', _sesskey || '');
    r = await doFetch();
  }
  const data = r.data || {};
  const rows = Array.isArray(data.aaData) ? data.aaData : [];
  return {
    rows: rows.map((row) => ({
      date:    String(row[0] || ''),
      range:   row[1] ? String(row[1]) : null,
      number:  String(row[2] || '').replace(/\D/g, ''),
      cli:     row[3] ? String(row[3]) : null,
      client:  row[4] ? String(row[4]) : null,
      message: row[5] ? String(row[5]) : null,
    })),
    total: +data.iTotalRecords || 0,
    filtered: +data.iTotalDisplayRecords || rows.length,
    start: +params.get('iDisplayStart'),
    length: +params.get('iDisplayLength'),
  };
}

// Row shape observed: [date, range, number, cli, client_name, message, null, 0, 0]
function parseRow(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const dateCol = String(row[0] || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateCol)) return null;
  const range = row[1] ? String(row[1]) : null;
  const phone = String(row[2] || '').replace(/\D/g, '');
  const cli = row[3] ? String(row[3]) : null;
  const msg = row[5] ? String(row[5]) : null;
  if (!phone || !msg) return null;
  const otpMatch = msg.match(/(?:^|\D)(\d{4,8})(?=\D|$)/);
  return {
    phone, cli, range, msg,
    otp: otpMatch ? otpMatch[1] : null,
    cdr_at: parsePanelTimestamp(dateCol),
    dedup_key: `${phone}|${msg.slice(0, 60)}|${dateCol}`,
  };
}

function parsePanelTimestamp(dateCol) {
  const m = String(dateCol || '').match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Math.floor(new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).getTime() / 1000);
}

function cliToServiceSlug(cli, msg) {
  const hay = `${cli || ''} ${msg || ''}`.toLowerCase();
  if (/whats\s*app|wa\b/.test(hay)) return 'whatsapp';
  if (/facebook|fb\b|meta/.test(hay)) return 'facebook';
  if (/instagram|insta\b/.test(hay)) return 'instagram';
  if (/telegram/.test(hay)) return 'telegram';
  if (/google|gmail|youtube/.test(hay)) return 'google';
  if (/tiktok/.test(hay)) return 'tiktok';
  if (/twitter|\bx\b/.test(hay)) return 'twitter';
  return null;
}

function findActiveAllocation(phone, cdrAtSec = null, cliSlug = null) {
  const tail = phone.slice(-9);
  if (!tail) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const expirySec = getOtpExpirySec();
  const eventAt = Number.isFinite(+cdrAtSec) && +cdrAtSec > 0 ? +cdrAtSec : nowSec;
  const oldestAllocatedAt = eventAt - expirySec - SMSHADI_LATE_GRACE_SEC;
  const newestAllocatedAt = eventAt + 60;
  let serviceId = null;
  if (cliSlug) {
    try { serviceId = db.prepare('SELECT id FROM services WHERE slug = ?').get(cliSlug)?.id || null; }
    catch (_) { serviceId = null; }
  }
  const runMatch = (extraSql = '', extraArgs = []) => db.prepare(`
    SELECT id, user_id, phone_number, provider, country_code, operator, service_id, status, allocated_at
    FROM allocations
    WHERE phone_number LIKE ?
      ${extraSql}
      AND ( status='active'
         OR (status='expired'  AND allocated_at BETWEEN ? AND ?)
         OR (status='received' AND allocated_at >= ?) )
    ORDER BY allocated_at DESC LIMIT 1
  `).get(`%${tail}`, ...extraArgs, oldestAllocatedAt, newestAllocatedAt, nowSec - RESEND_SEC);
  if (serviceId) {
    const matched = runMatch('AND service_id = ?', [serviceId]);
    if (matched) return matched;
  }
  return runMatch();
}

async function tickOnce() {
  if (!_loggedIn) await login();
  const rows = await fetchCdrRows();
  _lastCdrSuccessAt = Math.floor(Date.now() / 1000);
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
    const cliSlug = cliToServiceSlug(r.cli, r.msg);
    const alloc = findActiveAllocation(r.phone, r.cdr_at, cliSlug);
    if (!alloc) {
      tel.recordMiss(r.phone, `OTP "${r.otp}" (${r.cli || '?'}) arrived but no allocation matched suffix-9${cliSlug ? `+service=${cliSlug}` : ''} within SMS Hadi late window`);
      logOtpAudit({
        source: 'smshadi', source_msg_id: r.dedup_key,
        phone_number: r.phone, cli: r.cli, otp_code: r.otp, sms_text: r.msg,
        outcome: 'mismatch',
        miss_reason: `no allocation matched (suffix-9${cliSlug ? `, service=${cliSlug}` : ''}, late-window=24h)`,
      });
      continue;
    }
    try {
      await markOtpReceived(alloc, r.otp, r.cli, r.msg || null,
        { source: 'smshadi', source_msg_id: r.dedup_key });
      delivered++; _otpDelivered++;
      tel.recordOtpDelivered();
      log(`✓ OTP ${r.phone} → ${r.otp} (alloc#${alloc.id}, agent#${alloc.user_id})`);
    } catch (e) {
      warn('markOtpReceived failed:', e.message);
      tel.recordError(`markOtpReceived: ${e.message}`);
      logOtpAudit({
        source: 'smshadi', source_msg_id: r.dedup_key,
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
    try {
      const n = await tickOnce();
      tel.recordTick();
      _lastTickAt = Math.floor(Date.now() / 1000);
      _lastError = null; _consecFail = 0;
      if (n) log('delivered', n, 'OTPs this tick');
    } catch (e) {
      warn('tick error:', e.message);
      _lastError = e.message;
      tel.recordError(e.message);
      _consecFail++;
      if (/session_lost|unauthorized|login_failed/i.test(e.message)) {
        _loggedIn = false; _sesskey = null;
      }
      if (/cdr_rate_limited|rate_limited_wait_15s/i.test(e.message)) {
        const cooldown = setCdrCooldown(Math.max(60_000, Math.min(5 * 60_000, 60_000 + _consecFail * 30_000)));
        warn(`SMS Hadi portal 15s rate-limit hit: next CDR request in ${cooldown}s`);
        await sleep(cooldown * 1000);
        continue;
      }
      // 503 is usually the provider's temporary block/rate page. Keep the login
      // session and back off; do not relogin-loop because that makes the block worse.
      // Match both our normalized codes AND raw axios "status code 5xx" messages.
      if (isProvider5xxError(e)) {
        const status = providerStatus(e) || 503;
        if (status === 503) { _provider503Count++; _last503At = Math.floor(Date.now() / 1000); }
        const cooldown = setCdrCooldown(Math.min(
          SMSHADI_503_MAX_COOLDOWN_MS,
          SMSHADI_503_BASE_COOLDOWN_MS * Math.max(1, _consecFail),
        ));
        warn(`provider ${status} cooldown active: next SMS Hadi request in ${cooldown}s`);
        await sleep(cooldown * 1000);
        // Try the human navigation pattern (Dashboard → 15s → Reports) before
        // hammering the AJAX endpoint again. This usually clears the 503.
        if (_loggedIn) {
          log('attempting dashboard→reports warmup to clear provider 503');
          await dashboardWarmup();
        }
        continue;
      }
      const backoff = Math.min(60, 5 + _consecFail * 2);
      await sleep(backoff * 1000);
    }
    await sleep(cfg.INTERVAL * 1000);
  }
  _running = false;
}

function start() {
  const cfg = resolveCfg();
  if (!cfg.ENABLED) { log('disabled (smshadi_enabled=false) — not starting'); return; }
  if (_running) { log('already running — skip start'); return; }
  _stopFlag = false;
  log('starting…  version=', WORKER_VERSION, 'base=', cfg.BASE_URL, 'interval=', cfg.INTERVAL, 's');
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
    sesskey_loaded: !!_sesskey,
    portal_url: cfg.BASE_URL + '/agent/SMSCDRReports',
    worker_version: WORKER_VERSION,
    last_cdr_success_at: _lastCdrSuccessAt,
    last_cdr_request_at: _lastCdrRequestAt || null,
    next_cdr_at: _nextCdrAt || null,
    cooldown_ms_remaining: Math.max(0, (_nextCdrAt || 0) - Date.now()),
    min_cdr_gap_ms: SMSHADI_MIN_CDR_GAP_MS,
    provider_503_base_cooldown_ms: SMSHADI_503_BASE_COOLDOWN_MS,
    provider_503_count: _provider503Count,
    last_503_at: _last503At,
    last_warmup_at: _lastWarmupAt,
    warmup_count: _warmupCount,
    ...tel.snapshot(),
  };
}

module.exports = { start, stop, login, tickOnce, getStatus, fetchCdrPage };
