/* app.js — the conductor.

   Everything that is not the rules, the geometry, the players, the
   coach, the look or the link. Game flow, the tray of buttons, the
   settings panes, the join door, persistence, and the frame loop.

   One idea shapes most of this file: **the screen is always drawn from
   a view, never from the game.** In a solo match the view is
   `Rules.publicView(state, 0)`; on a joined phone it is the view the
   host sent. Both are the same shape, so there is exactly one drawing
   path, one hit-test, one hint panel — and a joined phone cannot render
   something it was not told, because it does not have it.            */
(function () {
"use strict";

var R = window.Rules, L = window.Layout, AI = window.AI, C = window.Coach,
    Sk = window.Skins, Net = window.Net, Room = window.Room;

/* who this table is, as far as the shared front door is concerned
   (see room.js — the same four-letter door the chess room uses) */
Room.configure({ game: "domino", seats: 4, label: "table" });

/* ---------- the small change ---------- */
function $(id) { return document.getElementById(id); }
/* One place where iOS Safari's synthesized click is dealt with. Every
   tappable thing goes through this, never a bare click listener: a
   pointerdown that is followed by the ghost click would otherwise fire
   the same button twice. */
function press(el, fn) {
  if (!el) return;
  var used = false;
  el.addEventListener("pointerdown", function (e) {
    used = true;
    el.classList.add("down");
    e.preventDefault();
  }, { passive: false });
  el.addEventListener("pointerup", function (e) {
    el.classList.remove("down");
    if (!used) return;
    used = false;
    e.preventDefault();
    fn(e);
  }, { passive: false });
  el.addEventListener("pointercancel", function () { used = false; el.classList.remove("down"); });
  el.addEventListener("click", function (e) { e.preventDefault(); });
}
function esc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function open(id) { $(id).classList.remove("hide"); }
function shut(id) { $(id).classList.add("hide"); }
document.addEventListener("pointerdown", function (e) {
  var c = e.target.getAttribute && e.target.getAttribute("data-close");
  if (c) shut(c);
  /* tapping the dark outside a sheet closes it too */
  if (e.target.classList && e.target.classList.contains("ov")) e.target.classList.add("hide");
});

var toastT = 0;
function toast(msg) {
  var t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(function () { t.classList.remove("on"); }, 2600);
}

/* ---------- what we remember ---------- */
var SAVE = "dominotable.v1";
var P = {
  name: "", skin: null, view3d: true, level: "compadre",
  pace: "relaxed",
  rules: { target: 100, capicua: 25, countAll: false, trancaTie: "closer", firstSalida: "mula" },
  seen: {}, coach: true
};
function load() {
  try {
    var raw = JSON.parse(localStorage.getItem(SAVE) || "null");
    if (raw && raw.v === 1) {
      P.name = Net.cleanName(raw.name || "");
      P.view3d = raw.view3d !== false;
      P.level = AI.LEVELS[raw.level] ? raw.level : "compadre";
      P.pace = PACES[raw.pace] ? raw.pace : "relaxed";
      P.coach = raw.coach !== false;
      P.seen = raw.seen || {};
      if (raw.rules) P.rules = R.houseRules(raw.rules);
      if (raw.skin) P.skin = Sk.clean(raw.skin);
    }
  } catch (e) { /* a corrupt save is quietly retired rather than fatal */ }
  if (!P.skin) P.skin = Sk.clean(Sk.PRESETS[0]);
  if (!P.name) P.name = "";
}
function save() {
  try {
    localStorage.setItem(SAVE, JSON.stringify({
      v: 1, name: P.name, skin: P.skin, view3d: P.view3d, level: P.level, pace: P.pace,
      rules: P.rules, seen: P.seen, coach: P.coach
    }));
  } catch (e) { /* private browsing; the game still plays */ }
}

/* ---------- the game ---------- */
var G = {
  mode: "solo",         /* solo | host | guest */
  match: null, st: null,
  view: null,
  mySeat: 0,
  names: { 0: "You", 1: "Beto", 2: "Lupe", 3: "Chuy" },
  sel: null,            /* the bone lifted out of your hand */
  thinking: -1,         /* which seat is deciding, so the table can see  */
  lastNote: null,       /* what just happened, in a few words            */
  anim: null,
  busy: false,
  hintOn: false,
  lastIdx: -1,
  handNo: 0
};
var BOT_NAMES = ["Beto", "Lupe", "Chuy", "Nacho", "Tere", "Memo", "Rosa", "Paco"];

/* ---------- the canvas ---------- */
var tableCv = $("table"), overCv = $("overlay");
var gfx = null, over = null;

/* A canvas can only ever hand out one kind of context. Ask a canvas
   that has given you a WebGL context for a 2D one and you get null, for
   the rest of its life — so switching from the 3D table to the flat one
   on the same element leaves the flat renderer with nothing to draw on,
   and the table quietly freezes. (It did. The browser check caught it;
   nothing in node ever could, because node has no canvas at all.)

   So the element is replaced rather than reused. It is cheap, it
   happens twice in a session at most, and it is the only way to be sure
   the new renderer starts from a clean surface. */
function freshCanvas(old) {
  var n = document.createElement("canvas");
  n.id = old.id;
  n.className = old.className;
  old.parentNode.replaceChild(n, old);
  return n;
}

function makeRenderers() {
  if (gfx && gfx.destroy) gfx.destroy();
  gfx = null;
  tableCv = freshCanvas(tableCv);
  overCv = freshCanvas(overCv);
  if (P.view3d) {
    var g3 = new window.Gfx3D(tableCv);
    if (g3.ok) gfx = g3;
    else tableCv = freshCanvas(tableCv);   /* it took a WebGL context and failed; start over for 2D */
  }
  if (!gfx) {
    gfx = new window.Gfx2D(tableCv);
    if (P.view3d) {
      /* asked for 3D and could not have it — say so once, then get on
         with the game rather than blocking on a dialog */
      P.view3d = false;
      toast("No 3D on this browser — playing flat.");
    }
  }
  watchContext(tableCv);
  over = new window.Gfx2D(overCv);
  over.transparent = true;
  gfx.setSkin(P.skin);
  over.setSkin(P.skin);
  sized = false;
  resize();
}

var sized = false;
function resize() {
  var st = $("stage");
  var w = st.clientWidth, h = st.clientHeight;
  if (!w || !h) return;
  var dpr = window.devicePixelRatio || 1;
  gfx.resize(w, h, dpr);
  over.resize(w, h, dpr);
  sized = true;
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", function () { setTimeout(resize, 220); });

/* The 3D context is lost whenever a phone sleeps in a pocket, and the
   game carries on flat rather than showing a dead rectangle. Bound
   inside `makeRenderers` because the canvas element is replaced on
   every switch — a listener attached once at boot would be sitting on a
   node that is no longer in the page. */
function watchContext(cv) {
  cv.addEventListener("webglcontextlost", function (e) {
    e.preventDefault();
    setTimeout(function () {
      if (gfx && !gfx.ok) {
        P.view3d = false; save();
        makeRenderers();
        toast("Lost the 3D table — same game, flat.");
      }
    }, 60);
  }, false);
}

/* ---------- building the scene ---------- */
function scene() {
  var v = G.view;
  var line = v ? v.line : [];
  var bound = boundFor();
  var t = L.table(line, { bound: bound });
  var playable = {}, ghosts = [];
  var mine = v && v.turn === G.mySeat && !G.busy;
  if (mine && v) {
    var mv = AI.movesFor(v);
    for (var i = 0; i < mv.length; i++) {
      if (!playable[mv[i].tile]) playable[mv[i].tile] = [];
      playable[mv[i].tile].push(mv[i].end);
    }
    if (G.sel !== null && playable[G.sel]) {
      var ends = playable[G.sel];
      for (var k = 0; k < ends.length; k++) {
        var e = t.ends[ends[k]];
        ghosts.push({ end: ends[k], x: e.x + L.DX[e.h] * (isDbl(G.sel) ? 0.5 : 1),
                      y: e.y + L.DY[e.h] * (isDbl(G.sel) ? 0.5 : 1), h: e.h });
      }
    }
  }
  var seats = [];
  for (var s = 0; s < 4; s++) {
    seats.push({
      seat: s, rel: (s - G.mySeat + 4) % 4, you: s === G.mySeat,
      count: v ? v.counts[s] : 7
    });
  }
  return {
    view: v, table: t, hand: v ? v.hand : [],
    playable: playable, selected: G.sel, ghosts: ghosts,
    seats: seats, lastIdx: G.lastIdx, anim: G.anim,
    yourTurn: mine, topPad: 74, botPad: 132
  };
}
function isDbl(t) { return R.isDouble(t); }
/* how far the line may run before it folds — a phone held upright folds
   sooner than a tablet on its side, which is the whole point of the
   bound being a parameter */
function boundFor() {
  var w = $("stage").clientWidth || 390, h = $("stage").clientHeight || 600;
  return Math.max(5, Math.min(16, Math.round(w / h * 9 + 2)));
}

/* ---------- the frame loop ---------- */
var last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!sized || !G.view) return;
  var dt = Math.min(64, now - last) / 1000;
  last = now;
  if (G.anim) {
    G.anim.t += dt / G.anim.dur;
    if (G.anim.t >= 1) { G.anim = null; }
  }
  var sc = scene();
  if (gfx.kind === "3d") {
    gfx.draw(sc, now);
    over.drawHand(sc, now);
  } else {
    gfx.draw(sc, now);
    over.g.clearRect(0, 0, over.cv.width, over.cv.height);
  }
}
requestAnimationFrame(frame);

/* ---------- taps on the table ---------- */
function stagePoint(e) {
  var r = $("stage").getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
$("stage").addEventListener("pointerdown", function (e) {
  if (!G.view || G.busy) return;
  var p = stagePoint(e);
  /* the hand always belongs to the overlay, in both renderers, so the
     tap target is identical whichever one is drawing the table */
  var h = over.hit(p.x, p.y);
  if (h.kind === "hand") { pickBone(G.view.hand[h.i]); return; }
  if (G.view.turn !== G.mySeat) return;

  var end = null;
  if (gfx.kind === "3d") {
    var got = gfx.hitTable(p.x, p.y, scene());
    if (got) end = got.end;
  } else {
    var g2 = gfx.hit(p.x, p.y);
    if (g2.kind === "end") end = g2.end;
  }
  if (end && G.sel !== null) tryPlay(G.sel, end);
});

function pickBone(tile) {
  if (tile === undefined || G.view.turn !== G.mySeat) return;
  var mv = AI.movesFor(G.view), ends = [];
  for (var i = 0; i < mv.length; i++) if (mv[i].tile === tile) ends.push(mv[i].end);
  if (!ends.length) {
    toast("That one doesn't fit either end.");
    return;
  }
  /* one place it can go: put it there. Two: lift it and let them
     choose. Making somebody confirm a decision with only one possible
     answer is the commonest way to make a game feel slow. */
  if (ends.length === 1) { tryPlay(tile, ends[0]); return; }
  G.sel = (G.sel === tile) ? null : tile;
}

function tryPlay(tile, end) {
  G.sel = null;
  if (G.mode === "guest") {
    Net.send({ k: "mv", tile: tile, end: end });
    G.busy = true;
    setTimeout(function () { G.busy = false; }, 900);
    return;
  }
  doPlay(G.mySeat, { tile: tile, end: end });
}

/* ---------- the hand, on the host or solo ---------- */
function doPlay(seat, mv) {
  var st = G.st;
  if (!st || st.over || st.turn !== seat) return false;
  var fromIdx = st.line.length;
  st.error = null;
  R.play(st, mv);
  if (st.error) { toast(st.error); st.error = null; return false; }
  startAnim(fromIdx, seat);
  G.lastIdx = fromIdx;
  note(seat, nameOf(seat) + " played the " + C.boneName(mv.tile));
  afterMove();
  return true;
}
function doPass(seat) {
  var st = G.st;
  if (!st || st.over || st.turn !== seat) return false;
  st.error = null;
  R.pass(st);
  if (st.error) { st.error = null; return false; }
  sayMoment({ k: "pass", seat: seat, you: G.mySeat, ends: [st.left, st.right] });
  note(seat, nameOf(seat) + " · ¡paso!");
  banner("¡Paso!", nameOf(seat) + " can't play", 900);
  afterMove();
  return true;
}

/* a bone comes down from the seat that played it */
function startAnim(idx, seat) {
  var t = L.table(G.st ? G.st.line : G.view.line, { bound: boundFor() });
  var b = t.bones[idx];
  if (!b) return;
  var rel = (seat - G.mySeat + 4) % 4;
  var away = 9;
  var from = [[0, away], [away, 0], [0, -away], [-away, 0]][rel];
  G.anim = {
    idx: idx, t: 0, dur: 0.34,
    fromX: b.x + from[0], fromY: b.y + from[1],
    fromRot: b.rot + (rel % 2 ? 90 : 0)
  };
}

function afterMove() {
  refreshView();
  syncAll();
  if (G.st.over) { setTimeout(endHand, 620); return; }
  if (G.mode === "host") Net.dealViews(G.st, { turn: G.st.turn, last: G.lastIdx });
  /* beat three: a pause to look at what just landed. The bone's own
     animation runs ~340ms, so starting the next player's thinking
     immediately means the table never rests — which is what made three
     machines feel like one blur. */
  clearTimeout(turnT);
  turnT = setTimeout(scheduleTurn, pace().settle);
}

/* what just happened, in a few words under the seat strip. The point of
   the room is that you can read the table; that starts with being able
   to see who did what. */
function note(seat, text) {
  G.lastNote = { seat: seat, text: text };
  syncAll();
}

/* whose turn, and what happens next */
/* ---------- the pace of a hand ----------
   Three players moving as fast as a machine can decide is not a game you
   can follow — bones appear on the table and you are left working out
   backwards who put them there. A table has a rhythm: somebody thinks,
   somebody plays, everybody looks at it, the next one starts.

   So a turn is three beats rather than one timeout. The seat whose turn
   it is says so before anything happens, the play lands, and there is a
   pause afterwards to look at what landed before the next player starts
   thinking. `PACE` scales all three together. */
var PACES = {
  relaxed: { id: "relaxed", label: "Relaxed", note: "A beat to see each play land.", think: 900, spread: 700, settle: 750 },
  brisk:   { id: "brisk",   label: "Brisk",   note: "The usual pace of a table in a hurry.", think: 520, spread: 420, settle: 380 },
  quick:   { id: "quick",   label: "Quick",   note: "For when you just want the hand over.", think: 200, spread: 160, settle: 120 }
};
function pace() { return PACES[P.pace] || PACES.relaxed; }

var turnT = 0;
function scheduleTurn() {
  clearTimeout(turnT);
  var st = G.st;
  if (!st || st.over) return;
  var seat = st.turn;
  G.thinking = -1;

  if (isHuman(seat)) {
    if (!R.canPlay(st, seat)) {
      /* a human who cannot play still has to say it out loud — but
         making them tap a button they have no choice about is theatre,
         so it is said for them after a beat */
      turnT = setTimeout(function () { doPass(seat); }, pace().think);
    }
    syncAll();
    return;
  }

  /* beat one: this seat is thinking, and the table can see who */
  var p = pace();
  G.thinking = seat;
  syncAll();
  turnT = setTimeout(function () {
    if (!G.st || G.st.over || G.st.turn !== seat) return;
    G.thinking = -1;
    /* beat two: the play */
    if (!R.canPlay(G.st, seat)) { doPass(seat); return; }
    var v = R.publicView(G.st, seat);
    var a = AI.analyse(v, { level: P.level });
    if (a.move) doPlay(seat, a.move); else doPass(seat);
  }, p.think + Math.random() * p.spread);
}
function isHuman(seat) {
  if (G.mode === "solo") return seat === 0;
  if (G.mode === "host") {
    if (seat === 0) return true;
    for (var i = 0; i < Net.peers.length; i++) if (Net.peers[i].seat === seat) return true;
    return false;
  }
  return false;
}

function refreshView() {
  if (G.mode !== "guest" && G.st) G.view = R.publicView(G.st, G.mySeat);
}

/* ---------- a hand begins ---------- */
function newMatch() {
  /* the hand is dealt: the table stops advertising itself but keeps its
     four letters, because that is the address latecomers — and anyone
     whose phone locked — come back to */
  if (G.mode === "host") Net.roomStarted();
  G.match = R.newMatch({ seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0, rules: P.rules });
  G.handNo = 0;
  nextHand(true);
}
function nextHand(first) {
  G.sel = null; G.anim = null; G.lastIdx = -1;
  G.st = R.dealHand(G.match);
  refreshView();
  G.busy = true;
  shuffleTitle(first, function () {
    G.busy = false;
    if (G.mode === "host") Net.dealViews(G.st, { turn: G.st.turn, start: true });
    syncAll();
    var opener = G.st.turn;
    if (G.st.mustLeadMula && opener === G.mySeat) {
      banner("La mula de seis", "It opens the first hand — play it", 1500);
    } else if (opener !== G.mySeat) {
      banner(nameOf(opener) + " opens", "", 900);
    }
    scheduleTurn();
  });
}

/* the shuffle: the bones are washed face down with both hands, and the
   hand is named as it starts */
function shuffleTitle(first, then) {
  var n = (G.match ? G.match.handNo : 0) + 1;
  var subs = ["lavando las fichas", "washing the bones", "seven each, nothing left over"];
  banner(first ? "¡A jugar!" : "Mano " + n, subs[n % subs.length], 1050, true);
  setTimeout(then, 1080);
}

var bannerT = 0;
function banner(big, sub, ms, slam) {
  var b = $("banner");
  b.querySelector(".big").textContent = big;
  b.querySelector(".sub").textContent = sub || "";
  b.classList.add("on");
  b.classList.toggle("slam", !!slam);
  clearTimeout(bannerT);
  bannerT = setTimeout(function () { b.classList.remove("on"); }, ms || 1200);
}

/* ---------- a hand ends ---------- */
function endHand() {
  var st = G.st, r = st.result;
  if (!r) return;
  R.settle(G.match, st);
  if (G.mode === "host") Net.broadcast({ k: "end", res: r, scores: G.match.scores, over: G.match.over });
  showEnd(r, G.match);
}

function showEnd(r, m) {
  var us = R.team(G.mySeat);
  var won = r.team === us;
  var title, lead;
  if (r.how === "domino") {
    title = r.winner === G.mySeat ? "¡Dominó!" : nameOf(r.winner) + " went out";
    if (r.capicua) title = "¡Capicúa!";
    lead = won ? "That is " + r.points + " to us." : "That is " + r.points + " to them.";
  } else {
    title = "Trancado";
    lead = r.team < 0 ? "Dead even — nobody scores."
      : (won ? "Shut, and we were lighter. " + r.points + " to us."
             : "Shut, and they were lighter. " + r.points + " to them.");
  }
  $("endTitle").textContent = title;
  $("endLead").textContent = lead;

  var rows = "<table class='tally'><tr><th>Hand</th><th>Nosotros</th><th>Ellos</th></tr>";
  for (var i = 0; i < m.history.length; i++) {
    var h = m.history[i];
    rows += "<tr" + (h.team === us ? " class='win'" : "") + "><td>" + (i + 1) +
      (h.how === "tranca" ? " <span class='cap'>trancado</span>" : "") +
      (h.capicua ? " <span class='cap'>capicúa</span>" : "") +
      "</td><td>" + h.scores[us] + "</td><td>" + h.scores[1 - us] + "</td></tr>";
  }
  rows += "</table>";
  var pipRow = "<p class='note'>Left holding: ";
  for (var s = 0; s < 4; s++) pipRow += esc(nameOf(s)) + " " + r.pipsBySeat[s] + (s < 3 ? " · " : "");
  pipRow += "</p>";
  $("endBody").innerHTML = rows + pipRow;

  if (m.over) {
    $("endTitle").textContent = m.champion === us ? "We take the match" : "They take the match";
    $("endLead").textContent = m.zapatero
      ? (m.champion === us ? "¡Zapatero! They never scored once." : "Zapatero — we never scored once.")
      : "To " + m.rules.target + ". " + m.scores[us] + "–" + m.scores[1 - us] + ".";
    $("endNext").textContent = "Another match";
  } else {
    $("endNext").textContent = "Next hand";
  }
  sayMoment({ k: "end", res: r });
  if (m.over && m.zapatero) sayMoment({ k: "match", zapatero: true });
  open("ovEnd");
}

press($("endNext"), function () {
  shut("ovEnd");
  if (G.match.over) newMatch(); else nextHand(false);
});
press($("endLesson"), function () {
  shut("ovEnd");
  showLessons();
});

/* ---------- Don Chuy ---------- */
function sayMoment(e) {
  if (!P.coach || !G.view) return;
  var m = C.moment(e, P.seen, G.names, G.view);
  if (!m) return;
  if (m.once) { P.seen[m.id] = 1; save(); }
  chuy(m.text, "");
}
function chuy(say, why) {
  $("chuySay").textContent = say;
  $("chuyWhy").textContent = why || "";
  $("chuy").classList.remove("off");
}
press($("chuyClose"), function () { $("chuy").classList.add("off"); });

press($("btnHint"), function () {
  if (!G.view) return;
  if (G.view.turn !== G.mySeat) { chuy("Not your turn yet — watch what they play.", ""); return; }
  var a = AI.analyse(G.view, { level: "maestro" });
  var h = C.hint(G.view, a, { names: G.names });
  chuy(h.title, h.lines.join(" "));
  if (h.move) G.sel = h.move.tile;
});

/* ---------- the counting panel ---------- */
press($("btnCount"), function () { showCount(); });
function showCount() {
  if (!G.view) return;
  var rt = C.readTable(G.view, G.names);
  var html = "<div class='census'>";
  for (var i = 0; i < rt.census.length; i++) {
    var c = rt.census[i];
    html += "<div class='cs" + (c.live === 0 ? " none" : "") + "'><b>" + c.live + "</b>" +
      "<small>" + esc(c.name) + "</small><small>you " + c.mine + "</small></div>";
  }
  html += "</div><p class='note'>The big number is how many bones carrying that suit you have not seen yet — in three hands between them.</p>";
  if (rt.voids.length) {
    html += "<ul class='reads'>";
    for (var k = 0; k < rt.voids.length; k++) {
      html += "<li class='" + (rt.voids[k].mate ? "mate" : "") + "'>" + esc(rt.voids[k].text) + "</li>";
    }
    html += "</ul>";
  } else {
    html += "<p class='note'>" + esc(rt.note) + "</p>";
  }
  $("countBody").innerHTML = html;
  open("ovCount");
}

/* ---------- the tray ---------- */
press($("btnPlay"), function () {
  if (!G.view) return;
  if (G.view.turn !== G.mySeat) { toast("It's " + nameOf(G.view.turn) + "'s turn."); return; }
  var mv = AI.movesFor(G.view);
  if (!mv.length) {
    if (G.mode === "guest") Net.send({ k: "pass" }); else doPass(G.mySeat);
    return;
  }
  if (G.sel !== null) {
    var ends = [];
    for (var i = 0; i < mv.length; i++) if (mv[i].tile === G.sel) ends.push(mv[i].end);
    if (ends.length) { tryPlay(G.sel, ends[0]); return; }
  }
  toast("Tap a bone to play it.");
});
press($("btnMenu"), function () { showMenu(); });

function syncAll() {
  var v = G.view;
  if (!v) return;
  /* the seat strip */
  var html = "";
  for (var s = 0; s < 4; s++) {
    var rel = (s - G.mySeat + 4) % 4;
    var us = R.team(s) === R.team(G.mySeat);
    var bot = !isHuman(s) && G.mode !== "guest";
    html += "<div class='seat " + (us ? "us" : "them") + (s === v.turn ? " turn" : "") +
      (s === G.mySeat ? " you" : "") + (bot ? " bot" : "") +
      (s === G.thinking ? " thinking" : "") + "'>" +
      "<span class='dot'></span><span class='nm'>" + esc(nameOf(s)) +
      (rel === 2 ? " ·" : "") + "</span>" +
      "<span class='bones'>" + v.counts[s] + "</span></div>";
  }
  $("seats").innerHTML = html;

  /* the running commentary: who is deciding, and what they just did */
  var ln = $("lastPlay");
  if (G.thinking >= 0) {
    ln.textContent = nameOf(G.thinking) + " is thinking…";
    ln.className = "thinking";
  } else if (G.lastNote) {
    ln.textContent = G.lastNote.text;
    ln.className = R.team(G.lastNote.seat) === R.team(G.mySeat) ? "us" : "them";
  } else { ln.textContent = ""; ln.className = ""; }

  /* the score */
  var us2 = R.team(G.mySeat);
  var sc = G.match ? G.match.scores : [0, 0];
  $("scoreUs").innerHTML = "Nosotros <b>" + sc[us2] + "</b>";
  $("scoreThem").innerHTML = "Ellos <b>" + sc[1 - us2] + "</b>";
  $("scoreUs").classList.toggle("lead", sc[us2] > sc[1 - us2]);
  $("scoreThem").classList.toggle("lead", sc[1 - us2] > sc[us2]);

  /* the big button says what it will do */
  var mine = v.turn === G.mySeat;
  var mv = mine ? AI.movesFor(v) : [];
  var b = $("btnPlay");
  b.classList.toggle("pulse", mine);
  b.disabled = false;
  if (!mine) b.textContent = nameOf(v.turn) + "'s turn";
  else if (!mv.length) b.textContent = "Paso — I can't play";
  else if (G.sel !== null) b.textContent = "Play the " + C.boneName(G.sel);
  else b.textContent = "Your turn";
  $("btnHint").disabled = !mine;
}
function nameOf(s) { return G.names[s] || ("Seat " + s); }

/* ---------- the menu ---------- */
function showMenu() {
  $("menuState").textContent = G.match
    ? ("To " + G.match.rules.target + " · hand " + (G.match.handNo + 1) + " · " +
       AI.level(P.level).label + " opponents")
    : "No match yet.";
  $("mView").textContent = P.view3d ? "Switch to 2D" : "Switch to 3D";
  $("menuNote").textContent = gfx && gfx.kind === "3d"
    ? "Drawn in 3D. The bones in your hand stay flat and crisp on purpose."
    : "Drawn flat. Every phone can do this one.";
  open("ovMenu");
}
press($("mNew"), function () { shut("ovMenu"); newMatch(); });
press($("mLook"), function () { shut("ovMenu"); showLook(); });
press($("mRules"), function () { shut("ovMenu"); showRules(); });
press($("mLearn"), function () { shut("ovMenu"); showLessons(); });
press($("mParty"), function () { shut("ovMenu"); showParty(); });
press($("mView"), function () {
  P.view3d = !P.view3d; save();
  makeRenderers();
  shut("ovMenu");
  toast(P.view3d ? "Three dimensions." : "Flat on the table.");
});

/* ---------- how it's played ---------- */
function showLessons() {
  var html = "";
  for (var i = 0; i < C.LESSONS.length; i++) {
    html += "<div class='opt' style='margin-bottom:8px'><b>" + esc(C.LESSONS[i].title) + "</b>" +
      "<small>" + esc(C.LESSONS[i].body) + "</small></div>";
  }
  $("lessons").innerHTML = html;
  open("ovLearn");
}

/* ---------- house rules ---------- */
var RULE_FORM = [
  { k: "target", label: "Play to", opts: [[50, "50 — quick"], [100, "100 — the usual"], [200, "200 — a long night"]] },
  { k: "capicua", label: "Capicúa pays", opts: [[0, "nothing"], [25, "25 — the usual"], [50, "50"]] },
  { k: "countAll", label: "The winner counts", opts: [[false, "the other side's bones"], [true, "everyone's, partner included"]] },
  { k: "trancaTie", label: "A tied shut game", opts: [["closer", "goes to whoever shut it"], ["nobody", "goes to nobody"]] },
  { k: "level", label: "The others play", opts: [["novato", "Novato"], ["compadre", "Compadre"], ["maestro", "Maestro"], ["cabron", "Cabrón"]] },
  { k: "pace", label: "The table moves", opts: [["relaxed", "Relaxed"], ["brisk", "Brisk"], ["quick", "Quick"]] }
];
function showRules() {
  var html = "";
  for (var i = 0; i < RULE_FORM.length; i++) {
    var f = RULE_FORM[i];
    /* level and pace are preferences, not house rules — they live on P
       itself rather than in P.rules, and reading them out of P.rules
       leaves the row with nothing lit up */
    var cur = f.k === "level" ? P.level : f.k === "pace" ? P.pace : P.rules[f.k];
    html += "<div class='fld'><label><b>" + esc(f.label) + "</b></label><div class='opts'>";
    for (var j = 0; j < f.opts.length; j++) {
      var o = f.opts[j];
      html += "<button class='opt" + (String(o[0]) === String(cur) ? " on" : "") +
        "' data-rk='" + esc(f.k) + "' data-rv='" + esc(o[0]) + "'><b>" + esc(o[1]) + "</b></button>";
    }
    html += "</div></div>";
  }
  html += "<p class='note'>" + esc(AI.level(P.level).note) + " · " + esc(pace().note) + "</p>";
  $("rulesForm").innerHTML = html;
  var btns = $("rulesForm").querySelectorAll("[data-rk]");
  for (var b = 0; b < btns.length; b++) press(btns[b], onRulePick);
  open("ovRules");
}
function onRulePick(e) {
  var el = e.currentTarget || e.target;
  var k = el.getAttribute("data-rk"), raw = el.getAttribute("data-rv");
  if (k === "level") P.level = raw;
  else if (k === "pace") P.pace = PACES[raw] ? raw : "relaxed";
  else if (k === "countAll") P.rules.countAll = (raw === "true");
  else if (k === "trancaTie") P.rules.trancaTie = raw;
  else P.rules[k] = parseInt(raw, 10);
  P.rules = R.houseRules(P.rules);
  save();
  showRules();
}
press($("rulesApply"), function () { shut("ovRules"); newMatch(); toast("Fresh match, new rules."); });

/* ---------- the colours ---------- */
var EDIT = [
  { g: "table", k: "felt", label: "Table" },
  { g: "table", k: "rim", label: "Rim" },
  { g: "table", k: "edge", label: "Grain" },
  { g: "table", k: "line", label: "Pattern" },
  { g: "bones", k: "face", label: "Bone" },
  { g: "bones", k: "pip", label: "Pips" },
  { g: "bones", k: "back", label: "Backs" },
  { g: "marks", k: "playable", label: "Playable" },
  { g: "marks", k: "ghost", label: "Slots" },
  { g: "room", k: "bg", label: "Room" }
];
function showLook() {
  drawGallery();
  drawEditor();
  $("lookOut").innerHTML = "";
  open("ovLook");
}
function drawGallery() {
  var list = Sk.gallery(), html = "";
  for (var i = 0; i < list.length; i++) {
    html += "<button class='tile" + (list[i].name === P.skin.name ? " on" : "") +
      "' data-sk='" + i + "'><canvas width='236' height='124'></canvas><span>" +
      esc(list[i].name) + "</span></button>";
  }
  $("gallery").innerHTML = html;
  var tiles = $("gallery").querySelectorAll("[data-sk]");
  for (var k = 0; k < tiles.length; k++) {
    thumb(tiles[k].querySelector("canvas"), list[k]);
    (function (sk) {
      press(tiles[k], function () {
        P.skin = Sk.clean(sk); save();
        gfx.setSkin(P.skin); over.setSkin(P.skin);
        drawGallery(); drawEditor();
      });
    })(list[k]);
  }
}
/* a preview drawn with the real bone painter, so a thumbnail cannot
   promise a look the table will not deliver */
function thumb(cv, skin) {
  var g = cv.getContext("2d");
  var tmp = new window.Gfx2D(cv);
  tmp.skin = Sk.clean(skin);
  tmp.dpr = 1; tmp.w = cv.width; tmp.h = cv.height;
  g.fillStyle = skin.table.felt; g.fillRect(0, 0, cv.width, cv.height);
  tmp.bone(78, 62, 76, 38, 0, 6, 3, {});
  tmp.bone(158, 62, 38, 76, 0, 5, 5, { lift: 0.6 });
}
function drawEditor() {
  var html = "<div class='fld'><label><b>Colours</b></label><div class='swatches'>";
  for (var i = 0; i < EDIT.length; i++) {
    var e = EDIT[i];
    html += "<label class='sw'><input type='color' data-cg='" + e.g + "' data-ck='" + e.k +
      "' value='" + esc(P.skin[e.g][e.k]) + "'>" + esc(e.label) + "</label>";
  }
  html += "</div></div>";

  html += slider("Grain", "table", "grain", P.skin.table.grain);
  html += slider("Gloss", "table", "gloss", P.skin.table.gloss);
  html += slider("Shine", "bones", "shine", P.skin.bones.shine);
  html += slider("Bevel", "bones", "rim", P.skin.bones.rim);

  html += "<div class='fld'><label><b>Bones are cut from</b></label><div class='opts'>";
  Sk.MATERIAL_ORDER.forEach(function (m) {
    var mm = Sk.MATERIALS[m];
    html += "<button class='opt" + (P.skin.bones.material === m ? " on" : "") + "' data-mat='" + m +
      "'><b>" + esc(mm.label) + "</b><small>" + esc(mm.note) + "</small></button>";
  });
  html += "</div></div><div class='fld'><label><b>The table is</b></label><div class='opts'>";
  Sk.PATTERN_ORDER.forEach(function (p) {
    var pp = Sk.PATTERNS[p];
    html += "<button class='opt" + (P.skin.table.pattern === p ? " on" : "") + "' data-pat='" + p +
      "'><b>" + esc(pp.label) + "</b><small>" + esc(pp.note) + "</small></button>";
  });
  html += "</div></div>";
  $("editor").innerHTML = html;

  wire("[data-cg]", "input", function (el) {
    P.skin[el.getAttribute("data-cg")][el.getAttribute("data-ck")] = el.value;
    applySkin();
  });
  wire("[data-sg]", "input", function (el) {
    P.skin[el.getAttribute("data-sg")][el.getAttribute("data-sk2")] = parseInt(el.value, 10) / 100;
    var v = el.parentNode.parentNode.querySelector(".val");
    if (v) v.textContent = el.value + "%";
    applySkin();
  });
  var mats = $("editor").querySelectorAll("[data-mat]");
  for (var a = 0; a < mats.length; a++) {
    (function (el) {
      press(el, function () { P.skin.bones.material = el.getAttribute("data-mat"); applySkin(); drawEditor(); });
    })(mats[a]);
  }
  var pats = $("editor").querySelectorAll("[data-pat]");
  for (var b = 0; b < pats.length; b++) {
    (function (el) {
      press(el, function () { P.skin.table.pattern = el.getAttribute("data-pat"); applySkin(); drawEditor(); });
    })(pats[b]);
  }
}
function slider(label, g, k, v) {
  return "<div class='fld'><label><b>" + esc(label) + "</b><span class='val'>" +
    Math.round(v * 100) + "%</span></label>" +
    "<input type='range' min='0' max='100' value='" + Math.round(v * 100) +
    "' data-sg='" + g + "' data-sk2='" + k + "'></div>";
}
function wire(sel, ev, fn) {
  var els = $("editor").querySelectorAll(sel);
  for (var i = 0; i < els.length; i++) {
    (function (el) { el.addEventListener(ev, function () { fn(el); }); })(els[i]);
  }
}
function applySkin() {
  P.skin = Sk.clean(P.skin);
  gfx.setSkin(P.skin); over.setSkin(P.skin);
  save();
}
press($("lookShare"), function () {
  var code = Sk.encode(P.skin);
  var url = location.origin + location.pathname + "#table=" + code;
  $("lookOut").innerHTML = "<p class='note'>Send this to anyone — it opens the room wearing your table.</p>" +
    "<div class='code mono'>" + esc(url) + "</div>";
  if (navigator.share) navigator.share({ title: "My domino table", text: code }).catch(function () {});
  else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast("Copied."); }, function () {});
});
press($("lookPaste"), function () {
  $("lookOut").innerHTML = "<div class='fld'><label><b>Paste a table code</b></label>" +
    "<input type='text' id='skinIn' placeholder='DOM1.…'></div>";
  var inp = $("skinIn");
  inp.focus();
  inp.addEventListener("input", function () {
    var got = Sk.decode(inp.value);
    if (got) {
      P.skin = got; applySkin(); drawGallery(); drawEditor();
      $("lookOut").innerHTML = "<p class='note ok'>Got it — " + esc(got.name) + ", by " + esc(got.maker) + ".</p>";
    }
  });
});
press($("lookSave"), function () {
  var nm = "My table " + (Sk.loadMine().length + 1);
  P.skin.name = nm; P.skin.maker = P.name || "Me";
  Sk.remember(P.skin);
  drawGallery();
  toast("Kept as “" + nm + "”.");
});
press($("lookReset"), function () {
  P.skin = Sk.clean(Sk.PRESETS[0]);
  applySkin(); drawGallery(); drawEditor();
});

