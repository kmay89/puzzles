/* blocks.js — our own materials, and how a world's names map onto them.

   This file is the reason nothing of Mojang's ever ships here.

   A Minecraft world does not contain textures. It contains *names* —
   `minecraft:oak_planks`, `minecraft:quartz_block` — and the game looks
   those up in its own asset pack. So a reader is free to look them up
   somewhere else, and this is somewhere else: every material below is
   an original description (a colour, a roughness, a grain) which
   `gfx.js` paints procedurally into a texture at load time. No image
   file is downloaded, none is bundled, and none is Mojang's.

   It also means a world renders here in a consistent hand-drawn palette
   rather than a half-remembered imitation, which is both more honest
   and, in a building made mostly of quartz and sandstone, rather
   handsome.

   ## Matching names without a table of ten thousand rows

   Minecraft has thousands of block ids and gains more every release, so
   a lookup table would be wrong the day after it was written. Instead
   names are matched by the words in them, most specific first — a rule
   for "glass", a rule for "planks", a rule for "quartz" — and anything
   unrecognised falls back to a plain stone rather than a hole in the
   wall. A world built after this file was written still renders.      */
(function (root) {
"use strict";

/* Materials. `id` is what the mesher carries and the shader indexes, so
   the order is the wire format between the two: append, never reorder.

   grain/spec/glow are instructions to the texture painter in gfx.js:
   how noisy the surface is, how much light bounces off it, and whether
   it emits any of its own. */
var MATERIALS = [
  /* 0 is air and is never drawn */
  { id: 0,  key: "air",       colour: "#000000", grain: 0,    spec: 0,    alpha: 0 },
  { id: 1,  key: "stone",     colour: "#8a8a8a", grain: 0.30, spec: 0.06 },
  { id: 2,  key: "dirt",      colour: "#7a5a3c", grain: 0.45, spec: 0.02 },
  { id: 3,  key: "grass",     colour: "#6d9a4a", grain: 0.40, spec: 0.03 },
  { id: 4,  key: "sand",      colour: "#ddd0a0", grain: 0.35, spec: 0.04 },
  { id: 5,  key: "wood",      colour: "#a9784a", grain: 0.55, spec: 0.05, streak: true },
  { id: 6,  key: "planks",    colour: "#bb8f5c", grain: 0.50, spec: 0.06, streak: true },
  { id: 7,  key: "log",       colour: "#6f5133", grain: 0.60, spec: 0.04, streak: true },
  { id: 8,  key: "leaves",    colour: "#4f7f3a", grain: 0.70, spec: 0.02 },
  { id: 9,  key: "glass",     colour: "#cfe6f2", grain: 0.05, spec: 0.55, alpha: 0.34 },
  { id: 10, key: "quartz",    colour: "#eeeae2", grain: 0.16, spec: 0.22 },
  { id: 11, key: "sandstone", colour: "#e0d2a6", grain: 0.28, spec: 0.07 },
  { id: 12, key: "brick",     colour: "#9c5a48", grain: 0.34, spec: 0.06 },
  { id: 13, key: "concrete",  colour: "#9aa0a6", grain: 0.14, spec: 0.10 },
  { id: 14, key: "wool",      colour: "#d8d8d2", grain: 0.60, spec: 0.01 },
  { id: 15, key: "gold",      colour: "#e6c24a", grain: 0.12, spec: 0.70 },
  { id: 16, key: "iron",      colour: "#d2d2d4", grain: 0.10, spec: 0.60 },
  { id: 17, key: "obsidian",  colour: "#241f33", grain: 0.20, spec: 0.65 },
  { id: 18, key: "bookshelf", colour: "#8a6b3f", grain: 0.55, spec: 0.05, books: true },
  { id: 19, key: "lamp",      colour: "#ffe6a8", grain: 0.10, spec: 0.30, glow: 1.0 },
  { id: 20, key: "water",     colour: "#3a6fbf", grain: 0.18, spec: 0.45, alpha: 0.62 },
  { id: 21, key: "prismarine",colour: "#5fa89a", grain: 0.30, spec: 0.30 },
  { id: 22, key: "netherrack",colour: "#7a3a3a", grain: 0.50, spec: 0.03 },
  { id: 23, key: "snow",      colour: "#f2f6fa", grain: 0.20, spec: 0.18 },
  { id: 24, key: "terracotta",colour: "#a4614a", grain: 0.30, spec: 0.05 },
  { id: 25, key: "carpet",    colour: "#8d3f3f", grain: 0.55, spec: 0.02 },
  { id: 26, key: "slab",      colour: "#b9b4a8", grain: 0.25, spec: 0.08 },
  { id: 27, key: "ice",       colour: "#a8ccf0", grain: 0.10, spec: 0.55, alpha: 0.55 }
];
var BY_KEY = {};
MATERIALS.forEach(function (m) { BY_KEY[m.key] = m; });

/* Name rules, most specific first. The first whose word appears in the
   block name wins, so "dark_oak_planks" reaches `planks` before `wood`,
   and "glass_pane" reaches `glass`. Order is the whole design here. */
var RULES = [
  ["bookshelf", "bookshelf"], ["chiseled_bookshelf", "bookshelf"],
  ["glass", "glass"],
  ["quartz", "quartz"],
  ["sandstone", "sandstone"],
  ["prismarine", "prismarine"], ["sea_lantern", "lamp"],
  ["glowstone", "lamp"], ["shroomlight", "lamp"], ["lantern", "lamp"],
  ["redstone_lamp", "lamp"], ["torch", "lamp"], ["campfire", "lamp"], ["beacon", "lamp"],
  ["planks", "planks"], ["_log", "log"], ["stripped_", "log"], ["wood", "wood"],
  ["leaves", "leaves"],
  ["bricks", "brick"], ["brick", "brick"],
  ["concrete", "concrete"],
  ["terracotta", "terracotta"], ["glazed", "terracotta"],
  ["wool", "wool"], ["carpet", "carpet"], ["bed", "wool"], ["banner", "wool"],
  ["gold", "gold"], ["iron", "iron"], ["copper", "iron"], ["netherite", "obsidian"],
  ["obsidian", "obsidian"],
  ["water", "water"], ["ice", "ice"], ["snow", "snow"],
  ["netherrack", "netherrack"], ["nether", "netherrack"],
  ["sand", "sand"], ["gravel", "stone"],
  ["grass", "grass"], ["moss", "grass"], ["dirt", "dirt"], ["podzol", "dirt"], ["mycelium", "dirt"],
  ["slab", "slab"], ["stairs", "stone"], ["wall", "stone"],
  ["deepslate", "stone"], ["blackstone", "obsidian"], ["basalt", "stone"],
  ["andesite", "stone"], ["diorite", "quartz"], ["granite", "terracotta"],
  ["calcite", "quartz"], ["tuff", "stone"], ["stone", "stone"],
  ["wax", "wood"], ["bamboo", "planks"],
  ["cobweb", "wool"], ["cloth", "wool"]
];

/* blocks that are not really blocks — they have no solid volume and
   would otherwise fill a library with invisible walls */
var NON_SOLID = [
  "air", "cave_air", "void_air", "barrier", "light", "structure_void",
  "torch", "wall_torch", "redstone_wire", "rail", "lever", "button",
  "pressure_plate", "tripwire", "string", "sign", "banner", "vine",
  "ladder", "flower", "sapling", "grass", "fern", "seagrass", "kelp",
  "mushroom", "sugar_cane", "wheat", "carrots", "potatoes", "beetroots",
  "fire", "soul_fire", "snow", "carpet", "item_frame", "painting"
];

var cache = Object.create(null);

/* the material id for a block name — the hot path, so it remembers */
function materialFor(name) {
  if (!name) return 0;
  var hit = cache[name];
  if (hit !== undefined) return hit;

  var n = String(name).toLowerCase();
  var colon = n.indexOf(":");
  var bare = colon >= 0 ? n.slice(colon + 1) : n;

  var id = 0;
  if (bare === "air" || bare === "cave_air" || bare === "void_air" ||
      bare === "barrier" || bare === "light" || bare === "structure_void" ||
      bare === "moving_piston") {
    id = 0;
  } else {
    /* things with no volume: skipped so a library is not full of
       invisible panes, but only when the *whole* name is one of them —
       "grass_block" is a block, "grass" is a tuft */
    var thin = false;
    for (var t = 0; t < NON_SOLID.length; t++) {
      if (bare === NON_SOLID[t] || bare === NON_SOLID[t] + "s") { thin = true; break; }
    }
    /* a few need the plain-name test as well: wall_banner, oak_sign… */
    if (!thin && /(^|_)(sign|banner|torch|rail|button|vine|sapling|flower|fern|seagrass|kelp)$/.test(bare)) thin = true;
    if (!thin && /_(pressure_plate|wire)$/.test(bare)) thin = true;

    if (thin) id = 0;
    else {
      for (var i = 0; i < RULES.length; i++) {
        if (bare.indexOf(RULES[i][0]) >= 0) { id = BY_KEY[RULES[i][1]].id; break; }
      }
      /* anything from a mod, a future version, or a typo becomes stone
         rather than a hole — a wall you cannot walk through beats a
         building with gaps in it */
      if (!id) id = BY_KEY.stone.id;
    }
  }
  cache[name] = id;
  return id;
}

function material(id) { return MATERIALS[id] || MATERIALS[0]; }
function isSeeThrough(id) {
  var m = MATERIALS[id];
  return !!(m && m.alpha !== undefined && m.alpha > 0 && m.alpha < 1);
}
function isSolid(id) { return id !== 0; }

var Blocks = {
  MATERIALS: MATERIALS, RULES: RULES, BY_KEY: BY_KEY,
  materialFor: materialFor, material: material,
  isSeeThrough: isSeeThrough, isSolid: isSolid,
  /* dev-only handle so the checks can prove the cache is not lying */
  _clearCache: function () { cache = Object.create(null); }
};
if (typeof module !== "undefined" && module.exports) module.exports = Blocks;
else root.Blocks = Blocks;
})(typeof self !== "undefined" ? self : this);
