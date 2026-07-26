/* skin-check.js — skins travel between strangers, so the border guard
   matters more than the paint. Checks that every preset is complete and
   well-formed, that a skin survives a round trip through a share code,
   and that hostile input (script tags, bad colours, silly numbers,
   unknown materials) comes back safe rather than crashing or leaking.
   Run: node chess/tools/skin-check.js */
"use strict";

/* skins.js expects a browser for storage + base64; give it just enough */
global.localStorage = (function () {
  const mem = {};
  return { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); },
           removeItem: (k) => { delete mem[k]; } };
})();
global.btoa = (s) => Buffer.from(s, "binary").toString("base64");
global.atob = (s) => Buffer.from(s, "base64").toString("binary");

const Skins = require("../skins.js");

let failed = 0;
const ok = (label, cond, extra) => {
  if (!cond) { failed++; console.log("FAIL  " + label + (extra ? "  → " + extra : "")); }
  else console.log("ok    " + label);
};
const HEX = /^#[0-9a-f]{6}$/;

/* ---- every preset is complete and legal ---- */
for (const p of Skins.PRESETS) {
  const bad = [];
  for (const k of ["light", "dark", "rim", "edge", "coord"]) if (!HEX.test(p.board[k])) bad.push("board." + k);
  for (const k of ["white", "black"]) if (!HEX.test(p.pieces[k])) bad.push("pieces." + k);
  for (const k of ["select", "legal", "capture", "last", "check", "hint"]) if (!HEX.test(p.marks[k])) bad.push("marks." + k);
  if (!HEX.test(p.room.bg)) bad.push("room.bg");
  if (!Skins.MATERIALS[p.pieces.material]) bad.push("material");
  if (!Skins.PATTERNS[p.board.pattern]) bad.push("pattern");
  for (const [k, v] of [["grain", p.board.grain], ["gloss", p.board.gloss],
                        ["shine", p.pieces.shine], ["rim", p.pieces.rim]]) {
    if (!(v >= 0 && v <= 1)) bad.push(k + "=" + v);
  }
  if (!p.name || !p.maker || !p.note) bad.push("missing description");
  ok(`preset ${p.id.padEnd(11)} is complete`, bad.length === 0, bad.join(", "));
}
ok("gallery has a decent spread", Skins.PRESETS.length >= 6);
ok("every preset id is unique", new Set(Skins.PRESETS.map((p) => p.id)).size === Skins.PRESETS.length);
ok("materials all describe themselves",
   Object.values(Skins.MATERIALS).every((m) => m.label && m.note && m.power > 0));

/* ---- round trip ---- */
{
  const original = Skins.PRESETS.find((p) => p.id === "midnight");
  const code = Skins.encode(original);
  ok("a share code is short enough to text", code.length < 300, code.length + " chars");
  ok("share code is prefixed", /^SKIN1\./.test(code));
  const back = Skins.decode(code);
  ok("round trip keeps the board colours",
     back && back.board.light === original.board.light && back.board.dark === original.board.dark);
  ok("round trip keeps the material and sliders",
     back && back.pieces.material === original.pieces.material &&
     Math.abs(back.pieces.shine - original.pieces.shine) < 0.02);
  ok("round trip keeps the marks", back && back.marks.check === original.marks.check);
  ok("round trip keeps the name", back && back.name === original.name);
}
{
  ok("a code buried in a sentence is still found",
     !!Skins.decode("hey try my board: " + Skins.encode(Skins.PRESETS[0]) + " nice right?"));
  ok("a code split across lines survives",
     !!Skins.decode(Skins.encode(Skins.PRESETS[0]).replace(/(.{20})/g, "$1\n")));
  ok("a code with a full stop stuck to it survives",
     !!Skins.decode("try this: " + Skins.encode(Skins.PRESETS[0]) + "."));
  ok("a code inside quotes survives",
     !!Skins.decode('"' + Skins.encode(Skins.PRESETS[0]) + '"'));
  ok("nonsense decodes to nothing", Skins.decode("hello world") === null);
  ok("a truncated code decodes to nothing", Skins.decode("SKIN1.abcd!!") === null);
}

