/* skins.js — the look of the room, as data.

   A skin is a small plain object: colours, a board pattern, a piece
   material, and how much light comes off it. Both renderers read the
   same object, so anything you change applies instantly to the 2D board
   and the 3D one, mid-game, without restarting anything.

   Skins travel. Any skin can be squeezed into a short SKIN1.… code (or
   a link) and handed to someone else, and codes that arrive from other
   people land in your gallery beside the built-in ones. That's the
   whole "presets by people who exported them" idea: the gallery below
   is the house set to start you off, and it grows with whatever your
   friends send you.

   Everything crossing the border is treated as hostile: colours must be
   real hex, materials and patterns must be ones we know, numbers are
   clamped, and any text is stripped of markup before it can reach the
   page. */
(function (root) {
"use strict";

/* ---------- materials: what light does when it lands ---------- */
var MATERIALS = {
  ivory:     { label: "Ivory",     spec: 0.45, power: 34,  rim: 0.10, alpha: 1.00, note: "warm, softly polished" },
  porcelain: { label: "Porcelain", spec: 0.80, power: 70,  rim: 0.14, alpha: 1.00, note: "bright and glassy-smooth" },
  glass:     { label: "Glass",     spec: 0.95, power: 100, rim: 0.30, alpha: 0.72, note: "you can see through it" },
  metal:     { label: "Metal",     spec: 1.00, power: 140, rim: 0.35, alpha: 1.00, note: "hard highlights, cold" },
  wood:      { label: "Wood",      spec: 0.18, power: 14,  rim: 0.06, alpha: 1.00, note: "matte, turned on a lathe" },
  ink:       { label: "Ink",       spec: 0.04, power: 8,   rim: 0.04, alpha: 1.00, note: "flat as a printed page" }
};
var PATTERNS = {
  plain:  { label: "Plain",  note: "clean colour, nothing else" },
  wood:   { label: "Wood",   note: "long grain along the board" },
  marble: { label: "Marble", note: "soft veins, like a café table" },
  linen:  { label: "Linen",  note: "a fine woven cross-hatch" },
  inlay:  { label: "Inlay",  note: "a thin bright line around every square" }
};

/* ---------- the house gallery ----------
   Each one exists to show a different corner of the settings, so the
   first thing you do after tapping a preset is understand what a slider
   would do. */
var PRESETS = [
  { id: "walnut", name: "Walnut Study", maker: "The Chess Room",
    note: "The default: a lamp, a wooden board, ivory pieces. Warm enough to play all evening.",
    board: { light: "#ecdcc0", dark: "#a97d55", rim: "#54382a", edge: "#caa87c", coord: "#5d4433",
             pattern: "wood", grain: 0.55, gloss: 0.22 },
    pieces: { white: "#f4ead6", black: "#2b241d", material: "ivory", shine: 0.55, rim: 0.30 },
    room: { bg: "#191512" },
    marks: { select: "#f6c450", legal: "#4c8f5e", capture: "#c0503f", last: "#f4d678", check: "#dc3c32", hint: "#2b8a5c" } },

  { id: "midnight", name: "Midnight Glass", maker: "The Chess Room",
    note: "Dark room, translucent pieces. Turn the shine up and the kings glow at the edges.",
    board: { light: "#3b4a5c", dark: "#1e2733", rim: "#0d1219", edge: "#2a3542", coord: "#7f93a8",
             pattern: "marble", grain: 0.35, gloss: 0.75 },
    pieces: { white: "#dceaf6", black: "#3d5570", material: "glass", shine: 0.95, rim: 0.75 },
    room: { bg: "#080b10" },
    marks: { select: "#63c8ff", legal: "#3aa0d8", capture: "#ff6f6f", last: "#5ec6ff", check: "#ff5252", hint: "#48d6b0" } },

  { id: "boneink", name: "Bone and Ink", maker: "The Chess Room",
    note: "Maximum contrast, no shine at all — the easiest board to read, and kind on tired eyes.",
    board: { light: "#f2efe6", dark: "#8d8880", rim: "#22201d", edge: "#dcd8cd", coord: "#3a3833",
             pattern: "plain", grain: 0, gloss: 0.02 },
    pieces: { white: "#ffffff", black: "#161513", material: "ink", shine: 0.10, rim: 0.05 },
    room: { bg: "#12110f" },
    marks: { select: "#e8b33a", legal: "#4a7d52", capture: "#b23c30", last: "#e8cf7a", check: "#c1372c", hint: "#2f6f4a" } },

  { id: "seaglass", name: "Sea Glass", maker: "The Chess Room",
    note: "Sand and shallow water. Porcelain pieces so the highlights stay soft.",
    board: { light: "#e6e2cd", dark: "#7fa89b", rim: "#3c554f", edge: "#c9c3a8", coord: "#40564f",
             pattern: "linen", grain: 0.45, gloss: 0.35 },
    pieces: { white: "#fbf7ea", black: "#33504c", material: "porcelain", shine: 0.70, rim: 0.35 },
    room: { bg: "#131b1a" },
    marks: { select: "#f3c969", legal: "#3f8f76", capture: "#cf6a52", last: "#ffdf9b", check: "#d9503f", hint: "#2f8f74" } },

  { id: "rosewood", name: "Rosewood Parlour", maker: "The Chess Room",
    note: "A deep red board with brass-coloured markings — the club-room look.",
    board: { light: "#e8cfae", dark: "#8a4433", rim: "#40201a", edge: "#b98d68", coord: "#4d2a20",
             pattern: "wood", grain: 0.8, gloss: 0.40 },
    pieces: { white: "#f6e8d0", black: "#2a1a14", material: "wood", shine: 0.30, rim: 0.18 },
    room: { bg: "#1a100c" },
    marks: { select: "#e0a94a", legal: "#7d7a34", capture: "#b8452f", last: "#e8bd6a", check: "#cc3b2a", hint: "#8a7326" } },

  { id: "frost", name: "Frost", maker: "The Chess Room",
    note: "Cold whites and a pale blue. Metal pieces, so every edge catches the light.",
    board: { light: "#f4f8fb", dark: "#a9bfd0", rim: "#4a5b6b", edge: "#dbe6ee", coord: "#3f5162",
             pattern: "marble", grain: 0.3, gloss: 0.6 },
    pieces: { white: "#ffffff", black: "#5b6b7d", material: "metal", shine: 0.85, rim: 0.55 },
    room: { bg: "#0f1519" },
    marks: { select: "#5aa8ff", legal: "#3d8fbf", capture: "#e05a5a", last: "#8ec8ff", check: "#e34a4a", hint: "#2f86c4" } },

  { id: "terracotta", name: "Terracotta", maker: "The Chess Room",
    note: "Clay and sunlight — matte, earthy, and completely glare-free.",
    board: { light: "#efe0c8", dark: "#c07a54", rim: "#5e3524", edge: "#d9b995", coord: "#5c3823",
             pattern: "plain", grain: 0.1, gloss: 0.08 },
    pieces: { white: "#f8eeda", black: "#4a2c1e", material: "wood", shine: 0.22, rim: 0.12 },
    room: { bg: "#1b120d" },
    marks: { select: "#e8a33f", legal: "#6f8a4a", capture: "#bc4f38", last: "#eec27e", check: "#c44430", hint: "#5f7f3f" } },

  { id: "neon", name: "Neon Café", maker: "The Chess Room",
    note: "Loud on purpose. Proof that the sliders go somewhere silly if you want them to.",
    board: { light: "#2b2f4a", dark: "#171a2e", rim: "#0b0d18", edge: "#232741", coord: "#8f9ad0",
             pattern: "inlay", grain: 0.2, gloss: 0.9 },
    pieces: { white: "#ff8ae2", black: "#5de3ff", material: "glass", shine: 1.0, rim: 0.9 },
    room: { bg: "#07080f" },
    marks: { select: "#ffe14d", legal: "#38f5b0", capture: "#ff4d80", last: "#ffe14d", check: "#ff3d6e", hint: "#38f5b0" } }
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
/* "|" is the field separator in share codes, so it can never survive in
   text either — along with anything that could reach the page as markup */
function text(v, max, fallback) {
  if (typeof v !== "string") return fallback;
  var s = v.replace(/[<>&"'`\\|]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  return s || fallback;
}

var DEFAULT = PRESETS[0];

/* normalise anything into a complete, safe skin */
function clean(s, fallbackName) {
  s = s || {};
  var b = s.board || {}, p = s.pieces || {}, r = s.room || {}, m = s.marks || {};
  var d = DEFAULT;
  return {
    id: text(s.id, 24, "custom"),
    name: text(s.name, 28, fallbackName || "Untitled skin"),
    maker: text(s.maker, 24, "Someone"),
    note: text(s.note, 120, ""),
    board: {
      light: hex(b.light, d.board.light), dark: hex(b.dark, d.board.dark),
      rim: hex(b.rim, d.board.rim), edge: hex(b.edge, d.board.edge),
      coord: hex(b.coord, d.board.coord),
      pattern: pick(b.pattern, PATTERNS, "wood"),
      grain: num(b.grain, 0, 1, d.board.grain),
      gloss: num(b.gloss, 0, 1, d.board.gloss)
    },
    pieces: {
      white: hex(p.white, d.pieces.white), black: hex(p.black, d.pieces.black),
      material: pick(p.material, MATERIALS, "ivory"),
      shine: num(p.shine, 0, 1, d.pieces.shine),
      rim: num(p.rim, 0, 1, d.pieces.rim)
    },
    room: { bg: hex(r.bg, d.room.bg) },
    marks: {
      select: hex(m.select, d.marks.select), legal: hex(m.legal, d.marks.legal),
      capture: hex(m.capture, d.marks.capture), last: hex(m.last, d.marks.last),
      check: hex(m.check, d.marks.check), hint: hex(m.hint, d.marks.hint)
    }
  };
}

function clone(s) { return JSON.parse(JSON.stringify(s)); }

/* material → the numbers the renderers actually use */
function surface(skin) {
  var mat = MATERIALS[skin.pieces.material] || MATERIALS.ivory;
  return {
    spec: mat.spec * (0.25 + skin.pieces.shine * 1.15),
    power: mat.power,
    rim: mat.rim * (0.3 + skin.pieces.rim * 2.2),
    alpha: mat.alpha,
    translucent: mat.alpha < 1
  };
}

/* ---------- sharing: SKIN1.<base64url(json)> ---------- */
function b64u(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(str) {
  return decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/"))));
}
/* The payload is a compact pipe-separated record rather than JSON —
   colours lose their "#", sliders become 0-100, and the material and
   pattern become indexes. It roughly halves the code, which is the
   difference between something you can text and something you can't.
   These two orders are part of the wire format: append only, never
   reorder, or old codes would decode into the wrong material. */
var MATERIAL_ORDER = ["ivory", "porcelain", "glass", "metal", "wood", "ink"];
var PATTERN_ORDER = ["plain", "wood", "marble", "linen", "inlay"];
function pct(v) { return String(Math.round(v * 100)); }
function unpct(v) { return num(parseInt(v, 10) / 100, 0, 1, 0.5); }
function bare(h) { return h.charAt(0) === "#" ? h.slice(1) : h; }
function hash(h) { return "#" + h; }

function encode(skin) {
  var s = clean(skin);
  var mat = MATERIAL_ORDER.indexOf(s.pieces.material); if (mat < 0) mat = 0;
  var pat = PATTERN_ORDER.indexOf(s.board.pattern); if (pat < 0) pat = 0;
  var fields = [
    /* the blurb rides along, but trimmed — a code you can text beats a
       code that carries a paragraph */
    s.name, s.maker, text(s.note, 60, ""),
    [s.board.light, s.board.dark, s.board.rim, s.board.edge, s.board.coord].map(bare).join(","),
    pat, pct(s.board.grain), pct(s.board.gloss),
    [s.pieces.white, s.pieces.black].map(bare).join(","),
    mat, pct(s.pieces.shine), pct(s.pieces.rim),
    bare(s.room.bg),
    [s.marks.select, s.marks.legal, s.marks.capture, s.marks.last, s.marks.check, s.marks.hint].map(bare).join(",")
  ];
  return "SKIN1." + b64u(fields.join("|"));
}

function parsePayload(payload) {
  var raw;
  try { raw = unb64u(payload); } catch (e) { return null; }
  var f = raw.split("|");
  if (f.length !== 13) return null;
  var b = f[3].split(","), p = f[7].split(","), k = f[12].split(",");
  if (b.length !== 5 || p.length !== 2 || k.length !== 6) return null;
  /* every colour must really be a colour — this is also what makes a
     mis-trimmed code fail cleanly instead of yielding a garbage skin */
  var all = b.concat(p, k, [f[11]]);
  for (var i = 0; i < all.length; i++) if (!/^[0-9a-fA-F]{6}$/.test(all[i])) return null;
  return clean({
    name: f[0], maker: f[1], note: f[2],
    board: { light: hash(b[0]), dark: hash(b[1]), rim: hash(b[2]), edge: hash(b[3]), coord: hash(b[4]),
             pattern: PATTERN_ORDER[parseInt(f[4], 10)], grain: unpct(f[5]), gloss: unpct(f[6]) },
    pieces: { white: hash(p[0]), black: hash(p[1]), material: MATERIAL_ORDER[parseInt(f[8], 10)],
              shine: unpct(f[9]), rim: unpct(f[10]) },
    room: { bg: hash(f[11]) },
    marks: { select: hash(k[0]), legal: hash(k[1]), capture: hash(k[2]),
             last: hash(k[3]), check: hash(k[4]), hint: hash(k[5]) }
  }, "A friend's skin");
}

/* Codes arrive pasted mid-sentence, wrapped across lines, or with a
   full stop stuck to the end. Try the tidy readings first, then chew
   characters off the tail until the payload validates. */
function decode(str) {
  var s = String(str || ""), i, m, got;
  var tokens = s.split(/[\s"'<>()\[\]]+/);
  for (i = 0; i < tokens.length; i++) {
    m = tokens[i].match(/SKIN1\.([A-Za-z0-9_-]+)/);
    if (m && (got = parsePayload(m[1]))) return got;
  }
  m = s.replace(/\s+/g, "").match(/SKIN1\.([A-Za-z0-9_-]+)/);
  if (!m) return null;
  for (var len = m[1].length; len >= 24; len--) {
    if ((got = parsePayload(m[1].slice(0, len)))) return got;
  }
  return null;
}

/* ---------- your gallery (presets + imported + your own) ---------- */
var KEY = "chessroom_skins";
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
function addMine(skin) {
  var list = loadMine();
  var s = clean(skin);
  s.id = "own-" + Math.abs(hashOf(encode(s))).toString(36);
  /* the same skin arriving twice shouldn't clutter the shelf */
  list = list.filter(function (x) { return x.id !== s.id; });
  list.unshift(s);
  saveMine(list);
  return s;
}
function hashOf(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return h;
}

/* ---------- surprise me: random, but never ugly ----------
   Colours are drawn on one harmonious hue wheel rather than at random,
   so "randomise" behaves like a designer rather than a paint bomb. */
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  var r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  var to = function (v) { return ("0" + Math.round((v + m) * 255).toString(16)).slice(-2); };
  return "#" + to(r) + to(g) + to(b);
}
function random(rnd) {
  rnd = rnd || Math.random;
  var base = rnd() * 360;
  var accent = base + 150 + rnd() * 60;          /* roughly complementary */
  var dark = rnd() < 0.5;
  var mats = Object.keys(MATERIALS), pats = Object.keys(PATTERNS);
  var mat = mats[Math.floor(rnd() * mats.length)];
  return clean({
    name: "Surprise " + Math.floor(rnd() * 900 + 100),
    maker: "You", note: "Rolled by the dice, kept because you liked it.",
    board: {
      light: hsl(base, 0.28 + rnd() * 0.2, dark ? 0.62 : 0.84),
      dark: hsl(base + (rnd() * 20 - 10), 0.35 + rnd() * 0.25, dark ? 0.28 : 0.46),
      rim: hsl(base, 0.4, dark ? 0.12 : 0.2),
      edge: hsl(base, 0.3, dark ? 0.24 : 0.66),
      coord: hsl(base, 0.35, dark ? 0.7 : 0.28),
      pattern: pats[Math.floor(rnd() * pats.length)],
      grain: rnd(), gloss: rnd()
    },
    pieces: {
      white: hsl(base + 10, 0.18, 0.93),
      black: hsl(accent, 0.35 + rnd() * 0.3, 0.22 + rnd() * 0.16),
      material: mat, shine: 0.25 + rnd() * 0.7, rim: rnd()
    },
    room: { bg: hsl(base, 0.25, 0.06 + rnd() * 0.04) },
    marks: {
      select: hsl(accent + 30, 0.8, 0.62), legal: hsl(accent, 0.55, 0.45),
      capture: hsl(base + 190, 0.7, 0.55), last: hsl(accent + 30, 0.75, 0.68),
      check: hsl(2, 0.75, 0.55), hint: hsl(accent - 20, 0.6, 0.45)
    }
  });
}

var Skins = {
  MATERIALS: MATERIALS, PATTERNS: PATTERNS, PRESETS: PRESETS.map(function (p) { return clean(p, p.name); }),
  DEFAULT_ID: "walnut",
  clean: clean, clone: clone, surface: surface,
  encode: encode, decode: decode,
  loadMine: loadMine, saveMine: saveMine, addMine: addMine,
  random: random, hsl: hsl, KEY: KEY,
  byId: function (id) {
    var all = Skins.PRESETS.concat(loadMine());
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
};
if (typeof module !== "undefined" && module.exports) module.exports = Skins;
else root.Skins = Skins;
})(typeof self !== "undefined" ? self : this);
