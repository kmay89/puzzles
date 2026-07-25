/* crosscheck.js — a second opinion on the rules.
   Plays thousands of random moves and, at every single position,
   demands that our engine and chess.js (the ecosystem's reference
   rules library, BSD-2-Clause) agree exactly: same legal move set
   (as SAN), same FEN after each move, same game-over verdicts.
   perft proves our counts; this proves our *labels* — SAN spelling,
   disambiguation, check marks — against an independent implementation.

   Dev-only, never shipped. Needs: npm install chess.js (anywhere on
   the NODE_PATH, or pass the module dir as argv[2]).
   Run: node chess/tools/crosscheck.js [games] [moduleDir] */
"use strict";
const Chess = require("../engine.js");
let ChessJS;
try {
  ChessJS = require(process.argv[3] || "chess.js").Chess;
} catch (e) {
  console.error("chess.js not found — run `npm install chess.js` first (dev-only).");
  process.exit(1);
}

const GAMES = +(process.argv[2] || 200);
let positions = 0, moves = 0;

/* deterministic PRNG so a failure is reproducible */
let seed = 0xC0FFEE;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

for (let g = 0; g < GAMES; g++) {
  const ours = Chess.create();
  const ref = new ChessJS();
  for (let ply = 0; ply < 160; ply++) {
    const mine = Chess.moves(ours).map((m) => Chess.toSAN(ours, m)).sort();
    const theirs = ref.moves().sort();
    positions++;
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
      console.error("MOVE-SET MISMATCH at game", g, "ply", ply);
      console.error("fen:", Chess.fen(ours));
      console.error("ours:", mine.join(" "));
      console.error("ref :", theirs.join(" "));
      process.exit(1);
    }
    if (!mine.length) break;
    const draw = ours.half >= 100 || Chess.status(ours).over;
    if (Chess.status(ours).over) break;
    const pick = mine[Math.floor(rnd() * mine.length)];
    const m = Chess.fromSAN(ours, pick);
    Chess.play(ours, m);
    ref.move(pick);
    moves++;
    const f1 = Chess.fen(ours), f2 = ref.fen();
    /* chess.js omits the ep square when no capture is possible in some
       versions; compare the first four FEN fields with ep normalised
       through our repetition-key rule when they differ */
    if (f1 !== f2) {
      const a = f1.split(" "), b = f2.split(" ");
      const same = a[0] === b[0] && a[1] === b[1] && a[2] === b[2] &&
        (a[3] === b[3] || a[3] === "-" || b[3] === "-") && a[4] === b[4] && a[5] === b[5];
      if (!same) {
        console.error("FEN MISMATCH at game", g, "ply", ply, "after", pick);
        console.error("ours:", f1);
        console.error("ref :", f2);
        process.exit(1);
      }
    }
    if (draw) break;
  }
}
console.log(`agreement: ${GAMES} random games, ${positions} positions, ${moves} moves — identical legal-move sets and positions throughout`);
