/* gfx.js — the world, drawn.

   Raw WebGL 1, no library. One shader pair, one texture atlas painted
   at load time, one buffer per section.

   ## The atlas is painted, not downloaded

   Every material in `blocks.js` is a description — a colour, a
   graininess, whether it streaks like wood or carries books — and this
   file paints each into a 64-pixel cell of one atlas on a 2D canvas
   when the page loads. Nothing is fetched, nothing is bundled, and
   nothing is anybody else's artwork.

   The atlas is **512 × 256, both powers of two**, and that is not a
   coincidence: WebGL 1 silently refuses to build mipmaps for a texture
   that is not, leaves it incomplete, and samples it as opaque black.
   Not an error, not a warning — a world rendered in solid black. Any
   change to the cell size or the material count has to keep both
   dimensions powers of two.

   ## Tiling out of an atlas

   A merged quad covers many blocks, so its texture has to repeat — and
   repeating *inside* an atlas cell means taking the fractional part of
   the coordinate per fragment, which bleeds into the neighbouring cell
   at the edges and cannot use mipmaps without visible seams. So each
   cell is sampled with a one-pixel inset and mipmaps are off; the world
   is blocky by nature and loses nothing by it.                        */
(function (root) {
"use strict";

var need = (typeof require === "function" && typeof module !== "undefined");
var Blocks = need ? require("./blocks.js") : root.Blocks;
var Mesher = need ? require("./mesher.js") : root.Mesher;

/* ---------- matrices ---------- */
function persp(fov, asp, n, f) {
  var t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
  o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
  return o;
}
function lookAt(eye, at, up) {
  var z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ]);
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
/* a·b, in that order.

   Worth being pedantic about, because the obvious-looking loop computes
   b·a instead and nothing complains: the world still renders, every
   triangle is still submitted, and the picture is a flat expanse of sky
   because everything projected to somewhere off screen. Column-major
   means element (row r, col c) lives at m[c*4 + r], so:

       (a·b)[r][c] = Σk a[r][k] · b[k][c]
                   = Σk a[k*4 + r] · b[c*4 + k]                        */
function mul(a, b) {
  var o = new Float32Array(16);
  for (var c = 0; c < 4; c++) {
    for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                     a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

var CELL = 64, COLS = 8, ROWS = 4;          /* 512 × 256 — both powers of two */

var VS = [
  "attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUV; attribute float aMat;",
  "uniform mat4 uVP;",
  "varying vec3 vN; varying vec2 vUV; varying float vMat; varying float vDist; varying vec3 vP;",
  "void main(){",
  "  vN = aNrm; vUV = aUV; vMat = aMat; vP = aPos;",
  "  vec4 p = uVP * vec4(aPos, 1.0);",
  "  vDist = p.w;",
  "  gl_Position = p;",
  "}"
].join("\n");

var FS = [
  "precision mediump float;",
  "varying vec3 vN; varying vec2 vUV; varying float vMat; varying float vDist; varying vec3 vP;",
  "uniform sampler2D uAtlas;",
  "uniform vec3 uSun, uFog, uEye;",
  "uniform float uFogNear, uFogFar, uGlowCut;",
  "void main(){",
  /* pick this material's cell, then tile inside it with a one-texel
     inset so neighbouring cells cannot bleed in at the seams */
  "  float m = floor(vMat + 0.5);",
  "  vec2 cell = vec2(mod(m, 8.0), floor(m / 8.0));",
  "  vec2 f = fract(vUV);",
  "  vec2 inset = (f * 62.0 + 1.0) / 64.0;",
  "  vec2 uv = (cell + inset) / vec2(8.0, 4.0);",
  "  vec4 tex = texture2D(uAtlas, uv);",
  /* three-tone directional light: a sun, a cool sky bounce, and a
     floor bounce, so the six faces of a cube are all distinguishable
     without any shadow pass */
  "  vec3 N = normalize(vN);",
  "  float sun = max(dot(N, normalize(uSun)), 0.0);",
  "  float sky = max(N.y, 0.0) * 0.35;",
  "  float bounce = max(-N.y, 0.0) * 0.12;",
  "  float side = abs(N.x) * 0.06;",
  "  float lit = 0.34 + sun * 0.62 + sky + bounce + side;",
  "  vec3 col = tex.rgb * lit;",
  /* materials marked as glowing light themselves rather than waiting
     for the sun — the lanterns are what make a library at night read */
  "  if (tex.a > 0.99 && m > uGlowCut - 0.5 && m < uGlowCut + 0.5) col = tex.rgb * 1.25;",
  "  float fog = clamp((vDist - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);",
  "  col = mix(col, uFog, fog * fog);",
  "  gl_FragColor = vec4(col, tex.a);",
  "}"
].join("\n");

function compile(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    var log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("shader: " + log);
  }
  return s;
}

/* ---------- painting the atlas ----------
   Deterministic noise so a wall looks the same every time the page is
   opened, and so a screenshot is reproducible. */
function hash(i) { var x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); }

function paintAtlas() {
  var cv = document.createElement("canvas");
  cv.width = CELL * COLS; cv.height = CELL * ROWS;
  var g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);

  Blocks.MATERIALS.forEach(function (m, idx) {
    var ox = (idx % COLS) * CELL, oy = Math.floor(idx / COLS) * CELL;
    if (idx === 0) return;                                  /* air is never drawn */
    g.save();
    g.beginPath(); g.rect(ox, oy, CELL, CELL); g.clip();
    g.fillStyle = m.colour;
    g.fillRect(ox, oy, CELL, CELL);

    var n = Math.round(m.grain * 900), i;
    /* grain: speckle, or long streaks for anything with a wood figure */
    if (m.streak) {
      for (i = 0; i < 26; i++) {
        var yy = oy + hash(idx * 31 + i) * CELL;
        g.globalAlpha = 0.05 + hash(idx + i) * m.grain * 0.35;
        g.fillStyle = (i % 2) ? "#000" : "#fff";
        g.fillRect(ox, yy, CELL, 1 + hash(i * 7) * 2.5);
      }
    } else {
      for (i = 0; i < n; i++) {
        var px = ox + hash(idx * 71 + i) * CELL, py = oy + hash(idx * 13 + i + 5) * CELL;
        g.globalAlpha = 0.04 + hash(i + idx) * 0.16;
        g.fillStyle = hash(i * 3 + idx) > 0.5 ? "#000" : "#fff";
        g.fillRect(px, py, 1 + hash(i) * 2, 1 + hash(i + 9) * 2);
      }
    }
    g.globalAlpha = 1;

    /* the shelves get actual books, because a library made of flat
       brown squares is not a library */
    if (m.books) {
      for (var row = 0; row < 2; row++) {
        var by = oy + 6 + row * 28;
        g.fillStyle = "rgba(40,26,14,.55)";
        g.fillRect(ox + 2, by + 22, CELL - 4, 4);
        var x = ox + 4;
        while (x < ox + CELL - 6) {
          var bw = 3 + Math.floor(hash(x + row * 17 + idx) * 5);
          var bh = 14 + Math.floor(hash(x * 3 + row) * 7);
          var hue = Math.floor(hash(x * 5 + row * 3) * 360);
          g.fillStyle = "hsl(" + hue + ",44%," + (34 + Math.floor(hash(x) * 26)) + "%)";
          g.fillRect(x, by + 22 - bh, bw, bh);
          x += bw + 1;
        }
      }
    }
    /* a thin darker border so every block edge reads at distance */
    g.strokeStyle = "rgba(0,0,0,.30)";
    g.lineWidth = 2;
    g.strokeRect(ox + 1, oy + 1, CELL - 2, CELL - 2);

    /* glass and water are see-through: keep some alpha */
    if (m.alpha !== undefined && m.alpha > 0 && m.alpha < 1) {
      var img = g.getImageData(ox, oy, CELL, CELL);
      for (i = 3; i < img.data.length; i += 4) img.data[i] = Math.round(255 * m.alpha);
      g.putImageData(img, ox, oy);
    }
    g.restore();
  });
  return cv;
}

