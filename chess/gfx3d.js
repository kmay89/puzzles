/* gfx3d.js — the board in the round.
   Raw WebGL 1, no libraries, in the manner of the solving room:
   every piece is a lathe (a profile revolved around its axis — the
   knight is a lathe gently bent forward at the neck), the board is a
   single textured quad painted on an offscreen canvas, and the camera
   is an orbit on springs so it glides rather than snaps.

   Moves slide, knights hop a little arc, captured pieces sink through
   the board and fade, promotions crossfade at the far rank, and every
   piece keeps a soft shadow disc that stays on the ground while its
   owner is airborne. If WebGL is missing or the context is lost, the
   app is told at once and the same game continues in 2D — nothing is
   allowed to strand the player. */
(function (root) {
"use strict";

var REDUCED = (typeof matchMedia === "function") && matchMedia("(prefers-reduced-motion: reduce)").matches;

var THEMES = {
  walnut: { light: "#e9d9bd", dark: "#9d7350", rim: "#4a3227", margin: "#caa87c", coord: "#5d4433",
            bg: [0.086, 0.075, 0.066], white: [0.93, 0.89, 0.80], black: [0.16, 0.15, 0.14],
            whiteLine: null, selected: [0.98, 0.78, 0.30], legal: [0.30, 0.55, 0.36],
            capt: [0.75, 0.28, 0.22], last: [0.96, 0.84, 0.44], check: [0.86, 0.24, 0.18],
            hint: [0.16, 0.55, 0.36] },
  slate:  { light: "#dde3ea", dark: "#7b8da4", rim: "#242b34", margin: "#aab6c4", coord: "#39424e",
            bg: [0.055, 0.065, 0.08], white: [0.92, 0.94, 0.96], black: [0.17, 0.19, 0.23],
            selected: [0.36, 0.62, 1.0], legal: [0.22, 0.42, 0.85],
            capt: [0.78, 0.28, 0.24], last: [0.45, 0.65, 1.0], check: [0.86, 0.24, 0.18],
            hint: [0.17, 0.38, 0.85] }
};

/* ---------- tiny mat4 (column-major, like GL wants) ---------- */
function mIdent() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mMul(a, b) {
  var o = new Array(16);
  for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
    o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
  }
  return o;
}
function mPersp(fovY, aspect, near, far) {
  var f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0];
}
function mLookAt(eye, at, up) {
  var zx = eye[0]-at[0], zy = eye[1]-at[1], zz = eye[2]-at[2];
  var zl = Math.hypot(zx,zy,zz); zx/=zl; zy/=zl; zz/=zl;
  var xx = up[1]*zz-up[2]*zy, xy = up[2]*zx-up[0]*zz, xz = up[0]*zy-up[1]*zx;
  var xl = Math.hypot(xx,xy,xz); xx/=xl; xy/=xl; xz/=xl;
  var yx = zy*xz-zz*xy, yy = zz*xx-zx*xz, yz = zx*xy-zy*xx;
  return [xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0,
          -(xx*eye[0]+xy*eye[1]+xz*eye[2]), -(yx*eye[0]+yy*eye[1]+yz*eye[2]), -(zx*eye[0]+zy*eye[1]+zz*eye[2]), 1];
}
function mModel(x, y, z, s, ry) {
  var c = Math.cos(ry || 0), n = Math.sin(ry || 0);
  return [s*c,0,-s*n,0, 0,s,0,0, s*n,0,s*c,0, x,y,z,1];
}

