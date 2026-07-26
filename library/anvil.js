/* anvil.js — reading a Minecraft region file, from scratch.

   A world is a directory of `r.<x>.<z>.mca` files. Each holds up to
   1024 chunks in a documented container: two 4 KiB tables at the front
   saying where each chunk lives and when it was written, then the
   chunks themselves, each a length, a compression byte, and a
   compressed NBT document.

   None of this is Mojang's code. It is a reader for a documented
   container format, like a ZIP reader — which is what makes it possible
   to point this room at a world *you* downloaded and walk around inside
   it without a byte of the game shipping here.

   ## The bit that everybody gets wrong

   Since 1.13 a chunk section stores its blocks as a palette plus a
   packed array of indices into it, and the packing changed in 1.16.

   · **Before 1.16**, indices are packed end to end across the whole
     long array, so an index can straddle the boundary between one
     64-bit long and the next.
   · **From 1.16**, an index never spans two longs. Each long holds
     ⌊64 / bits⌋ of them and any leftover bits are simply wasted.

   Read a modern world with the old rule (or the reverse) and you do not
   get an error — you get a world that is *subtly* wrong, walls half a
   block out, floors made of the wrong material, everything plausible
   and nothing right. `DataVersion` 2529 is the changeover, and both
   readings are implemented below because a library of worlds contains
   both.                                                              */
