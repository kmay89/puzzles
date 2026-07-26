# The Solving Room

Seven twisty puzzles that scramble and solve themselves in your browser —
a 2×2, 3×3, 4×4, 5×5, a megaminx, a pyraminx and a skewb — with the real mathematics on
display: God's algorithm, Kociemba's two-phase algorithm, a map of every
position, a live statistical engine, a camera scanner, a patient
turn-by-turn teacher, a sequence lab, and an augmented-reality door.

**Live:** <https://kmay89.github.io/puzzles/>

No libraries. No build step. No accounts. Nothing tracked. Raw WebGL and
vanilla JavaScript, MIT licensed.

## What's here

```
index.html    the introduction — what this is, what group theory is,
              how the solving works, what you get out of it
room/         the solving room itself (see room/README.md for the
              architecture: engine, solvers, worker, map, scanner, AR)
chess/        the chess room — chess taught kindly: a full 3D board
              (2D too), a patient coach, opening stories, a tournament
              clock, and nearby two-player over WebRTC with no accounts
              (see chess/README.md)
domino/       the domino table — Mexican dominoes, four seats and two
              parejas: a 3D table, an opponent that counts the bones and
              hears every pass, and four phones joined by holding them
              up to each other (see domino/README.md)
og.png        the social preview
.nojekyll     serve files exactly as they are
```

## Why it's honest

- The **2×2** is solved by breadth-first search over all 3,674,160
  positions — provably optimal, ≤ 11 turns, and the census shown in the
  statistics panel is computed from that table live (it matches the
  published God's-algorithm distribution digit for digit).
- The **3×3** is solved by Kociemba's two-phase algorithm through the
  subgroup G1 = ⟨U, D, R², L², F², B²⟩, with pruning tables built in a
  Web Worker.
- The **big puzzles** solve by the group inverse of their own scramble —
  and the interface says so, because no browser tab holds an optimal
  solver for 10⁴⁵⁺ states.
- No move table is hard-coded anywhere: twists are *discovered* by
  rotating sticker geometry and matching who landed where, and the
  solvers derive their operations through the same geometry.

## Run it locally

Any static file server works (workers and the camera need http(s), not
`file://`):

```
git clone https://github.com/kmay89/puzzles
cd puzzles
python3 -m http.server 8000        # or: npx http-server -p 8000
# open http://localhost:8000/
```

The camera scanner and the AR door additionally want HTTPS when not on
localhost — GitHub Pages provides that.

## Deploying your own

Fork, then Settings → Pages → deploy from branch (`main`, root — or the
`gh-pages` branch, which mirrors it). That's the whole pipeline.

## Provenance

Grown inside [kmay89/ABOUT](https://github.com/kmay89/ABOUT) (the
hand-built kmay89.com), where it lives at
[kmay89.com/cube/](https://kmay89.com/cube/); this repository is its
standalone home. Design tokens are documented at the top of
`room/index.html`'s stylesheet — six colours, two system typefaces,
three rules of motion. Take them.
