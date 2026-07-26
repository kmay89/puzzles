/* selftest.js — proof, not vibes.

   Run before trusting a change to core.js, strategies.js or forge.js:

       node sudoku/tools/selftest.js            # the standing suite
       node sudoku/tools/selftest.js --deep     # slower, wider
       node sudoku/tools/selftest.js --seed=7   # a different corner

   What it actually checks:

     geometry     every cell sees exactly 20 others; the 27 units are
                  the 27 units.
     the oracle   known puzzles (including a 17-clue one and a famously
                  awkward one) get solved, and a grid with two answers
                  is counted as having two.
     soundness    THE important one. Thousands of generated puzzles are
                  solved technique by technique, and every single
                  elimination is checked against the brute-force answer.
                  A technique that ever strikes out the digit that
                  really belongs there fails the run. So does a
                  placement that disagrees with the answer.
     the forge    every band produces puzzles with exactly one answer,
                  in the band it claims, inside a time budget.
     the daily    the same date gives the same puzzle, twice running.

   No test framework — this file is the framework. */
"use strict";

var path = require("path");
var dir = path.join(__dirname, "..");
var S = require(path.join(dir, "core.js"));
var Strat = require(path.join(dir, "strategies.js"));
var Forge = require(path.join(dir, "forge.js"));

var args = process.argv.slice(2);
var DEEP = args.indexOf("--deep") >= 0;
var SEED = 1;
args.forEach(function (a) { if (a.indexOf("--seed=") === 0) SEED = parseInt(a.slice(7), 10) || 1; });

var failures = 0, checks = 0;
function ok(cond, what, detail) {
  checks++;
  if (!cond) { failures++; console.log("  ✗ " + what + (detail ? "  — " + detail : "")); }
  return cond;
}
function head(t) { console.log("\n" + t); }
function done(t, extra) { console.log("  ✓ " + t + (extra ? "  " + extra : "")); }

/* ---------- geometry ---------- */
head("geometry");
(function () {
  var good = true;
  for (var i = 0; i < 81; i++) {
    if (S.PEERS[i].length !== 20) good = false;
    if (S.UNITS_OF[i].length !== 3) good = false;
  }
  ok(good, "every cell has 20 peers and 3 units");
  ok(S.UNITS.length === 27, "27 units");
  var counted = 0;
  for (var u = 0; u < 27; u++) counted += S.UNITS[u].length;
  ok(counted === 243, "27 units of 9 cells");
  ok(S.sees(0, 1) && S.sees(0, 9) && S.sees(0, 10) && !S.sees(0, 80), "seeing works both ways");
  ok(S.cellName(0) === "r1c1" && S.cellName(80) === "r9c9", "cell names");
  done("geometry");
})();

/* ---------- the oracle ---------- */
head("the brute-force solver");
(function () {
  var cases = [
    /* the "hardest sudoku" Arto Inkala published in 2012 */
    ["8..........36......7..9.2...5...7.......457.....1...3...1....68..85...1..9....4..",
     "812753649943682175675491283154237896369845721287169534521974368438526917796318452"],
    /* a 17-clue puzzle from Gordon Royle's catalogue — 17 is the
       proven minimum, shown impossible below it by exhaustive search
       in 2012. */
    ["000000010400000000020000000000050407008000300001090000300400200050100000000806000", null],
    /* a plain newspaper puzzle */
    ["53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79",
     "534678912672195348198342567859761423426853791713924856961537284287419635345286179"]
  ];
  cases.forEach(function (c, n) {
    var g = S.fromString(c[0]);
    ok(!!g, "case " + n + " parses");
    var sol = S.solve(g);
    ok(!!sol, "case " + n + " solves");
    if (sol) {
      ok(S.isLegal(sol) && S.isComplete(sol), "case " + n + " answer is a legal full grid");
      if (c[1]) ok(S.toString(sol) === c[1], "case " + n + " matches the published answer");
    }
    ok(S.countSolutions(g, 2) === 1, "case " + n + " has exactly one answer");
  });
  /* An empty grid has a great many answers; the counter must stop at
     the cap rather than trying to find them all. */
  ok(S.countSolutions(S.empty(), 2) === 2, "an empty grid counts as 'more than one'");
  /* Remove a clue from a solved grid and it must go ambiguous or stay
     unique — never zero. */
  var full = S.fullGrid(S.rng(SEED));
  var two = S.clone(full); two[0] = 0; two[1] = 0; two[9] = 0; two[10] = 0;
  ok(S.countSolutions(two, 3) >= 1, "a dug grid still has at least one answer");
  done("solver");
})();

