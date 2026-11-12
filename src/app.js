// HTTP server: JSON API under /api, static files for the UI, and the
// reader libraries served from node_modules. Uses only Node's built-in modules.
import { createServer } from "node:http";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { BOOK_STATUSES, openDatabase } from "./db.js";
import { DAILY_GOAL, addDays, computeStreak, isValidDate, pagesBetween, validateSession } from "./stats.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_BOOK_BYTES = 300 * 1024 * 1024;

const STATIC_DIRS = {
  "/vendor/pdfjs/": join(ROOT, "node_modules", "pdfjs-dist", "build"),
  "/vendor/pdfjs-web/": join(ROOT, "node_modules", "pdfjs-dist", "web"),
  "/vendor/epubjs/": join(ROOT, "node_modules", "epubjs", "dist"),
  "/vendor/jszip/": join(ROOT, "node_modules", "jszip", "dist"),
  "/": join(ROOT, "public"),
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

function toInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : Number.NaN;
}

function cleanText(value, max = 20000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function serveFile(res, filePath, contentType) {
  res.writeHead(200, {
    "Content-Type": contentType ?? MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": statSync(filePath).size,
    "Cache-Control": "no-cache",
  });
  createReadStream(filePath).pipe(res);
}

function serveStatic(pathname, res) {
  for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
    if (!pathname.startsWith(prefix)) continue;
    let rel = decodeURIComponent(pathname.slice(prefix.length));
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const filePath = resolve(dir, rel);
    // Never serve anything outside the allowed folder.
    if (!filePath.startsWith(dir + sep)) return false;
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
    serveFile(res, filePath);
    return true;
  }
  return false;
}

