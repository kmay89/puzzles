/* lines.js — the racing line.

   A racing driver's line is one curve that contains a whole paragraph:
   brake here, turn in there, the apex is that point, and everything
   after it is exit speed. Nobody writes that down mid-corner. They see
   the line.

   Chess has the same problem — "your bishop, along this diagonal, is
   the reason their knight can't move" — and the same solution. So this
   module turns a handful of chess facts into a small grammar of curves
   that both renderers can draw, and the meaning lives in the shape:

     RUN     the line your best move takes. Thick where the piece is,
             tapering to a point where it lands, because that is the
             direction the idea travels.
     THREAT  the enemy's line into your position, drawn the same way but
             coming *at* you. A threat and a plan look different at a
             glance because one points out and one points in.
     LANE    a pawn's road to promotion — a long, straight, wide-open
             lane. It reads as distance, which is what a passed pawn is.
     NET     the cage around a king: not a line at all, but a set of
             squares. Drawn as marks rather than curves, because a net
             is a *place*, not a direction.

   Every curve carries a bright spark that travels along it, so the eye
   is pulled the way the idea moves. Motion is the cheapest teaching
   there is: you cannot help but follow it.

   Pure geometry — no DOM, no GL, no canvas. Both renderers ask for the
   same points and draw them their own way, so a line means exactly the
   same thing in 2D and in 3D. */
(function (root) {
"use strict";

/* ---------- the curve ----------
   A knight's move is bent (it goes over things), everything else is
   drawn with a gentle lift so it reads as a path rather than a ruler
   line. The bend is always to the same side so two lines between the
   same squares never sit on top of each other. */
function curve(from, to, bend, steps) {
  steps = steps || 24;
  var dx = to.x - from.x, dy = to.y - from.y;
  var len = Math.hypot(dx, dy) || 1;
  /* the control point sits off to one side of the midpoint */
  var mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
  var nx = -dy / len, ny = dx / len;
  var lift = (bend || 0) * len;
  var cx = mx + nx * lift, cy = my + ny * lift;
  var pts = [];
  for (var i = 0; i <= steps; i++) {
    var t = i / steps, u = 1 - t;
    pts.push({
      x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
      y: u * u * from.y + 2 * u * t * cy + t * t * to.y
    });
  }
  return pts;
}

/* how much a line should bend, by what kind of move it is */
function bendFor(kind, knight) {
  if (knight) return 0.22;          /* knights arc over the traffic */
  if (kind === "lane") return 0;    /* a promotion lane is dead straight */
  return 0.07;                      /* everything else lifts just enough */
}

/* ---------- the ribbon ----------
   Turn a centre-line into a filled outline that starts wide and ends in
   a point. Returned as a flat polygon so canvas can fill it and GL can
   triangulate it without either knowing about the other. */
function ribbon(pts, w0, w1, headLen, headW) {
  var n = pts.length, left = [], right = [], i;
  /* the last stretch is the arrowhead, so the shaft stops short */
  var shaftEnd = n - 1;
  var total = 0, seg = [];
  for (i = 1; i < n; i++) {
    var d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d); total += d;
  }
  if (headLen > 0) {
    var back = 0;
    for (i = n - 1; i > 0; i--) {
      back += seg[i - 1];
      if (back >= headLen) { shaftEnd = i; break; }
    }
    if (shaftEnd < 2) shaftEnd = Math.max(1, n - 2);
  }
  var run = 0;
  for (i = 0; i <= shaftEnd; i++) {
    if (i) run += seg[i - 1];
    var t = total ? run / total : 0;
    var w = (w0 + (w1 - w0) * t) / 2;
    var p = pts[i];
    var prev = pts[Math.max(0, i - 1)], next = pts[Math.min(n - 1, i + 1)];
    var tx = next.x - prev.x, ty = next.y - prev.y;
    var tl = Math.hypot(tx, ty) || 1;
    var nx = -ty / tl, ny = tx / tl;
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  var poly = left.concat(right.reverse());
  var head = null;
  if (headLen > 0) {
    var tip = pts[n - 1], base = pts[shaftEnd];
    var hx = tip.x - base.x, hy = tip.y - base.y;
    var hl = Math.hypot(hx, hy) || 1;
    var ux = hx / hl, uy = hy / hl, px = -uy, py = ux;
    var hw = (headW || w0 * 1.6) / 2;
    head = [
      { x: tip.x, y: tip.y },
      { x: base.x + px * hw, y: base.y + py * hw },
      { x: base.x - px * hw, y: base.y - py * hw }
    ];
  }
  return { poly: poly, head: head, length: total };
}

/* ---------- the spark ----------
   A point travelling the line, once every `period` ms. It is the whole
   reason the drawing feels alive rather than printed. */
function sparkAt(pts, phase) {
  var n = pts.length;
  if (n < 2) return { x: pts[0].x, y: pts[0].y, t: 0 };
  var seg = [], total = 0, i;
  for (i = 1; i < n; i++) {
    var d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d); total += d;
  }
  var want = Math.max(0, Math.min(1, phase)) * total, run = 0;
  for (i = 1; i < n; i++) {
    if (run + seg[i - 1] >= want) {
      var t = seg[i - 1] ? (want - run) / seg[i - 1] : 0;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
        t: phase
      };
    }
    run += seg[i - 1];
  }
  return { x: pts[n - 1].x, y: pts[n - 1].y, t: 1 };
}

/* ---------- the grammar ----------
   Each kind knows how wide it starts, how it tapers, and how fast its
   spark travels. These numbers are the difference between "a diagram"
   and "something alive", so they're kept together where they can be
   compared rather than scattered through two renderers. */
var KINDS = {
  run:    { w0: 0.30, w1: 0.05, head: 0.42, headW: 0.52, alpha: 0.90, period: 1500, glow: 1.0 },
  threat: { w0: 0.24, w1: 0.04, head: 0.34, headW: 0.42, alpha: 0.78, period: 1100, glow: 0.7 },
  lane:   { w0: 0.34, w1: 0.34, head: 0.40, headW: 0.60, alpha: 0.55, period: 2200, glow: 0.8 },
  ghost:  { w0: 0.18, w1: 0.03, head: 0.26, headW: 0.30, alpha: 0.45, period: 2000, glow: 0.4 }
};

/* Build everything a renderer needs for one line.
   `a` and `b` are square centres in whatever units the renderer uses
   (pixels in 2D, board units in 3D); `scale` is the size of one square,
   so the same widths look right in both. */
function build(a, b, opts) {
  opts = opts || {};
  var kind = KINDS[opts.kind] ? opts.kind : "run";
  var K = KINDS[kind];
  var scale = opts.scale || 1;
  var pts = curve(a, b, opts.bend != null ? opts.bend : bendFor(kind, opts.knight), opts.steps);
  var r = ribbon(pts, K.w0 * scale, K.w1 * scale, K.head * scale, K.headW * scale);
  return {
    kind: kind, pts: pts, poly: r.poly, head: r.head, length: r.length,
    alpha: (opts.alpha != null ? opts.alpha : K.alpha),
    glow: K.glow, period: K.period
  };
}

/* where the spark is right now, given the clock */
function phase(line, timeMs) {
  return ((timeMs % line.period) / line.period);
}

var Lines = {
  curve: curve, ribbon: ribbon, sparkAt: sparkAt, build: build, phase: phase,
  KINDS: KINDS, bendFor: bendFor
};
if (typeof module !== "undefined" && module.exports) module.exports = Lines;
else root.Lines = Lines;
})(typeof self !== "undefined" ? self : this);
