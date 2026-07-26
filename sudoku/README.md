# ▦ The Sudoku Room

**Sudoku that shows its working.** A free sudoku app that runs entirely
in your browser: puzzles forged in front of you from a blank grid,
nineteen real solving techniques taught from positions that genuinely
arose, a hint button that names and explains rather than tells, and a
promise that every puzzle can be reasoned to the end — never guessed.
No accounts, no ads, no server, nothing tracked. Installable as a PWA;
works offline.

Part of [The Solving Room](../). No libraries, no build step, MIT.

## The promise, and why it is keepable

Every puzzle here has **exactly one answer** and can be **finished by
reasoning alone**. That is not marketing copy — it is a property the
generator enforces and the test suite proves:

- Every clue removed is tested by a brute-force solution count capped at
  two. A second answer and the clue goes straight back.
- Every clue removed is *also* tested against the technique library for
  that band. If the puzzle could no longer be finished by a person using
  nothing harder than the band promises, the clue goes back.
- The band on the label is the **hardest technique the puzzle actually
  needs** — measured by solving it, not estimated from clue counts. A
  grid that comes out easier than you asked for is labelled for what it
  is, not for what you wanted.
- `tools/selftest.js` solves thousands of generated puzzles technique by
  technique and checks **every single elimination against the
  brute-force answer**. If a technique ever ruled out the digit that
  really belonged there, the run fails.

## What's here

```
index.html      markup + all styling (the room's warm dark look, and the
                sheet of paper the puzzle is written on)
core.js         the grid: units, peers, candidate bitmasks, a
                propagating brute-force solver, solution counting,
                random full grids, seeded randomness
strategies.js   nineteen named techniques, from "last in the unit" to
                unique rectangles, each returning an explainable step;
                the logical solver and the difficulty grader
forge.js        making puzzles: a time-sliced job that fills, digs,
                grades and retries — and emits every step as an event so
                The Forge can show the real algorithm working
lessons.js      GENERATED. A real position for every technique, stored
                as a puzzle plus a number of solver steps to replay
badges.js       thirty-two things worth noticing, as one flat table
dojo.js         the codex, mastery states, the difficulty ladder, ranks
app.js          the conductor: the board, input, pencil marks, the hint
                ladder, finishing, persistence, The Forge screen, the
                codex, lessons, the wall, boot
sw.js           offline play and the update whisper
tools/          dev only, never shipped (see below)
```

## The five bands

Each band promises *solvable with nothing harder than this*, and asks
for at least one sighting of its own tier so the name is earned:

| Band | Needs at most | Typically |
|---|---|---|
| Gentle | singles | 25–30 clues, symmetric |
| Steady | pointing, claiming, naked pairs | 24–30 clues, symmetric |
| Tricky | hidden pairs, triples, quads, X-Wing | 22–28 clues, symmetric |
| Devious | simple colouring, Y-Wing, XYZ-Wing | 23–26 clues |
| Diabolical | swordfish, jellyfish, unique rectangles, BUG+1 | 21–26 clues |

Nishio and Ariadne's thread (search) are in the library so the solver is
never stuck on a grid *you* typed in, but **no puzzle the room ships
ever needs them** — the generator refuses to hand one over.

## The nineteen techniques

Last in the unit · naked single · hidden single · pointing pair ·
claiming · naked pair · hidden pair · naked triple · hidden triple ·
naked quad · X-Wing · simple colouring · Y-Wing · XYZ-Wing · swordfish ·
unique rectangle · BUG+1 · jellyfish · Nishio — with Ariadne's thread
(honest search) at the bottom, always labelled as what it is.

Each one is a row in `strategies.js` with a `find()`, an `idea` (the
codex entry), a `hint` (the nudge), a tier and a cost. Adding a
technique means appending a row, not threading an `if` through the app.

## Learning, and what "mastered" means

A technique passes through four states, each earned by doing something
real:

- **unmet** — the codex shows its name and band, nothing else.
- **met** — you read it, or the room used it in a hint. The idea and a
  practice position open up.
- **practised** — you found it yourself in a lesson, without being shown.
- **mastered** — you finished three puzzles that genuinely needed it,
  *unaided*. The room stops explaining it.

Lessons are not diagrams. `tools/make-lessons.js` digs thousands of
puzzles, solves each one step by step, and records the moment a
technique is the simplest thing available — as a puzzle and a number of
steps to replay. The Dojo reconstructs that moment with the same solver
you get hints from, so what it teaches is exactly what the room would
say mid-game.

## Dev tooling (never shipped, never a runtime dependency)

```
tools/selftest.js       geometry, the solver against known puzzles,
                        technique soundness against brute force, the
                        forge's bands and timing, the daily's
                        reproducibility, and every lesson replaying.
                        node sudoku/tools/selftest.js [--deep] [--seed=N]
tools/make-lessons.js   regenerates lessons.js (verifies before writing)
tools/make-icons.js     draws the PNG icons from scratch with zlib
tools/smoke.js          drives the whole room in headless Chromium and
                        fails on any console error
```

Run `node sudoku/tools/selftest.js` before trusting any change to
`core.js`, `strategies.js` or `forge.js`. It is fast (a few seconds) and
it is the difference between a solver that looks right and one that is.

## Run it locally

```
git clone https://github.com/kmay89/puzzles
cd puzzles
python3 -m http.server 8000
# open http://localhost:8000/sudoku/
```

`file://` works too — there is no build step, no worker and no fetch —
you only lose the service worker.

## Design notes

The room is dark and the puzzle is a sheet of paper lying under the
lamp; everything else follows from that. Six colour tokens, two
typefaces that ship with every computer, three rules of motion — the
same system as the rest of the solving room, documented at the top of
`room/index.html`. A slate variant (the puzzle written on the desk
itself) is one switch away in the pause menu.

Nothing leaves the browser. Progress, badges, mastery and the puzzle
cupboard live in `localStorage` and nowhere else; clear your browser
data and it is genuinely gone, because there is nowhere else for it to
be.
