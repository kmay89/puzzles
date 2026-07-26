/* gfx3d.js — the table, in the round.

   Raw WebGL 1. No library, no build step, no shader files: the two
   shaders are strings a few lines long, the bone is a chamfered box
   built from arithmetic, and the pips are painted once into a small
   texture atlas on a 2D canvas and then mapped on.

   Why a chamfered box and not a rounded one: a domino's edge is a
   *bevel*, a flat cut, not a fillet. It is what makes a bone catch the
   light in a hard line down one side instead of a soft gradient, and it
   is the difference between something that reads as a domino and
   something that reads as a lozenge. Eight extra vertices.

   The hand along the bottom is not drawn here — `gfx2d.js` draws it,
   onto a transparent canvas over the top. See the note there; the short
   version is that it keeps the bones you are about to tap crisp and
   keeps the tap target identical in both renderers.

   If the context is lost — and on a phone that has been in a pocket for
   twenty minutes, it will be — `ok` goes false and the room drops to 2D
   mid-hand without losing the game.                                   */
(function (root) {
"use strict";

var L = (typeof require === "function" && typeof module !== "undefined")
  ? require("./layout.js") : root.Layout;
var Rl = (typeof require === "function" && typeof module !== "undefined")
  ? require("./rules.js") : root.Rules;
var Sk = (typeof require === "function" && typeof module !== "undefined")
  ? require("./skins.js") : root.Skins;

/* ---------- just enough matrix maths ---------- */
function m4() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
function mul(a, b, o) {
  o = o || new Float32Array(16);
  for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
    o[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j];
  }
  return o;
}
function persp(fov, asp, n, f) {
  var t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
  o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
  return o;
}
function lookAt(eye, at, up) {
  var z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ]);
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function trs(x, y, z, rotZ, sx, sy, sz) {
  var c = Math.cos(rotZ), s = Math.sin(rotZ);
  return new Float32Array([
    c * sx, s * sx, 0, 0,
    -s * sy, c * sy, 0, 0,
    0, 0, sz, 0,
    x, y, z, 1
  ]);
}

/* ---------- shaders ---------- */
var VS = [
  "attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV;",
  "uniform mat4 uProj, uView, uModel;",
  "varying vec3 vN; varying vec3 vP; varying vec2 vUV;",
  "void main(){",
  "  vec4 wp = uModel * vec4(aPos,1.0);",
  "  vP = wp.xyz;",
  /* the model matrix only ever rotates about z and scales positively,
     so the normal survives it without an inverse-transpose */
  "  vN = normalize((uModel * vec4(aNrm,0.0)).xyz);",
  "  vUV = aUV;",
  "  gl_Position = uProj * uView * wp;",
  "}"
].join("\n");

var FS = [
  "precision mediump float;",
  "varying vec3 vN; varying vec3 vP; varying vec2 vUV;",
  "uniform vec3 uColor, uEye, uLamp;",
  "uniform float uSpec, uPower, uRim, uAlpha, uTex, uAmb;",
  "uniform sampler2D uSampler;",
  "void main(){",
  "  vec3 N = normalize(vN);",
  "  vec3 Ld = normalize(uLamp - vP);",
  "  vec3 V = normalize(uEye - vP);",
  "  vec3 H = normalize(Ld + V);",
  /* Half-Lambert rather than straight Lambert. One bulb over a table
     with a straight dot product gives a face at full brightness and a
     bevel edge at nothing — the bones came out as blown-out white
     slabs with black sides, which is what a single hard light does and
     not at all what a lit table looks like. Wrapping the falloff round
     the shoulder keeps the face bright while leaving the sides lit by
     the bounce off the felt, the way they are in a real room.

     Keeping the whole thing inside [uAmb, 1] is what stops the face
     clipping to white: the cream of the bone stays cream. */
  "  float nd = dot(N, Ld);",
  "  float dif = pow(max(nd * 0.5 + 0.5, 0.0), 1.6);",
  "  float fall = 1.0 - clamp(length(uLamp.xy - vP.xy) / 26.0, 0.0, 1.0);",
  "  float lit = uAmb + (1.0 - uAmb) * dif * (0.66 + 0.34 * fall);",
  "  vec3 base = uColor;",
  "  if (uTex > 0.5) { vec4 t = texture2D(uSampler, vUV); base = mix(uColor, t.rgb, t.a); }",
  "  float spe = pow(max(dot(N, H), 0.0), uPower) * uSpec * (0.4 + 0.6 * fall);",
  "  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * uRim;",
  "  vec3 col = base * lit + vec3(1.0, 0.96, 0.88) * spe + vec3(0.7, 0.8, 1.0) * rim;",
  "  gl_FragColor = vec4(col, uAlpha);",
  "}"
].join("\n");

function compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
  return s;
}

/* ---------- the bone, as geometry ----------
   A chamfered box, built once in unit space: 2 long, 1 wide, and a
   little under a third thick, centred on the origin with the face up.

   The top is two quads rather than one so each half can sample its own
   pip square out of the atlas — which is what lets 28 different bones
   share a single mesh and a single 7-square texture. */
function boneMesh(gl) {
  var hx = L.LEN / 2, hy = L.WID / 2, hz = 0.16, c = 0.055;
  var P = [], N = [], U = [], I = [];
  function quad(a, b, cc, d, n, uvs) {
    var base = P.length / 3, i;
    var vs = [a, b, cc, d];
    for (i = 0; i < 4; i++) {
      P.push(vs[i][0], vs[i][1], vs[i][2]);
      N.push(n[0], n[1], n[2]);
      U.push(uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /* the two top halves. UVs are filled per-draw by rewriting the buffer
     region, so the mesh stays one upload. */
  var ix = hx - c, iy = hy - c;
  quad([-ix, -iy, hz], [0, -iy, hz], [0, iy, hz], [-ix, iy, hz], [0, 0, 1],
       [[0, 1], [1, 1], [1, 0], [0, 0]]);
  quad([0, -iy, hz], [ix, -iy, hz], [ix, iy, hz], [0, iy, hz], [0, 0, 1],
       [[0, 1], [1, 1], [1, 0], [0, 0]]);
  /* the chamfer: four flat cuts around the top edge */
  var d = 0.7071;
  quad([-ix, -iy, hz], [-hx, -hy + c, hz - c], [-hx, hy - c, hz - c], [-ix, iy, hz], [-d, 0, d]);
  quad([ix, -iy, hz], [ix, iy, hz], [hx, hy - c, hz - c], [hx, -hy + c, hz - c], [d, 0, d]);
  quad([-ix, -iy, hz], [ix, -iy, hz], [hx - c, -hy, hz - c], [-hx + c, -hy, hz - c], [0, -d, d]);
  quad([-ix, iy, hz], [-hx + c, hy, hz - c], [hx - c, hy, hz - c], [ix, iy, hz], [0, d, d]);
  /* the four sides, straight down to the felt */
  quad([-hx, -hy + c, hz - c], [-hx, -hy + c, -hz], [-hx, hy - c, -hz], [-hx, hy - c, hz - c], [-1, 0, 0]);
  quad([hx, -hy + c, hz - c], [hx, hy - c, hz - c], [hx, hy - c, -hz], [hx, -hy + c, -hz], [1, 0, 0]);
  quad([-hx + c, -hy, hz - c], [hx - c, -hy, hz - c], [hx - c, -hy, -hz], [-hx + c, -hy, -hz], [0, -1, 0]);
  quad([-hx + c, hy, hz - c], [-hx + c, hy, -hz], [hx - c, hy, -hz], [hx - c, hy, hz - c], [0, 1, 0]);
  /* and the back */
  quad([-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz], [0, 0, -1]);

  var mesh = {
    pos: gl.createBuffer(), nrm: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer(),
    count: I.length, uvData: new Float32Array(U)
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nrm); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(N), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv); gl.bufferData(gl.ARRAY_BUFFER, mesh.uvData, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW);
  return mesh;
}

/* a flat quad for the table top */
function planeMesh(gl, size) {
  var P = [-size, -size, 0, size, -size, 0, size, size, 0, -size, size, 0];
  var N = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  var U = [0, 0, 6, 0, 6, 6, 0, 6];
  var I = [0, 1, 2, 0, 2, 3];
  var m = { pos: gl.createBuffer(), nrm: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer(), count: 6 };
  gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(N), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.uv); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(U), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW);
  return m;
}

