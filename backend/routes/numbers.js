const express = require('express');
const db = require('../lib/db');
const { authRequired } = require('../middleware/auth');
const { agentPayout } = require('../lib/commission');
const { getOtpExpirySec, getRecentOtpHours } = require('../lib/settings');

const router = express.Router();

// GET /api/numbers/config — shared live-number timing config
router.get('/config', authRequired, (req, res) => {
  res.json({
    otp_expiry_sec: getOtpExpirySec(),
    server_now: Math.floor(Date.now() / 1000),
  });
});

// GET /api/numbers/my — agent's "live" working list
router.get('/my', authRequired, (req, res) => {
  const recentHours = getRecentOtpHours();
  const cutoff = Math.floor(Date.now() / 1000) - recentHours * 3600;
  const numbers = db.prepare(`
    SELECT a.id, a.phone_number, a.operator, a.country_code, a.otp, a.status,
           a.allocated_at, a.otp_received_at,
           s.slug AS service_slug, s.name AS service_name, s.icon AS service_icon, s.color AS service_color
    FROM allocations a
    LEFT JOIN services s ON s.id = a.service_id
    WHERE a.user_id = ?
      AND (
        a.status = 'active'
        OR (a.status = 'received' AND a.otp_received_at >= ?)
      )
    ORDER BY a.allocated_at DESC LIMIT 200
  `).all(req.user.id, cutoff);
  res.json({
    numbers,
    recent_window_hours: recentHours,
    otp_expiry_sec: getOtpExpirySec(),
    server_now: Math.floor(Date.now() / 1000),
  });
});

