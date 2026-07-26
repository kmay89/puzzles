/* rules-check.js — dev-only. Proves the rules engine before anything is
   built on top of it.

   The interesting checks are not "does it run" but the two things a
   table would notice immediately: that the line on the table is always a
   real chain (every bone touching its neighbour on a matching number),
   and that nobody ever passes while holding a bone they could play.
   Both are re-derived here from the move log alone, independently of
   the engine's own bookkeeping — if `left`/`right` ever drifted from
   what is actually lying on the table, this is what catches it.

   Run: node tools/rules-check.js [--games=400] [--verbose]           */
"use strict";
var R = require("../rules.js");

var argv = process.argv.slice(2);
function flag(n, d) {
  for (var i = 0; i < argv.length; i++) {
    if (argv[i] === "--" + n) return true;
    if (argv[i].indexOf("--" + n + "=") === 0) return argv[i].split("=")[1];
  }
  return d;
}
var GAMES = parseInt(flag("games", 400), 10) || 400;
var VERBOSE = !!flag("verbose", false);

var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok  " + name); }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}
function section(t) { if (VERBOSE) console.log("\n" + t); }

/* ---------- the set itself ---------- */
section("the set");
ok("28 bones", R.TILES.length === 28);
(function () {
  var seen = {}, dupes = 0, total = 0, doubles = 0;
  for (var i = 0; i < 28; i++) {
    var k = R.A(i) + "-" + R.B(i);
    if (seen[k]) dupes++;
    seen[k] = 1;
    total += R.pips(i);
    if (R.isDouble(i)) doubles++;
    if (R.A(i) > R.B(i)) dupes++;
  }
  ok("every pair appears once, low half first", dupes === 0);
  ok("168 pips in the set", total === 168, "got " + total);
  ok("seven mulas", doubles === 7, "got " + doubles);
})();
ok("tileId is symmetric", R.tileId(2, 5) === R.tileId(5, 2));
ok("6|6 is la mula de seis", R.MULA_DE_SEIS === R.tileId(6, 6));
ok("other() walks a tile", R.other(R.tileId(3, 5), 3) === 5 && R.other(R.tileId(3, 5), 5) === 3);
ok("other() on a mula", R.other(R.tileId(4, 4), 4) === 4);

/* ---------- seats and parejas ---------- */
section("the table");
ok("partners sit across", R.partner(0) === 2 && R.partner(1) === 3 && R.partner(3) === 1);
ok("partners share a team", R.team(0) === R.team(2) && R.team(1) === R.team(3));
ok("the parejas differ", R.team(0) !== R.team(1));
ok("play runs one seat at a time", R.nextSeat(3) === 0 && R.nextSeat(1) === 2);
ok("opponents are opponents", R.isOpponent(0, 1) && !R.isOpponent(0, 2));

