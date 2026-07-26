/* anvil-check.js — dev-only. Proves the region reader.

   This is the check the whole room rests on, because the way region
   reading fails is uniquely nasty: it does not throw. Read a modern
   world with the pre-1.16 bit packing and every chunk still decodes,
   every palette index is still in range, and the world you get is
   *plausible and wrong* — walls half a block out, floors of the wrong
   material, a library you could walk around for ten minutes before
   realising none of it is what the builder made.

   So the region files here are written from scratch by this file — a
   full container, header and all — with the indices packed by two
   independent packers written from the format description. Then every
   one of the 4,096 blocks in a section is compared against what went
   in, for both packings, both section layouts, and every palette size
   that crosses a bits-per-index boundary.

   Run: node tools/anvil-check.js [--verbose]                          */
"use strict";
var zlib = require("zlib");
var A = require("../anvil.js");
var W = require("./nbt-write.js");

var VERBOSE = process.argv.indexOf("--verbose") >= 0;
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

/* ================================================================
   Independent packers, from the format description
   ================================================================ */
/* pre-1.16: one continuous bit stream; an index may straddle two longs */
function packSpanning(idx, bits) {
  var total = idx.length * bits;
  var longs = new Array(Math.ceil(total / 64)).fill(0n);
  for (var i = 0; i < idx.length; i++) {
    var v = BigInt(idx[i]) & ((1n << BigInt(bits)) - 1n);
    var at = i * bits, li = at >> 6, off = BigInt(at & 63);
    longs[li] = BigInt.asUintN(64, longs[li] | (v << off));
    var used = 64 - (at & 63);
    if (used < bits) longs[li + 1] = BigInt.asUintN(64, longs[li + 1] | (v >> BigInt(used)));
  }
  return longs.map(function (l) { return BigInt.asIntN(64, l); });
}
/* 1.16+: ⌊64/bits⌋ per long, remainder wasted, nothing straddles */
function packNoSpan(idx, bits) {
  var per = Math.floor(64 / bits);
  var longs = new Array(Math.ceil(idx.length / per)).fill(0n);
  for (var i = 0; i < idx.length; i++) {
    var v = BigInt(idx[i]) & ((1n << BigInt(bits)) - 1n);
    var li = Math.floor(i / per), off = BigInt((i % per) * bits);
    longs[li] = BigInt.asUintN(64, longs[li] | (v << off));
  }
  return longs.map(function (l) { return BigInt.asIntN(64, l); });
}

/* ================================================================
   A region file, written from scratch
   ================================================================ */
function buildRegion(chunks) {
  /* chunks: [{slot, nbtBytes, compression}] — compression 1 gzip, 2 zlib, 3 none */
  var locations = Buffer.alloc(4096), stamps = Buffer.alloc(4096);
  var bodies = [], sector = 2;                 /* the two header sectors come first */
  chunks.forEach(function (c) {
    var payload = c.compression === 1 ? zlib.gzipSync(Buffer.from(c.nbtBytes))
                : c.compression === 2 ? zlib.deflateSync(Buffer.from(c.nbtBytes))
                : Buffer.from(c.nbtBytes);
    var head = Buffer.alloc(5);
    head.writeUInt32BE(payload.length + 1, 0);  /* the length counts the compression byte */
    head.writeUInt8(c.compression, 4);
    var block = Buffer.concat([head, payload]);
    var pad = (4096 - (block.length % 4096)) % 4096;
    var full = Buffer.concat([block, Buffer.alloc(pad)]);
    var count = full.length / 4096;
    locations.writeUInt32BE((sector << 8) | (count & 0xff), c.slot * 4);
    stamps.writeUInt32BE(1700000000 + c.slot, c.slot * 4);
    bodies.push(full);
    sector += count;
  });
  return new Uint8Array(Buffer.concat([locations, stamps].concat(bodies)));
}

/* a chunk document with one section, in either layout */
function chunkDoc(opts) {
  var pal = opts.palette.map(function (n) { return [[8, "Name", n]]; });
  var longs = opts.longs.map(String);
  if (opts.modern) {
    return W.doc(10, "", [
      [3, "DataVersion", opts.dataVersion],
      [3, "xPos", opts.xPos || 0], [3, "zPos", opts.zPos || 0],
      [9, "sections", { itemType: 10, items: [[
        [1, "Y", opts.y || 0],
        [10, "block_states", [
          [9, "palette", { itemType: 10, items: pal }],
          [12, "data", longs]
        ]]
      ]] }]
    ]);
  }
  return W.doc(10, "", [
    [3, "DataVersion", opts.dataVersion],
    [10, "Level", [
      [3, "xPos", opts.xPos || 0], [3, "zPos", opts.zPos || 0],
      [9, "Sections", { itemType: 10, items: [[
        [1, "Y", opts.y || 0],
        [9, "Palette", { itemType: 10, items: pal }],
        [12, "BlockStates", longs]
      ]] }]
    ]]
  ]);
}

