// Background sweeper — expire active allocations past otp_expiry_sec.
// Also marks the underlying pool_number as 'used' so it never re-enters
// the free pool. Runs every 30s.
const db = require('../lib/db');
const { getOtpExpirySec } = require('../lib/settings');

// Recycle immediately after the configured expiry. Bots must not credit OTPs
// to expired allocations; this avoids old/recycled numbers delivering later.
const GRACE_SEC = 0;

function sweep() {
  try {
    const expirySec = getOtpExpirySec();
    const now = Math.floor(Date.now() / 1000);
    const expireCutoff = now - expirySec;             // flip 'active' → 'expired'
    const recycleCutoff = now - expirySec - GRACE_SEC; // release pool number

    // Step 1: flip allocations to 'expired' (UI stops the countdown).
    const expired = db.prepare(`
      SELECT id FROM allocations
      WHERE status = 'active' AND allocated_at < ?
      LIMIT 500
    `).all(expireCutoff);
    if (expired.length) {
      const upd = db.prepare("UPDATE allocations SET status = 'expired' WHERE id = ?");
      db.transaction(() => { for (const a of expired) upd.run(a.id); })();
    }

    // Step 2: only recycle pool numbers AFTER the grace window — late OTPs
    // can still be credited until then.
    const recyclable = db.prepare(`
      SELECT id, phone_number FROM allocations
      WHERE status = 'expired' AND allocated_at < ?
      LIMIT 500
    `).all(recycleCutoff);
    if (recyclable.length) {
      const updPool = db.prepare(`
        UPDATE pool_numbers SET status = 'used', updated_at = strftime('%s','now')
        WHERE msisdn = ? AND status = 'allocated'
      `);
      db.transaction(() => { for (const a of recyclable) updPool.run(a.phone_number); })();
    }

    if (expired.length || recyclable.length) {
      console.log(`[allocationExpiry] expired=${expired.length} recycled=${recyclable.length} (grace=${GRACE_SEC}s)`);
    }
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
