// The reader: opens the book's PDF or EPUB, lets you highlight text, and saves
// every highlight as a note with its page.
//
// Both readers (PDF and EPUB) expose the same small interface, so the rest of
// the page does not care which one is open:
//   where()            -> where we are now, as note fields ({ page, page_kind } or { percent })
//   draw(note)         -> paint a saved highlight
//   undraw(note)       -> remove a painted highlight
//   jump(note)         -> go to the place of a note
import { EPUB_CHARS_PER_PAGE } from "./book-meta.js";
import { api, esc, noteLocationLabel, toast, todayLocal, wireThemeToggle } from "./common.js";

const params = new URLSearchParams(location.search);
const bookId = Number(params.get("book"));
const startNoteId = Number(params.get("note")) || null; // open the book at this note
const $ = (id) => document.getElementById(id);

let book;
let notes = [];
let reader;
let pending = null; // the selection waiting for "Highlight": { quote, where, location, clear }
const isDark = () => document.documentElement.dataset.theme === "dark";
wireThemeToggle($("theme-toggle"));
let startPage = null; // the page the book was opened at
let nowPage = null; // the page being read now

start();

async function start() {
  try {
    book = await api("GET", `/api/books/${bookId}`);
  } catch (err) {
    document.body.innerHTML = `<div class="container"><div class="card"><h2>Could not open this book</h2><p>${esc(err.message)}</p><a href="/#/books">Back to the notebook</a></div></div>`;
    return;
  }
  document.title = `${book.title} · Caderno de Leitura`;
  $("book-title").textContent = book.title;
  $("back-link").href = `/#/book/${book.id}`;
  notes = book.notes.map(parseNote);

  if (!book.file_type) {
    showNotice("This book has no file yet. Attach a PDF or EPUB on the book page.");
    return;
  }
  try {
    reader = book.file_type === "pdf" ? await openPdf() : await openEpub();
  } catch (err) {
    console.error(err);
    showNotice(`Could not open the file: ${err.message}`);
    return;
  }
  for (const note of notes) reader.draw(note);
  renderPanel();
  updateQuickNoteLabel();
  wireSelectionBar();
  wireQuickNote();
  wireClose();
  const startNote = startNoteId && notes.find((n) => n.id === startNoteId);
  if (startNote) goToNote(startNote);
}

// Both readers call this when the page changes. The first page seen is where reading began.
function pageChanged(page) {
  nowPage = page;
  if (startPage === null) startPage = page;
}

// Leaving the reader: when pages were read past what is already logged, offer to log them.
// Pages count both ends, and pages already logged are not counted twice.
function wireClose() {
  const link = $("back-link");
  const dialog = $("log-dialog");
  link.addEventListener("click", (e) => {
    const from = Math.max(startPage ?? 0, book.current_page + 1);
    const canLog = (book.status === "reading" || book.status === "paused") && startPage !== null && nowPage >= from;
    if (!canLog) return; // just leave
    e.preventDefault();
    const form = $("log-form");
    form.elements.from_page.value = from;
    form.elements.to_page.value = book.total_pages ? Math.min(nowPage, book.total_pages) : nowPage;
    form.elements.to_page.max = book.total_pages ?? "";
    const show = () => {
      const f = Number(form.elements.from_page.value);
      const t = Number(form.elements.to_page.value);
      $("log-summary").textContent = f && t >= f ? `You read pages ${f}–${t} (${t - f + 1} pages).` : "Check the pages.";
    };
    form.oninput = show;
    show();
    dialog.showModal();
  });
  $("log-skip").addEventListener("click", () => { location.href = link.href; });
  $("log-cancel").addEventListener("click", () => dialog.close());
  $("log-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      const s = await api("POST", "/api/sessions", {
        book_id: book.id, from_page: Number(f.from_page.value), to_page: Number(f.to_page.value), date: todayLocal(),
      });
      // Reached the last page: go to the book page, where finishing is offered.
      const done = book.total_pages && s.to_page >= book.total_pages;
      location.href = done ? `/#/close/${book.id}` : link.href;
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// Goes to a note's place in the book and marks it in the panel.
function goToNote(note) {
  reader.jump(note);
  for (const el of document.querySelectorAll("#panel-notes .note")) {
    const active = Number(el.dataset.id) === note.id;
    el.classList.toggle("active", active);
    if (active) el.scrollIntoView({ block: "nearest" });
  }
}

