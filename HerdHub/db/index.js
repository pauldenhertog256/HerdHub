import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { migrateFromJson } from './migrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'herdhub.db');

let db = null;

/**
 * Initialize and return the SQLite database instance.
 * Handles connection, safety pragmas, schema creation, and automatic migration.
 *
 * SECURITY NOTE: All database interactions MUST use db.prepare() with
 * parameterized queries to prevent SQL injection. Never concatenate
 * user input into SQL strings.
 */
export function getDb() {
  if (db) return db;

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Open database
  db = new Database(DB_PATH);

  // Safety and Performance Pragmas
  db.pragma('journal_mode = WAL');
  // Phase 1: Disable foreign keys to allow safe dual-write from JSON without ordering issues.
  // Foreign keys will be re-enabled in Phase 3 after migration verification.
  db.pragma('foreign_keys = OFF');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  // Initialize Schema
  const schemaPath = join(__dirname, 'schema.sql');
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, 'utf8');
    db.exec(schema);
  }

  // Auto-Migration: Run if accounts table is empty and JSON data exists
  const accountCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get().count;
  if (accountCount === 0) {
    console.log('🔄 No accounts found in SQLite. Checking for JSON data to migrate...');
    migrateFromJson(db, DATA_DIR);
  }

  // Daily Backup Cron
  setupDailyBackup();

  return db;
}

/**
 * Close the database connection gracefully.
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log('🔒 Database connection closed.');
  }
}

/**
 * Setup automatic daily backup of the database file.
 */
function setupDailyBackup() {
  const BACKUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  const backupDir = join(DATA_DIR, 'backups');
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

  setInterval(() => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const backupPath = join(backupDir, `herdhub-${date}.db`);
      copyFileSync(DB_PATH, backupPath);
      console.log(`💾 Daily database backup saved: ${backupPath}`);
    } catch (err) {
      console.error('❌ Daily backup failed:', err.message);
    }
  }, BACKUP_INTERVAL);
}