/* ---------- geometry ---------- */
/* revolve a [radius, height] profile; returns {pos, idx} (normals later) */
function lathe(profile, segs) {
  var pos = [], idx = [], i, j;
  for (j = 0; j < profile.length; j++) {
    for (i = 0; i <= segs; i++) {
      var a = (i / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * profile[j][0], profile[j][1], Math.sin(a) * profile[j][0]);
    }
  }
  var w = segs + 1;
  for (j = 0; j < profile.length - 1; j++) for (i = 0; i < segs; i++) {
    var a0 = j * w + i, b0 = a0 + 1, c0 = a0 + w, d0 = c0 + 1;
    idx.push(a0, c0, b0, b0, c0, d0);
  }
  return { pos: pos, idx: idx };
}
function computeNormals(pos, idx) {
  var n = new Float32Array(pos.length), i;
  for (i = 0; i < idx.length; i += 3) {
    var a = idx[i]*3, b = idx[i+1]*3, c = idx[i+2]*3;
    var ux = pos[b]-pos[a], uy = pos[b+1]-pos[a+1], uz = pos[b+2]-pos[a+2];
    var vx = pos[c]-pos[a], vy = pos[c+1]-pos[a+1], vz = pos[c+2]-pos[a+2];
    var nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
    n[a]+=nx; n[a+1]+=ny; n[a+2]+=nz;
    n[b]+=nx; n[b+1]+=ny; n[b+2]+=nz;
    n[c]+=nx; n[c+1]+=ny; n[c+2]+=nz;
  }
  for (i = 0; i < n.length; i += 3) {
    var l = Math.hypot(n[i], n[i+1], n[i+2]) || 1;
    n[i]/=l; n[i+1]/=l; n[i+2]/=l;
  }
  return n;
}

/* piece profiles — [radius, height], all ~1.0 tall before per-kind scale */
function collar(r, y) { return [[r, y], [r + 0.045, y + 0.02], [r + 0.045, y + 0.045], [r * 0.82, y + 0.075]]; }
function baseProfile() {
  return [[0.0, 0], [0.30, 0], [0.315, 0.02], [0.30, 0.055], [0.24, 0.09], [0.205, 0.14]];
}
function pawnProfile() {
  return baseProfile().concat([[0.13, 0.22], [0.115, 0.34]], collar(0.115, 0.34),
    [[0.10, 0.44], [0.145, 0.50], [0.15, 0.56], [0.10, 0.63], [0.0, 0.66]]);
}
function rookProfile() {
  return baseProfile().concat([[0.17, 0.28], [0.155, 0.52]],
    [[0.21, 0.56], [0.21, 0.72], [0.15, 0.72], [0.15, 0.66], [0.0, 0.66]]);
}
function knightProfile() {
  return baseProfile().concat([[0.155, 0.24], [0.125, 0.36], [0.115, 0.46],
    [0.15, 0.56], [0.175, 0.66], [0.175, 0.76], [0.13, 0.83], [0.06, 0.87], [0.0, 0.88]]);
}
function bishopProfile() {
  return baseProfile().concat([[0.14, 0.26], [0.115, 0.42]], collar(0.115, 0.42),
    [[0.13, 0.55], [0.145, 0.62], [0.10, 0.72], [0.035, 0.78], [0.05, 0.82], [0.0, 0.87]]);
}
function queenProfile() {
  return baseProfile().concat([[0.16, 0.26], [0.115, 0.50]], collar(0.115, 0.50),
    [[0.115, 0.62], [0.16, 0.72], [0.185, 0.80], [0.13, 0.78], [0.10, 0.84], [0.05, 0.80], [0.0, 0.90]]);
}
function kingProfile() {
  return baseProfile().concat([[0.165, 0.26], [0.12, 0.52]], collar(0.12, 0.52),
    [[0.12, 0.64], [0.17, 0.76], [0.10, 0.82], [0.04, 0.84],
     /* the cross, revolved thin */
     [0.035, 0.86], [0.035, 0.90], [0.075, 0.90], [0.075, 0.945], [0.035, 0.945], [0.035, 1.0], [0.0, 1.0]]);
}
/* the knight: bend the top of the lathe forward, flatten the back of
   the head into a mane, slim it side-on, push out a muzzle — a horse
   suggested rather than carved, cohesive with the rest of the set */
function knightDeform(pos) {
  for (var i = 0; i < pos.length; i += 3) {
    var y = pos[i+1];
    if (y > 0.42) {
      var t = (y - 0.42) / 0.46;
      pos[i+2] *= 1 - 0.42 * t;                    /* head slims side-on */
      if (pos[i] < 0) pos[i] *= 1 - 0.5 * t;       /* flat mane at the back */
      pos[i]   += t * t * 0.42;                    /* neck leans forward */
    }
    if (y > 0.60 && y < 0.80 && pos[i] > 0.12) {
      pos[i] += 0.14 * Math.sin(((y - 0.60) / 0.20) * Math.PI);  /* muzzle */
    }
    /* a nod of the head: the very top tips down toward the muzzle */
    if (y > 0.80) {
      pos[i+1] -= (y - 0.80) * 0.35 * Math.max(0, pos[i]) / 0.2;
    }
  }
}

