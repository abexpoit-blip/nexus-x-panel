const db = require('./db');
const { getOtpExpirySec } = require('./settings');

function normalizeTail(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? digits.slice(-9) : null;
}

function normalizeDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function samePhone(a, b) {
  const left = normalizeDigits(a);
  const right = normalizeDigits(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function sameRange(panelRange, allocation) {
  const panel = String(panelRange || '').trim().toLowerCase();
  if (!panel) return true; // no panel info → caller must disambiguate by phone
  const values = [allocation.range_label, allocation.operator]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean);
  if (!values.length) return false; // panel says X, allocation has nothing → not a match
  return values.some((v) => v === panel || v.includes(panel) || panel.includes(v));
}

function resolveServiceId(cliSlug) {
  if (!cliSlug) return null;
  try {
    return db.prepare('SELECT id FROM services WHERE slug = ?').get(String(cliSlug))?.id || null;
  } catch (_) {
    return null;
  }
}

function inferServiceSlug(cli, msg) {
  const hay = `${cli || ''} ${msg || ''}`.toLowerCase();
  if (/whats\s*app|wa\b/.test(hay)) return 'whatsapp';
  if (/facebook|fb\b|meta/.test(hay)) return 'facebook';
  if (/instagram|insta\b/.test(hay)) return 'instagram';
  if (/telegram/.test(hay)) return 'telegram';
  if (/google|gmail|youtube/.test(hay)) return 'google';
  if (/tiktok/.test(hay)) return 'tiktok';
  if (/twitter|\bx\b/.test(hay)) return 'twitter';
  return null;
}

function findMatchingAllocation({
  provider,
  phone,
  cliSlug = null,
  panelRange = null,
  eventAtSec = null,
  lateGraceSec = 300,
  resendSec = 600,
  futureSkewSec = 60,
}) {
  const tail = normalizeTail(phone);
  if (!provider || !tail) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const eventAt = Number.isFinite(+eventAtSec) && +eventAtSec > 0 ? +eventAtSec : nowSec;
  const expirySec = Math.max(1, +getOtpExpirySec() || 600);
  // Panels often report timestamps in their own timezone (IMS is ~6h behind
  // our VPS UTC clock). If we trust eventAt blindly, a freshly-claimed
  // allocation can look "in the future" relative to the panel's reported
  // event time and get excluded. Anchor the window to the EARLIER of
  // eventAt and now for the lower bound, and the LATER of eventAt and now
  // for the upper bound — this absorbs any panel↔server clock skew while
  // still keeping the window narrow enough to reject genuinely stale rows.
  const skew = Math.max(0, +futureSkewSec || 0);
  const anchorOld = Math.min(eventAt, nowSec);
  const anchorNew = Math.max(eventAt, nowSec);
  const oldestAllocatedAt = anchorOld - expirySec - Math.max(0, +lateGraceSec || 0);
  const newestRelevantAt = anchorNew + skew;
  const resendSince = anchorOld - Math.max(0, +resendSec || 0);
  const serviceId = resolveServiceId(cliSlug);

  const loadCandidates = (extraSql = '', extraArgs = []) => db.prepare(`
    SELECT id, user_id, phone_number, provider, country_code, operator,
           service_id, range_id, range_label, status, allocated_at, otp_received_at
    FROM allocations
    WHERE provider = ?
      AND phone_number LIKE ?
      ${extraSql}
      AND (
        (status = 'active' AND allocated_at BETWEEN ? AND ?)
        OR (status = 'expired' AND allocated_at BETWEEN ? AND ?)
        OR (status = 'received' AND COALESCE(otp_received_at, allocated_at) BETWEEN ? AND ?)
      )
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'received' THEN 1 WHEN 'expired' THEN 2 ELSE 3 END,
             allocated_at DESC
    LIMIT 20
  `).all(
    provider,
    `%${tail}`,
    ...extraArgs,
    oldestAllocatedAt,
    newestRelevantAt,
    oldestAllocatedAt,
    newestRelevantAt,
    resendSince,
    newestRelevantAt,
  );

  const pick = (rows) => {
    // 1) Best: full phone match AND range match (when panel exposes range).
    const exactBoth = rows.filter((row) => samePhone(row.phone_number, phone) && sameRange(panelRange, row));
    if (exactBoth.length === 1) return exactBoth[0];
    if (exactBoth.length > 1) return exactBoth[0]; // already narrowed by phone+range; newest wins

    // 2) Phone matches exactly, no range info from panel — only deliver if
    //    there's exactly ONE such allocation. Multiple = ambiguous → drop
    //    rather than risk delivering an OTP to the wrong agent.
    const exactPhone = rows.filter((row) => samePhone(row.phone_number, phone));
    if (exactPhone.length === 1) return exactPhone[0];
    if (exactPhone.length > 1 && !panelRange) return null;

    // 3) Phone tail-only match (e.g. panel reports "0971234567" but allocation
    //    stored "260971234567"). Only accept when exactly one candidate AND
    //    range matches (or panel has no range info and only one candidate exists).
    const ranged = rows.filter((row) => sameRange(panelRange, row));
    return ranged.length === 1 ? ranged[0] : null;
  };

  if (serviceId) {
    const matched = pick(loadCandidates('AND service_id = ?', [serviceId]));
    if (matched) return matched;
  }

  return pick(loadCandidates());
}

function hasSeenSourceMessage(source, sourceMsgId) {
  if (!source || !sourceMsgId) return false;
  try {
    return !!db.prepare(
      'SELECT 1 FROM otp_audit_log WHERE source = ? AND source_msg_id = ? LIMIT 1'
    ).get(String(source), String(sourceMsgId));
  } catch (_) {
    return false;
  }
}

module.exports = {
  findMatchingAllocation,
  hasSeenSourceMessage,
  inferServiceSlug,
  normalizeDigits,
  resolveServiceId,
};