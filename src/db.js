// Database layer: one SQLite file, using Node's built-in node:sqlite.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const BOOK_STATUSES = ["reading", "queued", "paused", "finished"];

// Bump when the schema changes, and add the step to MIGRATIONS.
const SCHEMA_VERSION = 1;

const BOOKS_TABLE = `
CREATE TABLE books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  total_pages INTEGER,
  status TEXT NOT NULL DEFAULT 'reading' CHECK (status IN ('reading', 'queued', 'paused', 'finished')),
  queue_position INTEGER,
  file_name TEXT,
  file_type TEXT CHECK (file_type IN ('pdf', 'epub')),
  last_location TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const SCHEMA = `
${BOOKS_TABLE.replace("CREATE TABLE books", "CREATE TABLE IF NOT EXISTS books")};

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id),
  date TEXT NOT NULL,
  from_page INTEGER NOT NULL,
  to_page INTEGER NOT NULL,
  pages INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sessions_date ON sessions(date);

-- A note points to a page in one of three ways:
--   page (with page_kind 'pdf', 'print', 'computed' or 'manual'), or
--   percent (older EPUB notes), or neither.
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id),
  page INTEGER,
  page_kind TEXT,
  percent REAL,
  quote TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  location TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'highlight')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS notes_book ON notes(book_id);
`;

// Each step upgrades the database from version (index) to version (index + 1).
const MIGRATIONS = [
  // 0 -> 1: the "queued" status and the queue position. SQLite cannot change a CHECK
  // rule in place, so the books table is rebuilt and every row copied as it was.
  (db) => {
    db.exec(BOOKS_TABLE.replace("CREATE TABLE books", "CREATE TABLE books_new"));
    db.exec(`INSERT INTO books_new (id, title, author, total_pages, status, file_name, file_type, last_location, created_at)
      SELECT id, title, author, total_pages, status, file_name, file_type, last_location, created_at FROM books`);
    db.exec("DROP TABLE books");
    db.exec("ALTER TABLE books_new RENAME TO books");
  },
];

// Local date and time for file names: 20261117-180500.
function timestamp(d = new Date()) {
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  const hasBooks = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'books'").get();
  let version = db.prepare("PRAGMA user_version").get().user_version;

  if (!hasBooks) {
    // A new, empty database: create the current schema directly.
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  } else if (version < SCHEMA_VERSION) {
    // Copy the database before changing it, so nothing can be lost.
    const backupDir = join(dirname(path), "backups");
    mkdirSync(backupDir, { recursive: true });
    const backup = join(backupDir, `caderno-${timestamp()}-before-migration-${SCHEMA_VERSION}.db`);
    db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);

    // Foreign keys must be off while the books table is rebuilt (SQLite's documented way).
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      for (; version < SCHEMA_VERSION; version++) MIGRATIONS[version](db);
      const broken = db.prepare("PRAGMA foreign_key_check").all();
      if (broken.length) throw new Error(`Migration would break ${broken.length} links between tables.`);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      db.close();
      throw new Error(`Database upgrade failed, nothing was changed (backup: ${backup}): ${err.message}`);
    }
  }

  // Default journal mode keeps everything in one file, so a backup is a plain copy.
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA); // creates indexes and any missing table; never touches existing rows
  return db;
}
