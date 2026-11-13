// Pure helpers for "Add a book" with a file: clean the details found inside a
// PDF or EPUB and decide which form fields to fill. No browser APIs here, so
// `npm test` can check them in Node.

// EPUBs without the printed book's page numbers get pages counted by the app:
// one page per this many characters of text. The add-book form and the reader
// both use it, so "Total pages" matches the pages shown while reading.
export const EPUB_CHARS_PER_PAGE = 1500;

// Titles that tools write into files by default and that say nothing about the book.
const JUNK_TITLES = /^(untitled|unknown|document\d*|title|microsoft word\s*-.*|\s*)$/i;

export function cleanMetaText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

// Windows file names cannot hold ":" or ".", so download sites write "_" instead:
// "How to Read a Book_ The Classic Guide" and "Mortimer J_ Adler".
function restorePunctuation(text) {
  return text
    .replace(/\b([A-Z])_ /g, "$1. ") // an initial: "J_ Adler" -> "J. Adler"
    .replace(/_ /g, ": ")
    .replace(/_+/g, " ");
}

// Title and author guessed from a file name. Names such as
// "Title -- Author -- Edition, 1972 -- Publisher -- 231e20f5... -- Anna's Archive"
// keep only the first two parts.
export function infoFromFileName(name) {
  const base = String(name ?? "").replace(/\.(pdf|epub)$/i, "");
  const parts = base.split(/\s+--\s+/).map((part) => cleanMetaText(restorePunctuation(part)));
  return { title: parts[0] ?? "", author: parts.length > 1 ? parts[1] : "" };
}

export function titleFromFileName(name) {
  return infoFromFileName(name).title;
}

// Total pages of an EPUB from its print page list: the highest whole page number.
// Roman numerals (front matter) and other labels are ignored. Null when there is none.
export function totalFromPageList(pageList) {
  let max = 0;
  for (const item of pageList ?? []) {
    const page = Number(item?.page);
    if (Number.isInteger(page) && page > max) max = page;
  }
  return max || null;
}

// Turns the raw details read from a file into { title, author, totalPages }.
export function bookInfoFromMeta({ title, author, totalPages, fileName }) {
  const cleanTitle = cleanMetaText(title);
  const pages = Number(totalPages);
  const fromName = infoFromFileName(fileName);
  const hasTitle = cleanTitle && !JUNK_TITLES.test(cleanTitle);
  return {
    title: hasTitle ? cleanTitle : fromName.title,
    // The file name's author is only trusted when the title also came from the file name.
    author: cleanMetaText(author) || (hasTitle ? "" : fromName.author),
    totalPages: Number.isInteger(pages) && pages > 0 ? pages : null,
  };
}

// New values for the form fields. `fields` is { title, author, totalPages }, each
// { value, typed } where `typed` means Bruno typed in it himself.
// What Bruno typed is never touched. Every other field takes the file's value,
// or is emptied when the file has none (so a value from a previously chosen file
// does not stay behind).
export function fieldsToFill(fields, info) {
  const fill = {};
  for (const key of ["title", "author", "totalPages"]) {
    const field = fields[key];
    if (field?.typed && String(field.value ?? "").trim() !== "") continue;
    const value = info[key];
    const next = value === null || value === undefined ? "" : String(value);
    if (next !== String(field?.value ?? "")) fill[key] = next;
  }
  return fill;
}