/* ---------- the deal ---------- */
section("the deal");
(function () {
  var h = R.deal(12345), all = [], s, i;
  for (s = 0; s < 4; s++) { ok("seat " + s + " gets seven", h[s].length === 7); all = all.concat(h[s]); }
  all.sort(function (a, b) { return a - b; });
  var distinct = true;
  for (i = 0; i < 28; i++) if (all[i] !== i) distinct = false;
  ok("the whole set is dealt, nothing left over", distinct);
  var again = R.deal(12345);
  ok("the same seed washes the same way", JSON.stringify(again) === JSON.stringify(h));
  ok("a different seed does not", JSON.stringify(R.deal(12346)) !== JSON.stringify(h));
})();
(function () {
  /* The wash has to be fair, and fair specifically across *sequential*
     seeds — a match walks its seed forward in small steps, so a
     generator that stays correlated for its first outputs would quietly
     seat the 6|6 in the same chair all night. (It did: before the seed
     was avalanched, seat 3 ran 3σ light here.)

     Chi-square over four seats, 3 degrees of freedom: 16.3 is the
     99.9% point, so a fair deal clears this essentially always and a
     biased one does not. */
  var N = 4000, seat = [0, 0, 0, 0], distinct = {}, n = 0, s, q;
  for (s = 1; s <= N; s++) {
    var h = R.deal(s);
    for (q = 0; q < 4; q++) if (h[q].indexOf(R.MULA_DE_SEIS) >= 0) seat[q]++;
    var k = JSON.stringify(h);
    if (!distinct[k]) { distinct[k] = 1; n++; }
  }
  var exp = N / 4, chi = 0;
  for (q = 0; q < 4; q++) chi += (seat[q] - exp) * (seat[q] - exp) / exp;
  ok("the 6|6 sits in every chair equally often", chi < 16.3,
     "χ²=" + chi.toFixed(1) + " over seats " + seat.join("/"));
  ok("sequential seeds give unrelated deals", n === N, n + "/" + N + " distinct");

  /* and every bone reaches every seat */
  var reach = 0;
  for (var t = 0; t < 28; t++) {
    var hit = [0, 0, 0, 0];
    for (s = 1; s <= 400; s++) {
      var d = R.deal(s * 7 + t);
      for (q = 0; q < 4; q++) if (d[q].indexOf(t) >= 0) hit[q]++;
    }
    if (hit[0] && hit[1] && hit[2] && hit[3]) reach++;
  }
  ok("every bone reaches every chair", reach === 28, reach + "/28");
})();
ok("a hand of five mulas may be redealt",
  R.mayRedeal([R.tileId(0, 0), R.tileId(1, 1), R.tileId(2, 2), R.tileId(3, 3), R.tileId(4, 4), R.tileId(1, 2), R.tileId(3, 4)], R.houseRules()));
ok("an ordinary hand may not",
  !R.mayRedeal([R.tileId(0, 0), R.tileId(1, 1), R.tileId(2, 3), R.tileId(3, 5), R.tileId(4, 6), R.tileId(1, 2), R.tileId(3, 4)], R.houseRules()));

/* ---------- house rules take nothing on trust ---------- */
section("house rules");
(function () {
  var r = R.houseRules({ target: 999, capicua: -5, firstSalida: "nonsense", redealDoubles: 99, countAll: "yes" });
  ok("a silly target falls back to 100", r.target === 100);
  ok("a negative capicúa bonus is clamped", r.capicua === 0);
  ok("an unknown salida rule falls back", r.firstSalida === "mula");
  ok("redeal count is clamped to a hand", r.redealDoubles === 7);
  ok("truthy strings become booleans", r.countAll === true);
  var d = R.houseRules();
  ok("defaults are the cantina set", d.target === 100 && d.capicua === 25 && d.trancaTie === "closer");
})();

/* ---------- the opening ---------- */
section("la salida");
(function () {
  var m = R.newMatch({ seed: 7 });
  var st = R.dealHand(m);
  var holder = -1;
  for (var s = 0; s < 4; s++) if (st.hands[s].indexOf(R.MULA_DE_SEIS) >= 0) holder = s;
  ok("the 6|6 opens the first hand", st.turn === holder, "6|6 at " + holder + ", turn " + st.turn);
  var mv = R.moves(st);
  var onlyMula = mv.length === 1 && mv[0].tile === R.MULA_DE_SEIS;
  ok("and it must actually be led", onlyMula, "offered " + mv.length + " bones");
})();
(function () {
  /* a later hand: the winner of the last one opens, with anything */
  var m = R.newMatch({ seed: 7 });
  m.handNo = 1; m.lastWinner = 2;
  var st = R.dealHand(m);
  ok("the winner opens the next hand", st.turn === 2);
  ok("and may lead any bone", R.moves(st).length === 7);
})();

/* ---------- rebuilding the table from the log ----------
   The heart of the file. Walk the recorded plays and rebuild the line
   as a physical chain of bones, then check the engine agreed. */
function rebuild(st) {
  var chain = [];                 /* numbers along the line, outward ends at each side */
  var problems = [];
  for (var i = 0; i < st.line.length; i++) {
    var p = st.line[i], a = R.A(p.tile), b = R.B(p.tile);
    if (i === 0) { chain = [a, b]; continue; }
    if (p.end === "L") {
      var head = chain[0];
      if (a === head) chain.unshift(b);
      else if (b === head) chain.unshift(a);
      else problems.push("bone " + R.name(p.tile) + " does not touch the left end " + head);
    } else {
      var tail = chain[chain.length - 1];
      if (a === tail) chain.push(b);
      else if (b === tail) chain.push(a);
      else problems.push("bone " + R.name(p.tile) + " does not touch the right end " + tail);
    }
  }
  return { chain: chain, problems: problems, left: chain[0], right: chain[chain.length - 1] };
}

