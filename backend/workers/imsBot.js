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
const MIN_INTERVAL_FLOOR = 16; // absolute minimum admin can configure (IMS rule = 15s, +1s safety)

// Defaults for the CDR cooldown / rate-limit backoff. Admins can override
// these at runtime via the settings table — no redeploy required.
const DEFAULT_CDR_MIN_INTERVAL = 18;     // gap between human-style page refreshes (sec)
// IMS soft-blocks aggressive scrapers. Once they return 503 we MUST back off
// hard or they keep returning 503 indefinitely. Exponential ramp up to 10min.
const DEFAULT_RL_PENALTY_BASE  = 60;     // first 503 → wait 60s
const DEFAULT_RL_PENALTY_MAX   = 600;    // cap at 10 minutes
const DEFAULT_RL_PENALTY_STEPS = 6;      // 60 → 120 → 180 → 240 → 300 → 600
// Re-login does NOT clear an IMS soft-block (the block is per-IP, not per-session).
// We disable auto-relogin on rate-limit by default — set threshold huge so it only
// triggers on genuine session loss paths (cdr_session_lost, unauthorized).
const DEFAULT_RL_RELOGIN_THRESHOLD = 9999;
const DEFAULT_RL_RELOGIN_STALE_SEC = 1800; // and only after 30min of no successful scrape

