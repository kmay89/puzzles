/* teach-check.js — the teaching eyes must actually see.
   Hand-built positions where the right answer is obvious to a human,
   checked against teach.js. If naming a pattern is going to be the
   app's main teaching device, the naming has to be right.
   Run: node chess/tools/teach-check.js */
"use strict";
const Chess = require("../engine.js");
const Teach = require("../teach.js");

let failed = 0;
function ok(label, cond, extra) {
  if (!cond) { failed++; console.log("FAIL  " + label + (extra ? "  → " + extra : "")); }
  else console.log("ok    " + label);
}
function G(fen) { return Chess.create(fen); }

/* ---- forks ---- */
{
  const g = G("r3k3/2N5/8/8/8/8/8/4K3 w - - 0 1");   // Nc7 hits Ra8 and Ke8
  const f = Teach.forks(g, Chess.WHITE);
  ok("knight fork of king and rook is seen", f.length === 1 && f[0].victims.length === 2);
  ok("fork is flagged as check", f.length === 1 && f[0].check === true);
  ok("safe fork is flagged safe", f.length === 1 && f[0].safe === true);
}
{
  const g = G("4k3/8/8/8/8/8/8/4K2R w - - 0 1");     // lone rook, nothing to fork
  ok("no fork claimed when there isn't one", Teach.forks(g, Chess.WHITE).length === 0);
}

/* ---- pins ---- */
{
  const g = G("4k3/8/2n5/1B6/8/8/8/4K3 w - - 0 1");  // Bb5 pins Nc6 to Ke8
  const L = Teach.lines(g, Chess.WHITE);
  ok("bishop pin against the king is seen", L.pins.length === 1);
  ok("pin against the king is absolute", L.pins.length === 1 && L.pins[0].absolute === true);
  ok("pinned piece identified as the knight",
     L.pins.length === 1 && Chess.sqName(L.pins[0].front) === "c6");
}
{
  const g = G("4k3/8/8/8/8/8/4r3/4K2R w - - 0 1");   // nothing behind the rook
  ok("no phantom pin", Teach.lines(g, Chess.WHITE).pins.length === 0);
}

/* ---- skewers ---- */
{
  const g = G("4q3/8/8/4k3/8/8/8/K3R3 b - - 0 1");   // Re1: king in front, queen behind
  const L = Teach.lines(g, Chess.WHITE);
  ok("skewer (king in front, queen behind) is seen", L.skewers.length === 1);
  ok("skewer is not miscalled a pin", L.pins.length === 0);
}

/* ---- hanging pieces ---- */
{
  const g = G("4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1");  // pawn d4 attacks undefended Ne5
  ok("undefended knight attacked by a pawn is loose", Teach.isLoose(g, Chess.sqIndex("e5")));
  const loose = Teach.looseFor(g, Chess.BLACK);
  ok("looseFor lists it", loose.length === 1 && Chess.sqName(loose[0].sq) === "e5");
}
{
  const g = G("4k3/8/5p2/4n3/3P4/8/8/4K3 w - - 0 1"); // now the knight is defended by f6
  ok("defended knight attacked by an equal-or-cheaper... pawn still loses material",
     Teach.isLoose(g, Chess.sqIndex("e5")) === true);   // pawn (100) < knight (320): still winning
}
{
  const g = G("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
  ok("bare kings hang nothing", Teach.looseFor(g, Chess.BLACK).length === 0);
}

/* ---- back rank ---- */
{
  const g = G("r6k/6pp/8/8/8/8/5PPP/6K1 w - - 0 1");
  ok("sealed white king on the back rank is flagged", !!Teach.backRank(g, Chess.WHITE));
  ok("black king with luft is not flagged", !Teach.backRank(g, Chess.BLACK));
}
{
  const g = G("6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1"); // no heavy pieces left
  ok("no back-rank scare without a rook or queen", !Teach.backRank(g, Chess.WHITE));
}

/* ---- mate in one ---- */
{
  const g = G("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");
  const m = Teach.mateInOne(g);
  ok("finds the back-rank mate", m && Chess.toSAN(g, m) === "Ra8#", m ? Chess.toSAN(g, m) : "none");
}
{
  const g = Chess.create();
  ok("no mate in one from the starting position", Teach.mateInOne(g) === null);
}

/* ---- afterMove: the live teaching moments ---- */
{
  const g = G("r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1");   // Nc7+ forks king and rook
  const m = Chess.fromSAN(g, "Nc7+");
  const said = Teach.afterMove(g, m);
  ok("afterMove names the fork", said.length && said[0].concept === "fork",
     said.map((s) => s.concept).join(","));
  ok("afterMove left the position untouched", Chess.fen(g) === "r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1");
}
{
  const g = G("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");
  const said = Teach.afterMove(g, Chess.fromSAN(g, "Ra8#"));
  ok("afterMove names checkmate", said.length && said[0].concept === "checkmate");
}
{
  const g = G("7k/8/8/8/8/8/8/K5Q1 w - - 0 1");      // Qg6 takes every square away
  const said = Teach.afterMove(g, Chess.fromSAN(g, "Qg6"));
  ok("afterMove warns about stalemate", said.length && said[0].concept === "stalemate",
     said.map((s) => s.concept).join(","));
}
{
  const g = G("4k3/8/8/8/8/8/4B3/4K3 w - - 0 1");    // Bb5 walks into nothing; safe move
  const said = Teach.afterMove(g, Chess.fromSAN(g, "Bb5+"));
  ok("a plain check is named", said.some((s) => s.concept === "check"));
}
{
  // the bishop steps onto an open file where the rook takes it for free
  const g = G("3r3k/8/8/8/8/8/8/4KB2 w - - 0 1");
  const said = Teach.afterMove(g, Chess.fromSAN(g, "Bd3"));
  ok("hanging a piece is called out", said.some((s) => s.concept === "hanging"),
     said.map((s) => s.concept).join(","));
}
{
  const g = Chess.create();
  const said = Teach.afterMove(g, Chess.fromSAN(g, "e4"));
  ok("a centre pawn is praised for the right reason", said.some((s) => s.concept === "centre"));
}
{
  const g = G("rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1");
  const said = Teach.afterMove(g, Chess.fromSAN(g, "O-O"));
  ok("castling is explained", said.some((s) => s.concept === "castling"));
}

/* ---- opportunities & warnings ---- */
{
  const g = G("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1");
  const ops = Teach.opportunities(g, Chess.WHITE);
  ok("opportunities leads with the mate", ops.length && ops[0].concept === "checkmate");
}
{
  const g = G("r6k/6pp/8/8/8/8/5PPP/6K1 w - - 0 1");
  ok("warnings mention our own airless back rank",
     Teach.warnings(g, Chess.WHITE).some((w) => w.concept === "backRank"));
}

console.log(failed ? `\n${failed} FAILURE(S)` : "\nteaching eyes: all clear");
process.exit(failed ? 1 : 0);
