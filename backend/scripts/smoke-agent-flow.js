#!/usr/bin/env node
/**
 * End-to-end agent lifecycle smoke test.
 *
 * Exercises (against the live running backend):
 *   1. Admin login
 *   2. Create test agent (admin-created → status=active)
 *   3. Patch agent (rename, set balance baseline)
 *   4. Agent login + JWT
 *   5. Agent fetches /numbers/my and /numbers/summary
 *   6. Seed a fake allocation directly in SQLite (bypasses provider bots
 *      so the test runs without depending on portal availability)
 *   7. Invoke markOtpReceived() → verifies CDR row, balance credit,
 *      payment ledger entry, notification, and otp_count increment
 *   8. Verify the agent can see the CDR via /numbers/cdr
 *   9. Cleanup: delete agent + their CDR/allocation/payment/notification rows
 *
 * Each step prints PASS/FAIL with details. Exit code is non-zero on any failure.
 *
 * Usage on VPS:
 *   cd /opt/nexus/backend && node scripts/smoke-agent-flow.js
 *
 * Required env (or pass as args):
 *   BACKEND_URL      default http://127.0.0.1:4000
 *   ADMIN_USERNAME   default admin
 *   ADMIN_PASSWORD   required
 */

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const BASE = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('✗ ADMIN_PASSWORD env var is required');
  console.error('  Try: ADMIN_PASSWORD=yourpass node scripts/smoke-agent-flow.js');
  process.exit(2);
}

const TS = Date.now();
const TEST_AGENT = {
  username: `smoke_${TS}`,
  password: 'SmokeTest!234',
  full_name: 'Smoke Test Agent',
  phone: '0170000' + String(TS).slice(-4),
  telegram: '@smoke_test',
  balance: 0,
  status: 'active',
};

const results = [];
function pass(name, info = '') { results.push({ ok: true, name, info });  console.log(`✓ ${name}${info ? '  ' + info : ''}`); }
function fail(name, err)        { results.push({ ok: false, name, err: String(err) }); console.log(`✗ ${name}\n    → ${err}`); }