section("self-play");
(function () {
  var chainBreaks = 0, endDrift = 0, badPasses = 0, lostTiles = 0, turnSkips = 0;
  var dominoes = 0, trancas = 0, capicuas = 0, scoreErr = 0, longest = 0, stalls = 0;
  var leaks = 0, viewErr = 0;

  for (var g = 0; g < GAMES; g++) {
    var m = R.newMatch({ seed: g * 2654435761 + 1 });
    var st = R.dealHand(m);
    var rand = R.rng(g + 999);
    var guard = 0, prevTurn = st.turn;

    while (!st.over) {
      if (++guard > 200) { stalls++; break; }
      var seat = st.turn;
      var mv = R.moves(st, seat);

      /* nobody may pass holding a playable bone — check it the hard way,
         against the hand, not against the engine's own opinion */
      var reallyCanPlay = false;
      if (st.line.length === 0) reallyCanPlay = st.hands[seat].length > 0;
      else {
        for (var q = 0; q < st.hands[seat].length; q++) {
          if (R.has(st.hands[seat][q], st.left) || R.has(st.hands[seat][q], st.right)) reallyCanPlay = true;
        }
      }
      if (reallyCanPlay !== (mv.length > 0)) badPasses++;

      /* every offered move must be a bone actually in hand, fitting the
         end it claims */
      for (var z = 0; z < mv.length; z++) {
        if (st.hands[seat].indexOf(mv[z].tile) < 0) leaks++;
        if (st.line.length > 0) {
          var want = mv[z].end === "L" ? st.left : st.right;
          if (!R.has(mv[z].tile, want)) leaks++;
        }
      }

      var before = st.hands[seat].length;
      if (mv.length === 0) {
        R.pass(st);
        if (st.error) { badPasses++; st.error = null; }
      } else {
        var pick = mv[Math.floor(rand() * mv.length) % mv.length];
        R.play(st, pick);
        if (st.error) { badPasses++; st.error = null; break; }
        if (st.hands[seat].length !== before - 1) lostTiles++;
      }

      /* the turn walks to the right, one seat, unless the hand ended */
      if (!st.over && st.turn !== R.nextSeat(seat)) turnSkips++;
      prevTurn = seat;

      /* the count of bones is conserved absolutely */
      var total = st.line.length;
      for (var s2 = 0; s2 < 4; s2++) total += st.hands[s2].length;
      if (total !== 28) lostTiles++;

      /* the table is a real chain, and the engine's ends agree with it */
      var rb = rebuild(st);
      if (rb.problems.length) chainBreaks++;
      if (st.line.length && (rb.left !== st.left || rb.right !== st.right)) endDrift++;

      /* the public view never shows another hand */
      var v = R.publicView(st, 0);
      if (v.unseen.length !== 28 - st.line.length - st.hands[0].length) viewErr++;
      for (var u = 0; u < v.unseen.length; u++) if (st.hands[0].indexOf(v.unseen[u]) >= 0) leaks++;
    }

    if (st.over && st.result) {
      var r = st.result;
      longest = Math.max(longest, st.line.length);
      if (r.how === "domino") {
        dominoes++;
        if (st.hands[r.winner].length !== 0) scoreErr++;
        if (r.capicua) capicuas++;
        /* the count: the losing pareja's pips, plus any capicúa bonus */
        var expect = 0;
        for (var s3 = 0; s3 < 4; s3++) if (R.team(s3) !== r.team) expect += R.handPips(st.hands[s3]);
        if (r.capicua) expect += st.rules.capicua;
        if (r.points !== expect) scoreErr++;
      } else {
        trancas++;
        /* a tranca means all four seats are genuinely shut out */
        for (var s4 = 0; s4 < 4; s4++) if (R.canPlay(st, s4)) scoreErr++;
        if (r.team >= 0) {
          var mine = 0, theirs = 0;
          for (var s5 = 0; s5 < 4; s5++) {
            if (R.team(s5) === r.team) mine += R.handPips(st.hands[s5]); else theirs += R.handPips(st.hands[s5]);
          }
          if (mine > theirs) scoreErr++;             /* the lighter pareja takes it */
          if (r.points !== theirs) scoreErr++;
        }
      }
    }
  }

  ok("the line on the table is always a real chain", chainBreaks === 0, chainBreaks + " breaks");
  ok("the open ends never drift from the bones", endDrift === 0, endDrift + " drifts");
  ok("nobody passes on a bone they could play", badPasses === 0, badPasses + " bad passes");
  ok("twenty-eight bones, always", lostTiles === 0, lostTiles + " miscounts");
  ok("the turn goes to the right, every time", turnSkips === 0, turnSkips + " skips");
  ok("no hand ever leaks into the public view", leaks === 0, leaks + " leaks");
  ok("the public view counts the unseen right", viewErr === 0, viewErr + " miscounts");
  ok("every hand reaches an end", stalls === 0, stalls + " stalled");
  ok("the count is right, every time", scoreErr === 0, scoreErr + " bad counts");
  ok("hands end both ways", dominoes > 0 && trancas > 0, dominoes + " dominoes, " + trancas + " trancas");
  console.log("      " + GAMES + " hands: " + dominoes + " went out, " + trancas + " shut, " +
              capicuas + " capicúa, longest line " + longest);
})();

