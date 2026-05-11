// Shared settings helpers — reads from `settings` table with safe fallbacks.
const db = require('./db');

// ---- OTP expiry (how long an allocation stays "active") ----
const OTP_EXPIRY_KEY = 'otp_expiry_sec';
const OTP_EXPIRY_DEFAULT = 600;   // 10 minutes
const OTP_EXPIRY_MIN = 300;       // 5 minutes
const OTP_EXPIRY_MAX = 1800;      // 30 minutes

function getOtpExpirySec() {
  try {
    const v = +(db.prepare('SELECT value FROM settings WHERE key = ?').get(OTP_EXPIRY_KEY)?.value || 0);
    if (!Number.isFinite(v) || v <= 0) return OTP_EXPIRY_DEFAULT;
    return Math.max(OTP_EXPIRY_MIN, Math.min(OTP_EXPIRY_MAX, Math.floor(v)));
  } catch (_) {
    return OTP_EXPIRY_DEFAULT;
  }
}

// ---- Recent-OTP window (how long received OTPs stay on the agent's
//      "live" /numbers/my list before disappearing into history). ----
// Older items remain visible permanently on the dedicated /agent/history page.
const RECENT_OTP_HOURS_KEY = 'recent_otp_hours';
const RECENT_OTP_HOURS_DEFAULT = 24;
const RECENT_OTP_HOURS_MIN = 1;
const RECENT_OTP_HOURS_MAX = 168;   // 7 days

function getRecentOtpHours() {
  try {
    const v = +(db.prepare('SELECT value FROM settings WHERE key = ?').get(RECENT_OTP_HOURS_KEY)?.value || 0);
    if (!Number.isFinite(v) || v <= 0) return RECENT_OTP_HOURS_DEFAULT;
    return Math.max(RECENT_OTP_HOURS_MIN, Math.min(RECENT_OTP_HOURS_MAX, Math.floor(v)));
  } catch (_) {
    return RECENT_OTP_HOURS_DEFAULT;
  }
}

// ---- Payment / Withdrawal settings ----
const PAY_KEYS = {
  min: 'wd_min_bdt',
  fee: 'wd_fee_percent',
  sla: 'wd_sla_hours',
  methods: 'wd_methods_enabled',
};
const PAY_DEFAULTS = {
  min: 300,
  fee: 2,
  sla: 24,
  methods: { bkash: true, nagad: true, rocket: true, bank: true, crypto: false },
};
const ALL_METHODS = ['bkash', 'nagad', 'rocket', 'bank', 'crypto'];

function readNum(key, fallback, min, max) {
  try {
    const v = +(db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || NaN);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, v));
  } catch (_) { return fallback; }
}

function getPaymentConfig() {
  let methods = PAY_DEFAULTS.methods;
  try {
    const raw = db.prepare('SELECT value FROM settings WHERE key = ?').get(PAY_KEYS.methods)?.value;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        methods = { ...PAY_DEFAULTS.methods };
        for (const m of ALL_METHODS) {
          if (typeof parsed[m] === 'boolean') methods[m] = parsed[m];
        }
      }
    }
  } catch (_) { /* fallback to defaults */ }

  return {
    min_amount: readNum(PAY_KEYS.min, PAY_DEFAULTS.min, 1, 10_000_000),
    fee_percent: readNum(PAY_KEYS.fee, PAY_DEFAULTS.fee, 0, 50),
    sla_hours: readNum(PAY_KEYS.sla, PAY_DEFAULTS.sla, 1, 168),
    methods,
    methods_enabled: ALL_METHODS.filter((m) => methods[m]),
    all_methods: ALL_METHODS,
  };
}

function savePaymentConfig({ min_amount, fee_percent, sla_hours, methods }) {
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  if (Number.isFinite(+min_amount))   stmt.run(PAY_KEYS.min, String(+min_amount));
  if (Number.isFinite(+fee_percent))  stmt.run(PAY_KEYS.fee, String(+fee_percent));
  if (Number.isFinite(+sla_hours))    stmt.run(PAY_KEYS.sla, String(+sla_hours));
  if (methods && typeof methods === 'object') {
    const clean = {};
    for (const m of ALL_METHODS) clean[m] = !!methods[m];
    stmt.run(PAY_KEYS.methods, JSON.stringify(clean));
  }
  return getPaymentConfig();
}

module.exports = {
  getOtpExpirySec,
  OTP_EXPIRY_KEY,
  OTP_EXPIRY_DEFAULT,
  OTP_EXPIRY_MIN,
  OTP_EXPIRY_MAX,
  getRecentOtpHours,
  RECENT_OTP_HOURS_KEY,
  RECENT_OTP_HOURS_DEFAULT,
  RECENT_OTP_HOURS_MIN,
  RECENT_OTP_HOURS_MAX,
  getPaymentConfig,
  savePaymentConfig,
  ALL_METHODS,
};
