/* skins.js — the look of the table, as data.

   A skin is a small plain object: the table you are playing on, the
   bones you are playing with, and the colours the room uses to point at
   things. Both renderers read the same object, so anything you change
   applies at once to the 3D table and the 2D one, mid-hand, without
   restarting anything.

   Skins travel. Any skin squeezes into a short DOM1.… code you can text
   to somebody, and codes that arrive from other people land in your
   gallery next to the built-in ones. The house set below is a starting
   point, not a limit — every one of them exists to show what a
   different corner of the settings does, so the first thing you learn
   from tapping a preset is what a slider would have done.

   Everything crossing the border is treated as hostile: colours must be
   real hex, materials and patterns must be ones we know, numbers get
   clamped, and any text is stripped of anything that could reach the
   page as markup. `tools/skin-check.js` attacks it on purpose.       */
(function (root) {
"use strict";

/* ---------- what a bone is made of ----------
   Dominoes have been cut from every hard pale thing people could find,
   and each one catches the light differently. */
var MATERIALS = {
  hueso:     { label: "Bone",     spec: 0.38, power: 26,  rim: 0.10, alpha: 1.00, note: "the real thing — warm, matte, slightly uneven" },
  marfil:    { label: "Ivory",    spec: 0.52, power: 40,  rim: 0.12, alpha: 1.00, note: "smoother and colder than bone" },
  marmol:    { label: "Marble",   spec: 0.72, power: 64,  rim: 0.16, alpha: 1.00, note: "polished, with a hard highlight" },
  madera:    { label: "Wood",     spec: 0.16, power: 12,  rim: 0.05, alpha: 1.00, note: "no shine at all; the quiet set" },
  barro:     { label: "Clay",     spec: 0.10, power: 9,   rim: 0.04, alpha: 1.00, note: "fired earth, completely glare-free" },
  obsidiana: { label: "Obsidian", spec: 0.95, power: 120, rim: 0.34, alpha: 1.00, note: "volcanic glass — every edge catches" },
  vidrio:    { label: "Glass",    spec: 0.92, power: 100, rim: 0.30, alpha: 0.74, note: "you can see the felt through them" }
};
/* ---------- what the table is covered in ---------- */
var PATTERNS = {
  liso:     { label: "Plain",    note: "flat colour, nothing else" },
  pano:     { label: "Felt",     note: "the fine nap of a card table" },
  madera:   { label: "Wood",     note: "long grain running down the table" },
  talavera: { label: "Talavera", note: "painted tile, the blue-and-white kind" },
  hule:     { label: "Oilcloth", note: "the flowered plastic tablecloth of every kitchen" },
  hojalata: { label: "Tin",      note: "a punched tin tabletop, faintly starred" }
};

/* ---------- the house gallery ---------- */
var PRESETS = [
  { id: "cantina", name: "La Cantina", maker: "The Domino Table",
    note: "The default. A dark wooden table under one warm bulb, and a set of bones worn pale by forty years of hands.",
    table: { felt: "#6d4a2f", rim: "#3a2418", edge: "#8a6440", line: "#c9a678",
             pattern: "madera", grain: 0.62, gloss: 0.20 },
    bones: { face: "#f2e6cf", pip: "#231a12", back: "#7a2f24", material: "hueso", shine: 0.42, rim: 0.28 },
    room: { bg: "#160f0a" },
    marks: { playable: "#f0a83c", ghost: "#e8c98a", last: "#ffd77a", turn: "#3ecf8e", warn: "#e06a52" } },

  { id: "talavera", name: "Talavera", maker: "The Domino Table",
    note: "Painted tile from Puebla — cobalt on white, and bones to match. Turn the gloss up and the table shines like glaze.",
    table: { felt: "#2a5ca8", rim: "#12305e", edge: "#4b83cf", line: "#e8f0fb",
             pattern: "talavera", grain: 0.50, gloss: 0.72 },
    bones: { face: "#f7fafe", pip: "#123a76", back: "#1d4a8c", material: "marmol", shine: 0.78, rim: 0.34 },
    room: { bg: "#0a1526" },
    marks: { playable: "#ffd34d", ghost: "#9dc4f0", last: "#ffe27a", turn: "#4ee0b0", warn: "#ff7b6e" } },

  { id: "mercado", name: "Mercado", maker: "The Domino Table",
    note: "The flowered oilcloth on every market table in the country. Loud, cheerful, and impossible to be gloomy over.",
    table: { felt: "#d8443c", rim: "#7a1f1c", edge: "#f07a5a", line: "#ffe9c9",
             pattern: "hule", grain: 0.70, gloss: 0.45 },
    bones: { face: "#fff6e2", pip: "#2a1208", back: "#1f7a5c", material: "marfil", shine: 0.55, rim: 0.30 },
    room: { bg: "#22110d" },
    marks: { playable: "#ffd23f", ghost: "#ffcfa8", last: "#ffe36e", turn: "#37d68f", warn: "#8c1f18" } },

  { id: "huesotinta", name: "Bone and Ink", maker: "The Domino Table",
    note: "Maximum contrast, no shine anywhere. The easiest table to read across a room, and the kindest on tired eyes.",
    table: { felt: "#4a4a46", rim: "#1c1c1a", edge: "#6d6d67", line: "#d8d6cd",
             pattern: "liso", grain: 0.00, gloss: 0.03 },
    bones: { face: "#ffffff", pip: "#0d0d0c", back: "#3a3a37", material: "barro", shine: 0.08, rim: 0.05 },
    room: { bg: "#131312" },
    marks: { playable: "#ffc400", ghost: "#bdbdb6", last: "#ffe066", turn: "#00c46a", warn: "#e03a2a" } },

  { id: "mezcal", name: "Mezcal", maker: "The Domino Table",
    note: "Smoke and agave. Green felt gone soft with age, and bones the colour of the bottle.",
    table: { felt: "#3f5c46", rim: "#1c2a20", edge: "#5e7f66", line: "#b9cfae",
             pattern: "pano", grain: 0.55, gloss: 0.12 },
    bones: { face: "#e8e2cc", pip: "#2b3326", back: "#4a6b4f", material: "madera", shine: 0.24, rim: 0.14 },
    room: { bg: "#111a14" },
    marks: { playable: "#e0b64a", ghost: "#a8bd9c", last: "#f0d68a", turn: "#5fd39a", warn: "#cf6b4a" } },

  { id: "muertos", name: "Día de Muertos", maker: "The Domino Table",
    note: "Marigold and violet on black, the way the altars are dressed. The one to play on the second of November.",
    table: { felt: "#3b1f52", rim: "#180d24", edge: "#5e3a7d", line: "#ffb43d",
             pattern: "hojalata", grain: 0.45, gloss: 0.55 },
    bones: { face: "#fff3dc", pip: "#2a1038", back: "#ff8f1f", material: "hueso", shine: 0.50, rim: 0.32 },
    room: { bg: "#0d0714" },
    marks: { playable: "#ffb43d", ghost: "#c79ae0", last: "#ffd77a", turn: "#5ce6a8", warn: "#ff5f8a" } },

  { id: "loteria", name: "Lotería", maker: "The Domino Table",
    note: "Every colour the printer had. Proof that the sliders go somewhere silly if you want them to — and some people do.",
    table: { felt: "#1b7f6e", rim: "#0c3d35", edge: "#28b39a", line: "#ffe14d",
             pattern: "talavera", grain: 0.80, gloss: 0.85 },
    bones: { face: "#fffbe8", pip: "#c01d3f", back: "#ffd23f", material: "marmol", shine: 0.90, rim: 0.45 },
    room: { bg: "#07231f" },
    marks: { playable: "#ff4d8d", ghost: "#8ce8d6", last: "#ffe14d", turn: "#36f5b8", warn: "#ff3d5e" } },

  { id: "medianoche", name: "Medianoche", maker: "The Domino Table",
    note: "Two in the morning, one lamp left on, nobody going home. Obsidian bones that glow at the edges.",
    table: { felt: "#1a2230", rim: "#080c14", edge: "#2c3a4e", line: "#5de3ff",
             pattern: "pano", grain: 0.30, gloss: 0.65 },
    bones: { face: "#cfe4f2", pip: "#0a1018", back: "#16324a", material: "obsidiana", shine: 0.95, rim: 0.70 },
    room: { bg: "#050810" },
    marks: { playable: "#5de3ff", ghost: "#5a7d99", last: "#8ceaff", turn: "#3ef0b8", warn: "#ff6b8a" } }
];

/* ---------- guards: nothing from outside is trusted ---------- */
var HEX = /^#[0-9a-fA-F]{6}$/;
function hex(v, fallback) { return (typeof v === "string" && HEX.test(v)) ? v.toLowerCase() : fallback; }
function num(v, lo, hi, fallback) {
  var n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function pick(v, table, fallback) { return Object.prototype.hasOwnProperty.call(table, v) ? v : fallback; }
/* "|" separates fields in a share code, so it can never survive in text
   either — along with anything that could reach the page as markup */
function text(v, max, fallback) {
  if (typeof v !== "string") return fallback;
  var s = v.replace(/[<>&"'`\\|]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  return s || fallback;
}

var DEFAULT = PRESETS[0];

function clean(s, fallbackName) {
  s = s || {};
  var t = s.table || {}, b = s.bones || {}, r = s.room || {}, m = s.marks || {};
  var d = DEFAULT;
  return {
    id: text(s.id, 24, "custom"),
    name: text(s.name, 28, fallbackName || "Untitled table"),
    maker: text(s.maker, 24, "Someone"),
    note: text(s.note, 120, ""),
    table: {
      felt: hex(t.felt, d.table.felt), rim: hex(t.rim, d.table.rim),
      edge: hex(t.edge, d.table.edge), line: hex(t.line, d.table.line),
      pattern: pick(t.pattern, PATTERNS, "madera"),
      grain: num(t.grain, 0, 1, d.table.grain),
      gloss: num(t.gloss, 0, 1, d.table.gloss)
    },
    bones: {
      face: hex(b.face, d.bones.face), pip: hex(b.pip, d.bones.pip), back: hex(b.back, d.bones.back),
      material: pick(b.material, MATERIALS, "hueso"),
      shine: num(b.shine, 0, 1, d.bones.shine),
      rim: num(b.rim, 0, 1, d.bones.rim)
    },
    room: { bg: hex(r.bg, d.room.bg) },
    marks: {
      playable: hex(m.playable, d.marks.playable), ghost: hex(m.ghost, d.marks.ghost),
      last: hex(m.last, d.marks.last), turn: hex(m.turn, d.marks.turn), warn: hex(m.warn, d.marks.warn)
    }
  };
}
function clone(s) { return JSON.parse(JSON.stringify(s)); }

/* material → the numbers the renderers actually use */
function surface(skin) {
  var mat = MATERIALS[skin.bones.material] || MATERIALS.hueso;
  return {
    spec: mat.spec * (0.25 + skin.bones.shine * 1.15),
    power: mat.power,
    rim: mat.rim * (0.3 + skin.bones.rim * 2.2),
    alpha: mat.alpha,
    translucent: mat.alpha < 1
  };
}

/* ---------- sharing: DOM1.<base64url> ----------
   A compact pipe-separated record rather than JSON: colours lose their
   "#", sliders become 0-100, and material and pattern become indexes.
   Roughly half the size, which is the difference between a code you can
   text and one you can't.

   These two orders are part of the wire format. Append only, never
   reorder — an old code would otherwise decode into the wrong material
   and quietly look wrong rather than fail. */
var MATERIAL_ORDER = ["hueso", "marfil", "marmol", "madera", "barro", "obsidiana", "vidrio"];
var PATTERN_ORDER = ["liso", "pano", "madera", "talavera", "hule", "hojalata"];

function b64u(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(str) {
  return decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/"))));
}
function pct(v) { return String(Math.round(v * 100)); }
function unpct(v) { return num(parseInt(v, 10) / 100, 0, 1, 0.5); }
function bare(h) { return h.charAt(0) === "#" ? h.slice(1) : h; }
function hash(h) { return "#" + h; }

function encode(skin) {
  var s = clean(skin);
  var mat = MATERIAL_ORDER.indexOf(s.bones.material); if (mat < 0) mat = 0;
  var pat = PATTERN_ORDER.indexOf(s.table.pattern); if (pat < 0) pat = 0;
  var fields = [
    s.name, s.maker, text(s.note, 60, ""),
    [s.table.felt, s.table.rim, s.table.edge, s.table.line].map(bare).join(","),
    pat, pct(s.table.grain), pct(s.table.gloss),
    [s.bones.face, s.bones.pip, s.bones.back].map(bare).join(","),
    mat, pct(s.bones.shine), pct(s.bones.rim),
    bare(s.room.bg),
    [s.marks.playable, s.marks.ghost, s.marks.last, s.marks.turn, s.marks.warn].map(bare).join(",")
  ];
  return "DOM1." + b64u(fields.join("|"));
}

function parsePayload(payload) {
  var raw;
  try { raw = unb64u(payload); } catch (e) { return null; }
  var f = raw.split("|");
  if (f.length !== 13) return null;
  var t = f[3].split(","), b = f[7].split(","), k = f[12].split(",");
  if (t.length !== 4 || b.length !== 3 || k.length !== 5) return null;
  var all = t.concat(b, k, [f[11]]);
  for (var i = 0; i < all.length; i++) if (!/^[0-9a-fA-F]{6}$/.test(all[i])) return null;
  var mi = parseInt(f[8], 10), pi = parseInt(f[4], 10);
  if (!(mi >= 0 && mi < MATERIAL_ORDER.length)) return null;
  if (!(pi >= 0 && pi < PATTERN_ORDER.length)) return null;
  return clean({
    name: f[0], maker: f[1], note: f[2],
    table: { felt: hash(t[0]), rim: hash(t[1]), edge: hash(t[2]), line: hash(t[3]),
             pattern: PATTERN_ORDER[pi], grain: unpct(f[5]), gloss: unpct(f[6]) },
    bones: { face: hash(b[0]), pip: hash(b[1]), back: hash(b[2]),
             material: MATERIAL_ORDER[mi], shine: unpct(f[9]), rim: unpct(f[10]) },
    room: { bg: hash(f[11]) },
    marks: { playable: hash(k[0]), ghost: hash(k[1]), last: hash(k[2]), turn: hash(k[3]), warn: hash(k[4]) }
  }, "A friend's table");
}

/* Codes arrive pasted mid-sentence, wrapped across lines, or with a
   full stop stuck on the end. Try the tidy readings first, then chew
   characters off the tail until the payload validates. */
function decode(str) {
  var s = String(str || ""), i, m, got;
  var tokens = s.split(/[\s"'<>()\[\]]+/);
  for (i = 0; i < tokens.length; i++) {
    m = tokens[i].match(/DOM1\.([A-Za-z0-9_-]+)/);
    if (m && (got = parsePayload(m[1]))) return got;
  }
  m = s.replace(/\s+/g, "").match(/DOM1\.([A-Za-z0-9_-]+)/);
  if (!m) return null;
  for (var len = m[1].length; len >= 24; len--) {
    if ((got = parsePayload(m[1].slice(0, len)))) return got;
  }
  return null;
}

/* ---------- your gallery ---------- */
var KEY = "dominotable_skins";
function loadMine() {
  try {
    var raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || !raw.list) return [];
    return raw.list.map(function (s) { return clean(s); });
  } catch (e) { return []; }
}
function saveMine(list) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, list: list.slice(0, 40) })); return true; }
  catch (e) { return false; }
}
function gallery() {
  return PRESETS.map(function (p) { return clean(p); }).concat(loadMine());
}
function remember(skin) {
  var mine = loadMine(), s = clean(skin), i;
  for (i = 0; i < mine.length; i++) {
    if (mine[i].name === s.name && mine[i].maker === s.maker) { mine[i] = s; saveMine(mine); return s; }
  }
  mine.unshift(s);
  saveMine(mine);
  return s;
}
function forget(name, maker) {
  var mine = loadMine().filter(function (s) { return !(s.name === name && s.maker === maker); });
  saveMine(mine);
}

var Skins = {
  MATERIALS: MATERIALS, PATTERNS: PATTERNS, PRESETS: PRESETS, DEFAULT: DEFAULT,
  MATERIAL_ORDER: MATERIAL_ORDER, PATTERN_ORDER: PATTERN_ORDER,
  clean: clean, clone: clone, surface: surface,
  encode: encode, decode: decode,
  gallery: gallery, loadMine: loadMine, remember: remember, forget: forget
};
if (typeof module !== "undefined" && module.exports) module.exports = Skins;
else root.Skins = Skins;
})(typeof self !== "undefined" ? self : this);
