/* app.js — the room itself.

   This file only conducts. The mathematics lives in core.js, the
   nineteen techniques in strategies.js, the making of puzzles in
   forge.js, the teaching in dojo.js, the wall in badges.js.

   Sections, in order:

     helpers · sound · the sheet (one grid renderer, three screens use
     it) · the profile · the cupboard (puzzles forged in idle moments)
     · a game · input · painting · the hint ladder · finishing ·
     the home screen · The Forge · The Codex · a lesson · The Wall ·
     boot.

   House rules: no libraries, no build step, no server, nothing tracked.
   Everything the room remembers lives in this browser's localStorage
   and nowhere else. */
/* global Sudoku, Strat, Forge, Dojo, Badges, LESSONS */
(function () {
"use strict";

var S = window.Sudoku, T = window.Strat, F = window.Forge, D = window.Dojo, B = window.Badges;
var BIT = S.BIT;

/* ===================== helpers ===================== */
function $(id) { return document.getElementById(id); }
var REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* One place for "this thing was pressed", so the iOS synthesized-click
   double-fire is handled once rather than in forty listeners. */
function press(el, fn) {
  if (!el) return;
  var armed = false;
  el.addEventListener("pointerdown", function (e) { armed = true; e.preventDefault(); }, { passive: false });
  el.addEventListener("pointerup", function (e) { if (armed) { armed = false; fn(e); } });
  el.addEventListener("pointercancel", function () { armed = false; });
  el.addEventListener("pointerleave", function () { armed = false; });
  el.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(e); }
  });
}

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

function fmt(ms) {
  var s = Math.max(0, Math.round(ms / 1000)), m = (s / 60) | 0, h = (m / 60) | 0;
  s %= 60;
  return h ? h + ":" + pad2(m % 60) + ":" + pad2(s) : m + ":" + pad2(s);
}
function pad2(n) { return (n < 10 ? "0" : "") + n; }

var toastTimer = null;
function toast(msg, ms) {
  var el = $("toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove("on"); }, ms || 2600);
}
function buzz(ms) { try { if (navigator.vibrate && prefs.sound) navigator.vibrate(ms); } catch (e) {} }

/* ===================== sound =====================
   Synthesized, never sampled: nine digits on a pentatonic scale, so
   whatever you play sounds like it meant to happen. */
var actx = null;
function audio() {
  if (!prefs.sound) return null;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    return actx;
  } catch (e) { return null; }
}
var PENT = [0, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99];
function tone(freq, dur, type, gain, delay) {
  var a = audio();
  if (!a) return;
  var t0 = a.currentTime + (delay || 0);
  var o = a.createOscillator(), g = a.createGain();
  o.type = type || "sine";
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain || 0.08, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.18));
  o.connect(g); g.connect(a.destination);
  o.start(t0); o.stop(t0 + (dur || 0.18) + 0.03);
}
var SFX = {
  place: function (d) { tone(PENT[d] * 2, 0.16, "sine", 0.07); tone(PENT[d], 0.22, "triangle", 0.03); },
  pencil: function () { tone(1400, 0.03, "square", 0.012); },
  erase: function () { tone(180, 0.09, "sine", 0.04); },
  bad: function () { tone(120, 0.16, "sawtooth", 0.035); tone(118, 0.2, "sine", 0.03, 0.03); },
  unit: function () { [523.25, 659.25, 783.99].forEach(function (f, n) { tone(f, 0.5, "sine", 0.05, n * 0.06); }); },
  hint: function () { tone(587.33, 0.12, "sine", 0.05); tone(880, 0.18, "sine", 0.045, 0.09); },
  win: function () {
    [261.63, 329.63, 392, 523.25, 659.25, 783.99].forEach(function (f, n) {
      tone(f, 0.8, "sine", 0.06, n * 0.11);
      tone(f * 2, 0.5, "triangle", 0.02, n * 0.11);
    });
  },
  badge: function () { [783.99, 1046.5].forEach(function (f, n) { tone(f, 0.5, "sine", 0.05, n * 0.1); }); }
};

/* ===================== the sheet =====================
   One renderer. The play screen, the lesson and (in miniature) the
   forge all draw the same way, so a square looks the same wherever you
   meet it. */
function buildBoard(el) {
  el.innerHTML = "";
  var cells = [];
  for (var i = 0; i < 81; i++) {
    var c = document.createElement("div");
    var cls = "cell";
    if (S.COL[i] % 3 === 2 && S.COL[i] !== 8) cls += " br";
    if (S.ROW[i] % 3 === 2 && S.ROW[i] !== 8) cls += " bb";
    c.className = cls;
    c.setAttribute("role", "gridcell");
    var pm = document.createElement("div");
    pm.className = "pm";
    for (var d = 1; d <= 9; d++) {
      var sp = document.createElement("span");
      sp.textContent = d;
      pm.appendChild(sp);
    }
    var v = document.createElement("span");
    v.className = "v";
    c.appendChild(pm); c.appendChild(v);
    c.dataset.i = i;
    el.appendChild(c);
    cells.push(c);
  }
  return cells;
}

/* view: {grid, given, pencil, sel, wrong, pat, cut, hi, hush, wash, echo} */
function paint(cells, view) {
  var wash = view.wash || {}, pat = view.pat || {}, cut = view.cut || {}, hi = view.hi || {};
  for (var i = 0; i < 81; i++) {
    var el = cells[i], d = view.grid[i], cls = "cell";
    if (S.COL[i] % 3 === 2 && S.COL[i] !== 8) cls += " br";
    if (S.ROW[i] % 3 === 2 && S.ROW[i] !== 8) cls += " bb";
    if (view.given && view.given[i]) cls += " given";
    if (d) cls += " filled";
    if (wash[i]) cls += " wash";
    if (view.echo && d === view.echo && i !== view.sel) cls += " echo";
    if (view.sel === i) cls += " sel";
    if (view.wrong && view.wrong[i]) cls += " bad";
    if (pat[i]) cls += " pat";
    if (cut[i]) cls += " cut";
    if (view.hush && view.hush[i]) cls += " hushed";
    if (el.className !== cls) el.className = cls;
    var v = el.firstChild.nextSibling;
    var txt = d ? String(d) : "";
    if (v.textContent !== txt) v.textContent = txt;
    /* pencil marks */
    var mask = d ? 0 : (view.pencil ? view.pencil[i] : 0);
    var slots = el.firstChild.childNodes;
    for (var k = 0; k < 9; k++) {
      var on = !!(mask & BIT[k + 1]);
      var c2 = "";
      if (on) c2 = "on";
      if (on && hi[i] && (hi[i] & BIT[k + 1])) c2 = "on hi";
      if (on && cut[i] && (cut[i] & BIT[k + 1])) c2 = "on gone";
      if (slots[k].className !== c2) slots[k].className = c2;
    }
  }
}

/* Chains and wings get drawn, because a sentence about r4c7 and r6c2
   is not a picture and a picture is what you remember. */
function drawLinks(svg, links) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!links || !links.length) return;
  links.forEach(function (L) {
    var x1 = S.COL[L.a] * 100 + 50, y1 = S.ROW[L.a] * 100 + 50;
    var x2 = S.COL[L.b] * 100 + 50, y2 = S.ROW[L.b] * 100 + 50;
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var bow = Math.min(60, len * 0.16);
    var cx = mx - (dy / len) * bow, cy = my + (dx / len) * bow;
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", "M" + x1 + "," + y1 + " Q" + cx + "," + cy + " " + x2 + "," + y2);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "#1f9d6a");
    p.setAttribute("stroke-width", "5");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("opacity", "0.85");
    if (!L.strong) p.setAttribute("stroke-dasharray", "10 12");
    svg.appendChild(p);
  });
}

/* ===================== particles =====================
   Motes of lamplight. They only exist while something is happening. */
