// Range Health Score + Auto-pause worker.
//
// For every enabled provider_range, every 60s we compute a 0–100 score from
// the last `WINDOW_SEC` of activity:
//
//   score = round( 100 * delivered / (delivered + expired_no_otp + misses) )
//
// where:
//   delivered        = CDR rows in window for this range
//   expired_no_otp   = allocations that expired without ever receiving an OTP
//   misses           = bot telemetry "no_active_alloc" events for an MSISDN
//                      whose prefix matches this range (best-effort — small)
//
// If a range has at least `min_samples` total events AND score < threshold,
// it gets auto-disabled (`enabled = 0`) and an admin notification is logged.
//
// Settings (DB key/value):
//   range_autopause_enabled    'true' | 'false'   (default false — opt in)
//   range_autopause_threshold  '40'               (0–100; below this = unhealthy)
//   range_autopause_min_samples '10'              (need at least N events)
//   range_health_window_min    '60'               (look-back window in minutes)

const db = require('../lib/db');

const TICK_MS = 60_000;

function setting(key, fallback) {
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return r?.value ?? fallback;
  } catch { return fallback; }
}
function cfg() {
  return {
    enabled:      setting('range_autopause_enabled', 'false') === 'true',
    threshold:    Math.max(0, Math.min(100, +setting('range_autopause_threshold', '40'))),
    minSamples:   Math.max(3, +setting('range_autopause_min_samples', '10')),
    windowMin:    Math.max(15, Math.min(720, +setting('range_health_window_min', '60'))),
  };
}

/**
 * Compute health stats for ALL ranges (enabled OR disabled) over the window.
 * Returns: { [range_id]: { delivered, expired_no_otp, samples, score, last_otp_at } }
 */
function computeAll(windowMin = 60) {
  const cutoff = Math.floor(Date.now() / 1000) - windowMin * 60;

  // Delivered = CDR rows joined to allocations (so we know the range_id).
  const delivered = db.prepare(`
    SELECT pr.id AS range_id,
           COUNT(*) AS delivered,
           MAX(c.created_at) AS last_otp_at
    FROM cdr c
    JOIN allocations a ON a.id = c.allocation_id
    JOIN pool_numbers pn ON pn.msisdn = a.phone_number
    JOIN provider_ranges pr ON pr.id = pn.range_id
    WHERE c.created_at >= ? AND c.status = 'billed'
      AND (c.note IS NULL OR c.note != 'fake:broadcast')
    GROUP BY pr.id
  `).all(cutoff);

  // Expired without OTP = allocations that finished in 'expired' state in window.
  const expired = db.prepare(`
    SELECT pr.id AS range_id, COUNT(*) AS expired_no_otp
    FROM allocations a
    JOIN pool_numbers pn ON pn.msisdn = a.phone_number
    JOIN provider_ranges pr ON pr.id = pn.range_id
    WHERE a.status = 'expired' AND a.allocated_at >= ?
    GROUP BY pr.id
  `).all(cutoff);

  const map = new Map();
  for (const r of delivered) {
    map.set(r.range_id, {
      range_id: r.range_id,
      delivered: r.delivered || 0,
      expired_no_otp: 0,
      last_otp_at: r.last_otp_at || null,
    });
  }
  for (const r of expired) {
    const cur = map.get(r.range_id) || { range_id: r.range_id, delivered: 0, expired_no_otp: 0, last_otp_at: null };
    cur.expired_no_otp = r.expired_no_otp || 0;
    map.set(r.range_id, cur);
  }

  const out = {};
  for (const v of map.values()) {
    const samples = v.delivered + v.expired_no_otp;
    const score = samples > 0 ? Math.round((100 * v.delivered) / samples) : null;
    out[v.range_id] = { ...v, samples, score };
  }
  return out;
}

function sweep() {
  try {
    const c = cfg();
    if (!c.enabled) return;
    const stats = computeAll(c.windowMin);
    const stmt = db.prepare(`UPDATE provider_ranges SET enabled = 0, updated_at = strftime('%s','now') WHERE id = ? AND enabled = 1`);
    let paused = 0;
    for (const s of Object.values(stats)) {
      if (s.samples >= c.minSamples && s.score !== null && s.score < c.threshold) {
        const r = stmt.run(s.range_id);
        if (r.changes) {
          paused++;
          try {
            const range = db.prepare(`SELECT provider, country_code, range_label FROM provider_ranges WHERE id = ?`).get(s.range_id);
            db.prepare(`
              INSERT INTO notifications (user_id, title, message, type)
              VALUES (NULL, 'Range auto-paused', ?, 'warning')
            `).run(`[${range?.provider}/${range?.country_code}] ${range?.range_label} — health ${s.score}/100 (${s.delivered}✓ / ${s.expired_no_otp}✗) in last ${c.windowMin}m`);
          } catch (e) { /* notification failure shouldn't block */ }
        }
      }
    }
    if (paused > 0) console.log(`[rangeHealth] auto-paused ${paused} unhealthy range(s) (threshold=${c.threshold}, samples≥${c.minSamples})`);
  } catch (e) {
    console.warn('[rangeHealth] sweep error:', e.message);
  }
}

function start() {
  sweep();
  setInterval(sweep, TICK_MS);
  console.log('[rangeHealth] started (60s interval)');
}

module.exports = { start, sweep, computeAll, cfg };