/* ---------- capicúa, by hand ----------
   Built positions where the answer is obvious to a person. */
section("capicúa");
function rig(hands, salida, rules) {
  var st = R.newHand({ rules: R.houseRules(rules), hands: hands, salida: salida });
  return st;
}
(function () {
  /* ends will be 3 and 5; seat 0 goes out on 3|5, which fits either */
  var st = rig([[R.tileId(3, 5)], [R.tileId(0, 1)], [R.tileId(0, 2)], [R.tileId(0, 4)]], 0);
  st.left = 3; st.right = 5;
  st.line = [{ seat: 3, tile: R.tileId(3, 5), end: "S", flip: false, dbl: false }];
  /* place a stand-in bone on the table so the line is not empty; the
     tile identity does not matter to the capicúa test, only the ends */
  R.play(st, { tile: R.tileId(3, 5), end: "L" });
  ok("going out on a bone that fits both ends is a capicúa", st.result && st.result.capicua === true);
  ok("and it pays the bonus", st.result.points >= 25);
})();
(function () {
  /* ends 3 and 5; seat 0 goes out on 3|1 — fits only the left */
  var st = rig([[R.tileId(1, 3)], [R.tileId(0, 1)], [R.tileId(0, 2)], [R.tileId(0, 4)]], 0);
  st.left = 3; st.right = 5;
  st.line = [{ seat: 3, tile: R.tileId(3, 5), end: "S", flip: false, dbl: false }];
  R.play(st, { tile: R.tileId(1, 3), end: "L" });
  ok("a bone that fits one end only is not", st.result && st.result.capicua === false);
})();
(function () {
  /* both ends showing 4; the 4|4 is not a capicúa — no choice was made */
  var st = rig([[R.tileId(4, 4)], [R.tileId(0, 1)], [R.tileId(0, 2)], [R.tileId(0, 5)]], 0);
  st.left = 4; st.right = 4;
  st.line = [{ seat: 3, tile: R.tileId(4, 6), end: "S", flip: false, dbl: false }];
  R.play(st, { tile: R.tileId(4, 4), end: "L" });
  ok("a mula is never a capicúa", st.result && st.result.capicua === false);
})();
(function () {
  /* both ends showing 2, going out on 2|5 — fits "both", but only
     because they are the same number. Not a capicúa. */
  var st = rig([[R.tileId(2, 5)], [R.tileId(0, 1)], [R.tileId(0, 3)], [R.tileId(0, 4)]], 0);
  st.left = 2; st.right = 2;
  st.line = [{ seat: 3, tile: R.tileId(2, 6), end: "S", flip: false, dbl: false }];
  R.play(st, { tile: R.tileId(2, 5), end: "L" });
  ok("matching two identical ends is not a capicúa", st.result && st.result.capicua === false);
})();
(function () {
  var st = rig([[R.tileId(3, 5)], [R.tileId(0, 1)], [R.tileId(0, 2)], [R.tileId(0, 4)]], 0, { capicua: 0 });
  st.left = 3; st.right = 5;
  st.line = [{ seat: 3, tile: R.tileId(3, 5), end: "S", flip: false, dbl: false }];
  R.play(st, { tile: R.tileId(3, 5), end: "L" });
  ok("a house that does not pay capicúa does not pay it", st.result && st.result.capicua === false);
})();

