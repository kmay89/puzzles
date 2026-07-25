/* book.js — the openings, told gently.
   A flat table of famous opening lines in SAN, each with a name, a
   one-sentence idea a beginner can hold onto, and (for the teaching
   mainlines) a why-this-move note per move. The matcher finds the
   deepest line that matches the game so the app can say "you're in
   the Italian Game" and suggest the next book move with its reason.

   Every line is validated against the engine by chess/tools/book-check.js
   — a typo'd move can't ship. No library, no external database. */
(function (root) {
"use strict";

/* seq: the moves in SAN, space-separated (validated by tools/book-check.js)
   name: what the world calls it
   idea: the one thing to understand about it, in plain words
   why:  optional, one short reason per move (aligned with seq) shown as
         each book move is played or suggested */
var LINES = [
  /* ----- 1.e4 e5: the classical open games ----- */
  { seq: "e4", name: "King's Pawn Opening",
    idea: "The most popular first move in history: it stakes a claim in the centre and opens roads for the queen and bishop.",
    why: ["Grabs a share of the centre and frees two pieces at once."] },
  { seq: "e4 e5", name: "Open Game",
    idea: "Both sides claim the centre. Fair, open, and the best classroom in chess.",
    why: [null, "Meets the claim symmetrically — black takes an equal share of the centre."] },
  { seq: "e4 e5 Nf3", name: "King's Knight Opening",
    idea: "Develops a piece and attacks the e5 pawn in the same breath — the model second move.",
    why: [null, null, "Develops toward the centre and threatens the e5 pawn — two jobs, one move."] },
  { seq: "e4 e5 Nf3 Nc6", name: "King's Knight Opening",
    idea: "Black defends e5 by developing — answering a threat with a useful move is the heart of good openings.",
    why: [null, null, null, "Defends e5 with a developing move instead of a passive one."] },
  { seq: "e4 e5 Nf3 Nc6 Bc4", name: "Italian Game",
    idea: "Five hundred years old and still lovely: the bishop eyes f7, the one square only the king defends.",
    why: [null, null, null, null, "Aims the bishop at f7 — the softest square in black's camp."] },
  { seq: "e4 e5 Nf3 Nc6 Bc4 Bc5", name: "Italian Game: Giuoco Piano",
    idea: "'The quiet game.' Both bishops take their best diagonals; development is even and honest.",
    why: [null, null, null, null, null, "Mirrors the idea: the bishop takes its most active diagonal, eyeing f2."] },
  { seq: "e4 e5 Nf3 Nc6 Bc4 Bc5 c3", name: "Giuoco Piano: Main Line",
    idea: "c3 quietly prepares d4 — building a big pawn centre one move at a time.",
    why: [null, null, null, null, null, null, "Prepares d4: a pawn will support a pawn, and the centre grows."] },
  { seq: "e4 e5 Nf3 Nc6 Bc4 Nf6", name: "Italian Game: Two Knights Defence",
    idea: "Black counterattacks e4 immediately rather than defending — sharper than it looks.",
    why: [null, null, null, null, null, "Counterattacks e4 instead of guarding — a punch traded for a punch."] },
  { seq: "e4 e5 Nf3 Nc6 Bb5", name: "Ruy López (Spanish Game)",
    idea: "The royal main road of chess: the bishop pressures the knight that guards e5, asking questions for the next thirty moves.",
    why: [null, null, null, null, "Pins pressure on c6 — the defender of e5 — instead of attacking f7 directly."] },
  { seq: "e4 e5 Nf3 Nc6 Bb5 a6", name: "Ruy López: Morphy Defence",
    idea: "a6 politely asks the bishop a question: take the knight, or step back and keep the tension?",
    why: [null, null, null, null, null, "Puts the question to the bishop — commit or retreat?"] },
  { seq: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O", name: "Ruy López: Closed",
    idea: "Both sides finish developing before the storm. Castling early is the move that never loses games.",
    why: [null, null, null, null, null, null, "Keeps the pressure — the bishop still watches c6 from a4.",
      "Develops and hits e4.", "The king tucks into safety before anything opens up."] },
  { seq: "e4 e5 Nf3 Nc6 d4", name: "Scotch Game",
    idea: "Opens the centre right now instead of building slowly — trades quiet pressure for open lines.",
    why: [null, null, null, null, "Breaks the centre open immediately — pieces will fly out on both sides."] },
  { seq: "e4 e5 Nc3", name: "Vienna Game",
    idea: "A patient cousin of the King's Knight: guard e4 first, keep the f-pawn free to advance later.",
    why: [null, null, "Guards e4 and keeps options open — sometimes f4 comes next, like a delayed King's Gambit."] },
  { seq: "e4 e5 f4", name: "King's Gambit",
    idea: "The romantic era in one move: white offers a pawn to rip open the f-file and attack. Risky, thrilling, instructive.",
    why: [null, null, "Offers a pawn to drag black's e-pawn off the centre and open the f-file toward the king."] },
  { seq: "e4 e5 Nf3 Nf6", name: "Petrov's Defence",
    idea: "Black ignores the threat and counterattacks symmetrically. Solid, a little quiet, very hard to crack.",
    why: [null, null, null, "Answers a threat with a threat — if you take my pawn, I take yours."] },

  /* the trap every beginner must meet once — and learn to calmly refuse */
  { seq: "e4 e5 Qh5", name: "Scholar's Mate attempt",
    idea: "The four-move-mate try. It loses time if black stays calm: Nc6, then g6 hits the queen, and white's early queen gets chased around the board.",
    why: [null, null, "This threatens Qxf7#, but bringing the queen out this early breaks a golden rule — watch how black gains time attacking her."] },
  { seq: "e4 e5 Qh5 Nc6", name: "Scholar's Mate: refuted calmly",
    idea: "Defend, develop, don't panic. Nc6 guards e5; if Bc4 next, g6 pushes the queen away with gain of time.",
    why: [null, null, null, "Defends e5 and develops. The mate threat on f7 is answered next move by g6 — calm beats fear."] },

  /* ----- answers to 1.e4 with counterattack ----- */
  { seq: "e4 c5", name: "Sicilian Defence",
    idea: "The world's favourite fight: black refuses the mirror and stakes the centre from the side. Unbalanced on purpose.",
    why: [null, "Fights for d4 from the wing — black wants an unbalanced game with winning chances, not symmetry."] },
  { seq: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", name: "Sicilian: Najdorf",
    idea: "The sharpest famous line in chess. a6 looks tiny; it takes b5 away from white's pieces and prepares ...e5 or ...b5." },
  { seq: "e4 c6", name: "Caro-Kann Defence",
    idea: "Solid as oak: c6 prepares d5 so the light-squared bishop can get out before the pawn chain locks it in.",
    why: [null, "Prepares ...d5 to challenge the centre — and unlike the French, the c8 bishop won't be shut in."] },
  { seq: "e4 e6", name: "French Defence",
    idea: "Black lets white have the centre for a moment, then strikes back at it with d5. Sturdy, with one famous problem: the c8 bishop.",
    why: [null, "Prepares ...d5 — black will challenge the centre with a supported pawn instead of a piece."] },
  { seq: "e4 d5", name: "Scandinavian Defence",
    idea: "The most direct answer in chess: challenge e4 on move one. Simple plans, honest positions — a fine first defence.",
    why: [null, "Challenges the centre immediately — no theory required, just development with purpose."] },
  { seq: "e4 d6", name: "Pirc Defence",
    idea: "Black lets white build a big centre, then chips at it with pieces from a fianchetto. Patience required." },

  /* ----- 1.d4 ----- */
  { seq: "d4", name: "Queen's Pawn Opening",
    idea: "The other great first move: the same central claim, already defended by the queen.",
    why: ["Claims the centre like e4 — but this pawn arrives protected."] },
  { seq: "d4 d5", name: "Closed Game",
    idea: "Symmetry again, but slower burning: the centre tends to lock, and plans matter more than tricks." },
  { seq: "d4 d5 c4", name: "Queen's Gambit",
    idea: "Not really a gambit: white offers the c-pawn to lure black's d-pawn off the centre. Taking it is fine; keeping it is not.",
    why: [null, null, "Offers a wing pawn to buy the centre — if black takes, white plays e4 and owns the middle."] },
  { seq: "d4 d5 c4 e6", name: "Queen's Gambit Declined",
    idea: "The classical choice: hold d5, finish developing, ask nothing and give nothing. Careers have been built on it.",
    why: [null, null, null, "Politely declines: d5 stays supported, and the kingside pieces come out first."] },
  { seq: "d4 d5 c4 c6", name: "Slav Defence",
    idea: "Declines the gambit while keeping the c8 bishop's diagonal open — fixing the QGD's one regret.",
    why: [null, null, null, "Supports d5 with the other pawn, so the light-squared bishop keeps its freedom."] },
  { seq: "d4 d5 c4 dxc4", name: "Queen's Gambit Accepted",
    idea: "Taking is honest — but don't try to keep the pawn. Give it back for fast development and equality.",
    why: [null, null, null, "Accepts the offer. The plan is not to guard this pawn — it's to develop fast while white regains it."] },
  { seq: "d4 Nf6", name: "Indian Defence",
    idea: "Black develops first and decides about the centre later — the modern way.",
    why: [null, "Controls e4 with a piece before committing any centre pawn — flexibility first."] },
  { seq: "d4 Nf6 c4 e6 Nc3 Bb4", name: "Nimzo-Indian Defence",
    idea: "The pin on c3 fights for e4 without ever putting a pawn there. One of the deepest ideas ever found on a chessboard." },
  { seq: "d4 Nf6 c4 g6 Nc3 Bg7", name: "King's Indian Defence",
    idea: "Black hands white the centre, castles snugly behind the fianchetto — then storms back with ...e5 and a kingside avalanche." },
  { seq: "d4 d5 Nf3 Nf6 Bf4", name: "London System",
    idea: "The same sturdy setup against nearly anything: bishop out before the pawn chain closes, then build. Beloved by busy people.",
    why: [null, null, null, null, "The point of the London: this bishop gets out *before* e3 would lock it in."] },
  { seq: "d4 f5", name: "Dutch Defence",
    idea: "Black grabs kingside space on move one and aims everything at white's king. Bold, loosening, fun." },

  /* ----- flank openings ----- */
  { seq: "c4", name: "English Opening",
    idea: "The centre, approached sideways: c4 controls d5 without offering a target.",
    why: ["Fights for d5 from the flank — the centre can be claimed later, on better terms."] },
  { seq: "Nf3", name: "Réti Opening",
    idea: "Develop first, decide later. The knight watches the centre while white keeps every plan available.",
    why: ["The most flexible first move — develops, controls e5 and d4, commits to nothing."] },
  { seq: "Nf3 d5 c4", name: "Réti: Main Line",
    idea: "White invites black to hold a centre that white will undermine from both wings." },
];

/* the timeless principles, surfaced one at a time while the opening is young */
var PRINCIPLES = [
  "Try to control the centre — pieces standing there reach the whole board.",
  "Develop knights and bishops before moving the same piece twice.",
  "Castle early. An open king loses games that were otherwise won.",
  "Don't bring the queen out too soon — she becomes a target, and dodging costs moves.",
  "Connect your rooks: when nothing stands between them, development is done.",
  "A pawn move can never be taken back — every one loosens something.",
  "Answer a threat with a move that also does something useful, if you can."
];

function split(seq) { return seq.split(" "); }

/* deepest line whose moves are a prefix of the played SANs */
function match(sans) {
  var best = null, i, ms;
  for (i = 0; i < LINES.length; i++) {
    ms = split(LINES[i].seq);
    if (ms.length > sans.length) continue;
    var ok = true;
    for (var j = 0; j < ms.length; j++) if (ms[j] !== sans[j]) { ok = false; break; }
    if (ok && (!best || ms.length > split(best.seq).length)) best = LINES[i];
  }
  return best;
}

/* book continuations: every distinct next move from lines that extend the
   played sequence, with the deepest/most specific line's name and reason */
function suggest(sans) {
  var out = [], seen = {}, i;
  for (i = 0; i < LINES.length; i++) {
    var ms = split(LINES[i].seq);
    if (ms.length <= sans.length) continue;
    var ok = true;
    for (var j = 0; j < sans.length; j++) if (ms[j] !== sans[j]) { ok = false; break; }
    if (!ok) continue;
    var next = ms[sans.length];
    var why = (LINES[i].why && LINES[i].why[sans.length]) || null;
    if (seen[next] === undefined) {
      seen[next] = out.length;
      out.push({ san: next, name: LINES[i].name, idea: LINES[i].idea, why: why });
    } else if (why && !out[seen[next]].why) {
      out[seen[next]].why = why;
      out[seen[next]].name = LINES[i].name;
    }
  }
  return out;
}

function principle(n) { return PRINCIPLES[n % PRINCIPLES.length]; }

var Book = { LINES: LINES, PRINCIPLES: PRINCIPLES, match: match, suggest: suggest, principle: principle };
if (typeof module !== "undefined" && module.exports) module.exports = Book;
else root.Book = Book;
})(typeof self !== "undefined" ? self : this);