/* ---------- the renderer ---------- */
function Gfx(canvas) {
  this.cv = canvas;
  this.ok = false;
  this.chunks = new Map();
  var gl = null;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: true, depth: true, preserveDrawingBuffer: true })
      || canvas.getContext("experimental-webgl", { alpha: false, antialias: true, depth: true, preserveDrawingBuffer: true });
  } catch (e) { gl = null; }
  if (!gl) return;
  this.gl = gl;

  try {
    var pr = gl.createProgram();
    gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    this.pr = pr;
  } catch (e) { this.error = e.message; return; }

  gl.useProgram(this.pr);
  this.a = {
    pos: gl.getAttribLocation(this.pr, "aPos"),
    nrm: gl.getAttribLocation(this.pr, "aNrm"),
    uv: gl.getAttribLocation(this.pr, "aUV"),
    mat: gl.getAttribLocation(this.pr, "aMat")
  };
  this.u = {};
  ["uVP", "uAtlas", "uSun", "uFog", "uEye", "uFogNear", "uFogFar", "uGlowCut"].forEach(function (n) {
    this.u[n] = gl.getUniformLocation(this.pr, n);
  }, this);

  /* the atlas */
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paintAtlas());
  /* no mipmaps: tiling inside an atlas cell and mipmapping do not mix */
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  this.tex = tex;

  this.ok = true;
  var self = this;
  canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); self.ok = false; self.lost = true; }, false);
}

Gfx.prototype.resize = function (w, h, dpr) {
  this.dpr = Math.min(dpr || (root.devicePixelRatio || 1), 2);
  this.w = w; this.h = h;
  this.cv.width = Math.max(1, Math.round(w * this.dpr));
  this.cv.height = Math.max(1, Math.round(h * this.dpr));
  this.cv.style.width = w + "px";
  this.cv.style.height = h + "px";
  if (this.ok) this.gl.viewport(0, 0, this.cv.width, this.cv.height);
};

