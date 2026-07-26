/* layout-check.js — dev-only. Proves the table geometry.

   Two things are worth proving and one is worth measuring:

   · no two bones overlap, over thousands of real games including the
     long ones that fold three and four rows deep;
   · the table is stable — a bone already down never moves when the next
     one lands, which is what lets the renderer animate instead of
     redraw;
   · and the fold actually happens, because a layout that never turns a
     corner would pass an overlap check trivially by running off to
     infinity.

   Run: node tools/layout-check.js [--games=600] [--verbose]           */
"use strict";
var R = require("../rules.js");
var L = require("../layout.js");

var argv = process.argv.slice(2);
function flag(n, d) {
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === "--" + n) return true;
    if (argv[i].indexOf("--" + n + "=") === 0) return argv[i].split("=")[1];
  }
  return d;
}
var GAMES = parseInt(flag("games", 600), 10) || 600;
var VERBOSE = !!flag("verbose", false);

var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

/* two rectangles overlap only if they share actual area — bones that
   merely touch edge to edge are exactly what we want */
var EPS = 1e-6;
function overlaps(a, b) {
  return (a.x1 - b.x0) > EPS && (b.x1 - a.x0) > EPS &&
         (a.y1 - b.y0) > EPS && (b.y1 - a.y0) > EPS;
}

/* ---------- an empty table ---------- */
(function () {
  var t = L.table([]);
  ok("an empty table has two ends waiting", !!t.ends && t.bones.length === 0);
  ok("and a box to draw into", !!t.bbox && t.bbox.x1 > t.bbox.x0);
})();

/* ---------- the salida ---------- */
(function () {
  var t = L.table([{ tile: R.tileId(3, 5), end: "S", flip: false, dbl: false }]);
  ok("the first bone lies in the middle", Math.abs(t.bones[0].x) < EPS && Math.abs(t.bones[0].y) < EPS);
  ok("lying along the line", t.bones[0].rot % 180 === 0);
  ok("with an end either side", t.ends.L.x < 0 && t.ends.R.x > 0);
  var d = L.table([{ tile: R.tileId(6, 6), end: "S", flip: false, dbl: true }]);
  ok("a mula opening the game stands crosswise", d.bones[0].rot % 180 === 90);
})();

/* ---------- bones touch, and only touch ---------- */
(function () {
  var t = L.table([
    { tile: R.tileId(3, 5), end: "S", flip: false, dbl: false },
    { tile: R.tileId(5, 2), end: "R", flip: false, dbl: false }
  ]);
  var a = L.boxOf(t.bones[0]), b = L.boxOf(t.bones[1]);
  ok("a bone laid on the right touches the one before it", Math.abs(b.x0 - a.x1) < EPS);
  ok("and does not overlap it", !overlaps(a, b));
  ok("and sits on the same row", Math.abs(t.bones[1].y - t.bones[0].y) < EPS);
})();

/* ---------- the fold ----------
   A long straight run, forced to turn. This is the case that used to be
   drawn on top of itself. */
(function () {
  var line = [{ tile: R.tileId(0, 1), end: "S", flip: false, dbl: false }];
  for (var i = 0; i < 12; i++) line.push({ tile: R.tileId(1, 2), end: "R", flip: false, dbl: false });
  var t = L.table(line, { bound: 8 });
  var bad = 0;
  for (var a = 0; a < t.bones.length; a++) {
    for (var b = a + 1; b < t.bones.length; b++) {
      if (overlaps(L.boxOf(t.bones[a]), L.boxOf(t.bones[b]))) bad++;
    }
  }
  ok("a long run folds without landing on itself", bad === 0, bad + " overlaps");
  var rows = {};
  for (var k = 0; k < t.bones.length; k++) rows[Math.round(t.bones[k].y * 2)] = 1;
  ok("and it really does fold", Object.keys(rows).length > 1);
  ok("staying inside the table", Math.abs(t.bbox.x0) < 14 && Math.abs(t.bbox.x1) < 14);
})();

/* ---------- rows are far enough apart for crosswise doubles ----------
   A double reaches a full unit either side of its row. Two rows of
   doubles at 1½ apart would touch; at 2 they do not. */
