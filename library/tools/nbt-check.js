/* nbt-check.js — dev-only. Proves the NBT reader.

   The reader is checked against an **independent encoder**, written
   here from the format documentation rather than derived from the
   parser. That matters: a reader tested against its own writer proves
   only that two halves of one misunderstanding agree with each other.
   These two were written from the spec separately, so agreeing means
   something.

   Then the awkward cases, which are the ones real worlds are full of:
   longs that do not fit in a double, deeply nested compounds, empty
   lists that declare type END, negative numbers at every width, UTF-8
   in several scripts, and truncated data that must fail cleanly rather
   than return nonsense.

   Run: node tools/nbt-check.js [--verbose]                           */
"use strict";
var zlib = require("zlib");
var N = require("../nbt.js");

var VERBOSE = process.argv.indexOf("--verbose") >= 0;
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

/* The encoder lives in `nbt-write.js`, written from the format
   description and sharing no code with the reader — see the note at the
   top of that file for why that independence is the whole point. */
var W = require("./nbt-write.js");
var doc = W.doc;

/* ---------- every tag type survives the round trip ---------- */
(function () {
  var body = [
    [1, "byte", -128], [1, "byteHi", 127],
    [2, "short", -32768], [2, "shortHi", 32767],
    [3, "int", -2147483648], [3, "intHi", 2147483647],
    [4, "long", "-9223372036854775808"], [4, "longHi", "9223372036854775807"],
    [5, "float", 0.5], [6, "double", -1234.5678],
    [8, "string", "hello"],
    [7, "bytes", [0, 1, -1, 127, -128]],
    [11, "ints", [0, -1, 2147483647, -2147483648]],
    [12, "longs", ["1", "-1", "9223372036854775807"]],
    [9, "list", { itemType: 3, items: [10, 20, 30] }],
    [9, "emptyList", { itemType: 0, items: [] }],
    [10, "nested", [[8, "deep", "yes"], [10, "deeper", [[3, "n", 42]]]]]
  ];
  var bytes = doc(10, "Root", body);
  var got;
  try { got = N.parse(bytes); }
  catch (e) { ok("a document written from the spec parses", false, e.message); return; }

  ok("the root keeps its name", got.name === "Root", got.name);
  var v = got.value;
  ok("byte, both ends", v.byte === -128 && v.byteHi === 127, v.byte + "/" + v.byteHi);
  ok("short, both ends", v.short === -32768 && v.shortHi === 32767);
  ok("int, both ends", v.int === -2147483648 && v.intHi === 2147483647);
  /* the one that a naive reader gets wrong: a long does not fit in a
     double, and rounding it puts a block in the wrong place */
  ok("long stays exact at the extremes",
     v.long === -9223372036854775808n && v.longHi === 9223372036854775807n,
     String(v.long) + " / " + String(v.longHi));
  ok("long is a BigInt, not a rounded double", typeof v.long === "bigint");
  ok("float", Math.abs(v.float - 0.5) < 1e-9);
  ok("double", Math.abs(v.double - (-1234.5678)) < 1e-9);
  ok("string", v.string === "hello");
  ok("byte array keeps its signs", v.bytes.length === 5 && v.bytes[2] === -1 && v.bytes[4] === -128);
  ok("int array", v.ints.length === 4 && v.ints[3] === -2147483648);
  ok("long array stays exact", v.longs.length === 3 && v.longs[2] === 9223372036854775807n);
  ok("list of ints", v.list.length === 3 && v.list[2] === 30);
  ok("an empty list is empty, not an error", v.emptyList.length === 0);
  ok("nested compounds", v.nested.deep === "yes" && v.nested.deeper.n === 42);
})();

/* ---------- text, in the scripts a real library contains ----------
   The Uncensored Library holds journalism in Arabic, Russian, Spanish
   and Vietnamese among others; book text is NBT strings, so the decoder
   has to survive all of it. */
(function () {
  var samples = [
    ["ascii", "The Uncensored Library"],
    ["spanish", "periodismo sin censura — ¿por qué?"],
    ["russian", "Свобода прессы"],
    ["arabic", "حرية الصحافة"],
    ["vietnamese", "Tự do báo chí"],
    ["chinese", "新闻自由"],
    ["emoji (surrogate pair)", "press freedom 📰🕊"],
    ["empty", ""],
    ["long", "x".repeat(3000)]
  ];
  var bad = [];
  samples.forEach(function (s) {
    var got = N.parse(doc(8, "t", s[1]));
    if (got.value !== s[1]) bad.push(s[0] + " (" + JSON.stringify(got.value).slice(0, 40) + ")");
  });
  ok("text survives in every script a library holds", bad.length === 0, bad.join(", "));
  var nm = N.parse(doc(3, "имя", 1));
  ok("and so do tag names", nm.name === "имя", nm.name);
})();

