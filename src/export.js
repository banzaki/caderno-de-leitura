// Plain-text (Markdown) export of a book: its details, notes and, when there is one,
// the closing report. Pure: takes data, returns a string.
import { noteWhere } from "./note-label.js";

function quoteBlock(text) {
  return text.split("\n").map((line) => `> ${line}`).join("\n");
}

export function bookToMarkdown(book, notes, report = null) {
  const lines = [`# ${book.title}`];
  if (book.author) lines.push(`*${book.author}*`);
  const facts = [];
  if (book.total_pages) facts.push(`${book.total_pages} pages`);
  if (book.finished_at) facts.push(`finished ${book.finished_at}`);
  if (facts.length) lines.push("", facts.join(" · "));

  if (report) {
    lines.push("", "## Closing report");
    if (report.rating) lines.push("", `Rating: ${report.rating}/5`);
    if (report.summary) lines.push("", "**In one sentence**", "", report.summary);
    if (report.ideas?.length) lines.push("", "**Ideas to keep**", "", ...report.ideas.map((idea, i) => `${i + 1}. ${idea}`));
    if (report.change) lines.push("", "**How this book changed me**", "", report.change);
    if (report.recommend) lines.push("", "**Who I would recommend it to**", "", report.recommend);
  }

  lines.push("", `## Notes (${notes.length})`);
  if (!notes.length) lines.push("", "No notes.");
  for (const n of notes) {
    const where = noteWhere(n);
    lines.push("", `### ${n.starred ? "★ " : ""}${where || "Note"}`);
    if (n.quote) lines.push("", quoteBlock(n.quote));
    if (n.body) lines.push("", n.body);
  }
  return `${lines.join("\n")}\n`;
}

// A safe file name for a download: letters, digits, spaces and dashes only.
export function exportFileName(title) {
  const base = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
  return `${base || "book"}-notes.md`;
}
