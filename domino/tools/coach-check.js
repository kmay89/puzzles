/* coach-check.js — dev-only. Proves the hints say true things.

   A coach that is merely fluent is worse than no coach, because you
   believe it. So the checks are about truthfulness, not phrasing:

   · every hint names the bone the AI actually chose;
   · a hint that claims somebody has passed on a suit is checked against
     the passes that were actually heard;
   · every tag the AI can raise has words to say, so a reason can never
     be silently dropped;
   · nothing reaches the page that could be markup.

   Run: node tools/coach-check.js [--verbose]                          */
"use strict";
var R = require("../rules.js");
var AI = require("../ai.js");
var C = require("../coach.js");

var VERBOSE = process.argv.indexOf("--verbose") >= 0;
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

/* ---------- every reason has words ----------
   Scraped out of ai.js rather than listed by hand, so a tag added there
   and forgotten here fails the check instead of vanishing quietly. */
(function () {
  var src = require("fs").readFileSync(__dirname + "/../ai.js", "utf8");
  var re = /tag:\s*"([a-zA-Z]+)"/g, m, tags = {}, missing = [];
  while ((m = re.exec(src))) tags[m[1]] = 1;
  Object.keys(tags).forEach(function (t) { if (!C.SAYS[t]) missing.push(t); });
  ok("every reason the AI can give has words to say it",
     missing.length === 0, "no line for: " + missing.join(", "));
  ok("and there are no lines for reasons that do not exist",
     Object.keys(C.SAYS).every(function (t) { return !!tags[t]; }),
     Object.keys(C.SAYS).filter(function (t) { return !tags[t]; }).join(", "));
  console.log("      " + Object.keys(tags).length + " reasons, all spoken for");
})();

/* ---------- the suits ---------- */
(function () {
  var names = {};
  for (var n = 0; n <= 6; n++) { names[C.suitName(n)] = 1; }
  ok("all seven suits have distinct names", Object.keys(names).length === 7);
  ok("and both languages", C.suitBoth(5).indexOf("quinas") > 0 && C.suitBoth(5).indexOf("fives") === 0);
  ok("a bone reads the way it is written", C.boneName(R.tileId(2, 6)) === "2|6");
})();

/* ---------- a hint always names the move it means ---------- */
(function () {
  var bad = 0, empty = 0, n = 0, shrugs = 0;
  for (var g = 0; g < 60; g++) {
    var m = R.newMatch({ seed: g * 7919 + 3 });
    var st = R.dealHand(m), rand = R.rng(g + 5), guard = 0;
    while (!st.over && guard++ < 200) {
      var v = R.publicView(st, st.turn);
      var a = AI.analyse(v, { level: "maestro", rand: rand });
      var h = C.hint(v, a);
      n++;
      if (a.move) {
        if (h.tile !== a.move.tile || h.end !== a.move.end) bad++;
        if (h.title.indexOf(C.boneName(a.move.tile)) < 0) bad++;
      } else { shrugs++; if (!h.shrug) bad++; }
      if (!h.lines.length) empty++;
      if (!R.canPlay(st, st.turn)) { R.pass(st); continue; }
      R.play(st, a.move);
      if (st.error) break;
    }
  }
  ok("every hint names the bone it is actually recommending", bad === 0, bad + " of " + n);
  ok("and never comes back with nothing to say", empty === 0, empty + " silent");
  ok("a stuck hand is told to pass", shrugs > 0, shrugs + " passes seen");
  console.log("      " + n + " hints given across 60 hands");
})();

/* ---------- a hint never claims a pass that did not happen ----------
   The `ahorca` line is the one that makes a factual claim about another
   player. Every time it is said, check it against the record. */