/* a deterministic but non-trivial arrangement of blocks */
function makeIndices(paletteSize) {
  var idx = new Uint16Array(4096);
  for (var i = 0; i < 4096; i++) idx[i] = (i * 2654435761 % paletteSize);
  /* pin a few by hand so an off-by-one in the packing is unmissable */
  idx[0] = paletteSize - 1; idx[1] = 0; idx[4095] = paletteSize - 1;
  idx[63] = paletteSize > 1 ? 1 : 0; idx[64] = paletteSize - 1;
  return idx;
}

/* ---------- the container itself ---------- */
(function () {
  var doc1 = chunkDoc({ modern: true, dataVersion: 3465, palette: ["minecraft:air", "minecraft:stone"],
                        longs: packNoSpan(makeIndices(2), 4), xPos: 3, zPos: -7 });
  var bytes = buildRegion([{ slot: 0, nbtBytes: doc1, compression: 2 },
                           { slot: 500, nbtBytes: doc1, compression: 1 },
                           { slot: 1023, nbtBytes: doc1, compression: 3 }]);
  var r = new A.Region(bytes);
  var present = r.present();
  ok("it finds exactly the chunks that are there", present.length === 3, present.length + "");
  ok("and where they sit in the region", present.map(function (p) { return p.slot; }).join(",") === "0,500,1023");
  ok("an empty slot reads as empty, not as an error", r.raw(17) === null);
  ok("the slot maths wraps a world coordinate into the region",
     r.slot(33, 65) === 1 + 1 * 32 && r.slot(-1, -1) === 31 + 31 * 32);
  ok("timestamps come back", r.timestamp(500) === 1700000000 + 500);

  return Promise.all([r.chunk(0), r.chunk(500), r.chunk(1023)]).then(function (cs) {
    ok("a zlib chunk decodes", !!cs[0] && cs[0].value.xPos === 3);
    ok("a gzip chunk decodes", !!cs[1] && cs[1].value.xPos === 3);
    ok("an uncompressed chunk decodes", !!cs[2] && cs[2].value.xPos === 3);
  });
})().then(function () {

  /* ---------- the packing, both ways, every palette size ----------
     The heart of it. Sizes chosen to sit either side of every
     bits-per-index step: 4 bits up to 16 entries, then 5, 6, 7, 8, 9. */
  var sizes = [2, 3, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 255, 256, 257];
  var jobs = [];
  sizes.forEach(function (size) {
    [true, false].forEach(function (modern) {
      var idx = makeIndices(size);
      var bits = A.bitsFor(size);
      /* modern worlds pack without spanning; older ones span */
      var dv = modern ? 3465 : 1976;
      var longs = modern ? packNoSpan(idx, bits) : packSpanning(idx, bits);
      var palette = [];
      for (var i = 0; i < size; i++) palette.push("test:block_" + i);
      var d = chunkDoc({ modern: modern, dataVersion: dv, palette: palette, longs: longs });
      var region = new A.Region(buildRegion([{ slot: 0, nbtBytes: d, compression: 2 }]));
      jobs.push(region.chunk(0).then(function (root) {
        var secs = A.sections(root);
        if (!secs.list.length) return { size: size, modern: modern, err: "no sections decoded" };
        var sec = secs.list[0];
        if (sec.palette.length !== size) return { size: size, modern: modern, err: "palette " + sec.palette.length };
        var wrong = 0, firstBad = -1;
        for (var i = 0; i < 4096; i++) {
          if (sec.blocks[i] !== idx[i]) { wrong++; if (firstBad < 0) firstBad = i; }
        }
        return { size: size, modern: modern, bits: bits, wrong: wrong, firstBad: firstBad };
      }));
    });
  });

  return Promise.all(jobs).then(function (res) {
    var badModern = res.filter(function (r) { return r.modern && (r.err || r.wrong); });
    var badOld = res.filter(function (r) { return !r.modern && (r.err || r.wrong); });
    ok("every block decodes exactly, 1.16 and later", badModern.length === 0,
       badModern.map(function (b) { return b.size + ":" + (b.err || b.wrong + " wrong from " + b.firstBad); }).join(" "));
    ok("every block decodes exactly, before 1.16", badOld.length === 0,
       badOld.map(function (b) { return b.size + ":" + (b.err || b.wrong + " wrong from " + b.firstBad); }).join(" "));
    console.log("      " + res.length + " sections × 4,096 blocks checked across " +
                sizes.length + " palette sizes (" + A.bitsFor(2) + "–" + A.bitsFor(257) + " bits)");

    /* And the thing that makes the check worth having: the *wrong*
       reading must actually produce a wrong world. If both packings
       decoded the same bytes identically, this file would be proving
       nothing at all. */
    var idx = makeIndices(33), bits = A.bitsFor(33);
    var packed = packNoSpan(idx, bits);
    var asSpanning = A.unpack(packed.map(BigInt), bits, 4096, true);
    var differs = 0;
    for (var i = 0; i < 4096; i++) if (asSpanning[i] !== idx[i]) differs++;
    ok("reading a modern world the old way really does corrupt it", differs > 500,
       differs + " of 4096 blocks would have been wrong");
    console.log("      (had the packing been read the wrong way, " + differs +
                " of 4,096 blocks would be the wrong block — and nothing would have thrown)");
  });
}).then(function () {

  /* ---------- the shapes real worlds arrive in ---------- */
  var air = W.doc(10, "", [
    [3, "DataVersion", 3465],
    [9, "sections", { itemType: 10, items: [[
      [1, "Y", 0],
      [10, "block_states", [[9, "palette", { itemType: 10, items: [[[8, "Name", "minecraft:air"]]] }]]]
    ]] }]
  ]);
  var r = new A.Region(buildRegion([{ slot: 0, nbtBytes: air, compression: 2 }]));
  return r.chunk(0).then(function (root) {
    var secs = A.sections(root);
    ok("a single-block section with no data array is understood", secs.list.length === 1);
    ok("and it is that block all the way through",
       secs.list[0].uniform === true && A.blockAt(secs.list[0], 5, 5, 5) === "minecraft:air");
  });
}).then(function () {

  /* a section list that is missing, empty, or full of junk must give an
     empty world rather than an exception halfway through a render */
  var odd = [
    ["no sections at all", W.doc(10, "", [[3, "DataVersion", 3465]])],
    ["an empty section list", W.doc(10, "", [[3, "DataVersion", 3465], [9, "sections", { itemType: 10, items: [] }]])],
    ["a section with no palette", W.doc(10, "", [[3, "DataVersion", 3465],
      [9, "sections", { itemType: 10, items: [[[1, "Y", 0]]] }]])]
  ];
  var jobs = odd.map(function (o) {
    var r = new A.Region(buildRegion([{ slot: 0, nbtBytes: o[1], compression: 2 }]));
    return r.chunk(0).then(function (root) {
      var out;
      try { out = A.sections(root); } catch (e) { return o[0] + " threw: " + e.message; }
      return out.list.length === 0 ? null : o[0] + " produced " + out.list.length;
    });
  });
  return Promise.all(jobs).then(function (res) {
    var bad = res.filter(Boolean);
    ok("odd or empty chunks give an empty world, never an exception", bad.length === 0, bad.join("; "));
  });
}).then(function () {

  /* ---------- damaged region files ---------- */
  var d = chunkDoc({ modern: true, dataVersion: 3465, palette: ["minecraft:air", "minecraft:stone"],
                     longs: packNoSpan(makeIndices(2), 4) });
  var whole = buildRegion([{ slot: 0, nbtBytes: d, compression: 2 }]);

  ok("a file too short to hold a header is refused", (function () {
    try { new A.Region(new Uint8Array(100)); return false; } catch (e) { return true; }
  })());

  /* A header pointing past the end of the file — the classic result of
     an interrupted download.

     Cut a hundred bytes into the chunk rather than on a sector
     boundary: this chunk compresses to well under 4 KiB, so slicing at
     three whole sectors keeps every byte of it and truncates nothing.
     (It did, and the check passed for the wrong reason.) */
  var cut = whole.slice(0, 4096 * 2 + 100);
  var rc = new A.Region(cut);
  var got = null, threw = false;
  try { got = rc.raw(0); } catch (e) { threw = true; }
  ok("a chunk pointing past the end does not throw", !threw);

  return rc.chunk(0).then(function () { return "resolved"; }, function () { return "rejected"; })
    .then(function (how) {
      ok("and a truncated chunk rejects rather than returning half a world", how === "rejected", how);
    });
}).then(function () {

  /* ---------- world folders ---------- */
  ok("a region file is recognised by name",
     JSON.stringify(A.regionName("r.-3.7.mca")) === '{"rx":-3,"rz":7}');
  ok("even nested in a folder",
     JSON.stringify(A.regionName("UncensoredLibrary/region/r.0.-1.mca")) === '{"rx":0,"rz":-1}');
  ok("and other files are ignored",
     A.regionName("level.dat") === null && A.regionName("r.1.2.mcr") === null &&
     A.regionName("notes.txt") === null);

  console.log("\n" + (fail === 0
    ? "the world reads true — " + pass + " checks passed"
    : fail + " of " + (pass + fail) + " checks FAILED"));
  if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
}).catch(function (e) {
  console.log("FAIL  the checks themselves threw — " + e.message);
  console.log(e.stack);
  process.exit(1);
});
