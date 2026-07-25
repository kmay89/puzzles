/* solver.js — the actual mathematics of solving.
   Two honest solvers, no lookup of canned solutions:

   · Solver2 — God's algorithm for the pocket cube: a breadth-first walk
     over every one of the 3,674,160 reachable states. Solutions are
     provably optimal (never more than 11 turns).

   · Solver3 — Kociemba's two-phase algorithm for the 3×3×3: drive the
     cube into the subgroup G1 = ⟨U,D,R²,L²,F²,B²⟩ by orientation +
     slice coordinates, then finish inside G1 by permutation
     coordinates. Pruning tables give an admissible heuristic for IDA*.

   Pure math, no DOM. Runs in the page, a worker, or node (tests). */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.CubeSolver = factory();
}(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* ---------- reading cubie state off the stickers ----------
   cubies = P.cubies from the engine; colors = current sticker colors
   (face ids); faceOf = P.faceOf. Returns position-indexed arrays:
   cp[i] = which cubie sits at position i, co[i] = its twist (0..2),
   ep/eo likewise for edges. Conventions:
   · corner stickers are listed clockwise-from-outside starting at the
     U/D facelet, so co = index of the U/D colour in that list;
   · edge stickers are [primary, secondary] with primary on U/D if
     possible else F/B, so eo = 0 iff the cubie's primary colour sits
     on the position's primary sticker. */
function analyze(cubies, colors, faceOf){
  var U=faceOf.U, D=faceOf.D;
  function setKey(fs){ return fs.slice().sort().join(","); }
  var cornerByKey={}, edgeByKey={}, i;
  cubies.corners.forEach(function(c,idx){ cornerByKey[setKey(c.faces)]=idx; });
  (cubies.edges||[]).forEach(function(e,idx){ edgeByKey[setKey(e.faces)]=idx; });

  var nc=cubies.corners.length;
  var cp=new Array(nc), co=new Array(nc);
  for(i=0;i<nc;i++){
    var cols=cubies.corners[i].stickers.map(function(s){ return colors[s]; });
    var k=cornerByKey[setKey(cols)];
    if(k===undefined) throw new Error("unrecognised corner at "+i);
    var udIdx=-1;
    for(var q=0;q<3;q++) if(cols[q]===U||cols[q]===D){ udIdx=q; break; }
    if(udIdx<0) throw new Error("corner without U/D sticker");
    cp[i]=k; co[i]=udIdx;
  }

  var ne=(cubies.edges||[]).length;
  var ep=new Array(ne), eo=new Array(ne);
  for(i=0;i<ne;i++){
    var cols2=cubies.edges[i].stickers.map(function(s){ return colors[s]; });
    var k2=edgeByKey[setKey(cols2)];
    if(k2===undefined) throw new Error("unrecognised edge at "+i);
    ep[i]=k2;
    eo[i]= (cols2[0]===cubies.edges[k2].faces[0]) ? 0 : 1;
  }
  return { cp:cp, co:co, ep:ep, eo:eo };
}

/* apply a move-op (itself an analyze() of the move on a solved cube):
   position i receives the cubie that was at position op.cp[i]. */
function applyOp(st, op){
  var nc=st.cp.length, i;
  var cp=new Array(nc), co=new Array(nc);
  for(i=0;i<nc;i++){
    cp[i]=st.cp[op.cp[i]];
    co[i]=(st.co[op.cp[i]]+op.co[i])%3;
  }
  var ne=st.ep?st.ep.length:0;
  var ep=new Array(ne), eo=new Array(ne);
  for(i=0;i<ne;i++){
    ep[i]=st.ep[op.ep[i]];
    eo[i]=(st.eo[op.ep[i]]+op.eo[i])%2;
  }
  return { cp:cp, co:co, ep:ep, eo:eo };
}

/* ---------- permutation / combination ranking ---------- */
var FACT=[1,1,2,6,24,120,720,5040,40320];
function permRank(p){
  var n=p.length, r=0, i, j;
  for(i=0;i<n;i++){
    var c=0;
    for(j=i+1;j<n;j++) if(p[j]<p[i]) c++;
    r+=c*FACT[n-1-i];
  }
  return r;
}
function permUnrank(r, n, out){
  var avail=[], i;
  for(i=0;i<n;i++) avail.push(i);
  for(i=0;i<n;i++){
    var f=FACT[n-1-i], d=(r/f)|0; r-=d*f;
    out[i]=avail.splice(d,1)[0];
  }
  return out;
}
var CTAB=(function(){
  var C=[], n, k;
  for(n=0;n<=12;n++){ C.push([]); for(k=0;k<=4;k++){
    C[n][k] = (k===0)?1 : (n===0)?0 : (C[n-1][k]||0)+(C[n-1][k-1]||0);
  }}
  return C;
})();
/* rank a sorted 4-subset of 0..11 in colex order: Σ C(p_t, t+1) */
function combRank(pos){
  return CTAB[pos[0]][1]+CTAB[pos[1]][2]+CTAB[pos[2]][3]+CTAB[pos[3]][4];
}
function combUnrank(r, out){
  var t, p;
  for(t=4;t>=1;t--){
    for(p=11;p>=0;p--) if(CTAB[p][t]<=r){ out[t-1]=p; r-=CTAB[p][t]; break; }
  }
  return out;
}

/* generic BFS pruning table over a pair of coordinates */
function bfsPair(sizeA, sizeB, movA, movB, moves, startA, startB){
  var size=sizeA*sizeB;
  var prun=new Uint8Array(size); prun.fill(255);
  var q=new Int32Array(size);
  var head=0, tail=0;
  var s0=startA*sizeB+startB;
  prun[s0]=0; q[tail++]=s0;
  while(head<tail){
    var s=q[head++], a=(s/sizeB)|0, b=s%sizeB, d=prun[s]+1;
    for(var mi=0;mi<moves.length;mi++){
      var m=moves[mi];
      var s2=movA[a*18+m]*sizeB+movB[b*18+m];
      if(prun[s2]===255){ prun[s2]=d; q[tail++]=s2; }
    }
  }
  return prun;
}

/* ================= Solver3: Kociemba two-phase ================= */
var N_TWIST=2187, N_FLIP=2048, N_SLICE=495, N_PERM=40320, N_SLICE4=24;

/* ops: array of 18 {name, face(0..5 as U,R,F,D,L,B), power, state} */
function Solver3(ops){
  var self={ ready:false };
  var opFace=ops.map(function(o){ return o.face; });
  var ph2Moves=[];
  ops.forEach(function(o,m){
    if(o.face===0||o.face===3||o.power===2) ph2Moves.push(m);
  });
  var allMoves=ops.map(function(_,m){ return m; });

  /* identify slice-edge cubies (no U/D facelet) from op-independent data:
     the caller passes edgeFaces: home faces of each edge cubie. */
  var edgeFaces=null, slicePos=[], udPos=[], sliceIdxOf=[], udIdxOf=[];

  var twistMove, flipMove, sliceMove, cpMove, ep8Move, s4Move;
  var prunTS, prunFS, prunCS, prunES;
  var sliceHome;

  function co2twist(co){
    var t=0; for(var i=0;i<7;i++) t=t*3+co[i]; return t;
  }
  function twist2co(t, co){
    var s=0, i;
    for(i=6;i>=0;i--){ co[i]=t%3; s+=co[i]; t=(t/3)|0; }
    co[7]=(30-s)%3; return co;
  }
  function eo2flip(eo){
    var f=0; for(var i=0;i<11;i++) f=f*2+eo[i]; return f;
  }
  function flip2eo(f, eo){
    var s=0, i;
    for(i=10;i>=0;i--){ eo[i]=f%2; s+=eo[i]; f=(f/2)|0; }
    eo[11]=s%2; return eo;
  }
  function occ2slice(occ){
    var pos=[], i;
    for(i=0;i<12;i++) if(occ[i]) pos.push(i);
    return combRank(pos);
  }

  self.init=function(edgeFacesIn, faceOf, progress){
    edgeFaces=edgeFacesIn;
    var i, m, k;
    var isSlice=edgeFaces.map(function(fs){
      return fs.indexOf(faceOf.U)<0 && fs.indexOf(faceOf.D)<0;
    });
    for(i=0;i<12;i++){
      if(isSlice[i]){ sliceIdxOf[i]=slicePos.length; slicePos.push(i); }
      else { udIdxOf[i]=udPos.length; udPos.push(i); }
    }

    /* --- coordinate move tables --- */
    progress&&progress(0.02,"orientation tables");
    twistMove=new Int32Array(N_TWIST*18);
    var co=new Array(8), co2=new Array(8);
    for(i=0;i<N_TWIST;i++){
      twist2co(i,co);
      for(m=0;m<18;m++){
        var op=ops[m].state;
        for(k=0;k<8;k++) co2[k]=(co[op.cp[k]]+op.co[k])%3;
        twistMove[i*18+m]=co2twist(co2);
      }
    }
    flipMove=new Int32Array(N_FLIP*18);
    var eo=new Array(12), eo2=new Array(12);
    for(i=0;i<N_FLIP;i++){
      flip2eo(i,eo);
      for(m=0;m<18;m++){
        var op2=ops[m].state;
        for(k=0;k<12;k++) eo2[k]=(eo[op2.ep[k]]+op2.eo[k])%2;
        flipMove[i*18+m]=eo2flip(eo2);
      }
    }
    progress&&progress(0.10,"slice tables");
    sliceMove=new Int32Array(N_SLICE*18);
    var pos4=new Array(4), occ=new Array(12), occ2=new Array(12);
    for(i=0;i<N_SLICE;i++){
      combUnrank(i,pos4);
      for(k=0;k<12;k++) occ[k]=0;
      for(k=0;k<4;k++) occ[pos4[k]]=1;
      for(m=0;m<18;m++){
        var op3=ops[m].state;
        for(k=0;k<12;k++) occ2[k]=occ[op3.ep[k]];
        sliceMove[i*18+m]=occ2slice(occ2);
      }
    }
    var occH=new Array(12);
    for(k=0;k<12;k++) occH[k]=isSlice[k]?1:0;
    sliceHome=occ2slice(occH);

    progress&&progress(0.18,"corner permutation table");
    cpMove=new Int32Array(N_PERM*18);
    var p8=new Array(8), p8b=new Array(8);
    for(i=0;i<N_PERM;i++){
      permUnrank(i,8,p8);
      for(m=0;m<18;m++){
        var op4=ops[m].state;
        for(k=0;k<8;k++) p8b[k]=p8[op4.cp[k]];
        cpMove[i*18+m]=permRank(p8b);
      }
    }
    progress&&progress(0.45,"edge permutation table");
    /* phase-2 only: UD-edge permutation over UD positions */
    var opUD=[], opS4=[];
    for(var mi=0;mi<ph2Moves.length;mi++){
      m=ph2Moves[mi];
      var op5=ops[m].state, ru=new Array(8), rs=new Array(4);
      for(k=0;k<8;k++) ru[k]=udIdxOf[op5.ep[udPos[k]]];
      for(k=0;k<4;k++) rs[k]=sliceIdxOf[op5.ep[slicePos[k]]];
      opUD.push(ru); opS4.push(rs);
    }
    ep8Move=new Int32Array(N_PERM*18);
    for(i=0;i<N_PERM;i++){
      permUnrank(i,8,p8);
      for(var mi2=0;mi2<ph2Moves.length;mi2++){
        for(k=0;k<8;k++) p8b[k]=p8[opUD[mi2][k]];
        ep8Move[i*18+ph2Moves[mi2]]=permRank(p8b);
      }
    }
    s4Move=new Int32Array(N_SLICE4*18);
    var p4=new Array(4), p4b=new Array(4);
    for(i=0;i<N_SLICE4;i++){
      permUnrank(i,4,p4);
      for(var mi3=0;mi3<ph2Moves.length;mi3++){
        for(k=0;k<4;k++) p4b[k]=p4[opS4[mi3][k]];
        s4Move[i*18+ph2Moves[mi3]]=permRank(p4b);
      }
    }

    progress&&progress(0.62,"phase 1 pruning (orientation × slice)");
    prunTS=bfsPair(N_TWIST,N_SLICE,twistMove,sliceMove,allMoves,0,sliceHome);
    progress&&progress(0.78,"phase 1 pruning (flip × slice)");
    prunFS=bfsPair(N_FLIP,N_SLICE,flipMove,sliceMove,allMoves,0,sliceHome);
    progress&&progress(0.88,"phase 2 pruning (corners)");
    prunCS=bfsPair(N_PERM,N_SLICE4,cpMove,s4Move,ph2Moves,0,0);
    progress&&progress(0.96,"phase 2 pruning (edges)");
    prunES=bfsPair(N_PERM,N_SLICE4,ep8Move,s4Move,ph2Moves,0,0);
    progress&&progress(1,"ready");
    self.ready=true;
  };

  function allowedAfter(last, m){
    if(last<0) return true;
    var f1=opFace[last], f2=opFace[m];
    if(f1===f2) return false;
    if((f1%3)===(f2%3) && f2>f1) return false; /* fixed order on an axis */
    return true;
  }

  self.solve=function(state, budgetMs){
    if(!self.ready) throw new Error("solver not initialised");
    budgetMs=budgetMs||600;
    var t0=Date.now();
    var twist0=co2twist(state.co);
    var flip0=eo2flip(state.eo);
    /* positions and cubie ids share an index space, so a cubie is a
       slice cubie iff its id is a slice position id */
    var occ=new Array(12), i;
    for(i=0;i<12;i++) occ[i]= (sliceIdxOf[state.ep[i]]!==undefined)?1:0;
    var slice0=occ2slice(occ);

    var best=null, bestSplit=0;
    var ph1=new Array(13), TIMEOUT={};

    function phase2From(st, d1){
      /* coordinates for phase 2 */
      var cp=permRank(st.cp);
      var p8=new Array(8), p4=new Array(4), k;
      for(k=0;k<8;k++) p8[k]=udIdxOf[st.ep[udPos[k]]];
      for(k=0;k<4;k++) p4[k]=sliceIdxOf[st.ep[slicePos[k]]];
      var e8=permRank(p8), s4=permRank(p4);
      var maxD2=(best?best.length:99)-d1-1;
      if(maxD2>18) maxD2=18;
      var h=Math.max(prunCS[cp*24+s4], prunES[e8*24+s4]);
      if(h>maxD2) return;
      var moves2=new Array(18);
      function dfs2(cp2,e82,s42,depth,last,idx){
        if(Date.now()-t0>budgetMs) throw TIMEOUT;
        var h2=Math.max(prunCS[cp2*24+s42], prunES[e82*24+s42]);
        if(h2>depth) return false;
        if(depth===0){
          if(cp2===0&&e82===0&&s42===0){
            best=ph1.slice(0,d1).concat(moves2.slice(0,idx));
            bestSplit=d1;
            return true;
          }
          return false;
        }
        for(var mi=0;mi<ph2Moves.length;mi++){
          var m=ph2Moves[mi];
          if(!allowedAfter(last,m)) continue;
          moves2[idx]=m;
          if(dfs2(cpMove[cp2*18+m], ep8Move[e82*18+m], s4Move[s42*18+m],
                  depth-1, m, idx+1)) return true;
        }
        return false;
      }
      for(var d2=h; d2<=maxD2; d2++){
        if(dfs2(cp,e8,s4,d2, d1>0?ph1[d1-1]:-1, 0)) return;
      }
    }

    function dfs1(tw,fl,sl,depth,last,idx,d1){
      if(Date.now()-t0>budgetMs) throw TIMEOUT;
      var h=Math.max(prunTS[tw*495+sl], prunFS[fl*495+sl]);
      if(h>depth) return;
      if(depth===0){
        if(tw===0&&fl===0&&sl===sliceHome){
          /* compose the actual cubie state along ph1 */
          var st=state;
          for(var q=0;q<d1;q++) st=applyOp(st, ops[ph1[q]].state);
          phase2From(st, d1);
        }
        return;
      }
      for(var m=0;m<18;m++){
        if(!allowedAfter(last,m)) continue;
        ph1[idx]=m;
        dfs1(twistMove[tw*18+m], flipMove[fl*18+m], sliceMove[sl*18+m],
             depth-1, m, idx+1, d1);
      }
    }

    try{
      for(var d1=0; d1<=12; d1++){
        dfs1(twist0, flip0, slice0, d1, -1, 0, d1);
        if(best && best.length<=21 && d1>=Math.min(best.length,9)) break;
      }
    }catch(e){ if(e!==TIMEOUT) throw e; }

    if(!best) return null;
    var out=best.map(function(m){ return ops[m].name; });
    out.split=bestSplit;   /* moves 0..split-1 are phase 1 (reaching G1) */
    return out;
  };

  /* where a cubie state sits in the two coordinate spaces — used by the
     map view. d1 = proven minimum turns to reach G1; once inside G1,
     d2 = proven minimum turns to home. */
  self.coords=function(state){
    if(!self.ready) throw new Error("solver not initialised");
    var twist=co2twist(state.co), flip=eo2flip(state.eo), i;
    var occ=new Array(12);
    for(i=0;i<12;i++) occ[i]=(sliceIdxOf[state.ep[i]]!==undefined)?1:0;
    var slice=occ2slice(occ);
    var out={ twist:twist, flip:flip, slice:slice,
              id:twist*N_SLICE+slice,
              d1:Math.max(prunTS[twist*N_SLICE+slice], prunFS[flip*N_SLICE+slice]),
              g:false, d2:0, id2:0 };
    if(twist===0&&flip===0&&slice===sliceHome){
      out.g=true;
      var cp=permRank(state.cp), p8=new Array(8), p4=new Array(4), k;
      for(k=0;k<8;k++) p8[k]=udIdxOf[state.ep[udPos[k]]];
      for(k=0;k<4;k++) p4[k]=sliceIdxOf[state.ep[slicePos[k]]];
      var e8=permRank(p8), s4=permRank(p4);
      out.id2=cp*24+s4;
      out.d2=Math.max(prunCS[cp*24+s4], prunES[e8*24+s4]);
    }
    return out;
  };
  self.tables=function(){ return { prunTS:prunTS, prunCS:prunCS }; };

  return self;
}

/* ================= Solver2: God's algorithm for 2×2 ================= */
/* ops: 9 move-ops (U,U2,U',R,R2,R',F,F2,F') as {name, state:{cp,co}};
   dbl: index of the fixed DBL cubie/position. */
function Solver2(ops, dbl){
  var self={ ready:false };
  var N_P=5040, N_O=729;
  var mapIdx=[], i;         /* corner id (0..7, skipping dbl) → 0..6 */
  for(i=0;i<8;i++) if(i!==dbl) mapIdx.push(i);
  var slot=new Array(8);
  mapIdx.forEach(function(v,k){ slot[v]=k; });

  var permMove, oriMove, depth;

  function encP(cp){
    var p=new Array(7), k;
    for(k=0;k<7;k++) p[k]=slot[cp[mapIdx[k]]];
    return permRank(p);
  }
  function encO(co){
    var t=0, k;
    for(k=0;k<6;k++) t=t*3+co[mapIdx[k]];
    return t;
  }

  self.init=function(progress){
    var p7=new Array(7), p7b=new Array(7), m, k;
    /* restricted op arrays over the 7 movable positions */
    var opP=ops.map(function(o){
      var r=new Array(7);
      for(k=0;k<7;k++) r[k]=slot[o.state.cp[mapIdx[k]]];
      return r;
    });
    var opO=ops.map(function(o){
      var r=new Array(7);
      for(k=0;k<7;k++) r[k]=o.state.co[mapIdx[k]];
      return r;
    });
    progress&&progress(0.05,"permutation table");
    permMove=new Int32Array(N_P*9);
    for(i=0;i<N_P;i++){
      permUnrank(i,7,p7);
      for(m=0;m<9;m++){
        for(k=0;k<7;k++) p7b[k]=p7[opP[m][k]];
        permMove[i*9+m]=permRank(p7b);
      }
    }
    progress&&progress(0.15,"orientation table");
    oriMove=new Int32Array(N_O*9);
    var o7=new Array(7), o7b=new Array(7);
    for(i=0;i<N_O;i++){
      var t=i, s=0;
      for(k=5;k>=0;k--){ o7[k]=t%3; s+=o7[k]; t=(t/3)|0; }
      o7[6]=(30-s)%3;
      for(m=0;m<9;m++){
        var x=0;
        for(k=0;k<6;k++) x=x*3+((o7[opP[m][k]]+opO[m][k])%3);
        oriMove[i*9+m]=x;
      }
    }
    progress&&progress(0.25,"breadth-first walk of all 3,674,160 states");
    depth=new Uint8Array(N_P*N_O); depth.fill(255);
    var q=new Int32Array(N_P*N_O), head=0, tail=0;
    depth[0]=0; q[tail++]=0;
    var reported=0.25;
    while(head<tail){
      var s2=q[head++], p=(s2/N_O)|0, o=s2%N_O, d=depth[s2]+1;
      for(m=0;m<9;m++){
        var nxt=permMove[p*9+m]*N_O + oriMove[o*9+m];
        if(depth[nxt]===255){ depth[nxt]=d; q[tail++]=nxt; }
      }
      if(progress && head%400000===0){
        var pct=0.25+0.75*head/(N_P*N_O);
        if(pct>reported+0.05){ reported=pct; progress(pct,"breadth-first walk"); }
      }
    }
    progress&&progress(1,"ready");
    self.ready=true;
  };

  function descend(p, o){
    var moves=[], guard=0;
    while(depth[p*N_O+o]>0){
      var d=depth[p*N_O+o], taken=-1;
      for(var m=0;m<9;m++){
        var p2=permMove[p*9+m], o2=oriMove[o*9+m];
        if(depth[p2*N_O+o2]===d-1){ p=p2; o=o2; taken=m; break; }
      }
      if(taken<0 || ++guard>12) throw new Error("descent failed");
      moves.push(ops[taken].name);
    }
    return moves;
  }

  self.solve=function(state){
    if(!self.ready) throw new Error("solver not initialised");
    if(state.cp[dbl]!==dbl || state.co[dbl]!==0)
      throw new Error("DBL corner is not anchored");
    return descend(encP(state.cp), encO(state.co));
  };

  /* optimal route from an encoded state id to home — used to walk to
     named specimens like the 2,644 antipodes at distance 11 */
  self.routeFromId=function(id){
    if(!self.ready) throw new Error("solver not initialised");
    return descend((id/N_O)|0, id%N_O);
  };

  self.distance=function(state){
    return depth[encP(state.cp)*N_O+encO(state.co)];
  };

  /* map-view helpers: where a state sits in the full 3,674,160-state
     space, and the raw God table itself */
  self.encode=function(state){
    var p=encP(state.cp), o=encO(state.co);
    return { id:p*N_O+o, d:depth[p*N_O+o] };
  };
  self.table=function(){ return depth; };

  return self;
}

return { analyze:analyze, applyOp:applyOp, Solver3:Solver3, Solver2:Solver2,
         permRank:permRank, permUnrank:permUnrank,
         combRank:combRank, combUnrank:combUnrank };
}));
