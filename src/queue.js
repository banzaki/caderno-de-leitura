// Pure helpers for the reading queue: read a queue text file and tell which
// entries are books the notebook already has. No database here, so tests are easy.

// One book per line: "[ ] 12. Title — Author". The box may be checked ("[x]"),
// the author is optional, and the title may be in quotes ("Some book about Gauls").
const LINE = /^\s*\[([ xX])\]\s*(\d+)\s*[.)]\s+(.+?)\s*$/;
const AUTHOR_SEPARATOR = /\s+[—–]\s+/; // em dash or en dash with spaces around it

export function parseQueueText(text) {
  const entries = [];
  const invalid = [];
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const match = raw.match(LINE);
    if (!match) {
      invalid.push({ line: i + 1, text: raw.trim() });
      return;
    }
    const [, box, number, rest] = match;
    const [titlePart, ...authorParts] = rest.split(AUTHOR_SEPARATOR);
    const title = titlePart.trim().replace(/^["“](.*)["”]$/, "$1").trim();
    if (!title) {
      invalid.push({ line: i + 1, text: raw.trim() });
      return;
    }
    entries.push({
      line: i + 1,
      number: Number(number),
      done: box !== " ",
      title: title.slice(0, 300),
      author: authorParts.join(" — ").trim().slice(0, 300),
    });
  });
  entries.sort((a, b) => a.number - b.number || a.line - b.line);
  return { entries, invalid };
}

// "Sobre a Brevidade da Vida!" and "sobre a brevidade da vida" are the same title.
export function normalizeTitle(title) {
  return String(title ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// The authors' last names, sorted: "Mortimer J. Adler e Charles Van Doren" and
// "Mortimer J. Adler, Charles Van Doren" both give "adler|doren". Notes in
// parentheses such as "(org.)" are ignored. Empty when there is no author.
export function authorKey(author) {
  const clean = String(author ?? "").replace(/\([^)]*\)/g, " ");
  const names = clean
    .split(/,|;|&|\s+e\s+|\s+and\s+|\s+com\s+/i)
    .map((name) => normalizeTitle(name).split(" ").filter(Boolean).at(-1))
    .filter(Boolean);
  return [...new Set(names)].sort().join("|");
}

// Which existing book an entry is, if any:
// - the same title, against any book; or
// - exactly the same two or more authors, against books already started (not queued),
//   to catch a translated title like "Como Ler Livros" for "How to Read a Book".
//   One author is not enough: many authors have several books in a queue.
export function findExisting(entry, books) {
  const title = normalizeTitle(entry.title);
  const byTitle = books.find((b) => normalizeTitle(b.title) === title);
  if (byTitle) return { book: byTitle, reason: "same title" };
  const authors = authorKey(entry.author);
  if (!authors.includes("|")) return null;
  const byAuthors = books.find((b) => b.status !== "queued" && authorKey(b.author) === authors);
  return byAuthors ? { book: byAuthors, reason: "same authors" } : null;
}
