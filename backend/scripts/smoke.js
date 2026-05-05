#!/usr/bin/env node
/**
 * Backend smoke test — boots the server in a child process with a throw-away
 * SQLite DB, then exercises every public endpoint group, asserting expected
 * HTTP status codes. Exit 0 on full pass, 1 on any failure.
 *
 * Usage:  node backend/scripts/smoke.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = 4555 + Math.floor(Math.random() * 200);
const TMP_DB = path.join(os.tmpdir(), `nexus-smoke-${Date.now()}.db`);
const ADMIN_USER = 'smokeadmin';
const ADMIN_PASS = 'smokepass123';
const BASE = `http://127.0.0.1:${PORT}/api`;

const env = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(PORT),
  DB_PATH: TMP_DB,
  ADMIN_USERNAME: ADMIN_USER,
  ADMIN_PASSWORD: ADMIN_PASS,
  RATE_LIMIT_MAX: '99999',
  // disable noisy bots in test
  SEVEN1TEL_ENABLED: 'false',
  XISORA_ENABLED: 'false',
};

const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env,
  cwd: path.join(__dirname, '..'),
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
child.stdout.on('data', d => { serverLog += d; });
child.stderr.on('data', d => { serverLog += d; });

let cookie = '';
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${tag} ${name}${detail ? '  — ' + detail : ''}`);
}

async function call(method, p, { body, expect, useCookie = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (useCookie && cookie) headers.cookie = cookie;
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const expected = Array.isArray(expect) ? expect : [expect];
  const ok = expected.includes(res.status);
  const text = await res.text().catch(() => '');
  record(`${method} ${p} → ${res.status} (want ${expected.join('|')})`, ok, ok ? '' : text.slice(0, 140));
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, raw: text };
}

async function waitReady(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function run() {
  console.log(`→ booting server on :${PORT}  (DB=${TMP_DB})`);
  const ready = await waitReady();
  if (!ready) {
    console.error('✗ server failed to boot in time');
    console.error(serverLog);
    return false;
  }
  console.log('→ server up\n');

  // --- Health & public ---
  await call('GET', '/health', { expect: 200 });
  await call('GET', '/settings/public', { expect: 200 });

  // --- Auth: unauth requests should be 401 ---
  await call('GET', '/auth/me', { expect: 401, useCookie: false });
  await call('GET', '/numbers/my', { expect: 401, useCookie: false });

  // --- Auth: bad login ---
  await call('POST', '/auth/login', { body: { username: 'nope', password: 'nope' }, expect: 401 });

  // --- Auth: good admin login (sets cookie) ---
  await call('POST', '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS }, expect: 200 });
  await call('GET', '/auth/me', { expect: 200 });

  // --- Admin endpoints ---
  await call('GET', '/admin/stats', { expect: 200 });
  await call('GET', '/admin/system-health', { expect: 200 });
  await call('GET', '/admin/leaderboard', { expect: 200 });
  await call('GET', '/admin/agents', { expect: 200 });
  await call('GET', '/admin/allocations', { expect: 200 });
  await call('GET', '/admin/commission-trend', { expect: 200 });
  await call('GET', '/admin/fake-otp', { expect: 200 });
  await call('GET', '/admin/bots', { expect: 200 });
  await call('GET', '/admin/impersonations', { expect: 200 });

  // --- Numbers ---
  await call('GET', '/numbers/config', { expect: 200 });
  await call('GET', '/numbers/my', { expect: 200 });
  await call('GET', '/numbers/history', { expect: 200 });
  await call('GET', '/numbers/summary', { expect: 200 });
  await call('GET', '/numbers/v2/countries', { expect: 200 });
  await call('GET', '/numbers/v2/ranges', { expect: 200 });
  await call('POST', '/numbers/get', { body: {}, expect: [400, 404, 409, 422] });

  // --- Provider ranges (admin) ---
  await call('GET', '/admin/provider-ranges', { expect: 200 });
  await call('GET', '/admin/provider-ranges-stats', { expect: 200 });
  await call('GET', '/admin/provider-ranges/health', { expect: 200 });
  await call('GET', '/admin/range-autopause', { expect: 200 });

  // --- Rates ---
  await call('GET', '/rates', { expect: 200 });

  // --- CDR ---
  await call('GET', '/cdr', { expect: 200 });
  await call('GET', '/cdr/mine', { expect: 200 });
  await call('GET', '/cdr/feed', { expect: 200 });

  // --- Payments / Withdrawals ---
  await call('GET', '/payments', { expect: 200 });
  await call('GET', '/payments/mine', { expect: 200 });
  await call('GET', '/withdrawals', { expect: 200 });
  await call('GET', '/withdrawals/pending', { expect: 200 });
  await call('GET', '/withdrawals/mine', { expect: 200 });
  await call('GET', '/withdrawals/policy', { expect: 200 });
  await call('GET', '/admin/payment-config', { expect: 200 });

  // --- Notifications ---
  await call('GET', '/notifications', { expect: 200 });

  // --- Leaderboard ---
  await call('GET', '/leaderboard', { expect: 200 });

  // --- Services ---
  await call('GET', '/services', { expect: 200 });
  await call('GET', '/admin/services', { expect: 200 });

  // --- Security / settings ---
  await call('GET', '/audit', { expect: 200 });
  await call('GET', '/sessions', { expect: 200 });
  await call('GET', '/settings', { expect: 200 });

  // --- 404 handler ---
  await call('GET', '/this-does-not-exist', { expect: 404 });

  // --- Logout ---
  await call('POST', '/auth/logout', { expect: 200 });
  await call('GET', '/auth/me', { expect: 401 });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFAILURES:');
    failed.forEach(f => console.log(`  ✗ ${f.name}  ${f.detail || ''}`));
  }
  return failed.length === 0;
}

(async () => {
  let pass = false;
  try { pass = await run(); }
  catch (e) { console.error('smoke threw:', e); }
  finally {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2000);
    try { fs.unlinkSync(TMP_DB); } catch {}
  }
  process.exit(pass ? 0 : 1);
})();
