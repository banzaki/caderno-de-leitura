// The year in reading: numbers computed from books, sessions and notes.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { longestStreak, splitAuthors, yearSummary } from "../src/year.js";
import { startApp } from "./helpers.js";

test("longest streak counts consecutive days, across month and year ends", () => {
  assert.equal(longestStreak([]), 0);
  assert.equal(longestStreak(["2026-03-01"]), 1);
  assert.equal(longestStreak(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-05", "2026-02-06"]), 3);
  assert.equal(longestStreak(["2026-12-30", "2026-12-31"]), 2);
});

test("authors are split on commas, 'and', 'e' and '&'", () => {
  assert.deepEqual(splitAuthors("Mortimer J. Adler, Charles Van Doren"), ["Mortimer J. Adler", "Charles Van Doren"]);
  assert.deepEqual(splitAuthors("Daniel J. Siegel e Mary Hartzell"), ["Daniel J. Siegel", "Mary Hartzell"]);
  assert.deepEqual(splitAuthors("A & B and C"), ["A", "B", "C"]);
  assert.deepEqual(splitAuthors(""), []);
});

test("year summary: counts only that year, picks favorite author, best month, best notes", () => {
  const report = (rating, change) => JSON.stringify({ rating, change, ideas: [] });
  const books = [
    { id: 1, title: "One", author: "Ann Writer", status: "finished", finished_at: "2026-02-10", total_pages: 100, report: report(5, "Changed A") },
    { id: 2, title: "Two", author: "Ann Writer", status: "finished", finished_at: "2026-06-01", total_pages: 300, report: null },
    { id: 3, title: "Three", author: "Bob Other", status: "finished", finished_at: "2025-12-31", total_pages: 999, report: report(3, "Old") },
    { id: 4, title: "Four", author: "Cy", status: "reading", finished_at: null, total_pages: 50, report: null },
  ];
  const sessions = [
    { book_id: 1, date: "2026-02-08", pages: 40 }, { book_id: 1, date: "2026-02-09", pages: 30 },
    { book_id: 1, date: "2026-02-10", pages: 30 }, { book_id: 2, date: "2026-06-01", pages: 20 },
    { book_id: 3, date: "2025-12-31", pages: 500 },
  ];
  const notes = [
    { id: 1, book_id: 1, created_at: "2026-02-09 10:00:00", quote: "Q", body: "B", page: 5, page_kind: "pdf", starred: 1 },
    { id: 2, book_id: 1, created_at: "2026-02-09 11:00:00", quote: "", body: "plain", page: 6, page_kind: "pdf", starred: 0 },
    { id: 3, book_id: 3, created_at: "2025-12-01 11:00:00", quote: "", body: "old star", page: 1, page_kind: "pdf", starred: 1 },
  ];
  const y = yearSummary({ year: 2026, books, sessions, notes });
  assert.equal(y.books_finished, 2);
  assert.deepEqual(y.finished.map((b) => b.title), ["One", "Two"]);
  assert.equal(y.pages, 120);
  assert.equal(y.days_read, 4);
  assert.equal(y.pages_per_day, 30);
  assert.equal(y.longest_streak, 3);
  assert.deepEqual(y.best_month, { month: 2, pages: 100 });
  assert.deepEqual(y.best_day, { date: "2026-02-08", pages: 40 });
  assert.equal(y.favorite_author.name, "Ann Writer");
  assert.equal(y.favorite_author.books, 2);
  assert.equal(y.notes_written, 2);
  assert.deepEqual(y.best_notes.map((n) => n.id), [1], "only starred notes of this year");
  assert.deepEqual(y.top_rated, [{ id: 1, title: "One", rating: 5 }]);
  assert.deepEqual(y.changed_me, [{ id: 1, title: "One", change: "Changed A" }]);
  assert.equal(y.reports_owed, 1);

  const empty = yearSummary({ year: 2030, books, sessions, notes });
  assert.equal(empty.books_finished, 0);
  assert.equal(empty.best_month, null);
  assert.equal(empty.favorite_author, null);
  assert.equal(empty.longest_streak, 0);
});

let t;
before(async () => { t = await startApp(); });
after(() => t.stop());

test("the year route works on an empty notebook, and ignores trashed books", async () => {
  const empty = await t.api("GET", "/api/year/2026");
  assert.equal(empty.status, 200);
  assert.equal(empty.data.books_finished, 0);
  assert.deepEqual(empty.data.years, []);

  const { id } = (await t.api("POST", "/api/books", { title: "Y", status: "finished", finished_on: "2026-05-05" })).data;
  await t.api("POST", "/api/sessions", { book_id: id, date: "2026-05-05", from_page: 1, to_page: 10 });
  const year = (await t.api("GET", "/api/year/2026")).data;
  assert.equal(year.books_finished, 1);
  assert.equal(year.pages, 10);
  assert.deepEqual(year.years, [2026]);

  await t.api("DELETE", `/api/books/${id}`);
  assert.equal((await t.api("GET", "/api/year/2026")).data.books_finished, 0, "a trashed book is not counted");
});
