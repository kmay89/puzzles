# 🁫 The Domino Table

**Dominó, the way it is actually played.** Four seats, your partner
across from you, seven bones each and nothing in the boneyard. A real 3D
table (with a flat one that is not a consolation prize), an opponent who
counts what is left and remembers every *paso*, a coach who explains
what he can see and admits when he cannot, and four phones joined by
holding them up to each other.

No accounts, no server, no ads, nothing tracked. Installable, works on a
bus. Part of [The Solving Room](../). No libraries, no build step, MIT.

## The game

The partnership block game: a double-six set, four players, two
**parejas** sitting opposite their partner. 4 × 7 is exactly 28, so the
pile is empty by design — and that emptiness is the whole game. Nothing
is drawn and nothing is held back, so every bone you cannot see is in
somebody's hand, and you are allowed to work out whose.

The vocabulary is the table's, not a translator's: *la mula de seis*
opens the first hand, *paso* when you cannot play, *tranca* when the
game shuts, *capicúa* when you go out on a bone that would have fitted
either end, *zapatero* when the other side never scored at all.

Every house rule that tables actually argue about is a setting —
what a capicúa pays, whether the winner counts their partner's bones,
who takes a tied tranca, what you play to. The defaults are the common
Mexican cantina set.

**The table has a rhythm**, and that is a setting too. Three machines
deciding as fast as a machine can decide is not a game you can follow:
bones appear and you are left working out backwards who put them there.
So a turn is three beats rather than one pause — the seat whose turn it
is says it is thinking, the bone lands, and there is a moment to look at
it before the next player starts. *Relaxed* is the default; *Brisk* is a
table in a hurry, *Quick* is for when you just want the hand over.

**The table is lit like a table**, which took three lights rather than
one. A single bulb overhead makes every top face the same white and
every side the same dead grey, and a bone with a grey side stops looking
like the same ivory as its top — so it reads as a card lying on a
photograph. There is a warm key from over the far shoulder, a cool fill
from behind you, and the felt's own brown bouncing back up: a side then
darkens *towards the colour of the cloth* instead of towards grey, which
is what it does on a real table. The bulb hangs off to one side so the
shadows fall towards you where you can see them, the pips are drilled
holes shaded across their bores rather than printed dots, and the bevel
is mitred at the corners so the silhouette closes.

No spinner and no branching. The line has two ends and only ever two
ends; doubles lie crosswise because that is how they lie, not because
they open a third road. Branching belongs to the five-up family — a
different game with a different heart.

## What's here

```
index.html    markup + all styling (the cantina look)
app.js        the conductor: game flow, the tray, the settings panes,
              the join door, persistence, the frame loop
rules.js      the rules, complete and pure: legal moves, la salida,
              paso, tranca, capicúa, the count, the match, and the
              public view a seat is entitled to
layout.js     where the bones lie: the serpentine that folds when the
              line runs out of table, worked out rather than fudged;
              also the hand along the bottom, shared by both renderers
ai.js         the three at the table: a belief matrix over the unseen
              bones, void-tracking from every pass, partner-aware
              heuristics, and determinized rollouts for the hard tiers
coach.js      Don Chuy — turns the AI's own recorded reasons into
              sentences, and never says "they passed" about something
              nobody heard
skins.js      the look as data: eight tables, seven materials, six
              patterns, share codes, and hostile-input guards
gfx3d.js      raw WebGL 1: chamfered bones, a generated pip atlas, one
              warm bulb, an orbit camera that frames the whole line
gfx2d.js      the canvas twin — the safety net, the small-phone option,
              and the painter of the hand in *both* modes
room.js       the shared front door: four-letter room codes over the
              site's mailbox, the link heartbeat, the healing loop.
              Byte-identical in every game folder here
net.js        four seats over WebRTC: a star with the host at the
              middle, and per-seat views so hands stay secret. Sitting
              down is four letters; a chair that drops comes back to
              the same seat, because a seat is remembered by name
sw.js         offline shell + update notice (bump VERSION on release)
manifest.webmanifest, icons/
tools/        dev-only, never shipped — see below
```

## Three things worth explaining

**The hand is drawn in 2D even in 3D.** The table is WebGL; the seven
bones along the bottom are drawn by `gfx2d.js` onto a transparent canvas
over the top. That is not a shortcut. It keeps the bones you are about
to tap crisp at any pixel ratio, which a perspective camera cannot
promise, and it means the tap target is *identical* in both renderers —
same geometry, same hit test, one code path. It also halves what the 3D
path has to do.

**Hands are secret, and that is a networking problem.** HIVEMIND
broadcasts one shared colony to everybody; the chess room's two players
can both see the whole board. Neither survives contact with dominoes,
where the entire game is that you cannot see the other three hands. A
single shared snapshot would put all four hands on every phone at the
table — not visible in the interface, but sitting in the message log of
every device, readable by anyone who opened a console.

So the host never broadcasts the game. It sends **each seat its own
view**, built by the same `publicView` the AI reasons from. The other
three hands never leave the host, so there is nothing on the wire to
find. `tools/net-check.js` proves it the strong way: it rearranges the
hidden hands among themselves and requires the message to come back
byte-identical. If it changes, it encodes the split; if it never
changes, it cannot.

**The coach only says what it actually knows.** The hint you are shown
is the reason the machine chose the move — `ai.js` records why it liked
a play, as tags, *while* it is deciding, and `coach.js` turns those tags
into sentences. Nothing is written after the fact.