function parseNote(note) {
  let loc = null;
  try { loc = note.location ? JSON.parse(note.location) : null; } catch { loc = null; }
  return { ...note, loc };
}

function showNotice(text) {
  $("notice").textContent = text;
  $("notice").hidden = false;
}

function hideNotice() {
  $("notice").hidden = true;
}

// Saves where the reader is, so the book reopens at the same place. Waits a moment
// so turning many pages quickly sends only one request.
let saveTimer;
function rememberLocation(value) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api("PATCH", `/api/books/${book.id}`, { last_location: String(value) }).catch(() => {});
  }, 800);
}

// ---------------------------------------------------------------- notes panel

function renderPanel() {
  const list = $("panel-notes");
  if (!notes.length) {
    list.innerHTML = '<p class="empty-state">Select text in the book to highlight it.</p>';
    return;
  }
  list.innerHTML = notes.map((n) => `
    <div class="note" data-id="${n.id}" title="Go to this place">
      <div class="meta"><span class="page-tag">${esc(noteLocationLabel(n))}</span><span style="flex:1"></span>
        <button class="ghost" data-delete="${n.id}" aria-label="Delete note">Delete</button></div>
      ${n.quote ? `<blockquote>${esc(n.quote)}</blockquote>` : ""}
      ${n.body ? `<div class="body">${esc(n.body)}</div>` : ""}
    </div>`).join("");

  list.querySelectorAll(".note").forEach((el) =>
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-delete]")) return;
      const note = notes.find((n) => n.id === Number(el.dataset.id));
      if (note) goToNote(note);
    }),
  );
  list.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this note?")) return;
      const id = Number(btn.dataset.delete);
      await api("DELETE", `/api/notes/${id}`);
      const note = notes.find((n) => n.id === id);
      notes = notes.filter((n) => n.id !== id);
      if (note) reader.undraw(note);
      renderPanel();
      toast("Note deleted.");
    }),
  );
}

async function saveNote(fields) {
  const created = parseNote(await api("POST", "/api/notes", { book_id: book.id, ...fields }));
  notes.push(created);
  notes.sort((a, b) => (a.page ?? Infinity) - (b.page ?? Infinity) || (a.percent ?? 0) - (b.percent ?? 0));
  renderPanel();
  return created;
}

async function updateQuickNoteLabel() {
  if (!reader) return;
  const where = await reader.where();
  $("quick-note-where").textContent = noteLocationLabel(where);
}

function wireQuickNote() {
  $("quick-note").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("quick-note-text").value.trim();
    if (!text) return;
    try {
      const where = await reader.where();
      await saveNote({ ...where, body: text, source: "manual" });
      $("quick-note-text").value = "";
      toast(`Note saved (${noteLocationLabel(where)}).`);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// -------------------------------------------------------------- selection bar

function offerHighlight(selection) {
  pending = selection;
  $("selection-quote").textContent = selection.quote;
  $("selection-comment").hidden = true;
  $("selection-comment").value = "";
  $("hl-comment").textContent = "Highlight + comment";
  $("selection-bar").hidden = false;
}

function hideSelectionBar() {
  pending = null;
  $("selection-bar").hidden = true;
}

function wireSelectionBar() {
  // Keep the text selected when clicking the bar's buttons.
  $("selection-bar").addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") e.preventDefault();
  });

  const save = async (withComment) => {
    if (!pending) return;
    const selection = pending;
    try {
      const where = await selection.where();
      const note = await saveNote({
        ...where,
        quote: selection.quote,
        body: withComment ? $("selection-comment").value : "",
        source: "highlight",
        location: selection.location,
      });
      reader.draw(note);
      selection.clear();
      hideSelectionBar();
      toast(`Highlight saved (${noteLocationLabel(where)}).`);
    } catch (err) {
      toast(err.message, true);
    }
  };

  $("hl-save").addEventListener("click", () => save(false));
  $("hl-comment").addEventListener("click", () => {
    const box = $("selection-comment");
    if (box.hidden) {
      box.hidden = false;
      box.focus();
      $("hl-comment").textContent = "Save with comment";
    } else {
      save(true);
    }
  });
  $("hl-cancel").addEventListener("click", () => {
    pending?.clear();
    hideSelectionBar();
  });
}

