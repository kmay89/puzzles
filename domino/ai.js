/* ai.js — the three at the table, and the voice that explains them.

   A domino player who has sat at the same table for forty years is not
   doing anything mysterious. They are doing four things, and this file
   does the same four:

   1. **Counting.** Twenty-eight bones. The ones in your hand and the
      ones face-up on the table are known; everything else is in three
      hands, and there are only so many places each bone can be.
   2. **Listening to passes.** When somebody says *paso* on fives and
      threes, they have no fives and no threes, and they will not have
      any later either. It is the loudest thing said all evening.
   3. **Playing with their partner, not beside them.** Your first bone
      tells your partner what you are long in. Opening a suit your
      partner has passed on is a small betrayal that costs real points.
   4. **Shutting the door.** The best play is often not the one that
      helps you but the one that leaves an opponent with nowhere to go —
      *ahorcar*, to hang them. Do it on both ends at once and the game
      is yours.

   Everything here works from `Rules.publicView` and can therefore only
   see what a person in that chair can see. That is not a promise, it is
   the type signature: no function in this file is ever handed the real
   hands. (`rules-check.js` proves the view does not leak, and
   `ai-check.js` proves an AI given only the view still beats one
   playing at random by a wide margin.)

   The same analysis that picks the move writes down *why* it picked it,
   as tags. `coach.js` turns those tags into sentences, so the hint you
   are shown is genuinely the reason the machine acted — not a
   plausible-sounding story written next to it.                        */
