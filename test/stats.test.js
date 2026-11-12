import assert from "node:assert/strict";
import { test } from "node:test";

import { addDays, computeStreak, isValidDate, pagesBetween, validateSession } from "../src/stats.js";

test("pages between counts both ends", () => {
  assert.equal(pagesBetween(17, 42), 26);
  assert.equal(pagesBetween(5, 5), 1);
});

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
});

test("isValidDate rejects impossible dates", () => {
  assert.equal(isValidDate("2026-11-12"), true);
  assert.equal(isValidDate("2026-02-30"), false);
  assert.equal(isValidDate("12/11/2026"), false);
  assert.equal(isValidDate(undefined), false);
});

test("streak counts consecutive days that met the goal", () => {
  const totals = { "2026-11-10": 25, "2026-11-11": 30, "2026-11-12": 40 };
  assert.equal(computeStreak(totals, "2026-11-12"), 3);
});

test("streak does not reset while today is still below the goal", () => {
  const totals = { "2026-11-10": 25, "2026-11-11": 30, "2026-11-12": 10 };
  assert.equal(computeStreak(totals, "2026-11-12"), 2);
});

test("streak breaks on a day below the goal", () => {
  const totals = { "2026-11-09": 50, "2026-11-10": 24, "2026-11-11": 30 };
  assert.equal(computeStreak(totals, "2026-11-12"), 1);
  assert.equal(computeStreak({}, "2026-11-12"), 0);
});

test("session validation", () => {
  const date = "2026-11-12";
  assert.equal(validateSession({ fromPage: 17, toPage: 42, date }, 300), null);
  assert.match(validateSession({ fromPage: 42, toPage: 17, date }, 300), /before/);
  assert.match(validateSession({ fromPage: 0, toPage: 5, date }, 300), /1 or more/);
  assert.match(validateSession({ fromPage: 290, toPage: 310, date }, 300), /only 300/);
  assert.equal(validateSession({ fromPage: 290, toPage: 310, date }, null), null);
  assert.match(validateSession({ fromPage: 1, toPage: 2, date: "bad" }, 300), /date/);
});