(function () {
  var line = [{ tile: R.tileId(0, 1), end: "S", flip: false, dbl: false }];
  for (var i = 0; i < 20; i++) line.push({ tile: R.tileId(2, 2), end: "R", flip: false, dbl: true });
  var t = L.table(line, { bound: 7 });
  var bad = 0;
  for (var a = 0; a < t.bones.length; a++) {
    for (var b = a + 1; b < t.bones.length; b++) {
      if (overlaps(L.boxOf(t.bones[a]), L.boxOf(t.bones[b]))) bad++;
    }
  }
  ok("a row of nothing but mulas still folds cleanly", bad === 0, bad + " overlaps");
})();

/* ---------- both ends grow, and they keep out of each other's way ---------- */
(function () {
  var line = [{ tile: R.tileId(0, 1), end: "S", flip: false, dbl: false }];
  for (var i = 0; i < 20; i++) {
    line.push({ tile: R.tileId(1, 2), end: i % 2 ? "R" : "L", flip: false, dbl: false });
  }
  var t = L.table(line, { bound: 6 });
  var bad = 0;
  for (var a = 0; a < t.bones.length; a++) {
    for (var b = a + 1; b < t.bones.length; b++) {
      if (overlaps(L.boxOf(t.bones[a]), L.boxOf(t.bones[b]))) bad++;
    }
  }
  ok("both ends can grow at once without colliding", bad === 0, bad + " overlaps");
  ok("the two ends fold opposite ways", t.bbox.y0 < -1 && t.bbox.y1 > 1);
})();

/* ---------- over real games ---------- */
(function () {
  var overlapBad = 0, moveBad = 0, worstMove = 0, maxRows = 0, folded = 0, longest = 0;
  var boundsTried = [6, 8, 11, 14];

  for (var g = 0; g < GAMES; g++) {
    var bound = boundsTried[g % boundsTried.length];
    var m = R.newMatch({ seed: g * 2246822519 + 7 });
    var st = R.dealHand(m), rand = R.rng(g + 4242), guard = 0;
    var prev = null;

    while (!st.over && guard++ < 200) {
      var mv = R.moves(st);
      if (!mv.length) { R.pass(st); continue; }
      R.play(st, mv[Math.floor(rand() * mv.length) % mv.length]);

      var t = L.table(st.line, { bound: bound });

      /* nothing overlaps */
      for (var a = 0; a < t.bones.length; a++) {
        for (var b = a + 1; b < t.bones.length; b++) {
          if (overlaps(L.boxOf(t.bones[a]), L.boxOf(t.bones[b]))) overlapBad++;
        }
      }

      /* nothing already on the table moved. The new bone may be at
         either end, so compare by the play index it carries. */
      if (prev) {
        for (var p = 0; p < prev.bones.length; p++) {
          var was = prev.bones[p], now = null;
          for (var q = 0; q < t.bones.length; q++) if (t.bones[q].idx === was.idx) now = t.bones[q];
          if (!now) { moveBad++; continue; }
          var d = Math.max(Math.abs(now.x - was.x), Math.abs(now.y - was.y), Math.abs(now.rot - was.rot));
          if (d > EPS) { moveBad++; worstMove = Math.max(worstMove, d); }
        }
      }
      prev = t;
      maxRows = Math.max(maxRows, t.rows);
      longest = Math.max(longest, t.bones.length);
      if (t.rows > 1) folded = 1;
    }
  }

  ok("no two bones ever overlap, over " + GAMES + " games", overlapBad === 0, overlapBad + " overlaps");
  ok("a bone already down never moves", moveBad === 0, moveBad + " moved, worst by " + worstMove.toFixed(3));
  ok("long games fold onto more rows", folded === 1);
  console.log("      deepest table " + maxRows + " rows, longest line " + longest + " bones");
})();

