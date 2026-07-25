/* make-icons.js — draws the app icons from scratch (no image libraries):
   a friendly ivory pawn on warm walnut with a soft checkerboard corner.
   Rasterized analytically with 3×3 supersampling, PNG-encoded by hand
   with node's zlib. Run: node chess/tools/make-icons.js */
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
const WALNUT = hex("#3a2a1e"), WALNUT2 = hex("#4a3627"), IVORY = hex("#f4ead6"), RIMC = hex("#241a12");

/* pawn silhouette in unit coords: x ∈ [-0.5, 0.5], y ∈ [0 bottom, 1 top] */
function inPawn(x, y) {
  /* head */
  const hx = x, hy = y - 0.70;
  if (hx * hx + hy * hy < 0.155 * 0.155) return true;
  /* collar */
  if (y > 0.52 && y < 0.585 && Math.abs(x) < 0.145 - (y - 0.52) * 0.4) return true;
  /* neck (tapered) */
  if (y >= 0.30 && y <= 0.56) {
    const t = (y - 0.30) / 0.26;
    if (Math.abs(x) < 0.135 - t * 0.055) return true;
  }
  /* shoulders */
  if (y >= 0.24 && y < 0.30 && Math.abs(x) < 0.16) return true;
  /* base flare */
  if (y >= 0.10 && y < 0.24) {
    const t = (y - 0.10) / 0.14;
    if (Math.abs(x) < 0.235 - t * 0.075) return true;
  }
  /* plinth */
  if (y >= 0.045 && y < 0.115 && Math.abs(x) < 0.26 - Math.max(0, 0.06 - (y - 0.045)) * 0.8) return true;
  return false;
}

function makeIcon(size, pad) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = 3; /* supersample */
  const corner = size * 0.18;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const fx = (px + (sx + 0.5) / S), fy = (py + (sy + 0.5) / S);
      /* rounded-rect mask */
      const cx = Math.max(corner - fx, fx - (size - corner), 0);
      const cy = Math.max(corner - fy, fy - (size - corner), 0);
      const inside = (cx * cx + cy * cy) <= corner * corner;
      let col = null;
      if (inside) {
        /* walnut with a faint 4×4 checker */
        const ch = ((Math.floor(fx / (size / 4)) + Math.floor(fy / (size / 4))) % 2 === 0);
        col = ch ? WALNUT : WALNUT2;
        /* subtle vignette rim */
        const dx = fx / size - 0.5, dy = fy / size - 0.5;
        if (dx * dx + dy * dy > 0.21) col = RIMC;
        /* the pawn (leave `pad` fraction of margin for maskable icons) */
        const zone = 1 - pad * 2;
        const ux = (fx / size - 0.5) / zone;
        const uy = 1 - ((fy / size - pad) / zone);
        if (ux >= -0.5 && ux <= 0.5 && uy >= 0 && uy <= 1 && inPawn(ux, uy)) col = IVORY;
      }
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
    }
    const n = S * S, o = (py * size + px) * 4;
    rgba[o] = Math.round(r / n); rgba[o + 1] = Math.round(g / n);
    rgba[o + 2] = Math.round(b / n); rgba[o + 3] = Math.round(a / n);
  }
  return png(size, size, rgba);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon-192.png"), makeIcon(192, 0.10));
fs.writeFileSync(path.join(outDir, "icon-512.png"), makeIcon(512, 0.10));
fs.writeFileSync(path.join(outDir, "icon-maskable-512.png"), makeIcon(512, 0.20));
fs.writeFileSync(path.join(outDir, "apple-touch-icon.png"), makeIcon(180, 0.10));
console.log("icons written to", outDir);
