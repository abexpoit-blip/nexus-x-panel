// Initialize SQLite database — create tables, seed admin user
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// Same default path used by backend/lib/db.js so the runtime backend and
// init script always open the SAME file regardless of cwd (PM2 may launch
// from /opt/nexus, /opt/nexus/backend, etc.).
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', 'data', 'nexus.db');
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
addColIfMissing('cdr', 'sms_text', 'TEXT');

// Per-agent rate-limit overrides (NULL = use global setting).
addColIfMissing('users', 'rl_per_min',     'INTEGER');
addColIfMissing('users', 'rl_concurrent',  'INTEGER');

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

// Additive migration: hot flag (highlight as 🔥/HOT to agents)
try {
  const cols = db.prepare(`PRAGMA table_info(provider_ranges)`).all().map(c => c.name);
  if (!cols.includes('hot')) {
    db.exec(`ALTER TABLE provider_ranges ADD COLUMN hot INTEGER NOT NULL DEFAULT 0`);
  }
} catch (e) { /* noop */ }

// ─────────────────────────────────────────────────────────────────────
// Services — admin-managed catalog (Facebook, WhatsApp, Telegram, …).
// Each provider_range is tagged with ONE service so agents can filter
// stock per service. Seeded with Facebook + WhatsApp on first boot.
// ─────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,        -- machine id ('facebook', 'whatsapp')
    name TEXT NOT NULL,               -- display name
    icon TEXT NOT NULL DEFAULT '📱',  -- emoji or single char
    color TEXT NOT NULL DEFAULT '#3b82f6', -- hex accent (badge / pill)
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_services_enabled ON services(enabled, sort_order);
`);
function seedService(slug, name, icon, color, sort) {
  const exists = db.prepare('SELECT 1 FROM services WHERE slug = ?').get(slug);
  if (exists) return;
  db.prepare(`INSERT INTO services (slug, name, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)`)
    .run(slug, name, icon, color, sort);
  console.log(`✓ Seeded service: ${name}`);
}
seedService('facebook', 'Facebook', '📘', '#1877f2', 10);
seedService('whatsapp', 'WhatsApp', '💬', '#25d366', 20);

// Service tag carried through allocation → CDR for per-service stats / badges.
addColIfMissing('allocations', 'service_id', 'INTEGER REFERENCES services(id) ON DELETE SET NULL');
addColIfMissing('cdr',         'service_id', 'INTEGER REFERENCES services(id) ON DELETE SET NULL');

// Tag each provider_range with a service.
try {
  const cols = db.prepare(`PRAGMA table_info(provider_ranges)`).all().map(c => c.name);
  if (!cols.includes('service_id')) {
    db.exec(`ALTER TABLE provider_ranges ADD COLUMN service_id INTEGER REFERENCES services(id) ON DELETE SET NULL`);
    // Default existing ranges to Facebook so the panel keeps working unchanged.
    const fb = db.prepare(`SELECT id FROM services WHERE slug='facebook'`).get();
    if (fb) db.prepare(`UPDATE provider_ranges SET service_id = ? WHERE service_id IS NULL`).run(fb.id);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pranges_service ON provider_ranges(service_id, enabled)`);
    console.log('✓ Migration: provider_ranges.service_id (defaulted to Facebook)');
  }
} catch (e) { console.warn('service_id migration:', e.message); }

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
// (Provider bot settings are now seeded only on demand from the admin UI.)
if (process.env.SEVEN1TEL_USERNAME) {
  seedSetting('seven1tel_enabled',  process.env.SEVEN1TEL_ENABLED   || 'true');
  seedSetting('seven1tel_base_url', process.env.SEVEN1TEL_BASE_URL  || 'http://94.23.120.156/ints');
  seedSetting('seven1tel_username', process.env.SEVEN1TEL_USERNAME);
  seedSetting('seven1tel_password', process.env.SEVEN1TEL_PASSWORD || '');
  seedSetting('seven1tel_otp_interval', process.env.SEVEN1TEL_OTP_INTERVAL || '4');
}
// XISORA bot defaults — token-based REST API (no scraping). Admin sets the
// token in the Settings UI before flipping `xisora_enabled` on.
seedSetting('xisora_enabled',      process.env.XISORA_ENABLED      || 'false');
seedSetting('xisora_base_url',     process.env.XISORA_BASE_URL     || 'http://51.38.148.122/crapi/reseller/mdr.php');
seedSetting('xisora_token',        process.env.XISORA_TOKEN        || '');
seedSetting('xisora_portal_url',   process.env.XISORA_PORTAL_URL   || 'http://94.23.31.29/sms');
seedSetting('xisora_username',     process.env.XISORA_USERNAME     || 'mamun33');
seedSetting('xisora_password',     process.env.XISORA_PASSWORD     || 'mamun@12aa');
seedSetting('xisora_cookie_header', process.env.XISORA_COOKIE_HEADER || '');
seedSetting('xisora_otp_interval', process.env.XISORA_OTP_INTERVAL || '10');
// Fake OTP broadcaster defaults (off by default — admin enables in UI)
seedSetting('fake_otp_enabled',  process.env.FAKE_OTP_ENABLED  || 'false');
seedSetting('fake_otp_min_sec',  process.env.FAKE_OTP_MIN_SEC  || '15');
seedSetting('fake_otp_max_sec',  process.env.FAKE_OTP_MAX_SEC  || '90');
seedSetting('fake_otp_burst',    process.env.FAKE_OTP_BURST    || '1');
seedSetting('cdr_hide_fakes',    'false');

console.log(`✓ Database ready at ${DB_PATH}`);
db.close();

module.exports = { DB_PATH };
