// A copy of the database once a day, keeping the most recent ones.
// Book files are big and never change, so only the database (notes, sessions, reports) is copied.
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const DAILY_BACKUPS_KEPT = 14;

// "20261117" from a Date, in local time.
function dayStamp(d) {
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;
}

// Makes today's copy if there is none yet, then removes the oldest beyond the limit.
// Returns the path of the new copy, or null when today already had one.
export function dailyBackup(db, dataDir, now = new Date(), keep = DAILY_BACKUPS_KEPT) {
  const dir = join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `caderno-daily-${dayStamp(now)}.db`);
  let made = null;
  if (!existsSync(target)) {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    made = target;
  }
  const daily = readdirSync(dir).filter((f) => /^caderno-daily-\d{8}\.db$/.test(f)).sort();
  for (const old of daily.slice(0, Math.max(daily.length - keep, 0))) unlinkSync(join(dir, old));
  return made;
}
