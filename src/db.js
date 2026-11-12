// Database layer: one SQLite file, using Node's built-in node:sqlite.
import { DatabaseSync } from "node:sqlite";

export const BOOK_STATUSES = ["reading", "finished", "paused"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  total_pages INTEGER,
  status TEXT NOT NULL DEFAULT 'reading' CHECK (status IN ('reading', 'finished', 'paused')),
  file_name TEXT,
  file_type TEXT CHECK (file_type IN ('pdf', 'epub')),
  last_location TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
--   page (with page_kind 'pdf', 'print' or 'manual'), or
--   percent (EPUB without print page numbers), or neither.
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

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  // Default journal mode keeps everything in one file, so a backup is a plain copy.
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}