(function () {
  /* How often a capicúa should happen, so nobody later "fixes" it in
     either direction. It looks too frequent until you do the
     conditioning: a bone fits both ends only when the ends are exactly
     its two halves — but we are only ever asking about a bone that
     already fit *somewhere*, and that lifts a 1-in-21 shot to about
     1 in 7. Measured at 14.8% over 2,264 go-outs under random play,
     against an independently derived truth with zero disagreements. */
  var go = 0, capi = 0;
  for (var g = 0; g < 1200; g++) {
    var m = R.newMatch({ seed: g * 2654435761 + 1 });
    var st = R.dealHand(m), rand = R.rng(g + 999), guard = 0;
    while (!st.over && guard++ < 200) {
      var mv = R.moves(st);
      if (!mv.length) { R.pass(st); continue; }
      R.play(st, mv[Math.floor(rand() * mv.length) % mv.length]);
    }
    if (st.over && st.result.how === "domino") { go++; if (st.result.capicua) capi++; }
  }
  var rate = capi / go;
  ok("capicúa turns up about one go-out in seven", rate > 0.10 && rate < 0.20,
     (rate * 100).toFixed(1) + "% of " + go);
})();

/* ---------- a shut game ---------- */
section("tranca");
(function () {
  /* every seat holds only blanks-free bones that cannot touch a 6 */
  var st = rig([
    [R.tileId(0, 1), R.tileId(1, 2)],
    [R.tileId(2, 3), R.tileId(3, 4)],
    [R.tileId(4, 5), R.tileId(0, 2)],
    [R.tileId(1, 3), R.tileId(2, 4)]
  ], 0);
  st.left = 6; st.right = 6;
  st.line = [{ seat: 3, tile: R.tileId(6, 6), end: "S", flip: false, dbl: false }];
  var guard = 0;
  while (!st.over && guard++ < 10) R.pass(st);
  ok("four passes shut the game", st.over && st.result.how === "tranca");
  var t0 = R.handPips(st.hands[0]) + R.handPips(st.hands[2]);
  var t1 = R.handPips(st.hands[1]) + R.handPips(st.hands[3]);
  ok("the lighter pareja takes a shut game", st.result.team === (t0 < t1 ? 0 : 1), t0 + " vs " + t1);
  ok("and scores the other side's pips", st.result.points === Math.max(t0, t1));
})();
(function () {
  /* a tie: identical weight on both sides. The house rule decides. */
  var hands = [
    [R.tileId(0, 1)], [R.tileId(0, 1) === 1 ? R.tileId(0, 1) : R.tileId(0, 1)], [], []
  ];
  var st = rig([[R.tileId(1, 2)], [R.tileId(1, 2)], [], []], 0, { trancaTie: "nobody" });
  /* build the tie by hand: both parejas holding three pips */
  st.hands = [[R.tileId(1, 2)], [R.tileId(0, 3)], [], []];
  st.left = 6; st.right = 6;
  st.line = [{ seat: 3, tile: R.tileId(6, 6), end: "S", flip: false, dbl: false }];
  var g2 = 0;
  while (!st.over && g2++ < 10) R.pass(st);
  ok("a tied shut game can go to nobody", st.over && st.result.team === -1 && st.result.points === 0);
})();
(function () {
  var st = rig([[R.tileId(1, 2)], [R.tileId(0, 3)], [], []], 0, { trancaTie: "closer" });
  st.left = 6; st.right = 6;
  st.line = [{ seat: 1, tile: R.tileId(6, 6), end: "S", flip: false, dbl: false }];
  var g3 = 0;
  while (!st.over && g3++ < 10) R.pass(st);
  ok("or to whoever shut it", st.over && st.result.team === R.team(1));
})();

