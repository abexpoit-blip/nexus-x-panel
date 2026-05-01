// Generic provider-agnostic ranges — admin CRUD + agent listing.
// Agents only ever see rows where enabled=1.
const express = require('express');
const db = require('../lib/db');
const { authRequired, adminOnly } = require('../middleware/auth');
const { logFromReq } = require('../lib/audit');

const router = express.Router();

const ALLOWED_PROVIDERS = ['seven1tel'];

function validate(body, partial = false) {
  const out = {};
  const req = (k, v) => { if (v === undefined || v === null || v === '') throw new Error(`${k} required`); };
  const need = (k) => { if (!partial) req(k, body[k]); };

  need('provider');
  if (body.provider !== undefined) {
    if (!ALLOWED_PROVIDERS.includes(body.provider)) {
      throw new Error(`provider must be one of: ${ALLOWED_PROVIDERS.join(', ')}`);
    }
    out.provider = body.provider;
  }
  need('country_code');
  if (body.country_code !== undefined) {
    const cc = String(body.country_code).trim().toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(cc)) throw new Error('country_code must be 2-4 letters');
    out.country_code = cc;
  }
  need('range_label');
  if (body.range_label !== undefined) {
    const lbl = String(body.range_label).trim();
    if (lbl.length < 1 || lbl.length > 80) throw new Error('range_label 1-80 chars');
    out.range_label = lbl;
  }
  if (body.country_name !== undefined) out.country_name = body.country_name ? String(body.country_name).slice(0, 80) : null;
  if (body.range_prefix !== undefined) out.range_prefix = body.range_prefix ? String(body.range_prefix).slice(0, 32) : null;
  if (body.operator !== undefined) out.operator = body.operator ? String(body.operator).slice(0, 64) : null;
  if (body.notes !== undefined) out.notes = body.notes ? String(body.notes).slice(0, 500) : null;
  if (body.price_bdt !== undefined) {
    const p = Number(body.price_bdt);
    if (!isFinite(p) || p < 0) throw new Error('price_bdt must be >= 0');
    out.price_bdt = p;
  }
  if (body.enabled !== undefined) out.enabled = body.enabled ? 1 : 0;
  return out;
}

// ============ ADMIN ============
router.get('/admin/provider-ranges', authRequired, adminOnly, (req, res) => {
  const { provider, country_code, enabled } = req.query;
  const where = [];
  const params = [];
  if (provider) { where.push('provider = ?'); params.push(provider); }
  if (country_code) { where.push('country_code = ?'); params.push(String(country_code).toUpperCase()); }
  if (enabled === '0' || enabled === '1') { where.push('enabled = ?'); params.push(+enabled); }
  const sql = `SELECT * FROM provider_ranges ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY provider, country_code, range_label`;
  res.json({ rows: db.prepare(sql).all(...params) });
});

