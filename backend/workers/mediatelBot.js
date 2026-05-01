// Mediatel Browser Bot — headless Chrome (stealth) that stays logged into
// https://mediateluk.com/sms and scrapes OTP CDRs for fast delivery to agents.
//
// CLOUDFLARE: Mediatel sits behind CF "Just a moment..." managed challenge.
//   Strategy:
//     1. puppeteer-extra + stealth plugin (passes managed challenge in most cases)
//     2. Persistent cookie jar in DB (so we only solve the challenge once per
//        ~24h, then reuse the cf_clearance cookie across restarts)
//     3. Slow human-like nav timings (no rapid-fire requests)
//
// Required settings (admin UI → Mediatel, or backend/.env fallback):
//   mediatel_enabled           true|false
//   mediatel_base_url          https://mediateluk.com/sms
//   mediatel_username          2673
//   mediatel_password          shahriya9900
//   mediatel_otp_interval      8     (seconds between CDR scrapes — min 5)
//
// Phase A (this file): login, persist session, log post-login URL + page
// structure. Phase B will add CDR selectors once we see real DOM in logs.

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

const QUIET = process.env.NODE_ENV === 'production';
const log  = (...a) => console.log('[mediatel-bot]', ...a);
const dlog = (...a) => { if (!QUIET) console.log('[mediatel-bot]', ...a); };
const warn = (...a) => console.warn('[mediatel-bot]', ...a);

