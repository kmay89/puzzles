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
/* a·b, in that order.

   The obvious-looking loop computes b·a instead, and nothing complains.
   The drawing never noticed, because the shader multiplies uProj and
   uView itself — but `pointOnTable` inverts this product to turn a tap
   back into a place on the table, and inverting the wrong product does
   not shift the answer slightly: it collapses it, so every pixel comes
   back as the same point. Column-major means (row r, col c) lives at
   m[c*4 + r], so (a·b)[r][c] = Σk a[k*4 + r] · b[c*4 + k]. */
function mul(a, b, o) {
  o = o || new Float32Array(16);
  for (var c = 0; c < 4; c++) {
    for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                     a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
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

/* Three lights, because one is what made the bones look like cut-out
   paper. A single bulb straight overhead lights every top face to the
   same white and leaves every side the same dead grey, so a bone reads
   as a flat card with a smudge under it — which is exactly what it did.

   What sells a small solid object is not more light, it is light of
   *different colours* arriving from different directions:

     key     the bulb over the table. Half-Lambert, so the terminator is
             a soft shoulder rather than a hard line, and warm, because
             it is a bulb in a cantina.
     fill    a cool wash from behind the viewer's shoulder. This is the
             one that matters: the side of the bone facing you is turned
             away from the bulb, and with no fill it goes neutral grey
             and stops looking like the same ivory as the top. Lit
             coolly it reads as ivory *in shadow*, which is the whole
             difference.
     bounce  the felt's own colour, coming back up off the cloth onto
             everything that can see it — which is the sides, mostly.

   The weights are chosen so a face pointing straight up lands just
   under 1 and nothing clips: key 0.72 + fill 0.20·0.60 + ambient 0.14,
   with bounce contributing nothing at all up there. Change one and
   check that sum again, or the cream blows out to flat white and every
   gain here is thrown away. */
var FS = [
  "precision mediump float;",
  "varying vec3 vN; varying vec3 vP; varying vec2 vUV;",
  "uniform vec3 uColor, uEye, uLamp, uBounce;",
  "uniform float uSpec, uPower, uRim, uAlpha, uTex, uAmb;",
  "uniform sampler2D uSampler;",
  "const vec3 FILL = vec3(-0.470, -0.646, 0.601);",   /* over the near shoulder */
  "void main(){",
  "  vec3 N = normalize(vN);",
  "  vec3 Ld = normalize(uLamp - vP);",
  "  vec3 V = normalize(uEye - vP);",
  "  vec3 H = normalize(Ld + V);",
  "  float nd  = dot(N, Ld);",
  "  float key = pow(max(nd * 0.5 + 0.5, 0.0), 1.7);",
  "  float fall = 1.0 - clamp(length(uLamp.xy - vP.xy) / 15.0, 0.0, 1.0);",
  "  key *= 0.55 + 0.45 * fall;",
  "  float fil = max(dot(N, FILL), 0.0);",
  /* How much of the felt a surface can see: none from a face pointing
     straight up, half from a wall standing on it. This is the term that
     keeps a bone's sides *ivory*.

     Tinting it with the felt is not decoration. A cream face under
     neutral light darkens to a neutral grey — correctly, that is what
     the arithmetic says — and a grey side next to a cream top stops
     reading as one object. What actually happens on a table is that the
     side is lit almost entirely by brown light coming back up off the
     cloth, so it darkens *towards the felt's hue* rather than towards
     grey. Take uBounce out and the sides go straight back to cardboard. */
  "  float bnc = (1.0 - N.z) * 0.5;",
  "  vec3 light = vec3(1.00, 0.95, 0.86) * (0.72 * key)",
  "             + vec3(0.80, 0.87, 1.00) * (0.20 * fil)",
  "             + uBounce * (0.42 * bnc)",
  "             + vec3(1.00, 0.97, 0.92) * uAmb;",
  "  vec3 base = uColor;",
  "  if (uTex > 0.5) { vec4 t = texture2D(uSampler, vUV); base = mix(uColor, t.rgb, t.a); }",
  "  float spe = pow(max(dot(N, H), 0.0), uPower) * uSpec * (0.35 + 0.65 * fall);",
  "  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * uRim;",
  "  vec3 col = base * light + vec3(1.0, 0.96, 0.88) * spe + vec3(0.7, 0.8, 1.0) * rim;",
  "  gl_FragColor = vec4(col, uAlpha);",
  "}"
].join("\n");

/* A flat, textured, unlit quad — the contact shadow under a bone and
   the slot marking an open end. Kept apart from the lit shader so a
   shadow cannot pick up a specular highlight, which is exactly the sort
   of thing that gives a fake shadow away. */
var FLAT_VS = [
  "attribute vec3 aPos; attribute vec2 aUV;",
  "uniform mat4 uProj, uView, uModel;",
  "varying vec2 vUV;",
  "void main(){ vUV = aUV; gl_Position = uProj * uView * uModel * vec4(aPos,1.0); }"
].join("\n");

var FLAT_FS = [
  "precision mediump float;",
  "varying vec2 vUV;",
  "uniform sampler2D uSampler;",
  "uniform vec3 uColor;",
  "uniform float uAlpha;",
  "void main(){",
  "  float a = texture2D(uSampler, vUV).a;",
  "  gl_FragColor = vec4(uColor, a * uAlpha);",
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
/* The geometry, as plain arrays and no GL — so `tools/bone-check.js` can
   check the one thing about it that cannot be eyeballed reliably.

   Every quad is given a normal *and* a corner order, and the two have to
   agree: walking the corners must wind anticlockwise seen from the side
   the normal points. When they disagree, back-face culling throws away
   exactly the faces you meant to see and keeps the ones you meant to
   hide.

   All eight side and chamfer quads were wound backwards here. The two
   faces and the back were right, so a bone still looked like a bone from
   directly above — but its edges were culled and you saw *through* them
   into the far inner wall, which read as grey wedges hanging off both
   ends of every bone at once. Both ends: impossible for a solid box, and
   the tell that this was winding and not lighting. */
function boneGeometry() {
  /* A real double-six bone is about 50 x 25 x 9mm, so the thickness is
     a bit over a third of the width — 0.34 against 1.0 here. It was
     0.32, which is close, but the chamfer was 0.055: about a millimetre
     and a half, too fine to catch the light at any size the table is
     ever drawn. At 0.09 the bevel is a band you can see, and a bevel
     you can see is most of what makes an edge look like an edge.

     hz is exactly half the felt's offset below the origin, so the bone
     rests *on* the table rather than hovering a hundredth above it —
     which is what a contact shadow needs in order to be believable. */
  var hx = L.LEN / 2, hy = L.WID / 2, hz = 0.17, c = 0.062;
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
  /* The chamfer: four flat cuts around the top edge, **mitred** at the
     corners — each cut runs out to the bone's true corner at (±hx, ±hy),
     so adjacent cuts share a whole edge and meet like a picture frame.

     The obvious alternative stops each cut short by the chamfer width,
     and it does not close: adjacent cuts then touch at a single point
     with an open triangle between them, and the side walls below them
     leave an open vertical sliver at each corner besides. At a 0.055
     bevel those holes were a pixel or two and went unseen for the life
     of the room. Widening the bevel so the edges would read turned all
     four into notches bitten out of the silhouette with the felt
     showing through — and patching them with corner triangles fixes
     only the top half, while breaking convexity against the square
     back. Mitring costs nothing and closes both. */
  var d = 0.7071;
  quad([-ix, -iy, hz], [-ix, iy, hz], [-hx, hy, hz - c], [-hx, -hy, hz - c], [-d, 0, d]);
  quad([ix, -iy, hz], [hx, -hy, hz - c], [hx, hy, hz - c], [ix, iy, hz], [d, 0, d]);
  quad([-ix, -iy, hz], [-hx, -hy, hz - c], [hx, -hy, hz - c], [ix, -iy, hz], [0, -d, d]);
  quad([-ix, iy, hz], [ix, iy, hz], [hx, hy, hz - c], [-hx, hy, hz - c], [0, d, d]);
  /* the four sides, full width, straight down to the felt */
  quad([-hx, -hy, hz - c], [-hx, hy, hz - c], [-hx, hy, -hz], [-hx, -hy, -hz], [-1, 0, 0]);
  quad([hx, -hy, hz - c], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz - c], [1, 0, 0]);
  quad([-hx, -hy, hz - c], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz - c], [0, -1, 0]);
  quad([-hx, hy, hz - c], [hx, hy, hz - c], [hx, hy, -hz], [-hx, hy, -hz], [0, 1, 0]);
  /* and the back */
  quad([-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz], [0, 0, -1]);
  return { P: P, N: N, U: U, I: I };
}

function boneMesh(gl) {
  var g = boneGeometry();
  var P = g.P, N = g.N, U = g.U, I = g.I;
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
  /* 20 repeats across the plane rather than 6. At 6 a single 128px tile
     of cloth was stretched over four bone-lengths of table, so the felt
     under a bone was a smooth brown gradient while the bone on top of it
     was razor sharp — and that mismatch reads as a sticker on a
     backdrop. At 20 the weave is about a bone long and the two surfaces
     belong to the same photograph. */
  var U = [0, 0, 20, 0, 20, 20, 0, 20];
  var I = [0, 1, 2, 0, 2, 3];
  var m = { pos: gl.createBuffer(), nrm: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer(), count: 6 };
  gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(N), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.uv); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(U), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(I), gl.STATIC_DRAW);
  return m;
}

