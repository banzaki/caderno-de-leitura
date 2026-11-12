// End-to-end test of the API against a real server and a temporary database.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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

test("static files and path traversal", async () => {
  const pdfjs = await fetch(`${base}/vendor/pdfjs/pdf.min.mjs`);
  assert.equal(pdfjs.status, 200);
  const sneaky = await fetch(`${base}/vendor/pdfjs/..%2F..%2F..%2Fpackage.json`);
  assert.equal(sneaky.status, 404);
  assert.equal((await fetch(`${base}/api/nothing`)).status, 404);
});
