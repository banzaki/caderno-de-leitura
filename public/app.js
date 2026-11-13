// The notebook UI. A tiny hash router picks which view to draw:
//   #/            Today: goal, streak, log today's reading, calendar
//   #/books       all books, add a book
//   #/book/12     one book: details, file, sessions, notes
//   #/notes       every note, with search
import { STATUS_LABELS, api, esc, formatDate, noteLocationLabel, toast, todayLocal } from "./common.js";
import { fileKind, readBookFileInfo } from "./book-file.js";
import { fieldsToFill } from "./book-meta.js";

const view = document.getElementById("view");
let calendarMonth = todayLocal().slice(0, 7); // "YYYY-MM"

function setActiveNav(name) {
  for (const a of document.querySelectorAll("[data-nav]")) a.classList.toggle("active", a.dataset.nav === name);
}

async function route() {
  const hash = location.hash || "#/";
  try {
    const bookMatch = hash.match(/^#\/book\/(\d+)$/);
    if (bookMatch) {
      setActiveNav("books");
      await renderBook(Number(bookMatch[1]));
    } else if (hash === "#/books") {
      setActiveNav("books");
      await renderBooks();
    } else if (hash === "#/notes") {
      setActiveNav("notes");
      await renderNotes();
    } else {
      setActiveNav("today");
      await renderToday();
    }
  } catch (err) {
    view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(err.message)}</p></div>`;
  }
}
window.addEventListener("hashchange", route);
route();

// ---------- Today ----------

async function renderToday() {
  const today = todayLocal();
  const [stats, books, sessions] = await Promise.all([
    api("GET", `/api/stats?today=${today}`),
    api("GET", "/api/books"),
    api("GET", "/api/sessions"),
  ]);
  const reading = books.filter((b) => b.status === "reading");
  const left = Math.max(stats.goal - stats.today.pages, 0);
  const percent = Math.min(100, Math.round((stats.today.pages / stats.goal) * 100));

  const lastRead = reading.find((b) => b.file_type) ?? null;

  view.innerHTML = `
    <div class="grid two">
      <section class="card">
        <div class="hero">
          <div class="ring ${left === 0 ? "done" : ""}" style="--p:${percent}"><div><div><strong>${stats.today.pages}</strong><br><span class="muted small">of ${stats.goal} pages</span></div></div></div>
          <div>
            <div class="eyebrow">${formatDate(today)}</div>
            <h1>${left === 0 ? "Goal reached today" : `${left} pages to go today`}</h1>
            <div class="stats">
              <div class="stat"><div class="big-number">${stats.streak}</div><div class="muted small">day streak</div></div>
              <div class="stat"><div class="big-number">${stats.days_met}</div><div class="muted small">days on goal</div></div>
            </div>
            ${lastRead ? `<a class="button secondary" style="margin-top:1rem" href="/reader.html?book=${lastRead.id}" title="${esc(lastRead.title)}">Continue reading</a>` : ""}
          </div>
        </div>
      </section>

      <section class="card">
        <h2>Log reading</h2>
        ${reading.length ? `
        <form id="log-form" class="fields">
          <div class="wide"><label for="log-book">Book</label>
            <select id="log-book" name="book_id">${reading.map((b) => `<option value="${b.id}" data-next="${b.current_page + 1}" data-total="${b.total_pages ?? ""}">${esc(b.title)}</option>`).join("")}</select></div>
          <div><label for="log-from">From page</label><input id="log-from" name="from_page" type="number" min="1" required></div>
          <div><label for="log-to">To page</label><input id="log-to" name="to_page" type="number" min="1" required></div>
          <div><label for="log-date">Date</label><input id="log-date" name="date" type="date" value="${today}" max="${today}" required></div>
          <div class="wide row spread"><span class="computed" id="log-computed"></span><button type="submit">Save</button></div>
        </form>` : `<p class="empty-state">No book marked as reading. <a href="#/books">Add a book</a> to start.</p>`}
      </section>
    </div>

    <div class="grid two section">
      <section class="card" id="calendar-card"></section>
      <div class="grid" style="align-content:start">
        <section class="card">
          <div class="row spread"><h2>Last 7 days</h2><span class="muted small">${stats.last7.reduce((sum, d) => sum + d.pages, 0)} pages</span></div>
          ${renderWeek(stats)}
        </section>
        <section class="card">
          <h2>Recent reading</h2>
          ${sessions.length ? `<ul class="list">${sessions.slice(0, 8).map((s) => `
            <li><div class="grow"><strong>${esc(s.title)}</strong><div class="muted small">${formatDate(s.date)} · pages ${s.from_page}–${s.to_page}</div></div>
            <span class="pages-pill">${s.pages} p.</span>
            <button class="ghost" data-delete-session="${s.id}" title="Delete this entry" aria-label="Delete this entry">✕</button></li>`).join("")}</ul>`
          : `<p class="empty-state">Nothing logged yet.</p>`}
        </section>
      </div>
    </div>`;

  renderCalendar(stats);

  const form = document.getElementById("log-form");
  if (form) {
    const bookSelect = form.elements.book_id;
    const fromInput = form.elements.from_page;
    const toInput = form.elements.to_page;
    const computed = document.getElementById("log-computed");
    const fillFrom = () => {
      const opt = bookSelect.selectedOptions[0];
      fromInput.value = opt.dataset.next;
      toInput.max = opt.dataset.total;
      updateComputed();
    };
    const updateComputed = () => {
      const from = Number(fromInput.value);
      const to = Number(toInput.value);
      computed.textContent = from && to && to >= from ? `${to - from + 1} pages` : "";
    };
    bookSelect.addEventListener("change", fillFrom);
    fromInput.addEventListener("input", updateComputed);
    toInput.addEventListener("input", updateComputed);
    fillFrom();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const s = await api("POST", "/api/sessions", {
          book_id: Number(bookSelect.value),
          from_page: Number(fromInput.value),
          to_page: Number(toInput.value),
          date: form.elements.date.value,
        });
        toast(`Saved: ${s.pages} pages.`);
        route();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  view.querySelectorAll("[data-delete-session]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this reading entry?")) return;
      await api("DELETE", `/api/sessions/${btn.dataset.deleteSession}`);
      toast("Entry deleted.");
      route();
    }),
  );
}

// Seven bars, one per day, with a dashed line at the daily goal.
function renderWeek(stats) {
  const top = Math.max(stats.goal * 1.5, ...stats.last7.map((d) => d.pages));
  const goalAt = (stats.goal / top) * 100;
  return `<div class="week">${stats.last7.map((d) => {
    const [y, m, day] = d.date.split("-").map(Number);
    const dow = new Date(y, m - 1, day).toLocaleDateString("en-GB", { weekday: "short" });
    const cls = [d.pages >= stats.goal ? "met" : "", d.date === stats.today.date ? "today" : ""].join(" ");
    return `<div class="bar ${cls}" title="${formatDate(d.date)}: ${d.pages} pages">
      <span class="num">${d.pages || ""}</span>
      <div class="area" style="--goal:${goalAt}%"><div class="fill" style="height:${(d.pages / top) * 100}%"></div></div>
      <span class="dow">${dow}</span></div>`;
  }).join("")}</div>`;
}

function renderCalendar(stats) {
  const card = document.getElementById("calendar-card");
  const [y, m] = calendarMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // weeks start on Monday
  const title = first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const today = stats.today.date;

  let cells = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="dow">${d}</div>`).join("");
  cells += '<div class="day empty"></div>'.repeat(offset);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${calendarMonth}-${String(d).padStart(2, "0")}`;
    const pages = stats.totals[date] ?? 0;
    const cls = pages >= stats.goal ? "met" : pages > 0 ? "partial" : "";
    cells += `<div class="day ${cls} ${date === today ? "today" : ""}" title="${pages} pages">${d}${pages ? `<small>${pages}p</small>` : ""}</div>`;
  }

  card.innerHTML = `
    <div class="row spread"><h2>${title}</h2>
      <div class="row"><button class="secondary" id="cal-prev" aria-label="Previous month">‹</button>
      <button class="secondary" id="cal-next" aria-label="Next month">›</button></div></div>
    <div class="calendar">${cells}</div>
    <div class="legend"><span style="--c:var(--accent)">${stats.goal}+ pages</span><span style="--c:var(--partial)">some reading</span></div>`;

  const shift = (delta) => {
    const d = new Date(y, m - 1 + delta, 1);
    calendarMonth = todayLocal(d).slice(0, 7);
    renderCalendar(stats);
  };
  document.getElementById("cal-prev").onclick = () => shift(-1);
  document.getElementById("cal-next").onclick = () => shift(1);
}

// ---------- Books ----------

function bookProgress(book) {
  if (!book.total_pages) return "";
  const pct = Math.min(100, Math.round((book.current_page / book.total_pages) * 100));
  return `<div class="progress"><div style="width:${pct}%"></div></div>
    <div class="muted small">Page ${book.current_page} of ${book.total_pages} · ${pct}%</div>`;
}

// A generated cover: the same title always gets the same colour.
function coverHtml(book) {
  let hash = 0;
  for (const ch of book.title) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return `<div class="cover c${hash % 8}" aria-hidden="true">
    <div class="cover-title">${esc(book.title)}</div>
    <div class="cover-author">${esc(book.author)}</div></div>`;
}

const FILE_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15l3-3 3 3"/></svg>`;

async function renderBooks() {
  const books = await api("GET", "/api/books");
  view.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Your shelf</div><h1>Books</h1></div>
      <span class="muted">${books.length} book${books.length === 1 ? "" : "s"}</span>
    </div>
    <section class="card">
      <h2>Add a book</h2>
      <form id="book-form" class="fields">
        <div class="wide"><label class="dropzone" id="b-drop" for="b-file">
          <span class="icon">${FILE_ICON}</span>
          <span><strong id="b-file-name">Choose the PDF or EPUB</strong>
            <span class="muted small" id="b-file-hint">Or drag it here. Title, author and pages are filled from the file. Optional.</span></span>
          <input id="b-file" name="file" type="file" accept=".pdf,.epub,application/pdf,application/epub+zip">
        </label></div>
        <div class="wide"><label for="b-title">Title</label><input id="b-title" name="title" required maxlength="300"></div>
        <div><label for="b-author">Author</label><input id="b-author" name="author" maxlength="300"></div>
        <div><label for="b-pages">Total pages</label><input id="b-pages" name="total_pages" type="number" min="1"></div>
        <div><label for="b-status">Status</label><select id="b-status" name="status">
          ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
        <div><button type="submit">Add book</button></div>
      </form>
    </section>
    <section class="section">
      ${books.length ? `<div class="books">${books.map((b) => `
        <a class="book-card" href="#/book/${b.id}">
          ${coverHtml(b)}
          <div><h3>${esc(b.title)}</h3><div class="muted small">${esc(b.author) || "Unknown author"}</div></div>
          ${bookProgress(b)}
          <div class="tags"><span class="badge ${b.status}">${STATUS_LABELS[b.status]}</span>
            ${b.file_type ? `<span class="badge">${b.file_type.toUpperCase()}</span>` : ""}
            ${b.note_count ? `<span class="badge">${b.note_count} note${b.note_count === 1 ? "" : "s"}</span>` : ""}</div>
        </a>`).join("")}</div>`
      : `<div class="card empty-state">No books yet. Add the one you are reading above.</div>`}
    </section>`;

  const form = document.getElementById("book-form");
  const fileInput = form.elements.file;
  const hint = document.getElementById("b-file-hint");
  const metaInputs = { title: form.elements.title, author: form.elements.author, totalPages: form.elements.total_pages };
  // Remember which fields Bruno typed himself, so a file never overwrites them.
  for (const input of Object.values(metaInputs)) {
    input.addEventListener("input", () => { input.dataset.typed = "yes"; });
  }
  let reading = null; // the details being read from the chosen file
  const drop = document.getElementById("b-drop");
  const fileName = document.getElementById("b-file-name");
  // The file input covers the whole zone, so dropping a file on it works natively.
  fileInput.addEventListener("dragenter", () => drop.classList.add("over"));
  for (const type of ["dragleave", "drop"]) fileInput.addEventListener(type, () => drop.classList.remove("over"));

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!fileKind(file)) {
      toast("Only PDF and EPUB files are supported.", true);
      fileInput.value = "";
      return;
    }
    fileName.textContent = file.name;
    drop.classList.add("has-file");
    hint.textContent = "Reading the file…";
    const thisRead = (reading = readBookFileInfo(file));
    thisRead.then((info) => {
      if (reading !== thisRead) return; // another file was picked meanwhile
      const fields = Object.fromEntries(Object.entries(metaInputs).map(([k, el]) => [k, { value: el.value, typed: el.dataset.typed === "yes" }]));
      const fill = fieldsToFill(fields, info);
      for (const [key, value] of Object.entries(fill)) metaInputs[key].value = value;
      const missing = info.pagesCounted
        ? " This EPUB has no print page numbers, so pages are counted by the app (they will not match the printed book)."
        : fileKind(file) === "epub" && !info.totalPages && !metaInputs.totalPages.value
          ? " Type the total pages if you know them." : "";
      hint.textContent = `Will be attached to the book. Click to pick another file.${missing}`;
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = form.elements;
    const file = fileInput.files[0];
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (file && reading) await reading; // make sure pre-filling has finished
      const book = await api("POST", "/api/books", {
        title: f.title.value,
        author: f.author.value,
        total_pages: f.total_pages.value || null,
        status: f.status.value,
      });
      if (file) {
        try {
          toast(`Uploading ${file.name}…`);
          await uploadBookFile(book.id, file);
          toast("Book added with its file.");
        } catch (err) {
          toast(`Book added, but the file failed: ${err.message} Attach it again on the book page.`, true);
        }
      } else {
        toast("Book added.");
      }
      location.hash = `#/book/${book.id}`;
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  });
}

