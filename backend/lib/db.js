// Singleton DB connection used by all routes
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Keep the runtime backend DB aligned with scripts/admin-reset.js regardless of
// PM2 cwd (`/opt/nexus`, `/opt/nexus/backend`, etc.).
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', 'data', 'nexus.db');

// Auto-create data dir
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log(`✓ Database ready at ${DB_PATH}`);

// --- Self-healing migrations (run by EVERY process that opens the DB) ---
function _ensureCol(table, col, ddl) {
  try {
    const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
    if (!t) return;
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
      console.log(`[db] auto-migrated ${table}.${col}`);
    }
  } catch (e) {
    console.error(`[db] auto-migrate ${table}.${col} failed:`, e.message);
  }
}
_ensureCol('cdr', 'note', 'TEXT');
_ensureCol('cdr', 'cli', 'TEXT');
_ensureCol('cdr', 'sms_text', 'TEXT');
_ensureCol('cdr', 'service_id', 'INTEGER REFERENCES services(id) ON DELETE SET NULL');
_ensureCol('allocations', 'cli', 'TEXT');
_ensureCol('allocations', 'service_id', 'INTEGER REFERENCES services(id) ON DELETE SET NULL');
_ensureCol('allocations', 'range_id', 'INTEGER REFERENCES provider_ranges(id) ON DELETE SET NULL');
_ensureCol('allocations', 'range_label', 'TEXT');

// --- Self-healing: ensure pool tables exist (idempotent) ---
// Prevents "no such table: provider_ranges / pool_numbers" when the runtime
// process opens a DB that pre-dates these features and `npm run init-db`
// hasn't been run against THIS file. Safe to run on every boot.
try {
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
      hot INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(provider, country_code, range_label)
    );
    CREATE INDEX IF NOT EXISTS idx_pranges_lookup ON provider_ranges(enabled, country_code);
    CREATE INDEX IF NOT EXISTS idx_pranges_provider ON provider_ranges(provider, enabled);

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
      UNIQUE(range_id, msisdn)
    );
    CREATE INDEX IF NOT EXISTS idx_pool_range_status ON pool_numbers(range_id, status);
    CREATE INDEX IF NOT EXISTS idx_pool_msisdn ON pool_numbers(msisdn);
    CREATE INDEX IF NOT EXISTS idx_pool_alloc_user ON pool_numbers(allocated_user_id);
  `);
  _ensureCol('provider_ranges', 'hot', 'INTEGER NOT NULL DEFAULT 0');
  _ensureCol('provider_ranges', 'country_name', 'TEXT');
  _ensureCol('provider_ranges', 'range_prefix', 'TEXT');
  _ensureCol('provider_ranges', 'operator', 'TEXT');
  _ensureCol('provider_ranges', 'notes', 'TEXT');
  _ensureCol('provider_ranges', 'currency', 'TEXT');
} catch (e) {
  console.error('[db] pool tables self-heal failed:', e.message);
}

// --- Self-healing: end-to-end OTP audit log ---
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS otp_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_msg_id TEXT,
      phone_number TEXT,
      cli TEXT,
      otp_code TEXT,
      sms_text TEXT,
      allocation_id INTEGER,
      user_id INTEGER,
      outcome TEXT NOT NULL,
      miss_reason TEXT,
      amount_bdt REAL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_otp_audit_time ON otp_audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_otp_audit_source ON otp_audit_log(source, created_at);
    CREATE INDEX IF NOT EXISTS idx_otp_audit_outcome ON otp_audit_log(outcome, created_at);
    CREATE INDEX IF NOT EXISTS idx_otp_audit_phone ON otp_audit_log(phone_number);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_otp_audit_src_msg ON otp_audit_log(source, source_msg_id);
  `);
} catch (e) {
  console.error('[db] otp_audit_log self-heal failed:', e.message);
}

module.exports = db;
