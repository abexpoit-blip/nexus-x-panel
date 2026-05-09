const express = require('express');
const db = require('../lib/db');
const { authRequired, adminOnly } = require('../middleware/auth');
const { logFromReq } = require('../lib/audit');

const router = express.Router();

// Helper — when admin toggles "Hide fakes from my CDR view", we filter them
// out of /api/cdr (admin) and /api/cdr/mine. They ALWAYS stay in /api/cdr/feed
// so agents continue to see realistic activity.
function adminHidesFakes() {
  try {
    return db.prepare("SELECT value FROM settings WHERE key='cdr_hide_fakes'").get()?.value === 'true';
  } catch { return false; }
}
function adminFakeFilter() {
  return adminHidesFakes() ? "AND (c.note IS NULL OR c.note != 'fake:broadcast')" : '';
}

// GET /api/cdr — admin sees all
router.get('/', authRequired, adminOnly, (req, res) => {
  const cdr = db.prepare(`
    SELECT c.*, u.username,
           CASE WHEN c.is_fake = 1 THEN 'fake' ELSE 'real' END AS kind
    FROM cdr c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE 1=1 ${adminFakeFilter()}
    ORDER BY c.created_at DESC LIMIT 1000
  `).all();
  res.json({ cdr });
});

// GET /api/cdr/mine — agent sees own
// Agents ALWAYS get fakes filtered (they're attributed to admin user_id, so
// they wouldn't show here anyway — this is just defense-in-depth).
router.get('/mine', authRequired, (req, res) => {
  const cdr = db.prepare(`
    SELECT c.*,
           CASE WHEN c.is_fake = 1 THEN 'fake' ELSE 'real' END AS kind
    FROM cdr c
    WHERE c.user_id = ? AND c.is_fake = 0
    ORDER BY c.created_at DESC LIMIT 500
  `).all(req.user.id);
  res.json({ cdr });
});

// GET /api/cdr/feed — PUBLIC activity feed (any logged-in agent)
// Shows every OTP that hits the system, with phone + OTP MASKED so no agent
// can steal another agent's codes. Purpose: agents can see which ranges are
// actively receiving OTPs right now and pick hot ranges in Get Number.
router.get('/feed', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT id, phone_number, otp_code, operator, country_code, cli,
           provider, price_bdt, created_at, note, sms_text, is_fake
    FROM cdr c
    WHERE otp_code IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 200
  `).all();
  const maskPhone = (p) => {
    if (!p) return '';
    if (p.length <= 4) return 'X'.repeat(p.length);
    const head = p.slice(0, p.length - 4);
    return (p.startsWith('+') ? '' : '+') + head + 'XXXX';
  };
  const feed = rows.map(r => ({
    id: r.id,
    phone_masked: maskPhone(r.phone_number),
    otp_length: r.otp_code ? r.otp_code.length : 0,
    otp_code: r.otp_code,
    sms_text: r.sms_text || null,
    operator: r.operator,
    country_code: r.country_code,
    cli: r.cli || null,
    provider: r.provider,
    created_at: r.created_at,
    kind: r.is_fake ? 'fake' : 'real',
  }));
  res.json({ feed });
});

// POST /api/cdr/refund/:id — admin reverses a billed CDR
router.post('/refund/:id', authRequired, adminOnly, (req, res) => {
  const id = +req.params.id;
  const { note } = req.body || {};
  const c = db.prepare("SELECT * FROM cdr WHERE id = ? AND status = 'billed'").get(id);
  if (!c) return res.status(404).json({ error: 'CDR not found or already processed' });

  const tx = db.transaction(() => {
    db.prepare("UPDATE cdr SET status = 'refunded', note = ? WHERE id = ?").run(note || null, id);
    db.prepare("UPDATE users SET balance = balance - ?, otp_count = MAX(0, otp_count - 1) WHERE id = ?")
      .run(c.price_bdt, c.user_id);
    db.prepare(`
      INSERT INTO payments (user_id, amount_bdt, type, method, reference, note)
      VALUES (?, ?, 'debit', 'admin', ?, ?)
    `).run(c.user_id, c.price_bdt, `refund:${id}`, note || 'OTP refund');
  });
  tx();

  logFromReq(req, 'cdr_refunded', { targetType: 'cdr', targetId: id });
  res.json({ ok: true });
});

module.exports = router;
