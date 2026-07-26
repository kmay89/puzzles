/* teach.js — the part of the room that notices things.

   A good teacher doesn't lecture; they catch the moment. This module
   looks at a position (or at a move just played) and reports, in plain
   words, what is actually going on: a knight attacking two things at
   once, a bishop freezing a piece in front of a king, a rook left
   hanging, a back rank with no air. Everything here is *named*, because
   naming is what turns "a thing that happened" into a pattern you can
   recognise again — the single most useful thing a beginner can gain.

   Two customers:
     - the live game, which whispers a teachable moment when one appears
       (and goes quiet once you've shown you know it — see learn.js),
     - the Academy lessons, which use the same eyes to explain *why*
       your answer worked, or what your wrong answer allowed.

   Pure functions over an engine.js game; no DOM, no state. Tested by
   chess/tools/teach-check.js against hand-built positions. */
(function (root) {
"use strict";

var Chess = (typeof module !== "undefined" && module.exports)
  ? require("./engine.js") : root.Chess;

var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
var VAL = [0, 100, 320, 330, 500, 900, 20000];
var NAMES = ["", "pawn", "knight", "bishop", "rook", "queen", "king"];
var N_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
var K_OFF = [17, 16, 15, 1, -17, -16, -15, -1];
var B_OFF = [17, 15, -17, -15];
var R_OFF = [16, 1, -16, -1];

function on(sq) { return (sq & 0x88) === 0; }
function kindOf(p) { return p < 0 ? -p : p; }
function colorOf(p) { return p > 0 ? 1 : -1; }
function name(p) { return NAMES[kindOf(p)]; }
function sqName(sq) { return Chess.sqName(sq); }
function rankOf(sq) { return sq >> 4; }
function fileOf(sq) { return sq & 7; }

/* ---------- raw attacks (ignores pins; "what does this piece hit") ---------- */
function attacksFrom(g, sq) {
  var b = g.board, p = b[sq];
  if (!p) return [];
  var kind = kindOf(p), color = colorOf(p), out = [], i, t, dirs;
  if (kind === P) {
    var f = 16 * color;
    if (on(sq + f - 1)) out.push(sq + f - 1);
    if (on(sq + f + 1)) out.push(sq + f + 1);
    return out;
  }
  if (kind === N || kind === K) {
    dirs = kind === N ? N_OFF : K_OFF;
    for (i = 0; i < 8; i++) { t = sq + dirs[i]; if (on(t)) out.push(t); }
    return out;
  }
  dirs = kind === B ? B_OFF : kind === R ? R_OFF : K_OFF;   /* queen = all 8 */
  for (i = 0; i < dirs.length; i++) {
    for (t = sq + dirs[i]; on(t); t += dirs[i]) {
      out.push(t);
      if (b[t]) break;             /* the blocker is attacked, nothing past it */
    }
  }
  return out;
}

/* squares holding `color` pieces that attack `sq` */
function attackersOf(g, sq, color) {
  var out = [], s, p;
  for (s = 0; s < 128; s++) {
    if (!on(s)) continue;
    p = g.board[s];
    if (!p || colorOf(p) !== color) continue;
    var hits = attacksFrom(g, s);
    for (var i = 0; i < hits.length; i++) {
      if (hits[i] === sq) { out.push(s); break; }
    }
  }
  return out;
}

function cheapest(g, squares) {
  var best = Infinity;
  for (var i = 0; i < squares.length; i++) {
    var v = VAL[kindOf(g.board[squares[i]])];
    if (v < best) best = v;
  }
  return best;
}

/* A piece is "loose" when taking it wins material outright: undefended,
   or defended but attacked by something cheaper. This is the beginner's
   single most expensive blind spot, so it gets first-class treatment. */
function isLoose(g, sq) {
  var p = g.board[sq];
  if (!p || kindOf(p) === K) return false;
  var color = colorOf(p);
  var atk = attackersOf(g, sq, -color);
  if (!atk.length) return false;
  var def = attackersOf(g, sq, color);
  if (!def.length) return true;
  return cheapest(g, atk) < VAL[kindOf(p)];
}

function looseFor(g, side) {          /* `side`'s pieces that are hanging */
  var out = [], sq;
  for (sq = 0; sq < 128; sq++) {
    if (!on(sq)) continue;
    var p = g.board[sq];
    if (!p || colorOf(p) !== side) continue;
    if (isLoose(g, sq)) out.push({ sq: sq, piece: p, value: VAL[kindOf(p)] });
  }
  out.sort(function (a, b) { return b.value - a.value; });
  return out;
}

/* ---------- forks: one piece, two victims ---------- */
function forks(g, side) {
  var out = [], sq;
  for (sq = 0; sq < 128; sq++) {
    if (!on(sq)) continue;
    var p = g.board[sq];
    if (!p || colorOf(p) !== side) continue;
    var mine = VAL[kindOf(p)], hits = attacksFrom(g, sq), victims = [];
    for (var i = 0; i < hits.length; i++) {
      var t = hits[i], q = g.board[t];
      if (!q || colorOf(q) === side) continue;
      var worth = VAL[kindOf(q)];
      /* worth winning: the king (it's check), something dearer than the
         forker, or something nobody is defending */
      if (kindOf(q) === K || worth > mine || !attackersOf(g, t, -side).length) {
        victims.push({ sq: t, piece: q, value: worth });
      }
    }
    if (victims.length >= 2) {
      victims.sort(function (a, b) { return b.value - a.value; });
      out.push({
        kind: "fork", concept: "fork", by: sq, piece: p,
        victims: victims,
        /* a fork that simply hangs the forker isn't one to celebrate */
        safe: !isLoose(g, sq),
        check: victims.some(function (v) { return kindOf(v.piece) === K; })
      });
    }
  }
  return out;
}

/* ---------- pins & skewers: two pieces on one line ---------- */
function lines(g, side) {
  var pins = [], skewers = [], sq;
  for (sq = 0; sq < 128; sq++) {
    if (!on(sq)) continue;
    var p = g.board[sq];
    if (!p || colorOf(p) !== side) continue;
    var kind = kindOf(p);
    if (kind !== B && kind !== R && kind !== Q) continue;
    var dirs = kind === B ? B_OFF : kind === R ? R_OFF : K_OFF;
    for (var d = 0; d < dirs.length; d++) {
      var step = dirs[d], t, front = -1, back = -1;
      for (t = sq + step; on(t); t += step) {
        if (g.board[t]) { front = t; break; }
      }
      if (front < 0 || colorOf(g.board[front]) === side) continue;
      for (t = front + step; on(t); t += step) {
        if (g.board[t]) { back = t; break; }
      }
      if (back < 0 || colorOf(g.board[back]) === side) continue;
      var fk = kindOf(g.board[front]), bk = kindOf(g.board[back]);
      var rec = { by: sq, piece: p, front: front, frontPiece: g.board[front],
                  back: back, backPiece: g.board[back] };
      if (fk === K) {
        /* the king is in front: it must step aside and the piece behind falls */
        rec.kind = "skewer"; rec.concept = "skewer"; rec.absolute = false;
        skewers.push(rec);
      } else if (bk === K) {
        rec.kind = "pin"; rec.concept = "pin"; rec.absolute = true;  /* illegal to move */
        pins.push(rec);
      } else if (VAL[bk] > VAL[fk]) {
        rec.kind = "pin"; rec.concept = "pin"; rec.absolute = false;
        pins.push(rec);
      } else if (VAL[fk] > VAL[bk]) {
        rec.kind = "skewer"; rec.concept = "skewer";
        skewers.push(rec);
      }
    }
  }
  return { pins: pins, skewers: skewers };
}

/* ---------- back rank: a king with no air ---------- */
function backRank(g, side) {
  var kingSq = g.kings[side === 1 ? 0 : 1];
  var home = side === 1 ? 0 : 7;
  if (rankOf(kingSq) !== home) return null;
  var fwd = 16 * side, blocked = 0, checked = 0;
  for (var d = -1; d <= 1; d++) {
    var t = kingSq + fwd + d;
    if (!on(t)) continue;
    checked++;
    var q = g.board[t];
    if (q && colorOf(q) === side) blocked++;
  }
  if (!checked || blocked < checked) return null;
  /* only a danger if the enemy owns a rook or queen to land there */
  var heavy = false;
  for (var sq = 0; sq < 128; sq++) {
    if (!on(sq)) continue;
    var p = g.board[sq];
    if (p && colorOf(p) === -side && (kindOf(p) === R || kindOf(p) === Q)) { heavy = true; break; }
  }
  if (!heavy) return null;
  return { kind: "backRank", concept: "backRank", side: side, king: kingSq };
}

/* ---------- mate in one, for the side to move ---------- */
function mateInOne(g) {
  var ms = Chess.moves(g), i;
  for (i = 0; i < ms.length; i++) {
    Chess.make(g, ms[i]);
    var mated = Chess.inCheck(g) && Chess.moves(g).length === 0;
    Chess.unmake(g);
    if (mated) return ms[i];
  }
  return null;
}

/* ---------- everything at once ---------- */
function scan(g, side) {
  var L = lines(g, side);
  return {
    forks: forks(g, side),
    pins: L.pins,
    skewers: L.skewers,
    loose: looseFor(g, -side),              /* enemy pieces `side` can win */
    ownLoose: looseFor(g, side),            /* `side`'s own pieces in danger */
    backRank: backRank(g, -side)            /* enemy king short of air */
  };
}

/* a stable identity so we can tell a *new* tactic from one already there */
function sig(t) {
  if (t.kind === "fork") {
    return "fork:" + t.by + ":" + t.victims.map(function (v) { return v.sq; }).sort().join(",");
  }
  if (t.kind === "pin" || t.kind === "skewer") {
    return t.kind + ":" + t.by + ":" + t.front + ":" + t.back;
  }
  return t.kind + ":" + (t.king != null ? t.king : "");
}
function sigSet(list) {
  var s = {};
  for (var i = 0; i < list.length; i++) s[sig(list[i])] = true;
  return s;
}

/* ---------- what did this move just do? ----------
   `g` is the position BEFORE the move. Returns plain-language
   observations, each tagged with the concept it teaches so the app can
   fade the ones you've already mastered. */
function afterMove(g, m) {
  var side = colorOf(m.piece), out = [];
  var before = scan(g, side);
  var beforeForks = sigSet(before.forks), beforePins = sigSet(before.pins),
      beforeSkewers = sigSet(before.skewers);
  var wasLoose = {}, i;
  for (i = 0; i < before.ownLoose.length; i++) wasLoose[before.ownLoose[i].sq] = true;

  Chess.make(g, m);
  var after = scan(g, side);
  var gaveCheck = Chess.inCheck(g, -side);
  var theirMoves = Chess.moves(g).length;
  var mated = gaveCheck && theirMoves === 0;
  var stale = !gaveCheck && theirMoves === 0;
  /* what can they hit back with? (used for the "you left this hanging" note) */
  var myLoose = after.ownLoose;
  Chess.unmake(g);

  var moverName = name(m.piece), toSq = sqName(m.to);

  if (mated) {
    out.push({ concept: "checkmate", weight: 100,
      text: "Checkmate — the king is attacked and there is no move that saves it. That's the whole game: not capturing the king, but leaving it nowhere to go." });
    return out;
  }
  if (stale) {
    out.push({ concept: "stalemate", weight: 100,
      text: "Stalemate: they aren't in check, but they have no legal move at all — so it's a <b>draw</b>. When you're far ahead, always give the losing king a square to breathe." });
    return out;
  }

  /* new forks by the piece that just moved (the classic aha) */
  for (i = 0; i < after.forks.length; i++) {
    var f = after.forks[i];
    if (beforeForks[sig(f)]) continue;
    var vs = f.victims.slice(0, 2).map(function (v) {
      return "the " + name(v.piece) + " on " + sqName(v.sq);
    });
    out.push({
      concept: "fork", weight: f.check ? 92 : 88, squares: [f.by].concat(f.victims.map(function (v) { return v.sq; })),
      text: "That's a <b>fork</b> — your " + name(f.piece) + " on " + sqName(f.by) +
        " attacks " + vs.join(" and ") + " at the same time. " +
        (f.check ? "One of them is the king, so they must answer the check — and then the other one falls."
                 : "They only get one move: whichever they save, you take the other.") +
        (f.safe ? "" : " (Careful though — your " + name(f.piece) + " can be taken there.)")
    });
    break;
  }

  /* new pins */
  for (i = 0; i < after.pins.length; i++) {
    var pn = after.pins[i];
    if (beforePins[sig(pn)]) continue;
    out.push({
      concept: "pin", weight: 84, squares: [pn.by, pn.front, pn.back],
      text: "That's a <b>pin</b>: your " + name(pn.piece) + " on " + sqName(pn.by) +
        " lines up on their " + name(pn.frontPiece) + " (" + sqName(pn.front) + ") with " +
        (pn.absolute ? "their <b>king</b>" : "their " + name(pn.backPiece)) + " behind it. " +
        (pn.absolute ? "Moving that piece would expose the king, so it is <b>not allowed to move at all</b> — it's frozen, and you can pile more attackers onto it."
                     : "If it moves, you win the bigger piece behind it.")
    });
    break;
  }

  /* new skewers */
  for (i = 0; i < after.skewers.length; i++) {
    var sk = after.skewers[i];
    if (beforeSkewers[sig(sk)]) continue;
    out.push({
      concept: "skewer", weight: 82, squares: [sk.by, sk.front, sk.back],
      text: "That's a <b>skewer</b> — a pin turned around. The valuable piece is in <i>front</i>: their " +
        name(sk.frontPiece) + " on " + sqName(sk.front) + " has to move out of the way, and your " +
        name(sk.piece) + " takes the " + name(sk.backPiece) + " behind it."
    });
    break;
  }

  /* the move hung something (only worth saying if it wasn't already hanging) */
  for (i = 0; i < myLoose.length; i++) {
    if (wasLoose[myLoose[i].sq]) continue;
    if (myLoose[i].value < 300) continue;      /* pawns: don't nag */
    out.push({
      concept: "hanging", weight: 95, squares: [myLoose[i].sq],
      text: "Careful — that leaves your " + name(myLoose[i].piece) + " on " + sqName(myLoose[i].sq) +
        " where it can be taken for free. Before every move, it's worth one glance: <i>is anything of mine undefended?</i>"
    });
    break;
  }

  /* structural praise, in plain terms */
  if (m.flags & Chess.F_CASTLE) {
    out.push({ concept: "castling", weight: 70,
      text: "Castled — two good deeds in one move: the king steps into the corner behind a wall of pawns, and the rook comes off the edge toward the middle. Games are won and lost on this." });
  } else if (m.promo) {
    out.push({ concept: "promotion", weight: 90,
      text: "Promotion! A pawn that walks the whole board becomes a queen. This is why endgame pawns are precious — every one is a queen in waiting." });
  } else if (gaveCheck) {
    out.push({ concept: "check", weight: 60,
      text: "Check — they must deal with it right now: move the king, block the line, or capture the attacker. Nothing else is legal." });
  }

  if (kindOf(m.piece) === P && (m.to & 7) >= 2 && (m.to & 7) <= 5 &&
      (rankOf(m.to) === 3 || rankOf(m.to) === 4)) {
    out.push({ concept: "centre", weight: 40,
      text: "A pawn in the centre. Centre pawns take squares away from their pieces and give yours roads to travel — it's the quiet reason opening books all start here." });
  }
  if ((kindOf(m.piece) === N || kindOf(m.piece) === B) &&
      (rankOf(m.from) === 0 || rankOf(m.from) === 7)) {
    out.push({ concept: "development", weight: 38,
      text: "Development: a piece off the back row and into the game. A knight on the rim sees 4 squares; in the middle it sees 8 — the same piece, twice the power." });
  }

  out.sort(function (a, b) { return b.weight - a.weight; });
  return out;
}

/* ---------- opportunities the player could still take ----------
   Used by the Academy's "look again" nudges and the hint copy. */
function opportunities(g, side) {
  var s = scan(g, side), out = [];
  var mate = mateInOne(g);
  if (mate && g.turn === side) {
    out.push({ concept: "checkmate", weight: 100,
      text: "There is a <b>checkmate in one</b> here. Look for checks first: which check leaves them no square, no block, and no capture?" });
  }
  if (s.loose.length && s.loose[0].value >= 300) {
    out.push({ concept: "hanging", weight: 80, squares: [s.loose[0].sq],
      text: "Their " + name(s.loose[0].piece) + " on " + sqName(s.loose[0].sq) + " is undefended. Free material is the cheapest way to win a game — always scan for it before anything clever." });
  }
  for (var i = 0; i < s.forks.length; i++) {
    if (!s.forks[i].safe) continue;
    out.push({ concept: "fork", weight: 70, squares: [s.forks[i].by],
      text: "Your " + name(s.forks[i].piece) + " on " + sqName(s.forks[i].by) + " already hits two things at once." });
    break;
  }
  if (s.backRank) {
    out.push({ concept: "backRank", weight: 65, squares: [s.backRank.king],
      text: "Their king sits on the back rank with its own pawns sealing every escape square. A rook or queen arriving there is mate — this is the most common way club games end." });
  }
  out.sort(function (a, b) { return b.weight - a.weight; });
  return out;
}

/* Is `side`'s own house in order? Used for gentle pre-move nudges. */
function warnings(g, side) {
  var s = scan(g, side), out = [];
  if (s.ownLoose.length && s.ownLoose[0].value >= 300) {
    out.push({ concept: "hanging", weight: 90, squares: [s.ownLoose[0].sq],
      text: "Your " + name(s.ownLoose[0].piece) + " on " + sqName(s.ownLoose[0].sq) + " is hanging right now." });
  }
  var br = backRank(g, side);
  if (br) out.push({ concept: "backRank", weight: 60, squares: [br.king],
    text: "Your own back rank has no air — worth making a square for the king before it matters." });
  return out;
}

var Teach = {
  attacksFrom: attacksFrom, attackersOf: attackersOf,
  isLoose: isLoose, looseFor: looseFor,
  forks: forks, lines: lines, backRank: backRank, mateInOne: mateInOne,
  scan: scan, afterMove: afterMove, opportunities: opportunities, warnings: warnings,
  pieceName: name, VAL: VAL
};
if (typeof module !== "undefined" && module.exports) module.exports = Teach;
else root.Teach = Teach;
})(typeof self !== "undefined" ? self : this);