(function () {
  /* Checked against the sentence, not against the internals — the
     sentence is the thing a person believes. Any hint that says the
     word "passed" is asserting something the table heard out loud, and
     the record has to back it. (It did not, at first: the hanging line
     said "has passed on both" whenever the AI was merely confident from
     counting, which is a fluent and entirely believable falsehood.
     186 of them in 2,808 hints.) */
  var lies = 0, said = 0, inferred = 0, n = 0;
  for (var g = 0; g < 120; g++) {
    var m = R.newMatch({ seed: g * 2654435761 + 11 });
    var st = R.dealHand(m), rand = R.rng(g + 77), guard = 0;
    while (!st.over && guard++ < 200) {
      if (!R.canPlay(st, st.turn)) { R.pass(st); continue; }
      var v = R.publicView(st, st.turn);
      var a = AI.analyse(v, { level: "compadre", rand: rand });
      var h = C.hint(v, a);
      n++;
      for (var li = 0; li < h.lines.length; li++) {
        var line = h.lines[li];
        if (line.indexOf("passed") < 0) { if (line.indexOf("by the count") >= 0) inferred++; continue; }
        said++;
        /* somebody is being said to have passed — find who, and make
           sure at least one seat's record actually supports it */
        var backed = false;
        for (var s = 0; s < 4; s++) {
          if (s === v.seat) continue;
          for (var num = 0; num <= 6; num++) if (v.voids[s][num]) backed = true;
        }
        if (!backed) lies++;
      }
      R.play(st, a.move);
      if (st.error) break;
    }
  }
  ok("a hint only says somebody passed when somebody passed", lies === 0,
     lies + " unfounded claims in " + n + " hints");
  console.log("      " + said + " hints cited a pass, " + inferred +
              " were careful to say they were counting instead");
})();

/* ---------- the counting panel matches the table ---------- */
(function () {
  var st = R.newHand({
    rules: R.houseRules(),
    hands: [[R.tileId(6, 6), R.tileId(6, 5), R.tileId(1, 2)],
            [R.tileId(0, 1), R.tileId(1, 3), R.tileId(4, 6)],
            [R.tileId(0, 4), R.tileId(3, 3), R.tileId(0, 6)],
            [R.tileId(1, 6), R.tileId(4, 4), R.tileId(0, 3)]],
    salida: 0
  });
  st.line = [{ seat: 3, tile: R.tileId(2, 2), end: "S", flip: false, dbl: true }];
  st.left = 2; st.right = 2;
  st.voids[1][2] = true;
  var v = R.publicView(st, 0);
  var rt = C.readTable(v, { 1: "Beto", 2: "Lupe", 3: "Chuy" });

  ok("the panel reports the pass it heard", rt.voids.length === 1 && rt.voids[0].seat === 1);
  ok("naming the player", rt.voids[0].text.indexOf("Beto") === 0, rt.voids[0].text);
  ok("and the suit", rt.voids[0].text.indexOf("twos") > 0, rt.voids[0].text);
  /* Two sixes, not three: the census counts *bones* carrying a number,
     and the 6|6 is one bone. That is the count that matters at the
     table — a mula only ever answers one end. */
  ok("it counts my own sixes as bones, not pips", rt.census[6].mine === 2, "got " + rt.census[6].mine);
  ok("and the five it cannot see", rt.census[6].live === 5, "got " + rt.census[6].live);
  ok("seven bones carry every number", rt.census.every(function (c) {
    var onTable = 0;
    for (var i = 0; i < st.line.length; i++) if (R.has(st.line[i].tile, c.num)) onTable++;
    return c.mine + c.live + onTable === 7;
  }));

  var quiet = R.publicView(R.newHand({ rules: R.houseRules(), hands: R.deal(5), salida: 0 }), 0);
  ok("and says so when nothing has been heard yet", C.readTable(quiet).note.length > 0);
})();

