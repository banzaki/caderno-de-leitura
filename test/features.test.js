// Finish date, notes export, and reordering the queue.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

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
