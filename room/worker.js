/* worker.js — the solving room's back office.
   Builds the solvers' tables off the main thread so the cube never
   stutters, then answers "solve" requests with move words. */
/* global PuzzleEngine, CubeSolver */
importScripts("puzzle.js?v=3", "solver.js?v=3");

var built = {};

function ensure(kind, report){
  if (built[kind]) return built[kind];
  var P = PuzzleEngine.build(kind);
  var S = CubeSolver, b;

  if (kind === "cube3"){
    var ops = [];
    ["U","R","F","D","L","B"].forEach(function(f, fi){
      [1,2,3].forEach(function(pow){
        var name = f + (pow===2 ? "2" : pow===3 ? "'" : "");
        var c = P.newColors();
        P.applyMove(c, P.namedMove(name));
        ops.push({ name:name, face:fi, power:pow,
                   state:S.analyze(P.cubies, c, P.faceOf) });
      });
    });
    var sv3 = S.Solver3(ops);
    sv3.init(P.cubies.edges.map(function(e){ return e.faces; }), P.faceOf, report);
    b = { P:P, sv:sv3, ops:ops, kind:kind };
  } else if (kind === "cube2"){
    var ops2 = [];
    ["U","R","F"].forEach(function(f){
      ["","2","'"].forEach(function(sfx){
        var name = f + sfx;
        var c = P.newColors();
        P.applyMove(c, P.namedMove(name));
        ops2.push({ name:name, state:S.analyze(P.cubies, c, P.faceOf) });
      });
    });
    var dblKey = [P.faceOf.D, P.faceOf.B, P.faceOf.L].sort().join(",");
    var dbl = -1;
    P.cubies.corners.forEach(function(cn, i){
      if (cn.faces.slice().sort().join(",") === dblKey) dbl = i;
    });
    var sv2 = S.Solver2(ops2, dbl);
    sv2.init(report);
    b = { P:P, sv:sv2, ops:ops2, kind:kind };
  } else {
    throw new Error("no solver for " + kind);
  }
  built[kind] = b;
  return b;
}

/* ---------- the map: real state-space geometry ----------
   A state's dot lives on a shell whose radius is its PROVEN distance
   (from the God table or the pruning tables); its direction on the
   shell is a hash of its coordinate, so cloud and walk always agree. */