/* flat disc (shadows, move dots) and ring (capture marks) at y=0 */
function disc(segs) {
  var pos = [0, 0, 0], idx = [];
  for (var i = 0; i <= segs; i++) {
    var a = (i / segs) * Math.PI * 2;
    pos.push(Math.cos(a), 0, Math.sin(a));
    if (i) idx.push(0, i, i + 1);
  }
  return { pos: pos, idx: idx };
}
function ring(segs, inner) {
  var pos = [], idx = [];
  for (var i = 0; i <= segs; i++) {
    var a = (i / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * inner, 0, s * inner, c, 0, s);
    if (i) { var b = (i - 1) * 2; idx.push(b, b+1, b+2, b+1, b+3, b+2); }
  }
  return { pos: pos, idx: idx };
}
function quadXZ() { /* unit square centred on origin */
  return { pos: [-0.5,0,-0.5, 0.5,0,-0.5, 0.5,0,0.5, -0.5,0,0.5], idx: [0,2,1,0,3,2] };
}

/* ---------- shaders ---------- */
var VSH = [
  "attribute vec3 aPos; attribute vec3 aNrm;",
  "uniform mat4 uProj, uView, uModel;",
  "varying vec3 vNrm; varying vec3 vWorld;",
  "void main(){",
  "  vec4 w = uModel * vec4(aPos, 1.0);",
  "  vWorld = w.xyz;",
  "  vNrm = mat3(uModel) * aNrm;",
  "  gl_Position = uProj * uView * w;",
  "}"].join("\n");
var FSH = [
  "precision mediump float;",
  "uniform vec3 uColor; uniform float uAlpha; uniform vec3 uEye; uniform float uFlat; uniform float uSpec;",
  "varying vec3 vNrm; varying vec3 vWorld;",
  "void main(){",
  "  if (uFlat > 0.5) { gl_FragColor = vec4(uColor, uAlpha); return; }",
  "  vec3 N = normalize(vNrm);",
  "  vec3 L1 = normalize(vec3(-0.45, 0.85, 0.35));",
  "  vec3 L2 = normalize(vec3(0.6, 0.35, -0.5));",
  "  float d = max(dot(N, L1), 0.0) * 0.75 + max(dot(N, L2), 0.0) * 0.30;",
  "  vec3 V = normalize(uEye - vWorld);",
  "  vec3 H = normalize(L1 + V);",
  "  float sp = pow(max(dot(N, H), 0.0), 34.0) * uSpec;",
  "  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.10;",
  "  vec3 c = uColor * (0.34 + d) + vec3(sp) + vec3(rim);",
  "  gl_FragColor = vec4(c, uAlpha);",
  "}"].join("\n");
var VSH_TEX = [
  "attribute vec3 aPos; attribute vec2 aUV;",
  "uniform mat4 uProj, uView, uModel;",
  "varying vec2 vUV;",
  "void main(){ vUV = aUV; gl_Position = uProj * uView * uModel * vec4(aPos, 1.0); }"].join("\n");
var FSH_TEX = [
  "precision mediump float;",
  "uniform sampler2D uTex;",
  "varying vec2 vUV;",
  "void main(){ gl_FragColor = texture2D(uTex, vUV); }"].join("\n");

