/* make-icons.js — dev-only. Draws the icons from scratch.

   No canvas and no image library: the pixels are worked out
   analytically and written into a PNG by hand (node's zlib does the
   compression; the chunk framing and the CRC are here). Keeps the repo
   free of binary source assets nobody can regenerate.

   The icon is a book standing open on a dark shelf — the room's whole
   subject in one shape.

   Run: node tools/make-icons.js                                       */
"use strict";
var zlib = require("zlib"), fs = require("fs"), path = require("path");
var OUT = path.join(__dirname, "..", "icons");

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
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  var sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  var raw = Buffer.alloc((w * 4 + 1) * h);
  for (var y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

function draw(S, maskable) {
  var buf = Buffer.alloc(S * S * 4);
  var pad = maskable ? S * 0.27 : S * 0.16;
  var w = S - pad * 2, h = w * 0.72;
  var bx = pad, by = (S - h) / 2, mid = S / 2;

  for (var y = 0; y < S; y++) {
    for (var x = 0; x < S; x++) {
      var r = 0, g = 0, b = 0, n = 0;
      for (var sy = 0; sy < 3; sy++) for (var sx = 0; sx < 3; sx++) {
        var px = x + (sx + 0.5) / 3, py = y + (sy + 0.5) / 3;
        n++;
        var cr, cg, cb;
        /* the two leaves of an open book, each tilting away from the spine */
        var inBook = false, leaf = 0;
        if (py >= by && py <= by + h) {
          var t = (py - by) / h;                       /* 0 at the top edge */
          var sag = Math.sin(t * Math.PI) * h * 0.10;  /* pages bow outward */
          if (px >= bx - sag && px < mid) { inBook = true; leaf = -1; }
          else if (px <= bx + w + sag && px >= mid) { inBook = true; leaf = 1; }
        }
        if (inBook) {
          var edge = Math.min(Math.abs(px - (leaf < 0 ? bx : bx + w)), 6) / 6;
          var lift = leaf < 0 ? 1 - (px - bx) / (w / 2) : (px - mid) / (w / 2);
          var shade = 0.80 + 0.20 * (1 - lift);
          cr = clamp(238 * shade); cg = clamp(232 * shade); cb = clamp(214 * shade);
          /* the spine, and a few lines of type on each leaf */
          if (Math.abs(px - mid) < S * 0.012) { cr = 92; cg = 70; cb = 44; }
          else {
            var line = Math.floor((py - by) / (h / 9));
            var within = ((py - by) % (h / 9)) < (h / 9) * 0.34;
            var far = leaf < 0 ? px > bx + w * 0.10 : px < bx + w * 0.90;
            if (within && line > 0 && line < 8 && far && edge > 0.12) {
              cr = clamp(cr * 0.62); cg = clamp(cg * 0.60); cb = clamp(cb * 0.58);
            }
          }
        } else {
          var v = 1 - (py / S) * 0.5;
          cr = clamp(20 * v + 8); cg = clamp(24 * v + 10); cb = clamp(30 * v + 12);
        }
        r += cr; g += cg; b += cb;
      }
      var o = (y * S + x) * 4;
      buf[o] = clamp(r / n); buf[o + 1] = clamp(g / n); buf[o + 2] = clamp(b / n); buf[o + 3] = 255;
    }
  }
  return buf;
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
[["icon-192.png", 192, false], ["icon-512.png", 512, false],
 ["icon-maskable-512.png", 512, true], ["apple-touch-icon.png", 180, false]
].forEach(function (j) {
  var buf = png(j[1], j[1], draw(j[1], j[2]));
  fs.writeFileSync(path.join(OUT, j[0]), buf);
  console.log("  " + j[0] + "  " + j[1] + "×" + j[1] + "  " + (buf.length / 1024).toFixed(1) + " kB");
});
console.log("icons drawn.");