(function (root) {
"use strict";

var R = (typeof require === "function" && typeof module !== "undefined")
  ? require("./rules.js") : root.Rules;

/* ---------- levels ----------
   Named the way you would be introduced to them, and honest about what
   each one actually does differently. */
var LEVELS = {
  novato:   { id: "novato",   label: "Novato",   note: "Plays a legal bone, mostly at random. Kind to a beginner.",
              rollouts: 0, noise: 1.00, counts: false, partner: false },
  compadre: { id: "compadre", label: "Compadre", note: "Counts the suits, hears every pass, looks after their partner.",
              rollouts: 0, noise: 0.18, counts: true,  partner: true },
  maestro:  { id: "maestro",  label: "Maestro",  note: "All of that, then plays the hand out in their head a few hundred times.",
              rollouts: 220, noise: 0.02, counts: true, partner: true },
  cabron:   { id: "cabron",   label: "Cabrón",   note: "The one who takes your money. Thinks twice as hard and never slips.",
              rollouts: 600, noise: 0.00, counts: true, partner: true }
};
/* A level may also be handed in as a plain object rather than a name.
   The room never does this; `ai-check.js` does, so it can run one
   setting against itself with a single knob moved and get a clean
   answer about what that knob is worth. */
function level(id) {
  if (id && typeof id === "object") {
    return {
      id: id.id || "custom", label: id.label || "Custom", note: id.note || "",
      rollouts: id.rollouts | 0,
      noise: typeof id.noise === "number" ? id.noise : 0,
      counts: !!id.counts, partner: !!id.partner
    };
  }
  return LEVELS[id] || LEVELS.compadre;
}

/* ---------- who can be holding what ----------
   A bone is feasible for a seat unless that seat has passed on one of
   its numbers. `voids` is the record of every *paso* heard. */
function feasible(voids, t) {
  return !(voids[R.A(t)] || voids[R.B(t)]);
}

/* The belief matrix: for every unseen bone, how likely each seat is to
   be holding it.

   Iterative proportional fitting. Two facts have to hold at once —
   every bone is in exactly one hand, and every hand holds exactly as
   many bones as we can see it holding — and alternately normalising
   rows and columns converges on the distribution that satisfies both
   while assuming nothing else. It is the least-committal answer
   consistent with what is known, which is precisely what a careful
   player's sense of "they're probably out of fours" amounts to. */
function beliefs(view) {
  var un = view.unseen, n = un.length;
  var seats = [], s, i, k;
  for (s = 0; s < 4; s++) if (s !== view.seat) seats.push(s);
  var m = seats.length;
  var p = new Float64Array(n * m);
  var want = [];
  for (i = 0; i < m; i++) want.push(view.counts[seats[i]]);

  for (i = 0; i < n; i++) {
    for (k = 0; k < m; k++) p[i * m + k] = feasible(view.voids[seats[k]], un[i]) ? 1 : 0;
  }
  /* a bone nobody can legally hold means the voids are contradictory —
     only reachable from a corrupted message, so fall back to flat */
  for (i = 0; i < n; i++) {
    var row = 0;
    for (k = 0; k < m; k++) row += p[i * m + k];
    if (row === 0) for (k = 0; k < m; k++) p[i * m + k] = 1;
  }

  for (var iter = 0; iter < 24; iter++) {
    for (i = 0; i < n; i++) {                 /* every bone is in one hand */
      var r = 0;
      for (k = 0; k < m; k++) r += p[i * m + k];
      if (r > 0) for (k = 0; k < m; k++) p[i * m + k] /= r;
    }
    for (k = 0; k < m; k++) {                 /* every hand is the size it is */
      var c = 0;
      for (i = 0; i < n; i++) c += p[i * m + k];
      if (c > 0) { var f = want[k] / c; for (i = 0; i < n; i++) p[i * m + k] *= f; }
    }
  }
  return { tiles: un, seats: seats, p: p, m: m };
}

/* How likely a seat is to be unable to answer a given number. Treats
   the bones as independent, which understates certainty slightly — good
   enough for the heuristic tiers, and the rollout tiers do not use it
   at all, they just deal the cards out and look. */
function pVoid(bel, seat, num) {
  var k = bel.seats.indexOf(seat);
  if (k < 0) return 0;
  var q = 1;
  for (var i = 0; i < bel.tiles.length; i++) {
    var t = bel.tiles[i];
    if (R.has(t, num)) q *= (1 - bel.p[i * bel.m + k]);
  }
  return q;
}
/* the chance a seat cannot play at all against two open ends */
function pStuck(bel, seat, a, b) {
  var k = bel.seats.indexOf(seat);
  if (k < 0) return 0;
  var q = 1;
  for (var i = 0; i < bel.tiles.length; i++) {
    var t = bel.tiles[i];
    if (R.has(t, a) || R.has(t, b)) q *= (1 - bel.p[i * bel.m + k]);
  }
  return q;
}

/* ---------- dealing out the unseen bones ----------
   For the rollout tiers: an actual, consistent set of three hands that
   nothing observed rules out. Most-constrained bone first, with
   restarts, because a careless greedy fill paints itself into a corner
   whenever the voids are tight. */
function sample(view, rand) {
  var un = view.unseen, seats = [], s;
  for (s = 0; s < 4; s++) if (s !== view.seat) seats.push(s);

  for (var attempt = 0; attempt < 60; attempt++) {
    var cap = [], out = [], i, k;
    for (k = 0; k < seats.length; k++) { cap.push(view.counts[seats[k]]); out.push([]); }

    /* order by how few seats can take each bone, ties broken randomly
       so repeated samples explore different deals */
    var order = un.slice();
    var fitCount = {};
    for (i = 0; i < order.length; i++) {
      var c = 0;
      for (k = 0; k < seats.length; k++) if (feasible(view.voids[seats[k]], order[i])) c++;
      fitCount[order[i]] = c + rand() * 0.5;
    }
    order.sort(function (x, y) { return fitCount[x] - fitCount[y]; });

    var okAll = true;
    for (i = 0; i < order.length; i++) {
      var t = order[i], picks = [], tot = 0;
      for (k = 0; k < seats.length; k++) {
        if (cap[k] > 0 && feasible(view.voids[seats[k]], t)) { picks.push(k); tot += cap[k]; }
      }
      if (!picks.length) { okAll = false; break; }
      /* weight by room left, so hands fill evenly rather than one seat
         hoovering up every unconstrained bone */
      var roll = rand() * tot, chosen = picks[picks.length - 1];
      for (k = 0; k < picks.length; k++) { roll -= cap[picks[k]]; if (roll <= 0) { chosen = picks[k]; break; } }
      out[chosen].push(t);
      cap[chosen]--;
    }
    if (!okAll) continue;
    var full = true;
    for (k = 0; k < seats.length; k++) if (cap[k] !== 0) full = false;
    if (!full) continue;

    var hands = [[], [], [], []];
    hands[view.seat] = view.hand.slice();
    for (k = 0; k < seats.length; k++) hands[seats[k]] = out[k];
    return hands;
  }

  /* Nothing consistent turned up in sixty tries — the voids are tighter
     than the deal can satisfy, which happens near the very end of a shut
     hand. Deal it out ignoring the voids rather than returning nothing:
     a slightly wrong world beats no world, and the rollout still learns
     more than a coin flip. */
  var loose = un.slice(), h2 = [[], [], [], []];
  for (var q = loose.length - 1; q > 0; q--) {
    var j = Math.floor(rand() * (q + 1)), tmp = loose[q]; loose[q] = loose[j]; loose[j] = tmp;
  }
  h2[view.seat] = view.hand.slice();
  var at = 0;
  for (var z = 0; z < seats.length; z++) {
    h2[seats[z]] = loose.slice(at, at + view.counts[seats[z]]);
    at += view.counts[seats[z]];
  }
  return h2;
}

/* ---------- reading a candidate move ----------
   Scores a move the way a person talks about it, and keeps the reasons.
   Everything is in points-ish units so the weights can be argued with. */

/* what the ends become if this move is made */
function endsAfter(view, mv) {
  if (view.left < 0) return { a: R.A(mv.tile), b: R.B(mv.tile) };
  if (mv.end === "L") return { a: R.other(mv.tile, view.left), b: view.right };
  return { a: view.left, b: R.other(mv.tile, view.right) };
}

function evaluate(view, mv, bel, lv) {
  var me = view.seat, mate = R.partner(me);
  var opps = [R.nextSeat(me), R.nextSeat(R.nextSeat(R.nextSeat(me)))];
  var e = endsAfter(view, mv), why = [], score = 0;

  /* going out ends it — nothing else compares */
  if (view.hand.length === 1) {
    why.push({ tag: "domino", w: 1000 });
    return { score: 1000, why: why, ends: e };
  }

  /* how much of my own hand still plays afterwards. A hand that cannot
     answer its own ends is a hand about to start passing. */
  var mine = 0, rest = view.hand.length - 1;
  for (var i = 0; i < view.hand.length; i++) {
    var t = view.hand[i];
    if (t === mv.tile) continue;
    if (R.has(t, e.a) || R.has(t, e.b)) mine++;
  }
  var flex = rest ? mine / rest : 1;
  score += flex * 14;
  if (rest > 1 && mine === 0) { score -= 22; why.push({ tag: "selfStuck", w: -22 }); }

  /* shedding weight. Points you are still holding when the game shuts
     are points you hand over, so heavy bones want to go early — but not
     at the cost of the hand. */
  score += R.pips(mv.tile) * 0.55;
  if (R.pips(mv.tile) >= 9) why.push({ tag: "heavy", w: R.pips(mv.tile) * 0.55, pips: R.pips(mv.tile) });

  /* a mula is the hardest bone to place: only one number will take it.
     Play it while its suit is still open. */
  if (R.isDouble(mv.tile)) {
    score += 7;
    why.push({ tag: "shedMula", w: 7, num: R.A(mv.tile) });
  }

  if (lv.counts && bel) {
    /* ahorcar — leaving an opponent with nowhere to go */
    for (var o = 0; o < 2; o++) {
      var op = opps[o], st = pStuck(bel, op, e.a, e.b);
      if (st > 0.12) {
        var w = st * 40;
        score += w;
        why.push({ tag: "ahorca", w: w, seat: op, p: st, a: e.a, b: e.b });
      }
    }
    /* both ends the same number is the classic squeeze: only bones
       carrying it can answer, and there are only seven of those */
    if (e.a === e.b) {
      var live = 0;
      for (var q = 0; q < bel.tiles.length; q++) if (R.has(bel.tiles[q], e.a)) live++;
      var w2 = Math.max(0, (4 - live)) * 6;
      score += w2 + 4;
      why.push({ tag: "bothEnds", w: w2 + 4, num: e.a, live: live });
    }

    if (lv.partner) {
      /* do not shut the door on your own partner */
      var ps = pStuck(bel, mate, e.a, e.b);
      if (ps > 0.15) {
        var w3 = -ps * 34;
        score += w3;
        why.push({ tag: "hurtsMate", w: w3, seat: mate, p: ps, a: e.a, b: e.b });
      }
      /* and prefer ends your partner has shown strength in */
      var pa = 1 - pVoid(bel, mate, e.a), pb = 1 - pVoid(bel, mate, e.b);
      score += (pa + pb) * 4;
    }

    /* control: an end you hold several of is an end you can keep
       answering all night */
    var cen = R.suitCensus(view);
    var ctl = cen.mine[e.a] + cen.mine[e.b];
    score += ctl * 2.2;
    if (ctl >= 3) why.push({ tag: "control", w: ctl * 2.2, a: e.a, b: e.b, n: ctl });

    /* opening a number that is nearly exhausted, when you cannot answer
       it yourself, is how you end up passing on your own play */
    var deadA = cen.live[e.a] === 0 && cen.mine[e.a] === 0;
    var deadB = cen.live[e.b] === 0 && cen.mine[e.b] === 0;
    if (deadA && deadB) { score -= 8; }
  }

  return { score: score, why: why, ends: e };
}

/* ---------- playing it out in your head ----------
   Determinized rollouts: deal the unseen bones into three hands that
   fit everything observed, play the hand to its end with a fast policy,
   and see who came out ahead. Do it a few hundred times and the average
   is a genuine read on the position rather than a rule of thumb.

   This is where the hard tiers get their teeth, and it is also why they
   can find a shut-the-game play that no heuristic would have written
   down. */
/* The policy the imagined players use inside a rollout.

   This is the part that decides whether rollouts are worth doing at
   all, and it took a measurement to find that out. The first version
   picked mostly by weight with a random term as large as everything
   else put together, and the playouts it produced were close enough to
   random that the whole search added almost nothing: 600 rollouts
   scored no better than 220 (z = 0.67), which is the signature of an
   evaluation that is not measuring anything. Sample count was never the
   problem.

   So the policy plays the three ideas that actually decide a hand, and
   keeps only enough randomness to stop every playout being identical —
   the variety that matters comes from the deals, not from here.

   It stays deliberately cheap. It runs tens of thousands of times a
   move and cannot afford to think; the belief matrix and the reasoning
   live up in `evaluate`, not down here. */
function rolloutPolicy(st, seat, rand) {
  var mv = R.moves(st, seat), best = null, bestS = -1e9;
  var nxt = R.nextSeat(seat), mate = R.partner(seat);
  for (var i = 0; i < mv.length; i++) {
    var t = mv[i].tile;
    var s = R.pips(t) * 0.35 + (R.isDouble(t) ? 4 : 0) + rand() * 0.8;

    /* the ends this play creates */
    var a, b;
    if (mv[i].end === "L") { a = R.other(t, st.left); b = st.right; }
    else { a = st.left; b = R.other(t, st.right); }

    /* can I still answer my own end afterwards */
    for (var j = 0; j < st.hands[seat].length; j++) {
      if (st.hands[seat][j] !== t && (R.has(st.hands[seat][j], a) || R.has(st.hands[seat][j], b))) { s += 2.5; break; }
    }
    /* shut the next player out if the passes say I can — and do not do
       it to my own partner. Both read off the voids the rollout has
       been keeping all along, so this costs two array lookups. */
    if (st.voids[nxt][a] && st.voids[nxt][b]) s += 6;
    if (st.voids[mate][a] && st.voids[mate][b]) s -= 4;

    if (s > bestS) { bestS = s; best = mv[i]; }
  }
  return best;
}

function playOut(hands, view, firstMove, rand) {
  var st = R.newHand({ rules: view.rules, hands: hands, salida: view.seat });
  /* rebuild the table exactly as it stands, then make the candidate move */
  st.line = view.line.slice();
  st.left = view.left; st.right = view.right;
  st.turn = view.seat;
  st.passes = view.passes;
  for (var s = 0; s < 4; s++) st.voids[s] = view.voids[s].slice();
  st.mustLeadMula = false;

  R.play(st, firstMove);
  if (st.error) return null;

  var guard = 0;
  while (!st.over && guard++ < 60) {
    if (!R.canPlay(st, st.turn)) { R.pass(st); continue; }
    var mv = rolloutPolicy(st, st.turn, rand);
    if (!mv) break;
    R.play(st, mv);
    if (st.error) return null;
  }
  if (!st.over) {
    /* ran out of guard — score it as it stands, by weight */
    var t0 = R.handPips(st.hands[0]) + R.handPips(st.hands[2]);
    var t1 = R.handPips(st.hands[1]) + R.handPips(st.hands[3]);
    return (R.team(view.seat) === 0) ? (t1 - t0) : (t0 - t1);
  }
  var r = st.result, mineTeam = R.team(view.seat);
  if (r.team < 0) return 0;
  return (r.team === mineTeam ? 1 : -1) * (r.points + 20);
}

/* ---------- choosing ----------
   Returns the move, and the whole ranked list with reasons, so the
   coach can explain the road not taken as well as the one taken. */
function analyse(view, opts) {
  opts = opts || {};
  var lv = level(opts.level);
  var rand = opts.rand || Math.random;
  var mv = movesFor(view);
  if (!mv.length) return { move: null, ranked: [], stuck: true, level: lv };

  var bel = lv.counts ? beliefs(view) : null;
  var ranked = [], i;

  for (i = 0; i < mv.length; i++) {
    var ev = evaluate(view, mv[i], bel, lv);
    ranked.push({ move: mv[i], score: ev.score, why: ev.why, ends: ev.ends, roll: null });
  }

  if (lv.rollouts > 0 && mv.length > 1) {
    /* Every candidate is played out against the *same* imagined tables,
       and with the same luck inside each playout.

       This matters more than the number of rollouts. Scoring each move
       on its own private set of deals means comparing numbers that each
       carry their own error, and the best-looking move is then usually
       just the one that drew the kindest cards — over 120 matches that
       cost about as much as it gained. Dealing one table and asking
       every candidate the same question turns the comparison into a
       paired one, where the deal luck is common to both sides and
       subtracts out. Same budget, far steadier answer.

       Each deal carries a seed so the rollout's own coin-flips repeat
       identically for every candidate too — otherwise the noise creeps
       back in through the playout policy. */
    var nDeals = Math.max(20, Math.floor(lv.rollouts / mv.length));
    var deals = [], seeds = [], k;
    for (k = 0; k < nDeals; k++) {
      deals.push(sample(view, rand));
      seeds.push((rand() * 0xffffffff) >>> 0);
    }
    for (i = 0; i < ranked.length; i++) {
      var sum = 0, n = 0;
      for (k = 0; k < nDeals; k++) {
        var v = playOut(deals[k], view, ranked[i].move, R.rng(seeds[k]));
        if (v !== null) { sum += v; n++; }
      }
      ranked[i].roll = n ? sum / n : 0;
      ranked[i].rolls = n;
      /* the rollout is the opinion that counts; the heuristic stays as a
         tie-breaker and as the source of the words */
      ranked[i].score = ranked[i].roll * 1.2 + ranked[i].score * 0.25;
    }
  }

  if (lv.noise > 0) {
    for (i = 0; i < ranked.length; i++) ranked[i].score += (rand() - 0.5) * lv.noise * 60;
  }
  ranked.sort(function (a, b) { return b.score - a.score; });

  return {
    move: ranked[0].move,
    best: ranked[0],
    ranked: ranked,
    beliefs: bel,
    level: lv,
    stuck: false,
    /* the margin over the next-best play — a small margin means it
       genuinely did not matter much, and the coach says so */
    margin: ranked.length > 1 ? ranked[0].score - ranked[1].score : 99
  };
}

/* the legal moves, from the view rather than the state */
function movesFor(view) {
  var out = [], i;
  if (view.left < 0) {
    /* the salida. On the first hand of a match the 6|6 leads and
       nothing else may — offering anything else here deadlocks the
       table, because the engine refuses the bone and the turn never
       moves on. */
    var forced = view.mustLeadMula && view.hand.indexOf(R.MULA_DE_SEIS) >= 0;
    for (i = 0; i < view.hand.length; i++) {
      if (forced && view.hand[i] !== R.MULA_DE_SEIS) continue;
      out.push({ tile: view.hand[i], end: "L" });
    }
    return out;
  }
  for (i = 0; i < view.hand.length; i++) {
    var t = view.hand[i];
    if (R.has(t, view.left)) out.push({ tile: t, end: "L" });
    if (R.has(t, view.right) && !(view.left === view.right && R.has(t, view.left))) out.push({ tile: t, end: "R" });
  }
  return out;
}

/* what the table can be told about a seat, from passes alone — the
   coach's raw material, and the thing a new player never thinks to
   track */
function reads(view) {
  var out = [];
  for (var s = 0; s < 4; s++) {
    if (s === view.seat) continue;
    var voids = [];
    for (var n = 0; n <= 6; n++) if (view.voids[s][n]) voids.push(n);
    if (voids.length) out.push({ seat: s, voids: voids, mate: s === R.partner(view.seat) });
  }
  return out;
}

var AI = {
  LEVELS: LEVELS, level: level,
  beliefs: beliefs, pVoid: pVoid, pStuck: pStuck, sample: sample,
  evaluate: evaluate, analyse: analyse, movesFor: movesFor, endsAfter: endsAfter, reads: reads,
  feasible: feasible
};
if (typeof module !== "undefined" && module.exports) module.exports = AI;
else root.AI = AI;
})(typeof self !== "undefined" ? self : this);
