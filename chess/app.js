/* app.js — the room itself.
   Game flow for three ways to play (pass & play, the coach, nearby),
   the tournament clock, the gentle coach, opening stories, history
   browsing, persistence, and the self-healing boot. The rules live in
   engine.js; the boards live in gfx2d.js / gfx3d.js; the nearby link
   lives in net.js; the openings live in book.js. This file only
   conducts. */
/* global Chess, Book, Eco, Gfx2D, Gfx3D, Net */
(function () {
"use strict";

function $(id) { return document.getElementById(id); }
var REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ===== self-healing: catch trouble before it strands anyone ===== */
var errTimes = [];
function panic() {
  var ov = $("ovRecover");
  if (ov) ov.classList.remove("hide");
}
window.addEventListener("error", function () {
  var now = Date.now();
  errTimes.push(now);
  errTimes = errTimes.filter(function (t) { return now - t < 8000; });
  if (errTimes.length >= 3) panic();
});
window.addEventListener("unhandledrejection", function () { /* logged errors only; never strand */ });

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

var PREF_KEY = "chessroom_prefs", SAVE_KEY = "chessroom_save";

/* ===== preferences ===== */
var prefs = { theme: "walnut", use3d: true, sound: true, coach: true, helpers: true, clockSkin: "simple", name: "" };
(function () {
  try {
    var p = JSON.parse(lsGet(PREF_KEY) || "{}");
    for (var k in prefs) if (p[k] !== undefined) prefs[k] = p[k];
  } catch (e) {}
  if (location.hash === "#force2d") { prefs.use3d = false; }
})();
function savePrefs() { lsSet(PREF_KEY, JSON.stringify(prefs)); }

/* ===== sound (synthesized, tiny, optional) ===== */
var AC = null;
function ac() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (AC && AC.state === "suspended") AC.resume().catch(function () {});
  return AC;
}
function tone(freq, dur, type, vol, when, sweep) {
  var c = ac(); if (!c) return;
  var o = c.createOscillator(), g = c.createGain(), t = c.currentTime + (when || 0);
  o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
  if (sweep) o.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function snd(kind) {
  if (!prefs.sound) return;
  switch (kind) {
    case "move": tone(190, 0.07, "triangle", 0.10, 0, 150); break;
    case "capture": tone(120, 0.11, "triangle", 0.15, 0, 70); tone(320, 0.05, "sine", 0.05); break;
    case "castle": tone(190, 0.06, "triangle", 0.09); tone(190, 0.06, "triangle", 0.09, 0.09); break;
    case "check": tone(660, 0.16, "sine", 0.08); tone(880, 0.2, "sine", 0.06, 0.08); break;
    case "promo": tone(523, 0.12, "sine", 0.08); tone(659, 0.12, "sine", 0.08, 0.1); tone(784, 0.2, "sine", 0.08, 0.2); break;
    case "win": tone(523, 0.15, "sine", 0.09); tone(659, 0.15, "sine", 0.09, 0.14); tone(784, 0.3, "sine", 0.1, 0.28); break;
    case "lose": tone(330, 0.2, "sine", 0.08); tone(262, 0.35, "sine", 0.08, 0.18); break;
    case "draw": tone(392, 0.2, "sine", 0.07); tone(392, 0.25, "sine", 0.07, 0.22); break;
    case "tick": tone(1100, 0.03, "square", 0.03); break;
    case "link": tone(523, 0.09, "sine", 0.08); tone(784, 0.14, "sine", 0.08, 0.09); break;
    case "hint": tone(587, 0.1, "sine", 0.06); break;
  }
}

/* ===== toast — the one funnel for every message ===== */
var toastTimer = 0;
function toast(html, actions, ms) {
  var el = $("toast");
  el.innerHTML = html;
  if (actions) {
    var row = document.createElement("div");
    actions.forEach(function (a) {
      var b = document.createElement("button");
      b.className = "tact" + (a.ghost ? " ghost" : "");
      b.textContent = a.label;
      b.addEventListener("click", function () { hideToast(); a.fn(); });
      row.appendChild(b);
    });
    el.appendChild(row);
  }
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms || (actions ? 9000 : 4200));
}
function hideToast() { $("toast").classList.remove("show"); }

/* ===== renderers ===== */
var R2 = null, R3 = null, R = null;
function initRenderers() {
  R2 = Gfx2D.create($("cv2"));
  if (prefs.use3d) {
    try {
      R3 = Gfx3D.create($("cv3"), { onContextLost: function () { switchDim(false, true); } });
    } catch (e) { R3 = null; }
  }
  if (!R3 && prefs.use3d) prefs.use3d = false;
  useRenderer(prefs.use3d && R3 ? R3 : R2);
  syncDimButton();
}
function useRenderer(r) {
  R = r;
  $("cv3").classList.toggle("hide", R !== R3);
  $("cv2").classList.toggle("hide", R !== R2);
  R.setTheme(prefs.theme);
  R.setOrientation(orientation);
  R.resize();
  if (G) { R.setPosition(currentViewBoard()); syncBoard(); }
  needFrame();
}
function switchDim(to3d, becauseLost) {
  if (to3d && !R3) {
    try { R3 = Gfx3D.create($("cv3"), { onContextLost: function () { switchDim(false, true); } }); } catch (e) { R3 = null; }
    if (!R3) { toast("3D isn't available on this device — the 2D board is just as sharp."); return; }
  }
  prefs.use3d = !!(to3d && R3); savePrefs();
  useRenderer(prefs.use3d ? R3 : R2);
  syncDimButton();
  if (becauseLost) toast("The 3D view stumbled, so the game moved to the 2D board — nothing was lost. You can try 3D again from the button below.");
}
function syncDimButton() {
  $("dimLbl").textContent = prefs.use3d ? "3D" : "2D";
  $("dimIc").textContent = prefs.use3d ? "③" : "②";
}

/* ===== game state ===== */
var G = null;                  /* the Chess game object */
var mode = null;               /* 'pass' | 'coach' | 'lan' | 'tour' */
var over = null;               /* {result, reason} once finished */
var humanSide = 1;             /* coach mode: which colour is the person */
var skill = "sprout";
var lanSide = 1, lanMy = "", lanOpp = "Friend", lanCfg = null;
var orientation = 1;
var sel = -1, legalMoves = [];
var viewPly = -1;              /* -1 = live; else index into G.played shown */
var pendingPromo = null;       /* {from, to} awaiting picker */
var hintArrow = null;
var lastNarratedOpening = "";
var tourTimer = 0, tourLine = null, tourStep = 0;
var coachTimer = 0, thinking = false;
var principleN = 0;

var SKILLS = {
  sprout: { ms: 130, maxDepth: 2, noise: 130, label: "Coach 🌱" },
  club:   { ms: 320, maxDepth: 3, noise: 45,  label: "Coach 🌿" },
  mentor: { ms: 900, maxDepth: 64, noise: 0,  label: "Coach 🌳" }
};

/* ===== clock ===== */
var clock = { on: false, base: 0, inc: 0, w: 0, b: 0, run: 0 /* 0 none, 1 white, -1 black */, lastT: 0, lowTicked: -1 };
function clockConfig(str) {
  if (!str || str === "none") { clock.on = false; return; }
  var m = str.split("+");
  clock.on = true;
  clock.base = (+m[0]) * 60000;
  clock.inc = (+(m[1] || 0)) * 1000;
  clock.w = clock.base; clock.b = clock.base;
  clock.run = 0; clock.lowTicked = -1;
}
function fmtClock(ms) {
  if (ms < 0) ms = 0;
  var s = Math.ceil(ms / 1000);
  if (ms < 20000) { /* show tenths under 20s, the tournament way */
    return (ms / 1000).toFixed(1);
  }
  var mm = Math.floor(s / 60), ss = s % 60;
  if (mm >= 60) return Math.floor(mm / 60) + ":" + String(mm % 60).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  return mm + ":" + String(ss).padStart(2, "0");
}
function clockTick(now) {
  if (!clock.on || !clock.run || over || !G) return;
  var dt = now - clock.lastT;
  clock.lastT = now;
  if (dt <= 0 || dt > 3000) return;
  if (clock.run === 1) clock.w -= dt; else clock.b -= dt;
  var ms = clock.run === 1 ? clock.w : clock.b;
  if (ms <= 10500 && ms > 0) {
    var sec = Math.ceil(ms / 1000);
    if (sec !== clock.lowTicked) { clock.lowTicked = sec; snd("tick"); }
  }
  if (ms <= 0) flagFall(clock.run);
  syncClocks();
}
function flagFall(side) {
  if (over) return;
  /* the pro rule: a flag falls to a WIN only if the other side could
     still in principle mate; otherwise it's a draw */
  var other = -side;
  var winner = sideHasMatingMaterial(other) ? other : 0;
  endGame(winner === 0 ? "draw" : (winner === 1 ? "white" : "black"),
    winner === 0 ? "time out — but " + sideName(other) + " had no way to mate, so it's a draw (the real rule!)" : "time out");
}
function sideHasMatingMaterial(side) {
  var n = 0, i, p;
  for (i = 0; i < 128; i++) {
    if (i & 0x88) continue;
    p = G.board[i];
    if (!p || (p > 0 ? 1 : -1) !== side) continue;
    var k = Math.abs(p);
    if (k === Chess.P || k === Chess.R || k === Chess.Q) return true;
    if (k !== Chess.K) n++;
    if (n >= 2) return true;
  }
  return false;
}
function afterMoveClock(mover) {
  if (!clock.on) return;
  if (mover === 1) clock.w += clock.inc; else clock.b += clock.inc;
  clock.lowTicked = -1;
  /* the first press starts the opponent's clock; before each side's first
     move, its time doesn't run (the friendly online convention) */
  clock.run = (G.played.length >= 1 && !over) ? G.turn : 0;
  clock.lastT = performance.now();
  syncClocks();
}
function syncClocks() {
  var topSide = -orientation, botSide = orientation;
  var ct = $("clockTop"), cb = $("clockBot");
  [[ct, topSide], [cb, botSide]].forEach(function (pair) {
    var el = pair[0], side = pair[1];
    el.classList.toggle("off", !clock.on);
    if (!clock.on) return;
    var ms = side === 1 ? clock.w : clock.b;
    el.textContent = fmtClock(ms);
    el.classList.toggle("run", clock.run === side && !over);
    el.classList.toggle("low", ms < 20000);
    el.classList.toggle("flag", ms <= 0);
  });
}

/* ===== names, bars, captured ===== */
function sideName(side) {
  if (mode === "coach") return side === humanSide ? "You" : SKILLS[skill].label;
  if (mode === "lan") return side === lanSide ? (lanMy || "You") : lanOpp;
  return side === 1 ? "White" : "Black";
}
var GLYPH = { 1: "♙", 2: "♘", 3: "♗", 4: "♖", 5: "♕", 6: "♔" };
var GLYPHB = { 1: "♟", 2: "♞", 3: "♝", 4: "♜", 5: "♛", 6: "♚" };
function syncBars() {
  var topSide = -orientation, botSide = orientation;
  function tag(side) {
    var n = sideName(side), c = side === 1 ? "White" : "Black";
    return n === c ? n : n + " · " + c;
  }
  $("nameTop").textContent = tag(topSide);
  $("nameBot").textContent = tag(botSide);
  /* captured pieces: what each side has taken, plus the material lead */
  var takenByW = [], takenByB = [], diff = 0;
  if (G) G.played.forEach(function (rec) {
    var c = rec.m.capt;
    if (!c) return;
    var k = Math.abs(c);
    diff += (c < 0 ? 1 : -1) * Chess.VAL[k];
    (c < 0 ? takenByW : takenByB).push(k);
    if (rec.m.promo) diff += 0; /* promo material shows up via board, keep simple */
  });
  var wStr = takenByW.sort().map(function (k) { return GLYPHB[k]; }).join("");
  var bStr = takenByB.sort().map(function (k) { return GLYPH[k]; }).join("");
  var wLead = diff > 0 ? " +" + Math.round(diff / 100) : "";
  var bLead = diff < 0 ? " +" + Math.round(-diff / 100) : "";
  $("capTop").textContent = (topSide === 1 ? wStr + wLead : bStr + bLead);
  $("capBot").textContent = (botSide === 1 ? wStr + wLead : bStr + bLead);
}
function syncTurnStrip() {
  var el = $("turnStrip");
  if (!G) { el.textContent = "…"; return; }
  if (viewPly >= 0) { el.innerHTML = "<b>Looking back</b> — move " + Math.floor(viewPly / 2 + 1); return; }
  if (over) { el.innerHTML = "<b>" + endShort() + "</b>"; return; }
  var st = Chess.status(G);
  var who = sideName(G.turn);
  if (thinking) el.innerHTML = "<b>" + who + "</b> is thinking…";
  else el.innerHTML = "<b>" + who + (who === "You" ? "r" : "'s") + " move</b>" + (st.reason === "check" ? " — <b style='color:var(--bad)'>check!</b>" : "");
}
function endShort() {
  if (!over) return "";
  if (over.result === "draw") return "Drawn — " + over.reason;
  return (over.result === "white" ? "White" : "Black") + " wins — " + over.reason;
}

/* ===== board sync & input ===== */
function currentViewBoard() {
  if (!G) return new Int8Array(128);
  if (viewPly < 0) return G.board;
  var t = Chess.create();
  for (var i = 0; i <= viewPly && i < G.played.length; i++) Chess.make(t, G.played[i].m);
  return t.board;
}
function syncBoard() {
  if (!G || !R) return;
  var hi = { selected: sel, legal: [], legalCapt: [], last: null, check: -1, hint: hintArrow };
  if (viewPly < 0) {
    if (prefs.helpers) legalMoves.forEach(function (m) {
      var isCapt = m.capt || (m.flags & Chess.F_EP);
      (isCapt ? hi.legalCapt : hi.legal).push(m.to);
    });
    var lastRec = G.played[G.played.length - 1];
    if (lastRec) hi.last = [lastRec.m.from, lastRec.m.to];
    if (!over && Chess.inCheck(G)) hi.check = G.kings[G.turn === 1 ? 0 : 1];
  } else {
    var rec = G.played[viewPly];
    if (rec) hi.last = [rec.m.from, rec.m.to];
    hi.selected = -1;
  }
  R.setHighlights(hi);
  needFrame();
}
function clearSel() { sel = -1; legalMoves = []; }

function canActNow() {
  if (!G || over || viewPly >= 0 || pendingPromo) return false;
  if (R.isAnimating && R.isAnimating()) return false;
  if (mode === "pass") return true;
  if (mode === "coach") return G.turn === humanSide && !thinking;
  if (mode === "lan") return G.turn === lanSide && Net.linked();
  return false; /* tour or menu */
}

function tapSquare(sq) {
  if (!G) return;
  if (viewPly >= 0) { exitView(); return; }
  if (!canActNow()) { clearSel(); syncBoard(); return; }
  hintArrow = null;
  var p = G.board[sq];
  if (sel >= 0) {
    var mv = null;
    for (var i = 0; i < legalMoves.length; i++) if (legalMoves[i].to === sq) { mv = legalMoves[i]; break; }
    if (mv) {
      if (mv.promo) { askPromotion(sel, sq); return; }
      clearSel();
      commitMove(mv, "local");
      return;
    }
    if (sq === sel) { clearSel(); syncBoard(); snd("hint"); return; }
  }
  if (p && (p > 0 ? 1 : -1) === G.turn) {
    sel = sq;
    legalMoves = Chess.movesFrom(G, sq);
    if (!legalMoves.length) {
      var why = Chess.inCheck(G) ? "That piece can't help right now — your king is in check and needs the rescue first." :
        "That piece has nowhere legal to go just now — it may be blocked, or pinned to your king.";
      toast(why);
    }
    snd("hint");
  } else {
    clearSel();
  }
  syncBoard();
}

function askPromotion(from, to) {
  pendingPromo = { from: from, to: to };
  var row = $("promoRow");
  row.innerHTML = "";
  var glyphs = G.turn === 1 ? GLYPH : GLYPHB;
  [Chess.Q, Chess.N, Chess.R, Chess.B].forEach(function (kind) {
    var b = document.createElement("button");
    b.textContent = glyphs[kind];
    b.addEventListener("click", function () {
      $("ovPromo").classList.add("hide");
      var want = kind * G.turn, mvv = null;
      for (var i = 0; i < legalMoves.length; i++) {
        if (legalMoves[i].to === to && legalMoves[i].promo === want) { mvv = legalMoves[i]; break; }
      }
      pendingPromo = null;
      clearSel();
      if (mvv) commitMove(mvv, "local");
    });
    row.appendChild(b);
  });
  $("ovPromo").classList.remove("hide");
}

/* ===== the one move pipeline ===== */
function animDescriptor(m) {
  var d = { from: m.from, to: m.to, piece: m.piece, promo: m.promo, capt: m.capt };
  if (m.flags & Chess.F_CASTLE) {
    if (m.to > m.from) { d.rookFrom = m.from + 3; d.rookTo = m.from + 1; }
    else { d.rookFrom = m.from - 4; d.rookTo = m.from - 1; }
  }
  if (m.flags & Chess.F_EP) d.epSq = m.to - 16 * (m.piece > 0 ? 1 : -1);
  return d;
}

function commitMove(m, source, animOpts) {
  if (!G || over) return;
  var mover = G.turn;
  var evBefore = Chess.evaluate(G);       /* mover's view, for the gentle coach */
  var desc = animDescriptor(m);
  var san = Chess.play(G, m);
  var ply = G.played.length - 1;

  /* clock presses the button as the piece lands */
  afterMoveClock(mover);

  /* net: tell the other chair */
  if (mode === "lan" && source === "local") {
    Net.send({ t: "mv", n: ply, from: m.from, to: m.to, promo: m.promo || 0,
               wMs: Math.round(clock.w), bMs: Math.round(clock.b) });
  }

  /* sounds */
  if (m.flags & Chess.F_CASTLE) snd("castle");
  else if (m.promo) snd("promo");
  else if (m.capt || (m.flags & Chess.F_EP)) snd("capture");
  else snd("move");

  var st = Chess.status(G);
  hintArrow = null;

  R.animateMove(desc, G.board, animOpts || {}, function () {
    syncBoard();
    if (!over && st.reason === "check") snd("check");
  });
  needFrame();
  syncMoveList();
  syncBars();
  syncTurnStrip();
  narrateOpening(san, source);

  if (st.over) { endGame(st.result, st.reason); saveGame(); return; }
  /* friendly automatic draw calls (both devices reach the same conclusion) */
  if (st.canClaim3) { endGame("draw", "the same position appeared three times"); saveGame(); return; }
  if (G.half >= 100) { endGame("draw", "fifty moves passed with no capture or pawn move"); saveGame(); return; }

  saveGame();
  syncButtons();

  /* the gentle coach looks over the human's shoulder */
  if (source === "local" && prefs.coach && !clock.on && (mode === "coach" || mode === "pass")) {
    setTimeout(function () { gentleCheck(mover, evBefore, san); }, 60);
  }
  /* the coach takes its turn */
  if (mode === "coach" && !over && G.turn !== humanSide) {
    scheduleCoach();
  }
}

/* ===== the practice opponent ===== */
function scheduleCoach() {
  thinking = true;
  syncTurnStrip();
  clearTimeout(coachTimer);
  coachTimer = setTimeout(function () {
    if (!G || over || mode !== "coach" || G.turn === humanSide) { thinking = false; syncTurnStrip(); return; }
    var sk = SKILLS[skill];
    var res = Chess.search(G, { ms: sk.ms, maxDepth: sk.maxDepth, noise: sk.noise });
    thinking = false;
    if (res.move) commitMove(res.move, "coach");
    syncTurnStrip();
  }, REDUCED ? 60 : 420);
}

/* ===== the gentle coach (blunder whisper) ===== */
function gentleCheck(mover, evBefore, san) {
  if (!G || over || G.played.length === 0) return;
  var res = Chess.search(G, { ms: 230, maxDepth: 3 });
  if (!res.move) return;
  /* res.score is from the opponent's view: big and positive means the
     move just played gave something away it didn't have to */
  if (res.score >= 140 && res.score + evBefore >= 120) {
    var reply = Chess.toSAN(G, res.move);
    var what = res.move.capt ? "it looks like " + reply + " wins material" : "there may be a strong reply in " + reply;
    toast("🤔 A quiet word about <b>" + san + "</b> — " + what + ". Want it back? (No shame; this is how everyone learns.)",
      [{ label: "↩ Take it back", fn: gentleUndo },
       { label: "Play on", fn: function () {}, ghost: true }], 10000);
  }
}
/* rewind to the human's turn, whether or not the coach already replied */
function gentleUndo() {
  if (!G || !G.played.length) return;
  clearTimeout(coachTimer); thinking = false;
  var k = (mode === "coach" && G.turn !== humanSide) ? 1 : (mode === "coach" ? 2 : 1);
  undoPly(Math.min(k, G.played.length));
}

/* ===== hints ===== */
function giveHint() {
  if (!G || over) { return; }
  if (!canActNow()) { toast(mode === "lan" && G.turn !== lanSide ? "It's your opponent's move — the hint lamp lights on your turn." : "Hints come on your turn."); return; }
  var sans = G.played.map(function (r) { return r.san.replace(/[+#]$/, ""); });
  var book = Book.suggest(sans);
  var res = Chess.search(G, { ms: 700 });
  if (!res.move) return;
  var chosen = res.move, why = null, bookPick = null;
  for (var i = 0; i < book.length; i++) {
    var bm = Chess.fromSAN(G, book[i].san);
    if (!bm) continue;
    /* prefer the book move when the engine doesn't strongly disagree */
    for (var j = 0; j < res.ranked.length; j++) {
      var r = res.ranked[j];
      if (r.move.from === bm.from && r.move.to === bm.to && res.ranked[0].score - r.score < 90) {
        bookPick = { m: bm, entry: book[i] };
      }
    }
    if (bookPick) break;
  }
  if (bookPick) { chosen = bookPick.m; why = bookPick.entry.why || ("a main road of the " + bookPick.entry.name + "."); }
  /* no curated line? the full ECO table may still know a named path */
  if (!bookPick && typeof Eco !== "undefined") {
    var ecoNext = Eco.next(sans);
    for (var e1 = 0; e1 < ecoNext.length && !bookPick; e1++) {
      var em = Chess.fromSAN(G, ecoNext[e1].san);
      if (!em) continue;
      for (var e2 = 0; e2 < res.ranked.length; e2++) {
        var er = res.ranked[e2];
        if (er.move.from === em.from && er.move.to === em.to && res.ranked[0].score - er.score < 90) {
          chosen = em;
          why = "a known road — this is the " + ecoNext[e1].name + ".";
          bookPick = { m: em };
          break;
        }
      }
    }
  }
  var san = Chess.toSAN(G, chosen);
  hintArrow = [chosen.from, chosen.to];
  syncBoard();
  snd("hint");
  toast("💡 <b>" + san + "</b> — " + (why || explainMove(chosen, res)), null, 8000);
}

function explainMove(m, res) {
  var kind = Math.abs(m.piece), bits = [];
  if (res && Math.abs(res.score) > Chess.MATE - 200) {
    var n = Math.ceil((Chess.MATE - Math.abs(res.score)) / 2);
    return "it forces checkmate in " + n + "! Follow the checks.";
  }
  Chess.make(G, m);
  var givesCheck = Chess.inCheck(G);
  Chess.unmake(G);
  if (m.flags & Chess.F_CASTLE) return "castling — the king tucks into safety and the rook joins the game. Two good deeds, one move.";
  if (m.promo) return "the pawn becomes a queen — the biggest promotion in board games.";
  if (m.capt) {
    var vc = Chess.VAL[Math.abs(m.capt)], vm = Chess.VAL[kind];
    if (vc > vm) bits.push("it wins material — a " + pieceName(m.capt) + " for a " + pieceName(m.piece));
    else if (Chess.attacked(G, m.from, -G.turn) && vc >= vm) bits.push("a fair trade that relieves the pressure");
    else bits.push("it captures the " + pieceName(m.capt));
  }
  if (Chess.attacked(G, m.from, -G.turn) && !Chess.attacked(G, m.to, -G.turn) && !m.capt) {
    bits.push("it slips the " + pieceName(m.piece) + " out of danger");
  }
  if (givesCheck) bits.push("it gives check, so the reply is forced");
  var toF = m.to & 7, toR = m.to >> 4, fromR = m.from >> 4;
  if (!bits.length) {
    if (kind === Chess.P && (toF === 3 || toF === 4) && (toR === 3 || toR === 4)) bits.push("it claims a share of the centre");
    else if ((kind === Chess.N || kind === Chess.B) && (fromR === 0 || fromR === 7)) bits.push("it develops a piece toward the middle, where it sees the most squares");
    else if (kind === Chess.R && G.played.length > 20) bits.push("rooks love open files — this one finds work");
    else bits.push("it improves the piece's post — " + Book.principle(principleN++));
  }
  return bits.join(", and ") + ".";
}
function pieceName(p) {
  return ["", "pawn", "knight", "bishop", "rook", "queen", "king"][Math.abs(p)];
}

/* ===== opening narration =====
   Two layers: book.js carries the teaching (ideas, per-move reasons)
   for the great openings; eco.js — the full lichess chess-openings
   table, CC0 — carries precise names for the other ~3,800 lines the
   players may wander into. */
function narrateOpening(san, source) {
  if (!G || G.played.length > 36 || mode === "tour") return;
  var sans = G.played.map(function (r) { return r.san.replace(/[+#]$/, ""); });
  var entry = Book.match(sans);
  var eco = (typeof Eco !== "undefined") ? Eco.match(sans) : null;
  var card = $("openingCard");
  var title = null, idea = entry ? entry.idea : "";
  if (eco && (!entry || eco.seq.split(" ").length >= entry.seq.split(" ").length)) {
    title = eco.name + " <small style='opacity:.6'>" + eco.eco + "</small>";
  } else if (entry) {
    title = entry.name;
  }
  if (title) {
    card.classList.remove("hide");
    card.innerHTML = "<b>" + title + "</b>" + idea;
  }
  if (entry && entry.name !== lastNarratedOpening && sans.length >= 2) {
    lastNarratedOpening = entry.name;
    if (source !== "net") toast("📖 <b>" + entry.name + "</b> — " + entry.idea, null, 6000);
  }
}

/* ===== move list & history browsing ===== */
function syncMoveList() {
  var ml = $("moveList");
  ml.innerHTML = "";
  if (!G) return;
  for (var i = 0; i < G.played.length; i += 2) {
    var n = document.createElement("span"); n.className = "n"; n.textContent = (i / 2 + 1) + ".";
    ml.appendChild(n);
    ml.appendChild(moveCell(i));
    if (i + 1 < G.played.length) ml.appendChild(moveCell(i + 1));
    else { var f = document.createElement("span"); ml.appendChild(f); }
  }
  var wrap = $("moveListWrap");
  wrap.scrollTop = wrap.scrollHeight;
}
function moveCell(ply) {
  var s = document.createElement("span");
  s.className = "m" + ((viewPly === ply || (viewPly < 0 && ply === G.played.length - 1)) ? " cur" : "");
  s.textContent = G.played[ply].san;
  s.addEventListener("click", function () { viewAt(ply); });
  return s;
}
function viewAt(ply) {
  if (!G || ply < 0 || ply >= G.played.length) return;
  viewPly = (ply === G.played.length - 1) ? -1 : ply;
  $("viewBanner").classList.toggle("hide", viewPly < 0);
  clearSel(); hintArrow = null;
  R.setPosition(currentViewBoard());
  syncBoard(); syncMoveList(); syncTurnStrip();
}
function exitView() {
  viewPly = -1;
  $("viewBanner").classList.add("hide");
  R.setPosition(G.board);
  syncBoard(); syncMoveList(); syncTurnStrip();
}

/* ===== replay the last move (again, with feeling) ===== */
function replayLast() {
  if (!G || !G.played.length || (R.isAnimating && R.isAnimating())) return;
  if (viewPly >= 0) { exitView(); return; }
  var rec = G.played[G.played.length - 1];
  /* rebuild the position just before it, hand it to the renderer, then
     run the same animation slowly with a glow */
  var t = Chess.create();
  for (var i = 0; i < G.played.length - 1; i++) Chess.make(t, G.played[i].m);
  R.setPosition(t.board);
  clearSel();
  R.setHighlights({ last: null });
  toast("🔁 <b>" + rec.san + "</b> — once more, slowly.");
  R.animateMove(animDescriptor(rec.m), G.board, { dur: REDUCED ? 1 : 850, glow: true }, function () {
    syncBoard();
  });
  needFrame();
}

/* ===== undo / takeback ===== */
function undoPly(n) {
  if (!G || !G.played.length) return;
  if (mode === "lan") return; /* LAN goes through the polite request */
  clearTimeout(coachTimer); thinking = false;
  for (var i = 0; i < n && G.played.length; i++) Chess.takeBack(G);
  over = null;
  clearSel(); hintArrow = null; viewPly = -1;
  $("viewBanner").classList.add("hide");
  if (clock.on) { clock.run = G.played.length >= 1 ? G.turn : 0; clock.lastT = performance.now(); }
  R.setPosition(G.board);
  syncAll();
  saveGame();
}
function undoSmart() {
  if (!G || !G.played.length) { toast("Nothing to undo yet."); return; }
  if (mode === "lan") {
    if (!Net.linked()) { toast("The link is down — nothing to ask."); return; }
    var n = (G.turn === lanSide) ? 2 : 1;
    if (G.played.length < n) { toast("Nothing of yours to take back yet."); return; }
    Net.send({ t: "undoReq", n: n });
    toast("A polite takeback request is on its way…");
    return;
  }
  if (mode === "coach") {
    /* undo to the human's previous turn */
    var k = (G.turn === humanSide) ? 2 : 1;
    undoPly(Math.min(k, G.played.length));
    toast("Rewound. Chess deserves second thoughts.");
  } else {
    undoPly(1);
  }
}

/* ===== game start / end ===== */
function startGame(newMode, opts) {
  opts = opts || {};
  stopTour();
  mode = newMode;
  G = Chess.create();
  over = null;
  clearSel(); hintArrow = null; viewPly = -1; lastNarratedOpening = ""; thinking = false;
  $("viewBanner").classList.add("hide");
  $("openingCard").classList.add("hide");
  humanSide = opts.humanSide || 1;
  skill = opts.skill || skill;
  clockConfig(opts.clockStr || "none");
  orientation = (mode === "coach") ? humanSide : (mode === "lan" ? lanSide : 1);
  R.setOrientation(orientation);
  R.setPosition(G.board, { flourish: true });
  syncAll();
  hideAllOverlays();
  saveGame();
  if (mode === "coach" && G.turn !== humanSide) scheduleCoach();
  needFrame();
}
function endGame(result, reason) {
  if (over) return;
  over = { result: result, reason: reason };
  clock.run = 0;
  clearSel();
  syncAll();
  var mySide = mode === "coach" ? humanSide : (mode === "lan" ? lanSide : 0);
  var iWon = (result === "white" && mySide === 1) || (result === "black" && mySide === -1);
  var iLost = (result === "white" && mySide === -1) || (result === "black" && mySide === 1);
  snd(result === "draw" ? "draw" : (iLost ? "lose" : "win"));
  var em = "🤝", title = "A draw!", sub = "";
  if (result === "draw") {
    sub = cap(reason) + ". Draws are real results — half a point each, and often the fairest one.";
  } else {
    var winner = result === "white" ? "White" : "Black";
    if (mySide === 0) { em = "🏆"; title = winner + " wins!"; }
    else if (iWon) { em = "🎉"; title = "You won!"; }
    else { em = "🌱"; title = "This one goes to " + sideName(-mySide) + "."; }
    sub = cap(reason) + "." + (iLost ? " Every strong player has lost thousands of games — this one taught you something specific. Peek back through the moves and find where it turned." : (reason === "checkmate" ? " The king had no escape, no shield, and no rescue — that's all a checkmate is." : ""));
  }
  $("endEmoji").textContent = em;
  $("endTitle").textContent = title;
  $("endSub").textContent = sub;
  $("endRematchSub").textContent = "Same setup" + (mode !== "pass" ? ", colours swapped." : ".");
  setTimeout(function () { if (over) $("ovEnd").classList.remove("hide"); }, REDUCED ? 100 : 1100);
  lsDel(SAVE_KEY);
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function rematch() {
  $("ovEnd").classList.add("hide");
  if (mode === "coach") startGame("coach", { humanSide: -humanSide, skill: skill, clockStr: clockStrOf() });
  else if (mode === "pass") startGame("pass", { clockStr: clockStrOf() });
  else if (mode === "lan") {
    if (!Net.linked()) { toast("The link closed. Host or join again to keep playing — the room remembers you."); return; }
    Net.send({ t: "rematch" });
    toast("Rematch offered — waiting for your opponent…");
  }
}
function clockStrOf() { return clock.on ? (clock.base / 60000) + "+" + (clock.inc / 1000) : "none"; }

/* ===== persistence ===== */
function saveGame() {
  if (!G || mode === "lan" || mode === "tour" || !mode) return;
  if (over) { lsDel(SAVE_KEY); return; }
  lsSet(SAVE_KEY, JSON.stringify({
    v: 1, mode: mode, sans: G.played.map(function (r) { return r.san; }),
    clockStr: clockStrOf(), wMs: Math.round(clock.w), bMs: Math.round(clock.b),
    humanSide: humanSide, skill: skill
  }));
}
function loadSave() {
  try {
    var s = JSON.parse(lsGet(SAVE_KEY) || "null");
    if (!s || s.v !== 1 || !s.sans || (s.mode !== "pass" && s.mode !== "coach")) return null;
    return s;
  } catch (e) { lsDel(SAVE_KEY); return null; }
}
function resumeSave(s) {
  startGame(s.mode, { humanSide: s.humanSide, skill: s.skill, clockStr: s.clockStr });
  var g = G;
  for (var i = 0; i < s.sans.length; i++) {
    var m = Chess.fromSAN(g, s.sans[i]);
    if (!m) break;
    Chess.play(g, m);
  }
  if (clock.on) { clock.w = s.wMs; clock.b = s.bMs; clock.run = g.played.length >= 1 ? g.turn : 0; clock.lastT = performance.now(); }
  R.setPosition(G.board);
  syncAll();
  saveGame();      /* startGame wrote an empty save; restore the real one */
  var st = Chess.status(G);
  if (st.over) { endGame(st.result, st.reason); return; }
  if (mode === "coach" && G.turn !== humanSide) scheduleCoach();
  toast("🕯️ Welcome back — the board is exactly as you left it.");
}

/* ===== nearby (LAN) play ===== */
var scanStream = null;
function lanHandlers() {
  Net.onLink = function () {
    snd("link");
    hideAllOverlays();
    if (Net.isHost) {
      Net.send({ t: "hi", name: lanMy || "Host", clock: lanCfg.clockStr,
                 yourSide: lanCfg.mySide === 1 ? -1 : 1, sans: lanCfg.sans || [],
                 wMs: lanCfg.wMs, bMs: lanCfg.bMs });
      beginLan(lanCfg.mySide, lanCfg.clockStr, lanCfg.sans || [], lanCfg.wMs, lanCfg.bMs);
    } else {
      Net.send({ t: "hi2", name: lanMy || "Friend" });
    }
    toast("📡 Linked! Two devices, one board. Play kindly.");
  };
  Net.onDrop = function () {
    if (mode !== "lan" || over) return;
    clock.run = 0;
    toast("📡 The link was lost. Nothing is gone — either of you can host a fresh invite and the game resumes exactly here.",
      [{ label: "Host & resume", fn: function () { openLink(); hostFlow(true); } },
       { label: "Menu", fn: function () { showMenu(); }, ghost: true }], 30000);
  };
  Net.onMessage = function (msg) {
    switch (msg.t) {
      case "hi":
        lanOpp = String(msg.name || "Friend").slice(0, 18);
        if (!Net.isHost) beginLan(msg.yourSide === 1 ? 1 : -1, msg.clock, msg.sans || [], msg.wMs, msg.bMs);
        syncBars(); syncTurnStrip();
        break;
      case "hi2":
        lanOpp = String(msg.name || "Friend").slice(0, 18);
        syncBars(); syncTurnStrip();
        break;
      case "mv": onNetMove(msg); break;
      case "undoReq":
        toast("↩ " + lanOpp + " asks to take back a move. Allow it?",
          [{ label: "Allow", fn: function () { Net.send({ t: "undoOk", n: msg.n }); lanUndo(msg.n); } },
           { label: "Not this time", fn: function () { Net.send({ t: "undoNo" }); }, ghost: true }], 20000);
        break;
      case "undoOk": lanUndo(msg.n); toast("Your opponent kindly allowed the takeback."); break;
      case "undoNo": toast("No takeback this time — play on."); break;
      case "draw":
        toast("🤝 " + lanOpp + " offers a draw.",
          [{ label: "Accept", fn: function () { Net.send({ t: "drawOk" }); endGame("draw", "agreed"); } },
           { label: "Play on", fn: function () { Net.send({ t: "drawNo" }); }, ghost: true }], 20000);
        break;
      case "drawOk": endGame("draw", "agreed"); break;
      case "drawNo": toast("The game goes on."); break;
      case "resign": endGame(lanSide === 1 ? "white" : "black", sideName(-lanSide) + " resigned"); break;
      case "rematch":
        toast("🔄 " + lanOpp + " offers a rematch, colours swapped.",
          [{ label: "Play", fn: function () { Net.send({ t: "rematchOk" }); lanRematch(); } },
           { label: "Not now", fn: function () {}, ghost: true }], 20000);
        break;
      case "rematchOk": lanRematch(); break;
    }
  };
}
function beginLan(mySide, clockStr, sans, wMs, bMs) {
  lanSide = mySide;
  startGame("lan", { clockStr: clockStr || "none" });
  if (sans && sans.length) {
    for (var i = 0; i < sans.length; i++) {
      var m = Chess.fromSAN(G, sans[i]);
      if (!m) break;
      Chess.play(G, m);
    }
    R.setPosition(G.board);
    if (clock.on && wMs != null) { clock.w = wMs; clock.b = bMs; }
    if (clock.on) { clock.run = G.played.length >= 1 ? G.turn : 0; clock.lastT = performance.now(); }
    toast("📡 Resumed exactly where you left off.");
  }
  orientation = lanSide;
  R.setOrientation(orientation);
  syncAll();
}
function onNetMove(msg) {
  if (mode !== "lan" || !G || over) return;
  if (msg.n !== G.played.length) return;              /* stale or duplicate */
  if (G.turn === lanSide) return;                     /* it must be their turn */
  var all = Chess.moves(G), m = null;
  for (var i = 0; i < all.length; i++) {
    if (all[i].from === msg.from && all[i].to === msg.to && (all[i].promo || 0) === (msg.promo || 0)) { m = all[i]; break; }
  }
  if (!m) { toast("The boards disagreed for a moment — if it happens again, re-link to resync."); return; }
  if (clock.on && msg.wMs != null) { clock.w = msg.wMs; clock.b = msg.bMs; }
  commitMove(m, "net");
}
function lanUndo(n) {
  for (var i = 0; i < n && G.played.length; i++) Chess.takeBack(G);
  over = null;
  clearSel(); hintArrow = null; viewPly = -1;
  if (clock.on) { clock.run = G.played.length >= 1 ? G.turn : 0; clock.lastT = performance.now(); }
  R.setPosition(G.board);
  syncAll();
}
function lanRematch() {
  $("ovEnd").classList.add("hide");
  lanSide = -lanSide;
  beginLan(lanSide, clockStrOf(), []);
  toast("🔄 Rematch! You have " + (lanSide === 1 ? "white" : "black") + " this time.");
}

/* ----- link UI flow ----- */
function openLink() {
  hideAllOverlays();
  $("ovLink").classList.remove("hide");
  $("linkChoose").classList.remove("hide");
  $("linkHost").classList.add("hide");
  $("linkJoin").classList.add("hide");
  $("scanBox").classList.add("hide");
  $("lanName").value = prefs.name || "";
  var scanOK = ("BarcodeDetector" in window) && navigator.mediaDevices;
  $("scanReply").classList.toggle("hide", !scanOK);
  $("scanInvite").classList.toggle("hide", !scanOK);
}
function grabName() {
  lanMy = ($("lanName").value || "").trim().slice(0, 18);
  prefs.name = lanMy; savePrefs();
}
function hostFlow(resume) {
  grabName();
  var doHost = function (clockStr, side) {
    var s = side === "r" ? (Math.random() < 0.5 ? 1 : -1) : (side === "b" ? -1 : 1);
    lanCfg = { mySide: s, clockStr: clockStr,
               sans: resume && G && mode === "lan" ? G.played.map(function (r) { return r.san; }) : [],
               wMs: resume && clock.on ? Math.round(clock.w) : undefined,
               bMs: resume && clock.on ? Math.round(clock.b) : undefined };
    $("ovLink").classList.remove("hide");
    $("linkChoose").classList.add("hide");
    $("linkHost").classList.remove("hide");
    $("inviteOut").value = "…making your invite (a second or two)…";
    Net.host({ name: lanMy }).then(function (code) {
      var url = Net.url(code);
      $("inviteOut").value = url;
      Net.drawQR($("qrCanvas"), url);
    }).catch(function () {
      $("inviteOut").value = "That didn't work — close and try again.";
    });
  };
  if (resume) { doHost(clockStrOf(), lanSide === 1 ? "w" : "b"); return; }
  /* fresh host: pick clock & colour via the new-game card */
  openNewCard("lanhost", function (opts) { doHost(opts.clockStr, opts.side); });
}
function joinFlow(prefill) {
  grabName();
  $("linkChoose").classList.add("hide");
  $("linkJoin").classList.remove("hide");
  if (prefill) { $("inviteIn").value = prefill; answerInvite(); }
}
function answerInvite() {
  var code = $("inviteIn").value;
  if (!/CHESS(1|2)\./.test(code)) { toast("That doesn't look like an invite — it starts with CHESS2."); return; }
  Net.join(code).then(function (res) {
    if (!res) { toast("Couldn't read that invite. Ask for a fresh one — they expire when the host closes the page."); return; }
    $("joinStep2").classList.remove("hide");
    var url = Net.url(res.reply);
    $("replyOut").value = url;
    Net.drawQR($("qrCanvas2"), url);
  }).catch(function () { toast("Couldn't read that invite — try copying it again."); });
}
function acceptReplyFlow() {
  Net.acceptReply($("replyIn").value).then(function (ok) {
    if (!ok) toast("That reply didn't fit this invite. Copy the whole code and try again.");
    /* success continues in Net.onLink */
  });
}
function clip(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { toast("Copied. Send it however you like."); },
      function () { toast("Couldn't reach the clipboard — long-press the code to copy it."); });
  } else toast("Long-press the code to copy it.");
}
function pasteInto(el) {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(function (t) { el.value = t; },
      function () { toast("Couldn't read the clipboard — paste into the box by hand."); });
  } else toast("Paste into the box by hand.");
}
function share(text) {
  if (navigator.share) navigator.share({ title: "Chess with me?", text: "Join my chess board: ", url: text }).catch(function () {});
  else clip(text);
}
function startScan(onCode) {
  var video = $("scanVideo");
  $("scanBox").classList.remove("hide");
  var stopped = false;
  function stop() {
    stopped = true;
    if (scanStream) { scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; }
    $("scanBox").classList.add("hide");
  }
  $("scanStop").onclick = stop;
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(function (stream) {
    scanStream = stream;
    video.srcObject = stream;
    video.play();
    var det = new window.BarcodeDetector({ formats: ["qr_code"] });
    (function poll() {
      if (stopped) return;
      det.detect(video).then(function (codes) {
        if (stopped) return;
        var hit = codes && codes.find(function (c) { return /CHESS(1|2)\./.test(c.rawValue); });
        if (hit) { stop(); onCode(hit.rawValue); return; }
        setTimeout(poll, 240);
      }).catch(function () { setTimeout(poll, 400); });
    })();
  }).catch(function () {
    stop();
    toast("The camera said no — paste the code instead.");
  });
}

/* ===== opening stories (the tour) ===== */
function buildOpeningList() {
  var box = $("openingList");
  box.innerHTML = "";
  /* show the lines that have at least 2 moves — the named stories */
  Book.LINES.filter(function (l) { return l.seq.split(" ").length >= 2; }).forEach(function (l) {
    var d = document.createElement("div");
    d.className = "oline";
    d.innerHTML = "<b>" + l.name + "</b><span class='seq'>" + l.seq + "</span><small>" + l.idea + "</small>";
    d.addEventListener("click", function () { startTour(l); });
    box.appendChild(d);
  });
}
function startTour(line) {
  stopTour();
  mode = "tour";
  G = Chess.create();
  over = null; clearSel(); hintArrow = null; viewPly = -1;
  clockConfig("none");
  orientation = 1;
  R.setOrientation(1);
  R.setPosition(G.board, { flourish: true });
  hideAllOverlays();
  syncAll();
  tourLine = line; tourStep = 0;
  $("openingCard").classList.remove("hide");
  $("openingCard").innerHTML = "<b>" + line.name + "</b>" + line.idea;
  toast("📖 <b>" + line.name + "</b> — watch; each move explains itself.", null, 3000);
  tourTimer = setTimeout(tourNext, REDUCED ? 600 : 1700);
}
function tourNext() {
  if (mode !== "tour" || !tourLine) return;
  var sans = tourLine.seq.split(" ");
  if (tourStep >= sans.length) {
    toast("That's the " + tourLine.name + ". Want to play on from here against the coach?",
      [{ label: "▶ Play on", fn: function () {
          var side = G.turn;
          mode = "coach"; humanSide = side; skill = "club";
          orientation = side; R.setOrientation(side);
          syncAll(); saveGame();
          toast("You're " + (side === 1 ? "white" : "black") + ", picking up right where the book ends. The coach is listening.");
        } },
       { label: "📖 Another story", fn: function () { showOpenings(); }, ghost: true },
       { label: "Menu", fn: function () { showMenu(); }, ghost: true }], 30000);
    return;
  }
  var m = Chess.fromSAN(G, sans[tourStep]);
  if (!m) { toast("(This story lost its page — that's a bug worth reporting.)"); return; }
  var why = tourLine.why && tourLine.why[tourStep];
  var desc = animDescriptor(m);
  var san = Chess.play(G, m);
  snd(m.capt ? "capture" : "move");
  R.animateMove(desc, G.board, { dur: REDUCED ? 1 : 620 }, null);
  syncMoveList(); syncBars(); syncTurnStrip();
  if (why) toast("<b>" + san + "</b> — " + why, null, 2600);
  tourStep++;
  tourTimer = setTimeout(tourNext, REDUCED ? 500 : (why ? 2900 : 1500));
  needFrame();
}
function stopTour() { clearTimeout(tourTimer); tourLine = null; }

/* ===== learn (the rules, gently) ===== */
var LEARN = [
  ["The idea of the game", "Chess is a conversation between two armies. The whole game is about one piece: the <b>king</b>. Trap the other king so it cannot escape capture — that's <b>checkmate</b> — and the game is over. Nothing else wins. You never actually capture the king; you corner it."],
  ["The board", "64 squares, 8×8. A square's name is its file (a–h, left to right from White's side) plus its rank (1–8, from White's side). White's queen starts on d1 — <i>queen on her own colour</i>. The board always sits with a light square in each player's right-hand corner."],
  ["The pawn ♙", "Walks one square forward, but <b>captures diagonally</b> — one square, forward-left or forward-right. On its very first move it may walk two. It can never go backward. Reach the far side, and it <b>promotes</b> — it becomes a queen (or knight, rook, or bishop). The humblest piece, with the biggest dream."],
  ["The knight ♘", "Moves in an L: two squares one way, then one square sideways. It is the only piece that <b>jumps over</b> others. Knights love the middle of the board and crowded positions where nothing else can move."],
  ["The bishop ♗", "Slides any distance along diagonals. Each bishop lives its whole life on one colour of squares. Your two bishops together cover everything — they work best as a pair, on open diagonals."],
  ["The rook ♖", "Slides any distance along ranks and files. Worth about five pawns. Rooks start in the corners and wake up late — give them open files and they win endgames."],
  ["The queen ♕", "Rook and bishop combined — the strongest piece, worth about nine pawns. Because she's so precious, bringing her out early lets your opponent develop pieces <i>while attacking her</i>. Let her enter like royalty: a little late, and decisively."],
  ["The king ♔", "One square in any direction. He can never move onto an attacked square. When he's attacked, that's <b>check</b> — and you must fix it immediately: move him, block the attack, or capture the attacker. If none of those exist, it's checkmate."],
  ["Castling", "Once per game, if neither piece has moved and the way is clear and safe: the king steps <b>two squares</b> toward a rook, and the rook hops to the far side of him. The only move where two of your pieces move at once. Castle early — a tucked-in king wins games."],
  ["En passant", "The strangest rule, and real: if an enemy pawn uses its two-square first move to land <i>beside</i> your pawn, you may capture it as if it had moved only one — but only on the very next move. The name is French for 'in passing'."],
  ["Draws", "Not every game has a winner. It's a draw when: the side to move has no legal move but isn't in check (<b>stalemate</b>); the same position occurs three times; fifty moves pass with no capture or pawn move; or neither side has enough pieces left to ever mate. Half a point each."],
  ["How to start well", "Three habits beat most beginners' tricks: <b>1.</b> Take a share of the centre. <b>2.</b> Develop knights and bishops before adventures. <b>3.</b> Castle. Then look at every enemy move and ask the magic question: <i>what does that threaten?</i> You're ready — go play."]
];
var learnAt = 0;
function showLearn(n) {
  hideAllOverlays();
  learnAt = Math.max(0, Math.min(LEARN.length - 1, n));
  $("learnBody").innerHTML = "<h2 style='margin-top:0'>" + LEARN[learnAt][0] + "</h2><p>" + LEARN[learnAt][1] + "</p>" +
    "<p style='text-align:center;color:var(--soft)'>" + (learnAt + 1) + " / " + LEARN.length + "</p>";
  $("learnPrev").style.visibility = learnAt === 0 ? "hidden" : "visible";
  $("learnNext").textContent = learnAt === LEARN.length - 1 ? "Play! →" : "Next →";
  $("ovLearn").classList.remove("hide");
}

/* ===== overlays & menus ===== */
function hideAllOverlays() {
  ["ovMenu", "ovNew", "ovLink", "ovPromo", "ovEnd", "ovSettings", "ovLearn", "ovOpenings", "ovAbout"].forEach(function (id) {
    $(id).classList.add("hide");
  });
}
function showMenu() {
  stopTour();
  hideAllOverlays();
  var s = loadSave();
  var hasLive = G && !over && mode && mode !== "tour";
  $("mResume").classList.toggle("hide", !s && !hasLive);
  if (hasLive) $("mResumeSub").textContent = "Return to the board — " + Math.ceil(G.played.length / 2) + " moves in.";
  else if (s) $("mResumeSub").textContent = (s.mode === "coach" ? "Against the coach" : "Pass & play") + " — " + Math.ceil(s.sans.length / 2) + " moves in.";
  /* contextual resign / draw offers for a live game */
  var ops = $("gameOps");
  if (!ops) {
    ops = document.createElement("div");
    ops.id = "gameOps";
    $("mResume").parentNode.insertBefore(ops, $("mResume").nextSibling);
  }
  ops.innerHTML = "";
  if (hasLive && (mode === "lan" || mode === "coach")) {
    var row = document.createElement("div"); row.className = "rowbtns";
    if (mode === "lan" && Net.linked()) {
      row.appendChild(chipBtn("🤝 Offer a draw", function () { Net.send({ t: "draw" }); hideAllOverlays(); toast("Draw offered."); }));
    }
    row.appendChild(chipBtn("🏳️ Resign this game", function () {
      hideAllOverlays();
      toast("Resign — really? Tipping the king is honourable, but so is fighting on a pawn down.",
        [{ label: "🏳️ Yes, resign", fn: function () {
            if (mode === "lan") Net.send({ t: "resign" });
            var meSide = mode === "lan" ? lanSide : humanSide;
            endGame(meSide === 1 ? "black" : "white", sideName(meSide) + " resigned");
          } },
         { label: "Fight on", fn: function () {}, ghost: true }]);
    }));
    ops.appendChild(row);
  }
  $("ovMenu").classList.remove("hide");
}
function chipBtn(label, fn) {
  var b = document.createElement("button");
  b.className = "chip"; b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}
function showOpenings() {
  hideAllOverlays();
  buildOpeningList();
  $("ovOpenings").classList.remove("hide");
}

/* new-game card (shared by pass/coach/lan-host) */
var newCardCtx = null;
function openNewCard(kind, cb) {
  newCardCtx = { kind: kind, cb: cb, side: "w", skill: skill, clockStr: "none" };
  $("newTitle").textContent = kind === "pass" ? "Pass & play" : kind === "coach" ? "Play the coach" : "Host a board";
  $("sideRow").classList.toggle("hide", kind === "pass");
  $("skillRow").classList.toggle("hide", kind !== "coach");
  hideAllOverlays();
  $("ovNew").classList.remove("hide");
}
function wireChips(rowId, attr, set) {
  $(rowId).addEventListener("click", function (e) {
    var b = e.target.closest("button[data-" + attr + "]");
    if (!b) return;
    Array.prototype.forEach.call($(rowId).children, function (c) { c.classList.remove("sel"); });
    b.classList.add("sel");
    set(b.getAttribute("data-" + attr));
  });
}

/* ===== the frame loop (with a soft landing if drawing ever throws) ===== */
var rafPending = false, drawErrs = 0;
function needFrame() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(loop);
}
var lastClockSync = 0;
function loop(t) {
  rafPending = false;
  var more = false;
  try {
    clockTick(t);
    if (R) more = R.frame(t);
    drawErrs = 0;
  } catch (e) {
    drawErrs++;
    if (drawErrs > 4) {
      if (R === R3) { switchDim(false, true); drawErrs = 0; }
      else { panic(); return; }
    }
  }
  /* keep ticking while a clock runs, an animation plays, or the camera drifts */
  if (clock.on && clock.run && !over && t - lastClockSync > 5000) {
    lastClockSync = t;
    saveGame();     /* clock times survive a closed tab */
  }
  if (more || (clock.on && clock.run && !over)) needFrame();
}

/* ===== input: taps move pieces, drags orbit the 3D camera ===== */
function wireInput() {
  var stage = $("stage");
  var pts = new Map(), downSq = -1, downXY = null, dragging = false, pinchD = 0;
  stage.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".clock") || e.target.closest("#toast")) return;
    ac(); /* unlock audio on first gesture */
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      downXY = { x: e.clientX, y: e.clientY };
      dragging = false;
      var rect = stage.getBoundingClientRect();
      downSq = R.screenToSquare(e.clientX - rect.left, e.clientY - rect.top);
    } else if (pts.size === 2) {
      var arr = Array.from(pts.values());
      pinchD = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
    }
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
  });
  stage.addEventListener("pointermove", function (e) {
    if (!pts.has(e.pointerId)) return;
    var prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      var arr = Array.from(pts.values());
      var d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      if (pinchD > 0 && R.zoom) R.zoom(pinchD / d);
      pinchD = d;
      dragging = true;
      needFrame();
      return;
    }
    if (!downXY) return;
    var dx = e.clientX - downXY.x, dy = e.clientY - downXY.y;
    if (!dragging && Math.hypot(dx, dy) > 9) dragging = true;
    if (dragging && R.orbit) {
      R.orbit(e.clientX - prev.x, e.clientY - prev.y);
      needFrame();
    }
  });
  function up(e) {
    pts.delete(e.pointerId);
    if (pts.size > 0) return;
    if (!dragging && downSq >= 0) tapSquare(downSq);
    downSq = -1; downXY = null; dragging = false; pinchD = 0;
  }
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  stage.addEventListener("wheel", function (e) {
    if (R.zoom) { R.zoom(e.deltaY > 0 ? 1.07 : 0.93); needFrame(); e.preventDefault(); }
  }, { passive: false });
}

