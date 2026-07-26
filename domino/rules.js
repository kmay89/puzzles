/* rules.js — dominó, the way it is actually played at the table.

   This is the partnership block game: a double-six set, four players,
   two parejas sitting across from their partner, seven bones each and
   no boneyard — because 4 × 7 is exactly 28 and the pile is meant to be
   empty. That emptiness is the whole game. Nothing is drawn, nothing is
   replaced, and so every tile that isn't in your hand or on the table is
   in somebody's hand, and you are allowed to work out whose.

   No spinner, no branching. The line has two ends and only ever two
   ends; doubles are laid crosswise because that is how they lie, not
   because they open a third road. (Branching belongs to the five-up
   family — a different game with a different heart.)

   Everything here is pure: no DOM, no timers, no randomness except
   where a seed is handed in. `node tools/rules-check.js` proves it.

   The vocabulary is the table's, not a translator's:
     la mula        a double        la mula de seis   the 6|6
     la salida      the opening     paso              "I can't play"
     tranca         the game is shut, nobody can move
     capicúa        you went out on a bone that fit either end
     zapatero       the other side never scored at all           */
(function (root) {
"use strict";

/* ---------- bones ----------
   A tile is one integer, 0..27, so hands are cheap to copy, compare and
   send over the wire. `A(t)`/`B(t)` are its two halves, A ≤ B always. */
var TILES = [], TA = new Uint8Array(28), TB = new Uint8Array(28), TPIPS = new Uint8Array(28);
var ID = [];
(function () {
  var n = 0;
  for (var a = 0; a <= 6; a++) {
    ID[a] = [];
    for (var b = a; b <= 6; b++) { TILES.push(n); TA[n] = a; TB[n] = b; TPIPS[n] = a + b; ID[a][b] = n; n++; }
  }
  for (var i = 0; i <= 6; i++) for (var j = 0; j < i; j++) ID[i][j] = ID[j][i];
})();

function A(t) { return TA[t]; }
function B(t) { return TB[t]; }
function pips(t) { return TPIPS[t]; }
function isDouble(t) { return TA[t] === TB[t]; }
function tileId(a, b) { return ID[a][b]; }
function has(t, n) { return TA[t] === n || TB[t] === n; }
/* the other half of a tile, given one half you are matching on */
function other(t, n) { return TA[t] === n ? TB[t] : TA[t]; }
function name(t) { return TA[t] + "|" + TB[t]; }
function handPips(hand) { var s = 0; for (var i = 0; i < hand.length; i++) s += TPIPS[hand[i]]; return s; }

var MULA_DE_SEIS = ID[6][6];

/* ---------- seats ----------
   0 and 2 are one pareja, 1 and 3 the other. Play runs to the right,
   which on a screen laid out clockwise from the human means seat + 1. */
function team(seat) { return seat & 1; }
function partner(seat) { return (seat + 2) & 3; }
function nextSeat(seat) { return (seat + 1) & 3; }
function isOpponent(a, b) { return ((a ^ b) & 1) === 1; }

/* ---------- house rules ----------
   Every table in every cantina plays a slightly different game and each
   of them will tell you theirs is the real one. They are all right, so
   these are settings rather than opinions. Defaults are the most common
   Mexican cantina set. */
var DEFAULTS = {
  target: 100,          /* points that win the match: 50 | 100 | 200        */
  firstSalida: "mula",  /* who opens hand 1: "mula" (holder of 6|6) | "seat" */
  keepSalida: "winner", /* who opens later hands: "winner" | "left"          */
  countAll: false,      /* score every loser's pips, or only the opponents'  */
  capicua: 25,          /* bonus for going out on a bone that fit both ends  */
  trancaTie: "closer",  /* a tied tranca: "closer" takes it | "nobody" does  */
  redealDoubles: 5,     /* hold this many mulas and you may ask for a redeal; 0 = never */
  zapatero: true        /* recognise a shut-out                              */
};
function houseRules(over) {
  var r = {}, k;
  for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) r[k] = DEFAULTS[k];
  if (over) for (k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(over, k) && over[k] !== undefined && over[k] !== null) r[k] = over[k];
  /* nothing hostile survives the border */
  r.target = ({ 50: 50, 100: 100, 150: 150, 200: 200 })[r.target] || 100;
  r.firstSalida = (r.firstSalida === "seat") ? "seat" : "mula";
  r.keepSalida = (r.keepSalida === "left") ? "left" : "winner";
  r.countAll = !!r.countAll;
  r.capicua = Math.max(0, Math.min(100, r.capicua | 0));
  r.trancaTie = (r.trancaTie === "nobody") ? "nobody" : "closer";
  r.redealDoubles = Math.max(0, Math.min(7, r.redealDoubles | 0));
  r.zapatero = !!r.zapatero;
  return r;
}

/* ---------- shuffling ----------
   A seeded generator, so a hand can be replayed exactly — for the
   checks, for "show me that again", and so a host can deal a table of
   four phones from one number. */
function rng(seed) {
  /* The seed is avalanched before it is used. Raw xorshift started from
     1, 2, 3… stays correlated for its first few outputs, and a match
     walks its seed forward by small steps — which showed up as a real
     bias in where the 6|6 landed (seat 3 ran 3σ light over 4000
     sequential seeds). Mixing first costs nothing and makes seed N and
     seed N+1 independent deals, which is the property a table needs. */
  var s = (seed >>> 0) || 0x9e3779b9;
  s = Math.imul(s ^ (s >>> 16), 0x21f0aaad); s >>>= 0;
  s = Math.imul(s ^ (s >>> 15), 0x735a2d97); s >>>= 0;
  s = (s ^ (s >>> 15)) >>> 0;
  if (!s) s = 0x9e3779b9;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
/* "lavar las fichas" — face down, both hands, until nobody knows anything */
function wash(seed) {
  var r = rng(seed), deck = TILES.slice();
  for (var i = deck.length - 1; i > 0; i--) {
    var j = Math.floor(r() * (i + 1));
    var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck;
}
function deal(seed) {
  var deck = wash(seed), hands = [[], [], [], []];
  for (var i = 0; i < 28; i++) hands[i & 3].push(deck[i]);
  for (var s = 0; s < 4; s++) hands[s].sort(function (x, y) { return x - y; });
  return hands;
}
function countDoubles(hand) {
  var n = 0;
  for (var i = 0; i < hand.length; i++) if (isDouble(hand[i])) n++;
  return n;
}
/* a hand nobody wants to play: enough mulas that the deal, not the
   player, decides the game. Tables allow a redeal; ours offers it. */
function mayRedeal(hand, rules) {
  var d = rules.redealDoubles;
  return d > 0 && countDoubles(hand) >= d;
}

/* ---------- a hand of dominoes ----------
   `state` is plain data and safe to clone with JSON. The renderers read
   it, the AI clones it, the network ships it. */
function newHand(opts) {
  opts = opts || {};
  var rules = opts.rules || houseRules();
  var hands = opts.hands || deal(opts.seed || 1);
  var st = {
    rules: rules,
    hands: [hands[0].slice(), hands[1].slice(), hands[2].slice(), hands[3].slice()],
    line: [],            /* plays in order: {seat, tile, end, flip}          */
    left: -1, right: -1, /* the two open numbers; -1 before the salida       */
    turn: 0,
    passes: 0,           /* consecutive passes — four of them is a tranca    */
    voids: [[], [], [], []], /* what each seat has shown they do not have    */
    over: false,
    result: null,
    log: []
  };
  for (var s = 0; s < 4; s++) st.voids[s] = [false, false, false, false, false, false, false];
  st.turn = opts.salida !== undefined && opts.salida >= 0 ? opts.salida : openingSeat(st, opts.lastWinner);
  st.opener = st.turn;
  return st;
}

/* who puts the first bone down. The 6|6 opens the first hand of a match
   because it is the one tile everybody can see the absence of. */
function openingSeat(st, lastWinner) {
  if (st.rules.firstSalida === "seat") return 0;
  if (lastWinner !== undefined && lastWinner !== null && lastWinner >= 0) return lastWinner;
  for (var s = 0; s < 4; s++) if (st.hands[s].indexOf(MULA_DE_SEIS) >= 0) return s;
  /* the 6|6 is always somewhere in a full deal; this is belt and braces */
  var best = 0, bestPips = -1;
  for (var q = 0; q < 4; q++) {
    for (var i = 0; i < st.hands[q].length; i++) {
      if (isDouble(st.hands[q][i]) && pips(st.hands[q][i]) > bestPips) { bestPips = pips(st.hands[q][i]); best = q; }
    }
  }
  return best;
}

/* ---------- what may be played ----------
   Before the salida every bone is legal — except on the very first hand
   of a match, where the 6|6 must lead if the house says so. After that a
   bone is legal if it carries either open number.

   Returns [{tile, end}] where end is "L" or "R", and a double that fits
   both ends is only offered once per end (it is the same placement). */
function moves(st, seat) {
  if (seat === undefined) seat = st.turn;
  var hand = st.hands[seat], out = [], i;
  if (st.line.length === 0) {
    var mustLead = (st.rules.firstSalida === "mula" && st.mustLeadMula && hand.indexOf(MULA_DE_SEIS) >= 0);
    for (i = 0; i < hand.length; i++) {
      if (mustLead && hand[i] !== MULA_DE_SEIS) continue;
      out.push({ tile: hand[i], end: "L" });
    }
    return out;
  }
  for (i = 0; i < hand.length; i++) {
    var t = hand[i];
    if (has(t, st.left)) out.push({ tile: t, end: "L" });
    /* a double on a closed line, or the two ends being equal, would
       otherwise be offered twice for what is one placement */
    if (has(t, st.right) && !(st.left === st.right && has(t, st.left))) out.push({ tile: t, end: "R" });
  }
  return out;
}
function canPlay(st, seat) { return moves(st, seat).length > 0; }

/* ---------- playing ----------
   `play(st, {tile, end})` mutates and returns st. It refuses anything
   illegal rather than half-doing it, so a bad message off the wire
   cannot corrupt a table. */
function play(st, mv) {
  if (st.over) return fail(st, "the hand is over");
  var seat = st.turn, hand = st.hands[seat];
  var at = hand.indexOf(mv.tile);
  if (at < 0) return fail(st, "not your bone");
  var legal = moves(st, seat), ok = false;
  for (var i = 0; i < legal.length; i++) if (legal[i].tile === mv.tile && legal[i].end === mv.end) { ok = true; break; }
  if (!ok) return fail(st, "that bone does not fit there");

  var t = mv.tile, endL = (mv.end === "L"), flip = false;
  var wasL = st.left, wasR = st.right;   /* the ends as they stood before this bone — capicúa is judged on these */
  if (st.line.length === 0) {
    st.left = TA[t]; st.right = TB[t];
    /* the opening bone is laid along the line with its low half to the
       left, so `flip` stays false and both ends read outwards */
  } else if (endL) {
    var joinL = st.left;
    /* the half that matches is consumed; the other half becomes the end.
       flip records whether the tile's B half points outward, which is
       all a renderer needs to draw the pips the right way round. */
    st.left = other(t, joinL);
    flip = (TA[t] !== joinL);
  } else {
    var joinR = st.right;
    st.right = other(t, joinR);
    flip = (TB[t] !== joinR);
  }
  hand.splice(at, 1);
  st.line.push({ seat: seat, tile: t, end: st.line.length === 0 ? "S" : mv.end, flip: flip, dbl: isDouble(t) });
  st.passes = 0;
  st.log.push({ k: "play", seat: seat, tile: t, end: mv.end });

  if (hand.length === 0) return finishDomino(st, seat, t, wasL, wasR);
  st.turn = nextSeat(seat);
  /* the next player may be shut out on both ends; passes resolve on
     their own turn, not here — the table waits for them to say "paso" */
  return st;
}

function fail(st, why) { st.error = why; return st; }

/* "paso" — said out loud, and remembered by everyone at the table.
   A pass is the single richest piece of information in the game: it
   tells all four players that this seat holds no bone with either open
   number, forever. We record it as a void so the AI and the coach can
   both reason from exactly what a human would have heard. */
function pass(st) {
  if (st.over) return fail(st, "the hand is over");
  var seat = st.turn;
  if (canPlay(st, seat)) return fail(st, "you can play — you must");
  if (st.left >= 0) { st.voids[seat][st.left] = true; st.voids[seat][st.right] = true; }
  st.passes++;
  st.log.push({ k: "pass", seat: seat, ends: [st.left, st.right] });
  if (st.passes >= 4) return finishTranca(st);
  st.turn = nextSeat(seat);
  return st;
}

/* the turn resolves itself: whoever is up either plays or passes, and a
   caller that does not want to think about it can just ask */
function step(st, chooser) {
  if (st.over) return st;
  if (!canPlay(st, st.turn)) return pass(st);
  return play(st, chooser(st, st.turn));
}

/* ---------- the end of a hand ----------
   Two ways out: somebody empties their hand, or the line shuts and
   nobody can move. */
function finishDomino(st, seat, lastTile, wasL, wasR) {
  /* Capicúa: the bone you went out on would have gone down at either
     end. Judged on the ends as they stood before the play — hence wasL
     and wasR, which `play` kept for exactly this moment.

     Two bones look like a capicúa and are not. A double is one tile
     with one number, so "either end" is not a choice it can offer. And
     when both ends already show the same number there was likewise no
     choice to make: every bone that fits one fits the other. Tables
     disallow both, and so do we. */
  var capi = false;
  if (st.line.length > 1 && st.rules.capicua > 0 && wasL !== wasR && !isDouble(lastTile)) {
    capi = has(lastTile, wasL) && has(lastTile, wasR);
  }
  return score(st, {
    how: "domino",
    winner: seat,
    team: team(seat),
    capicua: capi
  });
}

function finishTranca(st) {
  var tot = [0, 0];
  for (var s = 0; s < 4; s++) tot[team(s)] += handPips(st.hands[s]);
  var w;
  if (tot[0] < tot[1]) w = 0;
  else if (tot[1] < tot[0]) w = 1;
  else w = (st.rules.trancaTie === "closer") ? team(st.line.length ? st.line[st.line.length - 1].seat : 0) : -1;
  return score(st, {
    how: "tranca",
    winner: -1,
    team: w,
    teamPips: tot,
    capicua: false
  });
}

/* the count. The winning pareja takes the pips their opponents are
   still holding — the bones you were too slow to get rid of are the
   points you hand over. */
function score(st, res) {
  var pipsBySeat = [0, 0, 0, 0], s;
  for (s = 0; s < 4; s++) pipsBySeat[s] = handPips(st.hands[s]);
  var pts = 0;
  if (res.team >= 0) {
    for (s = 0; s < 4; s++) {
      /* countAll is the harsher house rule: the player who went out
         takes every other hand on the table, their partner's included.
         It cannot apply to a tranca, where nobody went out — there the
         losing pareja pays and that is all. */
      if (st.rules.countAll && res.winner >= 0) { if (s !== res.winner) pts += pipsBySeat[s]; }
      else if (team(s) !== res.team) pts += pipsBySeat[s];
    }
    if (res.capicua) pts += st.rules.capicua;
  }
  res.points = pts;
  res.pipsBySeat = pipsBySeat;
  res.left = st.left; res.right = st.right;
  st.over = true;
  st.result = res;
  st.log.push({ k: "end", res: res });
  return st;
}

/* ---------- a match ----------
   Hands stack into a match to `target`. The winner of a hand opens the
   next one, which is why going out matters even when the count is small. */
function newMatch(opts) {
  opts = opts || {};
  var rules = houseRules(opts.rules);
  return {
    rules: rules,
    scores: [0, 0],
    handNo: 0,
    lastWinner: -1,
    seed: (opts.seed || 1) >>> 0,
    history: [],
    over: false,
    champion: -1,
    zapatero: false
  };
}
function nextSeed(m) {
  /* a match walks its seed forward so every hand is different and the
     whole match still replays from one number */
  m.seed = (Math.imul(m.seed ^ 0x6d2b79f5, 0x85ebca6b) ^ (m.handNo + 1)) >>> 0;
  if (!m.seed) m.seed = 0x9e3779b9;
  return m.seed;
}
function dealHand(m, opts) {
  opts = opts || {};
  var seed = opts.seed !== undefined ? opts.seed : nextSeed(m);
  var hands = opts.hands || deal(seed);
  var salida = -1;
  if (m.handNo === 0) salida = -1;                               /* the 6|6 decides */
  else if (m.rules.keepSalida === "winner" && m.lastWinner >= 0) salida = m.lastWinner;
  else salida = nextSeat(m.lastOpener !== undefined && m.lastOpener >= 0 ? m.lastOpener : 0);
  var st = newHand({ rules: m.rules, hands: hands, seed: seed, salida: salida < 0 ? undefined : salida });
  st.mustLeadMula = (m.handNo === 0 && m.rules.firstSalida === "mula");
  st.seed = seed;
  st.handNo = m.handNo;
  m.lastOpener = st.opener;
  return st;
}
/* fold a finished hand into the match */
function settle(m, st) {
  var r = st.result;
  if (!r) return m;
  m.handNo++;
  if (r.team >= 0) m.scores[r.team] += r.points;
  m.lastWinner = r.winner >= 0 ? r.winner : (r.team >= 0 ? pickTrancaOpener(st, r.team) : m.lastWinner);
  m.history.push({
    how: r.how, team: r.team, points: r.points, capicua: !!r.capicua,
    winner: r.winner, scores: [m.scores[0], m.scores[1]]
  });
  if (m.scores[0] >= m.rules.target || m.scores[1] >= m.rules.target) {
    m.over = true;
    m.champion = m.scores[0] === m.scores[1] ? -1 : (m.scores[0] > m.scores[1] ? 0 : 1);
    /* zapatero: they never scored once. Said with sympathy and a laugh,
       and traditionally paid for in beer. */
    if (m.rules.zapatero && m.champion >= 0 && m.scores[1 - m.champion] === 0) m.zapatero = true;
  }
  return m;
}
/* after a tranca the "winner" is a team, not a person, so the next
   salida goes to whichever of them is holding the least */
function pickTrancaOpener(st, t) {
  var best = -1, bp = 1e9;
  for (var s = 0; s < 4; s++) {
    if (team(s) !== t) continue;
    var p = handPips(st.hands[s]);
    if (p < bp) { bp = p; best = s; }
  }
  return best;
}

/* ---------- reading the table ----------
   Everything a player is *entitled* to know, computed the way a human
   computes it: from their own hand, the bones face-up on the table, and
   what everybody has said out loud. Never from the other hands. This is
   the boundary the AI is not allowed to cross, and it is enforced here
   rather than trusted to good behaviour up in the AI. */
function publicView(st, seat) {
  var seen = new Uint8Array(28), i;
  for (i = 0; i < st.line.length; i++) seen[st.line[i].tile] = 1;
  for (i = 0; i < st.hands[seat].length; i++) seen[st.hands[seat][i]] = 1;
  var unseen = [];
  for (i = 0; i < 28; i++) if (!seen[i]) unseen.push(i);
  var counts = [];
  for (var s = 0; s < 4; s++) counts.push(st.hands[s].length);
  return {
    seat: seat,
    hand: st.hands[seat].slice(),
    left: st.left, right: st.right,
    counts: counts,
    unseen: unseen,
    voids: st.voids.map(function (v) { return v.slice(); }),
    line: st.line.map(function (p) { return { seat: p.seat, tile: p.tile, end: p.end, flip: p.flip, dbl: p.dbl }; }),
    turn: st.turn,
    passes: st.passes,
    rules: st.rules,
    /* the one constraint that is not visible in the bones themselves:
       on the first hand of a match the 6|6 must lead. Anything reading
       the table through this view — the AI, the coach, a joiner's
       screen — has to know it, or it will offer a bone the table will
       not accept. */
    mustLeadMula: !!st.mustLeadMula
  };
}

/* how many of each number are still unaccounted for, from `seat`'s
   chair. The single most useful count in the game: it is how you know
   whether the end you are about to open can be answered. */
function suitCensus(view) {
  var live = [0, 0, 0, 0, 0, 0, 0], mine = [0, 0, 0, 0, 0, 0, 0], i, t;
  for (i = 0; i < view.unseen.length; i++) {
    t = view.unseen[i];
    live[TA[t]]++; if (TB[t] !== TA[t]) live[TB[t]]++;
  }
  for (i = 0; i < view.hand.length; i++) {
    t = view.hand[i];
    mine[TA[t]]++; if (TB[t] !== TA[t]) mine[TB[t]]++;
  }
  return { live: live, mine: mine };
}

/* ---------- exports ---------- */
var Rules = {
  TILES: TILES, MULA_DE_SEIS: MULA_DE_SEIS,
  A: A, B: B, pips: pips, isDouble: isDouble, tileId: tileId, has: has, other: other,
  name: name, handPips: handPips, countDoubles: countDoubles,
  team: team, partner: partner, nextSeat: nextSeat, isOpponent: isOpponent,
  DEFAULTS: DEFAULTS, houseRules: houseRules,
  rng: rng, wash: wash, deal: deal, mayRedeal: mayRedeal,
  newHand: newHand, moves: moves, canPlay: canPlay, play: play, pass: pass, step: step,
  newMatch: newMatch, dealHand: dealHand, settle: settle,
  publicView: publicView, suitCensus: suitCensus
};

if (typeof module !== "undefined" && module.exports) module.exports = Rules;
else root.Rules = Rules;
})(typeof self !== "undefined" ? self : this);