/* ---------- four phones ----------
   The host puts a code on the screen and holds the phone up; everyone
   else points a camera at it, or taps the link. Empty chairs are played
   by the house until somebody sits down in them, so a table of two
   works exactly as well as a table of four. */
function showParty() {
  var body = $("partyBody");
  if (Net.role === "off") {
    var back = Room.recall();
    body.innerHTML =
      "<p class='lead'>One phone is the table — it deals, it keeps the score. The other three sit down at it by typing four letters. Empty chairs are played by the house until somebody takes them.</p>" +
      "<div class='fld'><label><b>Your name</b></label><input type='text' id='pName' maxlength='14' value='" + esc(P.name) + "' placeholder='Chuy'></div>" +
      (back ? "<div class='row'><button class='btn wide' id='pBack'>🕯 Back to <b>" + esc(back.code) + "</b></button></div>" : "") +
      "<div class='row'><button class='btn primary wide' id='pHost'>Be the table</button>" +
      "<button class='btn' id='pJoin'>Sit down at one</button></div>";
    press($("pHost"), function () { P.name = Net.cleanName($("pName").value); save(); hostTable(); });
    press($("pJoin"), function () { P.name = Net.cleanName($("pName").value); save(); joinTable(); });
    if (back) press($("pBack"), function () {
      P.name = Net.cleanName($("pName").value); save();
      Room.resume();
      /* the table itself comes back under the same four letters; a chair
         simply knocks on them again and is shown back to its own bones */
      if (back.role === "host") hostTable(true); else { joinTable(); joinByCode(back.code); }
    });
  }
  open("ovParty");
}