// ------------------------------------------------------------------------ PDF

async function openPdf() {
  const pdfjs = await import("/vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({
    url: `/api/books/${book.id}/file`,
    cMapUrl: "/vendor/pdfjs-cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/vendor/pdfjs-fonts/",
    wasmUrl: "/vendor/pdfjs-wasm/",
    iccUrl: "/vendor/pdfjs-iccs/",
  }).promise;

  // All pages sit one under the other and the reader scrolls down through them.
  // Only the pages near the screen are drawn; the others are empty boxes of the
  // right size, so a 400-page book stays light.
  const stage = $("stage");
  const view = $("pdf-view");
  view.hidden = false;
  view.classList.add("continuous");
  const total = doc.numPages;
  let zoom = 1;
  let scale = 1;
  let currentPage = 1;
  const pages = []; // pages[n - 1] = { el, n, state: "empty" | "drawing" | "drawn", hasText, task }

  $("position").innerHTML = `Page <input id="page-input" type="number" min="1" max="${total}" aria-label="Page number"> of ${total}`;
  $("extra-controls").innerHTML = `
    <button class="secondary" id="zoom-out" aria-label="Zoom out">−</button>
    <button class="secondary" id="zoom-in" aria-label="Zoom in">+</button>`;
  const pageInput = $("page-input");

  // Page boxes sized from the first page; each box takes its own size once drawn.
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  const fitScale = () => Math.min((stage.clientWidth - 48) / first.width, 1.6) * zoom;

  function layout() {
    scale = fitScale();
    for (const p of pages) {
      const w = (p.width ?? first.width) * scale;
      const h = (p.height ?? first.height) * scale;
      p.el.style.width = `${w}px`;
      p.el.style.height = `${h}px`;
    }
  }

  for (let n = 1; n <= total; n++) {
    const el = document.createElement("div");
    el.className = "pdf-page";
    el.dataset.page = n;
    pages.push({ el, n, state: "empty" });
    view.append(el);
  }
  layout();

  async function drawPage(p) {
    if (p.state !== "empty") return;
    p.state = "drawing";
    const myScale = scale;
    try {
      const page = await doc.getPage(p.n);
      const base = page.getViewport({ scale: 1 });
      p.width = base.width;
      p.height = base.height;
      const viewport = page.getViewport({ scale: myScale });
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const hlLayer = document.createElement("div");
      hlLayer.className = "hl-layer";
      const textLayer = document.createElement("div");
      textLayer.className = "textLayer";
      textLayer.style.setProperty("--scale-factor", viewport.scale);
      textLayer.style.setProperty("--total-scale-factor", viewport.scale);

      p.task = page.render({
        canvas,
        canvasContext: canvas.getContext("2d"),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      await p.task.promise;
      await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport }).render();
      if (p.state !== "drawing" || myScale !== scale) return; // freed or zoomed meanwhile
      p.el.style.width = `${viewport.width}px`;
      p.el.style.height = `${viewport.height}px`;
      p.el.replaceChildren(canvas, hlLayer, textLayer);
      p.hasText = Boolean(textLayer.textContent.trim());
      p.state = "drawn";
      for (const note of notes) draw(note);
      if (p.n === currentPage) updateScanNotice();
    } catch (err) {
      if (err?.name !== "RenderingCancelledException") console.warn(`Could not draw page ${p.n}`, err);
      if (p.state === "drawing") p.state = "empty";
    }
  }

  // Frees a page far from the screen (its canvas can take many megabytes).
  function freePage(p) {
    if (p.state === "empty") return;
    p.task?.cancel();
    p.el.replaceChildren();
    p.state = "empty";
  }

  // Draw pages within about one screen of the visible area; free pages much farther away.
  const near = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) drawPage(pages[Number(e.target.dataset.page) - 1]);
  }, { root: stage, rootMargin: "100% 0px" });
  const far = new IntersectionObserver((entries) => {
    for (const e of entries) if (!e.isIntersecting) freePage(pages[Number(e.target.dataset.page) - 1]);
  }, { root: stage, rootMargin: "400% 0px" });
  // (Re)starting the observers makes them look at every page again, which draws the
  // pages on screen even when they were already there (after a zoom, for example).
  function watchPages() {
    near.disconnect();
    far.disconnect();
    for (const p of pages) { near.observe(p.el); far.observe(p.el); }
  }
  watchPages();

  // Dark mode: PDF pages are pictures, so they are inverted (a choice that is remembered).
  const invertButton = $("invert-toggle");
  const paintInvert = () => {
    let on = true;
    try { on = localStorage.getItem("invert-pdf") !== "off"; } catch { /* default on */ }
    view.classList.toggle("invert", isDark() && on);
    invertButton.hidden = !isDark();
    invertButton.textContent = on ? "Invert pages: on" : "Invert pages: off";
  };
  invertButton.addEventListener("click", () => {
    let on = true;
    try { on = localStorage.getItem("invert-pdf") !== "off"; localStorage.setItem("invert-pdf", on ? "off" : "on"); } catch { /* ignore */ }
    paintInvert();
  });
  window.addEventListener("themechange", paintInvert);
  paintInvert();

  // The current page is the one at the upper third of the screen.
  function readPosition() {
    const line = stage.getBoundingClientRect().top + stage.clientHeight / 3;
    let found = pages[0];
    for (const p of pages) {
      const r = p.el.getBoundingClientRect();
      if (r.top <= line) found = p; else break;
    }
    const r = found.el.getBoundingClientRect();
    const fraction = Math.min(Math.max((stage.getBoundingClientRect().top - r.top) / r.height, 0), 0.999);
    return { page: found.n, fraction };
  }

  function updateScanNotice() {
    const p = pages[currentPage - 1];
    if (p.state !== "drawn") return;
    if (p.hasText) hideNotice();
    else showNotice("This page is a scanned image, so its text cannot be selected or highlighted. You can still add a note for this page.");
  }

  // Saved as "page.fraction", for example "12.35": a third of the way into page 12.
  // Older saves are just the page number, which still works.
  function onScroll() {
    const { page, fraction } = readPosition();
    if (document.activeElement !== pageInput) pageInput.value = page;
    rememberLocation((page + fraction).toFixed(3));
    pageChanged(page);
    if (page !== currentPage) {
      currentPage = page;
      updateQuickNoteLabel();
      updateScanNotice();
    }
  }
  let scrollTimer;
  stage.addEventListener("scroll", () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(onScroll, 120); });

  function goTo(page, fraction = 0) {
    const p = pages[Math.min(Math.max(Math.floor(page), 1), total) - 1];
    const offset = fraction ? p.el.offsetHeight * fraction : -12; // a small margin above a page top
    stage.scrollTop += p.el.getBoundingClientRect().top - stage.getBoundingClientRect().top + offset;
    onScroll();
  }

  function draw(note) {
    if (note.loc?.type !== "pdf") return;
    const p = pages[note.loc.page - 1];
    if (!p || p.state !== "drawn") return; // painted when the page is drawn
    undraw(note); // never paint the same highlight twice
    const layer = p.el.querySelector(".hl-layer");
    for (const r of note.loc.rects ?? []) {
      const d = document.createElement("div");
      d.className = "hl";
      d.dataset.note = note.id;
      Object.assign(d.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
      layer.append(d);
    }
  }

  function undraw(note) {
    view.querySelectorAll(`.hl[data-note="${note.id}"]`).forEach((d) => d.remove());
  }

  // When the mouse is released over a page, look at what is selected.
  document.addEventListener("mouseup", (e) => {
    if (e.target.closest("#selection-bar")) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel.toString().replace(/\s+/g, " ").trim();
      const anchor = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
      const pageEl = anchor?.closest?.(".pdf-page");
      if (sel.isCollapsed || !text || !pageEl || !view.contains(pageEl)) {
        if ($("selection-comment").hidden) hideSelectionBar();
        return;
      }
      const box = pageEl.getBoundingClientRect();
      const rects = [...sel.getRangeAt(0).getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1 && r.height < box.height * 0.2)
        .map((r) => ({
          x: (r.left - box.left) / box.width,
          y: (r.top - box.top) / box.height,
          w: r.width / box.width,
          h: r.height / box.height,
        }))
        // A selection that runs onto the next page keeps only the part on this page.
        .filter((r) => r.y >= -0.01 && r.y < 1);
      const page = Number(pageEl.dataset.page);
      offerHighlight({
        quote: text,
        where: async () => ({ page, page_kind: "pdf" }),
        location: { type: "pdf", page, rects },
        clear: () => window.getSelection().removeAllRanges(),
      });
    }, 0);
  });

  // Zoom keeps the reader on the same spot of the same page.
  function rezoom(next) {
    const { page, fraction } = readPosition();
    zoom = next;
    for (const p of pages) freePage(p);
    layout();
    goTo(page, fraction);
    watchPages();
  }

  $("prev").onclick = () => goTo(currentPage - 1);
  $("next").onclick = () => goTo(currentPage + 1);
  pageInput.addEventListener("change", () => goTo(Number(pageInput.value) || 1));
  $("zoom-in").onclick = () => rezoom(Math.min(zoom + 0.2, 3));
  $("zoom-out").onclick = () => rezoom(Math.max(zoom - 0.2, 0.4));
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key === "ArrowRight") goTo(currentPage + 1);
    if (e.key === "ArrowLeft") goTo(currentPage - 1);
  });
  let resizeTimer;
  let lastWidth = stage.clientWidth;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (stage.clientWidth !== lastWidth) { lastWidth = stage.clientWidth; rezoom(zoom); } }, 200);
  });

  const saved = Number(book.last_location) || 1;
  goTo(saved, saved % 1);

  return {
    where: async () => ({ page: currentPage, page_kind: "pdf" }),
    draw,
    undraw,
    jump: (note) => {
      const target = note.loc?.page ?? note.page;
      if (!target) return;
      // Land a little above the highlight, when there is one.
      const y = note.loc?.rects?.[0]?.y;
      goTo(target, y ? Math.max(y - 0.05, 0) : 0);
    },
  };
}