/* ---------- compression ---------- */
(function () {
  var bytes = doc(10, "W", [[8, "hi", "there"], [3, "n", 7]]);
  var gz = zlib.gzipSync(Buffer.from(bytes));
  var zl = zlib.deflateSync(Buffer.from(bytes));
  var raw = zlib.deflateRawSync(Buffer.from(bytes));

  ok("gzip is recognised", N.sniff(new Uint8Array(gz)) === "gzip");
  ok("zlib is recognised", N.sniff(new Uint8Array(zl)) === "deflate");
  ok("uncompressed NBT is recognised", N.sniff(bytes) === "none");
  /* a raw deflate stream must NOT be mistaken for zlib — it has no
     header, and treating it as one produces garbage rather than an
     error, which is the worst possible failure */
  var rawSniff = N.sniff(new Uint8Array(raw));
  ok("raw deflate is not mistaken for zlib", rawSniff !== "deflate" || raw[0] === 0x78,
     "sniffed " + rawSniff);

  return Promise.all([
    N.load(new Uint8Array(gz)).then(function (d) { return d.value.hi === "there"; }),
    N.load(new Uint8Array(zl)).then(function (d) { return d.value.n === 7; }),
    N.load(bytes).then(function (d) { return d.value.hi === "there"; })
  ]).then(function (r) {
    ok("a gzipped document loads", r[0]);
    ok("a zlib document loads", r[1]);
    ok("an uncompressed one loads too", r[2]);
  });
})().then(function () {

  /* ---------- damaged data fails cleanly ----------
     Region files get truncated by interrupted downloads and by tools
     that write them badly. Every one of these must throw or reject —
     never return a half-built tree that the mesher then renders as
     holes in the world. */
  var good = doc(10, "R", [[8, "s", "value"], [12, "L", ["1", "2", "3"]]]);
  var attempts = [
    ["truncated mid-string", good.slice(0, 8)],
    ["truncated mid-array", good.slice(0, good.length - 6)],
    ["one byte", good.slice(0, 1)],
    ["empty", new Uint8Array(0)],
    ["a bad tag type", (function () { var b = good.slice(); b[0] = 99; return b; })()],
    ["random bytes", (function () {
      var b = new Uint8Array(64);
      for (var i = 0; i < 64; i++) b[i] = (i * 37 + 11) & 0xff;
      return b;
    })()]
  ];
  var leaked = [];
  attempts.forEach(function (a) {
    var threwOrEmpty = false;
    try {
      var got = N.parse(a[1]);
      /* an empty document legitimately parses to null; anything else
         that comes back from damaged bytes is a silent lie */
      if (got.value === null) threwOrEmpty = true;
    } catch (e) { threwOrEmpty = true; }
    if (!threwOrEmpty) leaked.push(a[0]);
  });
  ok("damaged data throws instead of returning nonsense", leaked.length === 0, leaked.join(", "));

  /* a truncated *compressed* stream must reject, not hang or crash the
     process with an unhandled rejection */
  var gz = zlib.gzipSync(Buffer.from(good));
  var cut = new Uint8Array(gz).slice(0, Math.floor(gz.length / 2));
  return N.load(cut).then(
    function () { ok("a truncated compressed chunk is rejected", false, "it resolved"); },
    function () { ok("a truncated compressed chunk is rejected", true); }
  );
}).then(function () {

  /* ---------- pick() ---------- */
  var tree = N.parse(doc(10, "R", [[10, "Level", [[3, "xPos", 5], [9, "Sections", { itemType: 3, items: [1, 2] }]]]])).value;
  ok("pick reaches a nested value", N.pick(tree, "Level.xPos") === 5);
  ok("pick returns the fallback for a missing branch", N.pick(tree, "Level.nope.deeper", "d") === "d");
  ok("pick does not throw on a missing branch", N.pick(tree, "a.b.c.d.e") === undefined);
  ok("pick finds a list", N.pick(tree, "Level.Sections").length === 2);

  /* ---------- a chunk-shaped document, end to end ----------
     The shape a real region file hands over: a compound with a section
     list, each with a palette and a packed long array. */
  var chunkDoc = doc(10, "", [
    [3, "DataVersion", 3465],
    [10, "Level", [
      [3, "xPos", -12], [3, "zPos", 30],
      [9, "sections", { itemType: 10, items: [
        [[1, "Y", 4],
         [10, "block_states", [
           [9, "palette", { itemType: 10, items: [
             [[8, "Name", "minecraft:air"]],
             [[8, "Name", "minecraft:stone"]],
             [[8, "Name", "minecraft:oak_planks"]]
           ] }],
           [12, "data", ["1234605616436508552", "-1"]]
         ]]]
      ] }]
    ]]
  ]);
  var c = N.parse(chunkDoc).value;
  ok("a chunk-shaped document reads back whole", N.pick(c, "Level.xPos") === -12);
  var pal = N.pick(c, "Level.sections")[0].block_states.palette;
  ok("with its palette", pal.length === 3 && pal[2].Name === "minecraft:oak_planks");
  var data = N.pick(c, "Level.sections")[0].block_states.data;
  ok("and its packed data exact to the bit",
     data[0] === 1234605616436508552n && data[1] === -1n,
     String(data[0]));

  console.log("\n" + (fail === 0
    ? "the format reads true — " + pass + " checks passed"
    : fail + " of " + (pass + fail) + " checks FAILED"));
  if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
}).catch(function (e) {
  console.log("FAIL  the checks themselves threw — " + e.message);
  console.log(e.stack);
  process.exit(1);
});
