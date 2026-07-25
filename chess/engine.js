/* engine.js — the rules of chess, complete and honest.
   0x88 board, full legal move generation (castling, en passant,
   underpromotion), check / checkmate / stalemate, every draw rule
   (fifty moves, threefold repetition, insufficient material), FEN,
   SAN, and a small alpha-beta search used for hints, the gentle
   coach, and the practice opponent. No libraries.

   Validated by chess/tools/perft.js against the published perft
   node counts — run `node chess/tools/perft.js` before trusting a
   change to anything in the MOVES or MAKE sections. */
(function (root) {
"use strict";

/* ---------- board geometry (0x88) ----------
   Square index = rank*16 + file; a1 = 0, h1 = 7, a8 = 112, h8 = 119.
   An index & 0x88 !== 0 means "fell off the board" — the whole reason
   this layout exists. */
var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;             // piece kinds; sign is the colour
var WHITE = 1, BLACK = -1;
var KIND_CH = ["", "p", "n", "b", "r", "q", "k"];

var N_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
var K_OFF = [17, 16, 15, 1, -17, -16, -15, -1];
var B_OFF = [17, 15, -17, -15];
var R_OFF = [16, 1, -16, -1];

/* castling-rights bits */
var CWK = 1, CWQ = 2, CBK = 4, CBQ = 8;

/* move flags */
var F_DOUBLE = 1, F_EP = 2, F_CASTLE = 4;

function fileOf(sq) { return sq & 7; }
function rankOf(sq) { return sq >> 4; }
function onBoard(sq) { return (sq & 0x88) === 0; }
function sqName(sq) { return "abcdefgh"[fileOf(sq)] + (rankOf(sq) + 1); }
function sqIndex(name) {
  if (!name || name.length < 2) return -1;
  var f = name.charCodeAt(0) - 97, r = name.charCodeAt(1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
  return r * 16 + f;
}
/* 0x88 → 0..63 (rank-major from a1) used by the eval tables */
function sq64(sq) { return rankOf(sq) * 8 + fileOf(sq); }

var START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/* ---------- game object ---------- */
function create(fen) {
  var g = {
    board: new Int8Array(128),
    turn: WHITE,
    castling: 0,
    ep: -1,                 // en-passant target square, or -1
    half: 0,                // halfmove clock (fifty-move rule)
    full: 1,
    kings: [0, 0],          // [white king sq, black king sq]
    hist: [],               // undo records for make/unmake
    played: [],             // the human-facing game record: {move, san, key}
    startKey: ""            // repetition key of the initial position
  };
  loadFEN(g, fen || START_FEN);
  return g;
}

function loadFEN(g, fen) {
  var parts = fen.trim().split(/\s+/);
  g.board.fill(0);
  var rows = parts[0].split("/");
  if (rows.length !== 8) throw new Error("bad FEN board");
  for (var r = 0; r < 8; r++) {
    var rank = 7 - r, f = 0, row = rows[r];
    for (var i = 0; i < row.length; i++) {
      var c = row[i];
      if (c >= "1" && c <= "8") { f += +c; continue; }
      var kind = KIND_CH.indexOf(c.toLowerCase());
      if (kind < 1 || f > 7) throw new Error("bad FEN piece");
      var col = (c === c.toUpperCase()) ? WHITE : BLACK;
      var sq = rank * 16 + f;
      g.board[sq] = kind * col;
      if (kind === K) g.kings[col === WHITE ? 0 : 1] = sq;
      f++;
    }
  }
  g.turn = (parts[1] === "b") ? BLACK : WHITE;
  g.castling = 0;
  var cr = parts[2] || "-";
  if (cr.indexOf("K") >= 0) g.castling |= CWK;
  if (cr.indexOf("Q") >= 0) g.castling |= CWQ;
  if (cr.indexOf("k") >= 0) g.castling |= CBK;
  if (cr.indexOf("q") >= 0) g.castling |= CBQ;
  g.ep = (parts[3] && parts[3] !== "-") ? sqIndex(parts[3]) : -1;
  g.half = parts[4] ? (+parts[4] | 0) : 0;
  g.full = parts[5] ? (+parts[5] | 0) : 1;
  g.hist.length = 0;
  g.played.length = 0;
  g.startKey = key(g);
}

function fen(g) {
  var out = "";
  for (var rank = 7; rank >= 0; rank--) {
    var empty = 0;
    for (var f = 0; f < 8; f++) {
      var p = g.board[rank * 16 + f];
      if (!p) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      var ch = KIND_CH[Math.abs(p)];
      out += p > 0 ? ch.toUpperCase() : ch;
    }
    if (empty) out += empty;
    if (rank) out += "/";
  }
  var cr = (g.castling & CWK ? "K" : "") + (g.castling & CWQ ? "Q" : "") +
           (g.castling & CBK ? "k" : "") + (g.castling & CBQ ? "q" : "");
  return out + " " + (g.turn === WHITE ? "w" : "b") + " " + (cr || "-") + " " +
         (g.ep >= 0 ? sqName(g.ep) : "-") + " " + g.half + " " + g.full;
}

/* Repetition key: board + turn + castling + en passant, but the ep square
   only counts when an en-passant capture is actually legal — that's the
   FIDE definition of "same position". */
function key(g) {
  var k = fen(g).split(" ");
  var ep = "-";
  if (g.ep >= 0) {
    var ms = movesFor(g, g.turn), i;
    for (i = 0; i < ms.length; i++) {
      if (!(ms[i].flags & F_EP)) continue;
      make(g, ms[i]);
      var ok = !inCheck(g, -g.turn);
      unmake(g);
      if (ok) { ep = sqName(g.ep); break; }
    }
  }
  return k[0] + " " + k[1] + " " + k[2] + " " + ep;
}

/* ---------- attack detection ---------- */
function attacked(g, sq, by) {
  var b = g.board, i, t, p;
  /* pawns (a white pawn on s attacks s+15 and s+17) */
  if (by === WHITE) {
    if (onBoard(sq - 15) && b[sq - 15] === P) return true;
    if (onBoard(sq - 17) && b[sq - 17] === P) return true;
  } else {
    if (onBoard(sq + 15) && b[sq + 15] === -P) return true;
    if (onBoard(sq + 17) && b[sq + 17] === -P) return true;
  }
  for (i = 0; i < 8; i++) {
    t = sq + N_OFF[i];
    if (onBoard(t) && b[t] === N * by) return true;
    t = sq + K_OFF[i];
    if (onBoard(t) && b[t] === K * by) return true;
  }
  for (i = 0; i < 4; i++) {
    for (t = sq + B_OFF[i]; onBoard(t); t += B_OFF[i]) {
      p = b[t];
      if (p) { if ((p === B * by || p === Q * by)) return true; break; }
    }
    for (t = sq + R_OFF[i]; onBoard(t); t += R_OFF[i]) {
      p = b[t];
      if (p) { if ((p === R * by || p === Q * by)) return true; break; }
    }
  }
  return false;
}

function inCheck(g, color) {
  var c = color || g.turn;
  return attacked(g, g.kings[c === WHITE ? 0 : 1], -c);
}

/* ---------- move generation ---------- */
function mv(from, to, piece, capt, promo, flags) {
  return { from: from, to: to, piece: piece, capt: capt | 0, promo: promo | 0, flags: flags | 0 };
}

/* pseudo-legal moves for `color`; legality (own king safety) is filtered
   in moves() by make/unmake */
function movesFor(g, color, capturesOnly) {
  var b = g.board, out = [], sq, p, i, t, kind;
  for (sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) continue;
    p = b[sq];
    if (!p || (p > 0 ? WHITE : BLACK) !== color) continue;
    kind = Math.abs(p);

    if (kind === P) {
      var fwd = 16 * color, startRank = color === WHITE ? 1 : 6, lastRank = color === WHITE ? 7 : 0;
      t = sq + fwd;
      if (!capturesOnly && onBoard(t) && !b[t]) {
        if (rankOf(t) === lastRank) pushPromos(out, sq, t, p, 0, 0);
        else {
          out.push(mv(sq, t, p, 0, 0, 0));
          var t2 = sq + fwd * 2;
          if (rankOf(sq) === startRank && !b[t2]) out.push(mv(sq, t2, p, 0, 0, F_DOUBLE));
        }
      }
      for (i = -1; i <= 1; i += 2) {
        t = sq + fwd + i;
        if (!onBoard(t)) continue;
        var tp = b[t];
        if (tp && (tp > 0 ? WHITE : BLACK) === -color) {
          if (rankOf(t) === lastRank) pushPromos(out, sq, t, p, tp, 0);
          else out.push(mv(sq, t, p, tp, 0, 0));
        } else if (t === g.ep) {
          out.push(mv(sq, t, p, -P * color, 0, F_EP));
        }
      }
    } else if (kind === N || kind === K) {
      var offs = kind === N ? N_OFF : K_OFF;
      for (i = 0; i < 8; i++) {
        t = sq + offs[i];
        if (!onBoard(t)) continue;
        var q = b[t];
        if (!q) { if (!capturesOnly) out.push(mv(sq, t, p, 0, 0, 0)); }
        else if ((q > 0 ? WHITE : BLACK) === -color) out.push(mv(sq, t, p, q, 0, 0));
      }
      if (kind === K && !capturesOnly) genCastles(g, color, sq, out);
    } else {
      var dirs = kind === B ? B_OFF : kind === R ? R_OFF : K_OFF; /* queen = all 8 */
      for (i = 0; i < dirs.length; i++) {
        for (t = sq + dirs[i]; onBoard(t); t += dirs[i]) {
          var q2 = b[t];
          if (!q2) { if (!capturesOnly) out.push(mv(sq, t, p, 0, 0, 0)); continue; }
          if ((q2 > 0 ? WHITE : BLACK) === -color) out.push(mv(sq, t, p, q2, 0, 0));
          break;
        }
      }
    }
  }
  return out;
}

function pushPromos(out, from, to, piece, capt, flags) {
  var color = piece > 0 ? 1 : -1;
  out.push(mv(from, to, piece, capt, Q * color, flags));
  out.push(mv(from, to, piece, capt, N * color, flags));
  out.push(mv(from, to, piece, capt, R * color, flags));
  out.push(mv(from, to, piece, capt, B * color, flags));
}

function genCastles(g, color, kingSq, out) {
  var b = g.board;
  if (color === WHITE ? kingSq !== 4 : kingSq !== 116) return;
  var kBit = color === WHITE ? CWK : CBK, qBit = color === WHITE ? CWQ : CBQ;
  if ((g.castling & (kBit | qBit)) === 0) return;
  if (attacked(g, kingSq, -color)) return;
  if (g.castling & kBit) {
    if (!b[kingSq + 1] && !b[kingSq + 2] && b[kingSq + 3] === R * color &&
        !attacked(g, kingSq + 1, -color) && !attacked(g, kingSq + 2, -color))
      out.push(mv(kingSq, kingSq + 2, K * color, 0, 0, F_CASTLE));
  }
  if (g.castling & qBit) {
    if (!b[kingSq - 1] && !b[kingSq - 2] && !b[kingSq - 3] && b[kingSq - 4] === R * color &&
        !attacked(g, kingSq - 1, -color) && !attacked(g, kingSq - 2, -color))
      out.push(mv(kingSq, kingSq - 2, K * color, 0, 0, F_CASTLE));
  }
}

/* fully legal moves for the side to move */
function moves(g, capturesOnly) {
  var pseudo = movesFor(g, g.turn, capturesOnly), out = [], i;
  for (i = 0; i < pseudo.length; i++) {
    make(g, pseudo[i]);
    if (!inCheck(g, -g.turn)) out.push(pseudo[i]);
    unmake(g);
  }
  return out;
}

function movesFrom(g, sq) {
  var all = moves(g), out = [], i;
  for (i = 0; i < all.length; i++) if (all[i].from === sq) out.push(all[i]);
  return out;
}

/* ---------- make / unmake ---------- */
function make(g, m) {
  var b = g.board, color = g.turn;
  g.hist.push({ m: m, castling: g.castling, ep: g.ep, half: g.half });
  b[m.from] = 0;
  b[m.to] = m.promo || m.piece;
  if (m.flags & F_EP) b[m.to - 16 * color] = 0;
  if (m.flags & F_CASTLE) {
    if (m.to > m.from) { b[m.from + 1] = b[m.to + 1]; b[m.to + 1] = 0; }
    else { b[m.from - 1] = b[m.to - 2]; b[m.to - 2] = 0; }
  }
  if (Math.abs(m.piece) === K) g.kings[color === WHITE ? 0 : 1] = m.to;

  /* castling rights fall when the king or a rook moves, or a rook is taken */
  var clr = 0;
  if (m.from === 4 || m.to === 4) clr |= CWK | CWQ;
  if (m.from === 116 || m.to === 116) clr |= CBK | CBQ;
  if (m.from === 0 || m.to === 0) clr |= CWQ;
  if (m.from === 7 || m.to === 7) clr |= CWK;
  if (m.from === 112 || m.to === 112) clr |= CBQ;
  if (m.from === 119 || m.to === 119) clr |= CBK;
  g.castling &= ~clr;

  g.ep = (m.flags & F_DOUBLE) ? m.from + 16 * color : -1;
  g.half = (Math.abs(m.piece) === P || m.capt) ? 0 : g.half + 1;
  if (color === BLACK) g.full++;
  g.turn = -color;
}

function unmake(g) {
  var u = g.hist.pop();
  if (!u) return;
  var m = u.m, b = g.board, color = -g.turn; /* colour that made the move */
  b[m.from] = m.piece;
  b[m.to] = 0;
  if (m.flags & F_EP) b[m.to - 16 * color] = -P * color;
  else if (m.capt) b[m.to] = m.capt;
  if (m.flags & F_CASTLE) {
    if (m.to > m.from) { b[m.to + 1] = b[m.from + 1]; b[m.from + 1] = 0; }
    else { b[m.to - 2] = b[m.from - 1]; b[m.from - 1] = 0; }
  }
  if (Math.abs(m.piece) === K) g.kings[color === WHITE ? 0 : 1] = m.from;
  g.castling = u.castling;
  g.ep = u.ep;
  g.half = u.half;
  if (color === BLACK) g.full--;
  g.turn = color;
}

/* ---------- the played game (record + repetition) ---------- */
function play(g, m) {
  var san = toSAN(g, m);
  make(g, m);
  g.played.push({ m: m, san: san, key: key(g), fen: fen(g) });
  return san;
}

function takeBack(g) {
  if (!g.played.length) return null;
  var rec = g.played.pop();
  unmake(g);
  return rec;
}

function repetitionCount(g) {
  var k = g.played.length ? g.played[g.played.length - 1].key : g.startKey;
  var n = (k === g.startKey) ? 1 : 0, i;
  for (i = 0; i < g.played.length; i++) if (g.played[i].key === k) n++;
  return n;
}

function insufficientMaterial(g) {
  var minors = [], i, p, kind;
  for (i = 0; i < 128; i++) {
    if (!onBoard(i)) continue;
    p = g.board[i];
    if (!p) continue;
    kind = Math.abs(p);
    if (kind === K) continue;
    if (kind === P || kind === R || kind === Q) return false;
    minors.push({ kind: kind, dark: (fileOf(i) + rankOf(i)) % 2 === 0 });
    if (minors.length > 2) return false;
  }
  if (minors.length <= 1) return true;                       /* K vs K, K+minor vs K */
  return minors[0].kind === B && minors[1].kind === B &&      /* same-colour bishops */
         minors[0].dark === minors[1].dark;
}

/* {over, result:'white'|'black'|'draw'|null, reason, canClaim50, canClaim3} */
function status(g) {
  var legal = moves(g).length, check = inCheck(g);
  if (!legal) {
    if (check) return { over: true, result: g.turn === WHITE ? "black" : "white", reason: "checkmate" };
    return { over: true, result: "draw", reason: "stalemate" };
  }
  if (insufficientMaterial(g)) return { over: true, result: "draw", reason: "insufficient" };
  if (g.half >= 150) return { over: true, result: "draw", reason: "75-move rule" };
  var reps = repetitionCount(g);
  if (reps >= 5) return { over: true, result: "draw", reason: "fivefold repetition" };
  return { over: false, result: null, reason: check ? "check" : "",
           canClaim50: g.half >= 100, canClaim3: reps >= 3 };
}

/* ---------- SAN ---------- */
function toSAN(g, m) {
  var kind = Math.abs(m.piece), s;
  if (m.flags & F_CASTLE) s = m.to > m.from ? "O-O" : "O-O-O";
  else {
    s = "";
    if (kind !== P) {
      s += KIND_CH[kind].toUpperCase();
      /* disambiguation among same-kind pieces that can also reach m.to */
      var others = moves(g), needFile = false, needRank = false, clash = false, i, o;
      for (i = 0; i < others.length; i++) {
        o = others[i];
        if (o.to !== m.to || o.from === m.from || o.piece !== m.piece) continue;
        clash = true;
        if (fileOf(o.from) === fileOf(m.from)) needRank = true;
        if (rankOf(o.from) === rankOf(m.from)) needFile = true;
      }
      if (clash && !needFile && !needRank) needFile = true;
      if (needFile) s += "abcdefgh"[fileOf(m.from)];
      if (needRank) s += (rankOf(m.from) + 1);
    } else if (m.capt || (m.flags & F_EP)) {
      s += "abcdefgh"[fileOf(m.from)];
    }
    if (m.capt || (m.flags & F_EP)) s += "x";
    s += sqName(m.to);
    if (m.promo) s += "=" + KIND_CH[Math.abs(m.promo)].toUpperCase();
  }
  make(g, m);
  if (inCheck(g)) s += moves(g).length ? "+" : "#";
  unmake(g);
  return s;
}

function fromSAN(g, san) {
  var clean = String(san).replace(/[+#?!]+$/g, "").replace(/0/g, "O");
  var all = moves(g), i;
  for (i = 0; i < all.length; i++) {
    if (toSAN(g, all[i]).replace(/[+#]+$/g, "") === clean) return all[i];
  }
  return null;
}

/* ---------- evaluation ---------- */
var VAL = [0, 100, 320, 330, 500, 900, 20000];
/* piece-square tables, white's point of view, index 0 = a1 */
var PST_P = [ 0,  0,  0,  0,  0,  0,  0,  0,
              5, 10, 10,-20,-20, 10, 10,  5,
              5, -5,-10,  0,  0,-10, -5,  5,
              0,  0,  0, 20, 20,  0,  0,  0,
              5,  5, 10, 25, 25, 10,  5,  5,
             10, 10, 20, 30, 30, 20, 10, 10,
             50, 50, 50, 50, 50, 50, 50, 50,
              0,  0,  0,  0,  0,  0,  0,  0];
var PST_N = [-50,-40,-30,-30,-30,-30,-40,-50,
             -40,-20,  0,  5,  5,  0,-20,-40,
             -30,  5, 10, 15, 15, 10,  5,-30,
             -30,  0, 15, 20, 20, 15,  0,-30,
             -30,  5, 15, 20, 20, 15,  5,-30,
             -30,  0, 10, 15, 15, 10,  0,-30,
             -40,-20,  0,  0,  0,  0,-20,-40,
             -50,-40,-30,-30,-30,-30,-40,-50];
var PST_B = [-20,-10,-10,-10,-10,-10,-10,-20,
             -10,  5,  0,  0,  0,  0,  5,-10,
             -10, 10, 10, 10, 10, 10, 10,-10,
             -10,  0, 10, 10, 10, 10,  0,-10,
             -10,  5,  5, 10, 10,  5,  5,-10,
             -10,  0,  5, 10, 10,  5,  0,-10,
             -10,  0,  0,  0,  0,  0,  0,-10,
             -20,-10,-10,-10,-10,-10,-10,-20];
var PST_R = [  0,  0,  0,  5,  5,  0,  0,  0,
              -5,  0,  0,  0,  0,  0,  0, -5,
              -5,  0,  0,  0,  0,  0,  0, -5,
              -5,  0,  0,  0,  0,  0,  0, -5,
              -5,  0,  0,  0,  0,  0,  0, -5,
              -5,  0,  0,  0,  0,  0,  0, -5,
               5, 10, 10, 10, 10, 10, 10,  5,
               0,  0,  0,  0,  0,  0,  0,  0];
var PST_Q = [-20,-10,-10, -5, -5,-10,-10,-20,
             -10,  0,  5,  0,  0,  0,  0,-10,
             -10,  5,  5,  5,  5,  5,  0,-10,
               0,  0,  5,  5,  5,  5,  0, -5,
              -5,  0,  5,  5,  5,  5,  0, -5,
             -10,  0,  5,  5,  5,  5,  0,-10,
             -10,  0,  0,  0,  0,  0,  0,-10,
             -20,-10,-10, -5, -5,-10,-10,-20];
var PST_K_MID = [ 20, 30, 10,  0,  0, 10, 30, 20,
                  20, 20,  0,  0,  0,  0, 20, 20,
                 -10,-20,-20,-20,-20,-20,-20,-10,
                 -20,-30,-30,-40,-40,-30,-30,-20,
                 -30,-40,-40,-50,-50,-40,-40,-30,
                 -30,-40,-40,-50,-50,-40,-40,-30,
                 -30,-40,-40,-50,-50,-40,-40,-30,
                 -30,-40,-40,-50,-50,-40,-40,-30];
var PST_K_END = [-50,-30,-30,-30,-30,-30,-30,-50,
                 -30,-30,  0,  0,  0,  0,-30,-30,
                 -30,-10, 20, 30, 30, 20,-10,-30,
                 -30,-10, 30, 40, 40, 30,-10,-30,
                 -30,-10, 30, 40, 40, 30,-10,-30,
                 -30,-10, 20, 30, 30, 20,-10,-30,
                 -30,-20,-10,  0,  0,-10,-20,-30,
                 -50,-40,-30,-20,-20,-30,-40,-50];
var PSTS = [null, PST_P, PST_N, PST_B, PST_R, PST_Q, null];

/* static eval in centipawns from the side-to-move's point of view.
   Two passes: phase (how much heavy material is left) must be known
   before the kings are scored, or an early-scanned king would be graded
   on the endgame table at move one. */
function evaluate(g) {
  var score = 0, phase = 0, sq, p, kind, idx;
  for (sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) continue;
    p = g.board[sq];
    if (!p) continue;
    kind = p > 0 ? p : -p;
    if (kind !== P && kind !== K) phase += VAL[kind];
  }
  var endgame = phase < 1300;
  for (sq = 0; sq < 128; sq++) {
    if (!onBoard(sq)) continue;
    p = g.board[sq];
    if (!p) continue;
    kind = p > 0 ? p : -p;
    idx = p > 0 ? sq64(sq) : sq64(sq ^ 0x70);
    var v = VAL[kind] + (kind === K
      ? (endgame ? PST_K_END[idx] : PST_K_MID[idx])
      : PSTS[kind][idx]);
    score += p > 0 ? v : -v;
  }
  return g.turn === WHITE ? score : -score;
}

/* ---------- search ---------- */
var MATE = 100000;
var searchDeadline = 0, searchNodes = 0, searchAborted = false;

function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

function orderMoves(ms, pv) {
  var i, m;
  for (i = 0; i < ms.length; i++) {
    m = ms[i];
    m._s = 0;
    if (m.capt) m._s = 10000 + VAL[Math.abs(m.capt)] * 10 - VAL[Math.abs(m.piece)];
    if (m.promo) m._s += 9000 + VAL[Math.abs(m.promo)];
    if (pv && m.from === pv.from && m.to === pv.to && m.promo === pv.promo) m._s = 1e9;
  }
  ms.sort(function (a, b) { return b._s - a._s; });
  return ms;
}

function quiesce(g, alpha, beta) {
  searchNodes++;
  var stand = evaluate(g);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  var caps = moves(g, true), i, sc;
  orderMoves(caps, null);
  for (i = 0; i < caps.length; i++) {
    make(g, caps[i]);
    sc = -quiesce(g, -beta, -alpha);
    unmake(g);
    if (searchAborted) return alpha;
    if (sc >= beta) return beta;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

function alphabeta(g, depth, alpha, beta, ply, pv) {
  if ((searchNodes & 1023) === 0 && now() > searchDeadline) { searchAborted = true; return alpha; }
  if (depth <= 0) return quiesce(g, alpha, beta);
  searchNodes++;
  var ms = moves(g), i, sc, best = -Infinity, line;
  if (!ms.length) return inCheck(g) ? -MATE + ply : 0;
  if (g.half >= 100) return 0;
  orderMoves(ms, pv);
  for (i = 0; i < ms.length; i++) {
    make(g, ms[i]);
    sc = -alphabeta(g, depth - 1, -beta, -alpha, ply + 1, null);
    unmake(g);
    if (searchAborted) break;
    if (sc > best) best = sc;
    if (sc > alpha) { alpha = sc; if (ply === 0) g._best = ms[i]; }
    if (alpha >= beta) break;
  }
  return best === -Infinity ? alpha : best;
}

/* Iterative-deepening search.
   opts: { ms: time budget, maxDepth, noise: cp of random slack (weaker,
   more human play for the practice opponent) }
   Returns { move, score, depth, nodes, ranked } — ranked is every root
   move with its shallow score, which is what the hint copy is built from. */
function search(g, opts) {
  opts = opts || {};
  var budget = opts.ms || 350, maxDepth = opts.maxDepth || 64;
  var rootMoves = moves(g);
  if (!rootMoves.length) return { move: null, score: 0, depth: 0, nodes: 0, ranked: [] };
  searchDeadline = now() + budget;
  searchNodes = 0; searchAborted = false;

  /* depth-1 scores for every root move — the ranked list survives even if
     deeper iterations run out of time */
  var ranked = [], i, m, sc;
  for (i = 0; i < rootMoves.length; i++) {
    m = rootMoves[i];
    make(g, m);
    sc = -quiesce(g, -Infinity, Infinity);
    unmake(g);
    ranked.push({ move: m, score: sc });
  }
  ranked.sort(function (a, b) { return b.score - a.score; });

  var best = ranked[0].move, bestScore = ranked[0].score, depth = 1;
  for (var d = 2; d <= maxDepth; d++) {
    g._best = null;
    var v = alphabeta(g, d, -Infinity, Infinity, 0, best);
    if (searchAborted && !g._best) break;
    if (g._best) { best = g._best; bestScore = v; depth = d; }
    if (searchAborted) break;
    if (Math.abs(v) > MATE - 200) break;      /* found a forced mate — done */
  }

  /* noise: pick among moves within `noise` centipawns of the best, so the
     practice opponent plays plausibly rather than perfectly */
  if (opts.noise && ranked.length > 1) {
    var pool = [], top = null;
    for (i = 0; i < ranked.length; i++) {
      if (ranked[i].move === best) top = ranked[i];
    }
    var ref = top ? Math.max(top.score, ranked[0].score) : ranked[0].score;
    for (i = 0; i < ranked.length; i++) {
      if (ref - ranked[i].score <= opts.noise) pool.push(ranked[i]);
    }
    if (pool.length) {
      var pick = pool[Math.floor(Math.random() * pool.length)];
      best = pick.move; bestScore = pick.score;
    }
  }
  return { move: best, score: bestScore, depth: depth, nodes: searchNodes, ranked: ranked };
}

/* ---------- perft (used by chess/tools/perft.js) ---------- */
function perft(g, depth) {
  if (depth === 0) return 1;
  var ms = moves(g), n = 0, i;
  if (depth === 1) return ms.length;
  for (i = 0; i < ms.length; i++) {
    make(g, ms[i]);
    n += perft(g, depth - 1);
    unmake(g);
  }
  return n;
}

/* ---------- exports ---------- */
var Chess = {
  P: P, N: N, B: B, R: R, Q: Q, K: K, WHITE: WHITE, BLACK: BLACK,
  F_DOUBLE: F_DOUBLE, F_EP: F_EP, F_CASTLE: F_CASTLE,
  START_FEN: START_FEN, VAL: VAL, MATE: MATE,
  create: create, loadFEN: loadFEN, fen: fen, key: key,
  moves: moves, movesFrom: movesFrom, make: make, unmake: unmake,
  play: play, takeBack: takeBack, status: status, inCheck: inCheck,
  attacked: attacked, repetitionCount: repetitionCount,
  toSAN: toSAN, fromSAN: fromSAN,
  evaluate: evaluate, search: search, perft: perft,
  sqName: sqName, sqIndex: sqIndex, fileOf: fileOf, rankOf: rankOf, onBoard: onBoard
};

if (typeof module !== "undefined" && module.exports) module.exports = Chess;
else root.Chess = Chess;
})(typeof self !== "undefined" ? self : this);
