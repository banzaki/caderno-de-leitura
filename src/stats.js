// Pure functions for reading math. No database, no dates from the clock:
// everything receives its inputs so it is easy to test.

export const DAILY_GOAL = 25;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// "Read from page 17 to 42" counts both ends: 26 pages.
export function pagesBetween(fromPage, toPage) {
  return toPage - fromPage + 1;
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// totals: { "2026-11-12": 30, ... }
// A day counts when it reaches the goal. If today has not reached the goal yet,
// the streak still counts from yesterday, so it does not reset in the morning.
export function computeStreak(totals, today, goal = DAILY_GOAL) {
  const met = (date) => (totals[date] ?? 0) >= goal;
  let day = met(today) ? today : addDays(today, -1);
  let streak = 0;
  while (met(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

// Validates a reading session against the book. Returns an error message or null.
export function validateSession({ fromPage, toPage, date }, totalPages) {
  if (!isValidDate(date)) return "Invalid date.";
  if (!Number.isInteger(fromPage) || !Number.isInteger(toPage)) return "Pages must be whole numbers.";
  if (fromPage < 1) return "The first page must be 1 or more.";
  if (toPage < fromPage) return "The last page cannot be before the first page.";
  if (totalPages && toPage > totalPages) return `This book has only ${totalPages} pages.`;
  return null;
}
