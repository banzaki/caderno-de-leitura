// The notebook UI. A tiny hash router picks which view to draw:
//   #/            Today: goal, streak, log today's reading, calendar
//   #/books       all books, add a book
//   #/book/12     one book: details, file, sessions, notes
//   #/queue       the reading queue, in order; import a queue text file
//   #/notes       every note, with search
import { STATUS_LABELS, api, esc, formatDate, noteLocationLabel, reportOf, toast, todayLocal, wireThemeToggle } from "./common.js";
import { fileKind, readBookFileInfo } from "./book-file.js";
import { fieldsToFill } from "./book-meta.js";

const view = document.getElementById("view");
wireThemeToggle(document.getElementById("theme-toggle"));
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
    } else if (hash === "#/queue") {
      setActiveNav("queue");
      await renderQueue();
    } else if (hash.match(/^#\/year(\/\d{4})?$/)) {
      setActiveNav("year");
      await renderYear(Number(hash.split("/")[2]) || new Date().getFullYear());
    } else if (hash.match(/^#\/close\/\d+$/)) {
      setActiveNav("books");
      await renderClose(Number(hash.split("/")[2]));
    } else if (hash === "#/trash") {
      setActiveNav("books");
      await renderTrash();
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

  const owed = books.filter((b) => b.status === "finished" && !reportOf(b)); // finished, report not written
  const main = reading[0] ?? null; // the main book of the reading desk
  const next = main ? null : books.find((b) => b.status === "queued" && b.queue_position === 1) ?? null;

  view.innerHTML = `
    ${main ? `
    <section class="card desk-main reading-now">
      <a href="#/book/${main.id}" class="desk-cover">${coverHtml(main)}</a>
      <div style="min-width:0">
        <div class="eyebrow">Reading now</div>
        <h2><a href="#/book/${main.id}">${esc(main.title)}</a></h2>
        <div class="author">${esc(main.author) || "Unknown author"}</div>
        ${bookProgress(main)}
        <div class="actions">
          ${main.file_type ? `<a class="button big" href="/reader.html?book=${main.id}">Continue reading</a>` : ""}
          <a class="button ${main.file_type ? "secondary" : "big"}" href="#/book/${main.id}">Open the book</a>
          ${reading.length > 1 ? `<a class="muted small" href="#/books">${reading.length - 1} more on your desk</a>` : ""}
        </div>
      </div>
    </section>` : next ? `
    <section class="card desk-main reading-now">
      <a href="#/book/${next.id}" class="desk-cover">${coverHtml(next)}</a>
      <div style="min-width:0">
        <div class="eyebrow">Up next in your queue</div>
        <h2><a href="#/book/${next.id}">${esc(next.title)}</a></h2>
        <div class="author">${esc(next.author) || "Unknown author"}</div>
        <div class="actions"><button class="big" id="start-next">Start reading</button>
          <a class="button secondary" href="#/queue">See the queue</a></div>
      </div>
    </section>` : ""}

    ${owed.length ? `<section class="card owed-card section">
      <strong>${owed.length === 1 ? "A closing report is owed" : `${owed.length} closing reports are owed`}</strong>
      <span class="muted"> for ${owed.slice(0, 2).map((b) => `<a href="#/close/${b.id}">${esc(b.title)}</a>`).join(", ")}${owed.length > 2 ? ` and ${owed.length - 2} more` : ""}.</span>
    </section>` : ""}

    <div class="grid two ${main || next || owed.length ? "section" : ""}">
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

  document.getElementById("start-next")?.addEventListener("click", async () => {
    try {
      await api("PATCH", `/api/books/${next.id}`, { status: "reading" });
      toast(`Now reading: ${next.title}`);
      route();
    } catch (err) {
      toast(err.message, true);
    }
  });

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
        await offerToFinish(reading.find((b) => b.id === s.book_id), s.to_page);
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

// "17 Nov 2026"
function longDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Finishing a book opens the closing page: review the notes, write the report.
function closeBook(book) {
  location.hash = `#/close/${book.id}`;
}

// After logging pages: when the last page was reached, offer to finish the book.
async function offerToFinish(book, toPage) {
  if (!book || !book.total_pages || toPage < book.total_pages || book.status === "finished") return;
  if (!confirm(`You reached the last page of "${book.title}".\n\nClose the book now? You will review your notes and write a short report.`)) return;
  closeBook(book);
}

// One book on a shelf: the cover and details are a link; buttons may follow below it.
function bookTile(b, { caption = "", controls = "" } = {}) {
  return `<div class="book-tile">
    <a class="book-card" href="#/book/${b.id}">
      ${coverHtml(b)}
      <div><h3>${esc(b.title)}</h3><div class="muted small">${esc(b.author) || "Unknown author"}</div></div>
      ${caption || bookProgress(b)}
      <div class="tags">
        ${b.file_type ? `<span class="badge">${b.file_type.toUpperCase()}</span>` : ""}
        ${b.note_count ? `<span class="badge">${b.note_count} note${b.note_count === 1 ? "" : "s"}</span>` : ""}</div>
    </a>${controls}</div>`;
}

// The reading desk: the main book large, then the other books being read (which can
// be moved or made main), then the paused ones.
function deskHtml(reading, paused) {
  if (!reading.length && !paused.length) {
    return `<div class="card empty-state">Nothing on your desk. Start a book from the <a href="#/queue">Queue</a> or add one below.</div>`;
  }
  const [main, ...others] = reading;
  const mainHtml = main ? `
    <section class="card desk-main">
      <a href="#/book/${main.id}" class="desk-cover">${coverHtml(main)}</a>
      <div style="min-width:0">
        <div class="eyebrow">Main book</div>
        <h2><a href="#/book/${main.id}">${esc(main.title)}</a></h2>
        <div class="author">${esc(main.author) || "Unknown author"}</div>
        ${bookProgress(main)}
        <div class="actions">
          ${main.file_type ? `<a class="button big" href="/reader.html?book=${main.id}">Continue reading</a>` : ""}
          <a class="button secondary" href="#/book/${main.id}">Log pages</a>
          <button class="secondary" data-finish="${main.id}">Mark as finished</button>
        </div>
      </div>
    </section>` : "";
  const othersHtml = others.length ? `
    <h3 class="shelf-title">Also reading</h3>
    <div class="books">${others.map((b, i) => bookTile(b, { controls: `
      <div class="tile-actions">
        <button class="ghost" data-move="${b.id}" data-to="1">Make main</button>
        <span style="flex:1"></span>
        ${i > 0 ? `<button class="ghost" data-move="${b.id}" data-to="${i + 1}" aria-label="Move left" title="Move left">‹</button>` : ""}
        ${i < others.length - 1 ? `<button class="ghost" data-move="${b.id}" data-to="${i + 3}" aria-label="Move right" title="Move right">›</button>` : ""}
      </div>` })).join("")}</div>` : "";
  const pausedHtml = paused.length ? `
    <h3 class="shelf-title">Paused</h3>
    <div class="books">${paused.map((b) => bookTile(b)).join("")}</div>` : "";
  return mainHtml + othersHtml + pausedHtml;
}

async function renderBooks() {
  const all = await api("GET", "/api/books");
  const nowReading = all.filter((b) => b.status === "reading"); // already in desk order
  const paused = all.filter((b) => b.status === "paused");
  const finished = all.filter((b) => b.status === "finished"); // most recently finished first
  const queued = all.filter((b) => b.status === "queued").length; // they live on the Queue page
  view.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Your books</div><h1>Reading desk</h1></div>
      <span class="muted">${nowReading.length + paused.length} on the desk · ${finished.length} in the library${queued ? ` · <a href="#/queue">${queued} in your queue</a>` : ""}</span>
    </div>
    ${deskHtml(nowReading, paused)}

    <div class="page-head section" style="margin-top:2.25rem">
      <div><div class="eyebrow">Finished books</div><h2 style="font-size:1.6rem;margin:0">Library</h2></div>
    </div>
    ${finished.length ? `<div class="books">${finished.map((b) => bookTile(b, {
      caption: `<div class="finished-on">${b.finished_at ? `Finished ${longDate(b.finished_at)}` : "Finished"}</div>
        ${reportOf(b) ? "" : '<div><span class="badge owed">Report owed</span></div>'}`,
    })).join("")}</div>`
      : `<div class="card empty-state">Finished books will stand here.</div>`}

    <details class="card add-book section" ${all.length ? "" : "open"}>
      <summary><span class="plus" aria-hidden="true">+</span> Add a book</summary>
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
    </details>
    <p class="muted small" style="text-align:center;margin-top:1.5rem"><a href="#/trash">Trash</a></p>`;

  view.querySelectorAll("[data-move]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await api("POST", `/api/books/${btn.dataset.move}/move`, { to: Number(btn.dataset.to) });
        if (btn.dataset.to === "1") toast("New main book.");
        route();
      } catch (err) {
        toast(err.message, true);
      }
    }),
  );
  view.querySelectorAll("[data-finish]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const book = all.find((b) => b.id === Number(btn.dataset.finish));
      closeBook(book);
    }),
  );

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
  const onDesk = book.status === "reading" || book.status === "paused";
  // A book taken from the queue can go back to its own place there (an undo).
  const queueButton = book.queue_left_position
    ? `<button class="secondary" data-book-action="queued" title="Back to place ${book.queue_left_position} in the queue">Back to queue</button>`
    : '<button class="secondary" data-book-action="queued">Move to queue</button>';
  setActiveNav(book.status === "queued" ? "queue" : "books");

  view.innerHTML = `
    <a class="back-link" href="#/books">← All books</a>
    <section class="card">
      <div class="book-hero">
        ${coverHtml(book)}
        <div style="min-width:0">
          <div class="row" style="gap:0.4rem;margin-bottom:0.5rem"><span class="badge ${book.status}">${STATUS_LABELS[book.status]}</span>
            ${book.status === "reading" && book.desk_position === 1 ? '<span class="badge main">Main book</span>' : ""}
            ${book.file_type ? `<span class="badge">${book.file_type.toUpperCase()}</span>` : ""}</div>
          <h1>${esc(book.title)}</h1>
          <div class="author">${esc(book.author) || "Unknown author"}</div>
          ${book.status === "finished" && book.finished_at ? `<form id="finished-form" class="finished-on row" style="margin-top:0.3rem;gap:0.5rem">
            <label for="finished-at" style="margin:0">Finished</label>
            <input id="finished-at" type="date" value="${book.finished_at}" max="${todayLocal()}" required style="width:auto">
            <button type="submit" class="ghost">Save date</button></form>` : ""}
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
            ${{
              reading: `<button class="secondary" data-book-action="finish">Mark as finished</button>${queueButton}`,
              paused: `<button class="secondary" data-book-action="reading">Resume reading</button><button class="secondary" data-book-action="finish">Mark as finished</button>${queueButton}`,
              finished: '<button class="secondary" data-book-action="reading">Read again</button>',
              queued: '<button class="secondary" data-book-action="reading">Start reading</button>',
            }[book.status]}
            ${book.notes.length ? `<a class="button secondary" href="/api/books/${book.id}/export" download>Export notes</a>` : ""}
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

    ${book.status === "finished" ? reportCard(book) : ""}

    <div class="grid two section">
      <section class="card">
        ${onDesk ? `
        <h2>Log reading</h2>
        <form id="book-log-form" class="fields">
          <div><label for="bl-from">From page</label><input id="bl-from" name="from_page" type="number" min="1" required value="${book.current_page + 1}"></div>
          <div><label for="bl-to">To page</label><input id="bl-to" name="to_page" type="number" min="1" ${book.total_pages ? `max="${book.total_pages}"` : ""} required></div>
          <div><label for="bl-date">Date</label><input id="bl-date" name="date" type="date" value="${todayLocal()}" max="${todayLocal()}" required></div>
          <div class="wide row spread"><span class="computed" id="bl-computed"></span><button type="submit">Save</button></div>
        </form>
        <h2 style="margin-top:1.5rem">Reading history</h2>` : "<h2>Reading history</h2>"}
        ${book.sessions.length ? `<ul class="list">${book.sessions.map((s) => `
          <li><div class="grow">${formatDate(s.date)}<div class="muted small">pages ${s.from_page}–${s.to_page}</div></div><span class="pages-pill">${s.pages} p.</span></li>`).join("")}</ul>`
        : '<p class="empty-state">No reading logged for this book yet.</p>'}
      </section>
      <section class="card">
        <h2>Notes</h2>
        <form id="note-form" class="fields">
          <div><label for="n-page">Page</label><input id="n-page" name="page" type="number" min="1" value="${book.current_page || ""}"></div>
          <div class="wide"><label for="n-body">What did you learn?</label><textarea id="n-body" name="body" required></textarea></div>
          <div><button type="submit">Add note</button></div>
        </form>
        <div id="book-notes" style="margin-top:1rem">${renderNoteList(book.notes.map((n) => ({ ...n, file_type: book.file_type })), false)}</div>
      </section>
    </div>`;

  view.querySelectorAll("[data-book-action]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        if (btn.dataset.bookAction === "finish") {
          closeBook(book);
          return;
        } else {
          const updated = await api("PATCH", `/api/books/${id}`, { status: btn.dataset.bookAction });
          toast(updated.status === "queued" ? `Back in the queue, at place ${updated.queue_position}.`
            : book.status === "finished" ? "Back on your reading desk." : "On your reading desk.");
        }
        route();
      } catch (err) {
        toast(err.message, true);
      }
    }),
  );

  const logForm = document.getElementById("book-log-form");
  if (logForm) {
    const f = logForm.elements;
    const computed = document.getElementById("bl-computed");
    const update = () => {
      const from = Number(f.from_page.value);
      const to = Number(f.to_page.value);
      computed.textContent = from && to && to >= from ? `${to - from + 1} pages` : "";
    };
    f.from_page.addEventListener("input", update);
    f.to_page.addEventListener("input", update);
    logForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const s = await api("POST", "/api/sessions", {
          book_id: id, from_page: Number(f.from_page.value), to_page: Number(f.to_page.value), date: f.date.value,
        });
        toast(`Saved: ${s.pages} pages.`);
        await offerToFinish(book, s.to_page);
        route();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  document.getElementById("finished-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("PATCH", `/api/books/${id}`, { finished_at: document.getElementById("finished-at").value });
      toast("Finish date saved.");
      route();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("delete-book").addEventListener("click", async () => {
    if (!confirm(`Move "${book.title}" to the trash?

Its notes, reading history and file go with it. You can restore it for 30 days.`)) return;
    try {
      await api("DELETE", `/api/books/${id}`);
      toast("Moved to the trash. You can restore it for 30 days.");
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

// ---------- Year in reading ----------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Slides, one at a time: use the buttons, the dots or the arrow keys.
async function renderYear(year) {
  const y = await api("GET", `/api/year/${year}`);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const empty = !y.books_finished && !y.pages;
  const maxMonth = Math.max(...y.per_month, 1);
  const slides = [];

  slides.push(`<div class="slide-eyebrow">Your reading year</div><div class="slide-giant">${year}</div>
    <p class="slide-line">${empty ? "Nothing read yet this year. Log some pages and come back." : "Here is how it went."}</p>`);
  if (!empty) {
    slides.push(`<div class="slide-eyebrow">Books finished</div><div class="slide-giant">${y.books_finished}</div>
      ${y.finished.length ? `<ul class="slide-list">${y.finished.slice(0, 8).map((b) => `<li><a href="#/book/${b.id}">${esc(b.title)}</a>
        <span>${longDate(b.finished_at)}</span></li>`).join("")}</ul>${y.finished.length > 8 ? `<p class="slide-small">and ${y.finished.length - 8} more</p>` : ""}`
        : '<p class="slide-line">None closed yet. The first one is the hardest.</p>'}`);
    slides.push(`<div class="slide-eyebrow">Pages read</div><div class="slide-giant">${y.pages.toLocaleString("en-GB")}</div>
      <p class="slide-line">on ${plural(y.days_read, "day")}, about ${y.pages_per_day} pages each time you sat down.</p>
      ${y.best_day ? `<p class="slide-small">Your biggest day: ${y.best_day.pages} pages on ${longDate(y.best_day.date)}.</p>` : ""}`);
    slides.push(`<div class="slide-eyebrow">Your rhythm</div>
      <div class="slide-giant">${y.longest_streak}</div><p class="slide-line">${y.longest_streak === 1 ? "day" : "days"} in a row, your longest streak.</p>
      <div class="month-bars" role="img" aria-label="Pages read per month">${y.per_month.map((p, i) => `
        <div class="month-bar ${y.best_month?.month === i + 1 ? "best" : ""}"><span style="height:${Math.round((p / maxMonth) * 100)}%"></span><small>${MONTHS[i][0]}</small></div>`).join("")}</div>
      ${y.best_month ? `<p class="slide-small">Strongest month: ${MONTH_NAMES[y.best_month.month - 1]}, ${y.best_month.pages} pages.</p>` : ""}`);
    if (y.favorite_author) {
      slides.push(`<div class="slide-eyebrow">Your author of the year</div><div class="slide-name">${esc(y.favorite_author.name)}</div>
        <p class="slide-line">${plural(y.favorite_author.books, "book")} finished.</p>`);
    }
    if (y.top_rated.length) {
      slides.push(`<div class="slide-eyebrow">Your favorite${y.top_rated.length > 1 ? "s" : ""}</div>
        <div class="slide-stars">${"★".repeat(y.top_rated[0].rating)}</div>
        <ul class="slide-list">${y.top_rated.map((b) => `<li><a href="#/book/${b.id}">${esc(b.title)}</a></li>`).join("")}</ul>`);
    }
    slides.push(`<div class="slide-eyebrow">Your best notes</div>
      ${y.best_notes.length ? y.best_notes.slice(0, 5).map((n) => `<figure class="slide-quote">
          <blockquote>${esc(n.quote || n.body)}</blockquote>
          <figcaption><a href="#/book/${n.book_id}">${esc(n.title)}</a>${n.page ? ` · ${esc(noteLocationLabel(n))}` : ""}</figcaption></figure>`).join("")
        : `<p class="slide-line">You wrote ${plural(y.notes_written, "note")}. Pick the best ones when you close a book, and they will show here.</p>`}`);
    slides.push(`<div class="slide-eyebrow">How your books changed you</div>
      ${y.changed_me.length ? y.changed_me.slice(0, 5).map((b) => `<figure class="slide-quote">
          <blockquote class="prewrap">${esc(b.change)}</blockquote>
          <figcaption><a href="#/book/${b.id}">${esc(b.title)}</a></figcaption></figure>`).join("")
        : '<p class="slide-line">No closing reports yet. They are the heart of this page.</p>'}
      ${y.reports_owed ? `<p class="slide-small">${plural(y.reports_owed, "report")} still owed.</p>` : ""}`);
  }

  view.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Wrapped</div><h1>Year in reading</h1></div>
      <span class="row" style="gap:0.4rem">${[...new Set([...y.years, year])].sort().map((n) =>
        `<a class="button ${n === year ? "" : "secondary"}" href="#/year/${n}">${n}</a>`).join("")}</span></div>
    <section class="slide-deck card" aria-roledescription="carousel">
      <div class="slide-stage" id="slide-stage" aria-live="polite"></div>
      <div class="slide-nav">
        <button class="secondary" id="slide-prev" aria-label="Previous">‹</button>
        <span class="dots" id="slide-dots">${slides.map((_, i) => `<button class="dot" data-slide="${i}" aria-label="Slide ${i + 1}"></button>`).join("")}</span>
        <button class="secondary" id="slide-next" aria-label="Next">›</button>
      </div>
    </section>`;

  let index = 0;
  const stage = document.getElementById("slide-stage");
  const show = (i) => {
    index = Math.min(Math.max(i, 0), slides.length - 1);
    stage.className = `slide-stage tone${index % 6}`;
    stage.innerHTML = `<div class="slide-body">${slides[index]}</div>`;
    document.querySelectorAll("#slide-dots .dot").forEach((d, n) => d.classList.toggle("on", n === index));
    document.getElementById("slide-prev").disabled = index === 0;
    document.getElementById("slide-next").disabled = index === slides.length - 1;
  };
  document.getElementById("slide-prev").addEventListener("click", () => show(index - 1));
  document.getElementById("slide-next").addEventListener("click", () => show(index + 1));
  document.querySelectorAll("#slide-dots .dot").forEach((d) => d.addEventListener("click", () => show(Number(d.dataset.slide))));
  const onKey = (e) => {
    if (!document.getElementById("slide-stage")) return window.removeEventListener("keydown", onKey);
    if (e.target.matches?.("input, textarea, select")) return;
    if (e.key === "ArrowRight") show(index + 1);
    if (e.key === "ArrowLeft") show(index - 1);
  };
  window.addEventListener("keydown", onKey);
  show(0);
}

// ---------- Closing a book ----------

// On the book page of a finished book: the report, or the reminder that it is owed.
function reportCard(book) {
  const report = reportOf(book);
  if (!report) {
    return `<section class="card section owed-card">
      <h2>Report owed</h2>
      <p class="muted">You finished this book without closing it. Review your notes and write how it changed you.</p>
      <a class="button" href="#/close/${book.id}">Write the report</a></section>`;
  }
  return `<section class="card section report">
    <div class="row spread"><h2 style="margin:0">Closing report</h2>
      <span class="row" style="gap:0.5rem">${report.rating ? `<span class="stars" title="${report.rating} of 5">${"★".repeat(report.rating)}${"☆".repeat(5 - report.rating)}</span>` : ""}
      <a class="button secondary" href="#/close/${book.id}">Edit report</a></span></div>
    ${report.summary ? `<h3>In one sentence</h3><p>${esc(report.summary)}</p>` : ""}
    ${report.ideas.length ? `<h3>Ideas to keep</h3><ol>${report.ideas.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>` : ""}
    <h3>How this book changed me</h3><p class="prewrap">${esc(report.change)}</p>
    ${report.recommend ? `<h3>I would recommend it to</h3><p>${esc(report.recommend)}</p>` : ""}</section>`;
}

// The closing page: 1) look back at your notes and pick the best ones, 2) write the report.
async function renderClose(id) {
  const book = await api("GET", `/api/books/${id}`);
  const report = reportOf(book);
  const finished = book.status === "finished";
  const ideas = [...(report?.ideas ?? []), "", "", ""].slice(0, 3);
  view.innerHTML = `
    <a class="back-link" href="#/book/${id}">← ${esc(book.title)}</a>
    <div class="page-head"><div><div class="eyebrow">${finished ? "Closing report" : "Closing the book"}</div><h1>${esc(book.title)}</h1></div></div>

    <section class="card">
      <h2>1. Look back at your notes</h2>
      ${book.notes.length ? `<p class="muted">Read them again. Pick up to 3 that you want to keep as the best of this book.
        <strong id="picked-count"></strong></p>
      <div id="close-notes">${book.notes.map((n) => `
        <label class="note pick" for="pick-${n.id}">
          <input type="checkbox" id="pick-${n.id}" value="${n.id}" ${n.starred ? "checked" : ""}>
          <span><span class="page-tag">${esc(noteLocationLabel(n))}</span>
            ${n.quote ? `<blockquote>${esc(n.quote)}</blockquote>` : ""}
            ${n.body ? `<div class="body">${esc(n.body)}</div>` : ""}</span>
        </label>`).join("")}</div>`
        : '<p class="muted">You took no notes for this book. You can still write the report.</p>'}
    </section>

    <section class="card section">
      <h2>2. Pay the price: write the report</h2>
      <form id="close-form" class="fields">
        <div class="wide"><label for="c-summary">What is this book about, in one sentence?</label>
          <input id="c-summary" name="summary" maxlength="1000" value="${esc(report?.summary ?? "")}"></div>
        <div class="wide"><label>Which 3 ideas will you keep?</label>
          ${ideas.map((idea, i) => `<input name="idea${i}" maxlength="1000" placeholder="Idea ${i + 1}" value="${esc(idea)}" style="margin-bottom:0.4rem">`).join("")}</div>
        <div class="wide"><label for="c-change">How did this book change you? What will you do differently? <strong>(required)</strong></label>
          <textarea id="c-change" name="change" rows="6" maxlength="5000" placeholder="Be honest and specific. This is the price of closing the book.">${esc(report?.change ?? "")}</textarea></div>
        <div><label for="c-rating">Rating</label><select id="c-rating" name="rating">
          <option value="">No rating</option>
          ${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${report?.rating === n ? "selected" : ""}>${"★".repeat(n)}${"☆".repeat(5 - n)}  ${n}/5</option>`).join("")}</select></div>
        <div><label for="c-recommend">Who would you recommend it to?</label>
          <input id="c-recommend" name="recommend" maxlength="1000" value="${esc(report?.recommend ?? "")}"></div>
        <div class="wide row" style="gap:0.6rem;flex-wrap:wrap">
          <button type="submit" class="big">${finished ? "Save report" : "Close the book"}</button>
          ${finished ? "" : '<button type="button" class="ghost" id="finish-without">Finish without the report</button>'}
        </div>
        ${finished ? "" : '<p class="wide muted small" style="margin:0">Finishing without the report is allowed, but the book will show "Report owed" until you write it.</p>'}
      </form>
    </section>`;

  const boxes = [...view.querySelectorAll("#close-notes input")];
  const updatePicks = () => {
    const n = boxes.filter((b) => b.checked).length;
    const counter = document.getElementById("picked-count");
    if (counter) counter.textContent = `${n} of 3 picked.`;
    for (const b of boxes) b.disabled = !b.checked && n >= 3;
  };
  boxes.forEach((b) => b.addEventListener("change", updatePicks));
  updatePicks();

  const finish = () => api("PATCH", `/api/books/${id}`, { status: "finished", finished_on: todayLocal() });
  document.getElementById("close-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api("PUT", `/api/books/${id}/report`, {
        summary: f.summary.value, ideas: [f.idea0.value, f.idea1.value, f.idea2.value], change: f.change.value,
        rating: f.rating.value || null, recommend: f.recommend.value,
        best_note_ids: boxes.filter((b) => b.checked).map((b) => Number(b.value)),
      });
      if (!finished) await finish();
      toast(finished ? "Report saved." : `"${book.title}" is closed and in your library.`);
      location.hash = `#/book/${id}`;
    } catch (err) {
      toast(err.message, true);
    }
  });
  document.getElementById("finish-without")?.addEventListener("click", async () => {
    if (!confirm("Finish the book without the report?\n\nIt goes to your library marked \"Report owed\" until you write it.")) return;
    try {
      await finish();
      toast("Finished. The report is still owed.");
      location.hash = `#/book/${id}`;
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- Trash ----------

async function renderTrash() {
  const trash = await api("GET", "/api/trash");
  view.innerHTML = `
    <a class="back-link" href="#/books">← All books</a>
    <div class="page-head"><div><div class="eyebrow">Deleted books</div><h1>Trash</h1></div>
      <span class="muted">${trash.length} book${trash.length === 1 ? "" : "s"}</span></div>
    <p class="muted">A deleted book waits here for 30 days with its notes, reading history and file. Then it is erased for good.</p>
    ${trash.length ? `<section class="card"><ul class="list">${trash.map((b) => `
      <li><div class="grow"><strong>${esc(b.title)}</strong>
        <div class="muted small">${esc(b.author) || "Unknown author"} · ${b.days_left} day${b.days_left === 1 ? "" : "s"} left</div></div>
        <button class="secondary" data-restore="${b.id}">Restore</button>
        <button class="danger" data-erase="${b.id}">Delete forever</button></li>`).join("")}</ul></section>`
      : '<div class="card empty-state">The trash is empty.</div>'}`;
  view.querySelectorAll("[data-restore]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const book = await api("POST", `/api/books/${btn.dataset.restore}/restore`);
        toast(`"${book.title}" is back.`);
        renderTrash();
      } catch (err) {
        toast(err.message, true);
      }
    }),
  );
  view.querySelectorAll("[data-erase]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const book = trash.find((b) => b.id === Number(btn.dataset.erase));
      if (!confirm(`Delete "${book.title}" forever?

Its notes, reading history and file are erased. This cannot be undone.`)) return;
      try {
        await api("DELETE", `/api/trash/${book.id}`);
        toast("Deleted for good.");
        renderTrash();
      } catch (err) {
        toast(err.message, true);
      }
    }),
  );
}