/* ===== sync everything ===== */
function syncAll() {
  syncBoard(); syncMoveList(); syncBars(); syncClocks(); syncTurnStrip(); syncButtons();
}
function syncButtons() {
  $("undoLbl").textContent = mode === "lan" ? "Takeback" : "Undo";
  $("btnUndo").toggleAttribute("disabled", !G || !G.played.length || !!over || mode === "tour");
  $("btnHint").toggleAttribute("disabled", !G || !!over || mode === "tour");
  $("btnReplay").toggleAttribute("disabled", !G || !G.played.length);
}

/* ===== settings ===== */
function syncSettingsUI() {
  $("thWalnut").classList.toggle("sel", prefs.theme === "walnut");
  $("thSlate").classList.toggle("sel", prefs.theme === "slate");
  $("setCoach").classList.toggle("sel", prefs.coach);
  $("setCoach").textContent = prefs.coach ? "On" : "Off";
  $("setSound").classList.toggle("sel", prefs.sound);
  $("setSound").textContent = prefs.sound ? "On" : "Off";
  $("setHelpers").classList.toggle("sel", prefs.helpers);
  $("setHelpers").textContent = prefs.helpers ? "On" : "Off";
  $("ckSimple").classList.toggle("sel", prefs.clockSkin === "simple");
  $("ckClassic").classList.toggle("sel", prefs.clockSkin === "classic");
  document.body.classList.toggle("clock-classic", prefs.clockSkin === "classic");
}

