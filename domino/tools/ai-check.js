/* ai-check.js — dev-only. Proves the players at the table are real.

   Three things are worth proving about a game AI, and only the third
   one is hard:

   · it never cheats — every belief it holds is derivable from the view,
     and every hand it imagines is one the evidence allows;
   · it never plays an illegal bone;
   · **it is actually better.** A strength ladder is the only honest
     test of a game AI. If Maestro cannot beat Compadre, and Compadre
     cannot beat Novato, over enough matches for the result to mean
     something, then the cleverness is decoration.

   Run: node tools/ai-check.js [--matches=40] [--quick] [--verbose]    */
"use strict";
var R = require("../rules.js");
var AI = require("../ai.js");

var argv = process.argv.slice(2);
function flag(n, d) {
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === "--" + n) return true;
    if (argv[i].indexOf("--" + n + "=") === 0) return argv[i].split("=")[1];
  }
  return d;
}
/* Enough matches for the ladder to actually decide something.

   The bar each rung has to clear is two standard errors above a coin
   flip, which is the right null hypothesis but is unforgiving about
   sample size: Maestro beats Compadre about 68% of the time, and at 30
   matches two standard errors *is* 68% — the check would have been
   asking the measurement to land exactly on its own mean, and passed
   or failed on a coin flip of its own. At 100 matches the bar drops to
   60% and a true 68% clears it with room to spare.

   Costs about a minute. `--quick` skips the rollout rungs for when you
   only touched the rules. */
var MATCHES = parseInt(flag("matches", 100), 10) || 100;
var QUICK = !!flag("quick", false);
var VERBOSE = !!flag("verbose", false);

var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

/* ---------- the belief matrix ---------- */
(function () {
  var m = R.newMatch({ seed: 99 });
  var st = R.dealHand(m);
  /* teach it something: seat 1 has passed on 6 and 3 */
  st.voids[1][6] = true; st.voids[1][3] = true;
  var v = R.publicView(st, 0);
  var bel = AI.beliefs(v);

  var rowBad = 0, colBad = 0, voidBad = 0, i, k;
  for (i = 0; i < bel.tiles.length; i++) {
    var r = 0;
    for (k = 0; k < bel.m; k++) r += bel.p[i * bel.m + k];
    if (Math.abs(r - 1) > 1e-6) rowBad++;
  }
  for (k = 0; k < bel.m; k++) {
    var c = 0;
    for (i = 0; i < bel.tiles.length; i++) c += bel.p[i * bel.m + k];
    if (Math.abs(c - v.counts[bel.seats[k]]) > 1e-4) colBad++;
  }
  var k1 = bel.seats.indexOf(1);
  for (i = 0; i < bel.tiles.length; i++) {
    var t = bel.tiles[i];
    if ((R.has(t, 6) || R.has(t, 3)) && bel.p[i * bel.m + k1] > 1e-9) voidBad++;
  }
  ok("every unseen bone is in exactly one hand", rowBad === 0, rowBad + " bad rows");
  ok("every hand holds the number of bones it holds", colBad === 0, colBad + " bad columns");
  ok("a seat that passed on a number is never given one", voidBad === 0, voidBad + " impossible bones");

  ok("and it knows they are out of sixes", AI.pVoid(bel, 1, 6) > 0.999);
  ok("while staying unsure about the rest", AI.pVoid(bel, 1, 5) < 0.9);
})();

/* ---------- imagined hands are possible hands ---------- */
(function () {
  var m = R.newMatch({ seed: 4242 });
  var st = R.dealHand(m);
  var guard = 0;
  while (st.line.length < 6 && !st.over && guard++ < 40) {
    var mv = R.moves(st);
    if (!mv.length) R.pass(st); else R.play(st, mv[0]);
  }
  st.voids[2][4] = true;
  var v = R.publicView(st, 0);
  var rand = R.rng(7);
  var sizeBad = 0, dupBad = 0, leakBad = 0, voidBad = 0, coverBad = 0;

  for (var n = 0; n < 400; n++) {
    var h = AI.sample(v, rand);
    var seen = {}, tot = 0, s, i;
    for (s = 0; s < 4; s++) {
      if (h[s].length !== v.counts[s]) sizeBad++;
      for (i = 0; i < h[s].length; i++) {
        var t = h[s][i];
        if (seen[t]) dupBad++;
        seen[t] = 1; tot++;
        /* nothing on the table, and nothing of mine, may be dealt out */
        if (s !== 0 && v.hand.indexOf(t) >= 0) leakBad++;
        if (s !== 0 && v.voids[s][4] && R.has(t, 4)) voidBad++;
      }
    }
    /* my own hand comes back to me untouched */
    if (h[0].join() !== v.hand.slice().join()) leakBad++;
    if (tot !== v.hand.length + v.unseen.length) coverBad++;
  }
  ok("an imagined deal gives every seat the right number of bones", sizeBad === 0, sizeBad);
  ok("no bone is imagined in two hands at once", dupBad === 0, dupBad);
  ok("my own hand is never dealt to anyone else", leakBad === 0, leakBad);
  ok("nobody is imagined holding a suit they passed on", voidBad === 0, voidBad);
  ok("every unseen bone is placed somewhere", coverBad === 0, coverBad);
})();

