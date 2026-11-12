// The notebook UI. A tiny hash router picks which view to draw:
//   #/            Today: goal, streak, log today's reading, calendar
//   #/books       all books, add a book
//   #/book/12     one book: details, file, sessions, notes
//   #/notes       every note, with search
import { STATUS_LABELS, api, esc, formatDate, noteLocationLabel, toast, todayLocal } from "./common.js";

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

  view.innerHTML = `
    <div class="grid two">
      <section class="card">
        <div class="goal">
          <div class="ring" style="--p:${percent}"><div><div><strong>${stats.today.pages}</strong><br><span class="muted small">of ${stats.goal} pages</span></div></div></div>
          <div class="stack">
            <h1>${left === 0 ? "Goal reached today" : `${left} pages to go today`}</h1>
            <div class="row">
              <div><div class="big-number">${stats.streak}</div><div class="muted small">day streak</div></div>
              <div style="margin-left:1.5rem"><div class="big-number">${stats.days_met}</div><div class="muted small">days on goal</div></div>
            </div>
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

    <div class="grid two" style="margin-top:1rem">
      <section class="card" id="calendar-card"></section>
      <section class="card">
        <h2>Recent reading</h2>
        ${sessions.length ? `<ul class="list">${sessions.map((s) => `
          <li><div class="grow"><strong>${esc(s.title)}</strong><div class="muted small">${formatDate(s.date)} · pages ${s.from_page}–${s.to_page}</div></div>
          <span>${s.pages} p.</span>
          <button class="ghost" data-delete-session="${s.id}" title="Delete this entry" aria-label="Delete this entry">✕</button></li>`).join("")}</ul>`
        : `<p class="empty-state">Nothing logged yet.</p>`}
      </section>
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

async function renderBooks() {
  const books = await api("GET", "/api/books");
  view.innerHTML = `
    <section class="card">
      <h2>Add a book</h2>
      <form id="book-form" class="fields">
        <div class="wide"><label for="b-title">Title</label><input id="b-title" name="title" required maxlength="300"></div>
        <div><label for="b-author">Author</label><input id="b-author" name="author" maxlength="300"></div>
        <div><label for="b-pages">Total pages</label><input id="b-pages" name="total_pages" type="number" min="1"></div>
        <div><label for="b-status">Status</label><select id="b-status" name="status">
          ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
        <div><button type="submit">Add book</button></div>
      </form>
    </section>
    <section style="margin-top:1rem">
      ${books.length ? `<div class="books">${books.map((b) => `
        <a class="card book-card" href="#/book/${b.id}">
          <div class="row spread"><span class="badge ${b.status}">${STATUS_LABELS[b.status]}</span>
            ${b.file_type ? `<span class="badge">${b.file_type.toUpperCase()}</span>` : ""}</div>
          <h3 style="margin-top:0.5rem">${esc(b.title)}</h3>
          <div class="muted small">${esc(b.author) || "Unknown author"}</div>
          ${bookProgress(b)}
          <div class="muted small">${b.note_count} note${b.note_count === 1 ? "" : "s"}</div>
        </a>`).join("")}</div>`
      : `<div class="card empty-state">No books yet. Add the one you are reading above.</div>`}
    </section>`;

  document.getElementById("book-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      const book = await api("POST", "/api/books", {
        title: f.title.value,
        author: f.author.value,
        total_pages: f.total_pages.value || null,
        status: f.status.value,
      });
      toast("Book added.");
      location.hash = `#/book/${book.id}`;
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function renderBook(id) {
  const book = await api("GET", `/api/books/${id}`);
  const total = book.sessions.reduce((sum, s) => sum + s.pages, 0);

  view.innerHTML = `
    <p><a href="#/books">← All books</a></p>
    <div class="grid two">
      <section class="card">
        <div class="row spread"><h1>${esc(book.title)}</h1><span class="badge ${book.status}">${STATUS_LABELS[book.status]}</span></div>
        <div class="muted">${esc(book.author) || "Unknown author"}</div>
        ${bookProgress(book)}
        <form id="edit-form" class="fields" style="margin-top:1rem">
          <div class="wide"><label for="e-title">Title</label><input id="e-title" name="title" value="${esc(book.title)}" required maxlength="300"></div>
          <div><label for="e-author">Author</label><input id="e-author" name="author" value="${esc(book.author)}" maxlength="300"></div>
          <div><label for="e-pages">Total pages</label><input id="e-pages" name="total_pages" type="number" min="1" value="${book.total_pages ?? ""}"></div>
          <div><label for="e-status">Status</label><select id="e-status" name="status">
            ${Object.entries(STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${v === book.status ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div><button type="submit" class="secondary">Save changes</button></div>
        </form>
      </section>

      <section class="card stack">
        <h2>Read inside the app</h2>
        ${book.file_type
          ? `<p>File: <strong>${esc(book.file_name)}</strong></p>
             <a class="button" href="/reader.html?book=${book.id}">Open reader</a>`
          : '<p class="muted">Attach the PDF or EPUB of this book to read it here. Each highlight becomes a note with its page.</p>'}
        <div><label for="file-input">${book.file_type ? "Replace file" : "Attach a file"} (PDF or EPUB)</label>
          <input id="file-input" type="file" accept=".pdf,.epub,application/pdf,application/epub+zip"></div>
        <p class="muted small">${total} pages logged in ${book.sessions.length} session${book.sessions.length === 1 ? "" : "s"}.</p>
      </section>
    </div>

    <div class="grid two" style="margin-top:1rem">
      <section class="card">
        <h2>Notes</h2>
        <form id="note-form" class="fields">
          <div><label for="n-page">Page</label><input id="n-page" name="page" type="number" min="1" value="${book.current_page || ""}"></div>
          <div class="wide"><label for="n-body">What did you learn?</label><textarea id="n-body" name="body" required></textarea></div>
          <div><button type="submit">Add note</button></div>
        </form>
        <div id="book-notes" style="margin-top:1rem">${renderNoteList(book.notes, false)}</div>
      </section>
      <section class="card">
        <h2>Reading history</h2>
        ${book.sessions.length ? `<ul class="list">${book.sessions.map((s) => `
          <li><div class="grow">${formatDate(s.date)}<div class="muted small">pages ${s.from_page}–${s.to_page}</div></div><span>${s.pages} p.</span></li>`).join("")}</ul>`
        : '<p class="empty-state">No reading logged for this book yet.</p>'}
      </section>
    </div>`;

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
      const res = await fetch(`/api/books/${id}/file`, {
        method: "PUT",
        headers: { "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
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
  return notes.map((n) => `
    <div class="note" data-note="${n.id}">
      <div class="meta">
        <span class="page-tag">${esc(noteLocationLabel(n))}</span>
        ${showBook ? `<a href="#/book/${n.book_id}">${esc(n.title)}</a>` : ""}
        ${n.source === "highlight" ? '<span class="badge">highlight</span>' : ""}
        <span style="flex:1"></span>
        <button class="ghost" data-edit-note="${n.id}">Edit</button>
        <button class="ghost" data-delete-note="${n.id}">Delete</button>
      </div>
      ${n.quote ? `<blockquote>${esc(n.quote)}</blockquote>` : ""}
      <div class="body">${esc(n.body)}</div>
    </div>`).join("");
}

function wireNoteActions(root) {
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
    <section class="card">
      <div class="row spread"><h1>All notes</h1><span class="muted">${notes.length} note${notes.length === 1 ? "" : "s"}</span></div>
      <label for="note-search">Search notes and highlights</label>
      <input id="note-search" type="search" placeholder="Type a word…">
      <div id="notes-list" style="margin-top:1rem"></div>
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
