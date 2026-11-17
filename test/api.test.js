// End-to-end test of the API against a real server and a temporary database.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { createApp } from "../src/app.js";

let base;
let app;
let dataDir;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "caderno-test-"));
  app = createApp({ dataDir });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(() => {
  app.server.close();
  app.db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function api(method, path, body, headers = {}) {
  const isRaw = body instanceof Uint8Array;
  const res = await fetch(base + path, {
    method,
    headers: isRaw ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, data: type.includes("json") ? await res.json() : await res.arrayBuffer() };
}

test("full flow: book, sessions, stats, notes, file", async () => {
  const created = await api("POST", "/api/books", { title: "Meditations", author: "Marcus Aurelius", total_pages: 200 });
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal(created.data.status, "reading");

  assert.equal((await api("POST", "/api/books", { title: "  " })).status, 400);
  assert.equal((await api("PATCH", `/api/books/${id}`, { status: "lost" })).status, 400);

  // Two sessions on the same day add up; one the day before.
  assert.equal((await api("POST", "/api/sessions", { book_id: id, date: "2026-11-12", from_page: 1, to_page: 10 })).status, 201);
  const s2 = await api("POST", "/api/sessions", { book_id: id, date: "2026-11-12", from_page: 11, to_page: 26 });
  assert.equal(s2.data.pages, 16);
  await api("POST", "/api/sessions", { book_id: id, date: "2026-11-11", from_page: 1, to_page: 25 });
  const bad = await api("POST", "/api/sessions", { book_id: id, date: "2026-11-12", from_page: 190, to_page: 220 });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /only 200/);

  const stats = await api("GET", "/api/stats?today=2026-11-12");
  assert.equal(stats.data.today.pages, 26);
  assert.equal(stats.data.goal, 25);
  assert.equal(stats.data.streak, 2);
  assert.equal(stats.data.last7.length, 7);

  // Notes: manual with page, highlight with percent.
  const n1 = await api("POST", "/api/notes", { book_id: id, page: 17, body: "The obstacle is the way." });
  assert.equal(n1.status, 201);
  assert.equal(n1.data.page_kind, "manual");
  const n2 = await api("POST", "/api/notes", {
    book_id: id, percent: 34.5, quote: "highlighted text", source: "highlight", location: { cfi: "epubcfi(/6/4)" },
  });
  assert.equal(n2.data.source, "highlight");
  assert.equal(JSON.parse(n2.data.location).cfi, "epubcfi(/6/4)");
  assert.equal((await api("POST", "/api/notes", { book_id: id })).status, 400);
  await api("PATCH", `/api/notes/${n1.data.id}`, { body: "edited" });

  const book = await api("GET", `/api/books/${id}`);
  assert.equal(book.data.current_page, 26);
  assert.equal(book.data.notes.length, 2);
  assert.equal(book.data.notes[0].body, "edited");
  assert.equal(book.data.sessions.length, 3);

  // File upload and download.
  const pdfBytes = new TextEncoder().encode("%PDF-1.4 fake");
  const up = await api("PUT", `/api/books/${id}/file`, pdfBytes, { "X-File-Name": encodeURIComponent("Meditações.pdf") });
  assert.equal(up.status, 200);
  assert.equal(up.data.file_type, "pdf");
  assert.equal(up.data.file_name, "Meditações.pdf");
  const down = await api("GET", `/api/books/${id}/file`);
  assert.equal(Buffer.from(down.data).toString(), "%PDF-1.4 fake");
  const txt = await api("PUT", `/api/books/${id}/file`, pdfBytes, { "X-File-Name": "notes.txt" });
  assert.equal(txt.status, 400);

  assert.equal((await api("DELETE", `/api/notes/${n2.data.id}`)).status, 200);
  assert.equal((await api("DELETE", `/api/sessions/${s2.data.id}`)).status, 200);
  assert.equal((await api("GET", "/api/stats?today=2026-11-12")).data.today.pages, 10);
});

test("deleting a book removes its sessions, notes and file, and nothing else", async () => {
  const keep = (await api("POST", "/api/books", { title: "Keep me" })).data.id;
  const gone = (await api("POST", "/api/books", { title: "Added by mistake", total_pages: 50 })).data.id;
  await api("POST", "/api/sessions", { book_id: keep, date: "2026-11-10", from_page: 1, to_page: 5 });
  await api("POST", "/api/sessions", { book_id: gone, date: "2026-11-10", from_page: 1, to_page: 30 });
  await api("POST", "/api/notes", { book_id: keep, body: "kept" });
  await api("POST", "/api/notes", { book_id: gone, body: "goes away" });
  const pdf = new TextEncoder().encode("%PDF-1.4 fake");
  await api("PUT", `/api/books/${gone}/file`, pdf, { "X-File-Name": "mistake.pdf" });
  assert.ok(existsSync(join(dataDir, "books", `${gone}.pdf`)));

  assert.equal((await api("DELETE", `/api/books/${gone}`)).status, 200);
  assert.equal((await api("GET", `/api/books/${gone}`)).status, 404);
  assert.equal((await api("DELETE", `/api/books/${gone}`)).status, 404);
  assert.ok(!existsSync(join(dataDir, "books", `${gone}.pdf`)));

  const notes = (await api("GET", "/api/notes")).data;
  assert.ok(notes.some((n) => n.body === "kept"));
  assert.ok(!notes.some((n) => n.body === "goes away"));
  const stats = (await api("GET", "/api/stats?today=2026-11-12")).data;
  assert.equal(stats.totals["2026-11-10"], 5);
  assert.equal((await api("GET", `/api/books/${keep}`)).data.sessions.length, 1);
});

test("EPUB notes can use pages counted by the app, and the notes list says which books can open", async () => {
  const id = (await api("POST", "/api/books", { title: "Counted pages" })).data.id;
  const note = await api("POST", "/api/notes", {
    book_id: id, page: 37, page_kind: "computed", percent: 19.6, body: "x",
    location: { type: "epub-pos", cfi: "epubcfi(/6/8!/4/2/1:0)" },
  });
  assert.equal(note.status, 201);
  assert.equal(note.data.page_kind, "computed");
  assert.equal(note.data.page, 37);

  const before = (await api("GET", "/api/notes")).data.find((n) => n.id === note.data.id);
  assert.equal(before.file_type, null);
  await api("PUT", `/api/books/${id}/file`, new TextEncoder().encode("PK fake"), { "X-File-Name": "book.epub" });
  const after = (await api("GET", "/api/notes")).data.find((n) => n.id === note.data.id);
  assert.equal(after.file_type, "epub");
});

test("queue: import without duplicates, keep order, start reading closes the gap", async () => {
  await api("POST", "/api/books", { title: "How to Read a Book", author: "Mortimer J. Adler, Charles Van Doren" });
  const text = [
    "[ ] 1. Como Ler Livros — Mortimer J. Adler e Charles Van Doren",
    "[ ] 2. Meditações — Marco Aurélio",
    "[ ] 3. A Morte de Ivan Ilitch — Liev Tolstói",
    "[ ] 4. Guerra e Paz — Liev Tolstói",
    "[x] 5. Already read — Someone",
    "not a book line",
  ].join("\n");
  const first = await api("POST", "/api/queue/import", { text });
  assert.equal(first.status, 200);
  assert.equal(first.data.added, 3); // Tolstoy twice is fine: different titles
  assert.deepEqual(first.data.skipped.map((s) => [s.number, s.reason]), [[1, "same authors"], [5, "checked as read in the file"]]);
  assert.equal(first.data.invalid.length, 1);

  let queue = (await api("GET", "/api/queue")).data;
  assert.deepEqual(queue.map((b) => [b.queue_position, b.title]), [[1, "Meditações"], [2, "A Morte de Ivan Ilitch"], [3, "Guerra e Paz"]]);

  // Importing the same file again adds nothing.
  const again = await api("POST", "/api/queue/import", { text });
  assert.equal(again.data.added, 0);
  assert.equal((await api("GET", "/api/queue")).data.length, 3);

  // "Start reading" on the first one: it leaves the queue and the others move up.
  const started = await api("PATCH", `/api/books/${queue[0].id}`, { status: "reading" });
  assert.equal(started.data.status, "reading");
  assert.equal(started.data.queue_position, null);
  queue = (await api("GET", "/api/queue")).data;
  assert.deepEqual(queue.map((b) => [b.queue_position, b.title]), [[1, "A Morte de Ivan Ilitch"], [2, "Guerra e Paz"]]);

  // A new queued book goes to the end; deleting one closes the gap.
  const added = await api("POST", "/api/books", { title: "Sidarta", status: "queued" });
  assert.equal(added.data.queue_position, 3);
  await api("DELETE", `/api/books/${queue[0].id}`);
  queue = (await api("GET", "/api/queue")).data;
  assert.deepEqual(queue.map((b) => [b.queue_position, b.title]), [[1, "Guerra e Paz"], [2, "Sidarta"]]);

  assert.equal((await api("POST", "/api/queue/import", { text: "nothing here" })).status, 400);
});

test("reading desk: main book, moving, pausing, finishing to the library, reading again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "caderno-desk-"));
  const desk = createApp({ dataDir: dir });
  await new Promise((r) => desk.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${desk.server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(url + path, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const order = async () => (await call("GET", "/api/books")).data
    .filter((b) => b.desk_position !== null).map((b) => `${b.desk_position}:${b.title}:${b.status}`);
  try {
    const a = (await call("POST", "/api/books", { title: "A" })).data;
    const b = (await call("POST", "/api/books", { title: "B" })).data;
    const c = (await call("POST", "/api/books", { title: "C", total_pages: 30 })).data;
    assert.deepEqual(await order(), ["1:A:reading", "2:B:reading", "3:C:reading"]);

    // "Make main" puts C first; the others keep their order.
    assert.equal((await call("POST", `/api/books/${c.id}/move`, { to: 1 })).data.desk_position, 1);
    assert.deepEqual(await order(), ["1:C:reading", "2:A:reading", "3:B:reading"]);
    await call("POST", `/api/books/${b.id}/move`, { to: 2 });
    assert.deepEqual(await order(), ["1:C:reading", "2:B:reading", "3:A:reading"]);

    // Pausing keeps the book on the desk, after the books being read.
    await call("PATCH", `/api/books/${b.id}`, { status: "paused" });
    assert.deepEqual(await order(), ["1:C:reading", "2:A:reading", "3:B:paused"]);
    assert.equal((await call("POST", `/api/books/${b.id}/move`, { to: 1 })).status, 400); // only books being read move

    // Logging the last page, then finishing: the book leaves the desk for the library.
    assert.equal((await call("POST", "/api/sessions", { book_id: c.id, date: "2026-11-17", from_page: 1, to_page: 30 })).status, 201);
    const done = (await call("PATCH", `/api/books/${c.id}`, { status: "finished", finished_on: "2026-11-17" })).data;
    assert.equal(done.finished_at, "2026-11-17");
    assert.equal(done.desk_position, null);
    assert.deepEqual(await order(), ["1:A:reading", "2:B:paused"]);
    // Saving other details keeps the finish day.
    assert.equal((await call("PATCH", `/api/books/${c.id}`, { author: "Someone" })).data.finished_at, "2026-11-17");

    // Reading it again brings it back to the end of the books being read, and forgets the day.
    const again = (await call("PATCH", `/api/books/${c.id}`, { status: "reading" })).data;
    assert.equal(again.finished_at, null);
    assert.deepEqual(await order(), ["1:A:reading", "2:C:reading", "3:B:paused"]);

    // A book added as finished goes straight to the library with today's date.
    const old = (await call("POST", "/api/books", { title: "Old", status: "finished" })).data;
    assert.match(old.finished_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(old.desk_position, null);

    // Deleting a desk book closes the gap.
    await call("DELETE", `/api/books/${a.id}`);
    assert.deepEqual(await order(), ["1:C:reading", "2:B:paused"]);
  } finally {
    desk.server.close();
    desk.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("back to queue: a book started from the queue returns to its own place", async () => {
  const dir = mkdtempSync(join(tmpdir(), "caderno-back-"));
  const app2 = createApp({ dataDir: dir });
  await new Promise((r) => app2.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${app2.server.address().port}`;
  const call = async (method, path, body) => (await fetch(url + path, {
    method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body),
  })).json();
  const queue = async () => (await call("GET", "/api/queue")).map((b) => `${b.queue_position}:${b.title}`);
  try {
    await call("POST", "/api/queue/import", { text: "[ ] 1. One\n[ ] 2. Two\n[ ] 3. Three\n[ ] 4. Four" });
    const two = (await call("GET", "/api/queue"))[1];

    // Start reading "Two": it leaves the queue and remembers place 2.
    const started = await call("PATCH", `/api/books/${two.id}`, { status: "reading" });
    assert.equal(started.queue_left_position, 2);
    assert.deepEqual(await queue(), ["1:One", "2:Three", "3:Four"]);

    // Back to queue: exactly where it was, the others move down.
    const back = await call("PATCH", `/api/books/${two.id}`, { status: "queued" });
    assert.equal(back.queue_position, 2);
    assert.equal(back.queue_left_position, null);
    assert.equal(back.desk_position, null);
    assert.deepEqual(await queue(), ["1:One", "2:Two", "3:Three", "4:Four"]);

    // A remembered place past the end of a shorter queue becomes the end.
    const four = (await call("GET", "/api/queue"))[3];
    await call("PATCH", `/api/books/${four.id}`, { status: "reading" });
    const one = (await call("GET", "/api/queue"))[0];
    await call("DELETE", `/api/books/${one.id}`);
    await call("PATCH", `/api/books/${four.id}`, { status: "queued" });
    assert.deepEqual(await queue(), ["1:Two", "2:Three", "3:Four"]);

    // A book that was never in the queue goes to the end.
    const fresh = await call("POST", "/api/books", { title: "Fresh" });
    await call("PATCH", `/api/books/${fresh.id}`, { status: "queued" });
    assert.deepEqual(await queue(), ["1:Two", "2:Three", "3:Four", "4:Fresh"]);
  } finally {
    app2.server.close();
    app2.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// Bruno's real queue file, when it is on this computer (read only, imported into the temporary test database).
const REAL_QUEUE = "C:/Users/qbbru/Documents/Leitura/fila-de-leitura.txt";
test("the real queue file imports all 307 books, in order, only once", { skip: !existsSync(REAL_QUEUE) && "real queue file not on this computer" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "caderno-real-queue-"));
  const real = createApp({ dataDir: dir });
  await new Promise((r) => real.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${real.server.address().port}`;
  const post = async (path, body) => (await fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  try {
    const text = readFileSync(REAL_QUEUE, "utf8");
    const result = await post("/api/queue/import", { text });
    assert.equal(result.added, 307);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.invalid, []);
    const queue = await (await fetch(`${url}/api/queue`)).json();
    assert.equal(queue.length, 307);
    assert.deepEqual(queue.map((b) => b.queue_position), Array.from({ length: 307 }, (_, i) => i + 1));
    assert.equal(queue[0].title, "Como Ler Livros");
    assert.equal(queue[306].title, "Biografia de Einstein");
    assert.equal((await post("/api/queue/import", { text })).added, 0);
  } finally {
    real.server.close();
    real.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("static files and path traversal", async () => {
  const pdfjs = await fetch(`${base}/vendor/pdfjs/pdf.min.mjs`);
  assert.equal(pdfjs.status, 200);
  const sneaky = await fetch(`${base}/vendor/pdfjs/..%2F..%2F..%2Fpackage.json`);
  assert.equal(sneaky.status, 404);
  assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
});
