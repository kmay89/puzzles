/* badges.js — the wall.

   Thirty-two things worth noticing, as one flat table. A badge is a row
   with a `check(p, ev)` that reads the profile and the thing that just
   happened; nothing else in the app knows badges exist beyond calling
   `Badges.review(profile, event)` after something interesting.

   Adding one should mean appending a row here — never an `if` somewhere
   in the game. Ordering is roughly the order a player will meet them.

   No libraries. Browser (window.Badges) and node (module.exports). */
(function (root) {
"use strict";

/* Event shapes the checks may see:
     {type:"solve", level, band, tier, ms, hints, mistakes, undos,
      pencil, zen, daily, unaided}
     {type:"hint", tech}
     {type:"master", tech}
     {type:"forge", attempts, band}
     {type:"lesson", tech, unaided}
     {type:"open", what}                     */

function solves(p) {
  var n = 0;
  for (var k in p.solves) n += p.solves[k];
  return n;
}
function mastered(p, n) {
  var c = 0;
  for (var k in p.mastery) if (p.mastery[k] >= 3) c++;
  return c >= (n || 1);
}
function allOf(p, list, level) {
  return list.every(function (t) { return (p.mastery[t] || 0) >= (level || 3); });
}
function hour(ev) { return (ev.at ? new Date(ev.at) : new Date()).getHours(); }

var BADGES = [
  { id: "firstLight", name: "First light", glyph: "✦",
    note: "Finish your first puzzle.",
    check: function (p, ev) { return ev.type === "solve"; } },

  { id: "steadyHand", name: "Steady hand", glyph: "▤",
    note: "Finish a Steady puzzle.",
    check: function (p, ev) { return ev.type === "solve" && ev.tier >= 1; } },

  { id: "trickyCustomer", name: "Tricky customer", glyph: "◈",
    note: "Finish a Tricky puzzle.",
    check: function (p, ev) { return ev.type === "solve" && ev.tier >= 2; } },

  { id: "deviousMind", name: "Devious mind", glyph: "◆",
    note: "Finish a Devious puzzle.",
    check: function (p, ev) { return ev.type === "solve" && ev.tier >= 3; } },

  { id: "diabolist", name: "Diabolist", glyph: "✧",
    note: "Finish a Diabolical puzzle.",
    check: function (p, ev) { return ev.type === "solve" && ev.tier >= 4; } },

  { id: "unaided", name: "Unaided", glyph: "○",
    note: "Finish a puzzle without asking for a single hint.",
    check: function (p, ev) { return ev.type === "solve" && !ev.hints; } },

  { id: "spotless", name: "Spotless", glyph: "◇",
    note: "Finish a puzzle without a single wrong digit.",
    check: function (p, ev) { return ev.type === "solve" && !ev.mistakes; } },

  { id: "cleanSweep", name: "Clean sweep", glyph: "◉",
    note: "Finish a Tricky or harder with no hints and no mistakes.",
    check: function (p, ev) { return ev.type === "solve" && ev.tier >= 2 && !ev.hints && !ev.mistakes; } },

  { id: "brisk", name: "Brisk", glyph: "↯",
    note: "Finish a Gentle puzzle inside three minutes.",
    check: function (p, ev) { return ev.type === "solve" && ev.tier === 0 && ev.ms < 180000; } },

  { id: "unhurried", name: "Unhurried", glyph: "⌛",
    note: "Spend more than half an hour on one puzzle — and finish it.",
    check: function (p, ev) { return ev.type === "solve" && ev.ms > 1800000; } },

  { id: "inTheDark", name: "In the dark", glyph: "☾",
    note: "Finish a Diabolical without hints. Very few people do this.",
    check: function (p, ev) { return ev.type === "solve" && ev.tier >= 4 && !ev.hints; } },

  { id: "fifty", name: "Fifty", glyph: "L",
    note: "Fifty puzzles finished.",
    check: function (p) { return solves(p) >= 50; } },

  { id: "century", name: "Century", glyph: "C",
    note: "A hundred puzzles finished.",
    check: function (p) { return solves(p) >= 100; } },

  { id: "everyBand", name: "The whole range", glyph: "▦",
    note: "Finish at least one puzzle in every band.",
    check: function (p) {
      return ["gentle", "steady", "tricky", "devious", "diabolical"]
        .every(function (b) { return (p.solves[b] || 0) > 0; });
    } },

  { id: "daily1", name: "Today's paper", glyph: "▣",
    note: "Finish a daily puzzle.",
    check: function (p, ev) { return ev.type === "solve" && ev.daily; } },

  { id: "streak7", name: "Seven days", glyph: "❊",
    note: "Finish the daily seven days running.",
    check: function (p) { return (p.streak && p.streak.n) >= 7; } },

  { id: "streak30", name: "A month of mornings", glyph: "❋",
    note: "Finish the daily thirty days running.",
    check: function (p) { return (p.streak && p.streak.n) >= 30; } },

  { id: "fullWeek", name: "Monday to Sunday", glyph: "⊞",
    note: "Finish a daily on all seven weekdays.",
    check: function (p) {
      var days = p.dailyDays || {};
      for (var d = 0; d < 7; d++) if (!days[d]) return false;
      return true;
    } },

  { id: "nightOwl", name: "Night owl", glyph: "◐",
    note: "Finish a puzzle between midnight and four in the morning.",
    check: function (p, ev) { return ev.type === "solve" && hour(ev) < 4; } },

  { id: "dawnChorus", name: "Dawn chorus", glyph: "◑",
    note: "Finish a puzzle between five and seven in the morning.",
    check: function (p, ev) { return ev.type === "solve" && hour(ev) >= 5 && hour(ev) < 7; } },

  { id: "zenGarden", name: "Zen", glyph: "◍",
    note: "Finish a puzzle in Zen mode — no clock, no red ink.",
    check: function (p, ev) { return ev.type === "solve" && ev.zen; } },

  { id: "pencilled", name: "Pencilled in", glyph: "✎",
    note: "Finish a puzzle having written pencil marks in it.",
    check: function (p, ev) { return ev.type === "solve" && ev.pencil > 0; } },

  { id: "inTheHead", name: "All in the head", glyph: "◌",
    note: "Finish a Tricky or harder without writing a single pencil mark.",
    check: function (p, ev) { return ev.type === "solve" && ev.tier >= 2 && !ev.pencil; } },

  { id: "noTakeBacks", name: "No take-backs", glyph: "→",
    note: "Finish a Devious or harder without using undo.",
    check: function (p, ev) { return ev.type === "solve" && ev.tier >= 3 && !ev.undos; } },

  { id: "student", name: "Student", glyph: "✒",
    note: "Meet five techniques.",
    check: function (p) {
      var n = 0;
      for (var k in p.mastery) if (p.mastery[k] >= 1) n++;
      return n >= 5;
    } },

  { id: "scholar", name: "Scholar", glyph: "❧",
    note: "Meet every technique in the codex.",
    check: function (p, ev, ctx) {
      var n = 0;
      for (var k in p.mastery) if (p.mastery[k] >= 1) n++;
      return n >= (ctx && ctx.techCount ? ctx.techCount : 19);
    } },

  { id: "firstMastery", name: "Yours now", glyph: "★",
    note: "Master a technique: finish three puzzles that needed it, without hints.",
    check: function (p) { return mastered(p, 1); } },

  { id: "patternHunter", name: "Pattern hunter", glyph: "✶",
    note: "Master five techniques.",
    check: function (p) { return mastered(p, 5); } },

  { id: "chainWalker", name: "Chain walker", glyph: "⟡",
    note: "Master simple colouring, the Y-Wing and the XYZ-Wing.",
    check: function (p) { return allOf(p, ["colouring", "yWing", "xyzWing"]); } },

  { id: "fishmonger", name: "Fishmonger", glyph: "⌇",
    note: "Master the X-Wing, the Swordfish and the Jellyfish.",
    check: function (p) { return allOf(p, ["xWing", "swordfish", "jellyfish"]); } },

  { id: "blacksmith", name: "Blacksmith", glyph: "⚒",
    note: "Watch a puzzle forged from a blank grid, all the way to its verdict.",
    check: function (p, ev) { return ev.type === "forge"; } },

  { id: "picky", name: "Picky", glyph: "⟲",
    note: "Watch the forge throw away twenty grids before it is satisfied.",
    check: function (p, ev) { return ev.type === "forge" && ev.attempts >= 20; } }
];

var BY_ID = {};
for (var i = 0; i < BADGES.length; i++) BY_ID[BADGES[i].id] = BADGES[i];

/* Award anything newly true. Returns the list of freshly earned badges
   so the room can show them one at a time. */
function review(profile, ev, ctx) {
  var won = [];
  profile.badges = profile.badges || {};
  for (var i = 0; i < BADGES.length; i++) {
    var b = BADGES[i];
    if (profile.badges[b.id]) continue;
    var got = false;
    try { got = !!b.check(profile, ev || {}, ctx || {}); } catch (e) { got = false; }
    if (got) { profile.badges[b.id] = Date.now(); won.push(b); }
  }
  return won;
}

function earned(profile) {
  var n = 0;
  for (var k in (profile.badges || {})) if (BY_ID[k]) n++;
  return n;
}

var Badges = { LIST: BADGES, BY_ID: BY_ID, review: review, earned: earned, count: BADGES.length };
if (typeof module !== "undefined" && module.exports) module.exports = Badges;
else root.Badges = Badges;
})(typeof self !== "undefined" ? self : this);