That distinction has teeth. "Beto passed on fives" is something the
table heard; "Beto is probably out of fives" is something we worked out
from counting. The first version said the former whenever it meant the
latter — fluent, believable, and false 186 times in 2,808 hints. The
check now reads the sentences rather than the internals: any hint
containing the word *passed* must be backed by a pass in the record.

## Why it's honest

- **The rules are proved, not asserted.** `rules-check.js` replays
  thousands of hands and rebuilds the line from the move log
  independently of the engine's own bookkeeping — so if the open ends
  ever drifted from the bones actually on the table, it fails. It also
  checks that nobody ever passes holding a playable bone, that the
  twenty-eight are conserved every ply, and that the count is right
  every time.
- **The table cannot draw on top of itself.** The fold is the part that
  goes wrong, and it did: at a row spacing of 2, the first crosswise
  double laid after a corner landed on the corner bone, in about one
  long game in three. The spacing is now derived rather than chosen —
  see `ROW` — and 4,000 games at four different screen shapes produce
  zero overlaps and zero bones that move once they are down.
- **The players are measured against each other.** A strength ladder is
  the only honest test of a game AI: Compadre takes ~93% of matches off
  Novato, Maestro ~72% off Compadre, over 100 matches a rung with the
  seats swapped every other match and a two-standard-error bar.
- **And the rollouts are measured too.** The same player against itself
  with the search as the only difference: worth 63%. That check exists
  because the first version of the playout policy was mostly noise, and
  600 rollouts scored no better than 220 — the signature of a search
  with nothing to search with. A policy that goes blind again shows up
  there as a flat 50%, whatever the sample count.
- **A bone is checked for being a solid object.** `bone-check.js` walks
  the mesh in node — no WebGL involved — and checks each quad's corner
  order against its own normal: walking the corners must wind
  anticlockwise seen from the side the normal points. All eight side and
  chamfer quads were wound backwards, so back-face culling threw away
  exactly the faces meant to be seen and kept the ones meant to be
  hidden. From directly above a bone still looked like a bone; from the
  table's angle you saw *through* its edges into the far inner wall, as
  grey wedges hanging off both ends at once. Both ends is the tell —
  impossible for a solid box under any light, so the fault had to be
  winding rather than shading.
- **And for being closed.** The same file adds up (b−a)×(c−a) over every
  triangle: a surface with no holes sums to exactly zero, and a hole
  leaves twice its own vector area behind. The chamfers used to stop
  short of the bone's corners, so adjacent cuts met at a point with an
  open triangle between them — invisible at a hairline bevel, four
  notches with the felt showing through once the bevel was wide enough
  to see. Pairing up edges would be the obvious test and it is the wrong
  one here: the top face is deliberately two quads so each half can
  carry its own pips, and the resulting T-junctions are legitimate.
  Vector area does not care how a face is subdivided.
- **And for looking like one.** All of the above can pass while the
  table still renders as flat white cards, which is what it did: the
  browser check's "is there more than one colour on the canvas" is
  satisfied by a sticker. The honest test projects two points per bone
  through the very matrices the frame was drawn with — the centre of the
  top face, and the midpoint of whichever wall most faces the camera —
  and compares those two pixels. A real bone's near wall reads about
  three-quarters of its own face. A shader flattened so every surface
  takes the top face's light cannot get below 1.2, because then the
  bevel catches *more* light than the face does. Only the bone nearest
  the camera is measured, because that is the one nothing can be
  standing in front of; measuring all of them made the check pass or
  fail with the shuffle.
- **The room is opened and played by a real browser.** `room-check.js`
  drives headless Chromium through the first two minutes — start a
  match, tap a bone, take a hint, change the colours, switch renderers,
  open the join door — and fails on any console error. It found two
  things nothing in node could: a canvas cannot hand out both a WebGL
  and a 2D context, so switching to the flat table silently froze it;
  and a 7 × 128 pip atlas is not a power of two, so WebGL 1 quietly
  refused to build its mipmaps and every bone on the table rendered as a
  black slab. The second one took a *screenshot* to catch, because a
  black bone on brown felt still passes "is there more than one colour".

## Run it locally

Any static file server (the service worker wants http(s)):

```
cd puzzles
python3 -m http.server 8000
# open http://localhost:8000/domino/
```

Before shipping changes, run the lot — about a minute:

```
node domino/tools/check-all.js
```

or one at a time:

```
node domino/tools/rules-check.js     # the rules, and the line rebuilt from the log
node domino/tools/layout-check.js    # no overlaps, nothing moves, the hand stays tappable
node domino/tools/bone-check.js      # the 3D bone is a solid, and wound the right way out
node domino/tools/skin-check.js      # presets, share codes, hostile input
node domino/tools/net-check.js       # the permutation test: hands stay secret
node domino/tools/coach-check.js     # every hint names its move and tells the truth
node domino/tools/ai-check.js        # the strength ladder (the slow one)
node domino/tools/room-check.js      # opens it in a browser and plays it
node domino/tools/make-icons.js      # redraws the icons from scratch
```

`room-check.js` needs `playwright-core` (`npm i --no-save
playwright-core`); the browser is already on most machines that have
Playwright installed. Without it the check says so and exits 0, so it is
a bonus rather than a barrier. Nothing it installs is ever shipped —
the room itself has no dependencies at all.

…and bump `VERSION` in `sw.js` so installed players hear about it.

## Credit where it is due

The QR encoder is a port of the public-domain
[qrcodegen](https://www.nayuki.io/page/qr-code-generator-library)
algorithm (Project Nayuki), by way of HIVEMIND and the chess room. The
WebRTC handshake — short codes, non-trickle ICE, deflated payloads — is
carried over from the same place, widened here from two chairs to four.