/* upload one section's mesh; an empty section drops its buffers */
Gfx.prototype.setChunk = function (key, tri, origin) {
  if (!this.ok) return;
  var gl = this.gl;
  var old = this.chunks.get(key);
  if (old) {
    gl.deleteBuffer(old.pos); gl.deleteBuffer(old.nrm);
    gl.deleteBuffer(old.uv); gl.deleteBuffer(old.mat); gl.deleteBuffer(old.idx);
    this.chunks.delete(key);
  }
  if (!tri || !tri.indices.length) return;

  function buf(target, data) {
    var b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }
  this.chunks.set(key, {
    pos: buf(gl.ARRAY_BUFFER, new Float32Array(tri.positions)),
    nrm: buf(gl.ARRAY_BUFFER, new Float32Array(tri.normals)),
    uv: buf(gl.ARRAY_BUFFER, new Float32Array(tri.uvs)),
    mat: buf(gl.ARRAY_BUFFER, new Float32Array(tri.mats)),
    /* 16-bit indices, deliberately. 32-bit ones need an extension that
       WebGL 1 does not promise, and a 16³ section can never need them:
       the most quads it can possibly have is 2,048 solid blocks × 6
       faces = 12,288, which is 49,152 vertices — comfortably inside the
       65,536 a short can address. Sections are the reason this is safe,
       so anything that grows them has to revisit it. */
    idx: buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(tri.indices)),
    n: tri.indices.length,
    origin: origin || [0, 0, 0]
  });
};

Gfx.prototype.clearChunks = function () {
  if (!this.ok) { this.chunks.clear(); return; }
  var gl = this.gl, self = this;
  this.chunks.forEach(function (c) {
    gl.deleteBuffer(c.pos); gl.deleteBuffer(c.nrm); gl.deleteBuffer(c.uv);
    gl.deleteBuffer(c.mat); gl.deleteBuffer(c.idx);
  });
  this.chunks.clear();
};

Gfx.prototype.draw = function (cam, opts) {
  if (!this.ok) return { drawn: 0, tris: 0 };
  opts = opts || {};
  var gl = this.gl, u = this.u;
  var sky = opts.sky || [0.55, 0.68, 0.86];

  gl.clearColor(sky[0], sky[1], sky[2], 1);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(this.pr);

  var asp = this.w / Math.max(1, this.h);
  var far = opts.far || 260;
  var proj = persp(opts.fov || 1.28, asp, 0.1, far);
  var eye = cam.eye, at = cam.at;
  var vp = mul(proj, lookAt(eye, at, [0, 1, 0]));

  gl.uniformMatrix4fv(u.uVP, false, vp);
  gl.uniform3f(u.uSun, 0.45, 0.86, 0.28);
  gl.uniform3f(u.uFog, sky[0], sky[1], sky[2]);
  gl.uniform3f(u.uEye, eye[0], eye[1], eye[2]);
  gl.uniform1f(u.uFogNear, far * 0.45);
  gl.uniform1f(u.uFogFar, far);
  gl.uniform1f(u.uGlowCut, Blocks.BY_KEY.lamp.id);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.tex);
  gl.uniform1i(u.uAtlas, 0);

  var a = this.a, drawn = 0, tris = 0, self = this;
  var far2 = far * far;
  this.chunks.forEach(function (c) {
    /* a cheap distance cull on the section's centre — with sections
       this small a full frustum test costs more than it saves */
    var dx = c.origin[0] + 8 - eye[0], dy = c.origin[1] + 8 - eye[1], dz = c.origin[2] + 8 - eye[2];
    if (dx * dx + dy * dy + dz * dz > far2 + 900) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, c.pos); gl.enableVertexAttribArray(a.pos);
    gl.vertexAttribPointer(a.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.nrm); gl.enableVertexAttribArray(a.nrm);
    gl.vertexAttribPointer(a.nrm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.uv); gl.enableVertexAttribArray(a.uv);
    gl.vertexAttribPointer(a.uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.mat); gl.enableVertexAttribArray(a.mat);
    gl.vertexAttribPointer(a.mat, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.idx);
    gl.drawElements(gl.TRIANGLES, c.n, gl.UNSIGNED_SHORT, 0);
    drawn++; tris += c.n / 3;
  });
  return { drawn: drawn, tris: tris };
};

Gfx.prototype.destroy = function () {
  if (!this.gl) return;
  try {
    this.clearChunks();
    if (this.tex) this.gl.deleteTexture(this.tex);
    if (this.pr) this.gl.deleteProgram(this.pr);
  } catch (e) { /* context already gone */ }
  this.ok = false;
};

Gfx.paintAtlas = paintAtlas;
Gfx.CELL = CELL; Gfx.COLS = COLS; Gfx.ROWS = ROWS;
if (typeof module !== "undefined" && module.exports) module.exports = Gfx;
else root.Gfx = Gfx;
})(typeof self !== "undefined" ? self : this);
