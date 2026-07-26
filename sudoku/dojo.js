/* dojo.js — the codex, the lessons, and what "learning a technique"
   actually means here.

   A technique passes through four states, and each one has to be earned
   by doing something real:

     unmet      you have not seen it. The codex shows the name and the
                band it belongs to, nothing else.
     met        you have read it, or the room used it in a hint. The
                idea, the picture and the practice position open up.
     practised  you found it yourself in a lesson, without being shown.
     mastered   you finished three puzzles that genuinely needed it,
                unaided. The room stops offering to explain it.

   Nothing is gated behind money, an account, or a wait. The only lock
   in the building is the difficulty ladder, and even that has a door
   marked "let me in anyway".

   Lessons come from lessons.js: real positions, replayed by the real
   solver. See tools/make-lessons.js.

   No libraries. Browser (window.Dojo) and node (module.exports). */
(function (root) {
"use strict";

var isNode = (typeof module !== "undefined" && module.exports);
var S = isNode ? require("./core.js") : root.Sudoku;
var Strat = isNode ? require("./strategies.js") : root.Strat;
var Forge = isNode ? require("./forge.js") : root.Forge;
var LESSONS = isNode ? require("./lessons.js") : (root.LESSONS || {});

var STATES = ["unmet", "met", "practised", "mastered"];
var STATE_NAME = ["not yet met", "met", "practised", "mastered"];

/* ---------- the profile ----------
   One object, saved as JSON, holding everything the room remembers.
   It is small on purpose: a player should be able to read their own
   save file and recognise their week in it. */
function blankProfile() {
  return {
    v: 1,
    xp: 0,
    solves: { gentle: 0, steady: 0, tricky: 0, devious: 0, diabolical: 0 },
    best: {},                 // band -> best milliseconds
    mastery: {},              // techId -> 0..3
    credit: {},               // techId -> unaided solves that needed it
    badges: {},               // badgeId -> when
    streak: { n: 0, best: 0, last: null },
    dailyDone: {},            // date key -> ms
    dailyDays: {},            // weekday 0..6 -> 1
    forced: {},               // band -> the player insisted
    totals: { solved: 0, hints: 0, mistakes: 0, ms: 0, forged: 0, lessons: 0 },
    seen: {}                  // one-shot flags for coaching
  };
}

/* Old saves are welcome; anything missing is filled in rather than
   thrown away. */
function reviveProfile(raw) {
  var p = blankProfile();
  if (!raw || typeof raw !== "object") return p;
  Object.keys(p).forEach(function (k) {
    if (raw[k] === undefined) return;
    if (typeof p[k] === "object" && p[k] !== null && !Array.isArray(p[k])) {
      Object.keys(raw[k] || {}).forEach(function (kk) { p[k][kk] = raw[k][kk]; });
    } else p[k] = raw[k];
  });
  return p;
}

/* ---------- mastery ---------- */
function level(profile, techId) { return profile.mastery[techId] || 0; }
function raise(profile, techId, to) {
  var now = level(profile, techId);
  if (to > now) { profile.mastery[techId] = to; return true; }
  return false;
}
function meet(profile, techId) { return raise(profile, techId, 1); }
function practise(profile, techId) { return raise(profile, techId, 2); }

/* Three unaided finishes of puzzles that needed it. Credit only counts
   when you did not ask for a hint on that puzzle — otherwise the room
   would be handing out mastery for its own work. */
function credit(profile, techId) {
  profile.credit[techId] = (profile.credit[techId] || 0) + 1;
  if (level(profile, techId) < 1) raise(profile, techId, 1);
  if (profile.credit[techId] >= 3) return raise(profile, techId, 3);
  return false;
}
function countAt(profile, atLeast) {
  var n = 0;
  Strat.TECHS.forEach(function (t) { if (level(profile, t.id) >= atLeast) n++; });
  return n;
}

/* ---------- the ladder ----------
   Two finishes of a band open the next one. The lock is a suggestion,
   not a wall: `force` opens anything, and the room says so out loud. */
function unlocked(profile, bandId) {
  var levels = Forge.LEVELS, idx = -1;
  for (var i = 0; i < levels.length; i++) if (levels[i].id === bandId) idx = i;
  if (idx <= 0) return true;
  if (profile.forced[bandId]) return true;
  var prev = levels[idx - 1].id;
  return (profile.solves[prev] || 0) >= 2;
}
function force(profile, bandId) { profile.forced[bandId] = 1; }

/* ---------- rank ----------
   Titles, not numbers, because a number is not a thing to be proud of.
   The xp behind them is deliberately gentle: nobody is being farmed. */
var RANKS = [
  { at: 0, name: "Newcomer", note: "everyone starts at the door" },
  { at: 80, name: "Regular", note: "the chair is yours now" },
  { at: 250, name: "Reader of grids", note: "you see where digits *cannot* go" },
  { at: 600, name: "Pattern hunter", note: "pairs and triples leap out" },
  { at: 1200, name: "Chain walker", note: "you can hold a hypothesis and walk it" },
  { at: 2400, name: "Roomkeeper", note: "nothing here surprises you any more" },
  { at: 5000, name: "Lamplighter", note: "you could have built the place" }
];
function rank(profile) {
  var xp = profile.xp || 0, cur = RANKS[0], next = null;
  for (var i = 0; i < RANKS.length; i++) {
    if (xp >= RANKS[i].at) cur = RANKS[i];
    else { next = RANKS[i]; break; }
  }
  return {
    name: cur.name, note: cur.note, xp: xp, next: next,
    progress: next ? (xp - cur.at) / (next.at - cur.at) : 1
  };
}

/* What a finished puzzle is worth. Hints are not punished — they are
   how you learn — they simply do not earn the unaided bonus. */
function xpFor(ev) {
  var base = [12, 22, 40, 70, 110][ev.tier || 0] || 12;
  var x = base;
  if (!ev.hints) x = Math.round(x * 1.5);
  if (!ev.mistakes) x += 8;
  if (ev.daily) x += 20;
  if (ev.zen) x = Math.round(x * 0.8);      // zen is for the pleasure of it
  return x;
}

/* ---------- lessons ----------
   A lesson is a real position replayed by the real solver, so what the
   Dojo shows you is exactly what the room would say mid-game. */
function lessonCount(techId) { return (LESSONS[techId] || []).length; }

function lesson(techId, n) {
  var list = LESSONS[techId] || [];
  if (!list.length) return null;
  var L = list[((n || 0) % list.length + list.length) % list.length];
  var g = S.fromString(L.puzzle);
  if (!g) return null;
  var st = Strat.state(g);
  for (var i = 0; i < L.skip; i++) {
    var step = Strat.nextStep(st, null);
    if (!step) return null;
    Strat.apply(st, step);
  }
  var here = Strat.BY_ID[techId].find(st);
  if (!here) return null;
  here.name = Strat.BY_ID[techId].name;
  return {
    tech: Strat.BY_ID[techId], state: st, step: here,
    puzzle: L.puzzle, skip: L.skip, index: ((n || 0) % list.length + list.length) % list.length,
    count: list.length,
    /* `alt` means a simpler move exists on this board too. Saying so is
       the difference between teaching and misleading. */
    alsoSimpler: !!L.alt
  };
}

/* Everything the codex needs to draw itself. */
function codex(profile) {
  return Strat.TECHS.map(function (t) {
    return {
      id: t.id, name: t.name, tier: t.tier, cost: t.cost,
      idea: t.idea, hint: t.hint,
      band: Strat.TIERS[t.tier],
      state: level(profile, t.id),
      stateName: STATE_NAME[level(profile, t.id)],
      credit: profile.credit[t.id] || 0,
      lessons: lessonCount(t.id)
    };
  });
}

var Dojo = {
  STATES: STATES, STATE_NAME: STATE_NAME, RANKS: RANKS,
  blankProfile: blankProfile, reviveProfile: reviveProfile,
  level: level, meet: meet, practise: practise, credit: credit, countAt: countAt,
  unlocked: unlocked, force: force, rank: rank, xpFor: xpFor,
  lesson: lesson, lessonCount: lessonCount, codex: codex
};

if (isNode) module.exports = Dojo;
else root.Dojo = Dojo;
})(typeof self !== "undefined" ? self : this);
