# Caderno de Leitura

Local reading notebook: books, daily pages (goal 25/day, streak, calendar), notes per page,
and a PDF/EPUB reader whose highlights become notes. Single user (Don Bruno), 100% local.

## Commands

- `npm start`: start the server on http://localhost:4517 and open the browser.
- `npm run dev`: start without opening the browser.
- `npm test`: run all tests (`node:test`).
- `npm run shortcut`: create the desktop shortcut to `start.cmd`.

## Layout

- `server.js`: entry point. `src/app.js`: HTTP server and JSON API. `src/db.js`: SQLite schema.
- `src/stats.js`: pure reading math (pages, streak, validation). Keep it pure and tested.
- `public/`: the UI (plain HTML/CSS/JS, no build step). `public/reader.*`: the PDF/EPUB reader.
- `data/`: database and book files. Never commit it.

## Rules

- JavaScript only (Bruno is learning one language). No TypeScript, no frameworks, no build step.
- No network calls at runtime. Libraries are served from `node_modules` under `/vendor/`.
- The server binds to 127.0.0.1 only.
- Code, comments, UI text and commits in English.
- Pages read count both ends: from 17 to 42 is 26 pages.
- EPUB pages: print page when the file has a page list; otherwise pages counted by the app
  (one per `EPUB_CHARS_PER_PAGE` characters, `public/book-meta.js`), labeled "counted by the app".
  The add-book form and the reader must use the same count (Bruno, 2026-11-13).
- Push to GitHub (banzaki/caderno-de-leitura, private) after every working delivery.