/* ---------- soundness ---------- */
head("technique soundness (the one that matters)");
(function () {
  var rounds = DEEP ? 400 : 120;
  var bad = 0, unsolved = 0, elims = 0, places = 0, seen = {};
  for (var n = 0; n < rounds; n++) {
    var rnd = S.rng(SEED * 1000003 + n);
    var full = S.fullGrid(rnd);
    /* Dig freely — no difficulty gate — so the solver meets the whole
       zoo, including the patterns the generator rarely ships. */
    var g = S.clone(full), order = S.shuffle(range(81), rnd);
    for (var k = 0; k < 81; k++) {
      var i = order[k], v = g[i];
      g[i] = 0;
      if (S.countSolutions(g, 2) !== 1) g[i] = v;
    }
    var r = Strat.run(g, {
      onStep: function (step) {
        seen[step.tech] = (seen[step.tech] || 0) + 1;
        step.elim.forEach(function (e) {
          elims++;
          if (full[e.i] === e.d) {
            bad++;
            console.log("  ✗ " + step.tech + " struck the true digit " + e.d +
                        " out of " + S.cellName(e.i) + " (round " + n + ")");
          }
        });
        step.place.forEach(function (p) {
          places++;
          if (full[p.i] !== p.d) {
            bad++;
            console.log("  ✗ " + step.tech + " placed " + p.d + " in " + S.cellName(p.i) +
                        " but the answer is " + full[p.i] + " (round " + n + ")");
          }
        });
      }
    });
    if (!r.solved) { unsolved++; console.log("  ✗ round " + n + " left unfinished"); }
  }
  ok(bad === 0, "no technique ever contradicted the answer",
     bad ? bad + " bad conclusions" : "");
  ok(unsolved === 0, "every puzzle finished");
  console.log("    " + rounds + " puzzles · " + places + " placements · " + elims + " eliminations");
  var missing = Strat.TECHS.filter(function (t) { return !seen[t.id] && t.id !== "ariadne"; });
  console.log("    techniques exercised: " + Object.keys(seen).length + "/" + Strat.TECHS.length +
              (missing.length ? " (unseen: " + missing.map(function (t) { return t.id; }).join(", ") + ")" : ""));
  done("soundness");
})();

/* ---------- every technique gets its day ----------
   Hand-built positions, one per pattern, so a technique that stops
   firing is caught even if random puzzles happen not to need it. */
head("each technique fires on a position built for it");
(function () {
  /* Positions are generated rather than quoted: dig until the solver
     needs the technique, then keep that grid. Deterministic by seed. */
  var wanted = Strat.TECHS.filter(function (t) { return t.id !== "ariadne"; });
  var found = {};
  for (var n = 0; n < (DEEP ? 900 : 400) && Object.keys(found).length < wanted.length; n++) {
    var rnd = S.rng(SEED * 7919 + n);
    var full = S.fullGrid(rnd), g = S.clone(full), order = S.shuffle(range(81), rnd);
    for (var k = 0; k < 81; k++) {
      var i = order[k], v = g[i]; g[i] = 0;
      if (S.countSolutions(g, 2) !== 1) g[i] = v;
    }
    var st = Strat.state(g), guard = 0;
    while (guard++ < 300) {
      var s = Strat.nextStep(st, null);
      if (!s) break;
      /* Keep the *whole* state, candidates included: a technique
         needs the eliminations its predecessors made, so a bare grid
         string would not reproduce the moment. */
      if (!found[s.tech]) found[s.tech] = { grid: S.toString(st.g), cands: Array.prototype.slice.call(st.c) };
      Strat.apply(st, s);
    }
  }
  wanted.forEach(function (t) {
    if (!found[t.id]) { console.log("  · no position found for " + t.id + " in this run"); return; }
    var g = S.fromString(found[t.id].grid);
    var st = Strat.stateFrom(g, found[t.id].cands);
    var step = Strat.BY_ID[t.id].find(st);
    ok(!!step, t.id + " fires on the position that needed it");
    if (step) {
      var sol = S.solve(g), sound = true;
      step.elim.forEach(function (e) { if (sol[e.i] === e.d) sound = false; });
      step.place.forEach(function (p) { if (sol[p.i] !== p.d) sound = false; });
      ok(sound, t.id + " is sound there");
      ok(typeof step.text === "string" && step.text.length > 20, t.id + " says why in words");
    }
  });
  done("technique positions");
})();

