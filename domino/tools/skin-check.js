/* skin-check.js — dev-only. Attacks the settings on purpose.

   Two jobs. First, the presets have to be complete and every share code
   has to survive the round trip, because a skin that arrives subtly
   wrong is worse than one that fails to arrive. Second — and this is
   the real point — a share code is a string a stranger sends you, and
   it gets turned into colours that go straight onto the page. So it is
   fed markup, prototype-pollution attempts, junk numbers, absurd
   lengths, and every mangling a code picks up from being pasted out of
   a chat window.

   Nothing is allowed to throw, and nothing hostile is allowed through.

   Run: node tools/skin-check.js [--verbose]                           */
"use strict";

/* the module needs btoa/atob; node has Buffer instead */
if (typeof global.btoa !== "function") {
  global.btoa = function (s) { return Buffer.from(s, "binary").toString("base64"); };
  global.atob = function (s) { return Buffer.from(s, "base64").toString("binary"); };
}
/* and localStorage, for the gallery */
var mem = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; }
};

var S = require("../skins.js");

var VERBOSE = process.argv.indexOf("--verbose") >= 0;
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}
var HEX = /^#[0-9a-f]{6}$/;

/* ---------- the presets are complete ---------- */
(function () {
  var ids = {}, bad = [], i;
  for (i = 0; i < S.PRESETS.length; i++) {
    var p = S.PRESETS[i], c = S.clean(p);
    if (ids[p.id]) bad.push(p.id + " is a duplicate id");
    ids[p.id] = 1;
    if (!p.note || p.note.length < 30) bad.push(p.id + " has no real note");
    /* every colour survives cleaning unchanged — a typo'd hex in a
       preset would silently become the default and nobody would notice */
    ["felt", "rim", "edge", "line"].forEach(function (k) {
      if (c.table[k] !== String(p.table[k]).toLowerCase()) bad.push(p.id + " table." + k + " is not a colour");
    });
    ["face", "pip", "back"].forEach(function (k) {
      if (c.bones[k] !== String(p.bones[k]).toLowerCase()) bad.push(p.id + " bones." + k + " is not a colour");
    });
    ["playable", "ghost", "last", "turn", "warn"].forEach(function (k) {
      if (c.marks[k] !== String(p.marks[k]).toLowerCase()) bad.push(p.id + " marks." + k + " is not a colour");
    });
    if (c.room.bg !== String(p.room.bg).toLowerCase()) bad.push(p.id + " room.bg is not a colour");
    if (!S.MATERIALS[p.bones.material]) bad.push(p.id + " has an unknown material");
    if (!S.PATTERNS[p.table.pattern]) bad.push(p.id + " has an unknown pattern");
  }
  ok("every preset is complete and real", bad.length === 0, bad.join("; "));
  ok("there are eight tables to start from", S.PRESETS.length === 8, S.PRESETS.length + "");
  console.log("      " + S.PRESETS.length + " presets, " +
              Object.keys(S.MATERIALS).length + " materials, " +
              Object.keys(S.PATTERNS).length + " patterns");
})();

/* ---------- the gallery shows every corner of the settings ----------
   A gallery where every preset uses the same material teaches nothing. */
(function () {
  var mats = {}, pats = {};
  S.PRESETS.forEach(function (p) { mats[p.bones.material] = 1; pats[p.table.pattern] = 1; });
  ok("the presets between them show most materials", Object.keys(mats).length >= 5,
     Object.keys(mats).join(", "));
  ok("and most patterns", Object.keys(pats).length >= 5, Object.keys(pats).join(", "));
  var gloss = S.PRESETS.map(function (p) { return p.table.gloss; });
  ok("and the full range of gloss", Math.min.apply(null, gloss) < 0.1 && Math.max.apply(null, gloss) > 0.8);
})();

/* ---------- codes round-trip exactly ---------- */
(function () {
  var bad = [];
  S.PRESETS.forEach(function (p) {
    var a = S.clean(p), code = S.encode(a), b = S.decode(code);
    if (!b) { bad.push(p.id + " did not come back"); return; }
    ["felt", "rim", "edge", "line", "pattern"].forEach(function (k) {
      if (a.table[k] !== b.table[k]) bad.push(p.id + " table." + k);
    });
    ["face", "pip", "back", "material"].forEach(function (k) {
      if (a.bones[k] !== b.bones[k]) bad.push(p.id + " bones." + k);
    });
    ["playable", "ghost", "last", "turn", "warn"].forEach(function (k) {
      if (a.marks[k] !== b.marks[k]) bad.push(p.id + " marks." + k);
    });
    if (a.room.bg !== b.room.bg) bad.push(p.id + " room.bg");
    if (a.name !== b.name) bad.push(p.id + " name");
    /* sliders survive to the precision the code carries — one part in
       a hundred, which is finer than a finger on a slider */
    if (Math.abs(a.table.grain - b.table.grain) > 0.011) bad.push(p.id + " grain");
    if (Math.abs(a.table.gloss - b.table.gloss) > 0.011) bad.push(p.id + " gloss");
    if (Math.abs(a.bones.shine - b.bones.shine) > 0.011) bad.push(p.id + " shine");
    if (Math.abs(a.bones.rim - b.bones.rim) > 0.011) bad.push(p.id + " rim");
  });
  ok("every preset survives being shared", bad.length === 0, bad.slice(0, 6).join(", "));

  /* Measured at 265 characters for the fullest preset. Thirteen
     colours are 87 of those before anything else, and the shared note
     (trimmed to 60, same as the chess room) most of the rest — so the
     bar is set where a real code sits rather than at a round number the
     format cannot meet. Comfortably one message anywhere but SMS, and
     small enough to scan as a QR if it ever needs to be. */
  var len = 0;
  S.PRESETS.forEach(function (p) { len = Math.max(len, S.encode(p).length); });
  ok("a code stays short enough to send", len < 300, len + " characters");
  console.log("      the longest share code is " + len + " characters");
})();

