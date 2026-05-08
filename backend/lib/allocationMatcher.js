const db = require('./db');
const { getOtpExpirySec } = require('./settings');

function normalizeTail(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? digits.slice(-9) : null;
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
  const oldestAllocatedAt = eventAt - expirySec - Math.max(0, +lateGraceSec || 0);
  const newestRelevantAt = eventAt + Math.max(0, +futureSkewSec || 0);
  const resendSince = eventAt - Math.max(0, +resendSec || 0);
  const serviceId = resolveServiceId(cliSlug);

  const runMatch = (extraSql = '', extraArgs = []) => db.prepare(`
    SELECT id, user_id, phone_number, provider, country_code, operator,
           service_id, status, allocated_at, otp_received_at
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
    LIMIT 1
  `).get(
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

  if (serviceId) {
    const matched = runMatch('AND service_id = ?', [serviceId]);
    if (matched) return matched;
  }

  return runMatch();
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
  resolveServiceId,
};