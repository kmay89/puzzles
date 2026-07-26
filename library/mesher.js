/* mesher.js — turning a box of blocks into something a GPU will draw.

   A library the size of the Uncensored Library is a few million blocks.
   Drawn as a cube each, that is tens of millions of triangles and no
   phone survives it. Almost all of them are invisible anyway — buried
   inside walls, or pressed against a neighbour — so the mesher does two
   things, in this order:

   1. **Culls.** A face is only drawn where the block next to it lets
      light through. Inside a solid wall, nothing is emitted at all.
      This alone removes the overwhelming majority.

   2. **Merges.** The faces that survive are combined into the largest
      rectangles they will form — the classic greedy meshing sweep. A
      flat stone floor 16 × 16 becomes *one* quad instead of 256.

   ## The invariant that makes this testable

   Merging must never change *what is covered*, only how many rectangles
   cover it. So the total area of the emitted quads must exactly equal
   the number of exposed unit faces — every time, on every input. That
   is a strong statement: it catches a merge that runs one block too
   far, a merge that leaves a gap, and a merge that overlaps another,
   none of which a screenshot would show you reliably.

   `tools/mesher-check.js` asserts it over random and adversarial
   volumes, and separately asserts that no face is ever emitted between
   two solid blocks.                                                   */
(function (root) {
"use strict";

/* The six face directions, as (axis, sign). Axis 0 = x, 1 = y, 2 = z.
   The order is fixed and part of the output — the renderer indexes its
   normals and its shading by it. */
var DIRS = [
  { id: 0, axis: 0, sign: 1,  normal: [1, 0, 0] },
  { id: 1, axis: 0, sign: -1, normal: [-1, 0, 0] },
  { id: 2, axis: 1, sign: 1,  normal: [0, 1, 0] },
  { id: 3, axis: 1, sign: -1, normal: [0, -1, 0] },
  { id: 4, axis: 2, sign: 1,  normal: [0, 0, 1] },
  { id: 5, axis: 2, sign: -1, normal: [0, 0, -1] }
];

/* ---------- the volume a mesher works over ----------
   `at(x,y,z)` returns a material id, 0 meaning empty. Coordinates
   outside the box are the caller's business: a chunk that knows its
   neighbours should return theirs, so the seam between two chunks is
   not covered in faces nobody can see. */
function volume(sx, sy, sz, at) {
  return { sx: sx, sy: sy, sz: sz, at: at };
}

/* is there a face between `here` and `there`? Only when one is solid
   and the other is not — two solids hide each other, two empties have
   nothing to show. Transparent materials (glass, water) are marked in
   `seeThrough` and show faces against solids but not against their own
   kind, which is what stops a lake being a stack of surfaces. */
function faceBetween(here, there, seeThrough) {
  if (!here) return 0;
  if (!there) return 1;
  if (seeThrough && seeThrough(there) && !seeThrough(here)) return 1;
  if (seeThrough && seeThrough(here) && seeThrough(there)) return 0;
  if (seeThrough && seeThrough(there)) return 1;
  return 0;
}

/* ---------- the sweep ----------
   For each axis and each slice along it, build a mask of the faces on
   that slice, then eat the mask with the largest rectangles it will
   give up. Textbook greedy meshing; the care is all in the boundaries.

   Returns a flat array of quads:
     { dir, x, y, z, w, h, mat }
   where (x,y,z) is the low corner of the quad in block coordinates,
   and w/h are its extents along the two axes that are not `dir`'s. */
function build(vol, opts) {
  opts = opts || {};
  var seeThrough = opts.seeThrough || null;
  var quads = [];
  var dims = [vol.sx, vol.sy, vol.sz];

  for (var d = 0; d < 3; d++) {
    var u = (d + 1) % 3, v = (d + 2) % 3;
    var du = dims[u], dv = dims[v], dd = dims[d];
    /* one mask per slice, holding the material of the face at each
       (u,v) cell — signed, so the two facings can share a mask: a
       positive entry faces +d, a negative one faces -d */
    var mask = new Int32Array(du * dv);
    var pos = [0, 0, 0], nb = [0, 0, 0];

    for (var slice = 0; slice <= dd; slice++) {
      mask.fill(0);
      for (var j = 0; j < dv; j++) {
        for (var i = 0; i < du; i++) {
          pos[u] = i; pos[v] = j; pos[d] = slice - 1;
          nb[u] = i; nb[v] = j; nb[d] = slice;
          /* What lies outside the box is the *volume's* business, not
             the mesher's — so both sides are simply asked for, even at
             slice -1 and slice dd.

             This is what makes chunked meshing work. A standalone
             volume returns 0 outside itself and gets its outer surface
             drawn, as you would expect. But a chunk that can see its
             neighbours returns *their* blocks, and then the wall
             between two chunks is correctly recognised as hidden and
             never meshed. Assuming air out here instead (the first
             version) wraps every chunk in a full skin of invisible
             faces — six thousand of them per chunk in solid ground,
             and a visible crack at every seam. */
          var a = vol.at(pos[0], pos[1], pos[2]);
          var b = vol.at(nb[0], nb[1], nb[2]);
          if (faceBetween(a, b, seeThrough)) mask[i + j * du] = a;
          else if (faceBetween(b, a, seeThrough)) mask[i + j * du] = -b;
          else mask[i + j * du] = 0;
        }
      }

      /* eat the mask */
      for (var jj = 0; jj < dv; jj++) {
        for (var ii = 0; ii < du;) {
          var m = mask[ii + jj * du];
          if (!m) { ii++; continue; }
          /* how far right does this exact face run */
          var w = 1;
          while (ii + w < du && mask[ii + w + jj * du] === m) w++;
          /* and how far down does that whole run repeat */
          var h = 1, done = false;
          while (jj + h < dv) {
            for (var k = 0; k < w; k++) {
              if (mask[ii + k + (jj + h) * du] !== m) { done = true; break; }
            }
            if (done) break;
            h++;
          }
          /* take it */
          var q = { dir: 0, x: 0, y: 0, z: 0, w: 0, h: 0, mat: Math.abs(m) };
          var lo = [0, 0, 0];
          lo[u] = ii; lo[v] = jj; lo[d] = slice;
          q.x = lo[0]; q.y = lo[1]; q.z = lo[2];
          q.dir = m > 0 ? d * 2 : d * 2 + 1;
          q.w = w; q.h = h;
          q.au = u; q.av = v;
          quads.push(q);
          for (var b2 = 0; b2 < h; b2++) {
            for (var a2 = 0; a2 < w; a2++) mask[ii + a2 + (jj + b2) * du] = 0;
          }
          ii += w;
        }
      }
    }
  }
  return quads;
}

/* how many unit faces are exposed, counted the slow honest way. The
   mesher's quads must add up to exactly this. */
function exposedFaces(vol, opts) {
  opts = opts || {};
  var seeThrough = opts.seeThrough || null;
  var n = 0;
  for (var z = 0; z < vol.sz; z++) {
    for (var y = 0; y < vol.sy; y++) {
      for (var x = 0; x < vol.sx; x++) {
        var here = vol.at(x, y, z);
        if (!here) continue;
        for (var d = 0; d < DIRS.length; d++) {
          /* asks the volume about the outside too, exactly as `build`
             does — otherwise the two disagree at the boundary and the
             conservation law would fail for neighbour-aware chunks */
          var there = vol.at(x + DIRS[d].normal[0], y + DIRS[d].normal[1], z + DIRS[d].normal[2]);
          if (faceBetween(here, there, seeThrough)) n++;
        }
      }
    }
  }
  return n;
}

/* ---------- quads → triangles ----------
   Four corners in winding order, so the renderer can upload them
   directly. The corner order matters: it decides which way the quad
   faces, and getting it wrong makes half the world invisible from one
   side and solid from the other. */
function corners(q) {
  var d = q.dir >> 1, positive = (q.dir & 1) === 0;
  var u = q.au, v = q.av;
  var o = [q.x, q.y, q.z];
  var du = [0, 0, 0], dv = [0, 0, 0];
  du[u] = q.w; dv[v] = q.h;
  var p0 = o.slice();
  var p1 = [o[0] + du[0], o[1] + du[1], o[2] + du[2]];
  var p2 = [o[0] + du[0] + dv[0], o[1] + du[1] + dv[1], o[2] + du[2] + dv[2]];
  var p3 = [o[0] + dv[0], o[1] + dv[1], o[2] + dv[2]];
  return positive ? [p0, p1, p2, p3] : [p0, p3, p2, p1];
}

function toTriangles(quads) {
  var out = { positions: [], normals: [], mats: [], uvs: [], indices: [] };
  for (var i = 0; i < quads.length; i++) {
    var q = quads[i], c = corners(q);
    var n = DIRS[q.dir].normal;
    var base = out.positions.length / 3;
    for (var k = 0; k < 4; k++) {
      out.positions.push(c[k][0], c[k][1], c[k][2]);
      out.normals.push(n[0], n[1], n[2]);
      out.mats.push(q.mat);
    }
    /* the texture repeats once per block across the merged quad, so a
       floor of sixteen stones still looks like sixteen stones */
    out.uvs.push(0, 0, q.w, 0, q.w, q.h, 0, q.h);
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return out;
}

var Mesher = {
  DIRS: DIRS, volume: volume, build: build, exposedFaces: exposedFaces,
  corners: corners, toTriangles: toTriangles, faceBetween: faceBetween
};
if (typeof module !== "undefined" && module.exports) module.exports = Mesher;
else root.Mesher = Mesher;
})(typeof self !== "undefined" ? self : this);
