/* learn.js — the Academy: a course that teaches the way learning
   actually works.

   Every design choice here is a technique with evidence behind it, and
   the app names them out loud so the learner knows why they're being
   asked to struggle a little:

     · RETRIEVAL PRACTICE — you always *produce* the move on a real
       board. Nothing here is multiple choice, because recognising an
       answer is not the same skill as finding one.
     · WORKED EXAMPLE, THEN FADE — the first sight of an idea is
       demonstrated move-by-move, then handed straight back to you to
       do yourself. Support is removed as soon as you don't need it.
     · SPACING — concepts return days later, at growing intervals, so
       they're rebuilt from memory instead of merely re-read.
     · INTERLEAVING — practice mixes concepts rather than drilling one,
       because the hard part in a real game is knowing *which* idea
       applies.
     · IMMEDIATE, SPECIFIC FEEDBACK — a wrong move is answered by what
       that move actually allows (teach.js looks at your position), not
       by "try again".
     · ELABORATION — after a success you get the *why* in cause-and-
       effect terms, which is what makes a pattern transfer.
     · DESIRABLE DIFFICULTY — hints exist but are opt-in and never
       automatic, so the effort happens before the help.
     · METACOGNITION — "did you see it, or guess?" is asked honestly and
       fed into the schedule, because knowing what you don't know is
       most of learning.

   Acceptance is by IDEA, not by one blessed move: a lesson about forks
   accepts any move that forks. That's the difference between teaching
   chess and teaching a script.

   Every position and solution is replayed through the engine by
   chess/tools/lesson-check.js — a lesson that can't be solved cannot
   ship. */