// ────────────────────────────────────────────────────────────────────────
// Settings helpers (DB-first, env fallback)
// ────────────────────────────────────────────────────────────────────────
function readSetting(key) {
  try { return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || null; }
  catch (_) { return null; }
}
function writeSetting(key, value) {
  try {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%s','now')
    `).run(key, String(value));
  } catch (e) { warn('writeSetting failed:', e.message); }
}
function normalizeBase(raw) {
  const fallback = 'https://mediateluk.com/sms';
  if (!raw) return fallback;
  let s = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}
function resolveCreds() {
  const dbEnabled = readSetting('mediatel_enabled');
  const dbUser    = readSetting('mediatel_username');
  const dbPass    = readSetting('mediatel_password');
  const dbBase    = readSetting('mediatel_base_url');
  return {
    ENABLED:  (dbEnabled !== null ? dbEnabled : (process.env.MEDIATEL_ENABLED || 'false'))
              .toString().toLowerCase() === 'true',
    BASE_URL: normalizeBase(dbBase || process.env.MEDIATEL_BASE_URL),
    USERNAME: dbUser || process.env.MEDIATEL_USERNAME || '',
    PASSWORD: dbPass || process.env.MEDIATEL_PASSWORD || '',
  };
}
function resolveOtpInterval() {
  const fromDb = +(readSetting('mediatel_otp_interval') || 0);
  const fromEnv = +(process.env.MEDIATEL_SCRAPE_INTERVAL || 8);
  return Math.max(5, fromDb > 0 ? fromDb : fromEnv);
}

// ────────────────────────────────────────────────────────────────────────
// Cookie persistence (so CF challenge only needs to be solved ~once/day)
// ────────────────────────────────────────────────────────────────────────
function loadCookies() {
  try {
    const raw = readSetting('mediatel_cookies');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
function saveCookies(cookies) {
  try { writeSetting('mediatel_cookies', JSON.stringify(cookies || [])); }
  catch (e) { warn('saveCookies failed:', e.message); }
}

// ────────────────────────────────────────────────────────────────────────
// Browser bootstrap (puppeteer-extra + stealth)
// ────────────────────────────────────────────────────────────────────────
let _browser = null;
let _page = null;
let _loggedIn = false;

async function getBrowser() {
  if (_browser) return _browser;
  // Lazy-require so server.js doesn't pay the cost when bot is disabled
  const puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());

  const headless = (process.env.MEDIATEL_HEADLESS || 'true').toLowerCase() !== 'false';
  const execPath = process.env.MEDIATEL_CHROME_PATH || undefined;

  log('launching browser (headless=' + headless + ')');
  _browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    executablePath: execPath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--window-size=1366,768',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });
  return _browser;
}

async function getPage() {
  if (_page && !_page.isClosed()) return _page;
  const browser = await getBrowser();
  _page = await browser.newPage();
  await _page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/121.0.0.0 Safari/537.36'
  );
  await _page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });

  // Restore saved cookies BEFORE first navigation → reuse cf_clearance
  const cookies = loadCookies();
  if (cookies.length) {
    try { await _page.setCookie(...cookies); log('restored', cookies.length, 'cookies'); }
    catch (e) { warn('cookie restore failed:', e.message); }
  }
  return _page;
}

// ────────────────────────────────────────────────────────────────────────
// Cloudflare challenge wait — give the stealth browser up to 30s to clear
// ────────────────────────────────────────────────────────────────────────
async function waitForCloudflare(page, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const title = await page.title().catch(() => '');
    if (!/just a moment/i.test(title) && !/checking your browser/i.test(title)) return true;
    dlog('CF challenge in progress... ("' + title + '")');
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────
// Login flow — Phase A: login + log everything we see for selector discovery
// ────────────────────────────────────────────────────────────────────────
async function login() {
  const { BASE_URL, USERNAME, PASSWORD } = resolveCreds();
  if (!USERNAME || !PASSWORD) throw new Error('mediatel creds missing');

  const page = await getPage();
  const loginUrl = `${BASE_URL}/index.php`;
  log('GET', loginUrl);
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const cfPassed = await waitForCloudflare(page, 30000);
  if (!cfPassed) {
    warn('Cloudflare challenge did NOT clear in 30s. Saving page for inspection.');
    const html = await page.content().catch(() => '');
    log('CF-blocked title:', await page.title().catch(() => ''));
    log('CF-blocked html size:', html.length);
    throw new Error('cloudflare_challenge_blocked');
  }
  log('CF passed — title:', await page.title().catch(() => ''));

  // Discover login form fields. Mediatel form name guesses: username/password
  // or user/pass. Try common patterns and log what we find.
  const fieldInfo = await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form')).map((f) => ({
      action: f.action, method: f.method,
      inputs: Array.from(f.querySelectorAll('input')).map((i) => ({
        name: i.name, type: i.type, id: i.id, placeholder: i.placeholder,
      })),
    }));
    return { url: location.href, title: document.title, forms };
  });
  log('login page discovery:', JSON.stringify(fieldInfo).slice(0, 1500));

  // Try most common combos
  const userSel = ['input[name="username"]', 'input[name="user"]', 'input[name="login"]', 'input[type="text"]'];
  const passSel = ['input[name="password"]', 'input[name="pass"]', 'input[type="password"]'];
  let userField = null, passField = null;
  for (const s of userSel) { if (await page.$(s)) { userField = s; break; } }
  for (const s of passSel) { if (await page.$(s)) { passField = s; break; } }
  if (!userField || !passField) {
    throw new Error('login form fields not found — see discovery log above');
  }
  log('using selectors → user:', userField, '| pass:', passField);

  await page.click(userField, { clickCount: 3 });
  await page.type(userField, USERNAME, { delay: 40 });
  await page.click(passField, { clickCount: 3 });
  await page.type(passField, PASSWORD, { delay: 40 });

  // Submit — try button[type=submit], else press Enter
  const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
  if (submitBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
      submitBtn.click(),
    ]);
  } else {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
      page.keyboard.press('Enter'),
    ]);
  }

  // Persist cookies for next restart (CF + session)
  try {
    const cookies = await page.cookies();
    saveCookies(cookies);
    log('saved', cookies.length, 'cookies for next restart');
  } catch (e) { warn('cookie save failed:', e.message); }

  // Log post-login state — this is the critical info for Phase B selectors
  const post = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a')).slice(0, 40).map((a) => ({
      text: (a.textContent || '').trim().slice(0, 60),
      href: a.getAttribute('href'),
    }));
    return {
      url: location.href,
      title: document.title,
      bodySize: document.body.innerText.length,
      bodyPreview: document.body.innerText.slice(0, 400),
      links,
    };
  });
  log('=== POST-LOGIN PAGE ===');
  log(JSON.stringify(post, null, 2));

  if (/login|index\.php/i.test(post.url) && /login|password/i.test(post.bodyPreview)) {
    throw new Error('still on login page after submit — wrong creds or form changed');
  }

  _loggedIn = true;
  log('✓ login OK');
  return true;
}

// ────────────────────────────────────────────────────────────────────────
// Worker loop — Phase A: login, then idle ping every interval
// (Phase B will replace ping with real CDR scrape)
// ────────────────────────────────────────────────────────────────────────
let _running = false;
let _stopFlag = false;

async function loop() {
  if (_running) return;
  _running = true;
  while (!_stopFlag) {
    const { ENABLED } = resolveCreds();
    if (!ENABLED) {
      _running = false;
      log('disabled — bot stopped');
      return;
    }
    try {
      if (!_loggedIn) await login();
      const page = await getPage();
      // Phase A keepalive — visit base URL to keep session warm
      const url = page.url();
      dlog('idle keepalive @', url);
      // PHASE B: replace this with CDR-scrape → markOtpReceived(...)
    } catch (e) {
      warn('loop error:', e.message);
      _loggedIn = false;
      // back off on errors so we don't hammer CF
      await new Promise((r) => setTimeout(r, 15000));
    }
    await new Promise((r) => setTimeout(r, resolveOtpInterval() * 1000));
  }
  _running = false;
}

function start() {
  const { ENABLED } = resolveCreds();
  if (!ENABLED) { log('disabled (mediatel_enabled=false) — not starting'); return; }
  log('starting…');
  loop().catch((e) => warn('fatal:', e.message));
}

async function stop() {
  _stopFlag = true;
  try { if (_browser) await _browser.close(); } catch (_) {}
  _browser = null; _page = null; _loggedIn = false;
}

module.exports = { start, stop, login };
