import assert from "node:assert/strict";
import { test } from "node:test";

import { bookInfoFromMeta, fieldsToFill, titleFromFileName, totalFromPageList } from "../public/book-meta.js";

test("title falls back to the file name when the file has none or a junk one", () => {
  assert.equal(titleFromFileName("Meditations_Marcus_Aurelius.pdf"), "Meditations Marcus Aurelius");
  assert.equal(bookInfoFromMeta({ title: "", fileName: "Dom Casmurro.epub" }).title, "Dom Casmurro");
  assert.equal(bookInfoFromMeta({ title: "Untitled", fileName: "Dom Casmurro.pdf" }).title, "Dom Casmurro");
  assert.equal(bookInfoFromMeta({ title: "Microsoft Word - draft.doc", fileName: "Real.pdf" }).title, "Real");
  assert.equal(bookInfoFromMeta({ title: "  The   Republic ", fileName: "x.pdf" }).title, "The Republic");
});

test("book info keeps author and only valid page counts", () => {
  const info = bookInfoFromMeta({ title: "Meditations", author: " Marcus Aurelius ", totalPages: 254, fileName: "m.pdf" });
  assert.deepEqual(info, { title: "Meditations", author: "Marcus Aurelius", totalPages: 254 });
  assert.equal(bookInfoFromMeta({ totalPages: null, fileName: "a.epub" }).totalPages, null);
  assert.equal(bookInfoFromMeta({ totalPages: 0, fileName: "a.pdf" }).totalPages, null);
  assert.equal(bookInfoFromMeta({ author: 42, fileName: "a.pdf" }).author, "");
});

test("EPUB total pages comes from the highest whole print page", () => {
  assert.equal(totalFromPageList([{ page: "ii" }, { page: 1 }, { page: 12 }, { page: 7 }]), 12);
  assert.equal(totalFromPageList([{ page: "xiv" }]), null);
  assert.equal(totalFromPageList([]), null);
  assert.equal(totalFromPageList(undefined), null);
});

test("pre-fill never overwrites what Bruno typed", () => {
  const info = { title: "From file", author: "File Author", totalPages: 300 };
  const empty = { title: { value: "", typed: false }, author: { value: "", typed: false }, totalPages: { value: "", typed: false } };
  assert.deepEqual(fieldsToFill(empty, info), { title: "From file", author: "File Author", totalPages: "300" });

  const typed = { ...empty, title: { value: "My title", typed: true } };
  assert.deepEqual(fieldsToFill(typed, info), { author: "File Author", totalPages: "300" });

  // A value filled by a previous file (not typed) is replaced when another file is picked.
  const prefilled = { ...empty, author: { value: "Old file author", typed: false } };
  assert.equal(fieldsToFill(prefilled, info).author, "File Author");

  // Nothing in the file: an empty field stays empty...
  assert.deepEqual(fieldsToFill(empty, { title: "T", author: "", totalPages: null }), { title: "T" });
  // ...and a value left by a previous file is cleared, but a typed one is kept.
  const fromOldFile = { ...empty, totalPages: { value: "12", typed: false } };
  assert.equal(fieldsToFill(fromOldFile, { title: "T", author: "", totalPages: null }).totalPages, "");
  const typedPages = { ...empty, totalPages: { value: "320", typed: true } };
  assert.equal(fieldsToFill(typedPages, { title: "T", author: "", totalPages: null }).totalPages, undefined);
});
