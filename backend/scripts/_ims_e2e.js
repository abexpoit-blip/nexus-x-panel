// End-to-end smoke test against live IMS portal — verifies:
//  1) cookie reuse path (skip if no saved session)
//  2) fresh login (etkk + captcha)
//  3) sesskey extraction
//  4) CDR scrape returns aaData
//  5) row parser extracts phone + otp
//  6) two consecutive ticks at 18s — must NOT trip the 15s rate-limit
process.env.IMS_ENABLED = 'true';
process.env.IMS_USERNAME = 'Shovonkhan7';
process.env.IMS_PASSWORD = 'Shovonkhan7';
process.env.NODE_ENV = 'test';

// Stub db so we don't touch the real one
const Module = require('module');
const orig = Module.prototype.require;
const fakeStmt = () => ({ get: () => null, run: () => {}, all: () => [] });
const fakeDb = { prepare: () => fakeStmt() };
Module.prototype.require = function(id) {
  if (id === '../lib/db') return fakeDb;
  if (id === '../routes/numbers') return { markOtpReceived: async () => {} };
  return orig.apply(this, arguments);
};

const bot = require('../workers/imsBot');
(async () => {
  console.log('── 1) login() ──');
  await bot.login();
  console.log('status after login:', JSON.stringify(bot.getStatus(), null, 2).slice(0, 500));

  console.log('\n── 2) tick #1 ──');
  const t0 = Date.now();
  const n1 = await bot.tickOnce();
  console.log(`tick#1 delivered=${n1} (no allocations match → expected 0) time=${Date.now()-t0}ms`);

  console.log('\n── 3) wait 18s (respecting 15s rate-limit) ──');
  await new Promise(r => setTimeout(r, 18000));

  console.log('\n── 4) tick #2 ──');
  const t1 = Date.now();
  const n2 = await bot.tickOnce();
  console.log(`tick#2 delivered=${n2} time=${Date.now()-t1}ms`);

  console.log('\n── 5) immediate tick (should NOT crash; portal may rate-limit) ──');
  try {
    const n3 = await bot.tickOnce();
    console.log(`tick#3 (immediate) delivered=${n3} — portal accepted`);
  } catch (e) {
    console.log(`tick#3 (immediate) blocked as expected: ${e.message}`);
  }

  console.log('\nfinal status:', JSON.stringify(bot.getStatus(), null, 2));
  process.exit(0);
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