// GET /api/numbers/history — paginated OTP history (CDR)
router.get('/history', authRequired, (req, res) => {
  const page = Math.max(1, +(req.query.page) || 1);
  const pageSize = Math.max(1, Math.min(200, +(req.query.page_size) || 50));
  const q = (req.query.q || '').toString().trim();
  const isCsv = (req.query.format || '').toString().toLowerCase() === 'csv';
  const wantFacets = (req.query.facets || '').toString() === '1';

  const parseTs = (v, endOfDay = false) => {
    if (v === undefined || v === null || v === '') return null;
    const s = String(v).trim();
    if (/^\d+$/.test(s)) return +s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(s)) d.setHours(23, 59, 59, 999);
    return Math.floor(d.getTime() / 1000);
  };
  const fromTs = parseTs(req.query.from, false);
  const toTs = parseTs(req.query.to, true);

  // Status filter — CDR only ever stores `billed` (arrived) and `refunded`.
  // Accept comma-separated list. Default = arrived only (= billed).
  const ALLOWED_STATUSES = new Set(['billed', 'refunded']);
  const rawStatus = (req.query.status || '').toString().trim();
  const statusList = rawStatus
    ? rawStatus.split(',').map(s => s.trim().toLowerCase()).filter(s => ALLOWED_STATUSES.has(s))
    : ['billed'];
  const effectiveStatuses = statusList.length ? statusList : ['billed'];

  // Country / operator multi-select filters (comma-separated).
  const splitCsv = (v) => (v || '').toString().split(',').map(s => s.trim()).filter(Boolean);
  const countries = splitCsv(req.query.countries).map(s => s.toUpperCase());
  const operators = splitCsv(req.query.operators);

  const where = ["user_id = ?"];
  const params = [req.user.id];
  // Status (always at least 'billed' by default — preserves prior behaviour).
  where.push(`status IN (${effectiveStatuses.map(() => '?').join(',')})`);
  params.push(...effectiveStatuses);
  // Defense-in-depth: never show fakes in agent-facing CDR even if mis-attributed.
  where.push("(note IS NULL OR note != 'fake:broadcast')");
  if (q) {
    where.push("(phone_number LIKE ? OR otp_code LIKE ? OR operator LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (countries.length) {
    where.push(`UPPER(COALESCE(country_code,'')) IN (${countries.map(() => '?').join(',')})`);
    params.push(...countries);
  }
  if (operators.length) {
    where.push(`COALESCE(operator,'') IN (${operators.map(() => '?').join(',')})`);
    params.push(...operators);
  }
  if (fromTs !== null) { where.push("created_at >= ?"); params.push(fromTs); }
  if (toTs !== null) { where.push("created_at <= ?"); params.push(toTs); }
  const whereSql = where.join(' AND ');

  if (isCsv) {
    const rows = db.prepare(`
      SELECT phone_number, otp_code FROM cdr WHERE ${whereSql}
      ORDER BY created_at DESC LIMIT 50000
    `).all(...params);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="otp-history-${new Date().toISOString().slice(0,10)}.txt"`);
    for (const r of rows) {
      if (!r.phone_number) continue;
      res.write(r.otp_code ? `${r.phone_number}|${r.otp_code}\n` : `${r.phone_number}\n`);
    }
    return res.end();
  }

  const total = db.prepare(`SELECT COUNT(*) c FROM cdr WHERE ${whereSql}`).get(...params).c;
  // Note: `where` uses unprefixed cols; works fine with table alias because
  // SQLite resolves unambiguous column names against the FROM table.
  const rows = db.prepare(`
    SELECT cdr.id, cdr.allocation_id, cdr.country_code, cdr.operator, cdr.phone_number,
           cdr.otp_code, cdr.cli, cdr.status, cdr.price_bdt, cdr.created_at,
           s.slug AS service_slug, s.name AS service_name, s.icon AS service_icon, s.color AS service_color
    FROM cdr LEFT JOIN services s ON s.id = cdr.service_id
    WHERE ${whereSql}
    ORDER BY cdr.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);

  const agg = db.prepare(`
    SELECT COUNT(*) c, COALESCE(SUM(price_bdt),0) s
    FROM cdr WHERE ${whereSql}
  `).get(...params);

  // Facets — list every country/operator the agent has *ever* delivered for,
  // independent of the current filter, so the dropdowns stay stable.
  let facets;
  if (wantFacets) {
    const facetWhere = "user_id = ? AND status IN ('billed','refunded') AND (note IS NULL OR note != 'fake:broadcast')";
    const facetCountries = db.prepare(`
      SELECT UPPER(COALESCE(country_code,'')) AS code, COUNT(*) AS c
      FROM cdr WHERE ${facetWhere} AND COALESCE(country_code,'') != ''
      GROUP BY code ORDER BY c DESC, code ASC LIMIT 200
    `).all(req.user.id).map(r => ({ value: r.code, count: r.c }));
    const facetOperators = db.prepare(`
      SELECT COALESCE(operator,'') AS op, COUNT(*) AS c
      FROM cdr WHERE ${facetWhere} AND COALESCE(operator,'') != ''
      GROUP BY op ORDER BY c DESC, op ASC LIMIT 200
    `).all(req.user.id).map(r => ({ value: r.op, count: r.c }));
    facets = { countries: facetCountries, operators: facetOperators };
  }

  res.json({
    rows, page, page_size: pageSize, total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
    summary: { count: agg.c, earnings_bdt: +(+agg.s).toFixed(2) },
    ...(facets ? { facets } : {}),
  });
});

