/* core.js — the grid, the constraints, and an honest brute-force solver.

   Everything here is about *what is true* on a sudoku grid: which cells
   see which, what may still go where, whether a puzzle has exactly one
   answer. Nothing here knows about human technique — that lives in
   strategies.js, and it is deliberately kept apart so the two can check
   each other (tools/test-core.js does exactly that: every logical step
   is measured against the brute-force answer).

   Representation
   --------------
   A grid is a Uint8Array(81), row-major, 0 = empty, 1..9 = a digit.
   Candidates are a Uint16Array(81) of 9-bit masks: bit (d-1) set means
   "digit d is still possible here". A filled cell's mask is 0.

   No libraries. Runs in a browser (window.Sudoku) and in node
   (module.exports) unchanged. */
(function (root) {
"use strict";

var N = 9, CELLS = 81, ALL = 0x1FF;

/* ---------- bit helpers ----------
   Nine digits fit in nine bits, so a whole cell's possibilities are one
   integer and "which digits do these three cells share" is one `|`. */
var BIT = [0, 1, 2, 4, 8, 16, 32, 64, 128, 256];
var POP = new Uint8Array(512);          // popcount of every 9-bit mask
var ONLY = new Int8Array(512);          // mask -> its digit, if it holds exactly one
var DIGS = [];                          // mask -> [digits], built once
(function () {
  for (var m = 0; m < 512; m++) {
    var n = 0, list = [], last = 0;
    for (var d = 1; d <= 9; d++) if (m & BIT[d]) { n++; list.push(d); last = d; }
    POP[m] = n; DIGS[m] = list; ONLY[m] = n === 1 ? last : 0;
  }
})();
function popcount(m) { return POP[m & ALL]; }
function digits(m) { return DIGS[m & ALL]; }
function onlyDigit(m) { return ONLY[m & ALL]; }

/* ---------- geometry: rows, columns, boxes, peers ----------
   Twenty-seven units (9 rows, 9 columns, 9 boxes). Every cell belongs
   to exactly three of them, and "sees" the 20 other cells in those
   three. These tables are the whole rulebook; everything else in the
   app reads them rather than re-deriving row/column/box arithmetic. */
var ROW = new Uint8Array(CELLS), COL = new Uint8Array(CELLS), BOX = new Uint8Array(CELLS);
var UNITS = [];        // 27 units, each 9 cell indices
var UNIT_KIND = [];    // per unit: 'row' | 'col' | 'box'
var UNIT_NO = [];      // per unit: 0..8 within its kind
var UNITS_OF = [];     // per cell: [rowUnit, colUnit, boxUnit] (indices into UNITS)
var PEERS = [];        // per cell: 20 cell indices
var PEER_MASK = [];    // per cell: Uint8Array(81) flags, for O(1) "sees?"

(function () {
  var i, r, c, u;
  for (i = 0; i < CELLS; i++) {
    r = (i / N) | 0; c = i % N;
    ROW[i] = r; COL[i] = c; BOX[i] = ((r / 3) | 0) * 3 + ((c / 3) | 0);
  }
  for (r = 0; r < N; r++) {
    u = []; for (c = 0; c < N; c++) u.push(r * N + c);
    UNITS.push(u); UNIT_KIND.push("row"); UNIT_NO.push(r);
  }
  for (c = 0; c < N; c++) {
    u = []; for (r = 0; r < N; r++) u.push(r * N + c);
    UNITS.push(u); UNIT_KIND.push("col"); UNIT_NO.push(c);
  }
  for (var b = 0; b < N; b++) {
    u = [];
    var r0 = ((b / 3) | 0) * 3, c0 = (b % 3) * 3;
    for (var dr = 0; dr < 3; dr++) for (var dc = 0; dc < 3; dc++) u.push((r0 + dr) * N + c0 + dc);
    UNITS.push(u); UNIT_KIND.push("box"); UNIT_NO.push(b);
  }
  for (i = 0; i < CELLS; i++) {
    UNITS_OF.push([ROW[i], N + COL[i], 2 * N + BOX[i]]);
    var seen = new Uint8Array(CELLS), list = [];
    for (var k = 0; k < 3; k++) {
      var un = UNITS[UNITS_OF[i][k]];
      for (var j = 0; j < N; j++) {
        var p = un[j];
        if (p !== i && !seen[p]) { seen[p] = 1; list.push(p); }
      }
    }
    PEERS.push(list); PEER_MASK.push(seen);
  }
})();

function sees(a, b) { return a !== b && !!PEER_MASK[a][b]; }

/* Human-readable cell names: r4c7 — the notation every sudoku forum
   uses, so an explanation here can be pasted anywhere and understood. */
function cellName(i) { return "r" + (ROW[i] + 1) + "c" + (COL[i] + 1); }
function unitName(u) {
  if (UNIT_KIND[u] === "row") return "row " + (UNIT_NO[u] + 1);
  if (UNIT_KIND[u] === "col") return "column " + (UNIT_NO[u] + 1);
  return "box " + (UNIT_NO[u] + 1);
}

/* ---------- seeded randomness ----------
   Every puzzle in the room is reproducible from its seed: the daily
   puzzle is the same for everyone, a shared puzzle travels as a short
   code, and the tests are not flaky. mulberry32 — 32 bits of state,
   good enough for shuffling and famously short. */
function rng(seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = (rnd() * (i + 1)) | 0, t = arr[i];
    arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* ---------- grids ---------- */
function empty() { return new Uint8Array(CELLS); }
function clone(g) { return new Uint8Array(g); }

function fromString(s) {
  var g = empty(), n = 0;
  for (var i = 0; i < s.length && n < CELLS; i++) {
    var ch = s.charAt(i);
    if (ch >= "1" && ch <= "9") g[n++] = ch.charCodeAt(0) - 48;
    else if (ch === "." || ch === "0" || ch === "-") g[n++] = 0;
  }
  return n === CELLS ? g : null;
}
function toString81(g) {
  var s = "";
  for (var i = 0; i < CELLS; i++) s += g[i] ? String(g[i]) : ".";
  return s;
}
function countClues(g) {
  var n = 0; for (var i = 0; i < CELLS; i++) if (g[i]) n++;
  return n;
}
function isComplete(g) {
  for (var i = 0; i < CELLS; i++) if (!g[i]) return false;
  return true;
}

/* Candidate masks for a grid, from the constraints alone. */
function candidates(g) {
  var c = new Uint16Array(CELLS), i, k;
  for (i = 0; i < CELLS; i++) {
    if (g[i]) { c[i] = 0; continue; }
    var m = ALL, ps = PEERS[i];
    for (k = 0; k < ps.length; k++) m &= ~BIT[g[ps[k]]];
    c[i] = m;
  }
  return c;
}

/* Cells that break a rule right now (two of a digit in one unit), so
   the board can mark a mistake without knowing the answer. */
function conflicts(g) {
  var bad = new Uint8Array(CELLS);
  for (var u = 0; u < UNITS.length; u++) {
    var un = UNITS[u], seenAt = {};
    for (var j = 0; j < N; j++) {
      var i = un[j], d = g[i];
      if (!d) continue;
      if (seenAt[d] !== undefined) { bad[i] = 1; bad[seenAt[d]] = 1; }
      else seenAt[d] = i;
    }
  }
  var out = [];
  for (var k = 0; k < CELLS; k++) if (bad[k]) out.push(k);
  return out;
}

/* Is the grid legal as it stands (no unit repeats)? */
function isLegal(g) { return conflicts(g).length === 0; }

/* ---------- the brute-force solver ----------
   Constraint propagation (naked singles + hidden singles) to a fixed
   point, then branch on the cell with the fewest candidates. This is
   the room's *oracle*: it never explains anything, it just knows. The
   human techniques are checked against it. */

function assign(g, c, i, d) {
  /* Place d at i and strike it from every peer. Returns false the
     moment that leaves some cell with nothing to be. */
  g[i] = d; c[i] = 0;
  var ps = PEERS[i], b = BIT[d];
  for (var k = 0; k < ps.length; k++) {
    var p = ps[k];
    if (g[p] === d) return false;
    if (c[p] & b) {
      c[p] &= ~b;
      if (!c[p] && !g[p]) return false;
    }
  }
  return true;
}

function propagate(g, c, trace) {
  var moved = true;
  while (moved) {
    moved = false;
    var i, d, u, j;
    for (i = 0; i < CELLS; i++) {
      if (g[i]) continue;
      if (!c[i]) return false;
      d = onlyDigit(c[i]);
      if (d) {
        if (trace) trace({ t: "place", i: i, d: d, auto: 1, why: "naked" });
        if (!assign(g, c, i, d)) return false;
        moved = true;
      }
    }
    for (u = 0; u < UNITS.length; u++) {
      var un = UNITS[u];
      for (d = 1; d <= N; d++) {
        var b = BIT[d], spot = -1, count = 0, placed = false;
        for (j = 0; j < N; j++) {
          var cell = un[j];
          if (g[cell] === d) { placed = true; break; }
          if (c[cell] & b) { count++; spot = cell; }
        }
        if (placed) continue;
        if (count === 0) return false;
        if (count === 1) {
          if (trace) trace({ t: "place", i: spot, d: d, auto: 1, why: "hidden", unit: u });
          if (!assign(g, c, spot, d)) return false;
          moved = true;
        }
      }
    }
  }
  return true;
}

/* Search for solutions. `limit` caps how many we care about (2 is the
   uniqueness question). `rnd`, when given, randomises the branch order,
   which is how a random full grid gets made. `trace`, when given, is
   handed every placement and every backtrack — that is what The Forge
   replays on screen. */
function search(g, c, limit, rnd, out, trace) {
  if (!propagate(g, c, trace)) return 0;
  var best = -1, bestN = 10, i;
  for (i = 0; i < CELLS; i++) {
    if (g[i]) continue;
    var n = POP[c[i]];
    if (n < bestN) { bestN = n; best = i; if (n === 2) break; }
  }
  if (best < 0) { out.push(clone(g)); return 1; }
  var ds = digits(c[best]).slice();
  if (rnd) shuffle(ds, rnd);
  var found = 0, snapshot = trace ? toString81(g) : null;
  for (var k = 0; k < ds.length; k++) {
    var g2 = clone(g), c2 = new Uint16Array(c), before = out.length;
    if (trace) trace({ t: "place", i: best, d: ds[k], auto: 0, guess: 1 });
    if (assign(g2, c2, best, ds[k])) found += search(g2, c2, limit - found, rnd, out, trace);
    if (trace && out.length === before) trace({ t: "back", i: best, d: ds[k], grid: snapshot });
    if (found >= limit) break;
  }
  return found;
}

/* How many solutions, up to `limit`? The uniqueness test the whole
   generator leans on. */
function countSolutions(g, limit) {
  var out = [], gg = clone(g), c = candidates(gg);
  return search(gg, c, limit || 2, null, out, null);
}

/* One solution, or null. */
function solve(g, seed) {
  var out = [], gg = clone(g), c = candidates(gg);
  search(gg, c, 1, seed === undefined ? null : rng(seed), out, null);
  return out.length ? out[0] : null;
}

/* A random completed grid. `trace` receives the real search events, so
   The Forge shows the algorithm that actually ran, not a re-enactment. */
function fullGrid(rnd, trace) {
  var out = [], g = empty(), c = candidates(g);
  search(g, c, 1, rnd, out, trace || null);
  return out[0];
}

/* ---------- transforms ----------
   Every sudoku has 3,359,232 relabelled twins that are the same puzzle
   wearing a different coat. The room uses them to keep the daily and
   the shared codes from ever looking repetitive. */
function transform(g, rnd) {
  var out = new Uint8Array(CELLS);
  var map = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  var perm = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rnd);
  for (var d = 1; d <= 9; d++) map[d] = perm[d - 1];

  var bandOrder = shuffle([0, 1, 2], rnd), stackOrder = shuffle([0, 1, 2], rnd);
  var rowIn = [shuffle([0, 1, 2], rnd), shuffle([0, 1, 2], rnd), shuffle([0, 1, 2], rnd)];
  var colIn = [shuffle([0, 1, 2], rnd), shuffle([0, 1, 2], rnd), shuffle([0, 1, 2], rnd)];
  var flip = rnd() < 0.5;

  for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
    var sr = bandOrder[(r / 3) | 0] * 3 + rowIn[(r / 3) | 0][r % 3];
    var sc = stackOrder[(c / 3) | 0] * 3 + colIn[(c / 3) | 0][c % 3];
    var v = map[g[sr * N + sc]];
    out[(flip ? c : r) * N + (flip ? r : c)] = v;
  }
  return out;
}

/* ---------- exports ---------- */
var Sudoku = {
  N: N, CELLS: CELLS, ALL: ALL, BIT: BIT,
  ROW: ROW, COL: COL, BOX: BOX,
  UNITS: UNITS, UNIT_KIND: UNIT_KIND, UNIT_NO: UNIT_NO, UNITS_OF: UNITS_OF,
  PEERS: PEERS, sees: sees,
  popcount: popcount, digits: digits, onlyDigit: onlyDigit,
  cellName: cellName, unitName: unitName,
  rng: rng, shuffle: shuffle,
  empty: empty, clone: clone, fromString: fromString, toString: toString81,
  countClues: countClues, isComplete: isComplete, candidates: candidates,
  conflicts: conflicts, isLegal: isLegal,
  assign: assign, propagate: propagate,
  countSolutions: countSolutions, solve: solve, fullGrid: fullGrid,
  transform: transform
};

if (typeof module !== "undefined" && module.exports) module.exports = Sudoku;
else root.Sudoku = Sudoku;
})(typeof self !== "undefined" ? self : this);
