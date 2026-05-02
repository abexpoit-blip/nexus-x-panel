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
_ensureCol('allocations', 'cli', 'TEXT');

module.exports = db;