(function (root) {
"use strict";

var isNode = (typeof module !== "undefined" && module.exports);
var Chess = isNode ? require("./engine.js") : root.Chess;
var Teach = isNode ? require("./teach.js") : root.Teach;

/* ---------- the course ----------
   chapter: which part of the path
   concept: what is being learned (drives spacing + live fading)
   fen:     the position, always sparse enough to see the idea
   ask:     what you're asked to find (retrieval prompt)
   rule:    how an answer is judged — 'fork' | 'pin' | 'skewer' |
            'mate' | 'win-material' | 'safe' | 'explicit'
   best:    the model answer in SAN (used for the hint and the reveal)
   why:     the elaboration shown on success
   hint:    the opt-in nudge — a question, never the answer
   misses:  specific replies to specific wrong moves
   worked:  demonstrate it once before asking */
var CHAPTERS = [
  { id: "moves",    name: "How the pieces think", blurb: "Not the rules — the *habits*. What each piece is good at, felt on the board." },
  { id: "safety",   name: "Free things & safe things", blurb: "The two questions behind most beginner games: what's undefended, and what am I leaving loose?" },
  { id: "mate",     name: "Finishing", blurb: "Checkmate is a pattern, not an accident. Here are the ones that end most games." },
  { id: "tactics",  name: "Tricks that win material", blurb: "Fork, pin, skewer. Name them once and you'll see them forever." },
  { id: "opening",  name: "Starting well", blurb: "Three habits beat memorising twenty moves." },
  { id: "endgame",  name: "The last few pieces", blurb: "Where pawns become queens and a single square decides everything." }
];

var LESSONS = [
  /* ---------------- how the pieces think ---------------- */
  {
    id: "knight-L", chapter: "moves", concept: "knight", worked: true,
    title: "The knight's crooked step",
    fen: "4k3/8/4p3/8/3N4/8/8/4K3 w - - 0 1", side: 1,
    ask: "Capture the black pawn with your knight.",
    rule: "explicit", best: "Nxe6",
    hint: "Two squares in one direction, then one square across — always landing on the opposite colour to where it started.",
    why: "A knight moves in an L and is the only piece that <b>jumps over</b> anything in the way. That makes it deadliest in crowded positions, where every other piece is stuck behind traffic.",
    misses: {
      "Nf5": "Legal — but that isn't where the pawn is. From d4 the L-shape reaches e6: two up, one across.",
      "Nb5": "Legal, and the wrong direction. Count it out loud: two squares toward the pawn, then one across."
    }
  },
  {
    id: "knight-rim", chapter: "moves", concept: "knight",
    title: "A knight on the rim",
    fen: "4k3/8/8/8/8/8/4PPPP/4K1N1 w - - 0 1", side: 1,
    ask: "Your knight is walled in by its own pawns. Jump it out toward the middle.",
    rule: "explicit", best: "Nf3",
    hint: "Both jumps are legal. Which one lands where the knight can see more squares?",
    why: "From f3 the knight watches <b>eight</b> squares; from h3 it watches four. Same piece, half the power — which is the whole reason players mutter <i>“a knight on the rim is dim.”</i>",
    misses: {
      "Nh3": "That's a real move — but count the squares it now attacks (four) against f3 (eight). The edge halves a knight."
    }
  },
  {
    id: "bishop-diag", chapter: "moves", concept: "bishop",
    title: "The bishop's one colour",
    fen: "4k3/8/5p2/8/8/8/1B6/4K3 w - - 0 1", side: 1,
    ask: "Take the pawn on f6 with your bishop.",
    rule: "explicit", best: "Bxf6",
    hint: "Slide along the diagonal — b2 and f6 stand on the same colour, so a road connects them.",
    why: "A bishop can only ever stand on one colour of square — its whole life. That's why the <b>pair</b> of bishops is prized: together they finally cover everything.",
    misses: {}
  },

  /* ---------------- free things & safe things ---------------- */
  {
    id: "free-queen", chapter: "safety", concept: "hanging", worked: true,
    title: "Take what's free",
    fen: "4k3/8/8/3q4/8/8/6B1/4K3 w - - 0 1", side: 1,
    ask: "Something of theirs costs nothing to take. Take it.",
    rule: "win-material", best: "Bxd5",
    hint: "Follow your bishop's diagonal until it runs into something. Is anyone defending that square?",
    why: "Nobody was guarding the queen, so it came for free. Before anything clever, run the cheapest check in chess: <b>what of theirs is undefended?</b> Most games between beginners are decided by exactly this and nothing else.",
    misses: {}
  },
  {
    id: "dont-hang", chapter: "safety", concept: "hanging",
    title: "Your turn to be careful",
    fen: "r5k1/8/p7/1B6/8/8/8/4K3 w - - 0 1", side: 1,
    ask: "Their pawn attacks your bishop. Move it somewhere it can't be taken.",
    rule: "safe", best: "Bd3",
    hint: "A pawn captures diagonally forward. Which squares does that little pawn actually cover — and what is guarding it?",
    why: "The other half of the same habit: after every move of yours, ask <i>what does that leave hanging?</i> A pawn taking a bishop is the cheapest trade in the game — and the most common way a good position quietly falls apart.",
    misses: {
      "Bxa6": "Count first: their rook on a8 defends that pawn, so you'd win a pawn and lose a bishop — about three pawns' worth. A capture is only free when nothing is guarding the square."
    }
  },
  {
    id: "defend-it", chapter: "safety", concept: "hanging",
    title: "Or defend it instead",
    fen: "4k3/8/8/3r4/8/3N4/8/K4R2 w - - 0 1", side: 1,
    ask: "Their rook attacks your undefended knight. Save it.",
    rule: "safe", best: "Rd1",
    hint: "You could run — but is there a move that makes taking the knight cost them a rook?",
    why: "A piece isn't in danger merely because it's attacked; it's in danger when <b>taking it wins material</b>. Rd1 defends, so a rook-for-knight capture would now lose them material — and your knight keeps the strong central square it already owns.",
    alsoWhy: "That saves the knight, and it counts. Now the subtler point: moving it away gave up a strong central square. <b>Rd1</b> would have defended it instead — the knight stays, and taking it becomes a bad trade for them.",
    misses: {}
  },

  /* ---------------- finishing ---------------- */
  {
    id: "backrank-mate", chapter: "mate", concept: "backRank", worked: true,
    title: "The back rank",
    fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", side: 1,
    ask: "Checkmate in one move.",
    rule: "mate", best: "Ra8#",
    hint: "Their king is walled in by its own pawns. Which square can your rook reach along the empty back row?",
    why: "The king's own pawns seal its escape, so a rook arriving on the back row is the end. This single pattern finishes more club games than every other mate combined — and the cure is just as simple: push one pawn early to give your king air.",
    misses: {
      "Ra7": "Close! That attacks the pawns, but a check has to hit the <b>king</b>. Which rank is the king actually on?"
    }
  },
  {
    id: "queen-support", chapter: "mate", concept: "mate-support",
    title: "The queen needs a friend",
    fen: "6k1/8/6K1/8/8/8/8/Q7 w - - 0 1", side: 1,
    ask: "Checkmate in one.",
    rule: "mate", best: "Qa8#",
    hint: "Your own king already guards f7, g7 and h7. So which row does the queen need to take away?",
    why: "A lone queen can chase a king forever but can't finish alone — the mate happens because your <b>king</b> covers the escape squares while the queen takes the last row. Almost every mate is two pieces cooperating like this.",
    alsoWhy: "That's mate too — and for exactly the same reason: your king guards the square the queen lands on, so it can't be captured, and every escape is covered. Two pieces, working together.",
    misses: {
      "Qa7": "Nearly: that seals the seventh row, but the king is on the eighth and isn't even in check."
    }
  },
  {
    id: "two-rooks", chapter: "mate", concept: "mate-support",
    title: "The staircase",
    fen: "7k/R7/8/8/8/8/8/1R5K w - - 0 1", side: 1,
    ask: "Checkmate in one.",
    rule: "mate", best: "Rb8#",
    hint: "One rook already owns the seventh row. What happens if the other takes the eighth?",
    why: "Two rooks mate by taking rows in turn — one cuts the king off, the other delivers. Learn this staircase and you can finish any game where you've won a couple of rooks.",
    misses: {}
  },

  /* ---------------- tricks that win material ---------------- */
  {
    id: "fork-knight", chapter: "tactics", concept: "fork", worked: true,
    title: "Two at once",
    fen: "r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1", side: 1,
    ask: "Find a knight move that attacks two pieces at the same time.",
    rule: "fork", best: "Nc7+",
    hint: "One square attacks both the corner rook and the king. Knights are the great forkers because nothing they hit can ever block them.",
    why: "That's a <b>fork</b>: one piece, two targets. They only get one move, so whichever they save, you take the other. And because one target is the king, the reply is forced — they don't even get to choose.",
    misses: {
      "Nb6": "Good instinct — that hits the rook. But look for the square that hits the rook <i>and</i> the king at once.",
      "Nf6+": "Check, which is something! But after the king steps aside, what have you actually won?"
    }
  },
  {
    id: "fork-pawn", chapter: "tactics", concept: "fork",
    title: "Even a pawn forks",
    fen: "4k3/8/2n1n3/8/3P4/8/8/4K3 w - - 0 1", side: 1,
    ask: "Push a pawn so that it attacks both black knights at once.",
    rule: "fork", best: "d5",
    hint: "Pawns capture diagonally — one step forward puts both knights on its diagonals, and neither of them can capture the pawn back.",
    why: "The cheapest piece on the board can attack two of the dearest, and they can't both run. Watch for pawn forks: they're the most-missed tactic in beginner chess precisely because a pawn looks harmless.",
    misses: {}
  },
  {
    id: "pin-bishop", chapter: "tactics", concept: "pin", worked: true,
    title: "Freeze it",
    fen: "4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1", side: 1,
    ask: "Put your bishop where the knight cannot legally move away.",
    rule: "pin", best: "Bb5",
    hint: "Line your bishop up so the knight stands directly between it and the king.",
    why: "That's a <b>pin</b>. Moving the knight would leave the king in check, which is illegal — so the knight is frozen to the spot. Now you can attack it again with a pawn or another piece and win it, because it can't run.",
    misses: {
      "Bc4": "A fine developing square — but the knight can still stroll away. Which diagonal puts the king directly behind it?"
    }
  },
  {
    id: "skewer-rook", chapter: "tactics", concept: "skewer",
    title: "A pin, turned around",
    fen: "q7/8/8/k7/8/8/7K/7R w - - 0 1", side: 1,
    ask: "Line your rook up on the king so that the queen behind it falls.",
    rule: "skewer", best: "Ra1+",
    hint: "Which file has the king in front and the queen directly behind it?",
    why: "That's a <b>skewer</b>: the valuable piece is in <i>front</i> and must move out of check, so you take what was hiding behind it. Pin and skewer are the same geometry — the only question is which piece stands in front.",
    misses: {}
  },

  /* ---------------- starting well ---------------- */
  {
    id: "open-develop", chapter: "opening", concept: "development",
    title: "Develop, and ask a question",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", side: 1,
    ask: "Bring out a piece with a move that also attacks something.",
    rule: "explicit", best: "Nf3",
    hint: "Which knight can come out and put a question to the pawn on e5 in the same breath?",
    why: "The best opening moves do two jobs at once. Nf3 develops toward the middle <i>and</i> attacks e5, so your opponent has to answer instead of building their own plan. Tempo is exactly this: making them respond.",
    misses: {
      "Qh5": "It attacks things — but the queen is far too precious to lead with. Every time they develop a piece by attacking her, they gain a move and you lose one.",
      "Bc4": "A genuinely good square, aimed at their weakest point (f7). But there's a move that develops <i>and</i> attacks the e5 pawn — do both when you can.",
      "d3": "Solid, and it frees the bishop. But a knight can come out this move: pieces before quiet pawn moves."
    }
  },
  {
    id: "open-castle", chapter: "opening", concept: "castling",
    title: "Get the king out of the middle",
    fen: "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1", side: 1,
    ask: "Everything is developed on the kingside. Make your king safe.",
    rule: "explicit", best: "O-O",
    hint: "One move puts the king in the corner and brings a rook toward the middle.",
    why: "Castling is the only move where two pieces move at once, and it fixes the two biggest problems at the same time: a king standing in an open centre, and a rook doing nothing in the corner. Castle early — games are lost by the king that stayed home.",
    misses: {
      "d3": "Safe enough, but you had a move that tucks the king away <i>and</i> activates a rook. Do that first; the centre can wait a turn.",
      "Ng5": "Tempting — it eyes f7. But moving the same piece twice in the opening while your king sits in the middle is how attacks arrive on <i>you</i>."
    }
  },

  /* ---------------- the last few pieces ---------------- */
  {
    id: "promote", chapter: "endgame", concept: "promotion", worked: true,
    title: "A pawn's whole dream",
    fen: "8/4P3/8/8/8/8/8/4K2k w - - 0 1", side: 1,
    ask: "Turn the pawn into a queen.",
    rule: "explicit", best: "e8=Q",
    hint: "Step onto the last rank and choose what it becomes.",
    why: "Any pawn reaching the far side becomes any piece you like — nearly always a queen. This is why an extra pawn matters in an endgame even when it looks like nothing: a pawn is a queen that hasn't arrived yet.",
    misses: {}
  },
  {
    id: "promote-safe", chapter: "endgame", concept: "promotion",
    title: "Queen it without a fight",
    fen: "8/1P6/8/8/8/8/1r6/4K2k w - - 0 1", side: 1,
    ask: "Their rook is watching your pawn's path. Promote anyway — and count first.",
    rule: "explicit", best: "b8=Q",
    hint: "If they take the new queen, what does that cost them — and what do you still have?",
    why: "Push it. The rook can capture on b8, but a rook is worth far less than a queen, and the exchange leaves you no worse. Beginners often freeze here; the count says go.",
    misses: {}
  },
  {
    id: "back-rank-cure", chapter: "endgame", concept: "backRank",
    title: "Make some air",
    fen: "r5k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1", side: 1,
    ask: "Your own back rank has no escape square. Spend one move fixing that.",
    rule: "explicit", best: "h3", alsoOk: ["g3"],
    hint: "Give the king a hole to step into — the smallest pawn move will do.",
    why: "One tiny pawn move (called <i>luft</i> — German for “air”) removes a whole category of disaster from the rest of your game. Strong players make this move almost automatically once the queens are gone.",
    alsoWhy: "That works too — any move that gives the king a square to step into does the job. The habit is what matters, not the particular pawn.",
    misses: {
      "f3": "It does make air — but it opens the diagonal toward your own king and takes away the best square for a defending piece. h3 or g3 are the usual choices."
    }
  }
];

/* ---------- judging an answer by its idea ---------- */
function accepts(lesson, g, move) {
  var san = Chess.toSAN(g, move).replace(/[+#]$/, "");
  var bestClean = (lesson.best || "").replace(/[+#]$/, "");
  if (san === bestClean) return { ok: true, best: true };
  if (lesson.alsoOk && lesson.alsoOk.indexOf(san) >= 0) return { ok: true, best: false };

  switch (lesson.rule) {
    case "explicit":
      return { ok: false };
    case "mate": {
      Chess.make(g, move);
      var mated = Chess.inCheck(g) && Chess.moves(g).length === 0;
      Chess.unmake(g);
      return { ok: mated };
    }
    case "fork": {
      var before = Teach.forks(g, g.turn).length;
      Chess.make(g, move);
      var fs = Teach.forks(g, -g.turn);
      Chess.unmake(g);
      var made = fs.filter(function (f) { return f.by === move.to && f.safe; });
      return { ok: made.length > 0 && fs.length > before };
    }
    case "pin": {
      Chess.make(g, move);
      var pins = Teach.lines(g, -g.turn).pins;
      Chess.unmake(g);
      return { ok: pins.some(function (p) { return p.by === move.to; }) };
    }
    case "skewer": {
      Chess.make(g, move);
      var sk = Teach.lines(g, -g.turn).skewers;
      Chess.unmake(g);
      return { ok: sk.some(function (s) { return s.by === move.to; }) };
    }
    case "win-material": {
      if (!move.capt) return { ok: false };
      /* the captured piece had to be genuinely free (or worth more) */
      var gain = Teach.VAL[Math.abs(move.capt)] - Teach.VAL[Math.abs(move.piece)];
      Chess.make(g, move);
      var recapture = Teach.isLoose(g, move.to);
      Chess.unmake(g);
      return { ok: !recapture || gain > 0 };
    }
    case "safe": {
      /* the piece that was in danger is no longer winnable */
      Chess.make(g, move);
      var stillLoose = Teach.isLoose(g, move.to);
      var otherLoose = Teach.looseFor(g, Math.sign(move.piece)).filter(function (l) {
        return Teach.VAL[Math.abs(l.piece)] >= 300;
      });
      Chess.unmake(g);
      return { ok: !stillLoose && otherLoose.length === 0 };
    }
  }
  return { ok: false };
}

/* feedback for a wrong move: the lesson's own words if it has them,
   otherwise let teach.js look at what the move actually allows */
function critique(lesson, g, move) {
  var san = Chess.toSAN(g, move).replace(/[+#]$/, "");
  if (lesson.misses && lesson.misses[san]) return lesson.misses[san];
  var said = Teach.afterMove(g, move);
  for (var i = 0; i < said.length; i++) {
    if (said[i].concept === "hanging" || said[i].concept === "stalemate") return said[i].text;
  }
  var noun = { fork: "a move that attacks two things at once",
               pin: "a line that freezes their piece against the king",
               skewer: "a line with the valuable piece in front",
               mate: "a check they cannot answer",
               "win-material": "a capture that costs you nothing",
               safe: "a square where nothing can take it" }[lesson.rule];
  return "Not quite — that's legal, but it isn't " + (noun || "the idea here") +
    ". Take another look; the position is small enough to see all of it.";
}

/* ---------- progress: spacing, mastery, honesty ---------- */
var KEY = "chessroom_learn";
var DAY = 86400000;

function blank() { return { v: 1, concepts: {}, lessons: {}, streak: 0, lastDay: 0, practised: 0 }; }
function load() {
  try {
    var p = JSON.parse((isNode ? null : localStorage.getItem(KEY)) || "null");
    if (!p || p.v !== 1) return blank();
    return p;
  } catch (e) { return blank(); }
}
function save(p) {
  try { if (!isNode) localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
}

/* SM-2, trimmed to what a chess room needs. Confidence is the learner's
   own call, which keeps the schedule honest rather than flattering. */
function grade(p, lesson, correct, confidence, now) {
  now = now || Date.now();
  var c = p.concepts[lesson.concept] || (p.concepts[lesson.concept] = {
    ease: 2.4, reps: 0, interval: 0, due: now, seen: 0, right: 0
  });
  c.seen++;
  var L = p.lessons[lesson.id] || (p.lessons[lesson.id] = { tries: 0, solved: 0 });
  L.tries++;

  if (correct) {
    c.right++; L.solved++;
    c.reps++;
    var q = confidence === "sure" ? 5 : confidence === "shaky" ? 3 : 4;
    c.ease = Math.max(1.3, c.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    if (c.reps === 1) c.interval = 1;
    else if (c.reps === 2) c.interval = 3;
    else c.interval = Math.round(c.interval * c.ease) || 1;
    if (confidence === "shaky") c.interval = Math.max(1, Math.round(c.interval * 0.5));
  } else {
    c.reps = 0;
    c.interval = 0;                     /* comes back this session */
    c.ease = Math.max(1.3, c.ease - 0.2);
  }
  c.due = now + c.interval * DAY;

  var today = Math.floor(now / DAY);
  if (p.lastDay !== today) {
    p.streak = (p.lastDay === today - 1) ? (p.streak + 1) : 1;
    p.lastDay = today;
  }
  p.practised++;
  return p;
}

/* 0..1 — drives both the progress map and how quiet the live coach goes */
function mastery(p, concept) {
  var c = p.concepts[concept];
  if (!c || !c.reps) return 0;
  var byReps = Math.min(1, c.reps / 4);
  var bySpacing = Math.min(1, c.interval / 14);
  var byAccuracy = c.seen ? c.right / c.seen : 0;
  return Math.max(0, Math.min(1, byReps * 0.4 + bySpacing * 0.35 + byAccuracy * 0.25));
}

/* what to practise now: anything overdue, oldest first, then interleaved
   so two lessons on the same idea never sit back to back */
function due(p, now) {
  now = now || Date.now();
  var list = LESSONS.filter(function (l) {
    var c = p.concepts[l.concept];
    return c && c.reps > 0 && c.due <= now && (p.lessons[l.id] || {}).solved;
  });
  list.sort(function (a, b) {
    return (p.concepts[a.concept].due) - (p.concepts[b.concept].due);
  });
  return interleave(list);
}
function interleave(list) {
  var out = [], pool = list.slice();
  while (pool.length) {
    var i = 0;
    if (out.length) {
      while (i < pool.length && pool[i].concept === out[out.length - 1].concept) i++;
      if (i === pool.length) i = 0;
    }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

/* the next unseen lesson on the path */
function next(p) {
  for (var i = 0; i < LESSONS.length; i++) {
    if (!(p.lessons[LESSONS[i].id] || {}).solved) return LESSONS[i];
  }
  return null;
}

function stats(p) {
  var solved = 0, i;
  for (i = 0; i < LESSONS.length; i++) if ((p.lessons[LESSONS[i].id] || {}).solved) solved++;
  return { solved: solved, total: LESSONS.length, streak: p.streak || 0,
           practised: p.practised || 0, due: due(p).length };
}

function byId(id) {
  for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].id === id) return LESSONS[i];
  return null;
}
function inChapter(id) {
  return LESSONS.filter(function (l) { return l.chapter === id; });
}

var Learn = {
  CHAPTERS: CHAPTERS, LESSONS: LESSONS,
  accepts: accepts, critique: critique,
  load: load, save: save, blank: blank, grade: grade,
  mastery: mastery, due: due, next: next, stats: stats,
  byId: byId, inChapter: inChapter, KEY: KEY
};
if (isNode) module.exports = Learn;
else root.Learn = Learn;
})(typeof self !== "undefined" ? self : this);
