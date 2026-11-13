// Reads title, author and page count from a PDF or EPUB chosen on the computer,
// before it is uploaded. Uses the same local libraries as the reader.
import { EPUB_CHARS_PER_PAGE, bookInfoFromMeta, totalFromPageList } from "./book-meta.js";

export function fileKind(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".epub")) return "epub";
  return null;
}

// Returns { title, author, totalPages, pagesCounted }. Fields the file does not have come back
// empty (title falls back to the file name). Never throws for a damaged file:
// the book can still be added by hand.
export async function readBookFileInfo(file) {
  const kind = fileKind(file);
  let raw = {};
  try {
    if (kind === "pdf") raw = await readPdf(file);
    else if (kind === "epub") raw = await readEpub(file);
  } catch (err) {
    console.warn("Could not read details from the file:", err);
  }
  return { ...bookInfoFromMeta({ ...raw, fileName: file.name }), pagesCounted: raw.pagesCounted === true };
}

async function readPdf(file) {
  const pdfjs = await import("/vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: "/vendor/pdfjs-cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/vendor/pdfjs-fonts/",
    wasmUrl: "/vendor/pdfjs-wasm/",
    iccUrl: "/vendor/pdfjs-iccs/",
  });
  try {
    const doc = await task.promise;
    const { info, metadata } = await doc.getMetadata();
    return {
      title: info?.Title || metadata?.get("dc:title") || "",
      author: info?.Author || metadata?.get("dc:creator") || "",
      totalPages: doc.numPages,
    };
  } finally {
    task.destroy();
  }
}

// epub.js and JSZip are classic scripts that set globals; load them once, on demand.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}

let epubLibrary;
function loadEpubLibrary() {
  epubLibrary ??= (async () => {
    if (!window.JSZip) await loadScript("/vendor/jszip/jszip.min.js");
    if (!window.ePub) await loadScript("/vendor/epubjs/epub.min.js");
  })();
  return epubLibrary;
}

async function readEpub(file) {
  await loadEpubLibrary();
  const epub = window.ePub(await file.arrayBuffer());
  try {
    await epub.ready;
    const meta = epub.packaging?.metadata ?? {};
    const printTotal = totalFromPageList(epub.pageList?.pageList);
    if (printTotal) return { title: meta.title, author: meta.creator, totalPages: printTotal };
    // No print page numbers: count pages the same way the reader does.
    await epub.locations.generate(EPUB_CHARS_PER_PAGE);
    return { title: meta.title, author: meta.creator, totalPages: epub.locations.length(), pagesCounted: true };
  } finally {
    epub.destroy();
  }
}