async function uploadBookFile(id, file) {
  const res = await fetch(`/api/books/${id}/file`, {
    method: "PUT",
    headers: { "X-File-Name": encodeURIComponent(file.name) },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status}).`);
  return data;
}

async function renderBook(id) {
  const book = await api("GET", `/api/books/${id}`);
  const total = book.sessions.reduce((sum, s) => sum + s.pages, 0);

  view.innerHTML = `
    <a class="back-link" href="#/books">← All books</a>
    <section class="card">
      <div class="book-hero">
        ${coverHtml(book)}
        <div style="min-width:0">
          <div class="row" style="gap:0.4rem;margin-bottom:0.5rem"><span class="badge ${book.status}">${STATUS_LABELS[book.status]}</span>
            ${book.file_type ? `<span class="badge">${book.file_type.toUpperCase()}</span>` : ""}</div>
          <h1>${esc(book.title)}</h1>
          <div class="author">${esc(book.author) || "Unknown author"}</div>
          ${bookProgress(book)}
          <div class="numbers">
            <div><strong>${book.current_page}</strong>current page</div>
            <div><strong>${total}</strong>pages logged</div>
            <div><strong>${book.notes.length}</strong>note${book.notes.length === 1 ? "" : "s"}</div>
          </div>
          <div class="actions">
            ${book.file_type ? `<a class="button big" href="/reader.html?book=${book.id}">Open reader</a>` : ""}
            <label class="button secondary" for="file-input" style="margin:0">${book.file_type ? "Replace file" : "Attach PDF or EPUB"}</label>
            <input id="file-input" class="visually-hidden" type="file" accept=".pdf,.epub,application/pdf,application/epub+zip">
            <span style="flex:1"></span>
            <button class="danger" id="delete-book" type="button">Delete book</button>
          </div>
          ${book.file_type
            ? `<div class="file-line">${FILE_ICON}<span>${esc(book.file_name)}</span></div>`
            : '<p class="muted small" style="margin-top:0.6rem">Attach the PDF or EPUB of this book to read it here. Each highlight becomes a note with its page.</p>'}
          <details class="edit">
            <summary>Edit details</summary>
            <form id="edit-form" class="fields">
              <div class="wide"><label for="e-title">Title</label><input id="e-title" name="title" value="${esc(book.title)}" required maxlength="300"></div>
              <div><label for="e-author">Author</label><input id="e-author" name="author" value="${esc(book.author)}" maxlength="300"></div>
              <div><label for="e-pages">Total pages</label><input id="e-pages" name="total_pages" type="number" min="1" value="${book.total_pages ?? ""}"></div>
              <div><label for="e-status">Status</label><select id="e-status" name="status">
                ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${v === book.status ? "selected" : ""}>${l}</option>`).join("")}</select></div>
              <div><button type="submit" class="secondary">Save changes</button></div>
            </form>
          </details>
        </div>
      </div>
    </section>

    <div class="grid two section">
      <section class="card">
        <h2>Notes</h2>
        <form id="note-form" class="fields">
          <div><label for="n-page">Page</label><input id="n-page" name="page" type="number" min="1" value="${book.current_page || ""}"></div>
          <div class="wide"><label for="n-body">What did you learn?</label><textarea id="n-body" name="body" required></textarea></div>
          <div><button type="submit">Add note</button></div>
        </form>
        <div id="book-notes" style="margin-top:1rem">${renderNoteList(book.notes.map((n) => ({ ...n, file_type: book.file_type })), false)}</div>
      </section>
      <section class="card">
        <h2>Reading history</h2>
        ${book.sessions.length ? `<ul class="list">${book.sessions.map((s) => `
          <li><div class="grow">${formatDate(s.date)}<div class="muted small">pages ${s.from_page}–${s.to_page}</div></div><span class="pages-pill">${s.pages} p.</span></li>`).join("")}</ul>`
        : '<p class="empty-state">No reading logged for this book yet.</p>'}
      </section>
    </div>`;

  document.getElementById("delete-book").addEventListener("click", async () => {
    const parts = [];
    if (book.notes.length) parts.push(`${book.notes.length} note${book.notes.length === 1 ? "" : "s"}`);
    if (book.sessions.length) parts.push(`${book.sessions.length} reading entr${book.sessions.length === 1 ? "y" : "ies"} (${total} pages, removed from the calendar and streak)`);
    if (book.file_type) parts.push("its file");
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
    const also = parts.length ? `\n\nThis also deletes ${list}.` : "";
    if (!confirm(`Delete "${book.title}"?${also}\n\nThis cannot be undone.`)) return;
    try {
      await api("DELETE", `/api/books/${id}`);
      toast("Book deleted.");
      location.hash = "#/books";
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api("PATCH", `/api/books/${id}`, {
        title: f.title.value, author: f.author.value, total_pages: f.total_pages.value || null, status: f.status.value,
      });
      toast("Saved.");
      route();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast(`Uploading ${file.name}…`);
    try {
      await uploadBookFile(id, file);
      toast("File attached.");
      route();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("note-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api("POST", "/api/notes", { book_id: id, page: f.page.value || null, body: f.body.value });
      toast("Note added.");
      route();
    } catch (err) {
      toast(err.message, true);
    }
  });

  wireNoteActions(view);
}

// ---------- Notes ----------

function renderNoteList(notes, showBook) {
  if (!notes.length) return '<p class="empty-state">No notes yet.</p>';
  // Notes of a book with a file open the reader at their place when clicked.
  return notes.map((n) => `
    <div class="note ${n.file_type ? "openable" : ""}" data-note="${n.id}"
      ${n.file_type ? `data-open="/reader.html?book=${n.book_id}&note=${n.id}" title="Open in the reader at this place"` : ""}>
      <div class="meta">
        <span class="page-tag">${esc(noteLocationLabel(n))}</span>
        ${showBook ? `<a href="#/book/${n.book_id}">${esc(n.title)}</a>` : ""}
        ${n.source === "highlight" ? '<span class="badge">highlight</span>' : ""}
        <span style="flex:1"></span>
        ${n.file_type ? '<span class="go">Open in reader ›</span>' : ""}
        <button class="ghost" data-edit-note="${n.id}">Edit</button>
        <button class="ghost" data-delete-note="${n.id}">Delete</button>
      </div>
      ${n.quote ? `<blockquote>${esc(n.quote)}</blockquote>` : ""}
      <div class="body">${esc(n.body)}</div>
    </div>`).join("");
}

function wireNoteActions(root) {
  root.querySelectorAll(".note.openable").forEach((noteEl) =>
    noteEl.addEventListener("click", (e) => {
      // Buttons, links, the edit box and selecting text keep working as usual.
      if (e.target.closest("button, a, textarea") || noteEl.querySelector("textarea")) return;
      if (!window.getSelection().isCollapsed) return;
      location.href = noteEl.dataset.open;
    }),
  );
  root.querySelectorAll("[data-delete-note]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this note?")) return;
      await api("DELETE", `/api/notes/${btn.dataset.deleteNote}`);
      toast("Note deleted.");
      route();
    }),
  );
  root.querySelectorAll("[data-edit-note]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const noteEl = btn.closest(".note");
      const bodyEl = noteEl.querySelector(".body");
      if (noteEl.querySelector("textarea")) return;
      const current = bodyEl.textContent;
      bodyEl.innerHTML = `<textarea aria-label="Note text">${esc(current)}</textarea>
        <div class="row" style="margin-top:0.5rem"><button data-save>Save</button><button class="secondary" data-cancel>Cancel</button></div>`;
      bodyEl.querySelector("[data-cancel]").onclick = () => { bodyEl.textContent = current; };
      bodyEl.querySelector("[data-save]").onclick = async () => {
        const value = bodyEl.querySelector("textarea").value;
        await api("PATCH", `/api/notes/${btn.dataset.editNote}`, { body: value });
        bodyEl.textContent = value.trim();
        toast("Note saved.");
      };
    }),
  );
}

async function renderNotes() {
  const notes = await api("GET", "/api/notes");
  view.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">What you learned</div><h1>Notes</h1></div>
      <span class="muted">${notes.length} note${notes.length === 1 ? "" : "s"}</span>
    </div>
    <section class="card">
      <label for="note-search">Search notes and highlights</label>
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="note-search" type="search" placeholder="Type a word…">
      </div>
      <div id="notes-list" style="margin-top:0.5rem"></div>
    </section>`;

  const listEl = document.getElementById("notes-list");
  const normalize = (s) => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const draw = (term) => {
    const t = normalize(term);
    const shown = t ? notes.filter((n) => normalize(`${n.quote} ${n.body} ${n.title}`).includes(t)) : notes;
    listEl.innerHTML = renderNoteList(shown, true);
    wireNoteActions(listEl);
  };
  document.getElementById("note-search").addEventListener("input", (e) => draw(e.target.value));
  draw("");
}