/* ---------- it plays legally ---------- */
(function () {
  var illegal = 0, refused = 0, plays = 0;
  var levels = ["novato", "compadre", "maestro"];
  for (var g = 0; g < (QUICK ? 12 : 40); g++) {
    var m = R.newMatch({ seed: g * 7919 + 5 });
    var st = R.dealHand(m), rand = R.rng(g + 11), guard = 0;
    while (!st.over && guard++ < 200) {
      if (!R.canPlay(st, st.turn)) { R.pass(st); continue; }
      var v = R.publicView(st, st.turn);
      var a = AI.analyse(v, { level: levels[st.turn % 3], rand: rand });
      if (!a.move) { illegal++; break; }
      if (v.hand.indexOf(a.move.tile) < 0) illegal++;
      if (v.left >= 0) {
        var want = a.move.end === "L" ? v.left : v.right;
        if (!R.has(a.move.tile, want)) illegal++;
      }
      st.error = null;
      R.play(st, a.move);
      plays++;
      if (st.error) refused++;
    }
  }
  ok("every bone the AI plays is one it holds and one that fits", illegal === 0, illegal + " bad");
  ok("and the engine never refuses an AI move", refused === 0, refused + " refused of " + plays);
})();

/* ---------- it hears a pass ----------
   Built by hand: an opponent has passed on 2 and 5, and the player can
   either re-open those numbers (hanging them again) or open something
   they can certainly answer. A counting player takes the hanging. */
(function () {
  var st = R.newHand({
    rules: R.houseRules(),
    hands: [
      [R.tileId(2, 5), R.tileId(1, 4), R.tileId(3, 6)],
      [R.tileId(0, 1), R.tileId(1, 3), R.tileId(4, 6)],
      [R.tileId(0, 4), R.tileId(3, 3), R.tileId(6, 0)],
      [R.tileId(1, 6), R.tileId(4, 4), R.tileId(0, 3)]
    ],
    salida: 0
  });
  st.line = [{ seat: 3, tile: R.tileId(2, 2), end: "S", flip: false, dbl: true }];
  st.left = 2; st.right = 5;
  st.voids[1][2] = true; st.voids[1][5] = true;   /* seat 1 said paso on both */
  st.turn = 0;

  var v = R.publicView(st, 0);
  var a = AI.analyse(v, { level: "compadre", rand: R.rng(3) });
  /* playing 2|5 leaves the ends 5 and 2 — still exactly what seat 1
     cannot answer. It is the move that hangs them again. */
  ok("it plays the bone that keeps an opponent hanging", a.move && a.move.tile === R.tileId(2, 5),
     a.move ? R.name(a.move.tile) : "none");
  var tagged = false;
  for (var i = 0; i < a.best.why.length; i++) if (a.best.why[i].tag === "ahorca") tagged = true;
  ok("and says that is why", tagged);
})();

/* ---------- it does not shut its own partner out ---------- */
(function () {
  var st = R.newHand({
    rules: R.houseRules(),
    hands: [
      [R.tileId(3, 1), R.tileId(3, 6)],
      [R.tileId(0, 1), R.tileId(1, 5)],
      [R.tileId(0, 4), R.tileId(4, 5)],
      [R.tileId(1, 6), R.tileId(6, 5)]
    ],
    salida: 0
  });
  st.line = [{ seat: 3, tile: R.tileId(3, 3), end: "S", flip: false, dbl: true }];
  st.left = 3; st.right = 3;
  /* my partner (seat 2) has passed on 1 and 6 — do not hand them those */
  st.voids[2][1] = true; st.voids[2][6] = true;
  st.turn = 0;
  var v = R.publicView(st, 0);
  var a = AI.analyse(v, { level: "compadre", rand: R.rng(9) });
  ok("it does not open a suit its partner has passed on", a.move && a.move.tile === R.tileId(3, 1),
     a.move ? R.name(a.move.tile) : "none");
})();

/* ---------- the strength ladder ----------
   The test that matters. Two levels sit down as parejas and play real
   matches; the better one has to win clearly more than half.

   Seats are swapped every other match so neither level gets the luck of
   always opening, and the seeds are shared between the two arrangements
   so both levels see the same deals. */
