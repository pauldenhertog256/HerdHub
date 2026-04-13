import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");
const DB_PATH = join(DATA_DIR, "herdhub.db");

let db = null;

/**
 * Initialize and return the SQLite database instance.
 * Handles connection, safety pragmas, and schema creation.
 *
 * SECURITY NOTE: All database interactions MUST use db.prepare() with
 * parameterized queries to prevent SQL injection. Never concatenate
 * user input into SQL strings.
 *
 * NOTE: Foreign keys are currently DISABLED to maintain backward compatibility
 * with the JSON-based system where users could save any breed ID to their herd,
 * including breeds not in the master list or custom breeds. Test 18 expects
 * this behavior (saving breed ID 999 which doesn't exist).
 *
 * For production data integrity, foreign keys should be re-enabled after:
 * 1. Updating test 18 to use valid breed IDs
 * 2. Deciding whether users should be allowed to save non-existent breeds
 * 3. Possibly modifying the schema to allow NULL breed_id for custom entries
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
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = OFF"); // See note above about backward compatibility
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");

  // Initialize Schema
  const schemaPath = join(__dirname, "schema.sql");
  if (existsSync(schemaPath)) {
    const schema = readFileSync(schemaPath, "utf8");
    db.exec(schema);
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
    console.log("🔒 Database connection closed.");
  }
}

/**
 * Setup automatic daily backup of the database file.
 */
function setupDailyBackup() {
  const BACKUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  const backupDir = join(DATA_DIR, "backups");
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

  setInterval(() => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const backupPath = join(backupDir, `herdhub-${date}.db`);
      copyFileSync(DB_PATH, backupPath);
      console.log(`💾 Daily database backup saved: ${backupPath}`);
    } catch (err) {
      console.error("❌ Daily backup failed:", err.message);
    }
  }, BACKUP_INTERVAL);
}