/* ---------- the pip atlas ----------
   Seven squares in a row: blank through six. Painted once on a 2D
   canvas with an alpha channel, so the bone's own colour shows through
   and one atlas serves every skin. */
var PIPS = [
  [], [[1, 1]], [[0, 0], [2, 2]], [[0, 0], [1, 1], [2, 2]],
  [[0, 0], [2, 0], [0, 2], [2, 2]],
  [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]]
];
/* Seven squares of 128 in a canvas 1024 wide — eight cells, one spare.

   The spare is not tidiness, it is the whole point. WebGL 1 will only
   build mipmaps for a power-of-two texture, and 7 × 128 = 896 is not
   one. `generateMipmap` then fails *silently*, the texture is left
   incomplete, and an incomplete texture samples as opaque black — so
   every bone on the table came out a black slab while the bones in the
   hand, drawn in 2D, were perfect. Nothing in node can see that, and
   the browser check could not either: it only asked whether the canvas
   had more than one colour on it, and a black bone on brown felt does.
   It took a screenshot to catch, which is why one gets taken. */
var ATLAS_W = 1024, ATLAS_CELLS = 8;
function pipAtlas(gl, pipColour) {
  var S = 128, cv = document.createElement("canvas");
  cv.width = ATLAS_W; cv.height = S;
  var g = cv.getContext("2d");
  for (var n = 0; n <= 6; n++) {
    var ox = n * S, set = PIPS[n];
    /* The divider is a *vertical* band at the right-hand edge of each
       cell, because that edge is what the UVs map to the middle of the
       bone — both halves put their band there and together they make
       one line across it.

       Drawn along the bottom instead (the first attempt) it comes out
       at constant y, which on the bone is a line down its length at the
       far end of each half: invisible under the chamfer, and no divider
       anywhere. The two halves are laid out along x; the seam is at
       u = 1, not v = 1. */
    g.fillStyle = pipColour;
    g.globalAlpha = 0.5;
    g.fillRect(ox + S * 0.955, S * 0.05, S * 0.045, S * 0.90);
    g.globalAlpha = 1;
    for (var i = 0; i < set.length; i++) {
      var px = ox + S * 0.5 + (set[i][0] - 1) * S * 0.29;
      var py = S * 0.5 + (set[i][1] - 1) * S * 0.29;
      g.beginPath(); g.arc(px, py, S * 0.105, 0, Math.PI * 2);
      g.fillStyle = pipColour; g.fill();
      g.beginPath(); g.arc(px - S * 0.03, py - S * 0.03, S * 0.045, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,.22)"; g.fill();
    }
  }
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}

function feltTexture(gl, skin) {
  var cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  var g = cv.getContext("2d");
  g.fillStyle = skin.table.felt; g.fillRect(0, 0, 128, 128);
  var grain = skin.table.grain;
  g.globalAlpha = 0.10 + grain * 0.22;
  for (var i = 0; i < 1400; i++) {
    var x = Math.sin(i * 127.1) * 43758.5453, y = Math.sin(i * 311.7) * 21654.1234;
    x = (x - Math.floor(x)) * 128; y = (y - Math.floor(y)) * 128;
    g.fillStyle = (i % 3) ? skin.table.edge : skin.table.rim;
    g.fillRect(x, y, 1.6, 1.6);
  }
  g.globalAlpha = 1;
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}

function hex3(h) {
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
}

