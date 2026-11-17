// Helpers shared by the notebook (app.js) and the reader (reader.js).

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
  return data;
}

// Escapes text before putting it inside HTML, so book titles or notes can never break the page.
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Today's date on this computer, as YYYY-MM-DD.
export function todayLocal(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

let toastTimer;
export function toast(message, isError = false) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

// How a note shows where it is in the book.
export function noteLocationLabel(note) {
  if (note.page) {
    if (note.page_kind === "print") return `p. ${note.page} (print edition)`;
    if (note.page_kind === "computed") return `p. ${note.page} (counted by the app)`;
    return `p. ${note.page}`;
  }
  if (note.percent !== null && note.percent !== undefined) {
    return `${Number(note.percent).toFixed(1)}% of the book (this EPUB has no page numbers)`;
  }
  return "No page";
}

// The dark/light button: flips the theme, remembers it, and tells the page (event "themechange").
export function wireThemeToggle(button) {
  const paint = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    button.innerHTML = dark ? '<span aria-hidden="true">☀</span><span class="toggle-text"> Light</span>' : '<span aria-hidden="true">☾</span><span class="toggle-text"> Dark</span>';
    button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  };
  button.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* not saved, still applied */ }
    paint();
    window.dispatchEvent(new Event("themechange"));
  });
  paint();
}

// The closing report of a book (an object), or null when it has none yet.
export function reportOf(book) {
  try {
    return book.report ? JSON.parse(book.report) : null;
  } catch {
    return null;
  }
}

export const STATUS_LABELS = { reading: "Reading", queued: "In queue", paused: "Paused", finished: "Finished" };

export function formatDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
