// Generates simple solid-color PNG icons (green with a lighter "A"-ish square)
// using only Node's zlib — no dependencies. Replace with real artwork later.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(root, { recursive: true });

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// Draw a rounded-ish green square with a white "A" made of simple strokes.
function makePng(size, maskable) {
  const bg = [0x4a, 0x67, 0x41];
  const fg = [0xff, 0xff, 0xff];
  const rows = [];
  const stroke = Math.max(2, Math.round(size * 0.06));
  const cx = size / 2;
  const pad = maskable ? size * 0.18 : size * 0.1;
  const top = pad, bottom = size - pad;
  const height = bottom - top;
  const halfBase = height * 0.28;

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let c = bg;
      if (y >= top && y <= bottom) {
        const t = (y - top) / height;
        const halfW = halfBase * t;
        // two slanted legs
        const left = cx - halfW;
        const right = cx + halfW;
        const onLeg =
          (Math.abs(x - left) <= stroke / 2 || Math.abs(x - right) <= stroke / 2) &&
          t > 0.05;
        // crossbar
        const onBar = Math.abs(y - (top + height * 0.62)) <= stroke / 2 && Math.abs(x - cx) <= halfW;
        if (onLeg || onBar) c = fg;
      }
      row.writeUInt8(c[0], 1 + x * 3);
      row.writeUInt8(c[1], 2 + x * 3);
      row.writeUInt8(c[2], 3 + x * 3);
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  const idat = deflateSync(Buffer.concat(rows), { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(join(root, "icon-192.png"), makePng(192, false));
writeFileSync(join(root, "icon-512.png"), makePng(512, false));
writeFileSync(join(root, "icon-512-maskable.png"), makePng(512, true));
writeFileSync(join(root, "apple-touch-icon.png"), makePng(180, false));
console.log("Icons written to", root);