function hash01(x, salt){
  x = (x + salt) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
/* galaxy placement: flattened shells, solved at the very centre */
function mapPos(id, d, out, o, flat, jitter){
  var u = hash01(id, 0x9e3779b9), v = hash01(id, 0x85ebca6b), w = hash01(id, 0xc2b2ae35);
  var th = 6.2831853 * u, cph = 2*v - 1, sph = Math.sqrt(Math.max(0, 1 - cph*cph));
  var r = d === 0 ? 0.02 : d + (w - 0.5) * jitter;
  out[o]   = Math.cos(th) * sph * r;
  out[o+1] = cph * r * flat;
  out[o+2] = Math.sin(th) * sph * r;
}

function buildCloud(table, size, stride, flat, jitter){
  var n = Math.ceil(size / stride);
  var pos = new Float32Array(n * 3);
  var dep = new Float32Array(n);
  var counts = [], k = 0, maxd = 0;
  for (var i = 0; i < size; i += stride){
    var d = table[i];
    if (d === 255) continue;              /* unreachable coordinate */
    mapPos(i, d, pos, k*3, flat, jitter);
    dep[k] = d;
    counts[d] = (counts[d] || 0) + 1;
    if (d > maxd) maxd = d;
    k++;
  }
  return { pos: pos.subarray(0, k*3).slice(), dep: dep.subarray(0, k).slice(),
           counts: counts, n: k, maxd: maxd };
}

function opsByName(b){
  var m = {};
  (b.ops || []).forEach(function(o){ m[o.name] = o; });
  return m;
}

/* exact distribution of a distance table: how many states sit on each
   shell, and the exact mean distance of a uniformly random state */
function tableStats(table, size){
  var hist=[], i, d, n=0, sum=0;
  for(i=0;i<size;i++){
    d=table[i];
    if(d===255) continue;
    hist[d]=(hist[d]||0)+1;
    sum+=d; n++;
  }
  for(i=0;i<hist.length;i++) if(!hist[i]) hist[i]=0;
  return { hist:hist, total:n, mean:sum/n, maxd:hist.length-1 };
}

/* compress a cloud built on shells d∈[0..18] into a small nucleus
   (radius ≈ 0.05 + 0.05·d) so the G1 core sits inside phase 1's
   innermost shell. Same formula for cloud and walk, so they agree. */
function squeezeCore(pos, dep, n){
  for (var q = 0; q < n; q++){
    var l = Math.hypot(pos[q*3], pos[q*3+1], pos[q*3+2]);
    var sc = (0.05 + 0.05*dep[q]) / Math.max(l, 0.01);
    pos[q*3] *= sc; pos[q*3+1] *= sc; pos[q*3+2] *= sc;
  }
}

onmessage = function(e){
  var d = e.data;
  try {
    var b = ensure(d.kind, function(pct, label){
      postMessage({ type:"progress", kind:d.kind, pct:pct, label:label });
    });
    if (d.cmd === "prep"){ postMessage({ type:"ready", kind:d.kind }); return; }
    if (d.cmd === "solve"){
      var colors = Uint8Array.from(d.colors);
      var st = CubeSolver.analyze(b.P.cubies, colors, b.P.faceOf);
      var moves = (d.kind === "cube3") ? b.sv.solve(st, 900) : b.sv.solve(st);
      if (!moves) throw new Error("search timed out");
      postMessage({ type:"solution", kind:d.kind, id:d.id,
                    moves:Array.prototype.slice.call(moves),
                    split:(moves.split !== undefined ? moves.split : -1) });
    }
    if (d.cmd === "antipode"){
      /* walk from the current position to a true antipode: one of the
         2,644 states a proven maximum 11 turns from home */
      var ac = Uint8Array.from(d.colors);
      var ast = CubeSolver.analyze(b.P.cubies, ac, b.P.faceOf);
      var toHome = b.sv.solve(ast);
      var tbl = b.sv.table(), pick = -1;
      var seed = (d.seed|0) || 1;
      function rnd(){ seed = (Math.imul(seed, 48271) % 2147483647 + 2147483647) % 2147483647; return seed/2147483647; }
      while (pick < 0){
        var cand = (rnd()*3674160)|0;
        if (tbl[cand] === 11) pick = cand;
      }
      var homeToAnti = b.sv.routeFromId(pick).reverse().map(function(nm){
        return nm.length===1 ? nm+"'" : nm.charAt(1)==="2" ? nm : nm.charAt(0);
      });
      postMessage({ type:"antipode", kind:d.kind, id:d.id,
                    moves:toHome.concat(homeToAnti), tail:homeToAnti.length });
      return;
    }
    if (d.cmd === "check"){
      /* is this scan a possible cube? */
      var res = { type:"check", id:d.id, ok:false, reason:"" };
      try {
        var cc = Uint8Array.from(d.colors);
        var stc = CubeSolver.analyze(b.P.cubies, cc, b.P.faceOf);
        var i, s = 0, t = 0;
        for (i = 0; i < 8; i++) s += stc.co[i];
        if (s % 3) throw new Error("a corner is twisted — no sequence of turns can do that");
        for (i = 0; i < 12; i++) t += stc.eo[i];
        if (t % 2) throw new Error("an edge is flipped — no sequence of turns can do that");
        function parity(p){ var x=0,a,bq; for(a=0;a<p.length;a++) for(bq=a+1;bq<p.length;bq++) if(p[a]>p[bq]) x^=1; return x; }
        if (parity(stc.cp) !== parity(stc.ep))
          throw new Error("two pieces are swapped — that position can't be reached by turning");
        res.ok = true;
      } catch (err2){ res.reason = String((err2 && err2.message) || err2); }
      postMessage(res);
      return;
    }
    if (d.cmd === "stats"){
      if (d.kind === "cube2"){
        postMessage({ type:"stats", kind:d.kind,
                      main:tableStats(b.sv.table(), 5040*729) });
      } else {
        var tb=b.sv.tables();
        postMessage({ type:"stats", kind:d.kind,
                      main:tableStats(tb.prunTS, 2187*495),
                      core:tableStats(tb.prunCS, 40320*24) });
      }
      return;
    }
    if (d.cmd === "locate"){
      var lc = Uint8Array.from(d.colors);
      var lst = CubeSolver.analyze(b.P.cubies, lc, b.P.faceOf);
      if (d.kind === "cube2"){
        var len = b.sv.encode(lst);
        postMessage({ type:"locate", kind:d.kind, id:d.id, d:len.d, g:false, d2:0 });
      } else {
        var lco = b.sv.coords(lst);
        postMessage({ type:"locate", kind:d.kind, id:d.id,
                      d:lco.d1, g:lco.g, d2:lco.d2 });
      }
      return;
    }
    if (d.cmd === "map"){
      var cloud;
      if (d.kind === "cube2"){
        cloud = buildCloud(b.sv.table(), 5040*729, d.stride || 1, 0.55, 0.6);
        postMessage({ type:"map", kind:d.kind, total:3674160, cloud:cloud },
                    [cloud.pos.buffer, cloud.dep.buffer]);
      } else {
        var tabs = b.sv.tables();
        cloud = buildCloud(tabs.prunTS, 2187*495, d.stride || 1, 0.55, 0.6);
        var core = buildCloud(tabs.prunCS, 40320*24, (d.stride || 1)*2, 0.55, 0.6);
        squeezeCore(core.pos, core.dep, core.n);
        postMessage({ type:"map", kind:d.kind, total:2187*495, cloud:cloud, core:core },
                    [cloud.pos.buffer, cloud.dep.buffer, core.pos.buffer, core.dep.buffer]);
      }
      return;
    }
    if (d.cmd === "walk"){
      var wc = Uint8Array.from(d.colors);
      var wst = CubeSolver.analyze(b.P.cubies, wc, b.P.faceOf);
      var byName = opsByName(b);
      var steps = [], names = d.names, si;
      function record(stx){
        var p = [0,0,0];
        if (d.kind === "cube2"){
          var en = b.sv.encode(stx);
          mapPos(en.id, en.d, p, 0, 0.55, 0.6);
          steps.push({ x:p[0], y:p[1], z:p[2], d:en.d, g:false, d2:0 });
        } else {
          var co = b.sv.coords(stx);
          if (co.g){
            mapPos(co.id2, co.d2, p, 0, 0.55, 0.6);
            squeezeCore(p, [co.d2], 1);
            steps.push({ x:p[0], y:p[1], z:p[2], d:0, g:true, d2:co.d2 });
          } else {
            mapPos(co.id, co.d1, p, 0, 0.55, 0.6);
            steps.push({ x:p[0], y:p[1], z:p[2], d:co.d1, g:false, d2:0 });
          }
        }
      }
      record(wst);
      for (si = 0; si < names.length; si++){
        wst = CubeSolver.applyOp(wst, byName[names[si]].state);
        record(wst);
      }
      postMessage({ type:"walk", kind:d.kind, id:d.id, steps:steps });
      return;
    }
  } catch (err){
    postMessage({ type:"error", kind:d.kind, id:d.id,
                  message:String((err && err.message) || err) });
  }
};