function hostTable(again) {
  G.mode = "host"; G.mySeat = 0;
  G.names = { 0: P.name || "You" };
  for (var s = 1; s < 4; s++) G.names[s] = BOT_NAMES[s - 1];
  showRoom(null);
  var fallback = null;
  Net.startHosting(P.name || "Host").then(function (code) {
    fallback = code;
    return Net.roomOpen({ name: (P.name ? P.name + "’s table" : "A domino table") });
  }).then(function (r) {
    /* four letters if the mailbox is there; the QR handshake if it isn't,
       which is what happens offline and on file:// */
    if (r) showRoom(r.code, again); else showInvite(fallback);
  }).catch(function () { showInvite(fallback); });
  Net.onRoster = function (roster) {
    for (var i = 0; i < roster.length; i++) {
      G.names[roster[i].seat] = roster[i].name || BOT_NAMES[roster[i].seat - 1] || ("Seat " + roster[i].seat);
    }
    syncAll();
    renderLobby();
  };
  /* Somebody sitting down and somebody coming back look the same from
     here, and should: deal that chair its own view and carry on. The
     seat was held for them by name (see net.js), so the bones are theirs. */
  Net.onLink = function (seat, nm) {
    toast(nm + " sat down.");
    renderLobby();
    syncNetChip();
    if (G.st) Net.dealViews(G.st, { turn: G.st.turn });
  };
  Net.onDrop = function (seat) {
    if (seat > 0) toast(nameOf(seat) + " dropped — the house plays that chair until they're back.");
    syncAll();
    syncNetChip();
    scheduleTurn();
  };
  Net.onMessage = function (msg, from) {
    if (msg.k === "mv") {
      if (G.st && G.st.turn === from) doPlay(from, { tile: msg.tile, end: msg.end });
    } else if (msg.k === "pass") {
      if (G.st && G.st.turn === from) doPass(from);
    }
  };
  if (!G.match) newMatch();
}