// POST /api/numbers/release/:id — agent releases an active allocation
router.post('/release/:id', authRequired, (req, res) => {
  const id = +req.params.id;
  const a = db.prepare("SELECT * FROM allocations WHERE id = ? AND user_id = ?").get(id, req.user.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE allocations SET status = 'released' WHERE id = ?").run(id);
  res.json({ ok: true });
});

// =============================================================
// POST /api/numbers/get — allocate one or more numbers from a range pool
// Body: { range_id?, provider?, country_code?, range?, count? }
// Honours per-agent per_request_limit (admin-controlled, 1..500).
// =============================================================
router.post('/get', authRequired, (req, res) => {
  const u = req.user;
  if (u.status && u.status !== 'active') {
    return res.status(403).json({ error: 'Account is not active' });
  }

  const body = req.body || {};
  let rangeRow = null;
  if (body.range_id) {
    rangeRow = db.prepare('SELECT * FROM provider_ranges WHERE id = ? AND enabled = 1').get(+body.range_id);
  } else if (body.provider && body.country_code && body.range) {
    rangeRow = db.prepare(
      'SELECT * FROM provider_ranges WHERE provider = ? AND country_code = ? AND range_label = ? AND enabled = 1'
    ).get(body.provider, String(body.country_code).toUpperCase(), body.range);
  }
  if (!rangeRow) return res.status(404).json({ error: 'Range not found or disabled' });

  // Per-agent cap (admin-controlled). Hard ceiling 500 to avoid runaway requests.
  const fresh = db.prepare('SELECT per_request_limit, status FROM users WHERE id = ?').get(u.id);
  if (!fresh || fresh.status !== 'active') return res.status(403).json({ error: 'Account is not active' });
  const perReqCap = Math.min(500, Math.max(1, +fresh.per_request_limit || 1));

  let count = Math.max(1, Math.min(perReqCap, +body.count || 1));

  const result = { allocated: [], errors: [] };
  const insAlloc = db.prepare(`
    INSERT INTO allocations (user_id, provider, country_code, operator, phone_number, status, price_bdt, service_id)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `);
  const claimFree = db.prepare(`
    UPDATE pool_numbers
    SET status = 'allocated', allocated_user_id = ?, allocated_at = strftime('%s','now'),
        updated_at = strftime('%s','now')
    WHERE id = (
      SELECT id FROM pool_numbers WHERE range_id = ? AND status = 'free' ORDER BY id LIMIT 1
    )
    RETURNING id, msisdn
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const claimed = claimFree.get(u.id, rangeRow.id);
      if (!claimed) { result.errors.push('Pool empty for this range'); break; }
      const allocRes = insAlloc.run(
        u.id, rangeRow.provider, rangeRow.country_code,
        rangeRow.operator || null, claimed.msisdn, rangeRow.price_bdt || 0,
        rangeRow.service_id || null
      );
      result.allocated.push({
        id: allocRes.lastInsertRowid,
        phone_number: claimed.msisdn,
        provider: rangeRow.provider,
        country_code: rangeRow.country_code,
        operator: rangeRow.operator,
      });
    }
  });
  try { tx(); }
  catch (e) { return res.status(500).json({ error: e.message, ...result }); }

  res.json(result);
});

// GET /api/numbers/summary — agent stats
router.get('/summary', authRequired, (req, res) => {
  const u = req.user.id;
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const weekStart = todayStart - 7 * 86400;
  const monthStart = todayStart - 30 * 86400;
  const cnt = (since) => {
    const r = db.prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(price_bdt),0) s FROM cdr WHERE user_id=? AND status='billed' AND created_at >= ?"
    ).get(u, since);
    return { c: r.c, s: +(+r.s).toFixed(2) };
  };
  const avgWait = (since) => {
    const r = db.prepare(`
      SELECT COALESCE(AVG(otp_received_at - allocated_at), 0) AS avg_sec,
             COALESCE(MIN(otp_received_at - allocated_at), 0) AS min_sec,
             COALESCE(MAX(otp_received_at - allocated_at), 0) AS max_sec,
             COUNT(*) AS samples
      FROM allocations
      WHERE user_id = ? AND status = 'received'
        AND otp_received_at IS NOT NULL AND allocated_at IS NOT NULL
        AND otp_received_at >= allocated_at AND otp_received_at >= ?
    `).get(u, since);
    return {
      avg_sec: Math.round(r.avg_sec || 0),
      min_sec: Math.round(r.min_sec || 0),
      max_sec: Math.round(r.max_sec || 0),
      samples: r.samples || 0,
    };
  };

  res.json({
    today: cnt(todayStart),
    week: cnt(weekStart),
    month: cnt(monthStart),
    active: db.prepare("SELECT COUNT(*) c FROM allocations WHERE user_id=? AND status='active'").get(u).c,
    wait_time: {
      today: avgWait(todayStart),
      week: avgWait(weekStart),
      month: avgWait(monthStart),
      all_time: avgWait(0),
    },
  });
});

// =============================================================
// Helper: when an OTP is confirmed, write CDR + credit agent.
// Used by provider bots (seven1telBot, etc.).
// =============================================================
async function markOtpReceived(allocation, otpCode, cli = null) {
  // Last positional arg is the raw SMS text (optional). We sniff arguments to
  // stay backward-compatible with old call sites that didn't pass it.
  const smsText = (arguments.length > 3 && typeof arguments[3] === 'string') ? arguments[3] : null;
  // Idempotency / re-confirm safety:
  //   • If allocation is already 'received' with the SAME otp → no-op (dedupe).
  //   • If it's 'received' with a DIFFERENT otp (site sent a 2nd code) → log it
  //     as a fresh notification but do NOT bill again. Stores latest OTP on row.
  const fresh = db.prepare(
    `SELECT id, status, otp FROM allocations WHERE id = ?`
  ).get(allocation.id);
  if (fresh && fresh.status === 'received') {
    if (fresh.otp === otpCode) return; // exact duplicate → silently drop
    db.prepare(`UPDATE allocations SET otp = ?, otp_received_at = strftime('%s','now') WHERE id = ?`)
      .run(otpCode, allocation.id);
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, 'Additional OTP', ?, 'info')
    `).run(allocation.user_id, `${allocation.phone_number} → ${otpCode} (resend / 2nd code)`);
    return;
  }

  const { agent_amount } = agentPayout({
    provider: allocation.provider,
    country_code: allocation.country_code,
    operator: allocation.operator,
  });

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE allocations SET otp = ?, cli = COALESCE(?, cli),
             status = 'received', otp_received_at = strftime('%s','now')
      WHERE id = ?
    `).run(otpCode, cli || null, allocation.id);

    db.prepare(`
      INSERT INTO cdr (user_id, allocation_id, provider, country_code, operator, phone_number, otp_code, cli, price_bdt, status, service_id, sms_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'billed', ?, ?)
    `).run(
      allocation.user_id, allocation.id, allocation.provider,
      allocation.country_code, allocation.operator, allocation.phone_number,
      otpCode, cli || null, agent_amount, allocation.service_id || null,
      smsText
    );

    if (agent_amount > 0) {
      db.prepare(`UPDATE users SET balance = balance + ?, otp_count = otp_count + 1 WHERE id = ?`)
        .run(agent_amount, allocation.user_id);
      db.prepare(`
        INSERT INTO payments (user_id, amount_bdt, type, method, reference, note)
        VALUES (?, ?, 'credit', 'auto', ?, 'OTP commission')
      `).run(allocation.user_id, agent_amount, `otp:${allocation.id}`);
    } else {
      db.prepare(`UPDATE users SET otp_count = otp_count + 1 WHERE id = ?`).run(allocation.user_id);
    }

    const label = allocation.operator || allocation.country_code || '';
    const cliTag = cli ? `${cli} ` : '';
    const prefix = label ? `[${label}] ` : '';
    const notifMsg = agent_amount > 0
      ? `${cliTag}${prefix}${allocation.phone_number} → ${otpCode} (+৳${agent_amount})`
      : `${cliTag}${prefix}${allocation.phone_number} → ${otpCode}`;
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, ?, ?, 'success')
    `).run(allocation.user_id, 'OTP received', notifMsg);
  });
  tx();
}

module.exports = router;
module.exports.markOtpReceived = markOtpReceived;
