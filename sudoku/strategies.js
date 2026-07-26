/* strategies.js — how a person solves a sudoku, written down.

   Nineteen named techniques, from "the last empty square in a row" to
   unique rectangles, ordered exactly the way a human learns them. Each
   one is a row in the TECHS table below and each one answers the same
   question: *given this grid, what is the next thing anybody could
   honestly work out?*

   Every technique returns a step, and a step is a small explainable
   object — the cells the pattern lives in, the units it uses, what it
   places, what it rules out, the links to draw between cells, and a
   sentence in plain words. The board draws the step; the margin reads
   the sentence; the codex quotes the technique's `idea`; the grader
   counts which ones a puzzle needs. One description, four uses.

   Soundness is not assumed. tools/selftest.js solves thousands of
   generated puzzles and checks every single elimination against the
   brute-force answer from core.js: if a technique ever rules out the
   digit that actually belongs there, the run fails loudly.

   No libraries. Browser (window.Strat) and node (module.exports). */
(function (root) {
"use strict";

var S = (typeof module !== "undefined" && module.exports) ? require("./core.js") : root.Sudoku;
var BIT = S.BIT, N = S.N, CELLS = S.CELLS;

/* ---------- small helpers ---------- */

/* All k-subsets of 0..n-1, computed once. Units are nine cells, so the
   biggest table here is tiny (126 entries) and the subset techniques
   can just loop over it. */
var COMBOS = {};
function combos(n, k) {
  var key = n + ":" + k;
  if (COMBOS[key]) return COMBOS[key];
  var out = [], cur = [];
  (function rec(start) {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (var i = start; i < n; i++) { cur.push(i); rec(i + 1); cur.pop(); }
  })(0);
  COMBOS[key] = out;
  return out;
}

function state(grid) {
  var g = S.clone(grid);
  return { g: g, c: S.candidates(g) };
}
function stateFrom(grid, cands) { return { g: S.clone(grid), c: new Uint16Array(cands) }; }

function emptyCells(st, u) {
  var un = S.UNITS[u], out = [];
  for (var j = 0; j < N; j++) if (!st.g[un[j]]) out.push(un[j]);
  return out;
}
/* Where digit d could still go inside unit u. */
function placesFor(st, u, d) {
  var un = S.UNITS[u], b = BIT[d], out = [];
  for (var j = 0; j < N; j++) {
    var i = un[j];
    if (st.g[i] === d) return null;          // already placed here: nothing to say
    if (!st.g[i] && (st.c[i] & b)) out.push(i);
  }
  return out;
}
/* Cells that see every one of `set` — the reach of a pattern. */
function commonPeers(set) {
  var out = [];
  for (var i = 0; i < CELLS; i++) {
    var ok = true;
    for (var k = 0; k < set.length; k++) if (!S.sees(i, set[k])) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}
/* Eliminations of `mask` from everything that sees all of `set`. */
function elimsSeeingAll(st, set, mask) {
  var peers = commonPeers(set), out = [];
  for (var k = 0; k < peers.length; k++) {
    var i = peers[k];
    if (st.g[i]) continue;
    var hit = st.c[i] & mask;
    if (hit) {
      var ds = S.digits(hit);
      for (var q = 0; q < ds.length; q++) out.push({ i: i, d: ds[q] });
    }
  }
  return out;
}
/* Which units hold every cell of `set` — used to say "…and they share
   box 4 as well", which is where half a pattern's power comes from. */
function sharedUnits(set) {
  var out = [];
  for (var u = 0; u < S.UNITS.length; u++) {
    var un = S.UNITS[u], all = true;
    for (var k = 0; k < set.length; k++) if (un.indexOf(set[k]) < 0) { all = false; break; }
    if (all) out.push(u);
  }
  return out;
}
function names(list) { return list.map(S.cellName).join(", "); }
function andList(list) {
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}
function digitList(mask) { return andList(S.digits(mask).map(String)); }

var ORDINAL = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/* ---------- the techniques ----------
   Each `find` gets the live state and returns a step or null. They are
   tried in table order, so "the next step" is always the simplest thing
   available — which is what makes the grader's verdict mean something. */

function fullHouse(st) {
  for (var u = 0; u < S.UNITS.length; u++) {
    var es = emptyCells(st, u);
    if (es.length !== 1) continue;
    var i = es[0], d = S.onlyDigit(st.c[i]);
    if (!d) continue;
    return {
      tech: "fullHouse", place: [{ i: i, d: d }], elim: [],
      focus: [i], ctx: S.UNITS[u].filter(function (x) { return x !== i; }), units: [u], digits: [d],
      text: S.unitName(u) + " has one square left, so " + S.cellName(i) + " must be the missing " + d + "."
    };
  }
  return null;
}

function nakedSingle(st) {
  for (var i = 0; i < CELLS; i++) {
    if (st.g[i]) continue;
    var d = S.onlyDigit(st.c[i]);
    if (!d) continue;
    return {
      tech: "nakedSingle", place: [{ i: i, d: d }], elim: [],
      focus: [i], ctx: S.PEERS[i].filter(function (p) { return st.g[p]; }), units: S.UNITS_OF[i], digits: [d],
      text: "Everything except " + d + " already appears in the row, column or box of " +
        S.cellName(i) + ", so " + d + " is the only digit left for it."
    };
  }
  return null;
}

function hiddenSingle(st) {
  for (var u = 0; u < S.UNITS.length; u++) {
    for (var d = 1; d <= N; d++) {
      var ps = placesFor(st, u, d);
      if (!ps || ps.length !== 1) continue;
      var i = ps[0];
      if (S.popcount(st.c[i]) === 1) continue;   // that is a naked single; keep the names honest
      return {
        tech: "hiddenSingle", place: [{ i: i, d: d }], elim: [],
        focus: [i], ctx: S.UNITS[u].filter(function (x) { return x !== i; }), units: [u], digits: [d],
        text: "In " + S.unitName(u) + ", " + d + " has only one square left to live in — " +
          S.cellName(i) + " — even though that square could hold other digits too."
      };
    }
  }
  return null;
}

/* Pointing: inside a box, a digit is confined to one row or column, so
   it leaves that line alone everywhere else. */
function pointing(st) {
  for (var b = 18; b < 27; b++) {
    for (var d = 1; d <= N; d++) {
      var ps = placesFor(st, b, d);
      if (!ps || ps.length < 2) continue;
      for (var axis = 0; axis < 2; axis++) {
        var key = axis ? S.COL : S.ROW, same = true;
        for (var k = 1; k < ps.length; k++) if (key[ps[k]] !== key[ps[0]]) { same = false; break; }
        if (!same) continue;
        var line = (axis ? N : 0) + key[ps[0]], elim = [];
        var un = S.UNITS[line];
        for (var j = 0; j < N; j++) {
          var i = un[j];
          if (st.g[i] || ps.indexOf(i) >= 0) continue;
          if (st.c[i] & BIT[d]) elim.push({ i: i, d: d });
        }
        if (!elim.length) continue;
        return {
          tech: "pointing", place: [], elim: elim,
          focus: ps, ctx: [], units: [b, line], digits: [d],
          text: "In " + S.unitName(b) + ", every remaining " + d + " sits in " + S.unitName(line) +
            " (" + names(ps) + "). The box must have its " + d + " somewhere, so the rest of " +
            S.unitName(line) + " cannot."
        };
      }
    }
  }
  return null;
}

/* Claiming: the mirror image — inside a line, a digit is confined to
   one box, so it leaves the rest of that box alone. */
function claiming(st) {
  for (var u = 0; u < 18; u++) {
    for (var d = 1; d <= N; d++) {
      var ps = placesFor(st, u, d);
      if (!ps || ps.length < 2) continue;
      var same = true;
      for (var k = 1; k < ps.length; k++) if (S.BOX[ps[k]] !== S.BOX[ps[0]]) { same = false; break; }
      if (!same) continue;
      var box = 18 + S.BOX[ps[0]], elim = [], un = S.UNITS[box];
      for (var j = 0; j < N; j++) {
        var i = un[j];
        if (st.g[i] || ps.indexOf(i) >= 0) continue;
        if (st.c[i] & BIT[d]) elim.push({ i: i, d: d });
      }
      if (!elim.length) continue;
      return {
        tech: "claiming", place: [], elim: elim,
        focus: ps, ctx: [], units: [u, box], digits: [d],
        text: S.unitName(u) + " keeps its " + d + " inside " + S.unitName(box) + " (" + names(ps) +
          "), so the " + d + " of that box is spoken for and the rest of the box gives it up."
      };
    }
  }
  return null;
}

/* Naked subsets: k cells in a unit sharing exactly k digits between
   them. Those digits belong to those cells, whatever the order. */
function nakedSubset(k) {
  return function (st) {
    for (var u = 0; u < S.UNITS.length; u++) {
      var cs = emptyCells(st, u);
      if (cs.length <= k) continue;
      var picks = combos(cs.length, k);
      for (var p = 0; p < picks.length; p++) {
        var set = [], mask = 0, ok = true;
        for (var q = 0; q < k; q++) {
          var i = cs[picks[p][q]];
          if (S.popcount(st.c[i]) < 2) { ok = false; break; }
          set.push(i); mask |= st.c[i];
        }
        if (!ok || S.popcount(mask) !== k) continue;
        var elim = elimsSeeingAll(st, set, mask);
        if (!elim.length) continue;
        var shared = sharedUnits(set);
        return {
          tech: "naked" + k, place: [], elim: elim,
          focus: set, ctx: [], units: shared, digits: S.digits(mask),
          text: names(set) + " between them hold only " + digitList(mask) + " — " + ORDINAL[k] +
            " squares for " + ORDINAL[k] + " digits. Whatever the order, those digits are used up " +
            (shared.length > 1 ? "in " + andList(shared.map(S.unitName)) : "in " + S.unitName(shared[0])) + "."
        };
      }
    }
    return null;
  };
}

/* Hidden subsets: k digits in a unit that have nowhere to go except
   the same k cells. Those cells belong to those digits — so whatever
   else they were dreaming of is struck out. */
function hiddenSubset(k) {
  return function (st) {
    for (var u = 0; u < S.UNITS.length; u++) {
      var pos = {}, ds = [];
      for (var d = 1; d <= N; d++) {
        var ps = placesFor(st, u, d);
        if (ps && ps.length >= 2 && ps.length <= k) { pos[d] = ps; ds.push(d); }
      }
      if (ds.length < k) continue;
      var picks = combos(ds.length, k);
      for (var p = 0; p < picks.length; p++) {
        var cellSet = [], mask = 0, dl = [];
        for (var q = 0; q < k; q++) {
          var dd = ds[picks[p][q]]; dl.push(dd); mask |= BIT[dd];
          var pp = pos[dd];
          for (var z = 0; z < pp.length; z++) if (cellSet.indexOf(pp[z]) < 0) cellSet.push(pp[z]);
        }
        if (cellSet.length !== k) continue;
        var elim = [];
        for (var w = 0; w < cellSet.length; w++) {
          var extra = st.c[cellSet[w]] & ~mask;
          var es = S.digits(extra);
          for (var y = 0; y < es.length; y++) elim.push({ i: cellSet[w], d: es[y] });
        }
        if (!elim.length) continue;
        cellSet.sort(function (a, b) { return a - b; });
        return {
          tech: "hidden" + k, place: [], elim: elim,
          focus: cellSet, ctx: [], units: [u], digits: dl,
          text: "In " + S.unitName(u) + ", " + andList(dl.map(String)) + " have nowhere left but " +
            names(cellSet) + ". " + ORDINAL[k].charAt(0).toUpperCase() + ORDINAL[k].slice(1) +
            " digits filling " + ORDINAL[k] + " squares leaves no room for anything else in them."
        };
      }
    }
    return null;
  };
}

/* Fish: k lines where a digit has at most k homes, and those homes use
   only k crossing lines. k = 2 is an X-Wing, 3 a Swordfish, 4 a
   Jellyfish — one idea, three famous names. */
var FISH_NAME = { 2: "an X-Wing", 3: "a Swordfish", 4: "a Jellyfish" };
function fish(k) {
  var id = k === 2 ? "xWing" : k === 3 ? "swordfish" : "jellyfish";
  return function (st) {
    for (var d = 1; d <= N; d++) {
      for (var axis = 0; axis < 2; axis++) {
        var baseOff = axis ? N : 0, crossKey = axis ? S.ROW : S.COL;
        var lines = [], posList = [];
        for (var L = 0; L < N; L++) {
          var ps = placesFor(st, baseOff + L, d);
          if (ps && ps.length >= 2 && ps.length <= k) { lines.push(baseOff + L); posList.push(ps); }
        }
        if (lines.length < k) continue;
        var picks = combos(lines.length, k);
        for (var p = 0; p < picks.length; p++) {
          var cross = [], cells = [], baseUnits = [];
          for (var q = 0; q < k; q++) {
            var idx = picks[p][q]; baseUnits.push(lines[idx]);
            var pp = posList[idx];
            for (var z = 0; z < pp.length; z++) {
              cells.push(pp[z]);
              if (cross.indexOf(crossKey[pp[z]]) < 0) cross.push(crossKey[pp[z]]);
            }
          }
          if (cross.length !== k) continue;
          var elim = [], crossUnits = [];
          for (var w = 0; w < cross.length; w++) {
            var cu = (axis ? 0 : N) + cross[w];
            crossUnits.push(cu);
            var un = S.UNITS[cu];
            for (var j = 0; j < N; j++) {
              var i = un[j];
              if (st.g[i] || cells.indexOf(i) >= 0) continue;
              if (st.c[i] & BIT[d]) elim.push({ i: i, d: d });
            }
          }
          if (!elim.length) continue;
          return {
            tech: id, place: [], elim: elim,
            focus: cells, ctx: [], units: baseUnits.concat(crossUnits), digits: [d],
            text: FISH_NAME[k].charAt(0).toUpperCase() + FISH_NAME[k].slice(1) + " on " + d +
              ": in " + andList(baseUnits.map(S.unitName)) +
              " the " + d + " can only sit in " + andList(crossUnits.map(S.unitName)) +
              ". Those " + ORDINAL[k] + " crossing lines get their " + d + " from these lines alone, " +
              "so every other square in them gives the " + d + " up."
          };
        }
      }
    }
    return null;
  };
}

/* Y-Wing (XY-Wing): a hinge of two candidates and two arms that each
   share one of them, both ending in the same third digit. Whichever
   way the hinge falls, that third digit lands in one arm — so anything
   seeing both arms loses it. */
function yWing(st) {
  for (var pivot = 0; pivot < CELLS; pivot++) {
    if (st.g[pivot] || S.popcount(st.c[pivot]) !== 2) continue;
    var arms = [], ps = S.PEERS[pivot];
    for (var k = 0; k < ps.length; k++) {
      var a = ps[k];
      if (!st.g[a] && S.popcount(st.c[a]) === 2 && S.popcount(st.c[a] & st.c[pivot]) === 1) arms.push(a);
    }
    for (var x = 0; x < arms.length; x++) for (var y = x + 1; y < arms.length; y++) {
      var A = arms[x], B = arms[y];
      var shareA = st.c[A] & st.c[pivot], shareB = st.c[B] & st.c[pivot];
      if (shareA === shareB) continue;
      var common = st.c[A] & st.c[B];
      if (S.popcount(common) !== 1) continue;
      var d = S.onlyDigit(common);
      if (st.c[pivot] & BIT[d]) continue;
      var elim = [], peers = commonPeers([A, B]);
      for (var z = 0; z < peers.length; z++) {
        var i = peers[z];
        if (st.g[i] || i === pivot) continue;
        if (st.c[i] & BIT[d]) elim.push({ i: i, d: d });
      }
      if (!elim.length) continue;
      return {
        tech: "yWing", place: [], elim: elim,
        focus: [pivot, A, B], ctx: [], units: [], digits: [d],
        links: [{ a: pivot, b: A, d: S.onlyDigit(shareA), strong: true },
                { a: pivot, b: B, d: S.onlyDigit(shareB), strong: true }],
        text: "A Y-Wing hinged on " + S.cellName(pivot) + " (" + digitList(st.c[pivot]) + "): if it is " +
          S.onlyDigit(shareA) + " then " + S.cellName(B) + " is " + d + "; if it is " + S.onlyDigit(shareB) +
          " then " + S.cellName(A) + " is " + d + ". Either way a " + d + " lands in one of the arms, so " +
          "no square seeing both can be " + d + "."
      };
    }
  }
  return null;
}

/* XYZ-Wing: the same shape, but the hinge itself also holds the third
   digit — so the elimination must see all three cells, not just the
   arms. */
function xyzWing(st) {
  for (var pivot = 0; pivot < CELLS; pivot++) {
    if (st.g[pivot] || S.popcount(st.c[pivot]) !== 3) continue;
    var arms = [], ps = S.PEERS[pivot];
    for (var k = 0; k < ps.length; k++) {
      var a = ps[k];
      if (!st.g[a] && S.popcount(st.c[a]) === 2 && (st.c[a] & st.c[pivot]) === st.c[a]) arms.push(a);
    }
    for (var x = 0; x < arms.length; x++) for (var y = x + 1; y < arms.length; y++) {
      var A = arms[x], B = arms[y];
      if ((st.c[A] | st.c[B]) !== st.c[pivot]) continue;
      var common = st.c[A] & st.c[B];
      if (S.popcount(common) !== 1) continue;
      var d = S.onlyDigit(common), elim = [], peers = commonPeers([pivot, A, B]);
      for (var z = 0; z < peers.length; z++) {
        var i = peers[z];
        if (st.g[i]) continue;
        if (st.c[i] & BIT[d]) elim.push({ i: i, d: d });
      }
      if (!elim.length) continue;
      return {
        tech: "xyzWing", place: [], elim: elim,
        focus: [pivot, A, B], ctx: [], units: [], digits: [d],
        links: [{ a: pivot, b: A, d: d, strong: false }, { a: pivot, b: B, d: d, strong: false }],
        text: "An XYZ-Wing: " + S.cellName(pivot) + " holds " + digitList(st.c[pivot]) + " and its arms " +
          S.cellName(A) + " and " + S.cellName(B) + " each hold " + d + " with one of the others. One of " +
          "the three is a " + d + ", so any square seeing all three loses it."
      };
    }
  }
  return null;
}

/* Simple colouring: for one digit, follow the units where it has just
   two homes. That builds a chain of "if here, not there" — colour it
   alternately and two things can happen: a colour meets itself (it is
   false everywhere), or an outsider sees both colours (one of them is
   true, so the outsider is not). */
function strongLinks(st, d) {
  var links = [];
  for (var u = 0; u < S.UNITS.length; u++) {
    var ps = placesFor(st, u, d);
    if (ps && ps.length === 2) links.push({ a: ps[0], b: ps[1], u: u });
  }
  return links;
}
function simpleColour(st) {
  for (var d = 1; d <= N; d++) {
    var links = strongLinks(st, d);
    if (links.length < 2) continue;
    var adj = {};
    for (var k = 0; k < links.length; k++) {
      (adj[links[k].a] || (adj[links[k].a] = [])).push(links[k].b);
      (adj[links[k].b] || (adj[links[k].b] = [])).push(links[k].a);
    }
    var colour = {}, seen = {};
    for (var startKey in adj) {
      var start = +startKey;
      if (seen[start]) continue;
      var comp = [], queue = [start], bipartite = true;
      colour[start] = 1; seen[start] = 1;
      while (queue.length) {
        var cur = queue.shift(); comp.push(cur);
        var nb = adj[cur];
        for (var z = 0; z < nb.length; z++) {
          if (!seen[nb[z]]) { seen[nb[z]] = 1; colour[nb[z]] = -colour[cur]; queue.push(nb[z]); }
          else if (colour[nb[z]] === colour[cur]) bipartite = false;
        }
      }
      /* An odd cycle of strong links cannot happen on a legal grid, but
         if one ever did the two colours would be nonsense — so say
         nothing rather than something unsound. */
      if (!bipartite || comp.length < 4) continue;
      var A = comp.filter(function (i) { return colour[i] === 1; });
      var B = comp.filter(function (i) { return colour[i] === -1; });
      var chainLinks = links.filter(function (L) { return comp.indexOf(L.a) >= 0; })
        .map(function (L) { return { a: L.a, b: L.b, d: d, strong: true }; });

      /* Rule 2 — a colour sees itself, so every cell of that colour is false. */
      for (var side = 0; side < 2; side++) {
        var group = side ? B : A, clash = null;
        for (var p = 0; p < group.length && !clash; p++)
          for (var q = p + 1; q < group.length; q++)
            if (S.sees(group[p], group[q])) { clash = [group[p], group[q]]; break; }
        if (!clash) continue;
        var elim2 = group.map(function (i) { return { i: i, d: d }; });
        return {
          tech: "colouring", place: [], elim: elim2,
          focus: clash, ctx: comp, units: [], digits: [d], links: chainLinks,
          text: "Following the " + d + "s through the squares where they have only two homes, the chain " +
            "paints " + S.cellName(clash[0]) + " and " + S.cellName(clash[1]) + " the same colour — but " +
            "they see each other, so both cannot be " + d + ". That colour is false everywhere."
        };
      }

      /* Rule 4 — an outsider that sees both colours cannot hold the digit. */
      var elim4 = [];
      for (var i = 0; i < CELLS; i++) {
        if (st.g[i] || comp.indexOf(i) >= 0 || !(st.c[i] & BIT[d])) continue;
        var hitA = false, hitB = false, w;
        for (w = 0; w < A.length && !hitA; w++) if (S.sees(i, A[w])) hitA = true;
        for (w = 0; w < B.length && !hitB; w++) if (S.sees(i, B[w])) hitB = true;
        if (hitA && hitB) elim4.push({ i: i, d: d });
      }
      if (elim4.length) {
        return {
          tech: "colouring", place: [], elim: elim4,
          focus: comp, ctx: [], units: [], digits: [d], links: chainLinks,
          text: "A chain of " + d + "s alternates true and false along its whole length, so one of the two " +
            "colours is the real one. " + names(elim4.map(function (e) { return e.i; })) +
            " can see both colours, and so cannot be " + d + " whichever way the chain falls."
        };
      }
    }
  }
  return null;
}

/* Unique Rectangle (type 1). Four cells in two rows, two columns and
   exactly two boxes, three of them holding the very same pair: if the
   fourth also held only that pair, the puzzle would have two answers
   that swap around the rectangle. A puzzle with one answer forbids it,
   so the fourth cell keeps only its extras.

   This is the one technique that reasons about the *puzzle* rather than
   the grid, and the room labels it as such. */
function uniqueRect(st) {
  for (var r1 = 0; r1 < N; r1++) for (var r2 = r1 + 1; r2 < N; r2++) {
    for (var c1 = 0; c1 < N; c1++) for (var c2 = c1 + 1; c2 < N; c2++) {
      var cells = [r1 * N + c1, r1 * N + c2, r2 * N + c1, r2 * N + c2];
      /* Exactly two boxes is the whole condition: with one box the
         pattern could never appear in any solution, and with four the
         swap can collide with digits elsewhere in those boxes. */
      var boxes = {}, nb = 0, ok = true;
      for (var k = 0; k < 4; k++) {
        if (st.g[cells[k]]) { ok = false; break; }
        if (!boxes[S.BOX[cells[k]]]) { boxes[S.BOX[cells[k]]] = 1; nb++; }
      }
      if (!ok || nb !== 2) continue;
      for (var odd = 0; odd < 4; odd++) {
        var pair = 0, good = true;
        for (var q = 0; q < 4; q++) {
          if (q === odd) continue;
          if (S.popcount(st.c[cells[q]]) !== 2) { good = false; break; }
          if (!pair) pair = st.c[cells[q]];
          else if (st.c[cells[q]] !== pair) { good = false; break; }
        }
        if (!good) continue;
        var roof = cells[odd];
        if ((st.c[roof] & pair) !== pair || S.popcount(st.c[roof]) <= 2) continue;
        var elim = S.digits(pair).map(function (d) { return { i: roof, d: d }; });
        return {
          tech: "uniqueRect", place: [], elim: elim,
          focus: cells, ctx: [], units: [], digits: S.digits(pair),
          text: "Three corners of the rectangle " + names(cells) + " hold exactly " + digitList(pair) +
            ". If the fourth did too, those digits could swap round the rectangle and the puzzle would " +
            "have two answers. It has one — so " + S.cellName(roof) + " is neither " + digitList(pair) + "."
        };
      }
    }
  }
  return null;
}

/* BUG+1. If every unsolved square but one is down to two candidates,
   and every digit appears exactly twice in every unit, the grid has an
   even number of ways to finish — never exactly one. The odd square out
   must take the digit that breaks the symmetry. */
function bugPlusOne(st) {
  var tri = -1, i, d, u;
  for (i = 0; i < CELLS; i++) {
    if (st.g[i]) continue;
    var n = S.popcount(st.c[i]);
    if (n === 2) continue;
    if (n === 3 && tri < 0) { tri = i; continue; }
    return null;
  }
  if (tri < 0) return null;
  /* Every unit must show every unplaced digit exactly twice — except
     the three units through the odd square, where exactly one digit
     (the same one each time) shows three times. Checking all 27 is the
     difference between a sound placement and a lucky one. */
  var extra = 0, triUnits = S.UNITS_OF[tri];
  for (u = 0; u < S.UNITS.length; u++) {
    var isTri = triUnits.indexOf(u) >= 0, found = 0;
    for (d = 1; d <= N; d++) {
      var ps = placesFor(st, u, d);
      if (!ps) continue;                       // digit already placed in this unit
      if (ps.length === 2) continue;
      if (isTri && !found && ps.length === 3 && (st.c[tri] & BIT[d]) && ps.indexOf(tri) >= 0) {
        found = d; continue;
      }
      return null;                             // not a BUG pattern after all
    }
    if (isTri) {
      if (!found) return null;
      if (!extra) extra = found;
      else if (extra !== found) return null;
    } else if (found) return null;
  }
  return {
    tech: "bug", place: [{ i: tri, d: extra }], elim: [],
    focus: [tri], ctx: [], units: S.UNITS_OF[tri], digits: [extra],
    text: "Every unsolved square but " + S.cellName(tri) + " is down to two digits, and every digit has " +
      "exactly two homes in every unit — a shape with an even number of solutions, which a proper puzzle " +
      "cannot have. The odd one out breaks it: " + S.cellName(tri) + " is " + extra + "."
  };
}

/* Nishio — the tested assumption. Put a digit in, follow only the
   forced consequences, and see whether the grid falls apart. If it
   does, the digit was wrong. Proof by contradiction, done honestly and
   in the open. */
function nishio(st) {
  var order = [];
  for (var i = 0; i < CELLS; i++) if (!st.g[i]) order.push(i);
  order.sort(function (a, b) { return S.popcount(st.c[a]) - S.popcount(st.c[b]); });
  for (var k = 0; k < order.length; k++) {
    var cell = order[k], ds = S.digits(st.c[cell]);
    for (var q = 0; q < ds.length; q++) {
      var g2 = S.clone(st.g), c2 = new Uint16Array(st.c);
      var alive = S.assign(g2, c2, cell, ds[q]) && S.propagate(g2, c2);
      if (alive) continue;
      return {
        tech: "nishio", place: [], elim: [{ i: cell, d: ds[q] }],
        focus: [cell], ctx: [], units: [], digits: [ds[q]],
        text: "Suppose " + S.cellName(cell) + " were " + ds[q] + ". Following only the squares that are " +
          "then forced, the grid runs out of room and contradicts itself — so it is not " + ds[q] + "."
      };
    }
  }
  return null;
}

/* Ariadne's thread — the last resort, named after the string that got
   Theseus back out. The room follows a guess all the way down and keeps
   only what survives. It is not a human technique and the app never
   pretends otherwise; the solving room says the same thing about its
   big cubes. */
function ariadne(st) {
  var sol = S.solve(st.g);
  if (!sol) return null;
  var best = -1, bestN = 10;
  for (var i = 0; i < CELLS; i++) {
    if (st.g[i]) continue;
    var n = S.popcount(st.c[i]);
    if (n < bestN) { bestN = n; best = i; }
  }
  if (best < 0) return null;
  return {
    tech: "ariadne", place: [{ i: best, d: sol[best] }], elim: [],
    focus: [best], ctx: [], units: [], digits: [sol[best]],
    text: "No named pattern is left, so the room follows a thread: it tries a digit in " +
      S.cellName(best) + " and walks the whole grid down to see whether it survives. " +
      sol[best] + " does. This is search, not insight — and it is labelled as such."
  };
}

/* ---------- the table ----------
   Order is difficulty order: the solver always reports the simplest
   available step, which is what makes a puzzle's grade meaningful.
   `cost` is the price of one use when scoring a puzzle; `tier` is the
   band a puzzle joins if this is the hardest thing it needs. */
var TECHS = [
  { id: "fullHouse", name: "Last in the unit", tier: 0, cost: 4, find: fullHouse,
    idea: "A row, column or box with one empty square has one digit missing. Fill it in. Every solve ends in a cascade of these.",
    hint: "Somewhere a row, column or box is one square from full." },
  { id: "nakedSingle", name: "Naked single", tier: 0, cost: 5, find: nakedSingle,
    idea: "Look at one square and cross off every digit already in its row, its column and its box. If one digit survives, it belongs there. This is the whole game in miniature: a square is what nothing else lets it be.",
    hint: "Some square has been squeezed down to a single possibility." },
  { id: "hiddenSingle", name: "Hidden single", tier: 0, cost: 14, find: hiddenSingle,
    idea: "Instead of asking what a square can be, ask where a digit can go. If a digit has only one home left in a row, column or box, it lives there — even if that square could have held other digits. Hidden singles are the bread and butter of every puzzle above the gentlest.",
    hint: "Pick a digit and hunt for the unit where it has only one home left." },
  { id: "pointing", name: "Pointing pair", tier: 1, cost: 50, find: pointing,
    idea: "Inside a box, a digit's remaining homes might all sit in one row or column. The box must contain that digit somewhere, so that line already has its copy — and the rest of the line gives it up. Nothing is placed; the grid just gets tidier.",
    hint: "Find a box where one digit is trapped in a single row or column." },
  { id: "claiming", name: "Claiming", tier: 1, cost: 50, find: claiming,
    idea: "The mirror of pointing. If a row or column keeps all its homes for a digit inside one box, that box's copy of the digit is spoken for, and the rest of the box loses it.",
    hint: "Find a line whose last homes for a digit all fall inside one box." },
  { id: "naked2", name: "Naked pair", tier: 1, cost: 60, find: nakedSubset(2),
    idea: "Two squares in a unit that hold the same two digits own them both. You do not know which is which, and it does not matter — no other square in that unit can have either.",
    hint: "Two squares somewhere share exactly the same two candidates." },
  { id: "hidden2", name: "Hidden pair", tier: 2, cost: 70, find: hiddenSubset(2),
    idea: "Two digits in a unit whose only homes are the same two squares fill them between them. Everything else those squares were hoping for is struck out. Hidden pairs hide inside busy squares — look at the digits, not the squares.",
    hint: "Two digits in one unit have the same two homes and nowhere else." },
  { id: "naked3", name: "Naked triple", tier: 2, cost: 80, find: nakedSubset(3),
    idea: "Three squares sharing three digits between them — and not one of them needs to hold all three. {1,2}, {2,3}, {1,3} is a triple just as much as three squares of {1,2,3}. Those three digits are used up in that unit.",
    hint: "Three squares between them use only three digits." },
  { id: "hidden3", name: "Hidden triple", tier: 2, cost: 100, find: hiddenSubset(3),
    idea: "Three digits confined to the same three squares, however many other digits those squares still list. The three squares belong to the three digits; the clutter goes.",
    hint: "Three digits share three homes — the squares may look busy." },
  { id: "naked4", name: "Naked quad", tier: 2, cost: 120, find: nakedSubset(4),
    idea: "The same idea one size up: four squares, four digits between them. Rarer, and usually there is something simpler about — but when a unit has exactly five empty squares, a quad is often hiding in it.",
    hint: "Four squares between them use only four digits." },
  { id: "xWing", name: "X-Wing", tier: 2, cost: 140, find: fish(2),
    idea: "Two rows where a digit has exactly two homes, and those homes stand in the same two columns. The digit will take one corner and the diagonally opposite one — either way both columns are served from these two rows, so every other square in those columns loses it. The first pattern that feels like a real discovery.",
    hint: "Find a digit with exactly two homes in each of two rows — lined up in the same columns." },
  { id: "colouring", name: "Simple colouring", tier: 3, cost: 150, find: simpleColour,
    idea: "Take one digit and join the squares where it has only two homes in a unit. Along that chain the truth alternates, so paint it two colours: one colour is entirely true, the other entirely false. If a colour ever sees itself, it is the false one. And any square outside the chain that sees both colours cannot hold the digit at all.",
    hint: "Follow one digit through the units where it has only two homes." },
  { id: "yWing", name: "Y-Wing", tier: 3, cost: 160, find: yWing,
    idea: "Three squares of two candidates each: a hinge holding {a,b}, and two arms holding {a,c} and {b,c}. The hinge is one or the other, and either way an arm becomes c. Anything that sees both arms cannot be c. The first properly three-dimensional argument in sudoku.",
    hint: "Look for a two-candidate square with two two-candidate friends that share a digit with it — and with each other." },
  { id: "xyzWing", name: "XYZ-Wing", tier: 3, cost: 180, find: xyzWing,
    idea: "A Y-Wing whose hinge holds all three digits. Now the hinge itself might be the c, so the elimination has to see all three squares — a smaller net, same catch.",
    hint: "A three-candidate hinge with two two-candidate arms inside it." },
  { id: "swordfish", name: "Swordfish", tier: 4, cost: 200, find: fish(3),
    idea: "An X-Wing with three rows and three columns. Each row gives the digit at most three homes and they all fall in the same three columns, so those columns are fully served — and give up every other copy. The rows need not each have three; two is fine.",
    hint: "Three rows, three columns, one digit — an X-Wing grown a size." },
  { id: "uniqueRect", name: "Unique rectangle", tier: 4, cost: 180, find: uniqueRect,
    idea: "Four squares in two rows, two columns and exactly two boxes, three of them holding the identical pair. If the fourth held only that pair too, the two digits could rotate around the rectangle and the puzzle would have two answers. A published puzzle has one — so the fourth square keeps only its extra digits. This argues from the puzzle rather than the grid, which is why some solvers refuse it. The room shows it, and says so.",
    hint: "Look for a rectangle in two boxes with the same pair in three of its corners." },
  { id: "bug", name: "BUG+1", tier: 4, cost: 190, find: bugPlusOne,
    idea: "If every unsolved square but one is down to two digits, and every digit has exactly two homes in every unit, the grid could be finished in an even number of ways — never exactly one. The single square with three candidates is what saves it, and it must take the digit that appears three times in its units.",
    hint: "Nearly every square is down to two candidates. Find the one that is not." },
  { id: "jellyfish", name: "Jellyfish", tier: 4, cost: 250, find: fish(4),
    idea: "Four rows, four columns, one digit. The last of the fish — a five-line fish can always be read as a smaller one on the other axis, so this is where the family stops being useful.",
    hint: "Four rows, four columns, one digit." },
  { id: "nishio", name: "Nishio", tier: 5, cost: 400, find: nishio,
    idea: "Assume a digit, follow only what is forced, and watch for the grid to contradict itself. If it does, the assumption was wrong. Legitimate logic — proof by contradiction — but it asks you to hold a hypothesis in your head, which is why it sits at the bottom of the list.",
    hint: "Try a digit and follow only the forced consequences until something breaks." },
  { id: "ariadne", name: "Ariadne's thread", tier: 5, cost: 800, find: ariadne,
    idea: "Search, not insight: guess, follow the thread all the way down, and keep what survives. No puzzle the room hands you needs this — the generator only ships puzzles its named techniques can finish. It exists so the solver is never stuck on a grid you typed in yourself, and it is always labelled.",
    hint: "Nothing named is left here — this one is a tested guess." }
];

var BY_ID = {};
for (var t = 0; t < TECHS.length; t++) BY_ID[TECHS[t].id] = TECHS[t];

/* Five bands. A puzzle joins the band of the hardest technique it
   needs — the honest measure, because it is exactly what you will have
   to see to finish it unaided. */
var TIERS = [
  { id: "gentle", name: "Gentle", note: "singles only — the shape of the game" },
  { id: "steady", name: "Steady", note: "boxes talking to lines, naked pairs" },
  { id: "tricky", name: "Tricky", note: "hidden pairs, triples, the X-Wing" },
  { id: "devious", name: "Devious", note: "colour chains and wings" },
  { id: "diabolical", name: "Diabolical", note: "rectangles, big fish, uniqueness" },
  /* Nothing the generator ships lands here — it is the honest verdict
     for a grid you typed in yourself that needs contradiction or
     search to finish. */
  { id: "beyond", name: "Beyond patterns", note: "contradiction, then search" }
];

function techsUpTo(tier) {
  var out = {};
  for (var i = 0; i < TECHS.length; i++) if (TECHS[i].tier <= tier) out[TECHS[i].id] = true;
  return out;
}

/* ---------- applying a step ---------- */
function apply(st, step) {
  var k;
  if (step.elim) for (k = 0; k < step.elim.length; k++) st.c[step.elim[k].i] &= ~BIT[step.elim[k].d];
  if (step.place) for (k = 0; k < step.place.length; k++) S.assign(st.g, st.c, step.place[k].i, step.place[k].d);
}

/* The next honest step, drawn from `allowed` (a map of technique ids,
   or null for everything). */
function nextStep(st, allowed) {
  for (var i = 0; i < TECHS.length; i++) {
    if (allowed && !allowed[TECHS[i].id]) continue;
    var step = TECHS[i].find(st);
    if (step) { step.name = TECHS[i].name; step.tier = TECHS[i].tier; return step; }
  }
  return null;
}

/* Solve as a person would, one named step at a time. Returns the steps,
   whether it got there, and what it cost. */
function run(grid, opts) {
  opts = opts || {};
  var st = state(grid), steps = [], counts = {}, score = 0, hardest = -1, hardestId = null;
  var allowed = opts.allowed || null, limit = opts.maxSteps || 400;
  while (steps.length < limit) {
    if (S.isComplete(st.g)) break;
    var step = nextStep(st, allowed);
    if (!step) break;
    apply(st, step);
    steps.push(step);
    counts[step.tech] = (counts[step.tech] || 0) + 1;
    var tech = BY_ID[step.tech];
    /* First sighting of a technique costs full price; after that it is
       familiar and costs less. Same instinct as Hodoku's rating. */
    score += counts[step.tech] === 1 ? tech.cost : Math.round(tech.cost * 0.55);
    if (tech.tier > hardest) { hardest = tech.tier; hardestId = tech.id; }
    if (opts.onStep) opts.onStep(step, st);
  }
  return {
    solved: S.isComplete(st.g), grid: st.g, cands: st.c,
    steps: steps, counts: counts, score: score,
    hardest: hardest < 0 ? 0 : hardest, hardestId: hardestId
  };
}

/* Can this grid be finished using nothing harder than `tier`? The
   generator asks this on every dug clue, so it stops early. */
function solvableWithin(grid, tier) {
  return run(grid, { allowed: techsUpTo(tier) }).solved;
}

/* The verdict: band, score, and the full list of what it takes. */
function grade(grid) {
  var r = run(grid, {});
  var tier = r.hardest;
  return {
    solved: r.solved, tier: tier, band: TIERS[tier].id, bandName: TIERS[tier].name,
    score: r.score, steps: r.steps.length, counts: r.counts, hardestId: r.hardestId,
    techs: Object.keys(r.counts)
  };
}

/* ---------- exports ---------- */
var Strat = {
  TECHS: TECHS, BY_ID: BY_ID, TIERS: TIERS,
  state: state, stateFrom: stateFrom, apply: apply, nextStep: nextStep,
  run: run, grade: grade, solvableWithin: solvableWithin, techsUpTo: techsUpTo,
  placesFor: placesFor, commonPeers: commonPeers, strongLinks: strongLinks
};

if (typeof module !== "undefined" && module.exports) module.exports = Strat;
else root.Strat = Strat;
})(typeof self !== "undefined" ? self : this);