/* ---------- four letters ----------
   The table's own screen: the code, big, and who has sat down so far.
   Everything else is one tap away and nobody needs it. */
function showRoom(code, again) {
  var body = $("partyBody");
  body.innerHTML =
    "<p class='lead' id='roomHow'>" + (again
      ? "Same four letters as before — nothing to re-read. The chairs find their own way back."
      : "Read these out. On their phone: <b>Play together</b> → <b>Sit down at one</b>.") + "</p>" +
    "<div class='codeBig" + (code ? "" : " pending") + "' id='roomCode'>" + esc(code || "····") + "</div>" +
    "<div class='codeWait' id='roomWait'>" + (code ? "waiting for them to type it…" : "opening the table…") + "</div>" +
    "<div id='lobby'></div>" +
    "<div class='row'><button class='btn' id='pShare'>Send the code</button>" +
    "<button class='btn' id='pQR'>Codes &amp; QR instead</button></div>" +
    "<p class='note'>Everyone who is not here yet is played by the house, so you can start now and let them sit down as they arrive.</p>";
  renderLobby();
  syncNetChip();
  if (!code) return;
  press($("pShare"), function () {
    var url = Net.url(code);
    if (navigator.share) navigator.share({ title: "Sit down at my domino table", text: "Four letters: " + code, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast("Link copied."); }, function () {});
  });
  press($("pQR"), function () { Net.mintInvite().then(showInvite); });
}