/* ---------- board texture (painted on an offscreen canvas) ---------- */
function boardTexture(themeName) {
  var th = THEMES[themeName], S = 1024, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  var g = cv.getContext("2d");
  var margin = S * 0.055, cell = (S - margin * 2) / 8;
  g.fillStyle = th.margin; g.fillRect(0, 0, S, S);
  /* faint long grain in the margin */
  g.globalAlpha = 0.10;
  for (var gy = 0; gy < S; gy += 7) {
    g.fillStyle = (gy % 3) ? "#000" : "#fff";
    g.fillRect(0, gy, S, 1.5);
  }
  g.globalAlpha = 1;
  for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
    /* canvas row 0 is the top of the texture = rank 8 */
    var x = margin + f * cell, y = margin + r * cell;
    g.fillStyle = ((f + (7 - r)) % 2 === 0) ? th.dark : th.light;
    g.fillRect(x, y, cell + 1, cell + 1);
    /* soft per-square grain */
    g.globalAlpha = 0.05;
    for (var i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? "#000" : "#fff";
      g.fillRect(x, y + ((f * 13 + r * 29 + i * 17) % cell), cell, 1.2);
    }
    g.globalAlpha = 1;
  }
  g.fillStyle = th.coord;
  g.font = "600 " + Math.round(margin * 0.62) + "px system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  for (var k = 0; k < 8; k++) {
    g.fillText("abcdefgh"[k], margin + (k + 0.5) * cell, S - margin * 0.48);
    g.fillText(String(8 - k), margin * 0.48, margin + (k + 0.5) * cell);
  }
  return cv;
}