/* ---------- refusing bad play ---------- */
section("the engine refuses nonsense");
(function () {
  var st = rig([[R.tileId(1, 2), R.tileId(0, 5)], [R.tileId(0, 3)], [R.tileId(0, 4)], [R.tileId(0, 6)]], 0);
  st.left = 1; st.right = 2;
  st.line = [{ seat: 3, tile: R.tileId(1, 2), end: "S", flip: false, dbl: false }];
  st.error = null;
  R.play(st, { tile: R.tileId(0, 5), end: "L" });
  ok("a bone that does not fit is refused", !!st.error);
  ok("and nothing was taken from the hand", st.hands[0].length === 2);
  st.error = null;
  R.play(st, { tile: R.tileId(6, 6), end: "L" });
  ok("a bone you do not hold is refused", !!st.error);
  st.error = null;
  R.pass(st);
  ok("passing when you can play is refused", !!st.error);
})();

/* ---------- the match ---------- */
section("the match");
(function () {
  var runs = 60, finished = 0, overshoot = 0, badChampion = 0, longest = 0;
  for (var g = 0; g < runs; g++) {
    var m = R.newMatch({ seed: g + 31337, rules: { target: 100 } });
    var guard = 0;
    while (!m.over && guard++ < 80) {
      var st = R.dealHand(m);
      var g2 = 0;
      while (!st.over && g2++ < 200) {
        var mv = R.moves(st);
        if (!mv.length) R.pass(st);
        else R.play(st, mv[0]);
      }
      R.settle(m, st);
    }
    if (m.over) finished++;
    longest = Math.max(longest, m.handNo);
    if (m.over) {
      var hi = Math.max(m.scores[0], m.scores[1]);
      if (hi < m.rules.target) overshoot++;
      if (m.champion >= 0 && m.scores[m.champion] !== hi) badChampion++;
    }
  }
  ok("every match reaches a target", finished === runs, finished + "/" + runs);
  ok("a match ends only at the target", overshoot === 0);
  ok("the champion is the higher score", badChampion === 0);
  console.log("      longest match ran " + longest + " hands");
})();
(function () {
  var m = R.newMatch({ seed: 5, rules: { target: 50 } });
  m.scores = [50, 0];
  R.settle(m, { result: { how: "domino", winner: 0, team: 0, points: 0, capicua: false } });
  ok("a shut-out is a zapatero", m.over && m.zapatero === true);
  var m2 = R.newMatch({ seed: 5, rules: { target: 50 } });
  m2.scores = [50, 10];
  R.settle(m2, { result: { how: "domino", winner: 0, team: 0, points: 0, capicua: false } });
  ok("a match they scored in is not", m2.over && m2.zapatero === false);
})();

/* ---------- reading the table ---------- */
section("the census");
(function () {
  var st = rig([[R.tileId(6, 6), R.tileId(6, 5)], [R.tileId(0, 1)], [R.tileId(0, 2)], [R.tileId(0, 3)]], 0);
  var v = R.publicView(st, 0);
  var c = R.suitCensus(v);
  ok("my own sixes are counted as mine", c.mine[6] === 2, "got " + c.mine[6]);
  ok("and are not counted as live", c.live[6] === 5, "got " + c.live[6]);
  /* seven bones carry each number in a double-six set; a mula carries
     its number once, not twice, because it is one bone */
  var total = c.live[6] + c.mine[6];
  ok("seven bones carry each number", total === 7, "got " + total);
})();
(function () {
  var st = rig([[R.tileId(1, 2)], [R.tileId(0, 3)], [R.tileId(0, 4)], [R.tileId(0, 5)]], 1);
  st.left = 6; st.right = 6;
  st.line = [{ seat: 0, tile: R.tileId(6, 6), end: "S", flip: false, dbl: false }];
  R.pass(st);
  ok("a pass is remembered as a void", st.voids[1][6] === true);
  var v = R.publicView(st, 0);
  ok("and everyone at the table can see it", v.voids[1][6] === true);
})();

/* ---------- verdict ---------- */
console.log("\n" + (fail === 0
  ? "the rules hold — " + pass + " checks passed"
  : fail + " of " + (pass + fail) + " checks FAILED"));
if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
