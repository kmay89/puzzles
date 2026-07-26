/* make-icons.js — dev-only. Draws the app icons from scratch.

   No canvas, no image library: the pixels are worked out analytically
   and written into a PNG by hand (node's zlib does the compression;
   the chunk framing and the CRC are here). Same approach as the chess
   room's icon tool — it keeps the repo free of binary source assets
   nobody can regenerate.

   The icon is the 6|6 — la mula de seis, the bone that opens the first
   hand of every match — standing on a warm cantina brown.

   Run: node tools/make-icons.js                                        */
"use strict";
var zlib = require("zlib");
var fs = require("fs");
var path = require("path");

var OUT = path.join(__dirname, "..", "icons");

/* ---------- a minimal PNG writer ---------- */
var CRC = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  var sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  /* one filter byte per scanline, filter 0 (none) */
  var raw = Buffer.alloc((w * 4 + 1) * h);
  for (var y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- the drawing, as maths ---------- */
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
/* coverage of a disc/rect, sampled 3×3 per pixel so the edges are smooth
   without needing a rasteriser */
function draw(size, maskable) {
  var buf = Buffer.alloc(size * size * 4);
  var S = size;
  /* the bone: a rounded rect standing upright, centred */
  var pad = maskable ? S * 0.26 : S * 0.15;
  var bw = (S - pad * 2) * 0.56, bh = S - pad * 2;
  var bx = (S - bw) / 2, by = pad, br = bw * 0.17;

  function inRound(x, y) {
    var dx = Math.max(bx + br - x, 0, x - (bx + bw - br));
    var dy = Math.max(by + br - y, 0, y - (by + bh - br));
    return Math.hypot(dx, dy) <= br;
  }
  /* six pips a half, in the two-column arrangement */
  var pips = [];
  [0, 1].forEach(function (half) {
    var cy0 = by + bh * (half ? 0.75 : 0.25);
    [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]].forEach(function (p) {
      pips.push([bx + bw / 2 + p[0] * bw * 0.24, cy0 + p[1] * bh * 0.135]);
    });
  });
  var pipR = bw * 0.095;

  for (var y = 0; y < S; y++) {
    for (var x = 0; x < S; x++) {
      var r = 0, g = 0, b = 0, a = 0, n = 0;
      for (var sy = 0; sy < 3; sy++) for (var sx = 0; sx < 3; sx++) {
        var px = x + (sx + 0.5) / 3, py = y + (sy + 0.5) / 3;
        n++;
        var cr, cg, cb, ca = 255;
        if (inRound(px, py)) {
          /* the bone face, with a soft top-left sheen and a bevel */
          var t = 1 - ((px - bx) / bw * 0.5 + (py - by) / bh * 0.5);
          cr = clamp(226 + t * 26); cg = clamp(212 + t * 26); cb = clamp(184 + t * 24);
          /* the divider across the middle */
          if (Math.abs(py - (by + bh / 2)) < bh * 0.012 && px > bx + bw * 0.1 && px < bx + bw * 0.9) {
            cr = 60; cg = 44; cb = 32;
          }
          for (var q = 0; q < pips.length; q++) {
            if (Math.hypot(px - pips[q][0], py - pips[q][1]) <= pipR) { cr = 42; cg = 30; cb = 22; }
          }
        } else {
          /* the table under it */
          var v = 1 - (py / S) * 0.35;
          cr = clamp(38 * v + 12); cg = clamp(24 * v + 8); cb = clamp(16 * v + 5);
        }
        r += cr; g += cg; b += cb; a += ca;
      }
      var o = (y * S + x) * 4;
      buf[o] = clamp(r / n); buf[o + 1] = clamp(g / n); buf[o + 2] = clamp(b / n); buf[o + 3] = clamp(a / n);
    }
  }
  return buf;
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
var jobs = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, false]
];
jobs.forEach(function (j) {
  var buf = png(j[1], j[1], draw(j[1], j[2]));
  fs.writeFileSync(path.join(OUT, j[0]), buf);
  console.log("  " + j[0] + "  " + j[1] + "×" + j[1] + "  " + (buf.length / 1024).toFixed(1) + " kB");
});
console.log("icons drawn.");
