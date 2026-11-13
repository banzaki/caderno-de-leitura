// Creates small sample books for testing the reader:
//   sample.pdf          5 pages of text, with title and author
//   sample-print.epub   EPUB with print page numbers (page list)
//   sample-plain.epub   EPUB without page numbers (notes fall back to %)
// Usage: node scripts/make-sample-books.js <output-folder>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";

const out = process.argv[2];
if (!out) {
  console.error("Usage: node scripts/make-sample-books.js <output-folder>");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const LINES = [
  "You have power over your mind, not outside events.",
  "Realize this, and you will find strength.",
  "The impediment to action advances action.",
  "What stands in the way becomes the way.",
  "Waste no more time arguing what a good man should be. Be one.",
];

// ---------- PDF: written by hand, with a correct cross-reference table.
function makePdf(pageCount) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pages = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (let p = 1; p <= pageCount; p++) {
    const text = [`BT /F1 22 Tf 72 720 Td (Sample book - page ${p}) Tj ET`];
    LINES.forEach((line, i) => text.push(`BT /F1 14 Tf 72 ${660 - i * 28} Td (${line}) Tj ET`));
    const stream = text.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  const info = add("<< /Title (Sample PDF book) /Author (Marcus Aurelius) >>");
  objects[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// ---------- EPUB 3 with three chapters; optionally with a page list.
async function makeEpub(withPageList) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  let page = 1;
  const pageLinks = [];
  const chapters = [1, 2, 3].map((n) => {
    let body = `<h1>Chapter ${n}</h1>`;
    for (let block = 0; block < 4; block++) {
      body += `<span epub:type="pagebreak" id="page_${page}" title="${page}"></span>`;
      pageLinks.push(`<li><a href="chapter${n}.xhtml#page_${page}">${page}</a></li>`);
      page++;
      body += LINES.map((l) => `<p>${l} (chapter ${n}, part ${block + 1})</p>`).join("").repeat(3);
    }
    return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Chapter ${n}</title></head><body>${body}</body></html>`;
  });
  chapters.forEach((html, i) => zip.file(`OEBPS/chapter${i + 1}.xhtml`, html));

  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>${[1, 2, 3].map((n) => `<li><a href="chapter${n}.xhtml">Chapter ${n}</a></li>`).join("")}</ol></nav>
${withPageList ? `<nav epub:type="page-list"><ol>${pageLinks.join("")}</ol></nav>` : ""}
</body></html>`);

  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">sample-${withPageList ? "print" : "plain"}</dc:identifier>
    <dc:title>Sample ${withPageList ? "with" : "without"} page numbers</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Sample Author</dc:creator>
    <meta property="dcterms:modified">2026-11-12T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${[1, 2, 3].map((n) => `<item id="c${n}" href="chapter${n}.xhtml" media-type="application/xhtml+xml"/>`).join("\n    ")}
  </manifest>
  <spine>${[1, 2, 3].map((n) => `<itemref idref="c${n}"/>`).join("")}</spine>
</package>`);
  return zip.generateAsync({ type: "nodebuffer", mimeType: "application/epub+zip" });
}

writeFileSync(join(out, "sample.pdf"), makePdf(5));
writeFileSync(join(out, "sample-print.epub"), await makeEpub(true));
writeFileSync(join(out, "sample-plain.epub"), await makeEpub(false));
console.log(`Sample books written to ${out}`);