var fxRunning = false, motes = [];
function fxSpawn(i, n, hue) {
  var canvas = $("fx");
  var r = canvas.getBoundingClientRect();
  if (!r.width) return;
  var x = (S.COL[i] + 0.5) / 9 * canvas.width, y = (S.ROW[i] + 0.5) / 9 * canvas.height;
  for (var k = 0; k < n; k++) {
    motes.push({
      x: x, y: y,
      vx: (Math.random() - 0.5) * 2.4, vy: -Math.random() * 2.6 - 0.4,
      life: 1, size: 1 + Math.random() * 2.4, hue: hue || 40
    });
  }
  if (!fxRunning) { fxRunning = true; requestAnimationFrame(fxTick); }
}
function fxTick() {
  var canvas = $("fx"), ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (var k = motes.length - 1; k >= 0; k--) {
    var m = motes[k];
    m.x += m.vx; m.y += m.vy; m.vy += 0.05; m.life -= 0.016;
    if (m.life <= 0) { motes.splice(k, 1); continue; }
    ctx.globalAlpha = Math.max(0, m.life);
    ctx.fillStyle = "hsl(" + m.hue + ",90%,72%)";
    ctx.beginPath(); ctx.arc(m.x, m.y, m.size, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (motes.length) requestAnimationFrame(fxTick);
  else fxRunning = false;
}

/* ===================== preferences and profile ===================== */
var PREF_KEY = "sudokuroom_prefs", PROF_KEY = "sudokuroom_profile",
    GAME_KEY = "sudokuroom_game", CUP_KEY = "sudokuroom_cupboard",
    DAILY_KEY = "sudokuroom_daily";

var prefs = {
  sound: true, check: true, highlight: true, echo: true,
  autoPrune: true, slate: false, lastBand: "gentle"
};
(function () {
  try {
    var p = JSON.parse(lsGet(PREF_KEY) || "{}");
    for (var k in prefs) if (p[k] !== undefined) prefs[k] = p[k];
  } catch (e) {}
})();
function savePrefs() { lsSet(PREF_KEY, JSON.stringify(prefs)); }

var profile;
(function () {
  var raw = null;
  try { raw = JSON.parse(lsGet(PROF_KEY) || "null"); } catch (e) {}
  profile = D.reviveProfile(raw);
})();
function saveProfile() { lsSet(PROF_KEY, JSON.stringify(profile)); }

/* ===================== the cupboard =====================
   Forging a Diabolical takes a third of a second of honest work. Rather
   than make anyone watch that, the room keeps a couple of each band cut
   and ready, and tops them up in idle moments. Spares from a job that
   missed its band are filed too — a Steady found while hunting a Tricky
   is still a Steady. */
var cupboard = { gentle: [], steady: [], tricky: [], devious: [], diabolical: [] };
(function () {
  try {
    var c = JSON.parse(lsGet(CUP_KEY) || "null");
    if (c) for (var k in cupboard) if (Array.isArray(c[k])) cupboard[k] = c[k].slice(0, 3);
  } catch (e) {}
})();
function saveCupboard() { lsSet(CUP_KEY, JSON.stringify(cupboard)); }

function fileAway(r) {
  if (!r || !r.solved) return;
  var shelf = cupboard[r.band];
  if (!shelf || shelf.length >= 3) return;
  shelf.push({
    puzzle: S.toString(r.puzzle), solution: S.toString(r.solution),
    band: r.band, tier: r.tier, clues: r.clues, counts: r.counts,
    score: r.score, hardestId: r.hardestId, symmetric: !!r.symmetric
  });
}
function takeFromCupboard(band) {
  var shelf = cupboard[band];
  if (!shelf || !shelf.length) return null;
  var got = shelf.shift();
  saveCupboard();
  return got;
}

/* The stocker runs only when nothing else wants the frame: on the home
   screen, between puzzles, never during play. */
var stockJob = null, stockIdle = null;
function stockTick() {
  stockIdle = null;
  if (screen !== "home" || document.hidden) return;
  if (!stockJob) {
    var want = null;
    ["gentle", "steady", "tricky", "devious", "diabolical"].forEach(function (b) {
      if (want) return;
      if (cupboard[b].length < 2 && D.unlocked(profile, b)) want = b;
    });
    if (!want) return;
    stockJob = F.job({ level: want });
  }
  var more = stockJob.tick(6);
  stockJob.drain();
  if (!more) {
    fileAway(stockJob.result);
    stockJob.spares.forEach(fileAway);
    saveCupboard();
    stockJob = null;
  }
  stockIdle = setTimeout(function () { requestAnimationFrame(stockTick); }, 90);
}
function stockSoon() { if (!stockIdle) stockIdle = setTimeout(function () { requestAnimationFrame(stockTick); }, 700); }

/* ===================== a game ===================== */
var G = null;
var cells = buildBoard($("board"));
var screen = "home";

function newGame(rec, opts) {
  opts = opts || {};
  var puzzle = typeof rec.puzzle === "string" ? S.fromString(rec.puzzle) : rec.puzzle;
  var solution = typeof rec.solution === "string" ? S.fromString(rec.solution) : rec.solution;
  G = {
    puzzle: puzzle, solution: solution,
    grid: S.clone(puzzle),
    given: (function () { var a = new Uint8Array(81); for (var i = 0; i < 81; i++) a[i] = puzzle[i] ? 1 : 0; return a; })(),
    pencil: new Uint16Array(81),
    wrong: new Uint8Array(81),
    band: rec.band, tier: rec.tier === undefined ? 0 : rec.tier,
    counts: rec.counts || {}, clues: rec.clues || S.countClues(puzzle),
    daily: !!opts.daily, dailyKey: opts.dailyKey || null, zen: !!opts.zen,
    elapsed: 0, running: true, since: Date.now(),
    hints: 0, mistakes: 0, undos: 0, pencilUsed: 0,
    sel: -1, hintStage: 0, hintStep: null, taught: {},
    history: [], done: false
  };
  saveGame();
  openPlay();
}

function serializeGame() {
  if (!G || G.done) return null;
  return {
    puzzle: S.toString(G.puzzle), solution: S.toString(G.solution),
    grid: S.toString(G.grid), pencil: Array.prototype.slice.call(G.pencil),
    band: G.band, tier: G.tier, counts: G.counts, clues: G.clues,
    daily: G.daily, dailyKey: G.dailyKey, zen: G.zen,
    elapsed: elapsedMs(), hints: G.hints, mistakes: G.mistakes,
    undos: G.undos, pencilUsed: G.pencilUsed, taught: G.taught
  };
}
function saveGame() {
  var g = serializeGame();
  if (g) lsSet(GAME_KEY, JSON.stringify(g));
  else try { localStorage.removeItem(GAME_KEY); } catch (e) {}
}
function loadSavedGame() {
  try {
    var g = JSON.parse(lsGet(GAME_KEY) || "null");
    if (!g || !g.puzzle || !g.grid) return null;
    return g;
  } catch (e) { return null; }
}
function resumeGame(g) {
  newGame(g, { daily: g.daily, dailyKey: g.dailyKey, zen: g.zen });
  G.grid = S.fromString(g.grid) || G.grid;
  G.pencil = Uint16Array.from(g.pencil || []);
  if (G.pencil.length !== 81) G.pencil = new Uint16Array(81);
  G.elapsed = g.elapsed || 0; G.since = Date.now();
  G.hints = g.hints || 0; G.mistakes = g.mistakes || 0;
  G.undos = g.undos || 0; G.pencilUsed = g.pencilUsed || 0;
  G.taught = g.taught || {};
  markWrong();
  render();
}

function elapsedMs() {
  if (!G) return 0;
  return G.elapsed + (G.running ? Date.now() - G.since : 0);
}

/* ===================== moves ===================== */
function pushHistory() {
  G.history.push({
    g: S.clone(G.grid), p: new Uint16Array(G.pencil),
    w: new Uint8Array(G.wrong), m: G.mistakes
  });
  if (G.history.length > 250) G.history.shift();
}

function place(i, d) {
  if (!G || G.done || G.given[i]) return;
  if (G.grid[i] === d) { clearCell(i); return; }
  pushHistory();
  G.grid[i] = d;
  G.pencil[i] = 0;
  if (prefs.autoPrune) {
    var ps = S.PEERS[i];
    for (var k = 0; k < ps.length; k++) G.pencil[ps[k]] &= ~BIT[d];
  }
  var wrongNow = G.solution[i] !== d;
  if (wrongNow && prefs.check && !G.zen) {
    G.wrong[i] = 1; G.mistakes++;
    SFX.bad(); buzz(40);
    cells[i].classList.add("shake");
    setTimeout(function () { cells[i].classList.remove("shake"); }, 300);
  } else {
    G.wrong[i] = 0;
    SFX.place(d); buzz(8);
    cells[i].classList.add("pop");
    setTimeout(function () { cells[i].classList.remove("pop"); }, 280);
    if (!wrongNow) celebrateUnits(i);
  }
  clearHint();
  render();
  saveGame();
  checkFinished();
}

function pencilMark(i, d) {
  if (!G || G.done || G.given[i] || G.grid[i]) return;
  pushHistory();
  G.pencil[i] ^= BIT[d];
  G.pencilUsed++;
  SFX.pencil();
  clearHint();
  render(); saveGame();
}

function clearCell(i) {
  if (!G || G.done || G.given[i]) return;
  if (!G.grid[i] && !G.pencil[i]) return;
  pushHistory();
  G.grid[i] = 0; G.pencil[i] = 0; G.wrong[i] = 0;
  SFX.erase();
  clearHint(); render(); saveGame();
}

function undo() {
  if (!G || !G.history.length) return;
  var h = G.history.pop();
  G.grid = h.g; G.pencil = h.p; G.wrong = h.w; G.mistakes = h.m;
  G.undos++;
  SFX.erase();
  clearHint(); render(); saveGame();
}

/* Fill (or clear) every pencil mark from the constraints as they stand.
   Not a hint: it writes down only what anyone can see. */
function fillNotes() {
  if (!G || G.done) return;
  pushHistory();
  var any = false;
  for (var i = 0; i < 81; i++) if (!G.grid[i] && G.pencil[i]) any = true;
  if (any) {
    for (var k = 0; k < 81; k++) G.pencil[k] = 0;
    toast("pencil marks rubbed out");
  } else {
    var c = S.candidates(G.grid);
    for (var j = 0; j < 81; j++) if (!G.grid[j]) { G.pencil[j] = c[j]; G.pencilUsed++; }
    toast("every legal candidate, written in");
  }
  SFX.pencil();
  render(); saveGame();
}

function markWrong() {
  if (!prefs.check || G.zen) { G.wrong = new Uint8Array(81); return; }
  for (var i = 0; i < 81; i++) G.wrong[i] = (!G.given[i] && G.grid[i] && G.grid[i] !== G.solution[i]) ? 1 : 0;
}

/* A row, column or box finishing is the small pleasure the whole game
   is built out of. It gets a sweep of light and a chord. */
function celebrateUnits(i) {
  var units = S.UNITS_OF[i], lit = [];
  units.forEach(function (u) {
    var un = S.UNITS[u], full = true;
    for (var j = 0; j < 9; j++) if (G.grid[un[j]] !== G.solution[un[j]]) full = false;
    if (full) lit.push(u);
  });
  if (!lit.length) return;
  SFX.unit(); buzz(18);
  lit.forEach(function (u) {
    S.UNITS[u].forEach(function (cell, n) {
      var el = cells[cell];
      el.style.animationDelay = (n * 0.035) + "s";
      el.classList.add("sweep");
      setTimeout(function () { el.classList.remove("sweep"); el.style.animationDelay = ""; }, 900);
    });
  });
  if (!REDUCED) fxSpawn(i, 10, 150);
}

/* ===================== painting the play screen ===================== */
function render() {
  if (!G) return;
  var wash = {}, pat = {}, cut = {}, hi = {};
  if (prefs.highlight && G.sel >= 0) {
    S.UNITS_OF[G.sel].forEach(function (u) {
      S.UNITS[u].forEach(function (c) { wash[c] = 1; });
    });
  }
  var step = G.hintStep;
  if (step && G.hintStage >= 2) {
    (step.focus || []).forEach(function (c) { pat[c] = 1; });
    (step.elim || []).forEach(function (e) { cut[e.i] = (cut[e.i] || 0) | BIT[e.d]; });
    (step.place || []).forEach(function (p) { hi[p.i] = (hi[p.i] || 0) | BIT[p.d]; });
    (step.focus || []).forEach(function (c) {
      (step.digits || []).forEach(function (d) { hi[c] = (hi[c] || 0) | BIT[d]; });
    });
  }
  paint(cells, {
    grid: G.grid, given: G.given, pencil: G.pencil, sel: G.sel,
    wrong: G.wrong, wash: wash, pat: pat, cut: cut, hi: hi,
    echo: prefs.echo && G.sel >= 0 && G.grid[G.sel] ? G.grid[G.sel] : 0
  });
  drawLinks($("linkLayer"), step && G.hintStage >= 2 ? step.links : null);
  paintPad();
  $("bandChip").textContent = (G.zen ? "Zen · " : "") + bandName(G.band) + (G.daily ? " · daily" : "");
  $("clock").style.display = G.zen ? "none" : "";
  $("toolPencil").classList.toggle("lit", pencilMode);
  $("toolUndo").classList.toggle("lit", G.history.length > 0);
  document.body.classList.toggle("pencil", pencilMode);
}

function paintPad() {
  var left = [0, 9, 9, 9, 9, 9, 9, 9, 9, 9];
  for (var i = 0; i < 81; i++) if (G.grid[i] && G.grid[i] === G.solution[i]) left[G.grid[i]]--;
  for (var d = 1; d <= 9; d++) {
    var k = padKeys[d - 1];
    k.classList.toggle("done", left[d] <= 0);
    k.lastChild.textContent = G.zen ? "" : String(Math.max(0, left[d]));
  }
}

function bandName(id) {
  var L = F.levelOf(id);
  return L ? L.name : id;
}

function select(i) {
  if (!G || G.done) return;
  G.sel = i;
  render();
}

/* ===================== input ===================== */
var pencilMode = false;
var padKeys = [];
(function buildPad() {
  var pad = $("pad");
  for (var d = 1; d <= 9; d++) {
    var b = document.createElement("button");
    b.className = "key";
    b.innerHTML = "<span>" + d + "</span><small>9</small>";
    b.dataset.d = d;
    pad.appendChild(b);
    padKeys.push(b);
    (function (digit, el) {
      var held = null;
      press(el, function () {
        clearTimeout(held);
        useDigit(digit);
      });
      /* Hold a key for a pencil mark without leaving the pad. */
      el.addEventListener("pointerdown", function () {
        held = setTimeout(function () {
          held = null;
          if (G && G.sel >= 0) { pencilMark(G.sel, digit); buzz(12); }
        }, 420);
      });
      el.addEventListener("pointerup", function () { clearTimeout(held); });
      el.addEventListener("pointercancel", function () { clearTimeout(held); });
    })(d, b);
  }
})();

function useDigit(d) {
  if (!G || G.done) return;
  if (G.sel < 0) { toast("tap a square first"); return; }
  if (pencilMode) pencilMark(G.sel, d);
  else place(G.sel, d);
}

$("board").addEventListener("pointerdown", function (e) {
  var el = e.target.closest ? e.target.closest(".cell") : null;
  if (!el) return;
  e.preventDefault();
  select(+el.dataset.i);
});

document.addEventListener("keydown", function (e) {
  if (screen !== "play" || !G || G.done) return;
  var openOv = document.querySelector(".ov:not(.hide)");
  if (openOv) {
    if (e.key === "Escape") closeOverlays();
    return;
  }
  var k = e.key, i = G.sel;
  if (k >= "1" && k <= "9") {
    if (e.shiftKey) { if (i >= 0) pencilMark(i, +k); }
    else useDigit(+k);
    e.preventDefault(); return;
  }
  var move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9,
               a: -1, d: 1, w: -9, s: 9 }[k];
  if (move !== undefined) {
    e.preventDefault();
    if (i < 0) { select(40); return; }
    var n = i + move;
    if (move === -1 && S.COL[i] === 0) n = i;
    if (move === 1 && S.COL[i] === 8) n = i;
    if (n >= 0 && n < 81) select(n);
    return;
  }
  if (k === "Backspace" || k === "Delete" || k === "0") { if (i >= 0) clearCell(i); e.preventDefault(); return; }
  if (k === "n" || k === "N") { togglePencil(); return; }
  if (k === "u" || k === "U") { undo(); return; }
  if (k === "h" || k === "H") { hint(); return; }
  if (k === "f" || k === "F") { fillNotes(); return; }
  if (k === " ") { e.preventDefault(); togglePause(); return; }
  if (k === "Escape") { openMenu(); return; }
});

function togglePencil() {
  pencilMode = !pencilMode;
  render();
}

/* ===================== the hint ladder =====================
   Three presses. Name it, show it, explain it — and only then play it.
   Nothing here reads the answer: the room finds the move with the same
   nineteen techniques it teaches. */
function clearHint() {
  if (G) { G.hintStage = 0; G.hintStep = null; }
  say("");
}
function say(text, title, moreLabel, moreFn) {
  var m = $("margin");
  m.classList.toggle("quiet", !text);
  m.innerHTML = "";
  if (!text) return;
  if (title) {
    var b = document.createElement("b");
    b.textContent = title;
    m.appendChild(b);
  }
  m.appendChild(document.createTextNode(text));
  if (moreLabel) {
    var a = document.createElement("button");
    a.className = "more";
    a.textContent = moreLabel;
    m.appendChild(document.createElement("br"));
    m.appendChild(a);
    press(a, moreFn);
  }
}

function hint() {
  if (!G || G.done) return;
  SFX.hint();
  /* First, is what is on the board still true? A hint on a broken grid
     would be nonsense, so say so kindly instead. */
  if (G.hintStage === 0) {
    var conflict = S.conflicts(G.grid);
    if (conflict.length) {
      G.wrong = new Uint8Array(81);
      conflict.forEach(function (c) { if (!G.given[c]) G.wrong[c] = 1; });
      say("Two of the same digit are looking at each other — the squares in red. " +
          "Nothing can be worked out until one of them goes.", "hold on");
      render();
      return;
    }
    if (!S.countSolutions(G.grid, 1)) {
      say("Everything on the board is legal, but there is no way to finish from here — " +
          "something written earlier is wrong.", "hold on", "show me the first mistake", function () {
        var found = -1;
        for (var i = 0; i < 81 && found < 0; i++) if (!G.given[i] && G.grid[i] && G.grid[i] !== G.solution[i]) found = i;
        if (found < 0) { say("Curious — nothing disagrees with the answer. Try undo.", "hm"); return; }
        G.wrong[found] = 1; G.sel = found;
        say(S.cellName(found) + " cannot be " + G.grid[found] + ". Take it out and carry on.", "here");
        render();
      });
      return;
    }
    var st = T.state(G.grid);
    var step = T.nextStep(st, null);
    if (!step) { say("The room cannot find a next step here, which should not happen — sorry.", "stuck"); return; }
    G.hintStep = step;
    G.hintStage = 1;
    G.hints++;
    var tech = T.BY_ID[step.tech];
    var known = D.level(profile, step.tech) >= 1;
    say((known ? "There is " : "There is a technique here you have not met: ") +
        (known ? "a " + tech.name.toLowerCase() + " available." : tech.name + ".") + " " +
        tech.hint, "the next step", "where?", hint);
    saveGame();
    return;
  }
  if (G.hintStage === 1) {
    G.hintStage = 2;
    var t2 = T.BY_ID[G.hintStep.tech];
    say("Here it is. " + (G.hintStep.units && G.hintStep.units.length
        ? "Look at " + G.hintStep.units.map(S.unitName).join(" and ") + "."
        : "Look at the lit squares."), t2.name, "why does that work?", hint);
    render();
    return;
  }
  if (G.hintStage === 2) {
    G.hintStage = 3;
    var t3 = T.BY_ID[G.hintStep.tech];
    /* Meeting a technique in a hint is how most people meet them. It
       joins the codex, with its idea unlocked. */
    if (D.meet(profile, t3.id)) {
      toast("“" + t3.name + "” added to your codex");
      saveProfile();
    }
    G.taught[t3.id] = 1;
    say(G.hintStep.text, t3.name, G.hintStep.place && G.hintStep.place.length ? "write it in" : "rub those out", function () {
      applyHint();
    });
    render();
    return;
  }
  applyHint();
}

function applyHint() {
  var step = G.hintStep;
  if (!step) { hint(); return; }
  pushHistory();
  (step.elim || []).forEach(function (e) { G.pencil[e.i] &= ~BIT[e.d]; });
  (step.place || []).forEach(function (p) {
    G.grid[p.i] = p.d; G.pencil[p.i] = 0; G.wrong[p.i] = 0;
    if (prefs.autoPrune) S.PEERS[p.i].forEach(function (q) { G.pencil[q] &= ~BIT[p.d]; });
    cells[p.i].classList.add("pop");
    setTimeout(function () { cells[p.i].classList.remove("pop"); }, 280);
    SFX.place(p.d);
    celebrateUnits(p.i);
  });
  if (step.elim && step.elim.length && !(step.place && step.place.length)) {
    toast(step.elim.length + " candidate" + (step.elim.length > 1 ? "s" : "") + " ruled out");
  }
  clearHint();
  render(); saveGame();
  checkFinished();
}

/* ===================== finishing ===================== */
function checkFinished() {
  if (!G || G.done || !S.isComplete(G.grid)) return;
  var right = true;
  for (var i = 0; i < 81; i++) if (G.grid[i] !== G.solution[i]) right = false;
  if (!right) {
    markWrong();
    say("The grid is full, but some of it disagrees with the one answer this puzzle has. " +
        "The squares in red are the ones to look at again.", "not quite");
    render();
    return;
  }
  finish();
}

function finish() {
  G.done = true; G.running = false;
  var ms = elapsedMs();
  SFX.win(); buzz([20, 60, 30]);
  try { localStorage.removeItem(GAME_KEY); } catch (e) {}

  /* the wave */
  for (var i = 0; i < 81; i++) {
    (function (n) {
      var delay = (S.ROW[n] + S.COL[n]) * 45;
      setTimeout(function () {
        cells[n].classList.add("pop");
        if (!REDUCED && (n % 7 === 0)) fxSpawn(n, 5, 40);
        setTimeout(function () { cells[n].classList.remove("pop"); }, 300);
      }, delay);
    })(i);
  }

  var ev = {
    type: "solve", level: G.band, band: G.band, tier: G.tier, ms: ms,
    hints: G.hints, mistakes: G.mistakes, undos: G.undos,
    pencil: G.pencilUsed, zen: G.zen, daily: G.daily, at: Date.now()
  };

  /* the books */
  profile.solves[G.band] = (profile.solves[G.band] || 0) + 1;
  profile.totals.solved++;
  profile.totals.hints += G.hints;
  profile.totals.mistakes += G.mistakes;
  profile.totals.ms += ms;
  if (!G.zen && (!profile.best[G.band] || ms < profile.best[G.band])) profile.best[G.band] = ms;
  var xp = D.xpFor(ev);
  profile.xp += xp;

  if (G.daily && G.dailyKey) {
    if (!profile.dailyDone[G.dailyKey]) {
      profile.dailyDone[G.dailyKey] = ms;
      profile.dailyDays[new Date().getDay()] = 1;
      bumpStreak(G.dailyKey);
    }
  }

  /* mastery: credit only what the puzzle genuinely needed, and only
     when you did it without help */
  var mastered = [];
  Object.keys(G.counts || {}).forEach(function (id) {
    if (!T.BY_ID[id]) return;
    if (!G.hints) { if (D.credit(profile, id)) mastered.push(T.BY_ID[id]); }
    else D.meet(profile, id);
  });

  var won = B.review(profile, ev, { techCount: T.TECHS.length - 1 });
  saveProfile();

  showWin(ms, xp, won, mastered);
}

function bumpStreak(key) {
  var st = profile.streak || (profile.streak = { n: 0, best: 0, last: null });
  var y = new Date(key + "T12:00:00");
  y.setDate(y.getDate() - 1);
  var yKey = F.dailyKey(y);
  st.n = (st.last === yKey) ? st.n + 1 : 1;
  st.last = key;
  if (st.n > st.best) st.best = st.n;
}

function showWin(ms, xp, won, mastered) {
  var band = F.levelOf(G.band);
  $("winKicker").textContent = G.daily ? "the daily, finished" : "finished";
  $("winTitle").textContent = G.hints ? "Well worked out." : G.mistakes ? "Got there." : "Beautifully done.";
  var lede = G.hints
    ? "You asked " + G.hints + " time" + (G.hints > 1 ? "s" : "") + ", and every answer joined your codex."
    : G.mistakes
      ? "No hints — " + G.mistakes + " wrong turn" + (G.mistakes > 1 ? "s" : "") + " and you found them all yourself."
      : "No hints, nothing crossed out. That is the whole thing done in your head.";
  $("winLede").textContent = lede;
  $("winTime").textContent = G.zen ? "—" : fmt(ms);
  $("winBand").textContent = band.name;
  $("winXp").textContent = "+" + xp;

  var path = $("winPath");
  path.innerHTML = "";
  var ids = Object.keys(G.counts || {});
  ids.sort(function (a, b) { return (T.BY_ID[a] ? T.BY_ID[a].tier : 0) - (T.BY_ID[b] ? T.BY_ID[b].tier : 0); });
  if (!ids.length) {
    var sp0 = document.createElement("span");
    sp0.textContent = "your own way through";
    path.appendChild(sp0);
  }
  ids.forEach(function (id) {
    var t = T.BY_ID[id];
    if (!t) return;
    var sp = document.createElement("span");
    sp.textContent = t.name + (G.counts[id] > 1 ? " ×" + G.counts[id] : "");
    if (t.tier >= 2) sp.className = "hard";
    path.appendChild(sp);
  });

  var bl = $("winBadges");
  bl.innerHTML = "";
  won.forEach(function (b, n) {
    var el = document.createElement("div");
    el.className = "newbadge";
    el.innerHTML = "<em style='font-style:normal'>" + b.glyph + "</em> <span>" + b.name + " — " + b.note + "</span>";
    el.style.animationDelay = (0.3 + n * 0.25) + "s";
    bl.appendChild(el);
    setTimeout(function () { SFX.badge(); }, 400 + n * 260);
  });

  var ml = $("winMastery");
  ml.innerHTML = "";
  mastered.forEach(function (t) {
    var el = document.createElement("div");
    el.className = "newbadge";
    el.innerHTML = "<em style='font-style:normal'>★</em> <span>" + t.name + " — mastered. The room will stop explaining it.</span>";
    ml.appendChild(el);
  });

  setTimeout(function () { show("ovWin"); }, REDUCED ? 200 : 1100);
}

/* ===================== screens and overlays ===================== */
function show(id) { $(id).classList.remove("hide"); }
function hideOv(id) { $(id).classList.add("hide"); }
function closeOverlays() {
  Array.prototype.forEach.call(document.querySelectorAll(".ov"), function (o) { o.classList.add("hide"); });
  if (screen === "play" && G && !G.done && !G.running) resume();
}

function openPlay() {
  screen = "play";
  $("home").classList.add("hide");
  $("play").classList.add("on");
  closeOverlays();
  G.running = true; G.since = Date.now();
  render();
  if (!profile.seen.firstPlay) {
    profile.seen.firstPlay = 1; saveProfile();
    say("Tap a square, then a digit. If you get stuck, the hint button will name the " +
        "technique that is waiting — and teach it to you if it is new.", "welcome");
  }
}
function openHome() {
  screen = "home";
  $("play").classList.remove("on");
  $("home").classList.remove("hide");
  closeOverlays();
  if (G && !G.done) { pause(); saveGame(); }
  renderHome();
  stockSoon();
}

function pause() { if (G && G.running) { G.elapsed += Date.now() - G.since; G.running = false; } }
function resume() { if (G && !G.running && !G.done) { G.since = Date.now(); G.running = true; } }
function togglePause() {
  if (!G || G.done) return;
  if (G.running) { pause(); openMenu(); } else { closeOverlays(); resume(); }
}
function openMenu() {
  if (!G) return;
  pause(); saveGame();
  syncSwitches();
  show("ovMenu");
}

setInterval(function () {
  if (screen === "play" && G && G.running && !G.zen) $("clock").textContent = fmt(elapsedMs());
}, 250);

/* ===================== the home screen ===================== */
function renderHome() {
  var r = D.rank(profile);
  $("rankName").textContent = r.name;
  $("rankXp").textContent = r.xp + " xp";
  $("rankBar").style.width = Math.round(r.progress * 100) + "%";
  $("rankName").title = r.note;

  /* continue */
  var saved = loadSavedGame();
  var cont = $("contCard");
  if (saved) {
    cont.classList.remove("hide");
    var filled = 0, total = 0;
    var pg = S.fromString(saved.grid), pz = S.fromString(saved.puzzle);
    for (var i = 0; i < 81; i++) { if (!pz[i]) { total++; if (pg[i]) filled++; } }
    $("contTitle").textContent = "Carry on — " + bandName(saved.band) + (saved.daily ? " · daily" : "");
    $("contNote").textContent = filled + " of " + total + " squares filled in";
    $("contMeta").textContent = saved.zen ? "zen" : fmt(saved.elapsed || 0);
  } else cont.classList.add("hide");

  /* the bands */
  var list = $("bandList");
  list.innerHTML = "";
  F.LEVELS.forEach(function (L) {
    var open = D.unlocked(profile, L.id);
    var b = document.createElement("button");
    b.className = "band" + (open ? "" : " locked");
    var solved = profile.solves[L.id] || 0;
    var best = profile.best[L.id];
    var dots = "";
    for (var n = 0; n < 5; n++) dots += "<i class='" + (n <= L.tier ? "on" : "") + "'></i>";
    b.innerHTML = "<span class='dots'>" + dots + "</span>" +
      "<span><b>" + L.name + "</b><small>" + L.note + "</small></span>" +
      "<span class='meta'>" + (open
        ? (solved ? solved + " solved" + (best ? "<br>best " + fmt(best) : "") : "not yet")
        : "2 " + bandName(F.LEVELS[F.LEVELS.indexOf(L) - 1].id) + "<br>first") + "</span>";
    press(b, function () {
      if (!open) {
        toast("Finish two " + bandName(F.LEVELS[F.LEVELS.indexOf(L) - 1].id) +
              " puzzles first — or press again to go in anyway.");
        D.force(profile, L.id); saveProfile();
        renderHome();
        return;
      }
      startBand(L.id, {});
    });
    list.appendChild(b);
  });

  /* the daily */
  var key = F.dailyKey(), lvl = F.dailyLevel();
  var done = profile.dailyDone[key];
  $("dailyNote").textContent = done
    ? "today's is done — " + fmt(done) + ". Come back tomorrow."
    : "today is " + bandName(lvl) + ". One puzzle, the same for everyone.";
  $("dailyMeta").innerHTML = (profile.streak.n || 0) + " day" +
    ((profile.streak.n || 0) === 1 ? "" : "s") + "<br>streak";
  var dots = $("streakDots");
  dots.innerHTML = "";
  for (var d = 6; d >= 0; d--) {
    var day = new Date();
    day.setDate(day.getDate() - d);
    var i2 = document.createElement("i");
    if (profile.dailyDone[F.dailyKey(day)]) i2.className = "on";
    dots.appendChild(i2);
  }

  $("wallNote").textContent = B.earned(profile) + " of " + B.count + " noticed";
  var met = D.countAt(profile, 1);
  $("toDojo").querySelector("small").textContent =
    met ? met + " of " + (T.TECHS.length - 1) + " techniques met · " + D.countAt(profile, 3) + " mastered"
        : "nineteen techniques, each with a real position to practise on";
}

/* Take one from the cupboard, or cut a fresh one while you watch the
   progress. Never blocks the frame. */
function startBand(band, opts) {
  var got = takeFromCupboard(band);
  if (got) { prefs.lastBand = band; savePrefs(); newGame(got, opts); return; }
  forgeThen(band, opts.seed, function (r) {
    prefs.lastBand = band; savePrefs();
    newGame(r, opts);
  }, opts);
}

function forgeThen(band, seed, done, opts) {
  var job = F.job({ level: band, seed: seed });
  toast("cutting a fresh " + bandName(band) + "…", 6000);
  (function tick() {
    var more = job.tick(10);
    job.drain();
    if (more) { requestAnimationFrame(tick); return; }
    job.spares.forEach(fileAway);
    saveCupboard();
    if (job.result.band !== band && !(opts && opts.daily)) {
      toast("that grid came out " + bandName(job.result.band) + " — the room won't mislabel it");
    } else if (!(opts && opts.daily)) toast("");
    done(job.result);
  })();
}

/* ===================== the daily ===================== */
function startDaily() {
  var key = F.dailyKey(), lvl = F.dailyLevel();
  var cached = null;
  try { cached = JSON.parse(lsGet(DAILY_KEY) || "null"); } catch (e) {}
  if (cached && cached.key === key) {
    newGame(cached.rec, { daily: true, dailyKey: key });
    return;
  }
  forgeThen(lvl, F.dailySeed(), function (r) {
    var rec = {
      puzzle: S.toString(r.puzzle), solution: S.toString(r.solution),
      band: r.band, tier: r.tier, counts: r.counts, clues: r.clues
    };
    lsSet(DAILY_KEY, JSON.stringify({ key: key, rec: rec }));
    newGame(rec, { daily: true, dailyKey: key });
  }, { daily: true });
}

/* ===================== The Forge =====================
   The screen that made this room worth building: the generator, out
   loud, at whatever pace you can follow. */
var forgeCells = [], forgeJob = null, forgeQueue = [], forgeTimer = null,
    forgeBand = "tricky", forgeSpeed = 1, forgeResult = null, forgeGrid = null,
    forgeCounters = { attempt: 0, removed: 0, kept: 0, clues: 81, steps: 0 };
/* Watching every rejected grid at reading speed would take all evening,
   so the slower speeds also ask the forge to give up sooner — and the
   room says out loud when that is why it settled for a nearby band. */
var SPEEDS = [
  { name: "slow", ms: 110, per: 1, attempts: 4 },
  { name: "measured", ms: 26, per: 1, attempts: 8 },
  { name: "quick", ms: 14, per: 6, attempts: 30 },
  { name: "at once", ms: 0, per: 4000, attempts: 0 }
];

function buildForgeBoard() {
  var el = $("forgeBoard");
  el.innerHTML = "";
  forgeCells = [];
  for (var i = 0; i < 81; i++) {
    var c = document.createElement("div");
    c.className = "fc empty";
    el.appendChild(c);
    forgeCells.push(c);
  }
}
function forgeSet(i, d, cls) {
  var c = forgeCells[i];
  c.textContent = d ? String(d) : "";
  c.className = "fc" + (d ? "" : " empty") + (cls ? " " + cls : "");
}
function forgeNarrate(title, text) {
  $("forgeNarr").innerHTML = "<b>" + title + "</b>" + text;
}
function forgeLog(title, text) {
  var l = $("forgeLedger");
  var d = document.createElement("div");
  d.innerHTML = "<i>" + title + "</i><span>" + text + "</span>";
  l.insertBefore(d, l.firstChild);
  while (l.childNodes.length > 40) l.removeChild(l.lastChild);
}
function forgeStats() {
  $("forgeStats").innerHTML =
    "<span>attempt <b>" + forgeCounters.attempt + "</b></span>" +
    "<span>clues <b>" + forgeCounters.clues + "</b></span>" +
    "<span>taken <b>" + forgeCounters.removed + "</b></span>" +
    "<span>put back <b>" + forgeCounters.kept + "</b></span>" +
    "<span>steps <b>" + forgeCounters.steps + "</b></span>";
}

function startForge() {
  stopForge();
  buildForgeBoard();
  forgeGrid = S.empty();
  forgeResult = null;
  forgeCounters = { attempt: 0, removed: 0, kept: 0, clues: 0, steps: 0 };
  $("forgeLedger").innerHTML = "";
  $("forgePlay").classList.add("hide");
  $("forgeStart").textContent = "stop";
  forgeJob = F.job({ level: forgeBand, maxAttempts: SPEEDS[forgeSpeed].attempts || undefined });
  forgeQueue = [];
  pumpForge();
}
function stopForge() {
  clearTimeout(forgeTimer); forgeTimer = null;
  forgeJob = null; forgeQueue = [];
  $("forgeStart").textContent = "forge one";
}

function pumpForge() {
  if (!forgeJob) return;
  var sp = SPEEDS[forgeSpeed];
  /* Keep the queue fed, but never do more work per frame than a frame
     can afford. */
  var guard = 0;
  while (forgeQueue.length < sp.per * 3 && !forgeJob.done && guard++ < 40) {
    forgeJob.tick(4);
    forgeQueue = forgeQueue.concat(forgeJob.drain());
  }
  if (forgeJob.done) forgeQueue = forgeQueue.concat(forgeJob.drain());

  for (var n = 0; n < sp.per && forgeQueue.length; n++) playForgeEvent(forgeQueue.shift());

  if (forgeQueue.length || (forgeJob && !forgeJob.done)) {
    forgeTimer = setTimeout(function () { requestAnimationFrame(pumpForge); }, sp.ms);
  } else {
    forgeTimer = null;
  }
  forgeStats();
}

function playForgeEvent(e) {
  if (e.t === "stage") {
    if (e.stage === "fill") {
      forgeCounters.attempt = e.attempt;
      forgeCounters.removed = 0; forgeCounters.kept = 0; forgeCounters.steps = 0;
      forgeCounters.clues = 0;
      forgeGrid = S.empty();
      buildForgeBoard();
      forgeNarrate("1 · fill", "A blank grid, filled at random — but every digit placed strikes " +
        "itself out of the twenty squares that can see it, and squares with one possibility left " +
        "fall out on their own. That cascade does nearly all the work.");
    } else if (e.stage === "dig") {
      forgeNarrate("2 · dig", e.second
        ? "Still not hard enough. The symmetry goes, and the room takes clues one at a time now."
        : "Now take clues away. Each one is tested twice: does the puzzle still have exactly " +
          "<i>one</i> answer, and can " + bandName(forgeBand) + "'s techniques still finish it? " +
          "Fail either and the clue goes back." + (e.symmetric ? " Removals come in symmetric pairs." : ""));
    } else if (e.stage === "grade") {
      forgeCounters.clues = e.clues;
      forgeNarrate("3 · grade", "Now solve it the way a person would — simplest available step, " +
        "over and over — and let the hardest thing it needed name the band.");
    }
    return;
  }
  if (e.t === "place") {
    forgeGrid[e.i] = e.d;
    forgeSet(e.i, e.d, e.auto ? "auto" : "");
    forgeCounters.clues = S.countClues(forgeGrid);
    return;
  }
  if (e.t === "back") {
    var g = S.fromString(e.grid);
    if (g) { forgeGrid = g; for (var i = 0; i < 81; i++) forgeSet(i, forgeGrid[i], ""); }
    return;
  }
  if (e.t === "test") {
    e.cells.forEach(function (c) { forgeSet(c, forgeGrid[c], "testing"); });
    return;
  }
  if (e.t === "removed") {
    e.cells.forEach(function (c) { forgeGrid[c] = 0; forgeSet(c, 0, "gone"); });
    forgeCounters.removed += e.cells.length;
    forgeCounters.clues = e.clues;
    return;
  }
  if (e.t === "kept") {
    forgeCounters.kept += e.cells.length;
    e.cells.forEach(function (c) { forgeSet(c, forgeGrid[c], "kept"); });
    setTimeout(function () { e.cells.forEach(function (c) { forgeSet(c, forgeGrid[c], ""); }); }, 260);
    forgeLog(S.cellName(e.cells[0]) + " stays",
      e.why === "two" ? "taking it would leave two answers" : "taking it would need harder logic than " + bandName(forgeBand));
    return;
  }
  if (e.t === "step") {
    forgeCounters.steps++;
    (e.cells || []).forEach(function (c) {
      forgeCells[c].classList.add("step");
      setTimeout(function () { forgeCells[c].classList.remove("step"); }, 260);
    });
    /* Only the notable steps go in the ledger — a hundred lines of
       "naked single" is not a reasoning trace, it is wallpaper. */
    if (e.tier >= 2) forgeLog(e.name, "step " + forgeCounters.steps + " of the grade");
    return;
  }
  if (e.t === "verdict") {
    forgeLog("verdict", e.bandName + ", " + e.clues + " clues, score " + e.score +
      (e.ok ? " — kept" : " — wanted " + bandName(forgeBand) + ", thrown away"));
    return;
  }
  if (e.t === "retry") {
    forgeNarrate("again", "Not what was asked for. The whole grid goes in the bin and the room starts over. " +
      "This is normal: a puzzle of a given difficulty is a needle, and this is the haystack.");
    return;
  }
  if (e.t === "done") {
    forgeResult = e.result;
    var r = e.result;
    for (var k = 0; k < 81; k++) forgeSet(k, r.puzzle[k], r.puzzle[k] ? "" : "gone");
    var missed = r.band !== forgeBand;
    forgeNarrate("finished", "A " + bandName(r.band) + " puzzle in " + r.clues + " clues, after " +
      r.attempt + " attempt" + (r.attempt > 1 ? "s" : "") + ". It has exactly one answer, and every " +
      "step of it can be reasoned — the hardest thing it needs is " +
      (T.BY_ID[r.hardestId] ? T.BY_ID[r.hardestId].name.toLowerCase() : "a single") + "." +
      (missed ? " You asked for " + bandName(forgeBand) + " and this is not one: at this speed the room " +
        "only allowed itself " + r.attempt + " grids, and none of them bit hard enough. It is labelled " +
        "for what it is. Turn the speed up and it will keep looking." : ""));
    $("forgePlay").classList.remove("hide");
    $("forgeStart").textContent = "forge another";
    forgeJob = null;
    fileAway(r);
    saveCupboard();
    var won = B.review(profile, { type: "forge", attempts: r.attempt, band: r.band });
    if (won.length) { saveProfile(); toast("★ " + won[0].name + " — " + won[0].note); SFX.badge(); }
    profile.totals.forged++;
    saveProfile();
    return;
  }
}

/* ===================== The Codex ===================== */
function renderCodex() {
  var list = $("codexList");
  list.innerHTML = "";
  var lastTier = -1;
  D.codex(profile).forEach(function (e) {
    if (e.tier !== lastTier) {
      lastTier = e.tier;
      var h = document.createElement("div");
      h.className = "tierhead";
      h.innerHTML = "<span>" + e.band.name + "</span><small>" + e.band.note + "</small>";
      list.appendChild(h);
    }
    var b = document.createElement("button");
    b.className = "tech" + (e.state === 0 ? " unmet" : "");
    var stars = ["·", "✦", "✦✦", "★★★"][e.state];
    b.innerHTML = "<span><b>" + e.name + "</b><small>" +
      (e.state === 0 ? "not met yet — open it to read the idea" : e.hint) +
      "</small></span><span class='stars'>" + stars + "</span>";
    press(b, function () { openLesson(e.id, 0); });
    list.appendChild(b);
  });
  $("dojoCount").textContent = D.countAt(profile, 1) + "/" + (T.TECHS.length - 1) + " met";
}

/* ===================== a lesson ===================== */
var lessonCells = null, lessonNow = null, lessonFound = {}, lessonShown = false;
function openLesson(techId, n) {
  var L = D.lesson(techId, n);
  var tech = T.BY_ID[techId];
  $("lessonTitle").textContent = tech.name;
  $("lessonIdea").textContent = tech.idea;
  if (!lessonCells) lessonCells = buildBoard($("lessonBoard"));
  if (D.meet(profile, techId)) saveProfile();

  if (!L) {
    lessonNow = null;
    $("lessonPrompt").innerHTML = "<b>no position</b>The room has no worked position for this one — " +
      "it is the last resort, and no puzzle it ships ever needs it.";
    paint(lessonCells, { grid: S.empty(), pencil: new Uint16Array(81) });
    drawLinks($("lessonLinks"), null);
    $("lessonReveal").classList.add("hide");
    $("lessonApply").classList.add("hide");
    $("lessonNext").classList.add("hide");
    show("ovLesson");
    return;
  }
  $("lessonReveal").classList.remove("hide");
  $("lessonApply").classList.remove("hide");
  $("lessonNext").classList.toggle("hide", L.count < 2);

  lessonNow = L;
  lessonFound = {};
  lessonShown = false;
  $("lessonState").textContent = D.STATE_NAME[D.level(profile, techId)];
  $("lessonPrompt").innerHTML = "<b>find it</b>" + promptFor(L);
  paintLesson();
  show("ovLesson");
}

function promptFor(L) {
  var n = L.step.focus.length;
  return "Somewhere on this grid is " + article(L.tech.name) + " " + L.tech.name.toLowerCase() +
    (L.step.digits && L.step.digits.length ? " on " + L.step.digits.join(" and ") : "") +
    ". Tap the " + n + " square" + (n > 1 ? "s" : "") + " it lives in — every legal candidate is " +
    "already pencilled in for you." + (L.alsoSimpler ? " (There is an easier move on this board too; look past it.)" : "");
}
function article(name) { return /^[AEIOUX]/.test(name) ? "an" : "a"; }

function paintLesson() {
  if (!lessonNow) return;
  var st = lessonNow.state, step = lessonNow.step;
  var pat = {}, cut = {}, hi = {};
  if (lessonShown) {
    step.focus.forEach(function (c) { pat[c] = 1; });
    (step.elim || []).forEach(function (e) { cut[e.i] = (cut[e.i] || 0) | BIT[e.d]; });
    (step.place || []).forEach(function (p) { hi[p.i] = (hi[p.i] || 0) | BIT[p.d]; });
    step.focus.forEach(function (c) {
      (step.digits || []).forEach(function (d) { hi[c] = (hi[c] || 0) | BIT[d]; });
    });
  } else {
    Object.keys(lessonFound).forEach(function (c) { pat[c] = 1; });
  }
  var given = new Uint8Array(81);
  for (var i = 0; i < 81; i++) given[i] = st.g[i] ? 1 : 0;
  paint(lessonCells, { grid: st.g, given: given, pencil: st.c, pat: pat, cut: cut, hi: hi, sel: -1 });
  drawLinks($("lessonLinks"), lessonShown ? step.links : null);
}

$("lessonBoard").addEventListener("pointerdown", function (e) {
  if (!lessonNow || lessonShown) return;
  var el = e.target.closest ? e.target.closest(".cell") : null;
  if (!el) return;
  e.preventDefault();
  var i = +el.dataset.i;
  if (lessonNow.step.focus.indexOf(i) >= 0) {
    if (lessonFound[i]) return;
    lessonFound[i] = 1;
    SFX.place(3);
    paintLesson();
    if (Object.keys(lessonFound).length === lessonNow.step.focus.length) {
      lessonShown = true;
      if (D.practise(profile, lessonNow.tech.id)) saveProfile();
      $("lessonState").textContent = D.STATE_NAME[D.level(profile, lessonNow.tech.id)];
      $("lessonPrompt").innerHTML = "<b>found it, unaided</b>" + lessonNow.step.text;
      SFX.unit();
      profile.totals.lessons++;
      saveProfile();
      paintLesson();
    }
  } else {
    el.classList.add("shake");
    SFX.bad();
    setTimeout(function () { el.classList.remove("shake"); }, 300);
  }
});

/* ===================== The Wall ===================== */
function renderWall() {
  var list = $("wallList");
  list.innerHTML = "";
  B.LIST.forEach(function (b) {
    var got = !!profile.badges[b.id];
    var el = document.createElement("div");
    el.className = "badge" + (got ? " got" : "");
    el.innerHTML = "<em>" + (got ? b.glyph : "·") + "</em><b>" + b.name + "</b><small>" + b.note + "</small>";
    list.appendChild(el);
  });
  $("wallCount").textContent = B.earned(profile) + "/" + B.count;
}

/* ===================== switches ===================== */
function syncSwitches() {
  [["sSound", "sound"], ["sCheck", "check"], ["sHighlight", "highlight"],
   ["sEcho", "echo"], ["sAuto", "autoPrune"], ["sSlate", "slate"]].forEach(function (p) {
    $(p[0]).classList.toggle("on", !!prefs[p[1]]);
  });
}
function wireSwitch(id, key, after) {
  press($(id), function () {
    prefs[key] = !prefs[key];
    savePrefs(); syncSwitches();
    if (after) after();
  });
}

/* ===================== wiring ===================== */
press($("backBtn"), openHome);
press($("menuBtn"), openMenu);
press($("pauseBtn"), togglePause);
press($("menuClose"), function () { closeOverlays(); });
press($("mResume"), function () { closeOverlays(); });
press($("mLeave"), function () { closeOverlays(); openHome(); });
press($("mHow"), function () { show("ovHow"); });
press($("howClose"), function () { hideOv("ovHow"); });
press($("toHow"), function () { show("ovHow"); });
press($("mRestart"), function () {
  if (!G) return;
  G.grid = S.clone(G.puzzle); G.pencil = new Uint16Array(81);
  G.wrong = new Uint8Array(81); G.history = []; G.elapsed = 0; G.since = Date.now();
  G.hints = 0; G.mistakes = 0; G.undos = 0; G.pencilUsed = 0; G.sel = -1;
  clearHint(); closeOverlays(); resume(); render(); saveGame();
});
press($("mNew"), function () {
  if (!G) return;
  var band = G.band, zen = G.zen;
  closeOverlays();
  G.done = true;
  try { localStorage.removeItem(GAME_KEY); } catch (e) {}
  startBand(band, { zen: zen });
});
press($("mCheck"), function () {
  if (!G) return;
  var n = 0;
  for (var i = 0; i < 81; i++) {
    G.wrong[i] = (!G.given[i] && G.grid[i] && G.grid[i] !== G.solution[i]) ? 1 : 0;
    if (G.wrong[i]) n++;
  }
  closeOverlays(); resume(); render();
  toast(n ? n + " square" + (n > 1 ? "s" : "") + " disagree with the answer" : "everything you have written is right");
});

wireSwitch("sSound", "sound");
wireSwitch("sCheck", "check", function () { if (G) { markWrong(); render(); } });
wireSwitch("sHighlight", "highlight", render);
wireSwitch("sEcho", "echo", render);
wireSwitch("sAuto", "autoPrune");
wireSwitch("sSlate", "slate", function () { document.body.classList.toggle("slate", prefs.slate); });

press($("toolPencil"), togglePencil);
press($("toolAuto"), fillNotes);
press($("toolErase"), function () { if (G && G.sel >= 0) clearCell(G.sel); });
press($("toolUndo"), undo);
press($("toolHint"), hint);

press($("contCard"), function () {
  var g = loadSavedGame();
  if (g) resumeGame(g);
});
press($("dailyCard"), startDaily);
press($("toZen"), function () { startBand(prefs.lastBand || "steady", { zen: true }); });

press($("toForge"), function () {
  show("ovForge");
  if (!forgeCells.length) buildForgeBoard();
  $("forgeBandChip").textContent = bandName(forgeBand);
});
press($("forgeClose"), function () { stopForge(); hideOv("ovForge"); stockSoon(); });
press($("forgeStart"), function () {
  if (forgeJob || forgeTimer) { stopForge(); forgeNarrate("stopped", "Stopped. Press forge to start a new one."); }
  else startForge();
});
press($("forgeBandBtn"), function () {
  var ids = F.LEVELS.map(function (L) { return L.id; });
  forgeBand = ids[(ids.indexOf(forgeBand) + 1) % ids.length];
  $("forgeBandChip").textContent = bandName(forgeBand);
});
press($("forgeSpeed"), function () {
  forgeSpeed = (forgeSpeed + 1) % SPEEDS.length;
  $("forgeSpeed").textContent = "speed: " + SPEEDS[forgeSpeed].name;
});
press($("forgePlay"), function () {
  if (!forgeResult) return;
  var r = forgeResult;
  stopForge(); hideOv("ovForge");
  newGame({
    puzzle: r.puzzle, solution: r.solution, band: r.band,
    tier: r.tier, counts: r.counts, clues: r.clues
  }, {});
});

press($("toDojo"), function () { renderCodex(); show("ovDojo"); });
press($("dojoClose"), function () { hideOv("ovDojo"); renderHome(); });
press($("lessonClose"), function () { hideOv("ovLesson"); renderCodex(); });
press($("lessonReveal"), function () {
  if (!lessonNow) return;
  lessonShown = true;
  $("lessonPrompt").innerHTML = "<b>" + lessonNow.tech.name + "</b>" + lessonNow.step.text;
  paintLesson();
});
press($("lessonApply"), function () {
  if (!lessonNow) return;
  lessonShown = true;
  T.apply(lessonNow.state, lessonNow.step);
  $("lessonPrompt").innerHTML = "<b>done</b>" +
    (lessonNow.step.place.length ? "Written in. " : "Rubbed out. ") +
    "That is one step of a solve — the room does exactly this, nineteen ways, when you ask for a hint.";
  lessonShown = false;
  paintLesson();
  SFX.place(5);
});
press($("lessonNext"), function () {
  if (!lessonNow) return;
  openLesson(lessonNow.tech.id, lessonNow.index + 1);
});

press($("toWall"), function () { renderWall(); show("ovWall"); });
press($("wallClose"), function () { hideOv("ovWall"); renderHome(); });

press($("winAgain"), function () {
  var band = G ? G.band : prefs.lastBand;
  var zen = G ? G.zen : false;
  hideOv("ovWin");
  startBand(band, { zen: zen });
});
press($("winHome"), function () { hideOv("ovWin"); openHome(); });

document.addEventListener("visibilitychange", function () {
  if (document.hidden) { if (G && G.running) { pause(); saveGame(); } }
  else if (screen === "play" && G && !G.done && !document.querySelector(".ov:not(.hide)")) resume();
});
window.addEventListener("beforeunload", function () { if (G && !G.done) saveGame(); });

/* ===================== boot ===================== */
document.body.classList.toggle("slate", prefs.slate);
syncSwitches();
$("forgeSpeed").textContent = "speed: " + SPEEDS[forgeSpeed].name;
renderHome();
stockSoon();

/* deep links: /sudoku/#forge, #codex, #wall, #daily */
(function route() {
  var h = (location.hash || "").replace("#", "");
  if (h === "forge") { show("ovForge"); buildForgeBoard(); }
  else if (h === "codex") { renderCodex(); show("ovDojo"); }
  else if (h === "wall") { renderWall(); show("ovWall"); }
  else if (h === "daily") startDaily();
})();

/* offline play, and a quiet word when a new version lands */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then(function (reg) {
    reg.addEventListener("updatefound", function () {
      var w = reg.installing;
      if (!w) return;
      w.addEventListener("statechange", function () {
        if (w.state === "installed" && navigator.serviceWorker.controller) $("updateBar").classList.remove("hide");
      });
    });
  }).catch(function () {});
  press($("updateBtn"), function () {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.getRegistration().then(function (r) {
        if (r && r.waiting) r.waiting.postMessage({ type: "SKIP_WAITING" });
        setTimeout(function () { location.reload(); }, 250);
      });
    } else location.reload();
  });
}

/* A handle for the smoke tests — and for anyone curious enough to open
   the console, which is the sort of person this room is for. */
window.__sudoku = function () {
  return { G: G, profile: profile, prefs: prefs, cupboard: cupboard,
           place: place, hint: hint, startBand: startBand, finish: finish,
           forgeJob: function () { return forgeJob; } };
};
})();