/* ===== boot ===== */
function wireUI() {
  $("btnMenu").addEventListener("click", showMenu);
  $("btnUndo").addEventListener("click", undoSmart);
  $("btnHint").addEventListener("click", giveHint);
  $("btnReplay").addEventListener("click", replayLast);
  $("btnFlip").addEventListener("click", function () {
    orientation = -orientation;
    R.setOrientation(orientation);
    syncBars(); syncClocks(); syncBoard();
    needFrame();
  });
  $("btnDim").addEventListener("click", function () { switchDim(!prefs.use3d); });

  /* menu */
  $("mResume").addEventListener("click", function () {
    var hasLive = G && !over && mode && mode !== "tour";
    if (hasLive) { hideAllOverlays(); return; }
    var s = loadSave();
    if (s) resumeSave(s);
  });
  $("mPass").addEventListener("click", function () { openNewCard("pass", function (o) { startGame("pass", { clockStr: o.clockStr }); }); });
  $("mCoach").addEventListener("click", function () { openNewCard("coach", function (o) {
    var side = o.side === "r" ? (Math.random() < 0.5 ? 1 : -1) : (o.side === "b" ? -1 : 1);
    startGame("coach", { humanSide: side, skill: o.skill, clockStr: o.clockStr });
    if (side === -1) toast("You have black — the coach opens. Watch what it does with the centre.");
  }); });
  $("mLan").addEventListener("click", openLink);
  $("mOpenings").addEventListener("click", showOpenings);
  $("mLearn").addEventListener("click", function () { showLearn(0); });
  $("mSettings").addEventListener("click", function () { hideAllOverlays(); syncSettingsUI(); $("ovSettings").classList.remove("hide"); });
  $("mAbout").addEventListener("click", function () { hideAllOverlays(); $("ovAbout").classList.remove("hide"); });
  $("aboutBack").addEventListener("click", showMenu);

  /* new game card */
  wireChips("sideChips", "side", function (v) { if (newCardCtx) newCardCtx.side = v; });
  wireChips("skillChips", "skill", function (v) { if (newCardCtx) newCardCtx.skill = v; });
  wireChips("clockChips", "clock", function (v) { if (newCardCtx) newCardCtx.clockStr = v; });
  $("newStart").addEventListener("click", function () {
    if (!newCardCtx) return;
    var ctx = newCardCtx; newCardCtx = null;
    skill = ctx.skill;
    hideAllOverlays();
    ctx.cb({ side: ctx.side, skill: ctx.skill, clockStr: ctx.clockStr });
  });
  $("newBack").addEventListener("click", showMenu);

  /* end card */
  $("endRematch").addEventListener("click", rematch);
  $("endReview").addEventListener("click", function () {
    $("ovEnd").classList.add("hide");
    if (G && G.played.length) viewAt(0);
    toast("Tap moves in the list to step through. Tap the banner to come back to the end.");
  });
  $("endMenu").addEventListener("click", showMenu);

  /* settings */
  $("thWalnut").addEventListener("click", function () { prefs.theme = "walnut"; savePrefs(); R2.setTheme("walnut"); if (R3) R3.setTheme("walnut"); syncSettingsUI(); needFrame(); });
  $("thSlate").addEventListener("click", function () { prefs.theme = "slate"; savePrefs(); R2.setTheme("slate"); if (R3) R3.setTheme("slate"); syncSettingsUI(); needFrame(); });
  $("setCoach").addEventListener("click", function () { prefs.coach = !prefs.coach; savePrefs(); syncSettingsUI(); });
  $("setSound").addEventListener("click", function () { prefs.sound = !prefs.sound; savePrefs(); syncSettingsUI(); if (prefs.sound) snd("link"); });
  $("setHelpers").addEventListener("click", function () { prefs.helpers = !prefs.helpers; savePrefs(); syncSettingsUI(); syncBoard(); });
  $("ckSimple").addEventListener("click", function () { prefs.clockSkin = "simple"; savePrefs(); syncSettingsUI(); });
  $("ckClassic").addEventListener("click", function () { prefs.clockSkin = "classic"; savePrefs(); syncSettingsUI(); });
  $("setBack").addEventListener("click", showMenu);

  /* learn */
  $("learnPrev").addEventListener("click", function () { showLearn(learnAt - 1); });
  $("learnNext").addEventListener("click", function () {
    if (learnAt === LEARN.length - 1) { hideAllOverlays(); showMenu(); }
    else showLearn(learnAt + 1);
  });
  $("learnClose").addEventListener("click", showMenu);

  /* openings */
  $("openingsBack").addEventListener("click", showMenu);

  /* view banner */
  $("viewBanner").addEventListener("click", exitView);

  /* link overlay */
  $("linkHostBtn").addEventListener("click", function () { hostFlow(false); });
  $("linkJoinBtn").addEventListener("click", function () { joinFlow(null); });
  $("linkBack").addEventListener("click", function () {
    if (scanStream) { scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; }
    showMenu();
  });
  $("copyInvite").addEventListener("click", function () { clip($("inviteOut").value); });
  $("shareInvite").addEventListener("click", function () { share($("inviteOut").value); });
  $("pasteReply").addEventListener("click", function () { pasteInto($("replyIn")); });
  $("scanReply").addEventListener("click", function () { startScan(function (code) { $("replyIn").value = code; acceptReplyFlow(); }); });
  $("acceptReply").addEventListener("click", acceptReplyFlow);
  $("pasteInvite").addEventListener("click", function () { pasteInto($("inviteIn")); });
  $("scanInvite").addEventListener("click", function () { startScan(function (code) { $("inviteIn").value = code; answerInvite(); }); });
  $("makeReply").addEventListener("click", answerInvite);
  $("copyReply").addEventListener("click", function () { clip($("replyOut").value); });
  $("shareReply").addEventListener("click", function () { share($("replyOut").value); });

  /* recovery */
  $("recReload").addEventListener("click", function () { location.reload(); });
  $("rec2D").addEventListener("click", function () { prefs.use3d = false; savePrefs(); location.hash = "#force2d"; location.reload(); });
  $("recFresh").addEventListener("click", function () { lsDel(SAVE_KEY); lsDel(PREF_KEY); location.hash = ""; location.reload(); });

  window.addEventListener("resize", function () {
    if (R2) R2.resize();
    if (R3) R3.resize();
    needFrame();
  });
  /* a tab coming back from the background repaints and re-arms the clock */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      clock.lastT = performance.now();
      if (R) { R.dirty = true; }
      needFrame();
    }
  });
}