/* the unit quad the marks on the felt are drawn on: -1..1, UV 0..1 */
function markMesh(gl) {
  var P = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
  var U = [0, 1, 1, 1, 1, 0, 0, 0];
  var I = [0, 1, 2, 0, 2, 3];
  var m = { pos: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer(), count: 6 };
  gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
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
/* 256 to a cell, not 128. A bone can cover 300 device pixels across on
   a phone at 3x when the line is short and the camera has pulled in, so
   a 128px cell was being magnified past 2x and every pip came out a
   soft grey smudge — the drilling detail was there and then thrown away
   by the magnification filter. 2048x256 RGBA is 2MB, paid once. */
var ATLAS_W = 2048, ATLAS_CELLS = 8;
function pipAtlas(gl, pipColour) {
  var S = 256, cv = document.createElement("canvas");
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
    /* An engraved line, not a strip of metal laid on top. It was 4.5%
       of a cell wide at half alpha, and since both halves draw their
       own the two met as one 9%-wide light grey bar sitting proud of
       the face. Narrower and darker, with a hairline of catchlight
       along the bottom edge, and it reads as a groove cut into the
       bone — which is what it is. */
    g.globalAlpha = 0.62;
    g.fillStyle = pipColour;
    g.fillRect(ox + S * 0.972, S * 0.055, S * 0.028, S * 0.89);
    g.globalAlpha = 0.30;
    g.fillStyle = "#fffaf0";
    g.fillRect(ox + S * 0.972, S * 0.055 + S * 0.89, S * 0.028, S * 0.010);
    g.globalAlpha = 1;
    /* A pip on a real bone is a hole, drilled and filled — not a sticker.
       Three coats make it read as one, and the order matters:

         1. a soft dark halo on the face just outside the rim, which is
            the light the hole steals from the surface around it;
         2. the bore itself, shaded across rather than filled flat — the
            wall the light reaches is the one *opposite* the lamp, so a
            pit is bright on the far side and darkest on the near one.
            That is the reverse of a dome, and getting it backwards is
            what makes drawn pips look like bumps;
         3. a thin bright arc on the lip where the bevel of the hole
            catches the bulb.

       The lamp is toward -y on the table, and v runs 0 at +y to 1 at
       -y, so on this canvas the light arrives from the bottom. The lit
       wall is therefore the top of each bore. */
    for (var i = 0; i < set.length; i++) {
      var px = ox + S * 0.5 + (set[i][0] - 1) * S * 0.29;
      var py = S * 0.5 + (set[i][1] - 1) * S * 0.29;
      var r = S * 0.105;

      /* The halo starts at the rim, not inside it. Starting at 0.9r
         darkened the last tenth of the bore as well as the face around
         it, which smeared the one edge that has to stay crisp: a pip
         reads as drilled because its outline is sharp and its inside
         is not. */
      var halo = g.createRadialGradient(px, py, r, px, py, r * 1.5);
      halo.addColorStop(0, "rgba(0,0,0,.16)");
      halo.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = halo;
      g.beginPath(); g.arc(px, py, r * 1.5, 0, Math.PI * 2); g.fill();

      g.save();
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.clip();
      g.fillStyle = pipColour;
      g.fillRect(px - r, py - r, r * 2, r * 2);
      var bore = g.createLinearGradient(px, py - r, px, py + r);
      bore.addColorStop(0, "rgba(255,244,224,.30)");    /* the lit far wall */
      bore.addColorStop(0.42, "rgba(0,0,0,0)");
      bore.addColorStop(1, "rgba(0,0,0,.55)");          /* the near wall, in its own shadow */
      g.fillStyle = bore;
      g.fillRect(px - r, py - r, r * 2, r * 2);
      g.restore();

      g.beginPath();
      g.arc(px, py, r * 0.94, Math.PI * 1.08, Math.PI * 1.92);
      g.strokeStyle = "rgba(255,250,238,.42)";
      g.lineWidth = S * 0.016;
      g.stroke();
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

/* ---------- the two marks on the felt ----------
   Both are painted as a signed distance to a rounded rectangle the size
   of a bone's footprint, which is the cheap way to get a soft edge
   without a blur filter (`ctx.filter` is not old-Safari's strong suit,
   and this room has to work on a phone somebody has had for a while).

   The footprint occupies the middle 60% of the texture; the rest is the
   penumbra it needs room to fall off into. `FOOT` is that fraction, and
   the draw code scales the quad by 1/FOOT so the sharp part lands
   exactly on the bone. Change one without the other and every shadow on
   the table is the wrong size. */
var FOOT = 0.6;
function sdTexture(gl, paint) {
  var W = 256, H = 128, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  var g = cv.getContext("2d");
  var img = g.createImageData(W, H), d = img.data;
  /* half-extents of the bone's footprint, in pixels, and its corner
     radius — a bone is chamfered, so its shadow has rounded corners */
  var hw = W * 0.5 * FOOT, hh = H * 0.5 * FOOT, r = H * 0.09;
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      var dx = Math.max(Math.abs(x + 0.5 - W / 2) - (hw - r), 0);
      var dy = Math.max(Math.abs(y + 0.5 - H / 2) - (hh - r), 0);
      var dist = Math.hypot(dx, dy) - r;
      var i = (y * W + x) * 4;
      var a = paint(dist, H);
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);
  return tex;
}
function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

/* The shadow of a bone lying flat on felt under a bulb a long way up:
   almost black where the two touch, and gone within about a third of a
   bone's width. Real contact shadows are tight and dark at the contact
   and diffuse quickly — a uniform grey blob is the giveaway. */
function shadowTexture(gl) {
  return sdTexture(gl, function (dist, H) {
    /* Two falloffs, not one. A single wide gradient is an airbrushed
       blob — it was, and it read as a glow around the bone rather than
       as a shadow under it. What a small object on a table actually
       casts is a hard, nearly black line right at the contact and a
       much fainter wash beyond it, so: a tight core plus a wide skirt,
       added. The core is what makes the bone look like it is touching
       something. */
    var core = 0.72 * smooth(1 - dist / (H * 0.045));
    var skirt = 0.26 * smooth(1 - dist / (H * 0.17));
    return core + skirt;
  });
}

/* An open end: a ring on the felt rather than a slab standing on it.
   The old marker was the bone mesh squashed to a tenth of its height,
   which at a glance is a pale grey shard sticking out of the line —
   it read as broken geometry, not as an invitation. */
function slotTexture(gl) {
  return sdTexture(gl, function (dist, H) {
    var edge = H * 0.030;
    return smooth(1 - Math.abs(dist + edge) / edge) * 0.95;
  });
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
  ["uProj", "uView", "uModel", "uColor", "uEye", "uLamp", "uBounce", "uSpec",
   "uPower", "uRim", "uAlpha", "uTex", "uAmb", "uSampler"].forEach(function (n) {
    this.u[n] = gl.getUniformLocation(pr, n);
  }, this);

  /* the second, unlit program: contact shadows and open-end slots */
  var fvs = compile(gl, gl.VERTEX_SHADER, FLAT_VS), ffs = compile(gl, gl.FRAGMENT_SHADER, FLAT_FS);
  if (!fvs || !ffs) return;
  var fpr = gl.createProgram();
  gl.attachShader(fpr, fvs); gl.attachShader(fpr, ffs); gl.linkProgram(fpr);
  if (!gl.getProgramParameter(fpr, gl.LINK_STATUS)) return;
  this.fpr = fpr;
  this.fa = { pos: gl.getAttribLocation(fpr, "aPos"), uv: gl.getAttribLocation(fpr, "aUV") };
  this.fu = {};
  ["uProj", "uView", "uModel", "uColor", "uAlpha", "uSampler"].forEach(function (n) {
    this.fu[n] = gl.getUniformLocation(fpr, n);
  }, this);

  this.bone = boneMesh(gl);
  this.plane = planeMesh(gl, 26);
  this.mark = markMesh(gl);
  this.pipTex = null; this.feltTex = null;
  this.shadowTex = shadowTexture(gl);
  this.slotTex = slotTexture(gl);
  this.skin = null;
  /* 0.86 rather than 0.94: eight degrees lower puts the camera at 49°
     above the felt instead of 54°, which is worth about a tenth more of
     every bone's near side. It is the difference between seeing that a
     bone has a thickness and merely being told so. */
  this.orbit = { yaw: 0, pitch: 0.86, dist: 20, target: 0.86 };
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

/* ---------- the marks on the felt ----------
   Both the contact shadows and the open-end slots are the same flat
   textured quad under the unlit program; only the texture, the colour
   and the height above the felt differ. They are drawn with the depth
   test on but depth writes off, so they can never occlude each other or
   a bone — a shadow that hides the thing casting it is a long-running
   joke rather than a rendering technique. */
Gfx3D.prototype.marks = function (proj, view, tex, colour, list) {
  if (!list.length) return;
  var gl = this.gl, fu = this.fu, fa = this.fa, m = this.mark, i;
  gl.useProgram(this.fpr);
  gl.uniformMatrix4fv(fu.uProj, false, proj);
  gl.uniformMatrix4fv(fu.uView, false, view);
  gl.uniform3f(fu.uColor, colour[0], colour[1], colour[2]);
  gl.uniform1i(fu.uSampler, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.enableVertexAttribArray(fa.pos);
  gl.vertexAttribPointer(fa.pos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.uv); gl.enableVertexAttribArray(fa.uv);
  gl.vertexAttribPointer(fa.uv, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  /* the sharp part of the texture is the middle FOOT of it, so the quad
     has to be that much bigger than the bone it stands in for */
  var sx = (L.LEN / 2) / FOOT, sy = (L.WID / 2) / FOOT;
  for (i = 0; i < list.length; i++) {
    var k = list[i];
    gl.uniform1f(fu.uAlpha, k.a);
    gl.uniformMatrix4fv(fu.uModel, false,
      trs(k.x, k.y, k.z, k.rot, sx * (k.s || 1), sy * (k.s || 1), 1));
    gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.useProgram(this.pr);
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
  /* The table is seen at a slant, so its depth foreshortens by sin of
     the pitch. Taken from the pitch rather than written down as a
     number: it used to be a hard 0.68 next to a comment calling it
     sin(pitch) when the pitch was 0.94 and its sine 0.81, so the two
     had already drifted apart, and lowering the camera would have
     silently mis-framed every long line. */
  var fore = Math.max(0.35, Math.sin(this.orbit.pitch));
  var need = Math.max(spanX / (vis * Math.max(0.35, asp)), spanY / (vis * fore));
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
  /* A bulb hanging over the table, not the sun.

     At z = 15 the light arrived within a few degrees of straight down
     everywhere, so every top face was lit identically and the line read
     as one flat sticker. At 7.5 the direction changes across the felt,
     which is what gives a long line its gradient.

     It also hangs *beyond* the table and off to one side rather than
     over the near edge. Directly overhead, a bone's shadow is directly
     underneath it — hidden by the bone, which is the one place a shadow
     does no good at all. From over the far shoulder the shadows fall
     towards the viewer where they can be seen, and the near faces drop
     into the fill, which is the light every photograph of a small
     object on a table is set up to get. */
  var felt = hex3(sk.table.felt);
  var lamp = [cx - 2.6, cy + 2.2, 7.5];
  gl.uniform3f(u.uLamp, lamp[0], lamp[1], lamp[2]);
  gl.uniform3f(u.uBounce, felt[0], felt[1], felt[2]);
  gl.uniform1i(u.uSampler, 0);
  gl.activeTexture(gl.TEXTURE0);

  /* the table */
  gl.bindTexture(gl.TEXTURE_2D, this.feltTex);
  this.bind(this.plane);
  gl.uniformMatrix4fv(u.uModel, false, trs(cx, cy, -0.17, 0, 1, 1, 1));
  gl.uniform3f(u.uColor, felt[0], felt[1], felt[2]);
  gl.uniform1f(u.uSpec, 0.05 + sk.table.gloss * 0.30);
  gl.uniform1f(u.uPower, 14);
  gl.uniform1f(u.uRim, 0);
  gl.uniform1f(u.uAlpha, 1);
  gl.uniform1f(u.uTex, 1);
  gl.uniform1f(u.uAmb, 0.30);
  gl.drawElements(gl.TRIANGLES, this.plane.count, gl.UNSIGNED_SHORT, 0);

  /* Where every bone actually ends up this frame, worked out once. The
     shadows have to agree with the bones exactly, and the only way to
     be sure of that is for both to read the same list rather than each
     recomputing the animation curve and drifting apart. */
  var t = scene.table, place = [], shade = [];
  for (i = 0; i < t.bones.length; i++) {
    var b = t.bones[i];
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
    place.push({ b: b, x: px, y: py, z: z, rot: rot });
    /* The shadow falls directly away from the bulb, which is why the
       offset is worked out from the lamp rather than nudged by hand: a
       hand-picked direction is right for one bone and wrong for the one
       at the other end of a long line, and the whole point of a shadow
       is that they all agree about where the light is.

       A bone in the air throws a bigger, fainter shadow that slides in
       under it as it lands. That is the cue that says a bone is *above*
       the table rather than sliding along it — without it the slam
       reads as a bone growing, because nothing else in the frame
       carries height. */
    var ox = px - lamp[0], oy = py - lamp[1];
    var od = Math.hypot(ox, oy) || 1;
    var lift = Math.min(1, z / 2.4);
    var reach = 0.10 + lift * 1.5;
    shade.push({
      x: px + ox / od * reach, y: py + oy / od * reach, z: -0.163, rot: rot,
      s: 1 + lift * 0.45, a: (1 - lift * 0.66) * 0.95
    });
  }
  this.marks(proj, view, this.shadowTex, [0.05, 0.03, 0.02], shade);

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
  gl.uniform1f(u.uAmb, 0.14);
  if (s.translucent) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  gl.uniform1f(u.uAlpha, s.alpha);

  for (i = 0; i < place.length; i++) {
    var p = place[i];
    var a1 = Rl.A(p.b.tile), b1 = Rl.B(p.b.tile);
    if (p.b.flip) { var tmp = a1; a1 = b1; b1 = tmp; }
    this.setFace(a1, b1);
    gl.uniformMatrix4fv(u.uModel, false, trs(p.x, p.y, p.z, p.rot, 1, 1, 1));
    gl.drawElements(gl.TRIANGLES, this.bone.count, gl.UNSIGNED_SHORT, 0);
  }
  if (s.translucent) gl.disable(gl.BLEND);

  /* the open ends, marked on the felt itself */
  if (scene.ghosts && scene.ghosts.length) {
    var pulse = 0.42 + 0.26 * Math.sin(now / 320);
    var slots = [];
    for (i = 0; i < scene.ghosts.length; i++) {
      var gh = scene.ghosts[i];
      slots.push({ x: gh.x, y: gh.y, z: -0.158,
                   rot: (gh.h % 2 === 0 ? 0 : Math.PI / 2), s: 0.97, a: pulse });
    }
    this.marks(proj, view, this.slotTex, hex3(sk.marks.ghost), slots);
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
    if (this.shadowTex) gl.deleteTexture(this.shadowTex);
    if (this.slotTex) gl.deleteTexture(this.slotTex);
    if (this.pr) gl.deleteProgram(this.pr);
    if (this.fpr) gl.deleteProgram(this.fpr);
  } catch (e) { /* the context may already be gone; nothing to free */ }
  this.ok = false;
};

/* exposed so `tools/bone-check.js` can check the winding in node, where
   there is no WebGL to upload it to */
Gfx3D.boneGeometry = boneGeometry;

if (typeof module !== "undefined" && module.exports) module.exports = Gfx3D;
else root.Gfx3D = Gfx3D;
})(typeof self !== "undefined" ? self : this);