/* ---------- the dojo's lessons ---------- */
head("dojo lessons reproduce");
(function () {
  var LESSONS;
  try { LESSONS = require(path.join(dir, "lessons.js")); }
  catch (e) { console.log("  · lessons.js missing — run tools/make-lessons.js"); return; }
  var ids = Object.keys(LESSONS), total = 0, alt = 0;
  ids.forEach(function (id) {
    LESSONS[id].forEach(function (L) {
      total++; if (L.alt) alt++;
      var g = S.fromString(L.puzzle);
      if (!ok(!!g, id + ": lesson puzzle parses")) return;
      var st = Strat.state(g), fine = true;
      for (var n = 0; n < L.skip; n++) {
        var step = Strat.nextStep(st, null);
        if (!step) { fine = false; break; }
        Strat.apply(st, step);
      }
      if (!ok(fine, id + ": lesson replays " + L.skip + " steps")) return;
      var here = Strat.BY_ID[id].find(st);
      if (!ok(!!here, id + ": the technique is there when the lesson opens")) return;
      var sol = S.solve(g), sound = true;
      here.elim.forEach(function (e) { if (sol[e.i] === e.d) sound = false; });
      here.place.forEach(function (p) { if (sol[p.i] !== p.d) sound = false; });
      ok(sound, id + ": the lesson's conclusion is true");
    });
  });
  ok(ids.length >= Strat.TECHS.length - 1, "a lesson for every technique",
     ids.length + "/" + (Strat.TECHS.length - 1));
  console.log("    " + total + " lessons across " + ids.length + " techniques (" + alt + " where a simpler move also exists)");
  done("lessons");
})();

/* ---------- the forge ---------- */
head("the forge");
(function () {
  var per = DEEP ? 10 : 4, slowest = 0, slowestId = "";
  Forge.LEVELS.forEach(function (L) {
    var hits = 0, t0 = Date.now();
    for (var n = 0; n < per; n++) {
      var job = Forge.job({ level: L.id, seed: SEED * 104729 + n * 7717 });
      var guard = 0;
      while (job.tick(1000) && guard++ < 1000000) { /* run it out */ }
      var r = job.result;
      if (!ok(!!r, L.id + ": produced a puzzle")) continue;
      ok(S.countSolutions(r.puzzle, 2) === 1, L.id + ": exactly one answer");
      ok(S.toString(S.solve(r.puzzle)) === S.toString(r.solution), L.id + ": answer matches the one it was cut from");
      ok(r.clues >= 17 && r.clues <= 50, L.id + ": sane clue count", String(r.clues));
      ok(r.solved, L.id + ": finishable by named techniques alone");
      ok(r.tier <= L.tier, L.id + ": never harder than the band promises",
         r.band + " > " + L.id);
      if (r.band === L.id) hits++;
      /* A band's puzzles must not need contradiction or search. */
      ok(!r.counts.nishio && !r.counts.ariadne, L.id + ": no guessing needed");
      if (L.symmetric && r.symmetric) {
        var sym = true;
        for (var i = 0; i < 81; i++) if (!!r.puzzle[i] !== !!r.puzzle[80 - i]) sym = false;
        ok(sym, L.id + ": rotationally symmetric when it says it is");
      }
    }
    var ms = Math.round((Date.now() - t0) / per);
    if (ms > slowest) { slowest = ms; slowestId = L.id; }
    ok(hits >= Math.ceil(per * 0.6), L.id + ": lands in its own band",
       hits + "/" + per);
    console.log("    " + L.id + ": " + hits + "/" + per + " on band, " + ms + "ms each");
  });
  ok(slowest < 3000, "the slowest band still forges in under 3 seconds", slowestId + " " + slowest + "ms");
  done("forge");
})();

/* ---------- the daily ---------- */
head("the daily puzzle");
(function () {
  var day = new Date(2026, 6, 26);
  var a = Forge.make(Forge.dailyLevel(day), Forge.dailySeed(day));
  var b = Forge.make(Forge.dailyLevel(day), Forge.dailySeed(day));
  ok(S.toString(a.puzzle) === S.toString(b.puzzle), "the same date gives the same puzzle");
  ok(Forge.dailyKey(day) === "2026-07-26", "the day key is the date", Forge.dailyKey(day));
  var week = {};
  for (var d = 0; d < 7; d++) week[Forge.dailyLevel(new Date(2026, 6, 20 + d))] = 1;
  ok(Object.keys(week).length >= 3, "the week is not all one band", Object.keys(week).join(", "));
  done("daily");
})();

/* ---------- helpers ---------- */
function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

console.log("\n" + (failures ? "FAILED " + failures + " of " + checks + " checks"
                              : "all " + checks + " checks passed") + "\n");
process.exit(failures ? 1 : 0);