(function (root) {
"use strict";

var NBT = (typeof require === "function" && typeof module !== "undefined")
  ? require("./nbt.js") : root.NBT;

var SECTOR = 4096;
/* 20w17a — the snapshot where packed indices stopped spanning longs */
var DV_NO_SPAN = 2529;
/* 21w39a-ish — sections moved to the root and gained block_states */
var DV_NEW_SECTIONS = 2825;

/* ---------- the region container ---------- */
function Region(bytes) {
  this.b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (this.b.length < SECTOR * 2) throw new Error("region file is too short to hold its own header");
  this.v = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength);
}

/* where chunk (cx, cz) sits within its region; both are region-local */
Region.prototype.slot = function (cx, cz) { return (cx & 31) + (cz & 31) * 32; };

Region.prototype.entry = function (slot) {
  var w = this.v.getUint32(slot * 4, false);
  return { sector: w >>> 8, count: w & 0xff };
};
Region.prototype.timestamp = function (slot) { return this.v.getUint32(SECTOR + slot * 4, false); };

/* which chunks this file actually contains — a region is usually far
   from full, and an empty slot is normal, not an error */
Region.prototype.present = function () {
  var out = [];
  for (var s = 0; s < 1024; s++) {
    var e = this.entry(s);
    if (e.sector >= 2 && e.count > 0) out.push({ slot: s, x: s & 31, z: s >> 5, sectors: e.count });
  }
  return out;
};

/* the raw, still-compressed payload of one chunk */
Region.prototype.raw = function (slot) {
  var e = this.entry(slot);
  if (e.sector < 2 || e.count === 0) return null;
  var off = e.sector * SECTOR;
  if (off + 5 > this.b.length) return null;
  var len = this.v.getUint32(off, false);
  var comp = this.b[off + 4];
  if (len <= 0) return null;
  /* the length counts the compression byte, so the payload is len-1 */
  var end = off + 4 + len;
  if (end > this.b.length) end = this.b.length;        /* truncated file: take what is there */
  var body = this.b.subarray(off + 5, end);
  /* the top bit means the chunk was too big for the region and lives in
     its own file alongside; we cannot reach it from these bytes alone */
  if (comp & 0x80) return { external: true, comp: comp & 0x7f, body: body };
  return { external: false, comp: comp, body: body };
};

var COMPRESSION = { 1: "gzip", 2: "deflate", 3: "none", 4: "lz4" };

/* one chunk, as parsed NBT */
Region.prototype.chunk = function (slot) {
  var r = this.raw(slot);
  if (!r) return Promise.resolve(null);
  if (r.external) return Promise.reject(new Error("chunk " + slot + " is stored outside the region file"));
  var how = COMPRESSION[r.comp];
  if (how === "lz4") return Promise.reject(new Error("chunk " + slot + " uses LZ4, which the browser cannot undo"));
  if (!how) {
    /* an unknown byte is more often a mislabelled chunk than a new
       format, so fall back to sniffing rather than giving up */
    how = NBT.sniff(r.body);
  }
  return NBT.inflate(r.body, how === "none" ? "none" : how).then(function (raw) {
    return NBT.parse(raw);
  });
};

/* ---------- unpacking a packed index array ----------
   `spanning` picks the pre-1.16 reading. Returns plain numbers: a
   palette index never exceeds 2^12, so a Uint16Array holds them all
   exactly and the BigInts stop here. */
function unpack(longs, bits, count, spanning) {
  var out = new Uint16Array(count);
  if (!longs || !longs.length || bits <= 0) return out;
  var mask = (1n << BigInt(bits)) - 1n;
  var B = BigInt(bits), i;

  if (!spanning) {
    /* 1.16+: each long carries ⌊64/bits⌋ entries and stops */
    var per = Math.floor(64 / bits);
    for (i = 0; i < count; i++) {
      var li = Math.floor(i / per);
      if (li >= longs.length) break;
      var shift = BigInt((i % per) * bits);
      out[i] = Number((BigInt.asUintN(64, longs[li]) >> shift) & mask);
    }
    return out;
  }

  /* pre-1.16: one continuous bit stream, entries straddle longs */
  for (i = 0; i < count; i++) {
    var at = i * bits;
    var idx = at >> 6, off = BigInt(at & 63);
    if (idx >= longs.length) break;
    var lo = BigInt.asUintN(64, longs[idx]);
    var val = lo >> off;
    var have = 64 - (at & 63);
    if (have < bits && idx + 1 < longs.length) {
      var hi = BigInt.asUintN(64, longs[idx + 1]);
      val |= hi << BigInt(have);
    }
    out[i] = Number(val & mask);
  }
  return out;
}

/* how many bits an index needs for a palette of this size — at least 4,
   which is the format's floor even for a two-entry palette */
function bitsFor(paletteLength) {
  return Math.max(4, Math.ceil(Math.log2(Math.max(2, paletteLength))));
}

/* ---------- one 16×16×16 section ----------
   Returns { y, palette:[name…], blocks:Uint16Array(4096) } with blocks
   indexed y*256 + z*16 + x, which is the order the format stores them.
   Returns null for a section that is entirely air. */
function section(sec, dataVersion) {
  if (!sec) return null;
  var y = typeof sec.Y === "number" ? sec.Y : (typeof sec.y === "number" ? sec.y : 0);

  /* two shapes: 1.18+ nests them under block_states, older worlds keep
     Palette and BlockStates side by side */
  var pal = null, data = null;
  if (sec.block_states) { pal = sec.block_states.palette; data = sec.block_states.data; }
  else { pal = sec.Palette; data = sec.BlockStates; }
  if (!pal || !pal.length) return null;

  var names = [];
  for (var i = 0; i < pal.length; i++) {
    var e = pal[i];
    names.push(typeof e === "string" ? e : (e && e.Name ? e.Name : "minecraft:air"));
  }

  /* a single-entry palette has no data array at all — the whole section
     is that one block, which for air is most of a world */
  if (!data || !data.length) {
    if (names.length === 1) {
      return { y: y, palette: names, blocks: new Uint16Array(4096), uniform: true };
    }
    return null;
  }

  var bits = bitsFor(names.length);
  var spanning = (dataVersion || 0) < DV_NO_SPAN;
  return { y: y, palette: names, blocks: unpack(data, bits, 4096, spanning), uniform: false };
}

/* every section of a chunk, whichever layout the world uses */
function sections(chunkRoot) {
  var v = chunkRoot && chunkRoot.value ? chunkRoot.value : chunkRoot;
  if (!v) return { dataVersion: 0, list: [] };
  var dv = v.DataVersion || NBT.pick(v, "Level.DataVersion", 0) || 0;
  var list = v.sections || NBT.pick(v, "Level.Sections") || NBT.pick(v, "Level.sections") || [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var s = section(list[i], dv);
    if (s) out.push(s);
  }
  return { dataVersion: dv, list: out, xPos: v.xPos !== undefined ? v.xPos : NBT.pick(v, "Level.xPos", 0),
           zPos: v.zPos !== undefined ? v.zPos : NBT.pick(v, "Level.zPos", 0) };
}

/* the block at a position inside a decoded section */
function blockAt(sec, x, y, z) {
  if (!sec) return "minecraft:air";
  if (sec.uniform) return sec.palette[0];
  return sec.palette[sec.blocks[(y << 8) | (z << 4) | x]] || "minecraft:air";
}

/* ---------- a whole world folder ----------
   The browser hands us a FileList from a drop or a picker; the region
   files are whatever is named r.<x>.<z>.mca anywhere inside it. */
function regionName(name) {
  var m = /(?:^|\/)r\.(-?\d+)\.(-?\d+)\.mca$/.exec(String(name));
  return m ? { rx: parseInt(m[1], 10), rz: parseInt(m[2], 10) } : null;
}

var Anvil = {
  SECTOR: SECTOR, DV_NO_SPAN: DV_NO_SPAN, DV_NEW_SECTIONS: DV_NEW_SECTIONS,
  Region: Region, unpack: unpack, bitsFor: bitsFor,
  section: section, sections: sections, blockAt: blockAt, regionName: regionName
};
if (typeof module !== "undefined" && module.exports) module.exports = Anvil;
else root.Anvil = Anvil;
})(typeof self !== "undefined" ? self : this);
