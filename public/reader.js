// The reader: opens the book's PDF or EPUB, lets you highlight text, and saves
// every highlight as a note with its page.
//
// Both readers (PDF and EPUB) expose the same small interface, so the rest of
// the page does not care which one is open:
//   where()            -> where we are now, as note fields ({ page, page_kind } or { percent })
//   draw(note)         -> paint a saved highlight
//   undraw(note)       -> remove a painted highlight
//   jump(note)         -> go to the place of a note
import { api, esc, noteLocationLabel, toast } from "./common.js";

const bookId = Number(new URLSearchParams(location.search).get("book"));
const $ = (id) => document.getElementById(id);

let book;
let notes = [];
let reader;
let pending = null; // the selection waiting for "Highlight": { quote, where, location, clear }

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
  wireSelectionBar();
  wireQuickNote();
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
      if (note) reader.jump(note);
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

  const view = $("pdf-view");
  view.hidden = false;
  let pageNum = Math.min(Math.max(Number(book.last_location) || 1, 1), doc.numPages);
  let zoom = 1;
  let renderId = 0;
  let pageEl = null;

  // Navigation controls: page box and zoom.
  $("position").innerHTML = `Page <input id="page-input" type="number" min="1" max="${doc.numPages}" aria-label="Page number"> of ${doc.numPages}`;
  $("extra-controls").innerHTML = `
    <button class="secondary" id="zoom-out" aria-label="Zoom out">−</button>
    <button class="secondary" id="zoom-in" aria-label="Zoom in">+</button>`;
  const pageInput = $("page-input");

  async function render(n) {
    pageNum = Math.min(Math.max(n, 1), doc.numPages);
    pageInput.value = pageNum;
    const myRender = ++renderId;
    const page = await doc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const fit = Math.min((view.parentElement.clientWidth - 48) / base.width, 1.6);
    const viewport = page.getViewport({ scale: fit * zoom });
    const dpr = window.devicePixelRatio || 1;

    const el = document.createElement("div");
    el.className = "pdf-page";
    el.style.width = `${viewport.width}px`;
    el.style.height = `${viewport.height}px`;
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
    el.append(canvas, hlLayer, textLayer);

    await page.render({
      canvas,
      canvasContext: canvas.getContext("2d"),
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    }).promise;
    if (myRender !== renderId) return; // the user already moved to another page
    await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport }).render();
    if (myRender !== renderId) return;

    view.replaceChildren(el);
    pageEl = el;
    for (const note of notes) draw(note);
    view.parentElement.scrollTop = 0;
    rememberLocation(pageNum);
    updateQuickNoteLabel();
  }

  function draw(note) {
    if (!pageEl || note.loc?.type !== "pdf" || note.loc.page !== pageNum) return;
    undraw(note); // never paint the same highlight twice
    const layer = pageEl.querySelector(".hl-layer");
    for (const r of note.loc.rects ?? []) {
      const d = document.createElement("div");
      d.className = "hl";
      d.dataset.note = note.id;
      Object.assign(d.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
      layer.append(d);
    }
  }

  function undraw(note) {
    pageEl?.querySelectorAll(`.hl[data-note="${note.id}"]`).forEach((d) => d.remove());
  }

  // When the mouse is released over the page, look at what is selected.
  document.addEventListener("mouseup", (e) => {
    if (e.target.closest("#selection-bar")) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (!pageEl || sel.isCollapsed || !text || !pageEl.contains(sel.anchorNode)) {
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
        }));
      const page = pageNum;
      offerHighlight({
        quote: text,
        where: async () => ({ page, page_kind: "pdf" }),
        location: { type: "pdf", page, rects },
        clear: () => window.getSelection().removeAllRanges(),
      });
    }, 0);
  });

  $("prev").onclick = () => render(pageNum - 1);
  $("next").onclick = () => render(pageNum + 1);
  pageInput.addEventListener("change", () => render(Number(pageInput.value) || 1));
  $("zoom-in").onclick = () => { zoom = Math.min(zoom + 0.2, 3); render(pageNum); };
  $("zoom-out").onclick = () => { zoom = Math.max(zoom - 0.2, 0.4); render(pageNum); };
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") render(pageNum + 1);
    if (e.key === "ArrowLeft" || e.key === "PageUp") render(pageNum - 1);
  });
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => render(pageNum), 200); });

  await render(pageNum);

  return {
    where: async () => ({ page: pageNum, page_kind: "pdf" }),
    draw,
    undraw,
    jump: (note) => {
      const target = note.loc?.page ?? note.page;
      if (target) render(target);
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
  const rendition = epub.renderTo(view, {
    width: "100%",
    height: "100%",
    spread: "none",
    flow: "paginated",
    allowScriptedContent: false,
  });
  await epub.ready;

  const printPages = await buildPrintPages(epub);
  const cfiTool = new ePub.CFI();
  let locationsReady = null;
  if (!printPages.length) {
    showNotice("This EPUB has no print page numbers, so notes use the position in the book as a percentage.");
    locationsReady = epub.locations.generate(1200);
  }

  async function whereFor(cfi) {
    if (printPages.length) {
      let found = null;
      for (const mark of printPages) {
        if (cfiTool.compare(mark.cfi, cfi) <= 0) found = mark;
        else break;
      }
      // Before the first numbered page (cover, preface): use the first number.
      return { page: (found ?? printPages[0]).page, page_kind: "print" };
    }
    await locationsReady;
    const fraction = epub.locations.percentageFromCfi(cfi) ?? 0;
    return { percent: Math.round(fraction * 1000) / 10 };
  }

  let currentCfi = null;
  rendition.on("relocated", async (loc) => {
    currentCfi = loc.start.cfi;
    rememberLocation(currentCfi);
    const where = await whereFor(currentCfi);
    if (currentCfi !== loc.start.cfi) return;
    $("position").textContent = where.page ? `Page ${where.page} (print)` : `${where.percent.toFixed(1)}%`;
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
      rendition.annotations.highlight(note.loc.cfi, { id: note.id }, null, "hl", {
        fill: "#f7e27a", "fill-opacity": "0.55", "mix-blend-mode": "multiply",
      });
    } catch (err) {
      console.warn("Could not draw highlight", err);
    }
  };

  await rendition.display(book.last_location || undefined).catch(() => rendition.display());

  return {
    where: async () => (currentCfi ? whereFor(currentCfi) : {}),
    draw,
    undraw: (note) => { if (note.loc?.type === "epub") rendition.annotations.remove(note.loc.cfi, "highlight"); },
    jump: (note) => {
      if (note.loc?.cfi) return rendition.display(note.loc.cfi);
      const mark = note.page && printPages.find((m) => m.page === note.page);
      if (mark) return rendition.display(mark.cfi);
      if (note.percent !== null && note.percent !== undefined && locationsReady) {
        locationsReady.then(() => rendition.display(epub.locations.cfiFromPercentage(note.percent / 100)));
      }
    },
  };
}