/* ---------- renderer ---------- */
function create(canvas, opts) {
  opts = opts || {};
  var gl = canvas.getContext("webgl", { antialias: true, alpha: false }) ||
           canvas.getContext("experimental-webgl", { antialias: true, alpha: false });
  if (!gl) return null;

  var R = {
    kind: "3d", themeName: "walnut", orientation: 1,
    board: new Int8Array(128),
    hi: { selected: -1, legal: [], legalCapt: [], last: null, check: -1, hint: null },
    anim: null, drops: null, lost: false, dirty: true
  };

  canvas.addEventListener("webglcontextlost", function (e) {
    e.preventDefault();
    R.lost = true;
    if (opts.onContextLost) opts.onContextLost();
  }, false);

  function shader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
    return p;
  }
  var prog = program(VSH, FSH);
  var progTex = program(VSH_TEX, FSH_TEX);
  var U = {
    proj: gl.getUniformLocation(prog, "uProj"), view: gl.getUniformLocation(prog, "uView"),
    model: gl.getUniformLocation(prog, "uModel"), color: gl.getUniformLocation(prog, "uColor"),
    alpha: gl.getUniformLocation(prog, "uAlpha"), eye: gl.getUniformLocation(prog, "uEye"),
    flat: gl.getUniformLocation(prog, "uFlat"), spec: gl.getUniformLocation(prog, "uSpec"),
    aPos: gl.getAttribLocation(prog, "aPos"), aNrm: gl.getAttribLocation(prog, "aNrm")
  };
  var UT = {
    proj: gl.getUniformLocation(progTex, "uProj"), view: gl.getUniformLocation(progTex, "uView"),
    model: gl.getUniformLocation(progTex, "uModel"), tex: gl.getUniformLocation(progTex, "uTex"),
    aPos: gl.getAttribLocation(progTex, "aPos"), aUV: gl.getAttribLocation(progTex, "aUV")
  };

  /* mesh upload: interleave pos+normal */
  function upload(geo, deform) {
    var pos = geo.pos.slice();
    if (deform) deform(pos);
    var nrm = computeNormals(pos, geo.idx);
    var inter = new Float32Array(pos.length * 2);
    for (var i = 0, v = 0; i < pos.length; i += 3, v += 6) {
      inter[v] = pos[i]; inter[v+1] = pos[i+1]; inter[v+2] = pos[i+2];
      inter[v+3] = nrm[i]; inter[v+4] = nrm[i+1]; inter[v+5] = nrm[i+2];
    }
    var vb = gl.createBuffer(), ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geo.idx), gl.STATIC_DRAW);
    return { vb: vb, ib: ib, n: geo.idx.length };
  }

  var SEGS = 28;
  var MESH = [null,
    upload(lathe(pawnProfile(), SEGS)),
    upload(lathe(knightProfile(), SEGS), knightDeform),
    upload(lathe(bishopProfile(), SEGS)),
    upload(lathe(rookProfile(), SEGS)),
    upload(lathe(queenProfile(), SEGS)),
    upload(lathe(kingProfile(), SEGS))
  ];
  var SCALE = [0, 0.86, 0.94, 0.98, 0.92, 1.06, 1.14];  /* per-kind height feel */
  var MESH_DISC = upload(disc(36));
  var MESH_RING = upload(ring(40, 0.82));
  var MESH_QUAD = upload(quadXZ());

  /* rim: a shallow box under the board, drawn with the lit shader */
  var rimGeo = (function () {
    var w = 4.62, h = 0.30, pos = [], idx = [];
    var pts = [[-w,-w],[w,-w],[w,w],[-w,w]];
    for (var i = 0; i < 4; i++) {
      var a = pts[i], b = pts[(i+1)%4];
      var s = pos.length / 3;
      pos.push(a[0], 0.0, a[1],  b[0], 0.0, b[1],  b[0], -h, b[1],  a[0], -h, a[1]);
      idx.push(s, s+1, s+2, s, s+2, s+3);
    }
    var s2 = pos.length / 3;   /* bottom cap */
    pos.push(-w,-h,-w, w,-h,-w, w,-h,w, -w,-h,w);
    idx.push(s2, s2+2, s2+1, s2, s2+3, s2+2);
    /* top margin lip: thin ring around the texture quad */
    return { pos: pos, idx: idx };
  })();
  var MESH_RIM = upload(rimGeo);

  /* board texture quad (size 9.24 to include painted margin) */
  var texQuad = (function () {
    var s = 4.62;
    var vb = gl.createBuffer(), ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -s, 0, -s, 0, 0,   s, 0, -s, 1, 0,   s, 0, s, 1, 1,   -s, 0, s, 0, 1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 2, 1, 0, 3, 2]), gl.STATIC_DRAW);
    return { vb: vb, ib: ib, n: 6 };
  })();

  var boardTex = gl.createTexture();
  function loadBoardTex() {
    gl.bindTexture(gl.TEXTURE_2D, boardTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, boardTexture(R.themeName));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  loadBoardTex();

  /* ---------- camera: an orbit on springs ---------- */
  var cam = {
    yaw: Math.PI / 2, pitch: 0.98, dist: 12.6,
    tYaw: Math.PI / 2, tPitch: 0.98, tDist: 12.6,
    eye: [0, 0, 0]
  };
  /* the look-target leans a touch toward the camera so the near rank
     never falls off the bottom of the screen, whatever the yaw */
  function camTarget() {
    return [cam.eye[0] * 0.055, -0.4, cam.eye[2] * 0.055];
  }
  R.orbit = function (dx, dy) {
    cam.tYaw -= dx * 0.008;
    cam.tPitch = Math.min(1.35, Math.max(0.30, cam.tPitch + dy * 0.006));
    R.dirty = true;
  };
  R.zoom = function (f) {
    cam.tDist = Math.min(17, Math.max(6.5, cam.tDist * f));
    R.dirty = true;
  };
  R.setOrientation = function (color) {
    R.orientation = color;
    cam.tYaw = color === 1 ? Math.PI / 2 : -Math.PI / 2;
    R.dirty = true;
  };
  R.resetView = function () {
    cam.tPitch = 0.98; cam.tDist = 12.6;
    cam.tYaw = R.orientation === 1 ? Math.PI / 2 : -Math.PI / 2;
    R.dirty = true;
  };

  function fileOf(sq) { return sq & 7; }
  function rankOf(sq) { return sq >> 4; }
  function onSq(sq) { return (sq & 0x88) === 0; }
  function sqX(sq) { return fileOf(sq) - 3.5; }
  function sqZ(sq) { return 3.5 - rankOf(sq); }

  var proj = mIdent(), view = mIdent();

  R.resize = function () {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    R.dirty = true;
  };

  R.setTheme = function (name) {
    if (!THEMES[name]) name = "walnut";
    R.themeName = name;
    loadBoardTex();
    R.dirty = true;
  };
  R.setPosition = function (board, o) {
    R.board.set(board);
    R.anim = null;
    if (o && o.flourish && !REDUCED) {
      R.drops = { t0: performance.now(), dur: 900 };
    }
    R.dirty = true;
  };
  R.setHighlights = function (hi) {
    R.hi.selected = hi.selected != null ? hi.selected : -1;
    R.hi.legal = hi.legal || [];
    R.hi.legalCapt = hi.legalCapt || [];
    R.hi.last = hi.last || null;
    R.hi.check = hi.check != null ? hi.check : -1;
    R.hi.hint = hi.hint || null;
    R.dirty = true;
  };
  R.animateMove = function (m, after, o, done) {
    o = o || {};
    R.anim = { m: m, after: new Int8Array(after), t0: performance.now(),
               dur: REDUCED ? 1 : (o.dur || 380), glow: !!o.glow, done: done || null };
    R.dirty = true;
  };
  R.isAnimating = function () { return !!R.anim; };

  /* unproject a click to the y=0 plane */
  R.screenToSquare = function (px, py) {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    var ndcX = (px / w) * 2 - 1, ndcY = 1 - (py / h) * 2;
    /* build the ray in world space from the inverse view basis (the view
       matrix is orthonormal rotation + translation, so invert by hand) */
    var fovY = 0.72, aspect = w / h;
    var tanY = Math.tan(fovY / 2), tanX = tanY * aspect;
    /* camera basis vectors from the view matrix rows */
    var rx = [view[0], view[4], view[8]], ry = [view[1], view[5], view[9]], rz = [view[2], view[6], view[10]];
    var dir = [
      rx[0]*ndcX*tanX + ry[0]*ndcY*tanY - rz[0],
      rx[1]*ndcX*tanX + ry[1]*ndcY*tanY - rz[1],
      rx[2]*ndcX*tanX + ry[2]*ndcY*tanY - rz[2]];
    var eye = cam.eye;
    if (Math.abs(dir[1]) < 1e-6) return -1;
    var t = -eye[1] / dir[1];
    if (t <= 0) return -1;
    var x = eye[0] + dir[0]*t, z = eye[2] + dir[2]*t;
    var f = Math.round(x + 3.5), r = Math.round(3.5 - z);
    if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
    return r * 16 + f;
  };

  function bindMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vb);
    gl.enableVertexAttribArray(U.aPos);
    gl.vertexAttribPointer(U.aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(U.aNrm);
    gl.vertexAttribPointer(U.aNrm, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
  }
  function drawMesh(mesh, model, color, alpha, flat, spec) {
    gl.uniformMatrix4fv(U.model, false, model);
    gl.uniform3fv(U.color, color);
    gl.uniform1f(U.alpha, alpha);
    gl.uniform1f(U.flat, flat ? 1 : 0);
    gl.uniform1f(U.spec, spec == null ? 0.35 : spec);
    gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_SHORT, 0);
  }

  function hexToVec(h) {
    return [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
  }

  function drawPiece(piece, x, z, yLift, alpha, scaleMul, th) {
    var kind = Math.abs(piece), white = piece > 0;
    var mesh = MESH[kind];
    if (!mesh) return;
    var s = SCALE[kind] * (scaleMul || 1);
    /* knights face the opponent */
    var ry = kind === 2 ? (white ? Math.PI / 2 : -Math.PI / 2) : 0;
    var al = alpha == null ? 1 : alpha;
    /* shadow stays on the ground, thins as the piece lifts */
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    bindMesh(MESH_DISC);
    drawMesh(MESH_DISC, mModel(x, 0.012, z, 0.36 * s, 0), [0, 0, 0], 0.24 * al / (1 + Math.max(0, yLift) * 1.6), true);
    gl.depthMask(true);
    if (al >= 1) gl.disable(gl.BLEND);
    bindMesh(mesh);
    drawMesh(mesh, mModel(x, yLift || 0, z, s, ry),
      white ? th.white : th.black, al, false, white ? 0.5 : 0.9);
    gl.disable(gl.BLEND);
  }

  function drawFlatSq(sq, color, alpha, mesh, scale, y) {
    drawMesh(mesh || MESH_QUAD, mModel(sqX(sq), y || 0.015, sqZ(sq), scale || 0.98, 0), color, alpha, true);
  }

  /* dynamic arrow mesh for hints */
  var arrowBuf = gl.createBuffer(), arrowIdx = gl.createBuffer();
  function drawArrow(from, to, color) {
    var x0 = sqX(from), z0 = sqZ(from), x1 = sqX(to), z1 = sqZ(to);
    var dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.1) return;
    var ux = dx / len, uz = dz / len, px = -uz, pz = ux;
    var w = 0.13, head = 0.34, y = 0.02;
    var hx = x1 - ux * 0.32, hz = z1 - uz * 0.32;        /* arrow tip pulls short of centre */
    var bx = hx - ux * head, bz = hz - uz * head;
    var sx = x0 + ux * 0.30, sz = z0 + uz * 0.30;
    var v = new Float32Array([
      sx + px*w, y, sz + pz*w, 0,0,0,  sx - px*w, y, sz - pz*w, 0,0,0,
      bx - px*w, y, bz - pz*w, 0,0,0,  bx + px*w, y, bz + pz*w, 0,0,0,
      bx + px*head*0.62, y, bz + pz*head*0.62, 0,0,0,
      bx - px*head*0.62, y, bz - pz*head*0.62, 0,0,0,
      hx, y, hz, 0,0,0]);
    gl.bindBuffer(gl.ARRAY_BUFFER, arrowBuf);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(U.aPos);
    gl.vertexAttribPointer(U.aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(U.aNrm);
    gl.vertexAttribPointer(U.aNrm, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, arrowIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2, 0,2,3, 4,5,6]), gl.DYNAMIC_DRAW);
    gl.uniformMatrix4fv(U.model, false, mIdent());
    gl.uniform3fv(U.color, color);
    gl.uniform1f(U.alpha, 0.85);
    gl.uniform1f(U.flat, 1);
    gl.drawElements(gl.TRIANGLES, 9, gl.UNSIGNED_SHORT, 0);
  }

  function ease(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }

  R.frame = function () {
    if (R.lost) return false;
    var th = THEMES[R.themeName];
    /* camera springs */
    var moving = false;
    var k = REDUCED ? 1 : 0.14;
    var dy = cam.tYaw - cam.yaw, dp = cam.tPitch - cam.pitch, dd = cam.tDist - cam.dist;
    if (Math.abs(dy) + Math.abs(dp) + Math.abs(dd) > 0.0008) {
      cam.yaw += dy * k; cam.pitch += dp * k; cam.dist += dd * k;
      moving = true;
    } else { cam.yaw = cam.tYaw; cam.pitch = cam.tPitch; cam.dist = cam.tDist; }

    var a = R.anim, aprog = 0, animating = false;
    if (a) {
      aprog = Math.min(1, (performance.now() - a.t0) / a.dur);
      animating = aprog < 1;
    }
    var dropping = false, dropT = 0;
    if (R.drops) {
      dropT = (performance.now() - R.drops.t0) / R.drops.dur;
      if (dropT >= 1) R.drops = null; else dropping = true;
    }
    if (!R.dirty && !moving && !animating && !dropping) return false;

    var ex = Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
    var ey = Math.sin(cam.pitch) * cam.dist;
    var ez = Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist;
    cam.eye = [ex, ey, ez];
    proj = mPersp(0.72, canvas.width / canvas.height, 0.5, 80);
    view = mLookAt(cam.eye, camTarget(), [0, 1, 0]);

    gl.clearColor(th.bg[0], th.bg[1], th.bg[2], 1);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    /* rim */
    gl.useProgram(prog);
    gl.uniformMatrix4fv(U.proj, false, proj);
    gl.uniformMatrix4fv(U.view, false, view);
    gl.uniform3fv(U.eye, cam.eye);
    bindMesh(MESH_RIM);
    drawMesh(MESH_RIM, mModel(0, -0.002, 0, 1, 0), hexToVec(th.rim), 1, false, 0.12);

    /* board top */
    gl.useProgram(progTex);
    gl.uniformMatrix4fv(UT.proj, false, proj);
    gl.uniformMatrix4fv(UT.view, false, view);
    gl.uniformMatrix4fv(UT.model, false, mIdent());
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, boardTex);
    gl.uniform1i(UT.tex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, texQuad.vb);
    gl.enableVertexAttribArray(UT.aPos);
    gl.vertexAttribPointer(UT.aPos, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(UT.aUV);
    gl.vertexAttribPointer(UT.aUV, 2, gl.FLOAT, false, 20, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, texQuad.ib);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    /* highlights (flat, just above the wood) */
    gl.useProgram(prog);
    gl.depthMask(false);
    bindMesh(MESH_QUAD);
    if (R.hi.last) {
      drawFlatSq(R.hi.last[0], th.last, 0.30);
      drawFlatSq(R.hi.last[1], th.last, 0.45);
    }
    if (R.hi.selected >= 0) drawFlatSq(R.hi.selected, th.selected, 0.5);
    if (R.hi.check >= 0) drawFlatSq(R.hi.check, th.check, 0.45);
    bindMesh(MESH_DISC);
    for (var li = 0; li < R.hi.legal.length; li++) {
      drawMesh(MESH_DISC, mModel(sqX(R.hi.legal[li]), 0.02, sqZ(R.hi.legal[li]), 0.13, 0), th.legal, 0.55, true);
    }
    bindMesh(MESH_RING);
    for (var ci = 0; ci < R.hi.legalCapt.length; ci++) {
      drawMesh(MESH_RING, mModel(sqX(R.hi.legalCapt[ci]), 0.02, sqZ(R.hi.legalCapt[ci]), 0.46, 0), th.capt, 0.6, true);
    }
    if (R.hi.hint) drawArrow(R.hi.hint[0], R.hi.hint[1], th.hint);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    /* pieces */
    var skip = {};
    if (a) {
      skip[a.m.from] = true; skip[a.m.to] = true;
      if (a.m.rookFrom != null) { skip[a.m.rookFrom] = true; skip[a.m.rookTo] = true; }
      if (a.m.epSq != null) skip[a.m.epSq] = true;
    }
    for (var sq = 0; sq < 128; sq++) {
      if (!onSq(sq) || skip[sq]) continue;
      var piece = a ? (a.after[sq] || 0) : R.board[sq];
      if (!piece) continue;
      var lift = 0, alph = 1;
      if (dropping) {
        /* pieces drift down in a wave from white's side; every square's
           wave finishes strictly before dropT reaches 1, so nothing pops */
        var order = (rankOf(sq) + fileOf(sq) * 0.15) / 12;
        var t = Math.min(1, Math.max(0, (dropT - order * 0.6) / 0.4));
        if (t <= 0) continue;
        lift = (1 - ease(t)) * 2.2;
        alph = Math.min(1, t * 2);
      }
      drawPiece(piece, sqX(sq), sqZ(sq), lift, alph, 1, th);
    }

    if (a) {
      var e = ease(aprog);
      var captPiece = a.m.epSq != null ? R.board[a.m.epSq] : R.board[a.m.to];
      if (captPiece) {
        var cx = a.m.epSq != null ? sqX(a.m.epSq) : sqX(a.m.to);
        var cz = a.m.epSq != null ? sqZ(a.m.epSq) : sqZ(a.m.to);
        drawPiece(captPiece, cx, cz, -0.9 * e, 1 - e, 1 - 0.2 * e, th); /* sinks through the board */
      }
      if (a.m.rookFrom != null) {
        drawPiece(a.after[a.m.rookTo],
          sqX(a.m.rookFrom) + (sqX(a.m.rookTo) - sqX(a.m.rookFrom)) * e,
          sqZ(a.m.rookFrom) + (sqZ(a.m.rookTo) - sqZ(a.m.rookFrom)) * e, 0, 1, 1, th);
      }
      var mover = e > 0.75 && a.m.promo ? a.m.promo : a.m.piece;
      var hop = Math.abs(a.m.piece) === 2 ? Math.sin(aprog * Math.PI) * 0.55 : Math.sin(aprog * Math.PI) * 0.06;
      drawPiece(mover,
        sqX(a.m.from) + (sqX(a.m.to) - sqX(a.m.from)) * e,
        sqZ(a.m.from) + (sqZ(a.m.to) - sqZ(a.m.from)) * e, hop, 1, 1, th);
      if (!animating) {
        R.board.set(a.after);
        R.anim = null;
        if (a.done) { var cb = a.done; a.done = null; setTimeout(cb, 0); }
      }
    }

    R.dirty = animating || moving || dropping;
    return R.dirty;
  };

  R.destroy = function () { R.anim = null; };
  R.resize();
  return R;
}

var Gfx3D = { create: create, THEMES: THEMES };
if (typeof module !== "undefined" && module.exports) module.exports = Gfx3D;
else root.Gfx3D = Gfx3D;
})(typeof self !== "undefined" ? self : this);
