// Generates the app's Home Screen / manifest icons as real PNGs (P17) — no image library
// needed: it rasterizes a simple gradient + trophy glyph and encodes PNG with node's zlib.
//
//   node scripts/generate-icons.mjs
//
// Writes public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png. The files are
// committed; re-run only to change the artwork. "maskable" has full-bleed colour and the glyph
// inside the safe zone (so Android's round/squircle masks don't clip it); "any" icons have
// rounded corners; the Apple touch icon is full-bleed and opaque (iOS applies its own mask).

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const TOP = [0xe1, 0x1d, 0x3c]; // team red  (--color-primary)
const BOTTOM = [0xf5, 0xb4, 0x00]; // team gold (--color-secondary)

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Is the (x, y) point, in 0..1 icon space, inside the trophy glyph? `s` scales the glyph about the centre. */
function inTrophy(x, y, s) {
  x = 0.5 + (x - 0.5) / s;
  y = 0.5 + (y - 0.5) / s;
  const cupBody = y >= 0.24 && y <= 0.5 && Math.abs(x - 0.5) <= 0.19;
  const cupBowl = y > 0.5 && (x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.19 ** 2;
  const ring = (cx) => {
    const d = Math.hypot(x - cx, y - 0.36);
    return d <= 0.095 && d >= 0.055;
  };
  const stem = Math.abs(x - 0.5) <= 0.035 && y >= 0.66 && y <= 0.76;
  const base = Math.abs(x - 0.5) <= 0.15 && y >= 0.76 && y <= 0.82;
  return cupBody || cupBowl || ring(0.27) || ring(0.73) || stem || base;
}

function render(size, { rounded, glyphScale }) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 3; // 3x3 supersampling per pixel
  const radius = rounded ? 0.22 : 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          // Rounded-square coverage.
          let inside = true;
          if (radius > 0) {
            const cx = Math.min(Math.max(x, radius), 1 - radius);
            const cy = Math.min(Math.max(y, radius), 1 - radius);
            inside = Math.hypot(x - cx, y - cy) <= radius;
          }
          if (!inside) continue;
          const t = (x + y) / 2; // diagonal gradient
          const glyph = inTrophy(x, y, glyphScale);
          const c = glyph ? [255, 247, 237] : TOP.map((v, i) => v + (BOTTOM[i] - v) * t);
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = SS * SS;
      const covered = a / 255;
      const i = (py * size + px) * 4;
      buf[i] = covered ? Math.round(r / covered) : 0;
      buf[i + 1] = covered ? Math.round(g / covered) : 0;
      buf[i + 2] = covered ? Math.round(b / covered) : 0;
      buf[i + 3] = Math.round((covered / n) * 255);
    }
  }
  return png(size, size, buf);
}

mkdirSync("public/icons", { recursive: true });
const files = {
  "icon-192.png": render(192, { rounded: true, glyphScale: 1 }),
  "icon-512.png": render(512, { rounded: true, glyphScale: 1 }),
  "icon-maskable-512.png": render(512, { rounded: false, glyphScale: 0.74 }),
  "apple-touch-icon.png": render(180, { rounded: false, glyphScale: 0.9 }),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(`public/icons/${name}`, data);
  console.log(`public/icons/${name}  ${data.length} bytes`);
}
