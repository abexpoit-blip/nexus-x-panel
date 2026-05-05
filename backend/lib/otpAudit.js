// Centralized OTP audit logger. Every scraped OTP — whether billed,
// duplicate, mismatched, or errored — is recorded here for end-to-end
// traceability. Writes are best-effort; failures never break the bot.
const db = require('./db');

const stmt = db.prepare(`
  INSERT OR IGNORE INTO otp_audit_log
    (source, source_msg_id, phone_number, cli, otp_code, sms_text,
     allocation_id, user_id, outcome, miss_reason, amount_bdt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * outcome ∈ 'billed' | 'duplicate' | 'resend' | 'mismatch' | 'error'
 */
function logOtpAudit({
  source, source_msg_id = null, phone_number = null, cli = null,
  otp_code = null, sms_text = null, allocation_id = null, user_id = null,
  outcome, miss_reason = null, amount_bdt = null,
}) {
  try {
    const info = stmt.run(
      String(source), source_msg_id ? String(source_msg_id) : null,
      phone_number, cli, otp_code,
      sms_text ? String(sms_text).slice(0, 1000) : null,
      allocation_id, user_id,
      String(outcome), miss_reason ? String(miss_reason).slice(0, 300) : null,
      amount_bdt,
    );
    return info.lastInsertRowid || null;
  } catch (e) {
    console.error('[otp-audit] write failed:', e.message);
    return null;
  }
}

module.exports = { logOtpAudit };