/* ===== service worker: offline + the update whisper ===== */
function wireSW() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("sw.js").then(function (reg) {
    function watch(worker) {
      worker.addEventListener("statechange", function () {
        if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdateBar(worker);
      });
    }
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);
    if (reg.installing) watch(reg.installing);
    reg.addEventListener("updatefound", function () { if (reg.installing) watch(reg.installing); });
  }).catch(function () {});
  /* on a first visit clients.claim() also fires controllerchange — only
     reload when a controller existed at load (a genuine version swap) */
  var hadController = !!navigator.serviceWorker.controller;
  var reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (!hadController) { hadController = true; return; }
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}
function showUpdateBar(worker) {
  if ($("updateBar")) return;
  var b = document.createElement("button");
  b.id = "updateBar";
  b.textContent = "✨ A new version of the room is ready — tap to refresh";
  b.addEventListener("click", function () { worker.postMessage({ type: "SKIP_WAITING" }); });
  document.body.appendChild(b);
}

/* ===== go ===== */
function boot() {
  wireUI();
  lanHandlers();
  initRenderers();
  wireInput();
  syncSettingsUI();
  wireSW();
  G = Chess.create();          /* an idle board behind the menu */
  R.setPosition(G.board, { flourish: true });
  mode = null;
  syncAll();
  needFrame();

  /* arriving by invite link? straight into the join flow */
  var joinM = location.hash.match(/#join=(CHESS(1|2)\.[A-Za-z0-9_-]+)/);
  setTimeout(function () {
    $("splash").classList.add("gone");
    if (joinM) {
      history.replaceState(null, "", location.pathname);
      openLink();
      joinFlow(joinM[1]);
    } else {
      showMenu();
    }
  }, REDUCED ? 150 : 900);
}

try { boot(); } catch (e) { panic(); throw e; }

/* dev handle, in the house style */
window.__cr = { get game() { return G; }, Chess: Chess, Book: Book, Net: Net,
  get mode() { return mode; }, startGame: startGame, get renderer() { return R; } };
})();
