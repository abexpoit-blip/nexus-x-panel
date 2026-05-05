// Services catalog — admin CRUD + public list.
// A "service" is the destination platform an OTP is for (Facebook,
// WhatsApp, Telegram, …). Provider ranges are tagged with one service so
// agents can filter stock per service on the Get Number page.
const express = require('express');
const db = require('../lib/db');
const { authRequired, adminOnly } = require('../middleware/auth');
const { logFromReq } = require('../lib/audit');

const router = express.Router();

function validate(body, partial = false) {
  const out = {};
  const need = (k, v) => { if (!partial && (v === undefined || v === null || v === '')) throw new Error(`${k} required`); };

  need('slug', body.slug);
  if (body.slug !== undefined) {
    const s = String(body.slug).trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(s)) throw new Error('slug: 2-32 chars [a-z0-9_-]');
    out.slug = s;
  }
  need('name', body.name);
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (n.length < 1 || n.length > 40) throw new Error('name: 1-40 chars');
    out.name = n;
  }
  if (body.icon !== undefined) {
    const i = String(body.icon || '').trim();
    out.icon = i.slice(0, 8) || '📱';
  }
  if (body.color !== undefined) {
    const c = String(body.color || '').trim();
    if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) throw new Error('color: must be #rrggbb');
    out.color = c || '#3b82f6';
  }
  if (body.enabled !== undefined) out.enabled = body.enabled ? 1 : 0;
  if (body.sort_order !== undefined) {
    const s = Number(body.sort_order);
    if (!Number.isFinite(s)) throw new Error('sort_order: must be number');
    out.sort_order = Math.max(0, Math.min(9999, Math.floor(s)));
  }
  return out;
}

// Public — used by agents to render the service tab switcher.
router.get('/services', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.slug, s.name, s.icon, s.color, s.sort_order,
           (SELECT COUNT(*) FROM provider_ranges r
              WHERE r.service_id = s.id AND r.enabled = 1) AS range_count,
           (SELECT COUNT(*) FROM provider_ranges r
              JOIN pool_numbers p ON p.range_id = r.id
              WHERE r.service_id = s.id AND r.enabled = 1 AND p.status = 'free') AS free_count
    FROM services s WHERE s.enabled = 1
    ORDER BY s.sort_order, s.name
  `).all();
  res.json({ services: rows });
});

// Admin — full list (incl. disabled)
router.get('/admin/services', authRequired, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT s.*,
           (SELECT COUNT(*) FROM provider_ranges r WHERE r.service_id = s.id) AS range_count
    FROM services s ORDER BY s.sort_order, s.name
  `).all();
  res.json({ rows });
});

router.post('/admin/services', authRequired, adminOnly, (req, res) => {
  try {
    const v = validate(req.body || {});
    const r = db.prepare(`
      INSERT INTO services (slug, name, icon, color, enabled, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(v.slug, v.name, v.icon || '📱', v.color || '#3b82f6',
           v.enabled === undefined ? 1 : v.enabled,
           v.sort_order === undefined ? 100 : v.sort_order);
    logFromReq(req, 'service_create', { meta: { slug: v.slug, name: v.name } });
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'A service with this slug already exists' });
    res.status(400).json({ error: e.message });
  }
});

router.patch('/admin/services/:id', authRequired, adminOnly, (req, res) => {
  try {
    const id = +req.params.id;
    const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const v = validate(req.body || {}, true);
    const fields = [], params = [];
    for (const [k, val] of Object.entries(v)) { fields.push(`${k} = ?`); params.push(val); }
    if (!fields.length) return res.json({ ok: true, unchanged: true });
    fields.push(`updated_at = strftime('%s','now')`);
    params.push(id);
    db.prepare(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    logFromReq(req, 'service_update', { targetId: id, meta: v });
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'A service with this slug already exists' });
    res.status(400).json({ error: e.message });
  }
});

router.delete('/admin/services/:id', authRequired, adminOnly, (req, res) => {
  const id = +req.params.id;
  const used = db.prepare('SELECT COUNT(*) c FROM provider_ranges WHERE service_id = ?').get(id).c;
  if (used > 0 && !req.query.force) {
    return res.status(409).json({ error: `Service is used by ${used} range${used === 1 ? '' : 's'} — pass ?force=1 to delete anyway (ranges keep working but lose the service tag)` });
  }
  db.prepare('UPDATE provider_ranges SET service_id = NULL WHERE service_id = ?').run(id);
  const r = db.prepare('DELETE FROM services WHERE id = ?').run(id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  logFromReq(req, 'service_delete', { targetId: id });
  res.json({ ok: true });
});

module.exports = router;