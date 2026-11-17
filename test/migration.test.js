// The upgrade of an existing database (made by an older version of the app)
// must keep every book, session and note, and back the file up first.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { openDatabase } from "../src/db.js";

// The schema exactly as version 0 of the app created it.
const OLD_SCHEMA = `
CREATE TABLE books (
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
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(id), date TEXT NOT NULL,
  from_page INTEGER NOT NULL, to_page INTEGER NOT NULL, pages INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX sessions_date ON sessions(date);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(id), page INTEGER, page_kind TEXT,
  percent REAL, quote TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', location TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'highlight')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX notes_book ON notes(book_id);`;

function makeOldDatabase(path) {
  const old = new DatabaseSync(path);
  old.exec(OLD_SCHEMA);
  old.exec(`
    INSERT INTO books (id, title, author, total_pages, status, file_name, file_type, last_location, created_at)
      VALUES (1, 'How to Read a Book', 'Mortimer J. Adler', 440, 'reading', 'how.pdf', 'pdf', '37', '2026-11-12 10:00:00'),
             (2, 'Meditations', 'Marcus Aurelius', 254, 'finished', NULL, NULL, NULL, '2026-11-10 09:00:00'),
             (5, 'The Republic', 'Plato', 416, 'paused', 'rep.epub', 'epub', 'epubcfi(/6/4)', '2026-11-11 08:00:00');
    INSERT INTO sessions (book_id, date, from_page, to_page, pages) VALUES (1, '2026-11-12', 1, 26, 26), (2, '2026-11-10', 1, 254, 254);
    INSERT INTO notes (book_id, page, page_kind, quote, body, source) VALUES (1, 17, 'pdf', 'a quote', 'a note', 'highlight'), (5, NULL, NULL, '', 'plain', 'manual');`);
  old.close();
}

// Opens a database and always closes it, even when a check fails (Windows cannot
// delete the folder of an open database, which would hide the real failure).
function withDatabase(path, check) {
  const db = openDatabase(path);
  try {
    check(db);
  } finally {
    db.close();
  }
}

test("upgrading an old database keeps every row, backs up first, and allows the queue and the desk", () => {
  const dir = mkdtempSync(join(tmpdir(), "caderno-migration-"));
  try {
    const path = join(dir, "caderno.db");
    makeOldDatabase(path);

    withDatabase(path, (db) => {
      const books = db.prepare(`SELECT id, title, author, total_pages, status, queue_position, desk_position, finished_at,
        file_name, file_type, last_location, created_at FROM books ORDER BY id`).all();
      assert.deepEqual(books.map((b) => ({ ...b })), [
        { id: 1, title: "How to Read a Book", author: "Mortimer J. Adler", total_pages: 440, status: "reading", queue_position: null, desk_position: 1, finished_at: null, file_name: "how.pdf", file_type: "pdf", last_location: "37", created_at: "2026-11-12 10:00:00" },
        { id: 2, title: "Meditations", author: "Marcus Aurelius", total_pages: 254, status: "finished", queue_position: null, desk_position: null, finished_at: "2026-11-10", file_name: null, file_type: null, last_location: null, created_at: "2026-11-10 09:00:00" },
        { id: 5, title: "The Republic", author: "Plato", total_pages: 416, status: "paused", queue_position: null, desk_position: 2, finished_at: null, file_name: "rep.epub", file_type: "epub", last_location: "epubcfi(/6/4)", created_at: "2026-11-11 08:00:00" },
      ]);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 2);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notes").get().n, 2);
      assert.equal(db.prepare("SELECT body FROM notes WHERE book_id = 1").get().body, "a note");
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");

      // The new status works, and links between tables are still enforced.
      db.prepare("INSERT INTO books (title, status, queue_position) VALUES ('Queued book', 'queued', 1)").run();
      assert.throws(() => db.prepare("INSERT INTO notes (book_id, body) VALUES (999, 'orphan')").run(), /FOREIGN KEY/);
      // New ids continue after the highest old id.
      assert.equal(db.prepare("SELECT MAX(id) AS id FROM books").get().id, 6);
    });

    // A backup of the old file was made, and it still holds the old data.
    const backups = readdirSync(join(dir, "backups"));
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^caderno-\d{8}-\d{6}-before-migration-3\.db$/);
    const backup = new DatabaseSync(join(dir, "backups", backups[0]), { readOnly: true });
    assert.equal(backup.prepare("SELECT COUNT(*) AS n FROM books").get().n, 3);
    assert.equal(backup.prepare("PRAGMA user_version").get().user_version, 0);
    backup.close();

    // Opening again does nothing more: no second migration, no second backup.
    openDatabase(path).close();
    assert.equal(readdirSync(join(dir, "backups")).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Bruno's database on 2026-11-17 was at version 1 (with the queue): it goes to version 2.
test("upgrading a version 1 database adds the desk order and finish days, and keeps the queue", () => {
  const dir = mkdtempSync(join(tmpdir(), "caderno-v1-"));
  try {
    const path = join(dir, "caderno.db");
    makeOldDatabase(path);
    // Make it version 1 the way version 1 of the app left it: the queue columns, no desk.
    const v1 = new DatabaseSync(path);
    v1.exec(`
      CREATE TABLE books_new (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', total_pages INTEGER,
        status TEXT NOT NULL DEFAULT 'reading' CHECK (status IN ('reading', 'queued', 'paused', 'finished')),
        queue_position INTEGER, file_name TEXT, file_type TEXT CHECK (file_type IN ('pdf', 'epub')),
        last_location TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO books_new (id, title, author, total_pages, status, file_name, file_type, last_location, created_at)
        SELECT id, title, author, total_pages, status, file_name, file_type, last_location, created_at FROM books;
      PRAGMA foreign_keys = OFF;
      DROP TABLE books;
      ALTER TABLE books_new RENAME TO books;
      INSERT INTO books (id, title, status, queue_position) VALUES (6, 'Sidarta', 'queued', 1), (7, 'Second reading', 'reading', NULL);
      PRAGMA user_version = 1;`);
    v1.close();

    withDatabase(path, (db) => {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
      const rows = db.prepare("SELECT id, status, queue_position, desk_position, finished_at FROM books ORDER BY id").all().map((r) => ({ ...r }));
      assert.deepEqual(rows, [
        { id: 1, status: "reading", queue_position: null, desk_position: 1, finished_at: null },
        { id: 2, status: "finished", queue_position: null, desk_position: null, finished_at: "2026-11-10" },
        { id: 5, status: "paused", queue_position: null, desk_position: 3, finished_at: null },
        { id: 6, status: "queued", queue_position: 1, desk_position: null, finished_at: null },
        { id: 7, status: "reading", queue_position: null, desk_position: 2, finished_at: null },
      ]);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 2);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notes").get().n, 2);
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    });
    assert.equal(readdirSync(join(dir, "backups")).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a brand-new database starts at the current version without a backup", () => {
  const dir = mkdtempSync(join(tmpdir(), "caderno-new-"));
  try {
    withDatabase(join(dir, "caderno.db"), (db) => {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
      db.prepare("INSERT INTO books (title, status, desk_position) VALUES ('x', 'reading', 1)").run();
    });
    assert.equal(existsSync(join(dir, "backups")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