async function api(pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${pathname}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const msg = (json && (json.error || json.message)) || text || `HTTP ${r.status}`;
    const err = new Error(`${method} ${pathname} → ${r.status}: ${msg}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

(async () => {
  // Lazy-load DB + helper only when running on the backend host
  const db = require('../lib/db');
  const numbersRouter = require('../routes/numbers');
  const { markOtpReceived } = numbersRouter;

  let adminToken, agentToken, agentId, allocationId;

  // 1. Admin login
  try {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    adminToken = r.token;
    if (!adminToken) throw new Error('no token in response');
    if (r.user?.role !== 'admin') throw new Error(`role is ${r.user?.role}, not admin`);
    pass('admin login', `(user_id=${r.user.id})`);
  } catch (e) { fail('admin login', e.message); return finish(); }

  // 2. Create test agent
  try {
    const r = await api('/api/admin/agents', { method: 'POST', token: adminToken, body: TEST_AGENT });
    agentId = r.agent?.id;
    if (!agentId) throw new Error('no agent.id in response');
    if (r.agent.status !== 'active') throw new Error(`status is ${r.agent.status}, expected active`);
    pass('create agent', `(id=${agentId}, username=${TEST_AGENT.username})`);
  } catch (e) { fail('create agent', e.message); return finish(); }

  // 3. Patch agent (rename + bump balance)
  try {
    await api(`/api/admin/agents/${agentId}`, {
      method: 'PATCH', token: adminToken,
      body: { full_name: 'Renamed Smoke', balance: 100 },
    });
    const list = await api('/api/admin/agents', { token: adminToken });
    const me = list.agents.find(a => a.id === agentId);
    if (!me) throw new Error('agent missing from list');
    if (me.full_name !== 'Renamed Smoke') throw new Error(`full_name=${me.full_name}`);
    if (Number(me.balance) !== 100) throw new Error(`balance=${me.balance}, expected 100`);
    pass('patch agent', `(balance=${me.balance})`);
  } catch (e) { fail('patch agent', e.message); }

  // 4. Agent login
  try {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: { username: TEST_AGENT.username, password: TEST_AGENT.password },
    });
    agentToken = r.token;
    if (!agentToken) throw new Error('no token');
    if (r.user.role !== 'agent') throw new Error(`role=${r.user.role}`);
    pass('agent login', `(user_id=${r.user.id})`);
  } catch (e) { fail('agent login', e.message); return finish(); }

  // 5. Agent reads
  try {
    const my = await api('/api/numbers/my', { token: agentToken });
    if (!Array.isArray(my.numbers)) throw new Error('no numbers array');
    const summary = await api('/api/numbers/summary', { token: agentToken });
    if (!summary || typeof summary !== 'object') throw new Error('bad summary');
    pass('agent reads /my + /summary', `(${my.numbers.length} live)`);
  } catch (e) { fail('agent reads', e.message); }

  // 6. Seed a fake allocation directly in SQLite
  let beforeBal, beforeCount;
  try {
    const u = db.prepare('SELECT balance, otp_count FROM users WHERE id = ?').get(agentId);
    beforeBal = +u.balance; beforeCount = +u.otp_count;

    const ins = db.prepare(`
      INSERT INTO allocations (user_id, provider, country_code, operator, phone_number, status, allocated_at)
      VALUES (?, 'seven1tel', 'BD', 'GP', ?, 'active', strftime('%s','now'))
    `).run(agentId, '8801' + String(TS).slice(-9));
    allocationId = ins.lastInsertRowid;
    pass('seed allocation', `(id=${allocationId})`);
  } catch (e) { fail('seed allocation', e.message); return finish(); }

  // 7. Trigger markOtpReceived
  try {
    const alloc = db.prepare('SELECT * FROM allocations WHERE id = ?').get(allocationId);
    await markOtpReceived(alloc, '123456', 'TEST-SENDER');

    const a2 = db.prepare('SELECT * FROM allocations WHERE id = ?').get(allocationId);
    if (a2.status !== 'received') throw new Error(`alloc status=${a2.status}`);
    if (a2.otp !== '123456') throw new Error(`alloc otp=${a2.otp}`);

    const cdr = db.prepare('SELECT * FROM cdr WHERE allocation_id = ?').get(allocationId);
    if (!cdr) throw new Error('no CDR row written');
    if (cdr.user_id !== agentId) throw new Error(`cdr.user_id=${cdr.user_id}`);
    if (cdr.otp_code !== '123456') throw new Error(`cdr.otp_code=${cdr.otp_code}`);

    const u2 = db.prepare('SELECT balance, otp_count FROM users WHERE id = ?').get(agentId);
    if (+u2.otp_count !== beforeCount + 1) throw new Error(`otp_count ${beforeCount} → ${u2.otp_count}`);

    const expectedDelta = +cdr.price_bdt;
    const actualDelta = +u2.balance - beforeBal;
    if (Math.abs(actualDelta - expectedDelta) > 0.001) {
      throw new Error(`balance delta ${actualDelta} ≠ cdr.price_bdt ${expectedDelta}`);
    }

    if (expectedDelta > 0) {
      const pay = db.prepare("SELECT * FROM payments WHERE reference = ?").get(`otp:${allocationId}`);
      if (!pay) throw new Error('no payment ledger entry');
      if (+pay.amount_bdt !== expectedDelta) throw new Error(`pay amount ${pay.amount_bdt} ≠ ${expectedDelta}`);
    }

    const notif = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND title='OTP received' ORDER BY id DESC LIMIT 1").get(agentId);
    if (!notif) throw new Error('no notification created');

    pass('markOtpReceived', `(commission=৳${expectedDelta}${expectedDelta === 0 ? ' — no rate configured' : ''})`);
  } catch (e) { fail('markOtpReceived', e.message); }

  // 8. Agent reads its own CDR
  try {
    const r = await api('/api/numbers/history?page=1&page_size=10', { token: agentToken });
    const found = (r.rows || []).find(x => x.allocation_id === allocationId);
    if (!found) throw new Error('seeded CDR not visible to agent');
    if (found.otp_code !== '123456') throw new Error(`otp_code=${found.otp_code}`);
    pass('agent sees CDR', `(${r.rows.length} rows, total=${r.total})`);
  } catch (e) { fail('agent sees CDR', e.message); }

  // Cleanup
  finish();

  function finish() {
    if (allocationId) {
      try {
        db.prepare('DELETE FROM cdr WHERE allocation_id = ?').run(allocationId);
        db.prepare('DELETE FROM allocations WHERE id = ?').run(allocationId);
      } catch {}
    }
    if (agentId) {
      try {
        db.prepare('DELETE FROM payments WHERE user_id = ?').run(agentId);
        db.prepare('DELETE FROM notifications WHERE user_id = ?').run(agentId);
        db.prepare('DELETE FROM audit_log WHERE target_id = ? AND target_type = ?').run(agentId, 'user');
      } catch {}
      if (adminToken) {
        api(`/api/admin/agents/${agentId}`, { method: 'DELETE', token: adminToken })
          .then(() => console.log(`✓ cleanup (deleted agent ${agentId})`))
          .catch(e => console.log(`! cleanup partial: ${e.message}`))
          .finally(printSummary);
        return;
      }
    }
    printSummary();
  }

  function printSummary() {
    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed) {
      console.log('\nFailures:');
      results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}: ${r.err}`));
    }
    process.exit(failed ? 1 : 0);
  }
})().catch(e => { console.error('Fatal:', e); process.exit(2); });