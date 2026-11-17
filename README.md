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

When a new version of the app needs to upgrade the database, it first saves a copy in
`data/backups/`.

Deleting a book (button on the book page) also deletes its notes, its reading entries and
its file. It cannot be undone, so the app asks first.

## Reading desk and library

The Books page is your reading desk: the main book on top (the default for "Log reading" and
"Continue reading"), the other books you are reading ("Make main" or the arrows change the
order), and the paused ones. Finished books move to the library below, with the day you
finished. Log pages on Today or on the book's own page; reaching the last page offers to
finish the book. "Read again" puts a finished book back on the desk. Today opens with the book you are reading
(or, with an empty desk, the next book in the queue). A book started from the queue can go
"Back to queue", to the same place it had there. On a finished book the finish day can be
corrected, and "Export notes" downloads its notes as a Markdown file.

## Reading queue

The Queue page lists the books you plan to read, in order. "Start reading" moves a book to
Reading. To fill it, import a plain text file with one book per line:

    [ ] 1. Title — Author

Books the notebook already has are skipped (same title, or exactly the same two or more
authors, which catches a translated title). Importing the same file twice adds nothing.
To reorder, hold the ⠿ handle (mouse or finger) and drag up or down; "↑ Top" sends a book to
the first place.

## Reading

The reader scrolls down through the book (PDF and EPUB) and reopens where you stopped.

## Page numbers in highlights

- **PDF:** the exact page.
- **EPUB:** EPUB text reflows, so it has no fixed pages. When the file includes the printed
  book's page numbers, the app uses them. Otherwise the app counts pages itself, one page per
  1,500 characters of text (like reading apps such as Lithium do). These pages stay the same at
  any window size, but they do not match the printed book, and the screen says so.

Click a note (on the book page or on Notes) to open the reader at that place.

## Stack

Node.js with the built-in `node:sqlite` and `node:http`, plain HTML/CSS/JavaScript in the
browser, PDF.js and epub.js for the reader, `node:test` for tests (`npm test`).
Titles use the Fraunces font (SIL Open Font License), installed with npm and served locally.
After pulling new code, run `npm install` once in case a library was added.
Why not the SMM default stack: Bruno is learning a single language (JavaScript), and the app
is local-only, so TypeScript, React and hosting would add weight without benefit.
