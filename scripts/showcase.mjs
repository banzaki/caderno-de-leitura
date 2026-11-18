// Takes the screenshots for docs/almanac.md.
//
// It never touches your real data: it starts the app on a temporary folder, fills it with
// an invented reading life (public-domain books), drives a headless Edge/Chrome through the
// Chrome DevTools Protocol, and saves PNG files into docs/screenshots/.
//
// Usage: node scripts/showcase.mjs [path-to-edge-or-chrome]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
const BROWSERS = [
  process.argv[2],
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean);
const browserPath = BROWSERS.find((p) => existsSync(p));
if (!browserPath) throw new Error("No Edge or Chrome found. Pass its path as the first argument.");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const two = (n) => String(n).padStart(2, "0");
const dayOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

// ------------------------------------------------------------------ the invented data
const work = mkdtempSync(join(tmpdir(), "caderno-showcase-"));
const dataDir = join(work, "data");
const samples = join(work, "samples");
await new Promise((resolveDone, reject) => {
  const p = spawn(process.execPath, [join(ROOT, "scripts", "make-sample-books.js"), samples], { stdio: "ignore" });
  p.on("exit", (code) => (code === 0 ? resolveDone() : reject(new Error("could not make the sample PDF"))));
});

const { server, db } = createApp({ dataDir });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

