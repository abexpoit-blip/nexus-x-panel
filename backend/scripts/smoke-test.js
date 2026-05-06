#!/usr/bin/env node
/**
 * Post-deploy smoke test — hits key API routes and asserts expected
 * status codes. Exits 0 on full pass, 1 on any failure.
 *
 * Usage:
 *   node backend/scripts/smoke-test.js
 *   BASE_URL=http://localhost:4000 SMOKE_USER=admin@nexus.local SMOKE_PASS=xxxx node backend/scripts/smoke-test.js
 */

const BASE = (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const USER = process.env.SMOKE_USER || '';
const PASS = process.env.SMOKE_PASS || '';

let cookie = '';
const results = [];

function log(ok, name, detail = '') {
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${tag}  ${name}${detail ? '  — ' + detail : ''}`);
  results.push({ ok, name, detail });
}

async function hit(method, path, { body, expect = [200], auth = false } = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'content-type': 'application/json' };
  if (auth && cookie) headers.cookie = cookie;
  let res, text;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    text = await res.text();
  } catch (e) {
    log(false, `${method} ${path}`, `network error: ${e.message}`);
    return null;
  }
  const ok = expect.includes(res.status);
  log(ok, `${method} ${path}`, `${res.status}${ok ? '' : ' (expected ' + expect.join('|') + ')'}`);
  // capture cookie on login
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  try { return { res, json: JSON.parse(text) }; } catch { return { res, text }; }
}

(async () => {
  console.log(`\n🔥 Smoke test → ${BASE}\n`);

  // 1. Health / public
  console.log('• Public');
  await hit('GET', '/api/security/settings/public', { expect: [200] });

  // 2. Auth — unauthenticated /me must 401
  console.log('\n• Auth (unauthenticated)');
  await hit('GET', '/api/auth/me', { expect: [401, 403] });
  await hit('GET', '/api/numbers/my', { expect: [401, 403], auth: true });

  // 3. Login (only if creds provided)
  if (USER && PASS) {
    console.log('\n• Auth (login)');
    const r = await hit('POST', '/api/auth/login', {
      body: { email: USER, password: PASS },
      expect: [200],
    });
    if (r?.res?.status === 200) {
      console.log('\n• Authenticated routes');
      await hit('GET', '/api/auth/me', { auth: true, expect: [200] });
      await hit('GET', '/api/numbers/my', { auth: true, expect: [200] });
      await hit('GET', '/api/numbers/config', { auth: true, expect: [200] });
      await hit('GET', '/api/numbers/history', { auth: true, expect: [200] });
      await hit('GET', '/api/cdr/mine', { auth: true, expect: [200] });
      await hit('GET', '/api/notifications', { auth: true, expect: [200] });
      await hit('GET', '/api/leaderboard', { auth: true, expect: [200] });
      await hit('GET', '/api/payments/mine', { auth: true, expect: [200] });
      await hit('GET', '/api/numbers/v2/countries', { auth: true, expect: [200] });

      console.log('\n• Admin routes (200 if admin, 403 otherwise)');
      await hit('GET', '/api/admin/stats', { auth: true, expect: [200, 403] });
      await hit('GET', '/api/admin/system-health', { auth: true, expect: [200, 403] });
      await hit('GET', '/api/admin/bots', { auth: true, expect: [200, 403] });
      await hit('GET', '/api/admin/agents', { auth: true, expect: [200, 403] });
      await hit('GET', '/api/admin/provider-ranges', { auth: true, expect: [200, 403] });
    }
  } else {
    console.log('\n  (skipped login-gated checks — set SMOKE_USER / SMOKE_PASS to enable)');
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n────────────────────────────────`);
  console.log(`  ${passed} passed, ${failed} failed of ${results.length}`);
  console.log(`────────────────────────────────\n`);
  process.exit(failed === 0 ? 0 : 1);
})();