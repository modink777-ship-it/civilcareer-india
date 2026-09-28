/**
 * CivilCareer — social share card generator
 *
 *   node scripts/generate-og-image.js
 *
 * Writes og-image.png (1200×630) at the project root. There is no og:image
 * anywhere else in the project and no image tooling installed, so this draws
 * the card pixel by pixel and encodes the PNG by hand (zlib is built into
 * Node). Re-run it whenever the wordmark or colours change.
 *
 * Colours match the palette in styles.css:
 *   --navy #0b1f3a   --blue #155ea8   --teal #247568   --gold #c9973c
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 1200;
const H = 630;

const NAVY = [0x0b, 0x1f, 0x3a];
const BLUE = [0x15, 0x5e, 0xa8];
const TEAL = [0x24, 0x75, 0x68];
const GOLD = [0xc9, 0x97, 0x3c];
const WHITE = [0xff, 0xff, 0xff];

/* ── 5×7 bitmap font, only the glyphs the wordmark needs ────────────────── */

const FONT = {
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  A: ['..#..', '.#.#.', '#...#', '#...#', '#####', '#...#', '#...#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;
const STEP = GLYPH_W + 1;

/* ── Canvas ─────────────────────────────────────────────────────────────── */

const px = Buffer.alloc(W * H * 3);

function setPixel(x, y, c, alpha = 1) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  if (alpha >= 1) {
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    return;
  }
  px[i] = Math.round(px[i] * (1 - alpha) + c[0] * alpha);
  px[i + 1] = Math.round(px[i + 1] * (1 - alpha) + c[1] * alpha);
  px[i + 2] = Math.round(px[i + 2] * (1 - alpha) + c[2] * alpha);
}

function rect(x0, y0, w, h, c, alpha = 1) {
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) setPixel(x, y, c, alpha);
}

/* Diagonal navy → blue wash with a teal glow in the lower right. */
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = Math.min(1, Math.max(0, (x / W) * 0.35 + (y / H) * 0.65));
    const base = [
      Math.round(NAVY[0] + (BLUE[0] - NAVY[0]) * t),
      Math.round(NAVY[1] + (BLUE[1] - NAVY[1]) * t),
      Math.round(NAVY[2] + (BLUE[2] - NAVY[2]) * t),
    ];
    const gx = x - W * 0.82;
    const gy = y - H * 0.9;
    const glow = Math.max(0, 1 - Math.sqrt(gx * gx + gy * gy) / 620);
    setPixel(x, y, base);
    if (glow > 0) setPixel(x, y, TEAL, glow * 0.35);
  }
}

/* Faint engineering grid — 30px cells at very low contrast. */
for (let x = 0; x < W; x += 30) rect(x, 0, 1, H, WHITE, 0.04);
for (let y = 0; y < H; y += 30) rect(0, y, W, 1, WHITE, 0.04);

/* City silhouette along the bottom. Capped low enough to leave the wordmark
   clear air — an earlier pass let the towers run up through the letters. */
const BAR_W = 46;
const SKY_CAP = 178;
for (let i = 0, x = 0; x < W; i += 1, x += BAR_W) {
  const h = 78 + ((i * 137) % 8) * 14;
  const top = H - Math.min(h, SKY_CAP);
  rect(x, top, BAR_W - 6, H - top, [0x06, 0x16, 0x2c], 0.9);
  /* lit windows */
  for (let wy = top + 14; wy < H - 12; wy += 22) {
    for (let wx = x + 8; wx < x + BAR_W - 16; wx += 16) {
      if (((wx + wy + i) % 5) < 2) rect(wx, wy, 5, 7, GOLD, 0.5);
    }
  }
}

/* Wordmark: "CIVIL" in white, "CAREER" in gold, centred, with a gold rule
   above it. Laid out so the tallest tower (H - SKY_CAP) stays well below. */
const WORD = 'CIVILCAREER';
const SCALE = 12;
const wordW = WORD.length * STEP * SCALE - SCALE;
let cursor = Math.round((W - wordW) / 2);
const top = 288;

rect(Math.round((W - 150) / 2), top - 52, 150, 8, GOLD, 1);

for (let i = 0; i < WORD.length; i += 1) {
  const glyph = FONT[WORD[i]];
  const colour = i < 5 ? WHITE : GOLD;
  for (let gy = 0; gy < GLYPH_H; gy += 1) {
    for (let gx = 0; gx < GLYPH_W; gx += 1) {
      if (glyph[gy][gx] !== '#') continue;
      rect(cursor + gx * SCALE, top + gy * SCALE, SCALE, SCALE, colour, 1);
    }
  }
  cursor += STEP * SCALE;
}

/* ── PNG encoding ───────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // truecolour RGB

const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y += 1) {
  raw[y * (1 + W * 3)] = 0; // filter: none
  px.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'og-image.png');
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${W}x${H}, ${png.length} bytes)`);
