/* coach.js — Don Chuy, who has sat at that table for forty years.

   The hint you are shown is the actual reason the machine chose the
   move. `ai.js` records why it liked a play, as tags, while it is
   deciding; this file turns those tags into sentences. Nothing here
   invents a justification after the fact — if the AI did not have a
   reason, the coach has nothing to say, and says that instead.

   Don Chuy is not a tutorial. He does not explain the rules; the game
   does that by only letting you do legal things. What he explains is
   the part nobody can see: that seat 2 has been out of fives since the
   third bone, that the mula you are nursing is about to become dead
   weight, that opening the sixes hands your partner nothing.

   His voice: short, warm, certain. He tells you what he sees, not what
   to feel about it. He never scolds, and when a play genuinely does not
   matter he says so rather than manufacturing a lesson — a coach who
   finds something profound in every move teaches you to stop
   listening.                                                          */
(function (root) {
"use strict";

var R = (typeof require === "function" && typeof module !== "undefined")
  ? require("./rules.js") : root.Rules;
var AI = (typeof require === "function" && typeof module !== "undefined")
  ? require("./ai.js") : root.AI;

/* ---------- the suits have names ----------
   At the table nobody says "the fives". Both names are offered so the
   room can teach one with the other. */
var SUIT = [
  { n: 0, es: "blancas",  en: "blanks" },
  { n: 1, es: "ases",     en: "ones" },
  { n: 2, es: "duques",   en: "twos" },
  { n: 3, es: "tercias",  en: "threes" },
  { n: 4, es: "cuartas",  en: "fours" },
  { n: 5, es: "quinas",   en: "fives" },
  { n: 6, es: "senas",    en: "sixes" }
];
function suit(n) { return SUIT[n] || SUIT[0]; }
function suitName(n) { return suit(n).en; }
function suitBoth(n) { return suit(n).en + " (" + suit(n).es + ")"; }
function boneName(t) { return R.A(t) + "|" + R.B(t); }

/* seat names come from the room; the coach only needs a way to say
   "you", "your partner", or a name */
function who(view, seat, names) {
  if (seat === view.seat) return "you";
  var nm = names && names[seat];
  if (seat === R.partner(view.seat)) return nm ? nm + ", your partner," : "your partner";
  return nm || "the player on your " + (seat === R.nextSeat(view.seat) ? "right" : "left");
}

/* ---------- the tags, as sentences ----------
   One row per tag the AI can raise. Adding a new reason to `ai.js`
   means adding a row here, not a branch anywhere.

   `rank` orders what gets said first when a move has several reasons —
   a person leads with the shutting-out and mentions the weight after,
   never the other way round. */
var SAYS = {
  domino: {
    rank: 0,
    say: function () { return "This one goes out. Put it down and say it — ¡dominó!"; }
  },
  ahorca: {
    rank: 1,
    /* Two different claims live here and they must not be confused.
       "They passed on it" is something the table heard; "they are
       probably out of it" is something we worked out from the count.
       The first is a fact and the second is an inference, and saying
       the second in the words of the first is a lie — a quiet, fluent,
       believable one, which is the worst kind for a coach to tell. */
    say: function (w, view, names) {
      var heard = view.voids[w.seat][w.a] && view.voids[w.seat][w.b];
      var ends = "It leaves the ends on " + suitName(w.a) +
        (w.a === w.b ? " at both ends" : " and " + suitName(w.b)) + ", and ";
      if (heard) {
        return ends + who(view, w.seat, names) + " has passed on " +
          (w.a === w.b ? "that" : "both") + " — they cannot answer it.";
      }
      var p = Math.round(w.p * 100);
      return ends + "by the count " + who(view, w.seat, names) +
        " is short there — about " + p + " in 100 they pass.";
    }
  },
  bothEnds: {
    rank: 2,
    say: function (w) {
      return "Both ends end up showing " + suitName(w.num) + ". Only " +
        (w.live === 0 ? "bones already down" : w.live + " unseen " + (w.live === 1 ? "bone" : "bones")) +
        " can answer that, so the table narrows sharply.";
    }
  },
  hurtsMate: {
    rank: 3,
    say: function (w, view, names) {
      var heard = view.voids[w.seat][w.a] || view.voids[w.seat][w.b];
      return "Careful — this is the sort of play that leaves " + who(view, w.seat, names) +
        " with nothing. " + (heard ? "They have passed on that already."
                                   : "By the count they are thin there.");
    }
  },
  selfStuck: {
    rank: 4,
    say: function () { return "Watch yourself: after this you hold nothing that answers either end."; }
  },
  control: {
    rank: 5,
    say: function (w) {
      return "You keep the ends you are long in — " + w.n + " bones in hand still answer " +
        suitName(w.a) + " or " + suitName(w.b) + ". That is how you stay in charge of the line.";
    }
  },
  shedMula: {
    rank: 6,
    say: function (w) {
      return "Doubles are the hardest to place — only one number will ever take them. " +
        "Play the " + w.num + "|" + w.num + " while the " + suitName(w.num) + " are still open.";
    }
  },
  heavy: {
    rank: 7,
    say: function (w) {
      return "It is heavy — " + w.pips + " pips. If the game shuts, that is " + w.pips +
        " points handed to the other side.";
    }
  }
};

/* ---------- the hint ----------
   `analysis` is whatever `AI.analyse` returned for this view. The coach
   adds nothing to it; it reads it. */
function hint(view, analysis, opts) {
  opts = opts || {};
  var names = opts.names;
  if (!analysis || analysis.stuck || !analysis.move) {
    return {
      move: null,
      title: "Nothing fits — say paso.",
      lines: ["You hold nothing carrying " + suitName(view.left) +
              (view.left === view.right ? "" : " or " + suitName(view.right)) +
              ". Pass, and remember that the whole table just learned it too."],
      shrug: true
    };
  }

  var best = analysis.best, mv = analysis.move;
  var lines = [], used = {}, i;
  var why = (best && best.why) ? best.why.slice() : [];
  why.sort(function (a, b) {
    var ra = SAYS[a.tag] ? SAYS[a.tag].rank : 99, rb = SAYS[b.tag] ? SAYS[b.tag].rank : 99;
    if (ra !== rb) return ra - rb;
    return Math.abs(b.w) - Math.abs(a.w);
  });
  for (i = 0; i < why.length && lines.length < 3; i++) {
    var row = SAYS[why[i].tag];
    if (!row || used[why[i].tag]) continue;
    /* a reason the move was scored *down* for is not a reason to play
       it — it is a caveat, and only worth saying if it survived */
    if (why[i].w < 0 && lines.length === 0) continue;
    used[why[i].tag] = 1;
    lines.push(row.say(why[i], view, names));
  }

  /* When it genuinely does not matter, say so. A coach that finds a
     lesson in every move teaches you to stop reading them. */
  var close = analysis.margin < 4 && analysis.ranked.length > 1;
  if (!lines.length) {
    lines.push(close
      ? "Honestly — any of these is fine here. Play the heavy one and move on."
      : "Nothing clever about it; it is the bone that fits.");
  } else if (close) {
    lines.push("Mind you, it is close. The next-best play is barely behind.");
  }

  return {
    move: mv,
    tile: mv.tile,
    end: mv.end,
    title: "Play the " + boneName(mv.tile) + (view.left < 0 ? "" :
      " on the " + (mv.end === "L" ? "left" : "right")) + ".",
    lines: lines,
    close: close,
    shrug: false
  };
}

/* ---------- what the table has told us ----------
   The counting panel. This is the information a lifelong player is
   holding in their head and a new player does not know exists, so the
   room can simply show it. */
function readTable(view, names) {
  var out = { voids: [], census: [], unseen: view.unseen.length, note: "" };
  var rd = AI.reads(view), i;
  for (i = 0; i < rd.length; i++) {
    var r = rd[i], words = [];
    for (var k = 0; k < r.voids.length; k++) words.push(suitName(r.voids[k]));
    out.voids.push({
      seat: r.seat,
      mate: r.mate,
      nums: r.voids,
      text: who(view, r.seat, names) + " has no " + list(words) + "."
    });
  }
  var cen = R.suitCensus(view);
  for (var n = 0; n <= 6; n++) {
    out.census.push({ num: n, mine: cen.mine[n], live: cen.live[n], name: suitName(n) });
  }
  if (!out.voids.length) out.note = "Nobody has passed yet — nothing to read off the table so far.";
  return out;
}
function list(a) {
  if (!a.length) return "";
  if (a.length === 1) return a[0];
  if (a.length === 2) return a[0] + " and " + a[1];
  return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}

/* ---------- moments ----------
   Things worth saying out loud when they happen, once each. The room
   keeps the "seen" set; the coach only decides what the line is.

   One row per moment. `when` is checked against a small event object,
   never against game state directly, so a new moment cannot accidentally
   depend on something the coach should not know. */
var MOMENTS = [
  { id: "firstPaso", once: true,
    when: function (e) { return e.k === "pass" && e.seat === e.you; },
    say: function (e) {
      return "You just told the whole table something. Everyone now knows you hold no " +
        suitName(e.ends[0]) + (e.ends[0] === e.ends[1] ? "" : " and no " + suitName(e.ends[1])) +
        " — and they will remember it for the rest of the hand. So will you, about them.";
    } },
  { id: "theyPaso", once: true,
    when: function (e) { return e.k === "pass" && e.seat !== e.you; },
    say: function (e, names, view) {
      return who(view, e.seat, names) + " is out of " + suitName(e.ends[0]) +
        (e.ends[0] === e.ends[1] ? "" : " and " + suitName(e.ends[1])) +
        ". Keep those ends showing and they will keep passing. That is called ahorcar — hanging them.";
    } },
  { id: "capicua", once: false,
    when: function (e) { return e.k === "end" && e.res.capicua; },
    say: function () {
      return "¡Capicúa! You went out on a bone that would have gone down at either end. " +
        "It reads the same from both sides, like the word does — and it pays extra.";
    } },
  { id: "tranca", once: false,
    when: function (e) { return e.k === "end" && e.res.how === "tranca"; },
    say: function () {
      return "Trancado — the game is shut, nobody can move. Now it is only weight that counts, " +
        "which is why you shed the heavy bones early.";
    } },
  { id: "firstMula", once: true,
    when: function (e) { return e.k === "play" && e.seat === e.you && e.dbl; },
    say: function (e) {
      return "Good — the mulas are the bones that strand you. Only the " +
        suitName(R.A(e.tile)) + " will ever take that one.";
    } },
  { id: "zapatero", once: false,
    when: function (e) { return e.k === "match" && e.zapatero; },
    say: function () {
      return "Zapatero — they never scored once. Traditionally that costs them the next round of drinks.";
    } }
];

function moment(e, seen, names, view) {
  for (var i = 0; i < MOMENTS.length; i++) {
    var m = MOMENTS[i];
    if (m.once && seen && seen[m.id]) continue;
    var hit = false;
    try { hit = m.when(e); } catch (err) { hit = false; }
    if (hit) return { id: m.id, once: m.once, text: m.say(e, names, view) };
  }
  return null;
}

/* ---------- the short course ----------
   Five cards. Not a rulebook — the five things that separate somebody
   who knows the rules from somebody who can play, in the order they
   become useful. Shown on request, and one is offered at the end of a
   hand you lost badly. */
var LESSONS = [
  { id: "count", title: "Twenty-eight bones, and no pile",
    body: "Four hands of seven. Nothing is drawn and nothing is held back, so every bone " +
          "you cannot see is in somebody's hand. Seven bones carry each number. Count the " +
          "ones you hold and the ones on the table, and what is left is not a mystery — it is arithmetic." },
  { id: "paso", title: "A pass is the loudest thing said all night",
    body: "When somebody passes, they have neither open number, and they will never have them. " +
          "That is permanent information about a quarter of the table. Note it. The room notes it " +
          "for you in the counting panel until you are noting it yourself." },
  { id: "ahorca", title: "Hanging them — ahorcar",
    body: "If the player after you has passed on fives, put a five back on the end. They pass again, " +
          "and the turn comes round to you having cost them a move. Do it on both ends at once and " +
          "they are hung: nothing they hold can touch the table." },
  { id: "pareja", title: "You are not playing alone",
    body: "Your partner sits across from you and their points are your points. Your first bone tells " +
          "them what you are long in — lead your strongest suit and they will feed it back to you. " +
          "And never open a number your partner has passed on; you are hanging your own side." },
  { id: "peso", title: "Weight is a debt",
    body: "If the game shuts, whatever you are still holding is counted and handed to the other side. " +
          "A 6|6 in your hand at the end is thirteen points you paid for keeping. Shed the heavy " +
          "bones early, while you still have a choice about it." }
];

var Coach = {
  SUIT: SUIT, suitName: suitName, suitBoth: suitBoth, boneName: boneName,
  SAYS: SAYS, MOMENTS: MOMENTS, LESSONS: LESSONS,
  hint: hint, readTable: readTable, moment: moment, list: list, who: who
};
if (typeof module !== "undefined" && module.exports) module.exports = Coach;
else root.Coach = Coach;
})(typeof self !== "undefined" ? self : this);