// ----------------------------------------------------------------------- EPUB

// EPUB files may carry the page numbers of the printed edition as a "page list"
// of links such as "chapter3.xhtml#page_17". epub.js only understands that list
// when it is written as CFIs (exact positions), which real books rarely do, so
// here each link is turned into a CFI by opening its chapter and finding the
// marked element. Result: [{ page: 17, cfi }] sorted by position in the book.
async function buildPrintPages(epub) {
  const items = (epub.pageList?.pageList ?? []).filter((it) => Number.isInteger(it.page) && it.href);
  if (!items.length) return [];
  const navDir = epub.packaging?.navPath ? epub.packaging.navPath.split("/").slice(0, -1).join("/") : "";

  const bySection = new Map();
  for (const item of items) {
    const [path, id] = item.href.split("#");
    const section = epub.spine.get(path) ?? (navDir ? epub.spine.get(`${navDir}/${path}`) : null);
    if (!section) continue;
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section).push({ page: item.page, id });
  }

  const result = [];
  for (const [section, marks] of bySection) {
    try {
      const contents = await section.load(epub.load.bind(epub));
      const docEl = contents.ownerDocument ?? section.document;
      for (const mark of marks) {
        const el = mark.id ? docEl.getElementById(mark.id) : docEl.body;
        if (el) result.push({ page: mark.page, cfi: section.cfiFromElement(el) });
      }
    } finally {
      section.unload();
    }
  }
  const cfi = new ePub.CFI();
  result.sort((a, b) => cfi.compare(a.cfi, b.cfi));
  return result;
}

