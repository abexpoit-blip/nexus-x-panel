-- NexusX SQLite schema
-- Auto-applied on first server start

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent',         -- 'admin' | 'agent'
  full_name TEXT,
  phone TEXT,
  telegram TEXT,
  balance REAL NOT NULL DEFAULT 0,
  otp_count INTEGER NOT NULL DEFAULT 0,
  daily_limit INTEGER NOT NULL DEFAULT 100,
  per_request_limit INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'active',      -- 'active' | 'suspended'
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  country_code TEXT,
  country_name TEXT,
  operator TEXT,
  price_bdt REAL NOT NULL DEFAULT 0,                -- what provider charges us
  agent_commission_percent REAL NOT NULL DEFAULT 60,-- agent earns % of price_bdt on success
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_rates_lookup ON rates(provider, country_code, operator);

CREATE TABLE IF NOT EXISTS allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_ref TEXT,                          -- upstream provider reference, if any
  country_code TEXT,
  operator TEXT,
  phone_number TEXT NOT NULL,
  otp TEXT,
  cli TEXT,                                   -- service/CLI tag (Facebook, WhatsApp, Telegram, etc.)
  status TEXT NOT NULL DEFAULT 'active',      -- 'active' | 'received' | 'expired' | 'released'
  price_bdt REAL DEFAULT 0,
  allocated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  otp_received_at INTEGER,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alloc_user ON allocations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_alloc_status ON allocations(status, allocated_at);

CREATE TABLE IF NOT EXISTS cdr (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allocation_id INTEGER REFERENCES allocations(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  country_code TEXT,
  operator TEXT,
  phone_number TEXT NOT NULL,
  otp_code TEXT,
  cli TEXT,                                    -- service tag (Facebook, WhatsApp, etc.)
  price_bdt REAL NOT NULL DEFAULT 0,           -- what we charge / pay agent
  status TEXT NOT NULL DEFAULT 'billed',       -- 'billed' | 'refunded' | 'failed'
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_cdr_user ON cdr(user_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_bdt REAL NOT NULL,
  type TEXT NOT NULL,                          -- 'topup' | 'credit' | 'debit' | 'refund'
  method TEXT,                                 -- 'admin' | 'bkash' | 'nagad' | 'manual'
  reference TEXT,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_pay_user ON payments(user_id, created_at);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_bdt REAL NOT NULL,
  method TEXT NOT NULL,                        -- 'bkash' | 'nagad' | 'rocket' | 'bank' | 'crypto'
  account_name TEXT,
  account_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'approved' | 'rejected'
  note TEXT,
  admin_note TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_wd_user ON withdrawals(user_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, -- NULL = broadcast
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',           -- 'info' | 'success' | 'warning' | 'error'
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  ip TEXT,
  user_agent TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);

-- =============================================================
-- OTP audit log — one row per scraped OTP across every bot.
-- Captures: source provider, source_msg_id (bot's dedup key), the
-- raw SMS text, the matched allocation (or NULL + miss_reason),
-- and the final write outcome (billed | duplicate | resend | mismatch | error).
-- =============================================================
CREATE TABLE IF NOT EXISTS otp_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                -- 'ims' | 'xisora' | 'seven1tel' | ...
  source_msg_id TEXT,                  -- bot dedup key / portal row id
  phone_number TEXT,
  cli TEXT,
  otp_code TEXT,
  sms_text TEXT,
  allocation_id INTEGER REFERENCES allocations(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL,               -- billed | duplicate | resend | mismatch | error
  miss_reason TEXT,                    -- populated when outcome != billed
  amount_bdt REAL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_audit_time ON otp_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_otp_audit_source ON otp_audit_log(source, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_audit_outcome ON otp_audit_log(outcome, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_audit_phone ON otp_audit_log(phone_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_otp_audit_src_msg ON otp_audit_log(source, source_msg_id);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sess_user ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('signup_enabled', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('maintenance_mode', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('maintenance_message', 'System is under maintenance. Please try again later.');
