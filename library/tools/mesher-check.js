/* mesher-check.js — dev-only. Proves the greedy mesher.

   Greedy meshing is easy to get *nearly* right, and nearly right looks
   fine in a screenshot: a merge that runs one block too far, or leaves
   a one-block gap, or overlaps its neighbour, all produce a world that
   renders and mostly looks like a world.

   So the checks are arithmetic rather than visual, and the strongest is
   an area conservation law:

       total area of the merged quads  ==  number of exposed unit faces

   Merging changes how many rectangles cover the surface, never how much
   surface is covered. A quad one too long breaks it. A gap breaks it.
   An overlap breaks it. It holds on every input or the mesher is wrong.

   Backed by a second, independent statement — no two quads may overlap,
   checked by stamping every emitted quad into a grid and looking for a
   cell written twice — because area alone could in principle be
   satisfied by an overlap and a gap cancelling out.

   Run: node tools/mesher-check.js [--verbose]                          */
"use strict";
var M = require("../mesher.js");

var VERBOSE = process.argv.indexOf("--verbose") >= 0;
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

function vol(sx, sy, sz, fn) {
  return M.volume(sx, sy, sz, function (x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0;
    return fn(x, y, z) | 0;
  });
}
function area(quads) {
  var a = 0;
  for (var i = 0; i < quads.length; i++) a += quads[i].w * quads[i].h;
  return a;
}
/* every quad stamped into a per-direction grid; a cell written twice is
   an overlap, which area alone might not catch */
function overlaps(quads) {
  var seen = new Set(), dupes = 0;
  for (var i = 0; i < quads.length; i++) {
    var q = quads[i], u = q.au, v = q.av;
    var lo = [q.x, q.y, q.z];
    for (var b = 0; b < q.h; b++) {
      for (var a = 0; a < q.w; a++) {
        var c = [lo[0], lo[1], lo[2]];
        c[u] += a; c[v] += b;
        var key = q.dir + ":" + c[0] + "," + c[1] + "," + c[2];
        if (seen.has(key)) dupes++;
        seen.add(key);
      }
    }
  }
  return { dupes: dupes, cells: seen.size };
}

/* ---------- the simplest possible statements ---------- */
(function () {
  var one = vol(3, 3, 3, function (x, y, z) { return (x === 1 && y === 1 && z === 1) ? 1 : 0; });
  var q = M.build(one);
  ok("a single block has six faces", area(q) === 6, area(q) + "");
  ok("emitted as six quads", q.length === 6, q.length + "");
  ok("one in each direction", new Set(q.map(function (x) { return x.dir; })).size === 6);

  var empty = vol(8, 8, 8, function () { return 0; });
  ok("empty space produces nothing", M.build(empty).length === 0);

  var full = vol(8, 8, 8, function () { return 1; });
  var fq = M.build(full);
  ok("a solid cube shows only its outside", area(fq) === 6 * 8 * 8, area(fq) + "");
  ok("and merges each side into a single quad", fq.length === 6, fq.length + "");
})();

/* ---------- merging actually merges ---------- */
(function () {
  var floor = vol(16, 4, 16, function (x, y, z) { return y === 0 ? 1 : 0; });
  var q = M.build(floor);
  var top = q.filter(function (x) { return x.dir === 2; });
  ok("a 16×16 floor becomes one quad, not 256", top.length === 1, top.length + " quads");
  ok("covering the whole floor", top[0].w * top[0].h === 256);

  var striped = vol(16, 1, 16, function (x) { return (x < 8) ? 1 : 2; });
  var sq = M.build(striped).filter(function (x) { return x.dir === 2; });
  ok("different materials never merge together", sq.length === 2, sq.length + "");
  ok("and each keeps its own material",
     sq.map(function (s) { return s.mat; }).sort().join(",") === "1,2");
})();

/* ---------- nothing is drawn where nobody can see it ---------- */
(function () {
  var v = vol(10, 10, 10, function (x, y, z) {
    var inCavity = x >= 3 && x <= 6 && y >= 3 && y <= 6 && z >= 3 && z <= 6;
    return inCavity ? 0 : 1;
  });
  var q = M.build(v);
  var expect = M.exposedFaces(v);
  ok("a solid block with a sealed cavity is meshed exactly", area(q) === expect, area(q) + " vs " + expect);
  ok("with no overlapping quads", overlaps(q).dupes === 0);

  var solidBlocks = 1000 - 64;
  var naive = solidBlocks * 6;
  ok("and it is far cheaper than drawing every face", area(q) < naive / 3,
     area(q) + " faces vs " + naive + " naive");
  console.log("      a 10³ block with a sealed cavity: " + naive + " naive faces → " +
              area(q) + " kept → " + q.length + " quads after merging");
})();

