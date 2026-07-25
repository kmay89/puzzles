# The solving room

Seven twisty puzzles that scramble and solve themselves — a 2×2, 3×3, 4×4, 5×5,
a megaminx, a pyraminx and a skewb — with a live map of their state spaces, a statistical
engine, a camera-based cube scanner, and a turn-by-turn teacher. Raw WebGL
and vanilla JavaScript: no libraries, no build step, no trackers. MIT.

Live at <https://kmay89.com/cube/>.

## Architecture

Five files, one direction of dependency:

```
puzzle.js   geometry & permutations (pure math, DOM-free, node-testable)
solver.js   the solving mathematics (pure math, DOM-free, node-testable)
worker.js   Web Worker: builds tables, answers solve/map/walk/stats/check
map.js      the state-space renderer (its own small WebGL universe)
app.js      the room: cube renderer, camera, UI, teach mode
scan.js     the scanning booth: getUserMedia + pixel arithmetic
```

### puzzle.js — puzzles as discovered objects

No move tables are hard-coded. Each puzzle is a set of sticker polygons in
3-space; a twist's permutation is *derived* by rotating one slab of sticker
centres (90° for cubes, 72° for the megaminx) and matching each to the
sticker whose centre it lands on. The megaminx is built from the actual
dodecahedron — pentagon faces clipped by the neighbouring faces' cut
planes into 132 stickers. Cubes 2–5 come from one parameterised builder.

### solver.js — two honest solvers

- **2×2 and Pyraminx — God's algorithm.** Breadth-first search over all 3,674,160
  states (7! permutations × 3⁶ orientations, one corner fixed). Every
  solution is provably optimal; ≤ 11 turns always.
- **3×3 — Kociemba's two-phase.** Phase 1 drives orientation + slice
  coordinates into G1 = ⟨U,D,R²,L²,F²,B²⟩; phase 2 finishes with
  permutation coordinates. Pruning tables (BFS over coordinate pairs)
  give the admissible heuristic for IDA*. Typical solutions ≈ 20 turns.
- **4×4 / 5×5 / megaminx** solve by the group inverse of their own
  scramble word, simplified — labeled honestly in the UI, because no
  optimal solver for 10⁴⁵⁺ states fits in a browser tab.

The solvers' move operations are themselves derived by reading a cubie
state off the stickers after each single move — so the renderer and the
mathematics share one source of truth and cannot disagree.

### The map, the numbers

Every dot on the map is real: the 2×2 cloud is the God table itself
(shell radius = exact distance from home), the 3×3 cloud is the complete
phase-1 coordinate space (radius = proven lower bound to G1) with the G1
corner-permutation space as a nucleus. The numbers panel computes exact
censuses, means and live percentiles from the same tables.

### Testing

Node suites (engine invariants, hundreds of end-to-end solves, worker
endpoints, scanner mapping + classifier) plus Playwright end-to-end runs
in headless Chromium, desktop and mobile. The 2×2 census is asserted
against the published God's-algorithm distribution digit for digit.

## Design

Six colour tokens, two system typefaces, three rules of motion — all
documented at the top of `index.html`'s stylesheet. Steal freely.