router.post('/admin/provider-ranges', authRequired, adminOnly, (req, res) => {
  try {
    const v = validate(req.body || {});
    const r = db.prepare(`
      INSERT INTO provider_ranges (provider, country_code, country_name, range_label, range_prefix, operator, price_bdt, enabled, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      v.provider, v.country_code, v.country_name || null, v.range_label,
      v.range_prefix || null, v.operator || null, v.price_bdt || 0,
      v.enabled === undefined ? 1 : v.enabled, v.notes || null
    );
    logFromReq(req, 'range_create', { meta: { provider: v.provider, country: v.country_code, label: v.range_label } });
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'A range with same provider/country/label already exists' });
    res.status(400).json({ error: e.message });
  }
});

router.patch('/admin/provider-ranges/:id', authRequired, adminOnly, (req, res) => {
  try {
    const id = +req.params.id;
    const existing = db.prepare('SELECT * FROM provider_ranges WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const v = validate(req.body || {}, true);
    const fields = [];
    const params = [];
    for (const [k, val] of Object.entries(v)) { fields.push(`${k} = ?`); params.push(val); }
    if (!fields.length) return res.json({ ok: true, unchanged: true });
    fields.push(`updated_at = strftime('%s','now')`);
    params.push(id);
    db.prepare(`UPDATE provider_ranges SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    logFromReq(req, 'range_update', { targetId: id, meta: v });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/admin/provider-ranges/:id', authRequired, adminOnly, (req, res) => {
  const id = +req.params.id;
  const r = db.prepare('DELETE FROM provider_ranges WHERE id = ?').run(id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  logFromReq(req, 'range_delete', { targetId: id });
  res.json({ ok: true });
});

// Bulk toggle: { ids: [..], enabled: 0|1 }
router.post('/admin/provider-ranges/bulk-toggle', authRequired, adminOnly, (req, res) => {
  const { ids, enabled } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids[] required' });
  const flag = enabled ? 1 : 0;
  const stmt = db.prepare(`UPDATE provider_ranges SET enabled = ?, updated_at = strftime('%s','now') WHERE id = ?`);
  const tx = db.transaction(() => { for (const id of ids) stmt.run(flag, +id); });
  tx();
  logFromReq(req, 'range_bulk_toggle', { meta: { count: ids.length, enabled: flag } });
  res.json({ ok: true, updated: ids.length });
});

// ─────────────────────────────────────────────────────────────────────
// POOL NUMBERS — manually pasted MSISDNs under a range.
// ─────────────────────────────────────────────────────────────────────

// Normalize an MSISDN: keep digits and a single leading +.
function normalizeMsisdn(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const plus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 18) return null;
  return (plus ? '+' : '') + digits;
}

// GET /admin/provider-ranges/:id/pool — list numbers under a range
router.get('/admin/provider-ranges/:id/pool', authRequired, adminOnly, (req, res) => {
  const id = +req.params.id;
  const range = db.prepare('SELECT id, provider, country_code, range_label FROM provider_ranges WHERE id = ?').get(id);
  if (!range) return res.status(404).json({ error: 'Range not found' });
  const status = (req.query.status || '').toString();
  const where = ['range_id = ?'];
  const params = [id];
  if (['free', 'allocated', 'used', 'disabled'].includes(status)) {
    where.push('status = ?'); params.push(status);
  }
  const rows = db.prepare(`
    SELECT p.id, p.msisdn, p.status, p.allocated_user_id, p.allocated_at,
           p.last_otp_at, p.otp_count, p.note, p.created_at,
           u.username AS allocated_username
    FROM pool_numbers p
    LEFT JOIN users u ON u.id = p.allocated_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.created_at DESC
    LIMIT 2000
  `).all(...params);
  res.json({ range, rows });
});

// POST /admin/provider-ranges/:id/pool/bulk — paste MSISDNs (one per line / commas / spaces)
router.post('/admin/provider-ranges/:id/pool/bulk', authRequired, adminOnly, (req, res) => {
  const id = +req.params.id;
  const range = db.prepare('SELECT id FROM provider_ranges WHERE id = ?').get(id);
  if (!range) return res.status(404).json({ error: 'Range not found' });
  const raw = String(req.body?.numbers || '');
  if (!raw.trim()) return res.status(400).json({ error: 'numbers (string) required' });

  const tokens = raw.split(/[\s,;]+/).map(normalizeMsisdn).filter(Boolean);
  if (!tokens.length) return res.status(400).json({ error: 'no valid MSISDNs found' });

  const ins = db.prepare(`
    INSERT INTO pool_numbers (range_id, msisdn, status)
    VALUES (?, ?, 'free')
    ON CONFLICT(range_id, msisdn) DO NOTHING
  `);
  let added = 0, dup = 0;
  const tx = db.transaction(() => {
    for (const m of tokens) {
      const r = ins.run(id, m);
      if (r.changes) added++; else dup++;
    }
  });
  tx();
  logFromReq(req, 'pool_bulk_add', { targetId: id, meta: { added, dup, total: tokens.length } });
  res.json({ ok: true, added, duplicates: dup, total_tokens: tokens.length });
});

// DELETE /admin/pool-numbers/:id — remove a single number (only if not in use)
router.delete('/admin/pool-numbers/:id', authRequired, adminOnly, (req, res) => {
  const id = +req.params.id;
  const row = db.prepare('SELECT id, status FROM pool_numbers WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status === 'allocated' && !req.query.force) {
    return res.status(409).json({ error: 'Number is allocated — pass ?force=1 to delete anyway' });
  }
  db.prepare('DELETE FROM pool_numbers WHERE id = ?').run(id);
  logFromReq(req, 'pool_delete', { targetId: id });
  res.json({ ok: true });
});

// POST /admin/pool-numbers/:id/release — force a number back to 'free'
router.post('/admin/pool-numbers/:id/release', authRequired, adminOnly, (req, res) => {
  const id = +req.params.id;
  const r = db.prepare(`
    UPDATE pool_numbers
    SET status = 'free', allocated_user_id = NULL, allocated_at = NULL,
        updated_at = strftime('%s','now')
    WHERE id = ?
  `).run(id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  logFromReq(req, 'pool_release', { targetId: id });
  res.json({ ok: true });
});

// POST /admin/provider-ranges/:id/pool/purge?status=free|used  — bulk delete by status
router.post('/admin/provider-ranges/:id/pool/purge', authRequired, adminOnly, (req, res) => {
  const id = +req.params.id;
  const status = String(req.query.status || req.body?.status || '');
  if (!['free', 'used'].includes(status)) {
    return res.status(400).json({ error: 'status must be free or used' });
  }
  const r = db.prepare('DELETE FROM pool_numbers WHERE range_id = ? AND status = ?').run(id, status);
  logFromReq(req, 'pool_purge', { targetId: id, meta: { status, removed: r.changes } });
  res.json({ ok: true, removed: r.changes });
});

// GET /admin/provider-ranges/stats — per-range stock + last activity, all ranges in one shot
router.get('/admin/provider-ranges-stats', authRequired, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT
      r.id AS range_id,
      COUNT(p.id)                                       AS total,
      SUM(CASE WHEN p.status='free'      THEN 1 ELSE 0 END) AS free_count,
      SUM(CASE WHEN p.status='allocated' THEN 1 ELSE 0 END) AS allocated_count,
      SUM(CASE WHEN p.status='used'      THEN 1 ELSE 0 END) AS used_count,
      MAX(p.last_otp_at)                                AS last_otp_at,
      MAX(p.allocated_at)                               AS last_allocated_at,
      SUM(p.otp_count)                                  AS total_otps
    FROM provider_ranges r
    LEFT JOIN pool_numbers p ON p.range_id = r.id
    GROUP BY r.id
  `).all();
  const byId = {};
  for (const r of rows) byId[r.range_id] = r;
  res.json({ stats: byId });
});

// ============ AGENT ============
// GET /api/numbers/v2/countries — distinct countries that have ≥1 enabled range
router.get('/numbers/v2/countries', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT country_code,
           COALESCE(MAX(country_name), country_code) AS country_name,
           COUNT(*) AS range_count
    FROM provider_ranges
    WHERE enabled = 1
    GROUP BY country_code
    ORDER BY country_name
  `).all();
  res.json({ countries: rows });
});

// GET /api/numbers/v2/ranges?country=XX — enabled ranges for an agent in a country
router.get('/numbers/v2/ranges', authRequired, (req, res) => {
  const cc = String(req.query.country || '').toUpperCase();
  if (!cc) return res.status(400).json({ error: 'country query param required' });
  const rows = db.prepare(`
    SELECT id, provider, country_code, country_name, range_label, range_prefix, operator, price_bdt
    FROM provider_ranges
    WHERE enabled = 1 AND country_code = ?
    ORDER BY provider, range_label
  `).all(cc);
  res.json({ ranges: rows });
});

module.exports = router;