function num(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fb;
}
function readCooldownCfg() {
  const minInterval = Math.max(
    MIN_INTERVAL_FLOOR,
    num(readSetting('ims_cdr_min_interval_sec'), DEFAULT_CDR_MIN_INTERVAL)
  );
  const penaltyBase = Math.max(1, num(readSetting('ims_rl_penalty_base_sec'), DEFAULT_RL_PENALTY_BASE));
  const penaltyMax  = Math.max(penaltyBase, num(readSetting('ims_rl_penalty_max_sec'), DEFAULT_RL_PENALTY_MAX));
  const penaltySteps = Math.max(1, Math.floor(num(readSetting('ims_rl_penalty_steps'), DEFAULT_RL_PENALTY_STEPS)));
  const reloginThreshold = Math.max(2, Math.floor(num(readSetting('ims_rl_relogin_threshold'), DEFAULT_RL_RELOGIN_THRESHOLD)));
  const reloginStaleSec = Math.max(60, Math.floor(num(readSetting('ims_rl_relogin_stale_sec'), DEFAULT_RL_RELOGIN_STALE_SEC)));
  return { minInterval, penaltyBase, penaltyMax, penaltySteps, reloginThreshold, reloginStaleSec };
}

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
function isRateLimitError(msg) {
  return /rate_limited|cdr_(page|http)_(429|503)|15\s*second|within\s+\d+\s*sec|refresh\s+.*frequent|too\s+many/i.test(String(msg || ''));
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
  const cd = readCooldownCfg();
  return {
    ENABLED: (dbEnabled !== null ? dbEnabled : (process.env.IMS_ENABLED || 'false'))
              .toString().toLowerCase() === 'true',
    BASE_URL: normalizeBase(readSetting('ims_base_url') || process.env.IMS_BASE_URL),
    USERNAME: readSetting('ims_username') || process.env.IMS_USERNAME || '',
    PASSWORD: readSetting('ims_password') || process.env.IMS_PASSWORD || '',
    INTERVAL: Math.max(cd.minInterval, interval),
    COOLDOWN: cd,
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
let _cdrGateQueue = Promise.resolve();
let _lastRateLimitWarnAt = 0;
let _lastRateLimitAt = null;
let _lastCdrSuccessAt = null;
let _reloginCount = 0;       // # of automatic re-logins triggered
let _lastReloginAt = null;

// Drop saved/stale cookies and force the next tick to do a fresh captcha login.
// If a manual cookie header is set but credentials exist, we also clear the
// manual header so it can't keep poisoning the session.
async function forceRelogin(reason) {
  const { USERNAME, PASSWORD } = resolveCfg();
  const manualCookie = String(readSetting('ims_cookie_header') || '').trim();
  const haveCreds = !!(USERNAME && PASSWORD);
  const { minInterval } = readCooldownCfg();

  warn(`auto-relogin triggered: ${reason}`);
  writeSetting('ims_session_cookie', '');
  if (manualCookie && haveCreds) {
    writeSetting('ims_cookie_header', '');
    log('cleared stale manual cookie header (credentials available — captcha login next)');
  }
  _client = null;
  _jar = null;
  _loggedIn = false;
  _sesskey = null;
  // Do not shorten an existing rate-limit penalty. A fresh login still needs
  // /client/SMSCDRStats to obtain sesskey, so respect the IMS 15s CDR gate.
  _nextCdrAllowedAt = Math.max(_nextCdrAllowedAt, Date.now() + (minInterval * 1000));
  _reloginCount++;
  _lastReloginAt = Math.floor(Date.now() / 1000);

  if (!haveCreds) {
    warn('cannot auto-relogin: username/password missing; cookie-only mode must wait for pasted fresh PHPSESSID');
    return false;
  }
  try {
    if (!_client) _client = buildClient(resolveCfg().BASE_URL);
    await login(true);
    _rateLimitStreak = 0;
    log('✓ auto-relogin success — fresh PHPSESSID saved');
    return true;
  } catch (e) {
    warn('auto-relogin failed:', e.message);
    return false;
  }
}

async function waitForCdrGate() {
  // Serialize all CDR/stats access across the worker and admin health probes.
  // Without this, two callers can pass the timestamp check together and trigger
  // IMS' 15s protection even when the configured interval is correct.
  const previous = _cdrGateQueue.catch(() => {});
  _cdrGateQueue = previous.then(async () => {
    const now = Date.now();
    if (_nextCdrAllowedAt > now) {
      await new Promise(r => setTimeout(r, _nextCdrAllowedAt - now));
    }
    const { minInterval } = readCooldownCfg();
    _nextCdrAllowedAt = Date.now() + (minInterval * 1000);
  });
  return _cdrGateQueue;
}

function registerRateLimitCooldown() {
  const { penaltyBase, penaltyMax, penaltySteps } = readCooldownCfg();
  const step = Math.min(Math.max(_rateLimitStreak, 1), penaltySteps);
  const penaltyMs = Math.min(penaltyMax * 1000, penaltyBase * 1000 * step);
  _nextCdrAllowedAt = Math.max(_nextCdrAllowedAt, Date.now() + penaltyMs);
  _lastRateLimitAt = Math.floor(Date.now() / 1000);
  const now = Date.now();
  if (now - _lastRateLimitWarnAt > 60_000) {
    log(`IMS CDR cooldown — waiting ${Math.ceil(penaltyMs / 1000)}s before next scrape`);
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

async function persistSessionCookie(saveHeader = false) {
  try {
    const cookies = await _jar.getCookies(_client.defaults.baseURL);
    const sess = cookies.find(c => /^PHPSESSID/i.test(c.key));
    if (sess) writeSetting('ims_session_cookie', sess.cookieString());
    if (saveHeader && cookies.length) writeSetting('ims_cookie_header', cookies.map(c => c.cookieString()).join('; '));
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
  // NOTE: gate is held by the caller (tickOnce or login). The AJAX fetchCdrRows
  // call right after this is part of the same "human page refresh" and runs
  // immediately — exactly like a browser firing its DataTables AJAX after the
  // page renders. Don't gate twice or we'd insert an 18s pause between the
  // page load and the data load.
  const probe = await _client.get('/client/SMSCDRStats');
  if (probe.status === 429 || probe.status === 503) throw new Error('cdr_rate_limited');
  if (probe.status !== 200) throw new Error(`cdr_page_${probe.status}`);
  const html = String(probe.data || '');
  if (/15\s*second|within\s+\d+\s*sec|refresh\s+.*frequent|too\s+many/i.test(html)) throw new Error('cdr_rate_limited');
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

async function login(forceCaptcha = false) {
  const { BASE_URL, USERNAME, PASSWORD } = resolveCfg();
  const manualCookie = String(readSetting('ims_cookie_header') || '').trim();
  if (!USERNAME && !PASSWORD && !manualCookie) {
    throw new Error('ims_creds_missing (set username/password OR cookie header)');
  }
  tel.recordLoginAttempt();
  if (!_client) _client = buildClient(BASE_URL);

  if (forceCaptcha && (!USERNAME || !PASSWORD)) {
    throw new Error('ims_creds_missing (fresh login requires username/password)');
  }

  // Try saved/manual cookie first — covers both auto-resume after restart
  // and cookie-only login (admin pasted PHPSESSID, no credentials).
  if (_jar && !forceCaptcha) {
    try {
      await waitForCdrGate();
      const probe = await _client.get('/client/SMSCDRStats');
      const html = String(probe.data || '');
      if (probe.status === 429 || probe.status === 503 || /15\s*second|within\s+\d+\s*sec|refresh\s+.*frequent|too\s+many/i.test(html)) {
        throw new Error('cdr_rate_limited');
      }
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
    } catch (e) {
      if (isRateLimitError(e.message)) throw e;
      /* fall through */
    }
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
  await persistSessionCookie(forceCaptcha);
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

function fmtDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function startOfTodaySec() {
  const d = new Date();
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
}

function parsePanelTimestamp(dateCol) {
  const m = String(dateCol || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const hh = m[4] || '00', mm = m[5] || '00', ss = m[6] || '00';
  return Math.floor(new Date(`${m[1]}-${m[2]}-${m[3]}T${hh}:${mm}:${ss}`).getTime() / 1000);
}

async function fetchCdrRows() {
  if (!_sesskey) await refreshSesskey();
  // Per scrape rule: follow dates only, not times — always query today only.
  const today = new Date();
  const dayStr = fmtDay(today);
  const params = new URLSearchParams({
    fdate1: dayStr, fdate2: dayStr,
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
  // Mimic a real browser: small 400-600ms delay between page render and
  // DataTables AJAX firing. NOT a full gate — that's already enforced by the
  // caller before refreshSesskey().
  await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 200)));
  const r = await _client.get(`/client/res/data_smscdr.php?${params.toString()}`, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${_client.defaults.baseURL}/client/SMSCDRStats`,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
    },
  });
  if (r.status === 401 || r.status === 403) throw new Error('cdr_unauthorized');
  if (r.status === 429 || r.status === 503) throw new Error('cdr_rate_limited');  // IMS 15s rule
  if (r.status >= 400) throw new Error(`cdr_http_${r.status}`);
  let data = r.data;
  if (typeof data === 'string') {
    const raw = data.trim();
    if (/<form[^>]+action=['"]?signin/i.test(raw)) throw new Error('cdr_session_lost');
    if (/15\s*second|within\s+\d+\s*sec|refresh\s+.*frequent|too\s+many/i.test(raw)) throw new Error('cdr_rate_limited');
    try {
      data = JSON.parse(raw);
    } catch (_) {
      log(`cdr raw: ${raw.replace(/\s+/g, ' ').slice(0, 300)}`);
      throw new Error('cdr_bad_response');
    }
  }
  // TEMP DIAGNOSTIC: dump aaData shape so we can see what IMS returns
  try {
    const d = data || {};
    log(`cdr resp: iTotalRecords=${d.iTotalRecords} iTotalDisplayRecords=${d.iTotalDisplayRecords} aaData.len=${(d.aaData||[]).length} firstRow=${JSON.stringify((d.aaData||[])[0])}`);
  } catch(_){}
  return data?.aaData || [];
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
  // IMPORTANT: do NOT strip whitespace before matching. Stripping turns
  // "# 458825 is your Facebook code" into "#458825isyourFacebookcode",
  // which glues the digits to a letter and breaks `\b(\d{4,8})\b`
  // (no word boundary between a digit and a letter — both are word chars).
  // Match on the raw message so spaces around the OTP act as word boundaries.
  // We still tolerate hyphenated codes like "458-825" by trying a stripped
  // fallback only if the primary match fails.
  let otpMatch = msg.match(/\b(\d{4,8})\b/);
  if (!otpMatch) {
    // fallback: collapse hyphens/dots inside number groups (e.g. "458-825")
    const collapsed = msg.replace(/(?<=\d)[\-.](?=\d)/g, '');
    otpMatch = collapsed.match(/\b(\d{4,8})\b/);
  }
  return {
    phone, otp: otpMatch ? otpMatch[1] : null,
    msg, cli, range, datetime,
    cdr_at: parsePanelTimestamp(datetime),
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

// Map IMS CLI text to a service slug. IMS puts the brand name in the CLI
// column (e.g. "Facebook", "WhatsApp", "Telegram"). We use this to route
// the OTP to the allocation that asked for the matching service, so a
// Facebook OTP never gets delivered to a pending WhatsApp request and
// vice-versa.
function cliToServiceSlug(cli, msg) {
  const hay = `${cli || ''} ${msg || ''}`.toLowerCase();
  if (/whats\s*app|wa\b/.test(hay)) return 'whatsapp';
  if (/facebook|fb\b|meta/.test(hay)) return 'facebook';
  if (/telegram/.test(hay)) return 'telegram';
  if (/instagram|insta\b/.test(hay)) return 'instagram';
  if (/google|gmail|youtube/.test(hay)) return 'google';
  if (/tiktok/.test(hay)) return 'tiktok';
  if (/twitter|\bx\b/.test(hay)) return 'twitter';
  return null;
}

// Service-aware allocation match: prefer allocation whose service_id maps
// to the slug derived from CLI. Falls back to phone-only match.
function findAllocationForCdr(phone, cliSlug) {
  const tail = String(phone).slice(-9);
  if (!tail) return null;
  const GRACE_SEC = 300, RESEND_SEC = 600;
  const now = Math.floor(Date.now() / 1000);
  let serviceId = null;
  if (cliSlug) {
    try { serviceId = db.prepare('SELECT id FROM services WHERE slug = ?').get(cliSlug)?.id || null; }
    catch (_) { serviceId = null; }
  }
  if (serviceId) {
    const matched = db.prepare(`
      SELECT id, user_id, phone_number, provider, country_code, operator, service_id, status, allocated_at
      FROM allocations
      WHERE phone_number LIKE ?
        AND service_id = ?
        AND (status='active'
          OR (status='expired'  AND allocated_at >= ?)
          OR (status='received' AND allocated_at >= ?))
      ORDER BY allocated_at DESC LIMIT 1
    `).get(`%${tail}`, serviceId, now - GRACE_SEC, now - RESEND_SEC);
    if (matched) return matched;
  }
  return findActiveAllocation(phone);
}

async function tickOnce() {
  if (!_loggedIn) await login();
  // One human-style page refresh per tick: gate once, then do page + AJAX
  // back-to-back (just like a browser does on F5).
  await waitForCdrGate();
  // Behave like a human refreshing the SMSCDRStats page in a browser:
  //   1) GET /client/SMSCDRStats     (the page itself, gives a fresh sesskey)
  //   2) GET /client/res/data_smscdr (the AJAX call the page makes for table rows)
  // This matches the exact request pattern a real browser produces when the
  // user hits F5, so IMS sees us as a normal logged-in viewer instead of a
  // bot hammering only the data endpoint.
  await refreshSesskey();
  const rows = await fetchCdrRows();
  _lastCdrSuccessAt = Math.floor(Date.now() / 1000);
  let delivered = 0;
  // TEMP DIAGNOSTIC: log first row + count so we can see what IMS returns
  log(`tick rows=${rows.length}${rows.length ? ` first=[${String(rows[0][0]||'').slice(0,19)} | ${rows[0][2]||''} | ${String(rows[0][4]||'').slice(0,40)}]` : ''}`);
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
    const alloc = findAllocationForCdr(r.phone, cliSlug);
    if (!alloc) {
      dlog('no active alloc for', r.phone, 'cli=', r.cli, '→ skip');
      tel.recordMiss(r.phone, `OTP "${r.otp}" (${r.cli || '?'}) arrived but no active allocation matched suffix-9${cliSlug ? `+service=${cliSlug}` : ''}`);
      logOtpAudit({
        source: 'ims', source_msg_id: r.dedup_key,
        phone_number: r.phone, cli: r.cli, otp_code: r.otp, sms_text: r.msg,
        outcome: 'mismatch',
        miss_reason: `no active allocation matched (suffix-9${cliSlug ? `, service=${cliSlug}` : ''})`,
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
      if (isRateLimitError(e.message)) log('tick cooldown:', e.message);
      else warn('tick error:', e.message);
      _lastError = e.message;
      const rl = isRateLimitError(e.message);
      if (!rl) {
        tel.recordError(e.message);
        _consecFail++;
      }
      if (/session_lost|unauthorized|login_failed|sesskey/i.test(e.message)) {
        _loggedIn = false; _sesskey = null;
      }
      // IMS rate-limit handling: portal forbids any action <15s apart.
      // Grow penalty exponentially each consecutive hit (20s → 40s → 60s → cap 90s)
      // so we stop hammering and self-recover instead of staying stuck.
      let penalty = 0;
      if (rl) {
        _rateLimitStreak++;
        penalty = registerRateLimitCooldown();
        const { reloginThreshold, reloginStaleSec } = readCooldownCfg();
        const nowSec = Math.floor(Date.now() / 1000);
        const scrapeStale = !_lastCdrSuccessAt || (nowSec - _lastCdrSuccessAt) >= reloginStaleSec;
        if (_rateLimitStreak >= reloginThreshold && scrapeStale) {
          const relogged = await forceRelogin(`rate_limited streak=${_rateLimitStreak} ≥ ${reloginThreshold}`);
          // forceRelogin already reset the streak; skip the long backoff below
          if (relogged) {
            await new Promise(r => setTimeout(r, 2_000));
            continue;
          }
        }
      } else {
        _rateLimitStreak = 0;
      }
      const backoff = Math.min(60, 5 + _consecFail * 2) + penalty;
      log(`backoff ${backoff}s (consec=${_consecFail}, rl_streak=${_rateLimitStreak})`);
      await new Promise(r => setTimeout(r, backoff * 1000));
      continue; // skip the loop pacer below — backoff already waited
    }
    // No extra sleep here — waitForCdrGate() already paces every CDR call to
    // exactly cfg.COOLDOWN.minInterval seconds apart. Adding another sleep
    // here would double the cadence (e.g. 20s + 20s = 40s between scrapes)
    // and cause OTPs to sit on IMS for half a minute before delivery.
  }
  _running = false;
}

function start() {
  const cfg = resolveCfg();
  if (!cfg.ENABLED) { log('disabled (ims_enabled=false) — not starting'); return; }
  if (_running) { log('already running — skip start'); return; }
  _stopFlag = false;
  log(`starting…  base=${cfg.BASE_URL}  interval=${cfg.INTERVAL}s (min ${cfg.COOLDOWN.minInterval}s, floor ${MIN_INTERVAL_FLOOR}s)`);
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
    interval_sec: cfg.INTERVAL,
    min_interval_sec: cfg.COOLDOWN.minInterval,
    min_interval_floor: MIN_INTERVAL_FLOOR,
    rl_penalty_base_sec: cfg.COOLDOWN.penaltyBase,
    rl_penalty_max_sec: cfg.COOLDOWN.penaltyMax,
    rl_penalty_steps: cfg.COOLDOWN.penaltySteps,
    rl_streak: _rateLimitStreak,
    rl_relogin_threshold: cfg.COOLDOWN.reloginThreshold,
    rl_relogin_stale_sec: cfg.COOLDOWN.reloginStaleSec,
    last_rate_limit_at: _lastRateLimitAt,
    last_cdr_success_at: _lastCdrSuccessAt,
    relogin_count: _reloginCount,
    last_relogin_at: _lastReloginAt,
    next_cdr_allowed_at: _nextCdrAllowedAt || null,
    sesskey_loaded: !!_sesskey,
    ...tel.snapshot(),
  };
}

module.exports = { start, stop, login, tickOnce, getStatus };
