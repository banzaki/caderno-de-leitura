# Caderno de Leitura

A local reading notebook for Don Bruno: books, pages read per day, a 25 pages/day goal with a
streak and a calendar, notes per book and page, and a PDF/EPUB reader where every highlight
becomes a note with its page.

Runs 100% on this computer: no internet, no account, no API, zero cost.

## How to run

1. Install [Node.js](https://nodejs.org) 22.13 or newer (tested on 24).
2. In this folder, once: `npm install`
3. Start: double-click `start.cmd` (or `npm start`). The browser opens at http://localhost:4517.
4. Desktop shortcut, once: `npm run shortcut`.

Close the "Caderno de Leitura" console window (minimized in the taskbar) to stop the app.
Opening the shortcut again while the app runs just opens a new browser tab.

## Developer scripts

- `npm test`: run the tests.
- `node scripts/make-sample-books.js <folder>`: create a sample PDF and two sample EPUBs
  (with and without print page numbers) to test the reader.
- `node scripts/make-icon.js`: redraw `public/icon.ico`, used by the desktop shortcut.

## Data and backup

Everything lives in the `data/` folder (never committed to Git):

- `data/caderno.db`: the SQLite database (books, reading sessions, notes).
- `data/books/`: the PDF and EPUB files you attached.

Backup: close the app and copy the `data/` folder.

## Page numbers in highlights

- **PDF:** the exact page.
- **EPUB:** EPUB text reflows, so it has no fixed pages. When the file includes the printed
  book's page numbers, the note uses them. Otherwise it records the position as a percentage,
  and the screen says so.

## Stack

Node.js with the built-in `node:sqlite` and `node:http`, plain HTML/CSS/JavaScript in the
browser, PDF.js and epub.js for the reader, `node:test` for tests (`npm test`).
Why not the SMM default stack: Bruno is learning a single language (JavaScript), and the app
is local-only, so TypeScript, React and hosting would add weight without benefit.