/* ---------- the renderer ---------- */
function Gfx3D(canvas) {
  this.cv = canvas;
  this.kind = "3d";
  this.ok = false;
  var gl = null;
  try {
    /* preserveDrawingBuffer keeps the last frame readable after it has
       been presented. It costs a copy, which for a scene of thirty flat
       bones is nothing, and it buys two real things: the table can be
       screenshotted — by the player wanting to show somebody the hand
       they just won, and by `tools/room-check.js`, which otherwise
       reads back an empty buffer and cannot tell a drawn table from a
       blank one. */
    var attrs = {
      alpha: false, antialias: true, depth: true,
      preserveDrawingBuffer: true, powerPreference: "high-performance"
    };
    gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl", attrs);
  } catch (e) { gl = null; }
  if (!gl) return;
  this.gl = gl;

  var vs = compile(gl, gl.VERTEX_SHADER, VS), fs = compile(gl, gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;
  var pr = gl.createProgram();
  gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  this.pr = pr;
  gl.useProgram(pr);

  this.a = {
    pos: gl.getAttribLocation(pr, "aPos"),
    nrm: gl.getAttribLocation(pr, "aNrm"),
    uv: gl.getAttribLocation(pr, "aUV")
  };
  this.u = {};
  ["uProj", "uView", "uModel", "uColor", "uEye", "uLamp", "uSpec", "uPower",
   "uRim", "uAlpha", "uTex", "uAmb", "uSampler"].forEach(function (n) {
    this.u[n] = gl.getUniformLocation(pr, n);
  }, this);

  this.bone = boneMesh(gl);
  this.plane = planeMesh(gl, 26);
  this.pipTex = null; this.feltTex = null;
  this.skin = null;
  this.orbit = { yaw: 0, pitch: 0.94, dist: 20, target: 0.94 };
  this.ok = true;
  this.lost = false;

  var self = this;
  canvas.addEventListener("webglcontextlost", function (e) {
    e.preventDefault();
    self.ok = false; self.lost = true;
  }, false);
}

Gfx3D.prototype.setSkin = function (skin) {
  this.skin = skin;
  if (!this.ok) return;
  var gl = this.gl;
  if (this.pipTex) gl.deleteTexture(this.pipTex);
  if (this.feltTex) gl.deleteTexture(this.feltTex);
  this.pipTex = pipAtlas(gl, skin.bones.pip);
  this.feltTex = feltTexture(gl, skin);
  this.surf = Sk.surface(skin);
};

Gfx3D.prototype.resize = function (w, h, dpr) {
  this.dpr = dpr || (root.devicePixelRatio || 1);
  /* a phone at 3× spends most of its frame budget on pixels nobody can
     see; 2× is the honest ceiling for a table of flat bones */
  this.dpr = Math.min(this.dpr, 2);
  this.w = w; this.h = h;
  this.cv.width = Math.max(1, Math.round(w * this.dpr));
  this.cv.height = Math.max(1, Math.round(h * this.dpr));
  this.cv.style.width = w + "px";
  this.cv.style.height = h + "px";
  if (this.ok) this.gl.viewport(0, 0, this.cv.width, this.cv.height);
};

/* rewrite the two top quads' UVs so this bone shows the right pips */
Gfx3D.prototype.setFace = function (a, b) {
  var gl = this.gl, u = this.bone.uvData;
  var wA = 1 / ATLAS_CELLS, oA = a * wA, oB = b * wA;
  /* first half: v runs 1→0 so the divider edge lands in the middle */
  u[0] = oA; u[1] = 1; u[2] = oA + wA; u[3] = 1; u[4] = oA + wA; u[5] = 0; u[6] = oA; u[7] = 0;
  u[8] = oB + wA; u[9] = 1; u[10] = oB; u[11] = 1; u[12] = oB; u[13] = 0; u[14] = oB + wA; u[15] = 0;
  gl.bindBuffer(gl.ARRAY_BUFFER, this.bone.uv);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, u);
};

