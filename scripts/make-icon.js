// Draws the app icon (the same open book as public/icon.svg) and saves it as
// public/icon.ico, which the Windows desktop shortcut uses.
// Usage: node scripts/make-icon.js
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const SIZE = 64;
const SAMPLES = 4; // 4x4 samples per pixel for smooth edges

const GREEN = [47, 93, 80];
const PAGE_LEFT = [244, 239, 228];
const PAGE_RIGHT = [227, 217, 195];
const LEFT = [[14, 18], [32, 20], [32, 48], [14, 46]];
const RIGHT = [[50, 18], [32, 20], [32, 48], [50, 46]];

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundedSquare(x, y, r = 14) {
  const cx = Math.min(Math.max(x, r), SIZE - r);
  const cy = Math.min(Math.max(y, r), SIZE - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const rows = [];
for (let py = 0; py < SIZE; py++) {
  const row = [0]; // PNG filter type "none"
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = px + (sx + 0.5) / SAMPLES;
        const y = py + (sy + 0.5) / SAMPLES;
        if (!inRoundedSquare(x, y)) continue;
        const c = inPolygon(x, y, LEFT) ? PAGE_LEFT : inPolygon(x, y, RIGHT) ? PAGE_RIGHT : GREEN;
        r += c[0]; g += c[1]; b += c[2]; a += 1;
      }
    }
    const n = SAMPLES * SAMPLES;
    row.push(a ? Math.round(r / a) : 0, a ? Math.round(g / a) : 0, a ? Math.round(b / a) : 0, Math.round((a / n) * 255));
  }
  rows.push(Buffer.from(row));
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(Buffer.concat(rows))),
  chunk("IEND", Buffer.alloc(0)),
]);

// ICO container holding one PNG image.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(1, 4); // one image
const entry = Buffer.alloc(16);
entry[0] = SIZE;
entry[1] = SIZE;
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(6 + 16, 12);

const out = new URL("../public/icon.ico", import.meta.url);
writeFileSync(out, Buffer.concat([header, entry, png]));
console.log("Wrote public/icon.ico");