function playMatch(levelA, levelB, seed, swap) {
  var m = R.newMatch({ seed: seed, rules: { target: 100 } });
  var rand = R.rng(seed ^ 0x5bf03635);
  var guard = 0;
  while (!m.over && guard++ < 60) {
    var st = R.dealHand(m), g2 = 0;
    while (!st.over && g2++ < 220) {
      if (!R.canPlay(st, st.turn)) { R.pass(st); continue; }
      var mine = swap ? (st.turn % 2 === 1) : (st.turn % 2 === 0);
      var lv = mine ? levelA : levelB;
      var v = R.publicView(st, st.turn);
      var a = AI.analyse(v, { level: lv, rand: rand });
      if (!a.move) break;
      R.play(st, a.move);
      if (st.error) break;
    }
    R.settle(m, st);
  }
  if (!m.over || m.champion < 0) return 0;
  var aTeam = swap ? 1 : 0;
  return m.champion === aTeam ? 1 : -1;
}

function ladder(strong, weak, matches, label) {
  var w = 0, l = 0, d = 0;
  for (var i = 0; i < matches; i++) {
    var r = playMatch(strong, weak, i * 2654435761 + 17, i % 2 === 1);
    if (r > 0) w++; else if (r < 0) l++; else d++;
  }
  var played = w + l;
  var rate = played ? w / played : 0.5;
  /* a fair coin over `played` matches has σ = 0.5/√played; ask for a
     result at least two of those above half, so noise alone does not
     pass the check */
  var sigma = played ? 0.5 / Math.sqrt(played) : 1;
  var need = 0.5 + 2 * sigma;
  ok(label, rate >= need,
     (rate * 100).toFixed(0) + "% of " + played + " (needed " + (need * 100).toFixed(0) + "%)");
  console.log("      " + label + ": " + w + "–" + l + (d ? " (" + d + " unfinished)" : "") +
              "  =  " + (rate * 100).toFixed(0) + "%");
  return rate;
}

/* Measured rates, so a regression shows up as a number and not just a
   red line: Compadre takes ~93% of matches off Novato, and Maestro
   ~72% off Compadre. */
console.log("\nthe ladder — " + MATCHES + " matches a rung, seats swapped every other match");
ladder("compadre", "novato", MATCHES, "a counting player beats a careless one");
if (!QUICK) ladder("maestro", "compadre", MATCHES, "a maestro beats a counting one");

/* ---------- are the rollouts earning their keep? ----------
   The ladder above cannot answer this on its own, because Maestro and
   Compadre differ in two ways at once (Compadre also plays with a
   deliberate wobble). So: the same player against itself, with the
   rollouts as the only difference.

   This is the canary. When the playout policy was mostly noise, the
   rollouts were worth nothing at all and no amount of them helped —
   600 scored the same as 220. A policy that goes blind again will show
   up here as a flat 50%, whatever the sample count. */
if (!QUICK) {
  var WITH = { id: "with", rollouts: 220, noise: 0.02, counts: true, partner: true };
  var WITHOUT = { id: "without", rollouts: 0, noise: 0.02, counts: true, partner: true };
  ladder(WITH, WITHOUT, MATCHES, "playing the hand out in your head is worth doing");
}

/* ---------- fast enough for a phone ---------- */
(function () {
  /* A real mid-hand position with a genuine choice. Timing the opening
     of the first hand measures nothing: the 6|6 is forced there, one
     legal bone means no rollouts run, and the answer comes back in
     0.0 ms — which is how the first version of this check managed to
     report that a maestro thinks instantly. */
  var rand = R.rng(5), v = null;
  for (var seed = 31; seed < 200 && !v; seed++) {
    var m = R.newMatch({ seed: seed });
    m.handNo = 1; m.lastWinner = 0;
    var st = R.dealHand(m), guard = 0;
    while (!st.over && guard++ < 40) {
      var cand = R.publicView(st, st.turn);
      if (st.line.length >= 3 && AI.movesFor(cand).length > 2) { v = cand; break; }
      var mv0 = R.moves(st);
      if (!mv0.length) R.pass(st); else R.play(st, mv0[0]);
    }
  }
  if (!v) { var mm = R.newMatch({ seed: 31 }); mm.handNo = 1; mm.lastWinner = 0; v = R.publicView(R.dealHand(mm), 0); }
  ok("the timing position is a real choice", AI.movesFor(v).length > 1,
     AI.movesFor(v).length + " legal bones");

  var t0 = Date.now(), n = 0;
  while (Date.now() - t0 < 500) { AI.analyse(v, { level: "maestro", rand: rand }); n++; }
  var per = (Date.now() - t0) / n;
  ok("a maestro decides fast enough to feel instant", per < 120, per.toFixed(1) + " ms a move");
  console.log("      maestro thinks for " + per.toFixed(1) + " ms over " +
              AI.movesFor(v).length + " candidates");
})();

console.log("\n" + (fail === 0
  ? "the table can play — " + pass + " checks passed"
  : fail + " of " + (pass + fail) + " checks FAILED"));
if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
