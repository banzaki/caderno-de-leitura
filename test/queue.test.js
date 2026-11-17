import assert from "node:assert/strict";
import { test } from "node:test";

import { authorKey, findExisting, normalizeTitle, parseQueueText } from "../src/queue.js";

test("queue lines are read with number, title and author", () => {
  const text = [
    "[ ] 1. Como Ler Livros — Mortimer J. Adler e Charles Van Doren",
    "[ ] 14. A Parent's Guide to Gifted Children",
    "[x] 3. Meditações — Marco Aurélio",
    "",
    "[ ] 300. \"Algum livro de Manly P. Hall\"",
    "[ ] 15. A Marca da Vitória (Shoe Dog) — Phil Knight",
    "this line is not a book",
  ].join("\r\n");
  const { entries, invalid } = parseQueueText(`﻿${text}`);
  assert.deepEqual(entries.map((e) => e.number), [1, 3, 14, 15, 300]); // sorted by number
  assert.deepEqual(entries[0], { line: 1, number: 1, done: false, title: "Como Ler Livros", author: "Mortimer J. Adler e Charles Van Doren" });
  assert.equal(entries[1].done, true);
  assert.equal(entries[2].author, "");
  assert.equal(entries[3].title, "A Marca da Vitória (Shoe Dog)");
  assert.equal(entries[4].title, "Algum livro de Manly P. Hall"); // quotes removed
  assert.deepEqual(invalid, [{ line: 7, text: "this line is not a book" }]);
});

test("titles and authors are compared without accents, case or punctuation", () => {
  assert.equal(normalizeTitle("Sobre a Brevidade da Vida!"), normalizeTitle("sobre a brevidade da  vida"));
  assert.equal(authorKey("Mortimer J. Adler, Charles Van Doren"), "adler|doren");
  assert.equal(authorKey("Mortimer J. Adler e Charles Van Doren"), "adler|doren");
  assert.equal(authorKey("Patricia Buckley Ebrey (org.)"), "ebrey");
  assert.equal(authorKey(""), "");
});

test("an entry is an existing book by title, or by the same two or more authors", () => {
  const library = [
    { id: 1, title: "How to Read a Book: The classic Guide", author: "Mortimer J. Adler, Charles Van Doren", status: "reading" },
    { id: 2, title: "Sobre a Brevidade da Vida", author: "Sêneca", status: "finished" },
    { id: 3, title: "Steve Jobs", author: "Walter Isaacson", status: "queued" },
  ];
  assert.equal(findExisting({ title: "Como Ler Livros", author: "Mortimer J. Adler e Charles Van Doren" }, library).reason, "same authors");
  assert.equal(findExisting({ title: "sobre a brevidade da vida", author: "Sêneca" }, library).book.id, 2);
  // One shared author is not enough: authors often have several books in the queue.
  assert.equal(findExisting({ title: "Cartas a Lucílio", author: "Sêneca" }, library), null);
  assert.equal(findExisting({ title: "Einstein", author: "Walter Isaacson" }, library), null);
  // Queued books only match by title.
  assert.equal(findExisting({ title: "Steve Jobs", author: "Walter Isaacson" }, library).book.id, 3);
});
