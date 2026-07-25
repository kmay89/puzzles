# ♞ The Chess Room

**Chess, taught kindly.** A free chess app that runs entirely in your
browser — a full 3D board (with a lovely 2D option), a patient coach who
hints and explains, opening stories told plainly, a real tournament
clock, and same-room two-player that links two devices with a pasted or
scanned code. No accounts, no server, no ads, nothing tracked. Installable
as a PWA; works offline; quietly announces new versions.

Part of [The Solving Room](../). No libraries, no build step, MIT.

## What's here

```
index.html          markup + all styling (the room's warm dark look)
app.js              the conductor: game flow, clock, coach, tours,
                    persistence, self-healing boot, input
engine.js           the rules of chess, complete: legal move generation
                    (castling, en passant, underpromotion), mate/stalemate,
                    every draw rule, FEN, SAN, and an alpha-beta search
                    used for hints, blunder whispers, and the practice
                    opponent
book.js             the opening book — famous lines in SAN with
                    plain-language ideas and per-move reasons
gfx3d.js            raw WebGL 1 renderer: lathe-turned pieces (the knight
                    is a lathe bent forward at the neck), orbit camera on
                    springs, sliding/hopping/sinking animations
gfx2d.js            canvas renderer with an original hand-drawn piece set;
                    also the safety net if WebGL is missing or lost
net.js              nearby two-player: serverless WebRTC, invite/reply
                    codes (deflated, QR-scannable), resume-after-drop
sw.js               offline shell + update notifications (bump VERSION
                    on every release)
manifest.webmanifest, icons/
tools/              dev-only, never shipped:
  perft.js          proves the move generator against published perft
                    counts — run before trusting any rules change
  book-check.js     every book line must be legal and in canonical SAN
  make-icons.js     draws the app icons from scratch (analytic raster + 
                    hand-rolled PNG writer)
```

## Why it's honest

- The rules engine is **perft-verified**: its move counts match the
  published node counts for the standard test positions (millions of
  positions deep), so castling-through-check, en-passant pins, and
  underpromotions are provably right. `node chess/tools/perft.js --deep`
- Every opening line in the book is **replayed through the engine** at
  test time; a typo cannot ship. `node chess/tools/book-check.js`
- Nearby play is **serverless**: the invite code *is* the WebRTC offer
  (STUN only for candidate discovery). Your moves travel directly
  between the two devices, and an invite can carry a game-in-progress,
  so a dropped link resumes exactly where it broke.
- **Self-healing** by design: saves are written after every move and
  survive reloads; a corrupt save is quietly retired; if the 3D context
  is lost the same game continues in 2D on the spot; repeated errors
  offer a recovery card instead of a white screen.

## Run it locally

Any static file server (the service worker and camera want http(s)):

```
cd puzzles
python3 -m http.server 8000
# open http://localhost:8000/chess/
```

Before shipping changes: `node chess/tools/perft.js && node chess/tools/book-check.js`,
and bump `VERSION` in `sw.js` so installed players hear about it.
