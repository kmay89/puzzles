/* make-icons.js — draws the app icons from scratch (no image libraries):
   a sheet of warm paper under lamplight with a 3×3 grid ruled on it and
   one square lit — the moment a sudoku gives itself away.

   Rasterised analytically with 3×3 supersampling and PNG-encoded by
   hand with node's zlib, the same way the chess room's icons are made.
   Run: node sudoku/tools/make-icons.js */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ---------- minimal PNG writer ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; /* 8-bit RGBA */
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- the drawing ---------- */
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
const ROOM = hex("#171009"), ROOM2 = hex("#0e0a07");
const PAPER = hex("#efe3ce"), PAPER2 = hex("#e2d3b8");
const RULE = hex("#b39c78"), BOLD = hex("#7d6749");
const LAMP = hex("#ffc97a"), INK = hex("#2a2018");

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/* A very plain seven-segment-ish 5 drawn as rectangles in unit space —
   a real digit, not a picture of one. */
function inFive(ux, uy) {
  const bar = (x0, x1, y0, y1) => ux >= x0 && ux <= x1 && uy >= y0 && uy <= y1;
  return bar(-0.33, 0.33, 0.40, 0.56) ||        // top
         bar(-0.33, -0.17, 0.14, 0.44) ||       // upper left
         bar(-0.33, 0.22, 0.00, 0.16) ||        // middle
         bar(0.17, 0.33, -0.38, 0.06) ||        // lower right
         bar(-0.33, 0.26, -0.54, -0.38);        // bottom
}

function makeIcon(size, pad) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3;
  const corner = size * 0.18;
  const zone = 1 - pad * 2;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const fx = px + (sx + 0.5) / SS, fy = py + (sy + 0.5) / SS;
      const cx = Math.max(corner - fx, fx - (size - corner), 0);
      const cy = Math.max(corner - fy, fy - (size - corner), 0);
      if ((cx * cx + cy * cy) > corner * corner) continue;

      /* the room, with the lamp falling from the top left */
      const nx = fx / size, ny = fy / size;
      const lamp = Math.max(0, 1 - Math.hypot(nx - 0.22, ny + 0.08) * 1.5);
      let col = mix(ROOM2, ROOM, lamp);

      /* the sheet */
      const u = (nx - pad) / zone, v = (ny - pad) / zone;
      if (u > 0.02 && u < 0.98 && v > 0.02 && v < 0.98) {
        col = mix(PAPER2, PAPER, Math.max(0, 1 - Math.hypot(u - 0.25, v - 0.1) * 1.1));
        const gx = u * 3, gy = v * 3;                    /* a 3×3 grid reads at 32px */
        const fxg = gx - Math.floor(gx), fyg = gy - Math.floor(gy);
        const w = 0.055;
        const nearX = Math.min(fxg, 1 - fxg), nearY = Math.min(fyg, 1 - fyg);
        if (nearX < w || nearY < w) col = RULE;
        /* the lit square, and the digit in it */
        if (gx > 1 && gx < 2 && gy > 1 && gy < 2) {
          if (!(nearX < w || nearY < w)) col = mix(col, LAMP, 0.55);
          const ux = (gx - 1.5) * 1.35, uy = (1.5 - gy) * 1.35;
          if (inFive(ux, uy)) col = INK;
        }
        /* the border of the sheet */
        if (u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95) col = mix(col, BOLD, 0.5);
      }
      r += col[0]; g += col[1]; b += col[2]; a += 255;
    }
    const n = SS * SS, o = (py * size + px) * 4;
    rgba[o] = Math.round(r / n); rgba[o + 1] = Math.round(g / n);
    rgba[o + 2] = Math.round(b / n); rgba[o + 3] = Math.round(a / n);
  }
  return png(size, size, rgba);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon-192.png"), makeIcon(192, 0.11));
fs.writeFileSync(path.join(outDir, "icon-512.png"), makeIcon(512, 0.11));
fs.writeFileSync(path.join(outDir, "icon-maskable-512.png"), makeIcon(512, 0.21));
fs.writeFileSync(path.join(outDir, "apple-touch-icon.png"), makeIcon(180, 0.11));
console.log("icons written to", outDir);