// ---------- Queue ----------

// importResult: the report of an import just made, shown above the list.
async function renderQueue(importResult = null) {
  const queue = await api("GET", "/api/queue");
  view.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Up next</div><h1>Queue</h1></div>
      <span class="muted">${queue.length} book${queue.length === 1 ? "" : "s"}</span>
    </div>
    <section class="card">
      ${queue.length ? `<details class="edit" style="margin:0;border:0;padding:0"><summary>Import from a text file</summary>${importForm()}</details>`
        : `<h2>Import your reading list</h2>${importForm()}`}
      <div id="import-result"></div>
    </section>
    ${queue.length ? `
    <section class="card section">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="queue-search" type="search" placeholder="Find a book in the queue…" aria-label="Find a book in the queue">
      </div>
      <ol class="queue-list" id="queue-list">${queue.map((b) => `
        <li data-search="${esc(normalizeText(`${b.title} ${b.author}`))}" data-id="${b.id}">
          <span class="grip" title="Hold and drag to reorder" aria-label="Drag to reorder">⠿</span>
          <span class="queue-pos">${b.queue_position}</span>
          <a class="queue-book" href="#/book/${b.id}"><strong>${esc(b.title)}</strong>
            <span class="muted small">${esc(b.author) || "Unknown author"}</span></a>
          <span class="queue-actions">${b.queue_position > 1 ? `<button class="ghost" data-top="${b.id}" title="Move to the top of the queue">↑ Top</button>` : ""}
          <button class="secondary" data-start="${b.id}">Start reading</button></span>
        </li>`).join("")}</ol>
      <p class="empty-state" id="queue-none" hidden>No book in the queue matches.</p>
    </section>` : ""}`;

  wireImport();
  if (importResult) showImportResult(importResult);
  const search = document.getElementById("queue-search");
  search?.addEventListener("input", () => {
    const term = normalizeText(search.value);
    let shown = 0;
    for (const li of document.querySelectorAll("#queue-list li")) {
      li.hidden = Boolean(term) && !li.dataset.search.includes(term);
      if (!li.hidden) shown++;
    }
    document.getElementById("queue-none").hidden = shown > 0;
  });
  view.querySelectorAll("[data-top]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        await api("POST", `/api/books/${btn.dataset.top}/queue-move`, { to: 1 });
        await renderQueue();
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err) {
        toast(err.message, true);
      }
    }),
  );
  wireQueueDrag(document.getElementById("queue-list"));
  view.querySelectorAll("[data-start]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const book = await api("PATCH", `/api/books/${btn.dataset.start}`, { status: "reading" });
        toast(`Now reading: ${book.title}`);
        await renderQueue();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    }),
  );
}

// Drag to reorder: hold the grip (mouse or finger) and move up or down; the list scrolls
// when the pointer nears the screen edge. The new place is saved when you let go.
function wireQueueDrag(list) {
  if (!list) return;
  list.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".grip");
    const item = grip?.closest("li");
    if (!item || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const from = [...list.children].indexOf(item);
    item.classList.add("dragging");
    let lastY = e.clientY;
    let scroller = null;

    const placeItem = () => {
      const others = [...list.children].filter((li) => li !== item && !li.hidden);
      const before = others.find((li) => {
        const r = li.getBoundingClientRect();
        return lastY < r.top + r.height / 2;
      });
      if (before) list.insertBefore(item, before);
      else list.append(item);
    };
    const onMove = (ev) => {
      lastY = ev.clientY;
      placeItem();
      const edge = 80;
      clearInterval(scroller);
      if (lastY < edge || lastY > window.innerHeight - edge) {
        const speed = lastY < edge ? -14 : 14;
        scroller = setInterval(() => { window.scrollBy(0, speed); placeItem(); }, 16);
      }
    };
    const finish = async (ev) => {
      clearInterval(scroller);
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", finish);
      grip.removeEventListener("pointercancel", finish);
      item.classList.remove("dragging");
      const to = [...list.children].indexOf(item) + 1;
      if (ev.type === "pointercancel" || to - 1 === from) return;
      try {
        await api("POST", `/api/books/${item.dataset.id}/queue-move`, { to });
        toast(`Moved to place ${to}.`);
      } catch (err) {
        toast(err.message, true);
      }
      await renderQueue();
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);
  });
}

function normalizeText(s) {
  return String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function importForm() {
  return `
    <p class="muted small" style="margin:0.75rem 0">A plain text file with one book per line, like
      <code>[ ] 1. Title — Author</code>. Books go to the end of the queue in the file's order.
      Books you already have are skipped.</p>
    <label class="dropzone" for="queue-file">
      <span class="icon">${FILE_ICON}</span>
      <span><strong>Choose the .txt file</strong><span class="muted small">Or drag it here.</span></span>
      <input id="queue-file" type="file" accept=".txt,text/plain">
    </label>`;
}

function wireImport() {
  const input = document.getElementById("queue-file");
  const out = document.getElementById("import-result");
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    out.innerHTML = '<p class="muted">Importing…</p>';
    try {
      const result = await api("POST", "/api/queue/import", { text: await file.text() });
      toast(`${result.added} book${result.added === 1 ? "" : "s"} added to the queue.`);
      await renderQueue(result);
    } catch (err) {
      out.innerHTML = "";
      toast(err.message, true);
    }
  });
}

function showImportResult(result) {
  const lines = [
    ...result.skipped.map((s) => `<li>#${s.number} ${esc(s.title)}: skipped, ${esc(s.reason)}${s.existing ? ` as <a href="#/book/${s.existing.id}">${esc(s.existing.title)}</a>` : ""}</li>`),
    ...result.invalid.map((s) => `<li>Line ${s.line} was not understood: <code>${esc(s.text)}</code></li>`),
  ];
  document.getElementById("import-result").innerHTML = `
    <div class="import-result"><strong>${result.added} book${result.added === 1 ? "" : "s"} added.</strong>
      ${lines.length ? `<ul>${lines.join("")}</ul>` : ""}</div>`;
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
        ${n.starred ? '<span class="badge star" title="One of the best notes">★ best</span>' : ""}
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