/* ---------- codes arrive mangled ---------- */
(function () {
  var code = S.encode(S.PRESETS[3]);
  var manglings = [
    ["with a full stop stuck on", code + "."],
    ["inside a sentence", "here, try this one: " + code + " — it's the high contrast one"],
    ["wrapped across lines", code.slice(0, 40) + "\n" + code.slice(40)],
    ["with spaces through it", code.slice(0, 30) + " " + code.slice(30)],
    ["in quotes", '"' + code + '"'],
    ["in brackets", "(" + code + ")"],
    ["as a link", "https://example.com/domino/#skin=" + code],
    ["shouted", code + "!!!"],
    ["with a trailing comma", code + ","]
  ];
  var bad = [];
  manglings.forEach(function (m) {
    var got = S.decode(m[1]);
    if (!got || got.table.felt !== S.clean(S.PRESETS[3]).table.felt) bad.push(m[0]);
  });
  ok("a code still reads when it arrives mangled", bad.length === 0, bad.join(", "));
})();

/* ---------- hostile input ---------- */
(function () {
  var attacks = [
    null, undefined, "", "DOM1.", "DOM1.!!!!", "SKIN1." + "A".repeat(200),
    "DOM1." + "A".repeat(5000), "not a code at all", "DOM1.////", "DOM1.=====",
    "DOM1." + Buffer.from("a|b|c").toString("base64"),
    /* the right shape, wrong content */
    "DOM1." + Buffer.from(["n", "m", "x", "zzzzzz,zzzzzz,zzzzzz,zzzzzz", "0", "50", "50",
      "ffffff,000000,ffffff", "0", "50", "50", "ffffff",
      "ffffff,ffffff,ffffff,ffffff,ffffff"].join("|")).toString("base64"),
    /* out-of-range indexes into the material and pattern tables */
    "DOM1." + Buffer.from(["n", "m", "x", "ffffff,ffffff,ffffff,ffffff", "99", "50", "50",
      "ffffff,000000,ffffff", "99", "50", "50", "ffffff",
      "ffffff,ffffff,ffffff,ffffff,ffffff"].join("|")).toString("base64"),
    "DOM1." + Buffer.from(["n", "m", "x", "ffffff,ffffff,ffffff,ffffff", "-1", "50", "50",
      "ffffff,000000,ffffff", "-5", "50", "50", "ffffff",
      "ffffff,ffffff,ffffff,ffffff,ffffff"].join("|")).toString("base64")
  ];
  var threw = 0, leaked = 0;
  attacks.forEach(function (a) {
    var got;
    try { got = S.decode(a); } catch (e) { threw++; return; }
    if (got) {
      /* whatever came back must be a complete, safe skin */
      if (!HEX.test(got.table.felt) || !HEX.test(got.bones.face) || !HEX.test(got.room.bg)) leaked++;
      if (!S.MATERIALS[got.bones.material]) leaked++;
      if (!S.PATTERNS[got.table.pattern]) leaked++;
    }
  });
  ok("hostile codes never throw", threw === 0, threw + " threw");
  ok("and never produce a broken skin", leaked === 0, leaked + " leaked");
})();

