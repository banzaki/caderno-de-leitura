// Pure helpers for "Add a book" with a file: clean the details found inside a
// PDF or EPUB and decide which form fields to fill. No browser APIs here, so
// `npm test` can check them in Node.

// Titles that tools write into files by default and that say nothing about the book.
const JUNK_TITLES = /^(untitled|unknown|document\d*|title|microsoft word\s*-.*|\s*)$/i;

export function cleanMetaText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

// "Meditations_-_Marcus.pdf" -> "Meditations - Marcus"
export function titleFromFileName(name) {
  const base = String(name ?? "").replace(/\.(pdf|epub)$/i, "");
  return cleanMetaText(base.replace(/[_]+/g, " "));
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
  return {
    title: cleanTitle && !JUNK_TITLES.test(cleanTitle) ? cleanTitle : titleFromFileName(fileName),
    author: cleanMetaText(author),
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
