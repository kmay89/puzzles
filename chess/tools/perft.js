/* perft.js — proves the move generator is the real rules of chess.
   Counts every legal move sequence to a fixed depth from positions with
   published node counts (chessprogramming.org/Perft_Results). One wrong
   count anywhere — a missed en passant, a castle through check, a bad
   promotion — and these totals cannot match.

   Run: node chess/tools/perft.js          (fast set, pre-merge)
        node chess/tools/perft.js --deep   (adds the big depth-5 counts) */
"use strict";
const Chess = require("../engine.js");

const CASES = [
  { name: "start position", fen: Chess.START_FEN,
    counts: [20, 400, 8902, 197281], deep: [4865609] },
  { name: "kiwipete (castles, pins, ep)",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    counts: [48, 2039, 97862], deep: [4085603] },
  { name: "position 3 (ep discoveries)",
    fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    counts: [14, 191, 2812, 43238], deep: [674624] },
  { name: "position 4 (promotions)",
    fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    counts: [6, 264, 9467], deep: [422333] },
  { name: "position 5 (castle rights)",
    fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    counts: [44, 1486, 62379], deep: [2103487] },
];

const deep = process.argv.includes("--deep");
let failed = 0;
const t0 = Date.now();
for (const c of CASES) {
  const wanted = deep ? c.counts.concat(c.deep) : c.counts;
  for (let d = 1; d <= wanted.length; d++) {
    const g = Chess.create(c.fen);
    const got = Chess.perft(g, d);
    const ok = got === wanted[d - 1];
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"}  ${c.name}  depth ${d}: ${got}${ok ? "" : "  (wanted " + wanted[d - 1] + ")"}`);
  }
}

/* a handful of rule spot-checks beyond raw counts */
function expect(label, cond) {
  if (!cond) failed++;
  console.log(`${cond ? "ok  " : "FAIL"}  ${label}`);
}
{
  const g = Chess.create("7k/8/6Q1/8/8/8/8/K7 b - - 0 1");
  expect("stalemate detected", Chess.status(g).reason === "stalemate");
}
{
  const g = Chess.create("6k1/5ppp/8/8/8/8/8/R6K w - - 0 1");
  Chess.play(g, Chess.fromSAN(g, "Ra8#"));
  const st = Chess.status(g);
  expect("back-rank mate detected", st.reason === "checkmate" && st.result === "white");
}
{
  const g = Chess.create("8/8/8/8/8/5b2/8/K1k5 w - - 0 1");
  expect("K+B vs K is a dead draw", Chess.status(g).reason === "insufficient");
}
{
  const g = Chess.create();
  for (const s of ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]) {
    Chess.play(g, Chess.fromSAN(g, s));
  }
  expect("threefold repetition claimable", Chess.status(g).canClaim3 === true);
}
{
  const g = Chess.create();
  const line = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O"];
  let sans = [];
  for (const s of line) sans.push(Chess.play(g, Chess.fromSAN(g, s)));
  expect("SAN round-trips the Ruy Lopez", sans.join(" ") === line.join(" "));
}

console.log(`\n${failed === 0 ? "all green" : failed + " FAILURE(S)"} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failed ? 1 : 0);