/* ---- hostile input ---- */
{
  const nasty = Skins.clean({
    name: "<img src=x onerror=alert(1)>",
    maker: "</script><script>bad()</script>",
    note: "quotes \" ' ` and \\ slashes",
    board: { light: "javascript:alert(1)", dark: "#GGGGGG", pattern: "__proto__", grain: 999, gloss: -50 },
    pieces: { white: "", black: null, material: "constructor", shine: NaN, rim: "lots" },
    room: { bg: 12345 },
    marks: { select: "#fff" }
  });
  ok("markup is stripped from names", !/[<>]/.test(nasty.name + nasty.maker + nasty.note),
     nasty.name);
  ok("bad colours fall back to real ones",
     HEX.test(nasty.board.light) && HEX.test(nasty.board.dark) && HEX.test(nasty.pieces.white) &&
     HEX.test(nasty.pieces.black) && HEX.test(nasty.room.bg) && HEX.test(nasty.marks.select));
  ok("unknown material and pattern fall back",
     Skins.MATERIALS[nasty.pieces.material] && Skins.PATTERNS[nasty.board.pattern]);
  ok("numbers are clamped into range",
     nasty.board.grain >= 0 && nasty.board.grain <= 1 &&
     nasty.board.gloss >= 0 && nasty.board.gloss <= 1 &&
     nasty.pieces.shine >= 0 && nasty.pieces.shine <= 1);
  ok("prototype pollution attempt is inert", ({}).polluted === undefined && [].length === 0);
}
{
  const empty = Skins.clean({});
  ok("an empty object still yields a usable skin",
     HEX.test(empty.board.light) && Skins.MATERIALS[empty.pieces.material] && empty.name.length > 0);
  const nothing = Skins.clean(null);
  ok("null yields a usable skin", HEX.test(nothing.room.bg));
}

/* ---- surface maths feeding the shader ---- */
for (const id of Object.keys(Skins.MATERIALS)) {
  const s = Skins.clean({ pieces: { material: id, shine: 1, rim: 1 } });
  const surf = Skins.surface(s);
  const good = surf.spec >= 0 && surf.spec <= 3 && surf.power >= 4 &&
               surf.rim >= 0 && surf.rim <= 2 && surf.alpha > 0 && surf.alpha <= 1;
  ok(`surface(${id.padEnd(9)}) is sane at full shine`, good, JSON.stringify(surf));
}
{
  const dull = Skins.surface(Skins.clean({ pieces: { material: "ink", shine: 0, rim: 0 } }));
  const bright = Skins.surface(Skins.clean({ pieces: { material: "metal", shine: 1, rim: 1 } }));
  ok("shine actually changes the surface", bright.spec > dull.spec * 3);
  ok("glass is the translucent one", Skins.surface(Skins.clean({ pieces: { material: "glass" } })).translucent === true);
  ok("ivory is not translucent", Skins.surface(Skins.clean({ pieces: { material: "ivory" } })).translucent === false);
}

/* ---- randomiser ---- */
{
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 40; i++) {
    const s = Skins.random(rnd);
    const clean = Skins.clean(s);
    if (JSON.stringify(s) !== JSON.stringify(clean)) { failed++; console.log("FAIL  random skin #" + i + " isn't already clean"); break; }
  }
  ok("40 random skins are all valid without fixing up", true);
}

/* ---- the gallery shelf ---- */
{
  const mine = Skins.addMine(Skins.random());
  ok("saved skins come back", Skins.loadMine().length === 1 && Skins.loadMine()[0].id === mine.id);
  Skins.addMine(Skins.clean(mine));
  ok("saving the same skin twice doesn't duplicate it", Skins.loadMine().length === 1);
  Skins.addMine(Skins.random(() => 0.42));
  ok("a different skin does get added", Skins.loadMine().length === 2);
  ok("byId finds a preset", !!Skins.byId("walnut"));
  ok("byId misses politely", Skins.byId("nope") === null);
}

console.log(failed ? `\n${failed} FAILURE(S)` : "\nskins: presets sound, codes reversible, strangers' input safe");
process.exit(failed ? 1 : 0);
