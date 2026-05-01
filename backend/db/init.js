// Initialize SQLite database — create tables, seed admin user
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || './data/nexus.db';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Apply schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// --- Idempotent column-add migrations for existing databases ---
function tableExists(table) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}
function addColIfMissing(table, col, ddl) {
  if (!tableExists(table)) return; // skip — schema will create with column
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    console.log(`✓ Migration: added ${table}.${col}`);
  }
}
addColIfMissing('withdrawals', 'admin_note', 'TEXT');
addColIfMissing('withdrawals', 'reviewed_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColIfMissing('withdrawals', 'reviewed_at', 'INTEGER');
addColIfMissing('allocations', 'cli', 'TEXT');
addColIfMissing('cdr', 'cli', 'TEXT');
addColIfMissing('cdr', 'note', 'TEXT');

// ─────────────────────────────────────────────────────────────────────
// Generic provider_ranges table — provider-agnostic, admin-managed ranges.
// Agents only see ranges where enabled=1. OTP wiring per provider is added
// later; this table is the source of truth for what's offered to agents.
// ─────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS provider_ranges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    country_code TEXT NOT NULL,
    country_name TEXT,
    range_label TEXT NOT NULL,
    range_prefix TEXT,
    operator TEXT,
    price_bdt REAL NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(provider, country_code, range_label)
  );
  CREATE INDEX IF NOT EXISTS idx_pranges_lookup ON provider_ranges(enabled, country_code);
  CREATE INDEX IF NOT EXISTS idx_pranges_provider ON provider_ranges(provider, enabled);
`);

// ─────────────────────────────────────────────────────────────────────
// pool_numbers — manually-pasted MSISDNs that belong to a range.
// Status: free → allocated → used (or free again if released).
// ─────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS pool_numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    range_id INTEGER NOT NULL,
    msisdn TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'free',
    allocated_user_id INTEGER,
    allocated_at INTEGER,
    last_otp_at INTEGER,
    otp_count INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(range_id, msisdn),
    FOREIGN KEY(range_id) REFERENCES provider_ranges(id) ON DELETE CASCADE,
    FOREIGN KEY(allocated_user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pool_range_status ON pool_numbers(range_id, status);
  CREATE INDEX IF NOT EXISTS idx_pool_msisdn ON pool_numbers(msisdn);
  CREATE INDEX IF NOT EXISTS idx_pool_alloc_user ON pool_numbers(allocated_user_id);
`);

// Seed default admin (only if no admin exists)
const adminExists = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get();
if (adminExists.c === 0) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, balance)
    VALUES (?, ?, 'admin', 'System Admin', 0)
  `).run(ADMIN_USERNAME, hash);
  console.log(`✓ Default admin created: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  console.log('  IMPORTANT: Change this password immediately in production!');
}

// ─────────────────────────────────────────────────────────────────────
// Seed default provider bot settings (only if missing — never overwrite
// admin edits). Lets the bots start on first deploy without manual SQL.
// ─────────────────────────────────────────────────────────────────────
function seedSetting(key, value) {
  const existing = db.prepare("SELECT 1 FROM settings WHERE key = ?").get(key);
  if (existing) return;
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, strftime('%s','now'))
  `).run(key, String(value));
  console.log(`✓ Seeded setting: ${key}`);
}
if (process.env.MEDIATEL_USERNAME) {
  seedSetting('mediatel_enabled',   process.env.MEDIATEL_ENABLED   || 'false');
  seedSetting('mediatel_base_url',  process.env.MEDIATEL_BASE_URL  || 'https://mediateluk.com/sms');
  seedSetting('mediatel_username',  process.env.MEDIATEL_USERNAME);
  seedSetting('mediatel_password',  process.env.MEDIATEL_PASSWORD || '');
  seedSetting('mediatel_otp_interval', process.env.MEDIATEL_OTP_INTERVAL || '8');
}
if (process.env.SEVEN1TEL_USERNAME) {
  seedSetting('seven1tel_enabled',  process.env.SEVEN1TEL_ENABLED   || 'true');
  seedSetting('seven1tel_base_url', process.env.SEVEN1TEL_BASE_URL  || 'http://94.23.120.156/ints');
  seedSetting('seven1tel_username', process.env.SEVEN1TEL_USERNAME);
  seedSetting('seven1tel_password', process.env.SEVEN1TEL_PASSWORD || '');
  seedSetting('seven1tel_otp_interval', process.env.SEVEN1TEL_OTP_INTERVAL || '4');
}
// Fake OTP broadcaster defaults (off by default — admin enables in UI)
seedSetting('fake_otp_enabled',  process.env.FAKE_OTP_ENABLED  || 'false');
seedSetting('fake_otp_min_sec',  process.env.FAKE_OTP_MIN_SEC  || '15');
seedSetting('fake_otp_max_sec',  process.env.FAKE_OTP_MAX_SEC  || '90');
seedSetting('fake_otp_burst',    process.env.FAKE_OTP_BURST    || '1');
seedSetting('cdr_hide_fakes',    'false');

console.log(`✓ Database ready at ${DB_PATH}`);
db.close();

module.exports = { DB_PATH };