async function openEpub() {
  const view = $("epub-view");
  view.hidden = false;
  const data = await (await fetch(`/api/books/${book.id}/file`)).arrayBuffer();
  const epub = ePub(data);
  // One long column: chapters follow each other and the reader scrolls down.
  const rendition = epub.renderTo(view, {
    width: "100%",
    height: "100%",
    manager: "continuous",
    flow: "scrolled",
    allowScriptedContent: false,
  });
  await epub.ready;

  // Dark mode: the book text takes the page colors.
  const paintTheme = () => {
    rendition.themes.override("color", isDark() ? "#ece6da" : "#26221e");
    rendition.themes.override("background", isDark() ? "#211e1b" : "#ffffff");
  };
  paintTheme();

  const printPages = await buildPrintPages(epub);
  const cfiTool = new ePub.CFI();
  // Highlights and counted pages are stored as ranges (start..end). Going to a range
  // makes epub.js open the start of the chapter, so go to the range's first point.
  const startOf = (cfi) => {
    const point = new ePub.CFI(cfi);
    if (point.range) point.collapse(true);
    return point.toString();
  };
  const goTo = (cfi) => rendition.display(startOf(cfi));

  // Pages as a list of { page, cfi } where cfi is the point where the page starts:
  // the print edition's numbers when the file has them, otherwise pages counted by
  // the app (one per EPUB_CHARS_PER_PAGE characters, the same count as "Add a book").
  let pagesReady;
  if (printPages.length) {
    pagesReady = Promise.resolve({ kind: "print", marks: printPages });
  } else {
    showNotice("This EPUB has no print page numbers, so the app counts pages itself (about 1,500 characters each). They stay the same at any window size, but do not match the printed book.");
    $("position").textContent = "Counting pages…";
    pagesReady = epub.locations.generate(EPUB_CHARS_PER_PAGE).then(() => ({
      kind: "computed",
      marks: Array.from({ length: epub.locations.length() }, (_, i) => ({
        page: i + 1,
        cfi: startOf(epub.locations.cfiFromLocation(i)),
      })),
    }));
  }

  // The page that contains a position: the last page that starts at or before it.
  async function whereFor(cfi) {
    const { kind, marks } = await pagesReady;
    let found = null;
    for (const mark of marks) {
      if (cfiTool.compare(mark.cfi, cfi) <= 0) found = mark;
      else break;
    }
    // Before the first page (cover, preface): use the first number.
    const where = { page: (found ?? marks[0]).page, page_kind: kind };
    if (kind === "computed") where.percent = Math.round((epub.locations.percentageFromCfi(cfi) ?? 0) * 1000) / 10;
    return where;
  }

  let currentCfi = null;
  rendition.on("relocated", async (loc) => {
    currentCfi = loc.start.cfi;
    rememberLocation(currentCfi);
    const where = await whereFor(currentCfi);
    if (currentCfi !== loc.start.cfi) return;
    // A screen can show the end of one page and the start of the next: "Pages 40–41".
    const last = (await whereFor(loc.end.cfi)).page;
    if (currentCfi !== loc.start.cfi) return;
    pageChanged(where.page);
    const pages = last > where.page ? `Pages ${where.page}–${last}` : `Page ${where.page}`;
    $("position").textContent = where.page_kind === "print"
      ? `${pages} (print)`
      : `${pages} of ${(await pagesReady).marks.length}`;
    updateQuickNoteLabel();
  });

  rendition.on("selected", (cfiRange, contents) => {
    const quote = rendition.getRange(cfiRange)?.toString().replace(/\s+/g, " ").trim();
    if (!quote) return;
    offerHighlight({
      quote,
      where: () => whereFor(cfiRange),
      location: { type: "epub", cfi: cfiRange },
      clear: () => contents.window.getSelection().removeAllRanges(),
    });
  });

  // Table of contents.
  const flatten = (items, depth = 0) => items.flatMap((i) => [{ ...i, depth }, ...flatten(i.subitems ?? [], depth + 1)]);
  const toc = flatten(epub.navigation?.toc ?? []);
  if (toc.length) {
    $("extra-controls").innerHTML = `<select id="toc" aria-label="Chapters"><option value="">Chapters…</option>${toc
      .map((t) => `<option value="${esc(t.href)}">${"  ".repeat(t.depth)}${esc(t.label.trim())}</option>`).join("")}</select>`;
    $("toc").addEventListener("change", (e) => { if (e.target.value) rendition.display(e.target.value); });
  }

  const onKey = (e) => {
    if (e.target?.matches?.("input, textarea, select")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") rendition.next();
    if (e.key === "ArrowLeft" || e.key === "PageUp") rendition.prev();
  };
  document.addEventListener("keydown", onKey);
  rendition.on("keydown", onKey);
  $("prev").onclick = () => rendition.prev();
  $("next").onclick = () => rendition.next();

  const draw = (note) => {
    if (note.loc?.type !== "epub") return;
    try {
      rendition.annotations.highlight(note.loc.cfi, { id: note.id }, null, "hl", isDark()
        ? { fill: "#c9ad2a", "fill-opacity": "0.4", "mix-blend-mode": "screen" }
        : { fill: "#f7e27a", "fill-opacity": "0.55", "mix-blend-mode": "multiply" });
    } catch (err) {
      console.warn("Could not draw highlight", err);
    }
  };

  window.addEventListener("themechange", () => {
    paintTheme();
    for (const note of notes) { // highlights are painted again with the colors of the new theme
      if (note.loc?.type !== "epub") continue;
      try { rendition.annotations.remove(note.loc.cfi, "highlight"); } catch { /* not drawn */ }
      draw(note);
    }
  });

  await rendition.display(book.last_location || undefined).catch(() => rendition.display());

  return {
    // Quick notes also keep the exact position, so "go to note" lands on the same screen.
    where: async () => (currentCfi ? { ...(await whereFor(currentCfi)), location: { type: "epub-pos", cfi: currentCfi } } : {}),
    draw,
    undraw: (note) => { if (note.loc?.type === "epub") rendition.annotations.remove(note.loc.cfi, "highlight"); },
    jump: async (note) => {
      if (note.loc?.cfi) return goTo(note.loc.cfi);
      const { kind, marks } = await pagesReady;
      if (note.page) {
        // The last page at or before the note's page (print numbers can skip).
        const mark = [...marks].reverse().find((m) => m.page <= note.page) ?? marks[0];
        return goTo(mark.cfi);
      }
      if (kind === "computed" && note.percent !== null && note.percent !== undefined) {
        return goTo(epub.locations.cfiFromPercentage(note.percent / 100));
      }
      return undefined;
    },
  };
}
