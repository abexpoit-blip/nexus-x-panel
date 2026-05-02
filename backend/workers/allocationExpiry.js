// Background sweeper — expire active allocations past otp_expiry_sec.
// Also marks the underlying pool_number as 'used' so it never re-enters
// the free pool. Runs every 30s.
const db = require('../lib/db');
const { getOtpExpirySec } = require('../lib/settings');

function sweep() {
  try {
    const expirySec = getOtpExpirySec();
    const cutoff = Math.floor(Date.now() / 1000) - expirySec;

    const expired = db.prepare(`
      SELECT id, phone_number, provider, country_code
      FROM allocations
      WHERE status = 'active' AND allocated_at < ?
      LIMIT 500
    `).all(cutoff);

    if (!expired.length) return;

    const updAlloc = db.prepare("UPDATE allocations SET status = 'expired' WHERE id = ?");
    const updPool = db.prepare(`
      UPDATE pool_numbers SET status = 'used', updated_at = strftime('%s','now')
      WHERE msisdn = ? AND status = 'allocated'
    `);
    const tx = db.transaction(() => {
      for (const a of expired) {
        updAlloc.run(a.id);
        updPool.run(a.phone_number);
      }
    });
    tx();
    console.log(`[allocationExpiry] expired ${expired.length} allocations (>${expirySec}s)`);
  } catch (e) {
    console.warn('[allocationExpiry] sweep error:', e.message);
  }
}

function start() {
  // initial run + every 30s
  sweep();
  setInterval(sweep, 30_000);
  console.log('[allocationExpiry] started (30s interval)');
}

module.exports = { start, sweep };