Gfx3D.prototype.bind = function (mesh) {
  var gl = this.gl, a = this.a;
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.enableVertexAttribArray(a.pos);
  gl.vertexAttribPointer(a.pos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nrm); gl.enableVertexAttribArray(a.nrm);
  gl.vertexAttribPointer(a.nrm, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv); gl.enableVertexAttribArray(a.uv);
  gl.vertexAttribPointer(a.uv, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
};

Gfx3D.prototype.draw = function (scene, now) {
  if (!this.ok || !this.skin) return;
  var gl = this.gl, sk = this.skin, u = this.u, i;

  var bg = hex3(sk.room.bg);
  gl.clearColor(bg[0], bg[1], bg[2], 1);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(this.pr);

  /* Frame the whole line of play, however long it has become — worked
     from the field of view rather than guessed, so one bone fills the
     table and twenty still fit.

     At distance d the camera sees 2·d·tan(fov/2) of world height, and
     that times the aspect ratio across. Invert it for the span we have
     to cover, take the tighter of the two axes, and add a little air.
     The distance eases rather than jumps, so the table pulls back as
     the line grows instead of snapping. */
  var bb = scene.table.bbox;
  var spanX = Math.max(3, bb.x1 - bb.x0) + 0.9, spanY = Math.max(2, bb.y1 - bb.y0) + 0.9;
  var asp = this.w / Math.max(1, this.h);
  var vis = 2 * Math.tan(0.86 / 2);
  /* the table is seen at a slant, so its depth foreshortens — the 0.68
     is sin(pitch), the fraction of a bone's length that survives it */
  var need = Math.max(spanX / (vis * Math.max(0.35, asp)), spanY / (vis * 0.68));
  this.orbit.dist += (Math.min(42, Math.max(7, need * 1.06)) - this.orbit.dist) * 0.10;
  var cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;

  /* The camera sits on the near side of the table — smaller y — and
     looks across it. Which side matters: put it on the far side with
     the same "up" and the whole table is mirrored left to right, so the
     bone you play on the left end appears on the right. */
  var pitch = this.orbit.pitch, yaw = this.orbit.yaw, d = this.orbit.dist;
  var eye = [cx + Math.sin(yaw) * d * 0.35,
             cy - Math.cos(pitch) * d,
             Math.sin(pitch) * d];
  var at = [cx, cy, 0];
  var proj = persp(0.86, asp, 0.6, 140);
  var view = lookAt(eye, at, [0, 0, 1]);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);
  gl.uniform3f(u.uEye, eye[0], eye[1], eye[2]);
  gl.uniform3f(u.uLamp, cx, cy - 1.5, 15.0);
  gl.uniform1i(u.uSampler, 0);
  gl.activeTexture(gl.TEXTURE0);

  /* the table */
  gl.bindTexture(gl.TEXTURE_2D, this.feltTex);
  this.bind(this.plane);
  gl.uniformMatrix4fv(u.uModel, false, trs(cx, cy, -0.17, 0, 1, 1, 1));
  var felt = hex3(sk.table.felt);
  gl.uniform3f(u.uColor, felt[0], felt[1], felt[2]);
  gl.uniform1f(u.uSpec, 0.05 + sk.table.gloss * 0.30);
  gl.uniform1f(u.uPower, 14);
  gl.uniform1f(u.uRim, 0);
  gl.uniform1f(u.uAlpha, 1);
  gl.uniform1f(u.uTex, 1);
  gl.uniform1f(u.uAmb, 0.34);
  gl.drawElements(gl.TRIANGLES, this.plane.count, gl.UNSIGNED_SHORT, 0);

  /* the bones */
  var s = this.surf;
  gl.bindTexture(gl.TEXTURE_2D, this.pipTex);
  this.bind(this.bone);
  var face = hex3(sk.bones.face);
  gl.uniform3f(u.uColor, face[0], face[1], face[2]);
  gl.uniform1f(u.uSpec, s.spec);
  gl.uniform1f(u.uPower, s.power);
  gl.uniform1f(u.uRim, s.rim);
  gl.uniform1f(u.uTex, 1);
  gl.uniform1f(u.uAmb, 0.26);
  if (s.translucent) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  gl.uniform1f(u.uAlpha, s.alpha);

  var t = scene.table;
  for (i = 0; i < t.bones.length; i++) {
    var b = t.bones[i];
    var a1 = Rl.A(b.tile), b1 = Rl.B(b.tile);
    if (b.flip) { var tmp = a1; a1 = b1; b1 = tmp; }
    this.setFace(a1, b1);
    var px = b.x, py = b.y, rot = b.rot * Math.PI / 180, z = 0;
    var anim = scene.anim && scene.anim.idx === b.idx ? scene.anim : null;
    if (anim) {
      var k = Math.min(1, anim.t), e = 1 - Math.pow(1 - k, 3);
      px = anim.fromX + (px - anim.fromX) * e;
      py = anim.fromY + (py - anim.fromY) * e;
      rot = (anim.fromRot + (b.rot - anim.fromRot) * e) * Math.PI / 180;
      /* the arc of a bone being brought down on the table, and the
         small bounce of the slam at the end of it */
      z = Math.sin(k * Math.PI) * 2.4 + (k > 0.86 ? Math.sin((k - 0.86) / 0.14 * Math.PI) * 0.16 : 0);
    }
    gl.uniformMatrix4fv(u.uModel, false, trs(px, py, z, rot, 1, 1, 1));
    gl.drawElements(gl.TRIANGLES, this.bone.count, gl.UNSIGNED_SHORT, 0);
  }
  if (s.translucent) gl.disable(gl.BLEND);

  /* the ghost slots, laid flat and faintly, so the ends read as places
     you can put something rather than as decoration */
  if (scene.ghosts && scene.ghosts.length) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    var mk = hex3(sk.marks.ghost);
    gl.uniform3f(u.uColor, mk[0], mk[1], mk[2]);
    gl.uniform1f(u.uTex, 0);
    gl.uniform1f(u.uSpec, 0);
    gl.uniform1f(u.uRim, 0);
    gl.uniform1f(u.uAmb, 0.9);
    gl.uniform1f(u.uAlpha, 0.22 + 0.16 * Math.sin(now / 320));
    for (i = 0; i < scene.ghosts.length; i++) {
      var gh = scene.ghosts[i];
      gl.uniformMatrix4fv(u.uModel, false,
        trs(gh.x, gh.y, -0.14, (gh.h % 2 === 0 ? 0 : Math.PI / 2), 0.94, 0.94, 0.10));
      gl.drawElements(gl.TRIANGLES, this.bone.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /* remember the camera so a tap can be turned back into table coords */
  this.lastCam = { eye: eye, at: at, proj: proj, view: view, cx: cx, cy: cy };
};

/* ---------- turning a tap back into a place on the table ----------
   The table is the plane z = 0, so a tap is one ray-plane intersection
   rather than any kind of picking pass: unproject the pixel onto the
   near and far planes, and see where the line between them crosses.
   Exact, and free. */
Gfx3D.prototype.pointOnTable = function (px, py) {
  var c = this.lastCam;
  if (!c) return null;
  var ndcX = (px / this.w) * 2 - 1, ndcY = 1 - (py / this.h) * 2;
  var inv = invert(mul(c.proj, c.view, new Float32Array(16)));
  if (!inv) return null;
  var n = xform(inv, [ndcX, ndcY, -1, 1]), f = xform(inv, [ndcX, ndcY, 1, 1]);
  if (!n || !f) return null;
  var dz = f[2] - n[2];
  if (Math.abs(dz) < 1e-6) return null;
  var t = (0 - n[2]) / dz;
  if (t < 0) return null;
  return { x: n[0] + (f[0] - n[0]) * t, y: n[1] + (f[1] - n[1]) * t };
};

function xform(m, v) {
  var o = [];
  for (var i = 0; i < 4; i++) o[i] = m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3];
  if (!o[3]) return null;
  return [o[0] / o[3], o[1] / o[3], o[2] / o[3]];
}
function invert(m) {
  var i = new Float32Array(16), a = m;
  i[0] = a[5]*a[10]*a[15]-a[5]*a[11]*a[14]-a[9]*a[6]*a[15]+a[9]*a[7]*a[14]+a[13]*a[6]*a[11]-a[13]*a[7]*a[10];
  i[4] = -a[4]*a[10]*a[15]+a[4]*a[11]*a[14]+a[8]*a[6]*a[15]-a[8]*a[7]*a[14]-a[12]*a[6]*a[11]+a[12]*a[7]*a[10];
  i[8] = a[4]*a[9]*a[15]-a[4]*a[11]*a[13]-a[8]*a[5]*a[15]+a[8]*a[7]*a[13]+a[12]*a[5]*a[11]-a[12]*a[7]*a[9];
  i[12] = -a[4]*a[9]*a[14]+a[4]*a[10]*a[13]+a[8]*a[5]*a[14]-a[8]*a[6]*a[13]-a[12]*a[5]*a[10]+a[12]*a[6]*a[9];
  i[1] = -a[1]*a[10]*a[15]+a[1]*a[11]*a[14]+a[9]*a[2]*a[15]-a[9]*a[3]*a[14]-a[13]*a[2]*a[11]+a[13]*a[3]*a[10];
  i[5] = a[0]*a[10]*a[15]-a[0]*a[11]*a[14]-a[8]*a[2]*a[15]+a[8]*a[3]*a[14]+a[12]*a[2]*a[11]-a[12]*a[3]*a[10];
  i[9] = -a[0]*a[9]*a[15]+a[0]*a[11]*a[13]+a[8]*a[1]*a[15]-a[8]*a[3]*a[13]-a[12]*a[1]*a[11]+a[12]*a[3]*a[9];
  i[13] = a[0]*a[9]*a[14]-a[0]*a[10]*a[13]-a[8]*a[1]*a[14]+a[8]*a[2]*a[13]+a[12]*a[1]*a[10]-a[12]*a[2]*a[9];
  i[2] = a[1]*a[6]*a[15]-a[1]*a[7]*a[14]-a[5]*a[2]*a[15]+a[5]*a[3]*a[14]+a[13]*a[2]*a[7]-a[13]*a[3]*a[6];
  i[6] = -a[0]*a[6]*a[15]+a[0]*a[7]*a[14]+a[4]*a[2]*a[15]-a[4]*a[3]*a[14]-a[12]*a[2]*a[7]+a[12]*a[3]*a[6];
  i[10] = a[0]*a[5]*a[15]-a[0]*a[7]*a[13]-a[4]*a[1]*a[15]+a[4]*a[3]*a[13]+a[12]*a[1]*a[7]-a[12]*a[3]*a[5];
  i[14] = -a[0]*a[5]*a[14]+a[0]*a[6]*a[13]+a[4]*a[1]*a[14]-a[4]*a[2]*a[13]-a[12]*a[1]*a[6]+a[12]*a[2]*a[5];
  i[3] = -a[1]*a[6]*a[11]+a[1]*a[7]*a[10]+a[5]*a[2]*a[11]-a[5]*a[3]*a[10]-a[9]*a[2]*a[7]+a[9]*a[3]*a[6];
  i[7] = a[0]*a[6]*a[11]-a[0]*a[7]*a[10]-a[4]*a[2]*a[11]+a[4]*a[3]*a[10]+a[8]*a[2]*a[7]-a[8]*a[3]*a[6];
  i[11] = -a[0]*a[5]*a[11]+a[0]*a[7]*a[9]+a[4]*a[1]*a[11]-a[4]*a[3]*a[9]-a[8]*a[1]*a[7]+a[8]*a[3]*a[5];
  i[15] = a[0]*a[5]*a[10]-a[0]*a[6]*a[9]-a[4]*a[1]*a[10]+a[4]*a[2]*a[9]+a[8]*a[1]*a[6]-a[8]*a[2]*a[5];
  var det = a[0] * i[0] + a[1] * i[4] + a[2] * i[8] + a[3] * i[12];
  if (!det) return null;
  det = 1 / det;
  for (var k = 0; k < 16; k++) i[k] *= det;
  return i;
}

/* which end of the line a tap landed nearest, if any. The hand is not
   tested here — the 2D overlay owns it. */
Gfx3D.prototype.hitTable = function (px, py, scene) {
  var p = this.pointOnTable(px, py);
  if (!p || !scene.ghosts) return null;
  var best = null, bd = 1e9;
  for (var i = 0; i < scene.ghosts.length; i++) {
    var gh = scene.ghosts[i];
    var d = Math.hypot(p.x - gh.x, p.y - gh.y);
    if (d < bd) { bd = d; best = gh; }
  }
  /* a bone is 2 × 1, so anything within about a bone's length of the
     slot is a clear intent to play there */
  return (best && bd < 2.2) ? { kind: "end", end: best.end, dist: bd } : null;
};

Gfx3D.prototype.destroy = function () {
  if (!this.gl) return;
  var gl = this.gl;
  try {
    if (this.pipTex) gl.deleteTexture(this.pipTex);
    if (this.feltTex) gl.deleteTexture(this.feltTex);
    if (this.pr) gl.deleteProgram(this.pr);
  } catch (e) { /* the context may already be gone; nothing to free */ }
  this.ok = false;
};

if (typeof module !== "undefined" && module.exports) module.exports = Gfx3D;
else root.Gfx3D = Gfx3D;
})(typeof self !== "undefined" ? self : this);
