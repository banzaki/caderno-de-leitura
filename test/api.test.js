// End-to-end test of the API against a real server and a temporary database.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

test("static files and path traversal", async () => {
  const pdfjs = await fetch(`${base}/vendor/pdfjs/pdf.min.mjs`);
  assert.equal(pdfjs.status, 200);
  const sneaky = await fetch(`${base}/vendor/pdfjs/..%2F..%2F..%2Fpackage.json`);
  assert.equal(sneaky.status, 404);
  assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
});