export function createApp({ dataDir }) {
  const booksDir = join(dataDir, "books");
  mkdirSync(booksDir, { recursive: true });
  const db = openDatabase(join(dataDir, "caderno.db"));

  const q = {
    listBooks: db.prepare(`
      SELECT b.*,
        COALESCE((SELECT MAX(to_page) FROM sessions s WHERE s.book_id = b.id), 0) AS current_page,
        (SELECT COUNT(*) FROM notes n WHERE n.book_id = b.id) AS note_count
      FROM books b
      ORDER BY CASE b.status WHEN 'reading' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, b.title COLLATE NOCASE`),
    getBook: db.prepare(`
      SELECT b.*,
        COALESCE((SELECT MAX(to_page) FROM sessions s WHERE s.book_id = b.id), 0) AS current_page,
        (SELECT COUNT(*) FROM notes n WHERE n.book_id = b.id) AS note_count
      FROM books b WHERE b.id = ?`),
    insertBook: db.prepare(
      "INSERT INTO books (title, author, total_pages, status) VALUES (?, ?, ?, ?) RETURNING id",
    ),
    sessionsForBook: db.prepare("SELECT * FROM sessions WHERE book_id = ? ORDER BY date DESC, id DESC"),
    recentSessions: db.prepare(`
      SELECT s.*, b.title FROM sessions s JOIN books b ON b.id = s.book_id
      ORDER BY s.date DESC, s.id DESC LIMIT ?`),
    insertSession: db.prepare(
      "INSERT INTO sessions (book_id, date, from_page, to_page, pages) VALUES (?, ?, ?, ?, ?) RETURNING id",
    ),
    getSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    dailyTotals: db.prepare("SELECT date, SUM(pages) AS pages FROM sessions GROUP BY date"),
    notesForBook: db.prepare(
      "SELECT * FROM notes WHERE book_id = ? ORDER BY page IS NULL, page, percent, created_at",
    ),
    allNotes: db.prepare(`
      SELECT n.*, b.title FROM notes n JOIN books b ON b.id = n.book_id
      ORDER BY n.created_at DESC LIMIT 500`),
    insertNote: db.prepare(`
      INSERT INTO notes (book_id, page, page_kind, percent, quote, body, location, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`),
    getNote: db.prepare("SELECT * FROM notes WHERE id = ?"),
    updateNoteBody: db.prepare("UPDATE notes SET body = ? WHERE id = ?"),
    deleteNote: db.prepare("DELETE FROM notes WHERE id = ?"),
  };

  function requireBook(id) {
    const book = q.getBook.get(id);
    if (!book) throw new HttpError(404, "Book not found.");
    return book;
  }

  function parseBookFields(body, current = {}) {
    const title = body.title !== undefined ? cleanText(body.title, 300) : current.title;
    if (!title) throw new HttpError(400, "The book needs a title.");
    const author = body.author !== undefined ? cleanText(body.author, 300) : (current.author ?? "");
    const totalPages = body.total_pages !== undefined ? toInt(body.total_pages) : (current.total_pages ?? null);
    if (Number.isNaN(totalPages) || (totalPages !== null && totalPages < 1)) {
      throw new HttpError(400, "Total pages must be a whole number above 0.");
    }
    const status = body.status !== undefined ? body.status : (current.status ?? "reading");
    if (!BOOK_STATUSES.includes(status)) throw new HttpError(400, "Invalid status.");
    return { title, author, totalPages, status };
  }

  const routes = [
    ["GET", /^\/api\/books$/, () => q.listBooks.all()],

    ["POST", /^\/api\/books$/, async (req) => {
      const f = parseBookFields(await readJson(req));
      const { id } = q.insertBook.get(f.title, f.author, f.totalPages, f.status);
      return [201, q.getBook.get(id)];
    }],

    ["GET", /^\/api\/books\/(\d+)$/, (req, [id]) => {
      const book = requireBook(id);
      return { ...book, sessions: q.sessionsForBook.all(id), notes: q.notesForBook.all(id) };
    }],

    ["PATCH", /^\/api\/books\/(\d+)$/, async (req, [id]) => {
      const current = requireBook(id);
      const body = await readJson(req);
      const f = parseBookFields(body, current);
      const lastLocation = body.last_location !== undefined
        ? cleanText(String(body.last_location), 2000)
        : current.last_location;
      db.prepare("UPDATE books SET title = ?, author = ?, total_pages = ?, status = ?, last_location = ? WHERE id = ?")
        .run(f.title, f.author, f.totalPages, f.status, lastLocation, id);
      return q.getBook.get(id);
    }],

    ["PUT", /^\/api\/books\/(\d+)\/file$/, async (req, [id]) => {
      const book = requireBook(id);
      const name = decodeURIComponent(String(req.headers["x-file-name"] ?? ""));
      const ext = extname(name).toLowerCase();
      if (ext !== ".pdf" && ext !== ".epub") throw new HttpError(400, "Only PDF and EPUB files are supported.");
      const length = Number(req.headers["content-length"] ?? 0);
      if (length > MAX_BOOK_BYTES) throw new HttpError(413, "File too large (300 MB max).");
      const target = join(booksDir, `${id}${ext}`);
      const temp = `${target}.part`;
      await pipeline(req, createWriteStream(temp));
      // Replace an older file of the other type, if any.
      for (const old of [".pdf", ".epub"]) {
        const oldPath = join(booksDir, `${id}${old}`);
        if (existsSync(oldPath)) unlinkSync(oldPath);
      }
      renameSync(temp, target);
      db.prepare("UPDATE books SET file_name = ?, file_type = ?, last_location = NULL WHERE id = ?")
        .run(cleanText(name, 300), ext.slice(1), book.id);
      return q.getBook.get(id);
    }],

    ["GET", /^\/api\/books\/(\d+)\/file$/, (req, [id], res) => {
      const book = requireBook(id);
      const filePath = book.file_type ? join(booksDir, `${id}.${book.file_type}`) : null;
      if (!filePath || !existsSync(filePath)) throw new HttpError(404, "This book has no file.");
      serveFile(res, filePath, MIME[`.${book.file_type}`]);
      return undefined;
    }],

    ["GET", /^\/api\/sessions$/, () => q.recentSessions.all(30)],

    ["POST", /^\/api\/sessions$/, async (req) => {
      const body = await readJson(req);
      const book = requireBook(toInt(body.book_id));
      const fromPage = toInt(body.from_page);
      const toPage = toInt(body.to_page);
      const error = validateSession({ fromPage, toPage, date: body.date }, book.total_pages);
      if (error) throw new HttpError(400, error);
      const pages = pagesBetween(fromPage, toPage);
      const { id } = q.insertSession.get(book.id, body.date, fromPage, toPage, pages);
      return [201, q.getSession.get(id)];
    }],

    ["DELETE", /^\/api\/sessions\/(\d+)$/, (req, [id]) => {
      if (!q.getSession.get(id)) throw new HttpError(404, "Session not found.");
      q.deleteSession.run(id);
      return { ok: true };
    }],

    ["GET", /^\/api\/stats$/, (req, params, res, url) => {
      const today = url.searchParams.get("today");
      if (!isValidDate(today)) throw new HttpError(400, "Send today's date as ?today=YYYY-MM-DD.");
      const totals = Object.fromEntries(q.dailyTotals.all().map((r) => [r.date, r.pages]));
      const last7 = [];
      for (let i = 6; i >= 0; i--) {
        const date = addDays(today, -i);
        last7.push({ date, pages: totals[date] ?? 0 });
      }
      return {
        goal: DAILY_GOAL,
        today: { date: today, pages: totals[today] ?? 0 },
        streak: computeStreak(totals, today),
        days_met: Object.values(totals).filter((p) => p >= DAILY_GOAL).length,
        last7,
        totals,
      };
    }],

    ["GET", /^\/api\/notes$/, () => q.allNotes.all()],

    ["POST", /^\/api\/notes$/, async (req) => {
      const body = await readJson(req);
      const book = requireBook(toInt(body.book_id));
      const page = toInt(body.page);
      if (Number.isNaN(page) || (page !== null && page < 1)) throw new HttpError(400, "Invalid page.");
      const percent = body.percent === null || body.percent === undefined ? null : Number(body.percent);
      if (percent !== null && !(percent >= 0 && percent <= 100)) throw new HttpError(400, "Invalid percent.");
      const pageKind = ["pdf", "print", "manual"].includes(body.page_kind) ? body.page_kind : (page ? "manual" : null);
      const source = body.source === "highlight" ? "highlight" : "manual";
      const quote = cleanText(body.quote);
      const text = cleanText(body.body);
      if (!quote && !text) throw new HttpError(400, "The note is empty.");
      const location = body.location ? JSON.stringify(body.location).slice(0, 20000) : null;
      const { id } = q.insertNote.get(book.id, page, pageKind, percent, quote, text, location, source);
      return [201, q.getNote.get(id)];
    }],

    ["PATCH", /^\/api\/notes\/(\d+)$/, async (req, [id]) => {
      if (!q.getNote.get(id)) throw new HttpError(404, "Note not found.");
      const body = await readJson(req);
      q.updateNoteBody.run(cleanText(body.body), id);
      return q.getNote.get(id);
    }],

    ["DELETE", /^\/api\/notes\/(\d+)$/, (req, [id]) => {
      if (!q.getNote.get(id)) throw new HttpError(404, "Note not found.");
      q.deleteNote.run(id);
      return { ok: true };
    }],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        for (const [method, pattern, handler] of routes) {
          const match = url.pathname.match(pattern);
          if (!match || req.method !== method) continue;
          const result = await handler(req, match.slice(1).map(Number), res, url);
          if (result === undefined) return; // handler already answered (file download)
          const [status, data] = Array.isArray(result) && typeof result[0] === "number" ? result : [200, result];
          return sendJson(res, status, data);
        }
        throw new HttpError(404, "Not found.");
      }
      if (req.method === "GET" && serveStatic(url.pathname, res)) return;
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: "Unexpected server error." });
    }
  }

  const server = createServer(handle);
  return { server, db };
}
