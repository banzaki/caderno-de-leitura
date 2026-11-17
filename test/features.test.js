// Finish date, notes export, and reordering the queue.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

import { dailyBackup } from "../src/backup.js";
import { startApp } from "./helpers.js";

let t;
before(async () => { t = await startApp(); });
after(() => t.stop());

test("the finish date can be corrected, but not set in the future or on an unfinished book", async () => {
  const { id } = (await t.api("POST", "/api/books", { title: "Done Book", status: "finished", finished_on: "2026-11-10" })).data;
  assert.equal((await t.api("GET", `/api/books/${id}`)).data.finished_at, "2026-11-10");

  const fixed = await t.api("PATCH", `/api/books/${id}`, { finished_at: "2026-10-02" });
  assert.equal(fixed.data.finished_at, "2026-10-02");
  assert.equal((await t.api("PATCH", `/api/books/${id}`, { finished_at: "2999-01-01" })).status, 400);
  assert.equal((await t.api("PATCH", `/api/books/${id}`, { finished_at: "nonsense" })).status, 400);

  // Sending a day for a book that is not finished changes nothing.
  const reading = (await t.api("POST", "/api/books", { title: "Not Done", status: "reading" })).data;
  const same = await t.api("PATCH", `/api/books/${reading.id}`, { finished_at: "2026-10-02" });
  assert.equal(same.data.finished_at, null);
});

test("exporting a book's notes gives a Markdown file with the quote, the note and the page", async () => {
  const { id } = (await t.api("POST", "/api/books", { title: "Meditações: Livro Único!", author: "Marcus Aurelius", total_pages: 200 })).data;
  await t.api("POST", "/api/notes", { book_id: id, page: 17, page_kind: "pdf", quote: "You have power over your mind.", body: "Remember this." });
  await t.api("POST", "/api/notes", { book_id: id, body: "A note without a page" });
  const res = await t.api("GET", `/api/books/${id}/export`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /^attachment; filename="[A-Za-z0-9-]+-notes\.md"$/);
  assert.match(res.data, /^# Meditações: Livro Único!/);
  assert.match(res.data, /\*Marcus Aurelius\*/);
  assert.match(res.data, /### p\. 17\n\n> You have power over your mind\.\n\nRemember this\./);
  assert.match(res.data, /## Notes \(2\)/);
  assert.equal((await t.api("GET", "/api/books/9999/export")).status, 404);
});

test("reordering the queue: moves a book to a place, keeps 1..n with no gaps, rejects the wrong books", async () => {
  const ids = [];
  for (const title of ["Q-A", "Q-B", "Q-C", "Q-D"]) ids.push((await t.api("POST", "/api/books", { title, status: "queued" })).data.id);
  const count = (await t.api("GET", "/api/queue")).data.length;

  // The last book goes to the first place.
  await t.api("POST", `/api/books/${ids[3]}/queue-move`, { to: 1 });
  const moved = (await t.api("GET", "/api/queue")).data;
  assert.equal(moved[0].title, "Q-D");
  assert.deepEqual(moved.map((b) => b.queue_position), moved.map((_, i) => i + 1));
  assert.equal(moved.length, count);

  // A place past the end puts it last.
  await t.api("POST", `/api/books/${ids[3]}/queue-move`, { to: 9999 });
  const last = (await t.api("GET", "/api/queue")).data;
  assert.equal(last.at(-1).title, "Q-D");
  assert.deepEqual(last.map((b) => b.queue_position), last.map((_, i) => i + 1));

  const notQueued = (await t.api("POST", "/api/books", { title: "Reading one", status: "reading" })).data;
  assert.equal((await t.api("POST", `/api/books/${notQueued.id}/queue-move`, { to: 1 })).status, 400);
  assert.equal((await t.api("POST", `/api/books/${ids[0]}/queue-move`, { to: 0 })).status, 400);
});

test("trash: restore puts a queued book back in its place, a desk book at the end of the desk", async () => {
  const q = [];
  for (const title of ["T-1", "T-2", "T-3"]) q.push((await t.api("POST", "/api/books", { title, status: "queued" })).data);
  const queue = async () => (await t.api("GET", "/api/queue")).data.filter((b) => b.title.startsWith("T-"));
  const startPos = q[1].queue_position;

  await t.api("DELETE", `/api/books/${q[1].id}`);
  assert.deepEqual((await queue()).map((b) => b.title), ["T-1", "T-3"]);
  const all = (await t.api("GET", "/api/queue")).data;
  assert.deepEqual(all.map((b) => b.queue_position), all.map((_, i) => i + 1), "no gap in the queue");
  const trash = (await t.api("GET", "/api/trash")).data;
  assert.equal(trash.find((b) => b.id === q[1].id).days_left, 30);

  const back = await t.api("POST", `/api/books/${q[1].id}/restore`);
  assert.equal(back.status, 200);
  assert.equal(back.data.queue_position, startPos);
  assert.deepEqual((await queue()).map((b) => b.title), ["T-1", "T-2", "T-3"]);
  assert.equal((await t.api("POST", `/api/books/${q[1].id}/restore`)).status, 404, "not in the trash any more");

  const reading = (await t.api("POST", "/api/books", { title: "T-reading", status: "reading" })).data;
  await t.api("DELETE", `/api/books/${reading.id}`);
  const restored = (await t.api("POST", `/api/books/${reading.id}/restore`)).data;
  assert.equal(restored.status, "reading");
  assert.ok(restored.desk_position >= 1);
});

test("trash: books older than 30 days are erased, newer ones stay", async () => {
  const old = (await t.api("POST", "/api/books", { title: "Old trash" })).data.id;
  const recent = (await t.api("POST", "/api/books", { title: "Recent trash" })).data.id;
  await t.api("DELETE", `/api/books/${old}`);
  await t.api("DELETE", `/api/books/${recent}`);
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  t.app.db.prepare("UPDATE books SET deleted_at = ? WHERE id = ?").run(daysAgo(31), old);
  t.app.db.prepare("UPDATE books SET deleted_at = ? WHERE id = ?").run(daysAgo(29), recent);
  const ids = (await t.api("GET", "/api/trash")).data.map((b) => b.id);
  assert.ok(!ids.includes(old));
  assert.ok(ids.includes(recent));
  assert.equal(t.app.db.prepare("SELECT COUNT(*) AS n FROM books WHERE id = ?").get(old).n, 0);
});

test("daily backup: one copy per day, a readable copy, only the latest 14 kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "caderno-backup-"));
  const db = new DatabaseSync(join(dir, "caderno.db"));
  try {
    db.exec("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (7)");
    const first = dailyBackup(db, dir, new Date(2026, 10, 1, 9, 0));
    assert.match(first, /caderno-daily-20261101\.db$/);
    assert.equal(dailyBackup(db, dir, new Date(2026, 10, 1, 21, 0)), null, "same day: no second copy");

    const copy = new DatabaseSync(first, { readOnly: true });
    assert.equal(copy.prepare("SELECT n FROM t").get().n, 7);
    copy.close();

    for (let day = 2; day <= 20; day++) dailyBackup(db, dir, new Date(2026, 10, day, 9, 0));
    const kept = readdirSync(join(dir, "backups")).sort();
    assert.equal(kept.length, 14);
    assert.equal(kept[0], "caderno-daily-20261107.db");
    assert.equal(kept.at(-1), "caderno-daily-20261120.db");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
