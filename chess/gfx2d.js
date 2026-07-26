/* gfx2d.js — the flat board, drawn kindly.
   Canvas 2D renderer with an original hand-drawn vector piece set
   (no borrowed artwork), soft colours, and the same animation
   language as the 3D room: sliding moves, fading captures, a
   replayable last-move glow, dots for quiet moves and rings for
   captures. It is also the safety net — if WebGL ever fails or the
   context is lost, the game lands here and keeps playing. */
(function (root) {
"use strict";

/* ---------- a skin, turned into the strings canvas wants ----------
   Everything drawn here comes from the live skin object (see skins.js),
   so a slider moved in the Studio shows up on the very next frame. */
function rgbOf(hex) {
  var n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  var c = rgbOf(hex);
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
}
/* f > 0 lightens toward white, f < 0 darkens toward black */
function shade(hex, f) {
  var c = rgbOf(hex);
  var ch = function (v) {
    var out = f > 0 ? v + (255 - v) * f : v * (1 + f);
    return Math.round(Math.max(0, Math.min(255, out)));
  };
  return "rgb(" + ch(c[0]) + "," + ch(c[1]) + "," + ch(c[2]) + ")";
}
function luma(hex) {
  var c = rgbOf(hex);
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

function derive(skin) {
  var b = skin.board, p = skin.pieces, m = skin.marks;
  var surf = (root.Skins && root.Skins.surface) ? root.Skins.surface(skin)
           : { spec: 0.5, alpha: 1, rim: 0.3 };
  /* outlines are drawn from the piece's own colour so any palette holds
     together — a light piece gets a dark line, a dark piece a darker one */
  return {
    light: b.light, dark: b.dark, rim: b.rim, margin: b.edge, coord: b.coord,
    pattern: b.pattern, grain: b.grain, gloss: b.gloss,
    selected: rgba(m.select, 0.55),
    lastA: rgba(m.last, 0.50), lastB: rgba(m.last, 0.36),
    dot: rgba(m.legal, 0.48), ring: rgba(m.capture, 0.66),
    checkCore: rgba(m.check, 0.58), checkEdge: rgba(m.check, 0),
    hint: m.hint,
    wFill: p.white, wLine: shade(p.white, luma(p.white) > 0.5 ? -0.68 : -0.35),
    bFill: p.black, bLine: shade(p.black, luma(p.black) > 0.5 ? -0.7 : -0.55),
    wEdge: shade(p.white, 0.55), bEdge: shade(p.black, 0.5),
    shadow: rgba(b.rim, 0.30),
    sheen: Math.min(1, surf.spec * 0.7), alpha: surf.alpha, rimLight: surf.rim
  };
}

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

function paintPiece(ctx, piece, x, y, size, pal, alpha, scale) {
  var kind = Math.abs(piece), white = piece > 0;
  ctx.save();
  ctx.translate(x, y + size * 0.38);
  var s = size * 0.92 * (scale || 1);
  ctx.scale(s, s);
  var baseAlpha = (alpha == null ? 1 : alpha);
  ctx.globalAlpha = baseAlpha;
  /* soft ground shadow */
  ctx.beginPath();
  ctx.ellipse(0, -0.02, 0.30, 0.075, 0, 0, Math.PI * 2);
  ctx.fillStyle = pal.shadow;
  ctx.fill();

  /* the body — translucent materials (glass) let the board through */
  ctx.globalAlpha = baseAlpha * pal.alpha;
  ctx.beginPath();
  PAINTERS[kind](ctx);
  ctx.fillStyle = white ? pal.wFill : pal.bFill;
  ctx.strokeStyle = white ? pal.wLine : pal.bLine;
  ctx.lineWidth = 0.035;
  ctx.lineJoin = "round";
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = baseAlpha;

  /* material: a shine down the left shoulder, scaled by the skin. This
     is what makes ink look like paper and metal look like metal. */
  if (pal.sheen > 0.02) {
    ctx.save();
    ctx.beginPath();
    PAINTERS[kind](ctx);
    ctx.clip();
    var g = ctx.createLinearGradient(-0.3, -0.9, 0.25, 0.0);
    g.addColorStop(0, "rgba(255,255,255," + (0.55 * pal.sheen).toFixed(3) + ")");
    g.addColorStop(0.45, "rgba(255,255,255," + (0.12 * pal.sheen).toFixed(3) + ")");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-0.5, -1.05, 1, 1.1);
    ctx.restore();
  }
  /* rim light, so a dark piece still reads against a dark square */
  if (pal.rimLight > 0.02) {
    ctx.beginPath();
    PAINTERS[kind](ctx);
    ctx.strokeStyle = (white ? pal.wEdge : pal.bEdge);
    ctx.globalAlpha = baseAlpha * Math.min(0.6, pal.rimLight * 0.55);
    ctx.lineWidth = 0.016;
    ctx.stroke();
    ctx.globalAlpha = baseAlpha;
  }
  ctx.restore();
}

/* ---------- renderer ---------- */
function create(canvas) {
  var ctx = canvas.getContext("2d");
  var R = {
    kind: "2d",
    skin: null, pal: null,
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
    boardKey = "";                       /* the cached board is now the wrong size */
    R.dirty = true;
  };

  /* ---------- the board, painted once and reused ----------
     Grain, veins and inlay lines are a lot of little strokes; doing them
     every frame would tax a phone for no reason, so the whole board
     (margin, squares, texture, coordinates) is rendered to an offscreen
     canvas and blitted. It rebuilds only when the skin, the size or the
     orientation actually changes — which is what keeps the Studio's
     sliders feeling instant even mid-animation. */
  var boardCv = document.createElement("canvas");
  var boardCtx = boardCv.getContext("2d");
  var boardKey = "", boardPad = 0;

  function paintPattern(g, x, y, cell, dark, pal, f, r) {
    var amt = pal.grain;
    if (amt <= 0.02 || pal.pattern === "plain") return;
    g.save();
    g.beginPath(); g.rect(x, y, cell, cell); g.clip();
    var seed = (f * 73 + r * 131) % 97;
    if (pal.pattern === "wood") {
      g.globalAlpha = 0.06 + amt * 0.16;
      for (var i = 0; i < 5; i++) {
        var yy = y + ((seed * 7 + i * 23) % cell);
        g.strokeStyle = (i % 2) ? "#000" : "#fff";
        g.globalAlpha = (0.03 + amt * 0.10) * (i % 2 ? 1 : 0.7);
        g.lineWidth = 1 + (i % 2);
        g.beginPath();
        g.moveTo(x, yy);
        g.bezierCurveTo(x + cell * 0.3, yy + 2, x + cell * 0.7, yy - 2, x + cell, yy + 1);
        g.stroke();
      }
    } else if (pal.pattern === "marble") {
      g.globalAlpha = 0.05 + amt * 0.14;
      g.strokeStyle = dark ? "#fff" : "#000";
      g.lineWidth = Math.max(1, cell * 0.02);
      for (var v = 0; v < 3; v++) {
        var sx = x + ((seed * 11 + v * 37) % cell), sy = y;
        g.beginPath();
        g.moveTo(sx, sy);
        g.bezierCurveTo(sx + cell * 0.35, sy + cell * 0.3, sx - cell * 0.3, sy + cell * 0.65, sx + cell * 0.2, sy + cell);
        g.stroke();
      }
    } else if (pal.pattern === "linen") {
      g.globalAlpha = 0.04 + amt * 0.10;
      g.strokeStyle = dark ? "#fff" : "#000";
      g.lineWidth = 1;
      var step = Math.max(3, cell / 7);
      for (var t = 0; t < cell; t += step) {
        g.beginPath(); g.moveTo(x, y + t); g.lineTo(x + cell, y + t); g.stroke();
        g.beginPath(); g.moveTo(x + t, y); g.lineTo(x + t, y + cell); g.stroke();
      }
    } else if (pal.pattern === "inlay") {
      g.globalAlpha = 0.25 + amt * 0.55;
      g.strokeStyle = dark ? "#fff" : "#000";
      g.lineWidth = Math.max(1, cell * 0.03);
      g.strokeRect(x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84);
    }
    g.restore();
  }

  function buildBoard() {
    var pal = R.pal, dpr = Math.min(2.5, window.devicePixelRatio || 1);
    var pad = Math.round(R.cell * 0.30);
    var W = R.size + pad * 2, H = W;
    boardPad = pad;
    boardCv.width = Math.round(W * dpr);
    boardCv.height = Math.round(H * dpr);
    var g = boardCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    /* the frame the board sits in */
    g.fillStyle = pal.margin;
    rr(g, 0, 0, W, H, R.cell * 0.28);
    g.fill();
    g.strokeStyle = pal.rim;
    g.lineWidth = Math.max(2, R.cell * 0.07);
    rr(g, pad * 0.45, pad * 0.45, W - pad * 0.9, H - pad * 0.9, R.cell * 0.2);
    g.stroke();

    /* the sixty-four */
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var vf = R.orientation === 1 ? f : 7 - f;
        var vr = R.orientation === 1 ? 7 - r : r;
        var dark = ((vf + vr) % 2) === 0;
        var x = pad + f * R.cell, y = pad + r * R.cell;
        g.fillStyle = dark ? pal.dark : pal.light;
        g.fillRect(x, y, R.cell + 0.5, R.cell + 0.5);
        paintPattern(g, x, y, R.cell, dark, pal, vf, vr);
      }
    }

    /* gloss: one soft sweep of light across the whole surface */
    if (pal.gloss > 0.02) {
      var gl = g.createLinearGradient(pad, pad, pad + R.size, pad + R.size);
      gl.addColorStop(0, "rgba(255,255,255," + (0.22 * pal.gloss).toFixed(3) + ")");
      gl.addColorStop(0.45, "rgba(255,255,255,0)");
      gl.addColorStop(0.75, "rgba(0,0,0,0)");
      gl.addColorStop(1, "rgba(0,0,0," + (0.16 * pal.gloss).toFixed(3) + ")");
      g.fillStyle = gl;
      g.fillRect(pad, pad, R.size, R.size);
    }

    /* coordinates, in the margin where they belong */
    g.fillStyle = pal.coord;
    g.font = "600 " + Math.max(9, R.cell * 0.22) + "px system-ui, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    for (var i = 0; i < 8; i++) {
      var fileCh = "abcdefgh"[R.orientation === 1 ? i : 7 - i];
      var rankCh = R.orientation === 1 ? 8 - i : i + 1;
      g.fillText(fileCh, pad + (i + 0.5) * R.cell, pad + R.size + pad * 0.52);
      g.fillText(String(rankCh), pad * 0.48, pad + (i + 0.5) * R.cell);
    }
    boardKey = key();
  }
  function key() {
    return [R.size, R.orientation, R.pal && JSON.stringify(R.skin.board),
            Math.min(2.5, window.devicePixelRatio || 1)].join("|");
  }

  R.setSkin = function (skin) {
    R.skin = skin;
    R.pal = derive(skin);
    boardKey = "";
    R.dirty = true;
  };
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
    var th = R.pal, animating = false;
    if (!th) return false;
    if (!R.dirty && !R.anim) return false;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    /* the board itself, straight off the cache */
    if (boardKey !== key()) buildBoard();
    var pad = boardPad;
    ctx.drawImage(boardCv, R.ox - pad, R.oy - pad, R.size + pad * 2, R.size + pad * 2);

    /* square highlights (under the pieces) */
    if (R.hi.last) {
      fillSq(R.hi.last[0], th.lastB, th);
      fillSq(R.hi.last[1], th.lastA, th);
    }
    if (R.hi.selected >= 0) fillSq(R.hi.selected, th.selected, th);
    if (R.hi.check >= 0) {
      var c = sqXY(R.hi.check);
      var gr = ctx.createRadialGradient(c.x, c.y, R.cell * 0.1, c.x, c.y, R.cell * 0.62);
      gr.addColorStop(0, th.checkCore); gr.addColorStop(1, th.checkEdge);
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

var Gfx2D = { create: create, derive: derive, paintPiece: paintPiece, PAINTERS: PAINTERS };
if (typeof module !== "undefined" && module.exports) module.exports = Gfx2D;
else root.Gfx2D = Gfx2D;
})(typeof self !== "undefined" ? self : this);
