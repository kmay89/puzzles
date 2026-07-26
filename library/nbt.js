/* nbt.js — Minecraft's binary format, read from scratch.

   NBT (Named Binary Tag) is the format every Minecraft world is written
   in: a tree of tagged values, big-endian, usually gzip- or
   zlib-compressed. Nothing about it is secret — the format has been
   documented since 2010 — and it is small enough to write out in one
   file, which is exactly what this is.

   Nothing of Mojang's is here. This is a reader for a documented file
   format, the same way a PNG decoder is a reader for a documented file
   format. It ships no game code and no game assets; it is what lets you
   point the room at a world *you* have on disk and walk around in it.

   Two things worth knowing about the implementation:

   · **Longs are BigInt.** A TAG_Long does not fit in a double, and the
     packed block arrays in modern chunks are long arrays where every
     bit matters — rounding one is not a small error, it is a wall in
     the wrong place. They stay exact.

   · **Decompression is the browser's.** `DecompressionStream` does
     gzip and zlib natively in every browser that matters and in node,
     so there is no inflate implementation here to get wrong.

   Run `node tools/nbt-check.js` — it writes NBT with an independent
   encoder and demands this reader gets it back unchanged.            */
(function (root) {
"use strict";

/* the thirteen tag types, in the order the format numbers them */
var END = 0, BYTE = 1, SHORT = 2, INT = 3, LONG = 4, FLOAT = 5, DOUBLE = 6,
    BYTE_ARRAY = 7, STRING = 8, LIST = 9, COMPOUND = 10, INT_ARRAY = 11, LONG_ARRAY = 12;

var TYPE_NAME = ["END","BYTE","SHORT","INT","LONG","FLOAT","DOUBLE",
                 "BYTE_ARRAY","STRING","LIST","COMPOUND","INT_ARRAY","LONG_ARRAY"];

/* ---------- a reader over a byte buffer ----------
   Everything in NBT is big-endian, which is the opposite of what a
   DataView defaults to for nothing, so every call passes `false`. */
function Reader(bytes) {
  this.b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  this.v = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
  this.p = 0;
}
Reader.prototype.need = function (n) {
  if (this.p + n > this.b.length) {
    throw new Error("NBT: ran off the end of the data at byte " + this.p +
      " (wanted " + n + ", " + (this.b.length - this.p) + " left)");
  }
};
Reader.prototype.u8 = function () { this.need(1); return this.b[this.p++]; };
Reader.prototype.i8 = function () { this.need(1); var x = this.v.getInt8(this.p); this.p += 1; return x; };
Reader.prototype.i16 = function () { this.need(2); var x = this.v.getInt16(this.p, false); this.p += 2; return x; };
Reader.prototype.u16 = function () { this.need(2); var x = this.v.getUint16(this.p, false); this.p += 2; return x; };
Reader.prototype.i32 = function () { this.need(4); var x = this.v.getInt32(this.p, false); this.p += 4; return x; };
Reader.prototype.i64 = function () { this.need(8); var x = this.v.getBigInt64(this.p, false); this.p += 8; return x; };
Reader.prototype.f32 = function () { this.need(4); var x = this.v.getFloat32(this.p, false); this.p += 4; return x; };
Reader.prototype.f64 = function () { this.need(8); var x = this.v.getFloat64(this.p, false); this.p += 8; return x; };

/* NBT strings are "modified UTF-8" — which is plain UTF-8 for every
   character a block name or a book page will ever contain. The two
   places it differs (a NUL encoded as two bytes, and astral characters
   written as surrogate pairs) are handled rather than assumed away,
   because book text in a world like the Uncensored Library is real
   prose in many languages and will contain both. */
Reader.prototype.str = function () {
  var len = this.u16();
  this.need(len);
  var out = "", i = 0, b = this.b, p = this.p, end = p + len;
  while (p < end) {
    var c = b[p];
    if (c < 0x80) { out += String.fromCharCode(c); p += 1; }
    else if ((c & 0xE0) === 0xC0) {
      out += String.fromCharCode(((c & 0x1F) << 6) | (b[p + 1] & 0x3F)); p += 2;
    } else if ((c & 0xF0) === 0xE0) {
      out += String.fromCharCode(((c & 0x0F) << 12) | ((b[p + 1] & 0x3F) << 6) | (b[p + 2] & 0x3F)); p += 3;
    } else {
      /* four-byte sequences are not legal modified UTF-8, but real
         files contain them; decode rather than throw */
      var cp = ((c & 0x07) << 18) | ((b[p + 1] & 0x3F) << 12) | ((b[p + 2] & 0x3F) << 6) | (b[p + 3] & 0x3F);
      cp -= 0x10000;
      out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      p += 4;
    }
    if (++i > len) break;
  }
  this.p = end;
  return out;
};

/* ---------- the payload of one tag ---------- */
function payload(r, type) {
  var i, n, out;
  switch (type) {
    case BYTE: return r.i8();
    case SHORT: return r.i16();
    case INT: return r.i32();
    case LONG: return r.i64();
    case FLOAT: return r.f32();
    case DOUBLE: return r.f64();
    case STRING: return r.str();
    case BYTE_ARRAY:
      n = r.i32(); r.need(n);
      out = new Int8Array(r.b.buffer, r.b.byteOffset + r.p, n).slice();
      r.p += n; return out;
    case INT_ARRAY:
      n = r.i32(); out = new Int32Array(n);
      for (i = 0; i < n; i++) out[i] = r.i32();
      return out;
    case LONG_ARRAY:
      n = r.i32(); out = new BigInt64Array(n);
      for (i = 0; i < n; i++) out[i] = r.i64();
      return out;
    case LIST:
      var t = r.u8(); n = r.i32();
      out = [];
      /* a zero-length list may claim type END; that is legal and means
         nothing follows */
      if (n <= 0) { out.type = t; return out; }
      for (i = 0; i < n; i++) out.push(payload(r, t));
      out.type = t;
      return out;
    case COMPOUND:
      out = {};
      for (;;) {
        var tt = r.u8();
        if (tt === END) break;
        var name = r.str();
        out[name] = payload(r, tt);
      }
      return out;
    case END: return null;
    default:
      throw new Error("NBT: unknown tag type " + type + " at byte " + (r.p - 1));
  }
}

/* ---------- reading a whole document ----------
   `parse(bytes)` returns { name, value } for the outermost tag, which
   in every real file is a compound. */
function parse(bytes) {
  var r = new Reader(bytes);
  var type = r.u8();
  if (type === END) return { name: "", value: null };
  var name = r.str();
  return { name: name, value: payload(r, type), type: type };
}

/* ---------- compression ----------
   A .dat file is gzip; a chunk inside a region file is usually zlib and
   occasionally raw or uncompressed. Sniff rather than trust: the first
   two bytes say which, and a mislabelled chunk is not rare in worlds
   that have been through third-party tools. */
function sniff(bytes) {
  if (bytes.length < 2) return "none";
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  /* zlib: CMF/FLG where CMF low nibble is 8 (deflate) and the pair is a
     multiple of 31 */
  if ((bytes[0] & 0x0f) === 0x08 && ((bytes[0] << 8) + bytes[1]) % 31 === 0) return "deflate";
  return "none";
}

function inflate(bytes, format) {
  format = format || sniff(bytes);
  if (format === "none") return Promise.resolve(bytes);
  if (typeof DecompressionStream !== "function") {
    return Promise.reject(new Error("this browser cannot decompress; a world file needs DecompressionStream"));
  }
  var ds;
  try { ds = new DecompressionStream(format); }
  catch (e) { return Promise.reject(new Error("unsupported compression: " + format)); }
  var w = ds.writable.getWriter();
  /* both of the writer's promises need somewhere to land — a truncated
     chunk rejects them, and an unhandled rejection takes node down and
     fills a browser console with what looks like a crash */
  w.write(bytes).catch(nothing);
  w.close().catch(nothing);
  return new Response(ds.readable).arrayBuffer().then(function (buf) {
    return new Uint8Array(buf);
  });
}
function nothing() {}

/* read a possibly-compressed document */
function load(bytes) {
  return inflate(bytes).then(function (raw) { return parse(raw); });
}

/* ---------- getting at values without a pile of guards ----------
   Worlds differ by version, by mod, and by whatever tool last touched
   them, so every read of a nested field is a read that might not be
   there. `pick(root, "Level.Sections")` returns undefined rather than
   throwing halfway down. */
function pick(obj, path, fallback) {
  var parts = String(path).split("."), cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return fallback;
    cur = cur[parts[i]];
  }
  return cur === undefined ? fallback : cur;
}

var NBT = {
  END: END, BYTE: BYTE, SHORT: SHORT, INT: INT, LONG: LONG, FLOAT: FLOAT, DOUBLE: DOUBLE,
  BYTE_ARRAY: BYTE_ARRAY, STRING: STRING, LIST: LIST, COMPOUND: COMPOUND,
  INT_ARRAY: INT_ARRAY, LONG_ARRAY: LONG_ARRAY, TYPE_NAME: TYPE_NAME,
  Reader: Reader, parse: parse, load: load, inflate: inflate, sniff: sniff, pick: pick
};
if (typeof module !== "undefined" && module.exports) module.exports = NBT;
else root.NBT = NBT;
})(typeof self !== "undefined" ? self : this);