async function api(method, path, body, headers = {}) {
  const raw = body instanceof Uint8Array;
  const res = await fetch(base + path, {
    method,
    headers: raw ? headers : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error}`);
  return data;
}

// Logs `perDay` pages a day on `days` consecutive days, starting `startOffset` days from today.
async function readOver(bookId, startOffset, days, perDay, firstPage = 1) {
  let page = firstPage;
  for (let i = 0; i < days; i++) {
    await api("POST", "/api/sessions", { book_id: bookId, date: dayOffset(startOffset + i), from_page: page, to_page: page + perDay - 1 });
    page += perDay;
  }
  return page - 1;
}
async function addBook(fields) {
  return (await api("POST", "/api/books", fields)).id;
}

// Finished books, spread over the year.
const republic = await addBook({ title: "The Republic", author: "Plato", total_pages: 416, status: "reading" });
await readOver(republic, -80, 16, 26);
await api("PUT", `/api/books/${republic}/report`, {
  summary: "A dialogue about justice, the soul, and who should rule.",
  ideas: ["Justice is each part doing its own work.", "The unexamined institution decays.", "Education shapes the soul before argument can."],
  change: "I stopped treating arguments as contests. I now ask what a claim is for before I defend or attack it.",
  rating: 5, recommend: "Anyone who argues for a living, or for fun.",
});
await api("PATCH", `/api/books/${republic}`, { status: "finished", finished_on: dayOffset(-62) });

const pride = await addBook({ title: "Pride and Prejudice", author: "Jane Austen", total_pages: 279, status: "reading" });
await readOver(pride, -45, 9, 31);
await api("PUT", `/api/books/${pride}/report`, {
  summary: "Two proud people learn to see each other clearly.",
  ideas: ["First impressions are a hypothesis, not a verdict."],
  change: "I now wait for a second look before I decide about a person.", rating: 4, recommend: "Friends who like wit.",
});
await api("PATCH", `/api/books/${pride}`, { status: "finished", finished_on: dayOffset(-36) });

const seneca = await addBook({ title: "Letters from a Stoic", author: "Seneca", total_pages: 240, status: "reading" });
await readOver(seneca, -30, 8, 30);
await api("PATCH", `/api/books/${seneca}`, { status: "finished", finished_on: dayOffset(-22) }); // report still owed

// On the desk: the main book has a real PDF to read.
const meditations = await addBook({ title: "Meditations (excerpt)", author: "Marcus Aurelius", total_pages: 5, status: "reading" });
const pdf = readFileSync(join(samples, "sample.pdf"));
await api("PUT", `/api/books/${meditations}/file`, new Uint8Array(pdf), { "X-File-Name": "meditations.pdf" });
await readOver(meditations, -1, 1, 2);
await api("POST", "/api/notes", { book_id: meditations, page: 1, page_kind: "pdf", body: "Control what you can, accept the rest." });

const walden = await addBook({ title: "Walden", author: "Henry David Thoreau", total_pages: 312, status: "reading" });
await readOver(walden, -11, 12, 25); // the daily goal, a streak that ends today
for (const [page, quote, body] of [
  [38, "The mass of men lead lives of quiet desperation.", "Re-read when the week feels like autopilot."],
  [96, "Simplify, simplify.", "Fewer commitments, done better."],
  [141, "", "Walking is how I think. Schedule it, do not wait for free time."],
]) await api("POST", "/api/notes", { book_id: walden, page, page_kind: "manual", quote, body, source: quote ? "highlight" : "manual" });

const art = await addBook({ title: "The Art of War", author: "Sun Tzu", total_pages: 96, status: "paused" });
await readOver(art, -40, 2, 15);

for (const [title, author] of [
  ["Don Quixote", "Miguel de Cervantes"], ["Moby-Dick", "Herman Melville"], ["Crime and Punishment", "Fyodor Dostoevsky"],
  ["The Odyssey", "Homer"], ["Siddhartha", "Hermann Hesse"], ["Middlemarch", "George Eliot"], ["The Brothers Karamazov", "Fyodor Dostoevsky"],
  ["Leaves of Grass", "Walt Whitman"], ["Frankenstein", "Mary Shelley"], ["The Prince", "Niccolo Machiavelli"],
]) await addBook({ title, author, status: "queued" });

// ------------------------------------------------------------------ the browser
const debugPort = 9333;
const profile = join(work, "profile");
const browser = spawn(browserPath, [
  "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank",
], { stdio: "ignore" });

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("The browser did not start.");
}
const socket = new WebSocket(await connect());
await new Promise((r) => socket.addEventListener("open", r));
let nextId = 0;
const waiting = new Map();
socket.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && waiting.has(msg.id)) {
    const { resolve: ok, reject } = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message)); else ok(msg.result);
  }
});
const send = (method, params = {}) => new Promise((ok, reject) => {
  const id = ++nextId;
  waiting.set(id, { resolve: ok, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "script failed");
  return r.result.value;
};

mkdirSync(OUT, { recursive: true });
const made = [];

// view: { width, height, mobile, dark }; steps: JS to run after the page loads.
async function shot(name, path, { width = 1280, height = 800, mobile = false, dark = false, steps = "", wait = 1200 } = {}) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return; // handy while tuning one shot
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  await send("Page.navigate", { url: base + path });
  await sleep(wait);
  await run("localStorage.clear(); 0"); // the system setting decides the theme
  if (steps) {
    const result = await run(steps);
    if (result !== undefined) console.log(name, "->", result);
    await sleep(600);
  }
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  made.push(name);
  console.log("saved", name);
}

try {
  // 1. Today: the book being read, the goal, the streak, the calendar.
  await shot("01-today", "/#/", { height: 1050 });
  // 2. The reading desk and the library.
  await shot("02-books", "/#/books", { height: 1300 });
  // 3. The queue.
  await shot("03-queue", "/#/queue", { height: 900 });
  // 4. A book page: log pages, history, notes.
  await shot("04-book", `/#/book/${walden}`, { height: 1250 });
  // 5. The reader with a highlight that became a note.
  await shot("05-reader", `/reader.html?book=${meditations}`, {
    wait: 3000,
    steps: `(async () => {
      const span = [...document.querySelectorAll('.textLayer span')].find((s) => s.textContent.includes('power over your mind'));
      const range = document.createRange(); range.selectNodeContents(span);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const barShown = !document.getElementById('selection-bar').hidden;
      document.getElementById('hl-save').click();
      await new Promise((r) => setTimeout(r, 900));
      return JSON.stringify({ found: Boolean(span), barShown, highlights: document.querySelectorAll('.hl').length });
    })()`,
  });
  // 6. Closing a book: look back at the notes, pick the best, write the report.
  await shot("06-close", `/#/close/${walden}`, {
    height: 1500,
    steps: `(() => {
      const boxes = [...document.querySelectorAll('#close-notes input')];
      boxes[0].click(); boxes[1].click();
      const f = document.getElementById('close-form').elements;
      f.summary.value = 'Living deliberately, with less, close to nature.';
      f.idea0.value = 'Simplify: fewer commitments, done better.';
      f.idea1.value = 'Walking is a thinking tool.';
      f.change.value = 'I now schedule walks instead of waiting for free time, and I said no to two commitments this month.';
      f.rating.value = '5';
    })()`,
  });
  // 7. A finished book with its report; and a finished book that still owes one.
  await shot("07-report", `/#/book/${republic}`, { height: 1250 });
  // 8. The year in reading (slides).
  const slide = (n) => `document.querySelector('[data-slide="${n}"]').click()`;
  await shot("08-year-books", "/#/year", { height: 760, steps: slide(1) });
  await shot("09-year-rhythm", "/#/year", { height: 760, steps: slide(3) });
  await shot("10-year-changed", "/#/year", { height: 760, steps: slide(7) });
  // 9. Dark mode.
  await shot("11-dark-today", "/#/", { dark: true, height: 1050 });
  await shot("12-dark-reader", `/reader.html?book=${meditations}`, { dark: true, wait: 3000 });
  // 10. On a phone.
  await shot("13-phone-today", "/#/", { width: 390, height: 1500, mobile: true });
  await shot("14-phone-queue", "/#/queue", { width: 390, height: 1100, mobile: true });
} finally {
  socket.close();
  browser.kill();
  server.close();
  db.close();
  await sleep(500);
  rmSync(work, { recursive: true, force: true });
}
console.log(`${made.length} screenshots in ${OUT}`);
