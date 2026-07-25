/* gfx2d.js — the flat board, drawn kindly.
   Canvas 2D renderer with an original hand-drawn vector piece set
   (no borrowed artwork), soft colours, and the same animation
   language as the 3D room: sliding moves, fading captures, a
   replayable last-move glow, dots for quiet moves and rings for
   captures. It is also the safety net — if WebGL ever fails or the
   context is lost, the game lands here and keeps playing. */
(function (root) {
"use strict";

var THEMES = {
  walnut: { light: "#ecdcc0", dark: "#a97d55", rim: "#54382a", margin: "#f5ead6",
            coord: "#8a6a50", selected: "rgba(246,196,80,.55)", lastA: "rgba(244,214,120,.50)",
            lastB: "rgba(244,214,120,.38)", dot: "rgba(60,90,60,.38)", ring: "rgba(180,60,50,.55)",
            check: "rgba(220,60,50,.55)", hint: "#2b8a5c", wFill: "#f7f1e3", wLine: "#57432f",
            bFill: "#3a3733", bLine: "#141210", shadow: "rgba(30,20,10,.25)" },
  slate:  { light: "#dde3ea", dark: "#7b8da4", rim: "#2b323c", margin: "#e8ecf1",
            coord: "#5d6a7a", selected: "rgba(90,162,255,.5)", lastA: "rgba(120,180,255,.45)",
            lastB: "rgba(120,180,255,.32)", dot: "rgba(43,95,217,.35)", ring: "rgba(200,70,60,.55)",
            check: "rgba(220,60,50,.55)", hint: "#2b5fd9", wFill: "#f4f6f8", wLine: "#3a4350",
            bFill: "#343a44", bLine: "#10141a", shadow: "rgba(10,20,35,.25)" }
};

function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

/* ---------- the piece set ----------
   Each painter draws inside a unit box: x in [-0.5, 0.5], y = 0 at the
   base line, y = -1 at the crown. The canvas transform handles square
   placement and scale. */
function base(ctx) {
  ctx.moveTo(-0.34, 0);
  ctx.bezierCurveTo(-0.36, -0.10, -0.22, -0.13, -0.20, -0.16);
  ctx.lineTo(0.20, -0.16);
  ctx.bezierCurveTo(0.22, -0.13, 0.36, -0.10, 0.34, 0);
  ctx.closePath();
}
function drawPawn(ctx) {
  base(ctx);
  ctx.moveTo(-0.17, -0.16);
  ctx.bezierCurveTo(-0.12, -0.34, -0.13, -0.38, -0.10, -0.44);
  ctx.arc(0, -0.60, 0.155, Math.PI * 0.78, Math.PI * 0.22, false);
  ctx.bezierCurveTo(0.13, -0.38, 0.12, -0.34, 0.17, -0.16);
  ctx.closePath();
}
function drawRook(ctx) {
  base(ctx);
  ctx.moveTo(-0.20, -0.16);
  ctx.lineTo(-0.16, -0.52);
  ctx.lineTo(-0.24, -0.56);
  ctx.lineTo(-0.24, -0.74);
  ctx.lineTo(-0.13, -0.74); ctx.lineTo(-0.13, -0.66);
  ctx.lineTo(-0.05, -0.66); ctx.lineTo(-0.05, -0.74);
  ctx.lineTo(0.05, -0.74);  ctx.lineTo(0.05, -0.66);
  ctx.lineTo(0.13, -0.66);  ctx.lineTo(0.13, -0.74);
  ctx.lineTo(0.24, -0.74);
  ctx.lineTo(0.24, -0.56);
  ctx.lineTo(0.16, -0.52);
  ctx.lineTo(0.20, -0.16);
  ctx.closePath();
}
function drawKnight(ctx) {
  base(ctx);
  /* an original friendly horse: chest, muzzle, ears, mane */
  ctx.moveTo(-0.19, -0.16);
  ctx.bezierCurveTo(-0.22, -0.35, -0.16, -0.53, -0.02, -0.64);   /* up the chest */
  ctx.bezierCurveTo(-0.14, -0.66, -0.24, -0.60, -0.29, -0.50);   /* jaw toward muzzle */
  ctx.bezierCurveTo(-0.35, -0.52, -0.36, -0.60, -0.31, -0.66);   /* muzzle tip */
  ctx.bezierCurveTo(-0.24, -0.74, -0.12, -0.78, -0.05, -0.78);   /* forehead */
  ctx.lineTo(-0.03, -0.88);                                       /* ear up */
  ctx.bezierCurveTo(0.02, -0.82, 0.05, -0.80, 0.08, -0.79);      /* between ears */
  ctx.lineTo(0.14, -0.86);                                        /* second ear */
  ctx.bezierCurveTo(0.20, -0.76, 0.235, -0.66, 0.235, -0.52);    /* back of the neck */
  ctx.bezierCurveTo(0.235, -0.38, 0.21, -0.26, 0.19, -0.16);     /* down to the base */
  ctx.closePath();
}
function drawBishop(ctx) {
  base(ctx);
  ctx.moveTo(-0.17, -0.16);
  ctx.bezierCurveTo(-0.10, -0.26, -0.16, -0.30, -0.155, -0.38);
  ctx.bezierCurveTo(-0.155, -0.55, -0.05, -0.62, -0.045, -0.72);
  ctx.bezierCurveTo(-0.045, -0.79, 0.045, -0.79, 0.045, -0.72);
  ctx.bezierCurveTo(0.05, -0.62, 0.155, -0.55, 0.155, -0.38);
  ctx.bezierCurveTo(0.16, -0.30, 0.10, -0.26, 0.17, -0.16);
  ctx.closePath();
  /* the mitre's ball */
  ctx.moveTo(0.055, -0.845);
  ctx.arc(0, -0.845, 0.055, 0, Math.PI * 2);
}
function crown(ctx, h, spikes) {
  var w = 0.26;
  ctx.moveTo(-w, h);
  for (var i = 0; i <= spikes; i++) {
    var x = -w + (2 * w * i) / spikes;
    var peak = i % 2 === 0 ? h - 0.10 : h - 0.20;
    if (i === 0) ctx.lineTo(-w, peak);
    else ctx.lineTo(x, i % 2 ? peak : h - 0.10);
  }
}
function drawQueen(ctx) {
  base(ctx);
  ctx.moveTo(-0.18, -0.16);
  ctx.bezierCurveTo(-0.10, -0.30, -0.17, -0.42, -0.21, -0.58);   /* waist */
  ctx.lineTo(-0.26, -0.62);
  ctx.lineTo(-0.20, -0.80);                                       /* crown points */
  ctx.lineTo(-0.11, -0.66);
  ctx.lineTo(-0.055, -0.83);
  ctx.lineTo(0, -0.68);
  ctx.lineTo(0.055, -0.83);
  ctx.lineTo(0.11, -0.66);
  ctx.lineTo(0.20, -0.80);
  ctx.lineTo(0.26, -0.62);
  ctx.lineTo(0.21, -0.58);
  ctx.bezierCurveTo(0.17, -0.42, 0.10, -0.30, 0.18, -0.16);
  ctx.closePath();
}
function drawKing(ctx) {
  base(ctx);
  ctx.moveTo(-0.18, -0.16);
  ctx.bezierCurveTo(-0.10, -0.30, -0.16, -0.44, -0.20, -0.56);
  ctx.bezierCurveTo(-0.24, -0.68, -0.16, -0.76, -0.06, -0.74);   /* crown dome */
  ctx.lineTo(-0.028, -0.74);
  /* the cross */
  ctx.lineTo(-0.028, -0.82); ctx.lineTo(-0.085, -0.82); ctx.lineTo(-0.085, -0.875);
  ctx.lineTo(-0.028, -0.875); ctx.lineTo(-0.028, -0.94); ctx.lineTo(0.028, -0.94);
  ctx.lineTo(0.028, -0.875); ctx.lineTo(0.085, -0.875); ctx.lineTo(0.085, -0.82);
  ctx.lineTo(0.028, -0.82); ctx.lineTo(0.028, -0.74);
  ctx.lineTo(0.06, -0.74);
  ctx.bezierCurveTo(0.16, -0.76, 0.24, -0.68, 0.20, -0.56);
  ctx.bezierCurveTo(0.16, -0.44, 0.10, -0.30, 0.18, -0.16);
  ctx.closePath();
}
var PAINTERS = [null, drawPawn, drawKnight, drawBishop, drawRook, drawQueen, drawKing];

function paintPiece(ctx, piece, x, y, size, th, alpha, scale) {
  var kind = Math.abs(piece), white = piece > 0;
  ctx.save();
  ctx.translate(x, y + size * 0.38);
  var s = size * 0.92 * (scale || 1);
  ctx.scale(s, s);
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  /* soft ground shadow */
  ctx.beginPath();
  ctx.ellipse(0, -0.02, 0.30, 0.075, 0, 0, Math.PI * 2);
  ctx.fillStyle = th.shadow;
  ctx.fill();
  ctx.beginPath();
  PAINTERS[kind](ctx);
  ctx.fillStyle = white ? th.wFill : th.bFill;
  ctx.strokeStyle = white ? th.wLine : th.bLine;
  ctx.lineWidth = 0.035;
  ctx.lineJoin = "round";
  ctx.fill();
  ctx.stroke();
  /* a small warm highlight so black pieces read on dark squares */
  if (!white) {
    ctx.beginPath();
    PAINTERS[kind](ctx);
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 0.012;
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- renderer ---------- */
function create(canvas) {
  var ctx = canvas.getContext("2d");
  var R = {
    kind: "2d",
    theme: THEMES.walnut,
    themeName: "walnut",
    orientation: 1,             /* 1 = white at the bottom */
    board: new Int8Array(128),
    hi: { selected: -1, legal: [], legalCapt: [], last: null, check: -1, hint: null },
    anim: null,                 /* the move in flight */
    size: 0, cell: 0, ox: 0, oy: 0, dirty: true
  };

  function onBoard(sq) { return (sq & 0x88) === 0; }
  function fileOf(sq) { return sq & 7; }
  function rankOf(sq) { return sq >> 4; }

  /* square → centre in css pixels */
  function sqXY(sq) {
    var f = fileOf(sq), r = rankOf(sq);
    if (R.orientation === 1) return { x: R.ox + (f + 0.5) * R.cell, y: R.oy + (7 - r + 0.5) * R.cell };
    return { x: R.ox + (7 - f + 0.5) * R.cell, y: R.oy + (r + 0.5) * R.cell };
  }

  R.screenToSquare = function (px, py) {
    var f = Math.floor((px - R.ox) / R.cell), r = Math.floor((py - R.oy) / R.cell);
    if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
    if (R.orientation === 1) return (7 - r) * 16 + f;
    return r * 16 + (7 - f);
  };

  R.resize = function () {
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var m = Math.min(w, h);
    R.cell = Math.floor((m * 0.94) / 8);
    R.size = R.cell * 8;
    R.ox = Math.round((w - R.size) / 2);
    R.oy = Math.round((h - R.size) / 2);
    R.dirty = true;
  };

  R.setTheme = function (name) { R.themeName = THEMES[name] ? name : "walnut"; R.theme = THEMES[R.themeName]; R.dirty = true; };
  R.setOrientation = function (color) { R.orientation = color; R.dirty = true; };
  R.setPosition = function (board) { R.board.set(board); R.anim = null; R.dirty = true; };
  R.setHighlights = function (hi) {
    R.hi.selected = hi.selected != null ? hi.selected : -1;
    R.hi.legal = hi.legal || [];
    R.hi.legalCapt = hi.legalCapt || [];
    R.hi.last = hi.last || null;
    R.hi.check = hi.check != null ? hi.check : -1;
    R.hi.hint = hi.hint || null;
    R.dirty = true;
  };

  /* animate a move: board must still hold the *before* position;
     `after` is the position once the move lands. done() fires at the end. */
  R.animateMove = function (m, after, opts, done) {
    opts = opts || {};
    R.anim = {
      m: m, after: new Int8Array(after), t0: performance.now(),
      dur: opts.dur || 320, glow: !!opts.glow, done: done || null
    };
    R.dirty = true;
  };
  R.isAnimating = function () { return !!R.anim; };

  function arrow(from, to, color, alpha) {
    var a = sqXY(from), b = sqXY(to);
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 1) return;
    var ux = dx / len, uy = dy / len, w = R.cell * 0.16, head = R.cell * 0.34;
    var sx = a.x + ux * R.cell * 0.28, sy = a.y + uy * R.cell * 0.28;
    var ex = b.x - ux * R.cell * 0.30, ey = b.y - uy * R.cell * 0.30;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 0.85 : alpha;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = w; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(ex - ux * head * 0.6, ey - uy * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * head - uy * head * 0.55, ey - uy * head + ux * head * 0.55);
    ctx.lineTo(ex - ux * head + uy * head * 0.55, ey - uy * head - ux * head * 0.55);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* one full paint; returns true if another frame is wanted */
  R.frame = function () {
    var th = R.theme, animating = false;
    if (!R.dirty && !R.anim) return false;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    /* margin + rim */
    ctx.fillStyle = th.margin;
    var pad = R.cell * 0.30;
    rr(ctx, R.ox - pad, R.oy - pad, R.size + pad * 2, R.size + pad * 2, R.cell * 0.28);
    ctx.fill();
    ctx.strokeStyle = th.rim; ctx.lineWidth = Math.max(2, R.cell * 0.07);
    rr(ctx, R.ox - pad * 0.55, R.oy - pad * 0.55, R.size + pad * 1.1, R.size + pad * 1.1, R.cell * 0.2);
    ctx.stroke();

    /* squares */
    for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
      var sq = r * 16 + f, p = sqXY(sq);
      ctx.fillStyle = ((f + r) % 2 === 0) ? th.dark : th.light;
      ctx.fillRect(p.x - R.cell / 2, p.y - R.cell / 2, R.cell + 0.5, R.cell + 0.5);
    }

    /* coordinates */
    ctx.fillStyle = th.coord;
    ctx.font = "600 " + Math.max(9, R.cell * 0.22) + "px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var i = 0; i < 8; i++) {
      var fileCh = "abcdefgh"[R.orientation === 1 ? i : 7 - i];
      var rankCh = R.orientation === 1 ? 8 - i : i + 1;
      ctx.fillText(fileCh, R.ox + (i + 0.5) * R.cell, R.oy + R.size + pad * 0.52);
      ctx.fillText(String(rankCh), R.ox - pad * 0.52, R.oy + (i + 0.5) * R.cell);
    }

    /* square highlights (under the pieces) */
    if (R.hi.last) {
      fillSq(R.hi.last[0], th.lastB, th);
      fillSq(R.hi.last[1], th.lastA, th);
    }
    if (R.hi.selected >= 0) fillSq(R.hi.selected, th.selected, th);
    if (R.hi.check >= 0) {
      var c = sqXY(R.hi.check);
      var gr = ctx.createRadialGradient(c.x, c.y, R.cell * 0.1, c.x, c.y, R.cell * 0.62);
      gr.addColorStop(0, th.check); gr.addColorStop(1, "rgba(220,60,50,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(c.x - R.cell / 2, c.y - R.cell / 2, R.cell, R.cell);
    }

    /* pieces (skipping any square involved in the animation) */
    var skip = {}, a = R.anim, prog = 0;
    if (a) {
      prog = Math.min(1, (performance.now() - a.t0) / a.dur);
      animating = prog < 1;
      skip[a.m.from] = true; skip[a.m.to] = true;
      if (a.m.rookFrom != null) { skip[a.m.rookFrom] = true; skip[a.m.rookTo] = true; }
      if (a.m.epSq != null) skip[a.m.epSq] = true;
    }
    for (var sq2 = 0; sq2 < 128; sq2++) {
      if (!onBoard(sq2) || skip[sq2]) continue;
      var piece = a ? (a.after[sq2] || 0) : R.board[sq2];
      if (!piece) continue;
      var q = sqXY(sq2);
      paintPiece(ctx, piece, q.x, q.y, R.cell, th);
    }

    /* the move in flight */
    if (a) {
      var e = ease(prog);
      /* captured piece fades under the mover */
      var captPiece = a.m.epSq != null ? R.board[a.m.epSq] : R.board[a.m.to];
      if (captPiece) {
        var cq = sqXY(a.m.epSq != null ? a.m.epSq : a.m.to);
        paintPiece(ctx, captPiece, cq.x, cq.y, R.cell, th, 1 - e, 1 - 0.35 * e);
      }
      if (a.m.rookFrom != null) {
        var rf = sqXY(a.m.rookFrom), rt = sqXY(a.m.rookTo);
        paintPiece(ctx, a.after[a.m.rookTo], rf.x + (rt.x - rf.x) * e, rf.y + (rt.y - rf.y) * e, R.cell, th);
      }
      var f0 = sqXY(a.m.from), f1 = sqXY(a.m.to);
      var mover = e > 0.75 && a.m.promo ? a.m.promo : a.m.piece;
      var lift = Math.abs(a.m.piece) === 2 ? Math.sin(prog * Math.PI) * R.cell * 0.35 : 0; /* knights hop */
      if (a.glow) {
        ctx.save();
        ctx.shadowColor = th.hint; ctx.shadowBlur = R.cell * 0.5;
        paintPiece(ctx, mover, f0.x + (f1.x - f0.x) * e, f0.y + (f1.y - f0.y) * e - lift, R.cell, th);
        ctx.restore();
      } else {
        paintPiece(ctx, mover, f0.x + (f1.x - f0.x) * e, f0.y + (f1.y - f0.y) * e - lift, R.cell, th);
      }
      if (!animating) {
        R.board.set(a.after);
        R.anim = null;
        if (a.done) { var cb = a.done; a.done = null; setTimeout(cb, 0); }
      }
    }

    /* legal-move markers (over the pieces so rings show on captures) */
    ctx.fillStyle = th.dot;
    for (var li = 0; li < R.hi.legal.length; li++) {
      var lp = sqXY(R.hi.legal[li]);
      ctx.beginPath(); ctx.arc(lp.x, lp.y, R.cell * 0.14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = th.ring; ctx.lineWidth = Math.max(2, R.cell * 0.07);
    for (var ci = 0; ci < R.hi.legalCapt.length; ci++) {
      var cp = sqXY(R.hi.legalCapt[ci]);
      ctx.beginPath(); ctx.arc(cp.x, cp.y, R.cell * 0.42, 0, Math.PI * 2); ctx.stroke();
    }

    if (R.hi.hint) arrow(R.hi.hint[0], R.hi.hint[1], th.hint, 0.8);

    R.dirty = animating;
    return animating;
  };

  function fillSq(sq, color, th) {
    var p = sqXY(sq);
    ctx.fillStyle = color;
    ctx.fillRect(p.x - R.cell / 2, p.y - R.cell / 2, R.cell, R.cell);
  }

  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  R.destroy = function () { R.anim = null; };
  R.resize();
  return R;
}

var Gfx2D = { create: create, THEMES: THEMES, paintPiece: paintPiece, PAINTERS: PAINTERS };
if (typeof module !== "undefined" && module.exports) module.exports = Gfx2D;
else root.Gfx2D = Gfx2D;
})(typeof self !== "undefined" ? self : this);