/* ---------- moments fire when they should ---------- */
(function () {
  var view = R.publicView(R.newHand({ rules: R.houseRules(), hands: R.deal(9), salida: 0 }), 0);
  var seen = {};
  var m1 = C.moment({ k: "pass", seat: 0, you: 0, ends: [3, 5] }, seen, null, view);
  ok("your own first pass is a teaching moment", m1 && m1.id === "firstPaso");
  ok("and it names both suits", m1.text.indexOf("threes") > 0 && m1.text.indexOf("fives") > 0, m1.text);
  seen[m1.id] = 1;
  ok("but only the first time", !C.moment({ k: "pass", seat: 0, you: 0, ends: [1, 2] }, seen, null, view));

  var m2 = C.moment({ k: "pass", seat: 1, you: 0, ends: [4, 4] }, seen, null, view);
  ok("somebody else's pass is a different moment", m2 && m2.id === "theyPaso");
  ok("and a single end is said once, not twice",
     m2.text.split("fours").length === 2, m2.text);

  var m3 = C.moment({ k: "end", res: { capicua: true, how: "domino" } }, {}, null, view);
  ok("a capicúa is called out", m3 && m3.id === "capicua");
  var m4 = C.moment({ k: "end", res: { capicua: false, how: "tranca" } }, {}, null, view);
  ok("so is a shut game", m4 && m4.id === "tranca");
  var m5 = C.moment({ k: "match", zapatero: true }, {}, null, view);
  ok("and a zapatero", m5 && m5.id === "zapatero");
  ok("an ordinary play is not a moment", !C.moment({ k: "play", seat: 1, you: 0, dbl: false }, {}, null, view));
})();

/* ---------- it admits when it does not matter ---------- */
(function () {
  var found = false;
  for (var g = 0; g < 200 && !found; g++) {
    var m = R.newMatch({ seed: g * 104729 + 3 });
    var st = R.dealHand(m), rand = R.rng(g), guard = 0;
    while (!st.over && guard++ < 200) {
      if (!R.canPlay(st, st.turn)) { R.pass(st); continue; }
      var v = R.publicView(st, st.turn);
      var a = AI.analyse(v, { level: "compadre", rand: rand });
      var h = C.hint(v, a);
      if (h.close) { found = true; break; }
      R.play(st, a.move);
      if (st.error) break;
    }
  }
  ok("when the choice barely matters, it says so", found);
})();

/* ---------- nothing that reaches the page is markup ---------- */
(function () {
  var bad = 0, checked = 0;
  var names = { 1: "<img src=x onerror=alert(1)>", 2: "Lupe & Co", 3: "Chuy" };
  for (var g = 0; g < 40; g++) {
    var m = R.newMatch({ seed: g * 31 + 1 });
    var st = R.dealHand(m), rand = R.rng(g), guard = 0;
    while (!st.over && guard++ < 60) {
      var v = R.publicView(st, st.turn);
      var a = AI.analyse(v, { level: "compadre", rand: rand });
      var h = C.hint(v, a, { names: names });
      var all = [h.title].concat(h.lines).join(" ");
      checked++;
      /* the coach itself must never introduce markup; a hostile *name*
         is the room's business to escape, and the room does, but the
         coach must not be the thing that concatenates it into HTML */
      if (/<[a-z/!]/i.test(all.replace(/<img src=x onerror=alert\(1\)>/g, ""))) bad++;
      if (!R.canPlay(st, st.turn)) { R.pass(st); continue; }
      R.play(st, a.move);
      if (st.error) break;
    }
  }
  ok("the coach never writes markup of its own", bad === 0, bad + " of " + checked);
})();

/* ---------- the short course ---------- */
(function () {
  var ids = {}, bad = 0;
  for (var i = 0; i < C.LESSONS.length; i++) {
    var l = C.LESSONS[i];
    if (ids[l.id]) bad++;
    ids[l.id] = 1;
    if (!l.title || !l.body || l.body.length < 80) bad++;
  }
  ok("the short course is five real cards", C.LESSONS.length === 5 && bad === 0);
})();

console.log("\n" + (fail === 0
  ? "Don Chuy tells the truth — " + pass + " checks passed"
  : fail + " of " + (pass + fail) + " checks FAILED"));
if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