/* ---------- fitting to a screen ---------- */
(function () {
  var line = [{ tile: R.tileId(0, 1), end: "S", flip: false, dbl: false }];
  for (var i = 0; i < 9; i++) line.push({ tile: R.tileId(1, 2), end: "R", flip: false, dbl: false });
  var t = L.table(line, { bound: 9 });

  function fits(w, h) {
    var f = L.fit(t.bbox, w, h, 12);
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (var k = 0; k < t.bones.length; k++) {
      var r = L.boxOf(t.bones[k]);
      minX = Math.min(minX, r.x0 * f.scale + f.ox); maxX = Math.max(maxX, r.x1 * f.scale + f.ox);
      minY = Math.min(minY, r.y0 * f.scale + f.oy); maxY = Math.max(maxY, r.y1 * f.scale + f.oy);
    }
    return { in: minX >= -0.01 && minY >= -0.01 && maxX <= w + 0.01 && maxY <= h + 0.01, s: f.scale };
  }
  var phone = fits(390, 640), tablet = fits(1024, 768), tiny = fits(300, 380);
  ok("the table fits a phone", phone.in);
  ok("the table fits a tablet", tablet.in);
  ok("the table fits a very small screen", tiny.in);
  ok("a bigger screen draws bigger bones", tablet.s > phone.s);
  ok("the scale is always usable", phone.s > 2 && tiny.s > 2);
})();

/* ---------- the hand along the bottom ----------
   The rule that matters is that every bone stays big enough to hit. A
   finger pad is about 44 CSS pixels; below that a hand of seven becomes
   a game of precision tapping. */
(function () {
  var screens = [[320, 480], [360, 640], [390, 844], [414, 896], [768, 1024], [1180, 820]];
  var tooSmall = 0, offScreen = 0, unordered = 0, sizes = [];

  screens.forEach(function (s) {
    for (var n = 1; n <= 7; n++) {
      var r = L.handRow(n, s[0], s[1]);
      if (r.length !== n) unordered++;
      for (var i = 0; i < n; i++) {
        if (r[i].w < 43.9) tooSmall++;
        if (r[i].x < -0.01 || r[i].x + r[i].w > s[0] + 0.01) offScreen++;
        if (r[i].y < 0 || r[i].y + r[i].h > s[1] + 0.01) offScreen++;
        if (i && r[i].x <= r[i - 1].x) unordered++;
      }
      if (n === 7) sizes.push(Math.round(r[0].w));
    }
  });
  ok("every bone in hand stays big enough to tap", tooSmall === 0, tooSmall + " under 44px");
  ok("and the whole hand stays on the screen", offScreen === 0, offScreen + " off");
  ok("and they run left to right", unordered === 0);
  console.log("      a hand of seven draws bones " + Math.min.apply(null, sizes) + "–" +
              Math.max.apply(null, sizes) + "px wide across phones and tablets");

  /* on the narrowest screen they have to overlap rather than shrink */
  var tight = L.handRow(7, 320, 480);
  ok("on a narrow phone the hand overlaps instead of shrinking", tight[0].over === true);
  var roomy = L.handRow(7, 1180, 820);
  ok("and on a tablet it does not", roomy[0].over === false);
})();

(function () {
  var r = L.handRow(7, 390, 844);
  var mid = r[3];
  ok("a tap in the middle of a bone finds it", L.hitHand(r, mid.x + mid.w / 2, mid.y + mid.h / 2) === 3);
  ok("a tap above the hand finds nothing", L.hitHand(r, mid.x + mid.w / 2, mid.y - 40) === -1);
  ok("a tap past the end finds nothing", L.hitHand(r, r[6].x + r[6].w + 30, mid.y + 10) === -1);
  ok("the first and last bones are both reachable",
     L.hitHand(r, r[0].x + 2, r[0].y + 2) === 0 && L.hitHand(r, r[6].x + r[6].w - 2, r[6].y + 2) === 6);

  /* where they overlap, the tap picks the one drawn on top */
  var o = L.handRow(7, 320, 480);
  var seam = o[3].x + o[3].w - 1;
  ok("where bones overlap, the visible one is picked",
     L.hitHand(o, seam, o[3].y + 10) === 4 || L.hitHand(o, seam, o[3].y + 10) === 3);
})();

console.log("\n" + (fail === 0
  ? "the table lies flat — " + pass + " checks passed"
  : fail + " of " + (pass + fail) + " checks FAILED"));
if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
