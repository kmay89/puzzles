/* world.js — somewhere to keep blocks, and something to put in it.

   Two jobs.

   **A store.** Blocks live in 16³ sections held in a sparse map, the
   same shape Minecraft uses, because that is the shape they arrive in
   and converting would only lose time and precision. Empty sections are
   simply absent, which is most of any world.

   **A build.** The room ships with a library of its own — an original
   building, generated here in code, in tribute to the Uncensored
   Library that Reporters Without Borders and BlockWorks put inside
   Minecraft in 2020 to carry journalism past national firewalls. Ours
   is not theirs and does not pretend to be: it is a reading room with
   the same idea in it, so the page has something to walk around in
   before you have downloaded anything.

   The real one is at uncensoredlibrary.com. Download it, drop it on
   this page, and the same renderer will walk you through the actual
   building.                                                          */
(function (root) {
"use strict";

var need = (typeof require === "function" && typeof module !== "undefined");
var Blocks = need ? require("./blocks.js") : root.Blocks;
var Anvil = need ? require("./anvil.js") : root.Anvil;
var Mesher = need ? require("./mesher.js") : root.Mesher;

var S = 16;                       /* a section is 16 cubed, as it is on disk */

function key(cx, cy, cz) { return cx + "," + cy + "," + cz; }
function floorDiv(a, b) { return Math.floor(a / b); }

function World(opts) {
  opts = opts || {};
  this.sections = new Map();
  this.min = { x: Infinity, y: Infinity, z: Infinity };
  this.max = { x: -Infinity, y: -Infinity, z: -Infinity };
  this.name = opts.name || "";
  this.spawn = opts.spawn || null;
  this.count = 0;
}

World.prototype.section = function (cx, cy, cz, make) {
  var k = key(cx, cy, cz);
  var s = this.sections.get(k);
  if (!s && make) {
    s = new Uint16Array(S * S * S);
    this.sections.set(k, s);
  }
  return s;
};

World.prototype.get = function (x, y, z) {
  var s = this.sections.get(key(floorDiv(x, S), floorDiv(y, S), floorDiv(z, S)));
  if (!s) return 0;
  return s[((y - floorDiv(y, S) * S) << 8) | ((z - floorDiv(z, S) * S) << 4) | (x - floorDiv(x, S) * S)];
};

World.prototype.set = function (x, y, z, mat) {
  var cx = floorDiv(x, S), cy = floorDiv(y, S), cz = floorDiv(z, S);
  var s = this.section(cx, cy, cz, true);
  var i = ((y - cy * S) << 8) | ((z - cz * S) << 4) | (x - cx * S);
  var was = s[i];
  s[i] = mat;
  if (mat && !was) this.count++;
  else if (!mat && was) this.count--;
  if (mat) {
    if (x < this.min.x) this.min.x = x; if (x > this.max.x) this.max.x = x;
    if (y < this.min.y) this.min.y = y; if (y > this.max.y) this.max.y = y;
    if (z < this.min.z) this.min.z = z; if (z > this.max.z) this.max.z = z;
  }
};

/* A meshable volume for one section, which answers for the blocks
   *outside* it as well. That is what lets the mesher drop the wall
   between two neighbouring sections instead of drawing it twice — see
   the note in mesher.js about why that boundary is the whole game. */
World.prototype.volumeFor = function (cx, cy, cz) {
  var self = this;
  var ox = cx * S, oy = cy * S, oz = cz * S;
  return Mesher.volume(S, S, S, function (x, y, z) {
    return self.get(ox + x, oy + y, oz + z);
  });
};

World.prototype.list = function () {
  var out = [];
  this.sections.forEach(function (v, k) {
    var p = k.split(",");
    out.push({ cx: +p[0], cy: +p[1], cz: +p[2] });
  });
  return out;
};

World.prototype.isEmpty = function () { return this.count === 0; };

/* ---------- small builder helpers ---------- */
function fill(w, x0, y0, z0, x1, y1, z1, mat) {
  for (var y = y0; y <= y1; y++)
    for (var z = z0; z <= z1; z++)
      for (var x = x0; x <= x1; x++) w.set(x, y, z, mat);
}
/* a room: walls, floor and ceiling, hollow inside */
function shell(w, x0, y0, z0, x1, y1, z1, mat) {
  for (var y = y0; y <= y1; y++)
    for (var z = z0; z <= z1; z++)
      for (var x = x0; x <= x1; x++) {
        var edge = (x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1);
        if (edge) w.set(x, y, z, mat);
      }
}

/* ---------- the tribute build ----------
   A reading room: a long hall on a quartz floor, sandstone piers, tall
   windows, a gallery of shelves down both sides, and a lantern-lit
   rotunda at the far end. Generated rather than authored block by
   block, so it is a few dozen lines instead of a megabyte. */
function buildTribute() {
  var B = Blocks.BY_KEY;
  var w = new World({ name: "The Reading Room" });
  var HW = 22, HL = 46, HH = 15;         /* half-width, length, height */

  /* the ground it stands on */
  fill(w, -HW - 6, -1, -6, HW + 6, -1, HL + 6, B.stone.id);
  fill(w, -HW - 4, 0, -4, HW + 4, 0, HL + 4, B.sandstone.id);

  /* the hall itself, hollowed out */
  shell(w, -HW, 0, 0, HW, HH, HL, B.sandstone.id);
  fill(w, -HW + 1, 1, 1, HW - 1, HH - 1, HL - 1, 0);
  fill(w, -HW + 1, 0, 1, HW - 1, 0, HL - 1, B.quartz.id);

  /* a chequered aisle down the middle, because a floor you can pace out
     tells you how big a room is */
  for (var z = 2; z < HL - 1; z++) {
    for (var x = -5; x <= 5; x++) {
      if (((x + 64) >> 1) % 2 === ((z) >> 1) % 2) w.set(x, 0, z, B.terracotta.id);
    }
  }

  /* piers and windows down both long walls */
  for (var zz = 4; zz < HL - 3; zz += 6) {
    [-HW, HW].forEach(function (wall) {
      fill(w, wall, 1, zz - 1, wall, HH - 2, zz + 1, B.quartz.id);
      /* the window between this pier and the next */
      fill(w, wall, 3, zz + 2, wall, HH - 4, zz + 4, B.glass.id);
    });
    /* a lantern on each pier, at reading height */
    w.set(-HW + 1, 6, zz, B.lamp.id);
    w.set(HW - 1, 6, zz, B.lamp.id);
  }

  /* the shelves: two galleries, upper and lower, either side of the aisle */
  [-1, 1].forEach(function (side) {
    var x0 = side < 0 ? -HW + 2 : 7;
    var x1 = side < 0 ? -8 : HW - 3;
    [1, 7].forEach(function (level) {
      for (var z2 = 3; z2 < HL - 3; z2 += 4) {
        fill(w, x0, level, z2, x1, level + 3, z2 + 1, B.bookshelf.id);
        /* a gap you can walk through, every other stack */
        if (((z2 / 4) | 0) % 2 === 0) fill(w, side < 0 ? -13 : 12, level, z2, side < 0 ? -12 : 13, level + 3, z2 + 1, 0);
      }
      /* the walkway in front of the upper gallery */
      if (level === 7) fill(w, x0 - (side < 0 ? 0 : 2), level - 1, 2, x1 + (side < 0 ? 2 : 0), level - 1, HL - 3, B.planks.id);
    });
  });

  /* the rotunda at the end, and its dome */
  var cz = HL + 14, R = 13;
  for (var y2 = 0; y2 <= 1; y2++) {
    for (var x2 = -R; x2 <= R; x2++) for (var z3 = -R; z3 <= R; z3++) {
      if (x2 * x2 + z3 * z3 <= R * R) w.set(x2, y2 - 1, cz + z3, y2 ? B.quartz.id : B.stone.id);
    }
  }
  for (var a = 0; a < 360; a += 6) {
    var rx = Math.round(Math.cos(a * Math.PI / 180) * R), rz = Math.round(Math.sin(a * Math.PI / 180) * R);
    fill(w, rx, 0, cz + rz, rx, 11, cz + rz, (a % 30 === 0) ? B.quartz.id : B.sandstone.id);
    if (a % 30 === 15) fill(w, rx, 4, cz + rz, rx, 9, cz + rz, B.glass.id);
  }
  /* the dome: a hemisphere, one ring at a time */
  for (var yy = 0; yy <= R; yy++) {
    var rr = Math.sqrt(Math.max(0, R * R - yy * yy));
    for (var ang = 0; ang < 360; ang += 3) {
      var dx = Math.round(Math.cos(ang * Math.PI / 180) * rr);
      var dz = Math.round(Math.sin(ang * Math.PI / 180) * rr);
      w.set(dx, 11 + yy, cz + dz, yy > R - 3 ? B.gold.id : B.quartz.id);
    }
  }
  /* the way through from the hall */
  fill(w, -4, 1, HL - 1, 4, 7, cz - R + 1, 0);
  fill(w, -4, 0, HL - 1, 4, 0, cz - R + 1, B.quartz.id);

  /* a ring of lecterns around the middle, and a lantern over each */
  for (var b = 0; b < 360; b += 45) {
    var lx = Math.round(Math.cos(b * Math.PI / 180) * 6);
    var lz = Math.round(Math.sin(b * Math.PI / 180) * 6);
    w.set(lx, 1, cz + lz, B.planks.id);
    w.set(lx, 2, cz + lz, B.bookshelf.id);
    w.set(lx, 9, cz + lz, B.lamp.id);
  }
  /* and one lamp at the very centre, under the dome */
  fill(w, -1, 12, cz - 1, 1, 12, cz + 1, B.lamp.id);

  /* the steps up to the front door */
  for (var s2 = 0; s2 < 5; s2++) fill(w, -5, -1 + 0, -1 - s2, 5, 0, -1 - s2, B.sandstone.id);
  fill(w, -4, 1, 0, 4, 6, 0, 0);          /* the doorway */

  w.spawn = { x: 0, y: 2, z: -4, yaw: 0, pitch: 0 };
  return w;
}

/* ---------- importing a real world ----------
   Takes the bytes of one region file and adds every chunk in it, mapped
   through our own palette. `bounds` keeps a huge world from being
   loaded all at once — a full library is far more than a browser tab
   should try to mesh in one go. */
function importRegion(world, bytes, opts) {
  opts = opts || {};
  var region;
  try { region = new Anvil.Region(bytes); }
  catch (e) { return Promise.resolve({ chunks: 0, blocks: 0, error: e.message }); }

  var slots = region.present();
  var limit = opts.maxChunks || 1024;
  if (slots.length > limit) slots = slots.slice(0, limit);

  var added = 0, blocks = 0, failed = 0;
  var chain = Promise.resolve();
  slots.forEach(function (slot) {
    chain = chain.then(function () {
      return region.chunk(slot.slot).then(function (root) {
        if (!root) return;
        var decoded = Anvil.sections(root);
        var cx = decoded.xPos, cz = decoded.zPos;
        decoded.list.forEach(function (sec) {
          var baseX = cx * 16, baseY = sec.y * 16, baseZ = cz * 16;
          if (sec.uniform) {
            var m0 = Blocks.materialFor(sec.palette[0]);
            if (!m0) return;                       /* a section of pure air */
            for (var i = 0; i < 4096; i++) {
              world.set(baseX + (i & 15), baseY + (i >> 8), baseZ + ((i >> 4) & 15), m0);
              blocks++;
            }
            return;
          }
          /* map the palette once, not once a block */
          var map = new Uint16Array(sec.palette.length);
          for (var p = 0; p < sec.palette.length; p++) map[p] = Blocks.materialFor(sec.palette[p]);
          for (var j = 0; j < 4096; j++) {
            var m = map[sec.blocks[j]];
            if (!m) continue;
            world.set(baseX + (j & 15), baseY + (j >> 8), baseZ + ((j >> 4) & 15), m);
            blocks++;
          }
        });
        added++;
      }).catch(function () { failed++; });
    });
  });
  return chain.then(function () {
    return { chunks: added, blocks: blocks, failed: failed, skipped: region.present().length - slots.length };
  });
}

var W = {
  S: S, World: World, buildTribute: buildTribute, importRegion: importRegion,
  fill: fill, shell: shell
};
if (typeof module !== "undefined" && module.exports) module.exports = W;
else root.WorldLib = W;
})(typeof self !== "undefined" ? self : this);