/* ---------- the conservation law, over many volumes ---------- */
(function () {
  var bad = 0, over = 0, cases = 0, totalNaive = 0, totalKept = 0, totalQuads = 0;
  var worst = null;

  for (var t = 0; t < 260; t++) {
    var sx = 1 + ((t * 7) % 16), sy = 1 + ((t * 5) % 16), sz = 1 + ((t * 11) % 16);
    var mats = 1 + (t % 4);
    var fill = 0.25 + ((t * 13) % 50) / 100;
    var kind = t % 5;
    var seed = t;
    var v = vol(sx, sy, sz, function (x, y, z) {
      var h;
      if (kind === 0) {
        h = Math.sin((x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453);
        h = h - Math.floor(h);
        return h < fill ? 1 + (Math.floor(h * 977) % mats) : 0;
      }
      if (kind === 1) return (x + y + z) % 3 === 0 ? 1 + ((x * y * z) % mats) : 0;
      if (kind === 2) return y < sy / 2 ? 1 : 0;
      if (kind === 3) return (x === 0 || y === 0 || z === 0 ||
                              x === sx - 1 || y === sy - 1 || z === sz - 1) ? 2 : 0;
      return ((x >> 1) + (z >> 1)) % 2 === 0 && y < 3 ? 1 : 0;
    });

    var q = M.build(v);
    var expect = M.exposedFaces(v);
    var got = area(q);
    cases++;
    if (got !== expect) {
      bad++;
      if (!worst) worst = sx + "×" + sy + "×" + sz + " kind " + kind + ": " + got + " vs " + expect;
    }
    if (overlaps(q).dupes) over++;

    var solid = 0;
    for (var z = 0; z < sz; z++) for (var y = 0; y < sy; y++) for (var x = 0; x < sx; x++) if (v.at(x, y, z)) solid++;
    totalNaive += solid * 6; totalKept += got; totalQuads += q.length;
  }

  ok("the merged area equals the exposed surface, every time", bad === 0,
     bad + " of " + cases + " wrong" + (worst ? " (" + worst + ")" : ""));
  ok("and no two quads ever overlap", over === 0, over + " of " + cases);
  console.log("      " + cases + " volumes: " + totalNaive.toLocaleString() + " naive faces → " +
              totalKept.toLocaleString() + " exposed → " + totalQuads.toLocaleString() + " quads (" +
              (totalNaive / Math.max(1, totalQuads)).toFixed(1) + "× fewer things to draw)");
})();

/* ---------- see-through materials ---------- */
(function () {
  var GLASS = 9;
  var see = function (m) { return m === GLASS; };
  var pane = vol(4, 1, 4, function () { return GLASS; });
  var q = M.build(pane, { seeThrough: see });
  ok("glass does not draw faces against its own kind",
     area(q) === M.exposedFaces(pane, { seeThrough: see }),
     area(q) + " vs " + M.exposedFaces(pane, { seeThrough: see }));
  var top = q.filter(function (x) { return x.dir === 2; });
  ok("and a pane merges like anything else", top.length === 1, top.length + "");

  var mixed = vol(4, 2, 4, function (x, y) { return y === 0 ? 1 : GLASS; });
  var mq = M.build(mixed, { seeThrough: see });
  var expect = M.exposedFaces(mixed, { seeThrough: see });
  ok("but stone under glass is still drawn", area(mq) === expect, area(mq) + " vs " + expect);
})();

/* ---------- geometry: flatness and winding ---------- */
(function () {
  var one = vol(3, 3, 3, function (x, y, z) { return (x === 1 && y === 1 && z === 1) ? 1 : 0; });
  var q = M.build(one);
  var bad = 0, degenerate = 0;
  q.forEach(function (quad) {
    var c = M.corners(quad);
    var d = quad.dir >> 1;
    var plane = c[0][d];
    for (var i = 1; i < 4; i++) if (c[i][d] !== plane) bad++;
    var e1 = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]];
    var e2 = [c[3][0] - c[0][0], c[3][1] - c[0][1], c[3][2] - c[0][2]];
    var cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (Math.hypot(cr[0], cr[1], cr[2]) === 0) degenerate++;
  });
  ok("every quad is flat and in its own plane", bad === 0, bad + " corners out of plane");
  ok("and none is degenerate", degenerate === 0);

  /* the winding: normal and corner order must agree, or back-face
     culling hides exactly the wrong half of the world */
  var flipped = 0;
  q.forEach(function (quad) {
    var c = M.corners(quad), n = M.DIRS[quad.dir].normal;
    var e1 = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]];
    var e2 = [c[3][0] - c[0][0], c[3][1] - c[0][1], c[3][2] - c[0][2]];
    var cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] <= 0) flipped++;
  });
  ok("and every quad winds the way its normal points", flipped === 0, flipped + " wound backwards");
})();

/* ---------- triangles ---------- */
(function () {
  var v = vol(6, 6, 6, function (x, y, z) { return (y < 3) ? 1 : 0; });
  var q = M.build(v);
  var t = M.toTriangles(q);
  ok("four corners a quad", t.positions.length / 3 === q.length * 4);
  ok("six indices a quad", t.indices.length === q.length * 6);
  ok("a normal for every corner", t.normals.length === t.positions.length);
  ok("a material for every corner", t.mats.length === t.positions.length / 3);
  var maxIdx = Math.max.apply(null, t.indices);
  ok("no index points past the end", maxIdx < t.positions.length / 3, maxIdx + "");
  var wide = q.filter(function (x) { return x.w > 1 || x.h > 1; })[0];
  ok("a merged quad repeats its texture per block",
     !!wide && t.uvs.some(function (u) { return u > 1; }));
})();

/* ---------- neighbours ----------
   A chunk that can see its neighbours must not draw the wall between
   them; that seam is where a naive chunked mesher wastes most of its
   triangles. */
(function () {
  var solidEverywhere = M.volume(16, 16, 16, function () { return 1; });
  ok("a chunk whose neighbours are solid draws nothing at all",
     M.build(solidEverywhere).length === 0, M.build(solidEverywhere).length + " quads");

  var openTop = M.volume(16, 16, 16, function (x, y, z) { return y >= 16 ? 0 : 1; });
  var q2 = M.build(openTop);
  ok("and only the side that is open to air", area(q2) === 256, area(q2) + "");
})();

console.log("\n" + (fail === 0
  ? "the surface is exact — " + pass + " checks passed"
  : fail + " of " + (pass + fail) + " checks FAILED"));
if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