(function () {
  /* markup in every text field, and colours that are not colours */
  var nasty = S.clean({
    name: '<img src=x onerror="alert(1)">',
    maker: "</script><script>alert(2)</script>",
    note: "a|b|c pipes and \"quotes\" and 'apostrophes' and `ticks`",
    table: { felt: "javascript:alert(1)", rim: "#GGGGGG", edge: 42, line: null,
             pattern: "__proto__", grain: 1e9, gloss: -50 },
    bones: { face: "#fff", pip: "rgb(1,2,3)", back: "#12345", material: "constructor",
             shine: NaN, rim: "banana" },
    room: { bg: "#00000" },
    marks: { playable: "red", ghost: undefined, last: "#1234567", turn: {}, warn: [] }
  });
  var everyColour = [nasty.table.felt, nasty.table.rim, nasty.table.edge, nasty.table.line,
    nasty.bones.face, nasty.bones.pip, nasty.bones.back, nasty.room.bg,
    nasty.marks.playable, nasty.marks.ghost, nasty.marks.last, nasty.marks.turn, nasty.marks.warn];
  ok("every colour is a real colour or the default", everyColour.every(function (c) { return HEX.test(c); }),
     everyColour.filter(function (c) { return !HEX.test(c); }).join(", "));
  ok("no markup survives into a name", !/[<>&"'`\\|]/.test(nasty.name + nasty.maker + nasty.note),
     nasty.name);
  ok("a name is never empty", nasty.name.length > 0 && nasty.maker.length > 0);
  ok("sliders are clamped to their range",
     nasty.table.grain >= 0 && nasty.table.grain <= 1 &&
     nasty.table.gloss >= 0 && nasty.table.gloss <= 1 &&
     nasty.bones.shine >= 0 && nasty.bones.shine <= 1 &&
     nasty.bones.rim >= 0 && nasty.bones.rim <= 1);
  ok("a hostile material falls back to a known one", !!S.MATERIALS[nasty.bones.material]);
  ok("and a hostile pattern too", !!S.PATTERNS[nasty.table.pattern]);
  /* a name made only of markup must not survive as an empty string that
     then renders as a blank row in the gallery */
  ok("a name of pure markup becomes the fallback", S.clean({ name: "<<<>>>" }).name.length > 2);
})();

(function () {
  /* prototype pollution through the skin object */
  var before = Object.prototype.polluted;
  S.clean(JSON.parse('{"__proto__":{"polluted":"yes"},"name":"x"}'));
  ok("cleaning a skin cannot pollute the prototype", Object.prototype.polluted === before);
  var code = "DOM1." + Buffer.from(['{"__proto__":{"p":1}}', "m", "x", "ffffff,ffffff,ffffff,ffffff",
    "0", "50", "50", "ffffff,000000,ffffff", "0", "50", "50", "ffffff",
    "ffffff,ffffff,ffffff,ffffff,ffffff"].join("|")).toString("base64");
  S.decode(code);
  ok("nor can decoding one", Object.prototype.p === undefined);
})();

/* ---------- a shared skin round-trips through hostile text ---------- */
(function () {
  var evil = S.clean({ name: "<b>hi</b>", maker: "a|b", note: "x", table: { felt: "#123456" } });
  var back = S.decode(S.encode(evil));
  ok("a nasty name survives sharing without becoming markup",
     back && !/[<>|]/.test(back.name + back.maker), back ? back.name + "/" + back.maker : "none");
  ok("and the colours still arrive", back && back.table.felt === "#123456");
})();

/* ---------- the surface numbers the renderers use ---------- */
(function () {
  var bad = 0;
  Object.keys(S.MATERIALS).forEach(function (mid) {
    [0, 0.5, 1].forEach(function (shine) {
      var s = S.surface(S.clean({ bones: { material: mid, shine: shine, rim: shine } }));
      if (!(s.spec >= 0 && s.spec < 3)) bad++;
      if (!(s.power > 0 && s.power < 400)) bad++;
      if (!(s.alpha > 0 && s.alpha <= 1)) bad++;
      if (!(s.rim >= 0 && s.rim < 3)) bad++;
    });
  });
  ok("every material gives the renderers usable numbers", bad === 0, bad + " out of range");
  ok("glass is the translucent one", S.surface(S.clean({ bones: { material: "vidrio" } })).translucent);
  ok("bone is not", !S.surface(S.clean({ bones: { material: "hueso" } })).translucent);
})();

/* ---------- the gallery ---------- */
(function () {
  mem = {};
  var base = S.gallery().length;
  ok("the gallery starts as the house set", base === S.PRESETS.length);
  S.remember(S.clean({ name: "Mine", maker: "Me", table: { felt: "#010203" } }));
  ok("a saved table joins it", S.gallery().length === base + 1);
  S.remember(S.clean({ name: "Mine", maker: "Me", table: { felt: "#040506" } }));
  ok("saving the same name again replaces it", S.gallery().length === base + 1);
  ok("with the new colours", S.gallery()[base].table.felt === "#040506");
  S.forget("Mine", "Me");
  ok("and it can be thrown away", S.gallery().length === base);

  mem.dominotable_skins = "{{{ not json";
  ok("a corrupt gallery is quietly ignored", S.gallery().length === S.PRESETS.length);
  mem.dominotable_skins = JSON.stringify({ v: 1, list: [{ name: "<script>", table: { felt: "nope" } }] });
  var g = S.gallery();
  ok("and a corrupt entry is cleaned, not trusted",
     HEX.test(g[g.length - 1].table.felt) && !/[<>]/.test(g[g.length - 1].name));
})();

console.log("\n" + (fail === 0
  ? "the settings hold — " + pass + " checks passed"
  : fail + " of " + (pass + fail) + " checks FAILED"));
if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