/* the chair's own screen: type four letters, or tap a table you can see */
var roomListT = 0, roomJoining = false;
function joinByRoom() {
  $("partyBody").innerHTML =
    "<p class='lead'>Type the four letters the table read out.</p>" +
    "<div class='fld'><label><b>Your name</b></label><input type='text' id='jName' maxlength='14' value='" + esc(P.name) + "'></div>" +
    "<input class='codeIn' id='jRoom' maxlength='4' inputmode='latin' autocapitalize='characters' autocomplete='off' spellcheck='false' placeholder='····' aria-label='Their four-letter code'>" +
    "<div class='codeWait' id='jWait'>four letters and you're in</div>" +
    "<div class='roomList' id='jList'></div>" +
    "<div class='row'><button class='btn' id='jQR'>Codes &amp; QR instead</button></div>";
  press($("jQR"), function () { stopRoomList(); joinByPaste(null); });
  $("jRoom").addEventListener("input", function () {
    var v = Room.tidy(this.value);
    this.value = v;
    if (v.length === 4) joinByCode(v);
  });
  refreshRoomList();
  startRoomList();
  setTimeout(function () { try { $("jRoom").focus(); } catch (e) {} }, 250);
}
function jNote(t) { var el = $("jWait"); if (el) el.textContent = t; }
function startRoomList() { stopRoomList(); roomListT = setInterval(refreshRoomList, 3500); }
function stopRoomList() { if (roomListT) { clearInterval(roomListT); roomListT = 0; } }
function refreshRoomList() {
  Net.roomList().then(function (rooms) {
    var box = $("jList");
    if (!box) { stopRoomList(); return; }
    if (rooms === null) { noMailbox(); return; }
    if (!rooms.length) {
      box.innerHTML = "<div class='roomEmpty'>No tables waiting yet — when somebody taps <b>Be the table</b>, theirs shows up here.</div>";
      return;
    }
    box.innerHTML = rooms.map(function (r) {
      return "<button class='roomRow' data-code='" + esc(r.code) + "'>" +
        "<span class='rrCode'>" + esc(r.code) + "</span>" +
        "<span class='rrTx'><b>" + esc(r.name || "A table") + "</b><i>" + esc(r.host || "somebody") +
        " · " + (r.players || 1) + " of " + (r.seats || 4) + " seated</i></span>" +
        "<span class='rrGo'>sit down ▸</span></button>";
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll(".roomRow"), function (b) {
      press(b, function () { joinByCode(b.dataset.code); });
    });
  });
}
function noMailbox() {
  stopRoomList();
  toast("No four-letter codes here — the camera and paste way still works.");
  joinByPaste(null);
}
function joinByCode(code, retry) {
  code = Room.tidy(code);
  if (!Room.looksLikeCode(code) || roomJoining) return;
  if (Room.impossible(code)) { jNote("codes never use I or O — they'd read as 1 and 0. Check it again."); return; }
  var nameBox = $("jName");
  if (nameBox) { P.name = Net.cleanName(nameBox.value); save(); }
  roomJoining = true;
  stopRoomList();
  if ($("jList")) $("jList").innerHTML = "";
  jNote("knocking on " + code + "…");
  Net.roomJoin(code, P.name).then(function (r) {
    roomJoining = false;
    if (!r) { noMailbox(); return; }
    if (r.error) {
      /* "full" is nearly always a spare pigeonhole still being minted —
         one patient retry beats making somebody type it again */
      if (/full/i.test(r.error) && !retry) { jNote("that table is pulling up a chair…"); setTimeout(function () { joinByCode(code, true); }, 1600); return; }
      jNote(r.error);
      startRoomList();
      return;
    }
    jNote("found " + (r.name || code) + " — taking a seat…");
  }, function () { roomJoining = false; jNote("that didn't take — try the code again"); startRoomList(); });
}

/* ---------- the link's pulse, at the table ---------- */
function syncNetChip() {
  var el = $("netChip");
  if (!el) return;
  if (G.mode !== "host" && G.mode !== "guest") { el.className = "hide"; return; }
  var h = Net.health();
  el.className = h.state;
  $("netChipTx").textContent = h.words + (Net.code ? " · " + Net.code : "");
}

function showInvite(code) {
  if (!code) { $("partyBody").innerHTML = "<p class='lead'>The table is full.</p>"; return; }
  var url = Net.url(code);
  $("partyBody").innerHTML =
    "<p class='lead'>Hold this up. They point a camera at it — no app, no account, nothing to type.</p>" +
    "<canvas id='qr'></canvas>" +
    "<div id='lobby'></div>" +
    "<div class='row'><button class='btn' id='pShare'>Send the link</button>" +
    "<button class='btn' id='pReply'>They have a code for me</button></div>" +
    "<p class='note'>Everyone who is not here yet is played by the house, so you can start now and let them join as they arrive.</p>";
  Net.drawQR($("qr"), url, "#1c1208", "#ffffff");
  renderLobby();
  press($("pShare"), function () {
    if (navigator.share) navigator.share({ title: "Sit down at my domino table", url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast("Link copied."); }, function () {});
  });
  press($("pReply"), function () {
    $("lobby").innerHTML = "<div class='fld'><label><b>Paste what their phone shows</b></label>" +
      "<input type='text' id='replyIn' placeholder='DTAB…'></div>";
    var inp = $("replyIn");
    inp.focus();
    inp.addEventListener("input", function () {
      Net.acceptReply(inp.value).then(function (ok) {
        if (ok) { inp.value = ""; toast("Linking…"); Net.mintInvite().then(showInvite); }
      });
    });
  });
}
function renderLobby() {
  var el = $("lobby");
  if (!el) return;
  var html = "<p class='note'>At the table: ";
  for (var i = 0; i < Net.roster.length; i++) {
    var r = Net.roster[i];
    html += "<b>" + esc(r.name || "the house") + "</b>" + (i < 3 ? " · " : "");
  }
  html += "</p>";
  el.innerHTML = html;
}

/* One door, two kinds of key. Four letters is the way in; a whole
   pasted handshake still works and always will, because it is what is
   left when there is no mailbox to mint four letters from. */
function joinTable(prefill) {
  guestHandlers();
  if (prefill && !Room.isCode(prefill)) { joinByPaste(prefill); return; }
  joinByRoom();
  if (prefill) {
    var box = $("jRoom");
    if (box) box.value = Room.tidy(prefill);
    joinByCode(prefill);
  }
}
function joinByPaste(prefill) {
  guestHandlers();
  $("partyBody").innerHTML =
    "<p class='lead'>Point your camera at the code on their phone, or paste it here.</p>" +
    "<div class='fld'><label><b>Your name</b></label><input type='text' id='jName' maxlength='14' value='" + esc(P.name) + "'></div>" +
    "<div class='fld'><label><b>Their code</b></label><input type='text' id='jCode' placeholder='DTAB…' value='" + esc(prefill || "") + "'></div>" +
    "<div id='jOut'></div>";
  var go = function () {
    var code = $("jCode").value;
    if (!code || code.length < 20) return;
    P.name = Net.cleanName($("jName").value); save();
    Net.join(code, P.name).then(function (res) {
      if (!res) { $("jOut").innerHTML = "<p class='note warn'>That code didn't work. Ask for a fresh one — nothing is broken.</p>"; return; }
      $("jOut").innerHTML = "<p class='lead'>Now show <b>them</b> this. One more code and you're in.</p>" +
        "<canvas id='qr'></canvas><div class='code mono'>" + esc(res.reply) + "</div>";
      Net.drawQR($("qr"), res.reply, "#1c1208", "#ffffff");
      if (navigator.clipboard) navigator.clipboard.writeText(res.reply).catch(function () {});
    });
  };
  $("jCode").addEventListener("input", go);
  if (prefill) go();
}

/* Everything a chair needs to know, wherever it came in from. Split out
   of joinTable so the four-letter door and the paste door install exactly
   the same handlers — a difference between them would be a bug nobody
   would find until somebody's phone locked. */
function guestHandlers() {
  G.mode = "guest";
  Net.onLink = function (seat) {
    G.mySeat = seat;
    stopRoomList();
    shut("ovParty");
    banner("You're in", "Seat " + (seat + 1), 1400);
    Room.remember({ role: "guest", code: Net.code, name: P.name, seat: seat });
    syncNetChip();
  };
  /* the link came back by itself: no banner, no fuss — the host re-deals
     this chair's view within the beat and the hand carries on */
  Net.onRejoin = function () {
    toast("Back at the table.");
    syncNetChip();
  };
  Net.onHealth = function (state) {
    syncNetChip();
    if (state === "healing") toast("Lost the table for a moment — finding it again…");
  };
  Net.onRoster = function (roster) {
    for (var i = 0; i < roster.length; i++) {
      G.names[roster[i].seat] = roster[i].name || ("Seat " + (roster[i].seat + 1));
    }
    syncAll();
  };
  /* only reached when there is nothing to be done automatically: a
     paste/QR chair has no four letters to knock on again */
  Net.onDrop = function () {
    banner("The table closed", "Reload to start again", 4000);
    G.mode = "solo";
    syncNetChip();
  };
  Net.onMessage = function (msg) {
    if (msg.k === "view") {
      var wasLine = G.view ? G.view.line.length : 0;
      G.view = msg.view;
      if (msg.last !== undefined && msg.view.line.length > wasLine) {
        G.lastIdx = msg.view.line.length - 1;
        var pl = msg.view.line[G.lastIdx];
        if (pl) startAnim(G.lastIdx, pl.seat);
      }
      G.busy = false;
      syncAll();
    } else if (msg.k === "end") {
      if (!G.match) G.match = { scores: msg.scores, history: [], rules: R.houseRules(P.rules), over: msg.over, handNo: 0 };
      G.match.scores = msg.scores;
      G.match.over = msg.over;
      showEnd(msg.res, G.match);
    }
  };
}

/* ---------- the splash ---------- */
press($("goSolo"), function () { begin("solo"); });
press($("goParty"), function () { begin("solo"); showParty(); });
press($("goLearn"), function () { showLessons(); });
press($("goLook"), function () { begin("solo"); showLook(); });

function begin(mode) {
  $("splash").classList.add("gone");
  setTimeout(function () { $("splash").style.display = "none"; }, 520);
  G.mode = mode;
  G.mySeat = 0;
  G.names = { 0: P.name || "You", 1: BOT_NAMES[0], 2: BOT_NAMES[1], 3: BOT_NAMES[2] };
  resize();
  if (!G.match) newMatch(); else syncAll();
}

/* a few bones tumbling on the splash, drawn with the real painter */
(function splashArt() {
  var cv = $("splashCv");
  if (!cv) return;
  var tmp = new window.Gfx2D(cv);
  tmp.skin = Sk.clean(Sk.PRESETS[0]);
  tmp.dpr = 1; tmp.w = cv.width; tmp.h = cv.height;
  var g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  var set = [[6, 6, 96, 110, -8], [6, 3, 208, 96, 5], [3, 5, 320, 112, -3], [5, 5, 430, 100, 9]];
  for (var i = 0; i < set.length; i++) {
    var s = set[i];
    tmp.bone(s[2], s[3], s[0] === s[1] ? 62 : 118, s[0] === s[1] ? 118 : 62, s[4], s[0], s[1], { lift: 0.7 });
  }
})();

/* ---------- boot ---------- */
load();
makeRenderers();

/* a link can arrive carrying a table to wear or a chair to sit in */
(function fromLink() {
  var h = location.hash || "";
  var mt = h.match(/table=([A-Za-z0-9_.\-]+)/);
  if (mt) {
    var got = Sk.decode(mt[1]);
    if (got) { P.skin = got; save(); gfx.setSkin(P.skin); over.setSkin(P.skin); }
  }
  var mj = h.match(/join=([A-Za-z0-9_.\-]+)/);
  if (mj) {
    begin("solo");
    showParty();
    setTimeout(function () { joinTable(mj[1]); }, 60);
  }
})();

window.addEventListener("keydown", function (e) {
  if (e.key === "h") $("btnHint").click();
  if (e.key === "c") showCount();
});

/* ---------- offline, and quietly announced updates ----------
   A new version waits rather than swapping itself in: a match runs
   twenty minutes and reloading mid-hand would lose it. */
if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      reg.addEventListener("updatefound", function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", function () {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            toast("A new version is ready — it'll load next time.");
          }
        });
      });
    }).catch(function () { /* offline play is a bonus, never a requirement */ });
  });
}

/* the room's own handles, for the smoke tests and for anyone curious */
window.__dt = function () {
  /* `tryPlay` and `doPass` are here for `tools/room-check.js`, which
     needs to keep a hand moving while it times the machines' beats —
     it is the player's turn a quarter of the time and the room is quite
     right to sit and wait, but a stalled window measures nothing. */
  return { G: G, P: P, gfx: gfx, scene: scene, Net: Net, tryPlay: tryPlay, doPass: doPass,
           Room: Room, joinByCode: joinByCode, health: Net.health() };
};
})();
