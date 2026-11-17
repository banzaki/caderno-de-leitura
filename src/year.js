// "Your year in reading": numbers and highlights computed from the notebook's own data.
// Pure: takes rows, returns a summary. No AI and no network, only counting.
import { addDays } from "./stats.js";

// Longest run of consecutive days in a sorted list of unique dates (YYYY-MM-DD).
export function longestStreak(dates) {
  let best = 0;
  let run = 0;
  let previous = null;
  for (const date of dates) {
    run = previous && addDays(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

// "A and B", "A, B" and "A & B" become separate authors.
export function splitAuthors(author) {
  return author
    .split(/\s*(?:,|;|&|\se\s|\sand\s)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

// books: finished or not, with { id, title, author, finished_at, report (JSON text or null) }
// sessions: { book_id, date, pages }
// notes: { book_id, created_at, quote, body, page, page_kind, starred }
export function yearSummary({ year, books, sessions, notes }) {
  const prefix = `${year}-`;
  const byId = new Map(books.map((b) => [b.id, b]));

  const finished = books
    .filter((b) => b.status === "finished" && b.finished_at?.startsWith(prefix))
    .sort((a, b) => a.finished_at.localeCompare(b.finished_at) || a.id - b.id)
    .map((b) => {
      let report = null;
      try { report = b.report ? JSON.parse(b.report) : null; } catch { /* unreadable report: treated as none */ }
      return { id: b.id, title: b.title, author: b.author, finished_at: b.finished_at, total_pages: b.total_pages, report };
    });

  const mine = sessions.filter((s) => s.date.startsWith(prefix));
  const perDay = new Map();
  for (const s of mine) perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.pages);
  const days = [...perDay.keys()].sort();
  const pages = [...perDay.values()].reduce((a, b) => a + b, 0);

  const perMonth = Array.from({ length: 12 }, () => 0);
  for (const [date, p] of perDay) perMonth[Number(date.slice(5, 7)) - 1] += p;
  const bestMonthPages = Math.max(...perMonth);
  const bestDay = [...perDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;

  // Favorite author: the one with the most finished books; pages read break a tie, then the order on the book.
  const authors = new Map();
  for (const b of finished) {
    for (const name of splitAuthors(b.author)) {
      const entry = authors.get(name) ?? { name, books: 0, pages: 0 };
      entry.books += 1;
      entry.pages += b.total_pages ?? 0;
      authors.set(name, entry);
    }
  }
  const favoriteAuthor = [...authors.values()].sort((a, b) => b.books - a.books || b.pages - a.pages)[0] ?? null; // on a full tie the first one listed wins

  // Best notes: the starred ones of books finished this year, then of any note written this year.
  const finishedIds = new Set(finished.map((b) => b.id));
  const best = notes
    .filter((n) => n.starred && (finishedIds.has(n.book_id) || n.created_at.startsWith(prefix)))
    .map((n) => ({ id: n.id, book_id: n.book_id, title: byId.get(n.book_id)?.title ?? "", quote: n.quote, body: n.body, page: n.page, page_kind: n.page_kind }));
  const notesWritten = notes.filter((n) => n.created_at.startsWith(prefix)).length;

  const rated = finished.filter((b) => b.report?.rating);
  const topRating = rated.length ? Math.max(...rated.map((b) => b.report.rating)) : null;

  return {
    year,
    books_finished: finished.length,
    finished,
    pages,
    days_read: days.length,
    pages_per_day: days.length ? Math.round(pages / days.length) : 0,
    longest_streak: longestStreak(days),
    per_month: perMonth,
    best_month: bestMonthPages > 0 ? { month: perMonth.indexOf(bestMonthPages) + 1, pages: bestMonthPages } : null,
    best_day: bestDay ? { date: bestDay[0], pages: bestDay[1] } : null,
    favorite_author: favoriteAuthor,
    notes_written: notesWritten,
    best_notes: best,
    top_rated: topRating ? finished.filter((b) => b.report?.rating === topRating).map((b) => ({ id: b.id, title: b.title, rating: topRating })) : [],
    changed_me: finished.filter((b) => b.report?.change).map((b) => ({ id: b.id, title: b.title, change: b.report.change })),
    reports_owed: finished.filter((b) => !b.report).length,
  };
}
