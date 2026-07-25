/* puzzle.js — the geometry & permutation engine for the solving room.
   Pure math, no DOM: every twisty puzzle here is just a set of sticker
   polygons in 3-space plus, for each twist, a permutation derived
   numerically by rotating sticker centers and matching them to their
   new homes. Runs in the page, in a worker, or in node (for tests). */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.PuzzleEngine = factory();
}(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* ---------- little vector kit ---------- */
function add(a,b){ return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function sub(a,b){ return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function scl(a,s){ return [a[0]*s, a[1]*s, a[2]*s]; }
function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function len(a){ return Math.sqrt(dot(a,a)); }
function norm(a){ var l=len(a); return [a[0]/l, a[1]/l, a[2]/l]; }
function mix(a,b,t){ return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }

/* Rodrigues rotation of point p about unit axis u by angle ang */
function rotAxis(p, u, ang){
  var c=Math.cos(ang), s=Math.sin(ang), d=dot(u,p), cr=cross(u,p);
  return [
    p[0]*c + cr[0]*s + u[0]*d*(1-c),
    p[1]*c + cr[1]*s + u[1]*d*(1-c),
    p[2]*c + cr[2]*s + u[2]*d*(1-c)
  ];
}

function centroid(poly){
  var c=[0,0,0], i;
  for(i=0;i<poly.length;i++) c=add(c,poly[i]);
  return scl(c, 1/poly.length);
}

/* Sutherland–Hodgman: keep the part of poly with dot(n,x) <= d */
function clipPoly(poly, n, d){
  var out=[], m=poly.length, i;
  for(i=0;i<m;i++){
    var a=poly[i], b=poly[(i+1)%m];
    var da=dot(n,a)-d, db=dot(n,b)-d;
    if(da<=1e-9) out.push(a);
    if((da<-1e-9&&db>1e-9)||(da>1e-9&&db<-1e-9)){
      out.push(mix(a,b, da/(da-db)));
    }
  }
  return out;
}

/* shrink a polygon toward its centroid (sticker gap) */
function insetPoly(poly, f){
  var c=centroid(poly);
  return poly.map(function(p){ return mix(c,p,f); });
}

/* chamfer corners: each vertex becomes two, softened toward neighbours */
function chamferPoly(poly, t){
  var out=[], m=poly.length, i;
  for(i=0;i<m;i++){
    var prev=poly[(i-1+m)%m], p=poly[i], next=poly[(i+1)%m];
    out.push(mix(p,prev,t));
    out.push(mix(p,next,t));
  }
  return out;
}

/* ensure polygon winds counter-clockwise when seen from outside (along n) */
function windPoly(poly, n){
  if(poly.length<3) return poly;
  var a=sub(poly[1],poly[0]), b=sub(poly[2],poly[0]);
  return dot(cross(a,b),n) >= 0 ? poly : poly.slice().reverse();
}

/* ---------- shared: numeric permutation for a twist ---------- */
function derivePerm(stickers, members, axis, ang, tol){
  var size=stickers.length;
  var to=new Int32Array(size), i, j;
  for(i=0;i<size;i++) to[i]=i;
  for(i=0;i<members.length;i++){
    var s=members[i];
    var c=rotAxis(stickers[s].center, axis, ang);
    var found=-1;
    for(j=0;j<members.length;j++){
      var m2=members[j];
      var d=sub(stickers[m2].center, c);
      if(dot(d,d)<tol*tol){ found=m2; break; }
    }
    if(found<0) throw new Error("twist permutation failed to close (tol "+tol+")");
    to[s]=found;
  }
  return to;
}

function minStickerGap(stickers){
  var best=Infinity, i, j;
  for(i=0;i<stickers.length;i++) for(j=i+1;j<stickers.length;j++){
    var d=sub(stickers[i].center, stickers[j].center);
    var l=dot(d,d);
    if(l<best) best=l;
  }
  return Math.sqrt(best);
}

/* ================= cubes: n = 2..5 ================= */

/* face order U,R,F,D,L,B — normals +y,+x,+z,-y,-x,-z */
var CUBE_FACES=[
  {letter:"U", n:[0, 1, 0]},
  {letter:"R", n:[1, 0, 0]},
  {letter:"F", n:[0, 0, 1]},
  {letter:"D", n:[0,-1, 0]},
  {letter:"L", n:[-1,0, 0]},
  {letter:"B", n:[0, 0,-1]}
];
var AXES=[[1,0,0],[0,1,0],[0,0,1]];

function buildCube(n){
  var SIZE=2.6;                 /* constant physical edge length across n */
  var pitch=SIZE/n, h=SIZE/2;
  var stickers=[], f, i, j, k;

  for(f=0; f<6; f++){
    var nrm=CUBE_FACES[f].n;
    /* in-plane basis */
    var up = Math.abs(nrm[1])>0.9 ? [0,0,1] : [0,1,0];
    var u = norm(cross(up, nrm));
    var v = cross(nrm, u);
    for(i=0;i<n;i++) for(j=0;j<n;j++){
      var cu=(i-(n-1)/2)*pitch, cv=(j-(n-1)/2)*pitch;
      var c = add(scl(nrm,h), add(scl(u,cu), scl(v,cv)));
      var s = pitch*0.5*0.92;   /* sticker gap */
      var quad=[
        add(c, add(scl(u,-s), scl(v,-s))),
        add(c, add(scl(u, s), scl(v,-s))),
        add(c, add(scl(u, s), scl(v, s))),
        add(c, add(scl(u,-s), scl(v, s)))
      ];
      var poly = windPoly(chamferPoly(quad, 0.10), nrm);
      stickers.push({ poly:poly, center:c, normal:nrm.slice(), face:f, depth:pitch*0.98 });
    }
  }

  /* layer index of a coordinate along an axis (face stickers clamp in) */
  function layerOf(c, ax){
    var t=Math.round(c[ax]/pitch + (n-1)/2);
    return Math.max(0, Math.min(n-1, t));
  }

  var tol=minStickerGap(stickers)*0.4;
  var twists=[], ax, L;
  for(ax=0; ax<3; ax++) for(L=0; L<n; L++){
    var members=[];
    for(k=0;k<stickers.length;k++) if(layerOf(stickers[k].center, ax)===L) members.push(k);
    var to=derivePerm(stickers, members, AXES[ax], Math.PI/2, tol);
    twists.push({ axis:AXES[ax].slice(), step:Math.PI/2, order:4,
                  members:new Int32Array(members), to:to, ax:ax, layer:L });
  }

  var P = basePuzzle("cube"+n, stickers, twists, 6,
                     CUBE_FACES.map(function(x){return x.letter;}));
  P.n = n;
  P.pitch = pitch;
  P.radius = h*Math.sqrt(3);

  /* which twist is which face: +end faces R(x),U(y),F(z); -end L,D,B */
  var faceTwist = {
    U:{ax:1,layer:n-1,pos:true}, D:{ax:1,layer:0,pos:false},
    R:{ax:0,layer:n-1,pos:true}, L:{ax:0,layer:0,pos:false},
    F:{ax:2,layer:n-1,pos:true}, B:{ax:2,layer:0,pos:false}
  };
  function twistIndex(ax,layer){ return ax*n+layer; }

  /* "R", "R'", "R2", "2R", "3L'" → move. A clockwise turn of a +end
     face is −90° about the +axis, i.e. three +90° steps; on a −end
     face it is one +90° step. A leading digit picks the layer counted
     in from that face (SiGN style). */
  P.namedMove=function(name){
    var m=/^(\d*)([URFDLB])(2|')?$/.exec(name);
    if(!m) throw new Error("bad cube move "+name);
    var depth=m[1]?parseInt(m[1],10):1;
    if(depth<1||depth>n) throw new Error("no layer "+depth+" on a "+n+"×"+n);
    var letter=m[2];
    var ax = (letter==="R"||letter==="L") ? 0 : (letter==="U"||letter==="D") ? 1 : 2;
    var pos = letter==="R"||letter==="U"||letter==="F";
    var layer = pos ? n-depth : depth-1;
    var base = pos?3:1;
    var turns = m[3]==="2" ? 2 : m[3]==="'" ? (4-base) : base;
    return { t:twistIndex(ax, layer), n:turns };
  };

  P.moveName=function(mv){
    var tw=P.twists[mv.t], axI=tw.ax, L2=tw.layer;
    var fromPos = L2 >= n/2;                  /* name from the nearer face */
    var letter = axI===0 ? (fromPos?"R":"L") : axI===1 ? (fromPos?"U":"D") : (fromPos?"F":"B");
    var depth = fromPos ? (n-L2) : (L2+1);    /* 1 = outer layer */
    var base = fromPos?3:1;                   /* turns meaning "clockwise" */
    var suffix = mv.n===2 ? "2" : (mv.n===base ? "" : "'");
    return (depth>1 ? depth : "") + letter + suffix;
  };

  /* scramble: for 2x2 only U,R,F layers so the DBL cubie stays put;
     for 3x3 outer layers only (fixed centers keep the solver honest);
     big cubes may stir every layer. */
  var scrambleTwists=[];
  if(n===2){
    scrambleTwists=[twistIndex(0,1), twistIndex(1,1), twistIndex(2,1)];
  } else if(n===3){
    ["U","R","F","D","L","B"].forEach(function(f2){
      scrambleTwists.push(twistIndex(faceTwist[f2].ax, faceTwist[f2].layer));
    });
  } else {
    for(ax=0;ax<3;ax++) for(L=0;L<n;L++) scrambleTwists.push(twistIndex(ax,L));
  }
  P.scrambleTwists=scrambleTwists;
  P.faceOf={U:0,R:1,F:2,D:3,L:4,B:5};

  /* cubie bookkeeping for the solvers (2x2 & 3x3) */
  if(n===2||n===3) P.cubies = cubieMap(P);
  return P;
}

/* group stickers into cubies; order corner stickers clockwise-from-outside
   starting with the U/D sticker; edges as [primary(U/D else F/B), other] */
function cubieMap(P){
  var n=P.n, pitch=P.pitch, byCubie={}, k;
  for(k=0;k<P.stickers.length;k++){
    var c=P.stickers[k].center;
    var g=[0,1,2].map(function(ax){
      return Math.max(0, Math.min(n-1, Math.round(c[ax]/pitch+(n-1)/2)));
    });
    var key=g.join(",");
    (byCubie[key]=byCubie[key]||{g:g, stickers:[]}).stickers.push(k);
  }
  var corners=[], edges=[];
  Object.keys(byCubie).sort().forEach(function(key){
    var cb=byCubie[key], g=cb.g;
    var ext=g.filter(function(x){return x===0||x===n-1;}).length;
    if(cb.stickers.length===3 && ext===3){
      /* corner: direction = cubie corner vector */
      var d=norm([g[0]-(n-1)/2, g[1]-(n-1)/2, g[2]-(n-1)/2]);
      var e1=norm(sub(P.stickers[cb.stickers[0]].normal,
                      scl(d, dot(P.stickers[cb.stickers[0]].normal,d))));
      var e2=cross(d,e1);
      var list=cb.stickers.map(function(si){
        var nn=P.stickers[si].normal;
        return { si:si, face:P.stickers[si].face,
                 ang:Math.atan2(dot(nn,e2), dot(nn,e1)) };
      });
      /* clockwise viewed from outside = decreasing angle about d */
      list.sort(function(a,b){ return b.ang-a.ang; });
      /* rotate so the U/D sticker is first */
      var udAt=list.findIndex(function(x){ return x.face===0||x.face===3; });
      list=list.slice(udAt).concat(list.slice(0,udAt));
      corners.push({ stickers:list.map(function(x){return x.si;}),
                     faces:list.map(function(x){return x.face;}) });
    } else if(cb.stickers.length===2){
      var l2=cb.stickers.map(function(si){
        return { si:si, face:P.stickers[si].face };
      });
      l2.sort(function(a,b){
        function rank(f){ return (f===0||f===3)?0:(f===2||f===5)?1:2; }
        return rank(a.face)-rank(b.face);
      });
      edges.push({ stickers:l2.map(function(x){return x.si;}),
                   faces:l2.map(function(x){return x.face;}) });
    }
  });
  return { corners:corners, edges:edges };
}

/* ================= megaminx ================= */

function buildMegaminx(){
  var PHI=(1+Math.sqrt(5))/2;
  var verts=[], normals=[], i, j, s1, s2;
  /* dodecahedron vertices */
  for(var a=-1;a<=1;a+=2) for(var b=-1;b<=1;b+=2) for(var c=-1;c<=1;c+=2) verts.push([a,b,c]);
  for(s1=-1;s1<=1;s1+=2) for(s2=-1;s2<=1;s2+=2){
    verts.push([0, s1/PHI, s2*PHI]);
    verts.push([s1/PHI, s2*PHI, 0]);
    verts.push([s1*PHI, 0, s2/PHI]);
  }
  /* face normals: cyclic permutations of (±1, 0, ±φ) — the dual
     icosahedron for THIS dodecahedron orientation */
  for(s1=-1;s1<=1;s1+=2) for(s2=-1;s2<=1;s2+=2){
    normals.push(norm([s1, 0, s2*PHI]));
    normals.push(norm([0, s1*PHI, s2]));
    normals.push(norm([s1*PHI, s2, 0]));
  }

  var SCALE=1.16;               /* overall size: circumradius √3·SCALE */
  verts=verts.map(function(v){ return scl(v,SCALE); });

  var faces=normals.map(function(nrm){
    var scored=verts.map(function(v,idx){ return {idx:idx, d:dot(v,nrm)}; })
                    .sort(function(a,b){ return b.d-a.d; })
                    .slice(0,5);
    var df=scored[0].d;
    var pts=scored.map(function(x){ return verts[x.idx]; });
    /* sort pentagon verts by angle about the normal */
    var ctr=centroid(pts);
    var e1=norm(sub(pts[0],scl(nrm,dot(pts[0],nrm))));
    var e2=cross(nrm,e1);
    pts.sort(function(p,q){
      return Math.atan2(dot(p,e2),dot(p,e1)) - Math.atan2(dot(q,e2),dot(q,e1));
    });
    return { n:nrm, d:df, pent:pts, center:ctr };
  });
  var df=faces[0].d;

  /* adjacency: two faces share an edge iff normals meet at acos(1/√5) */
  var COSADJ=1/Math.sqrt(5);
  faces.forEach(function(F){
    var adj=[];
    faces.forEach(function(G,gi){
      if(Math.abs(dot(F.n,G.n)-COSADJ)<1e-6) adj.push(gi);
    });
    /* order the five neighbours cyclically around F's normal */
    var e1=norm(sub(faces[adj[0]].n, scl(F.n, dot(faces[adj[0]].n,F.n))));
    var e2=cross(F.n,e1);
    adj.sort(function(g1,g2){
      function ang(gi){ var nn=faces[gi].n;
        return Math.atan2(dot(nn,e2),dot(nn,e1)); }
      return ang(g1)-ang(g2);
    });
    F.adj=adj;
  });

  /* the cut: a plane parallel to each face. fraction f of the way from
     face-center chord toward the shared edge (0.54 ≈ the classic look) */
  var f=0.54;
  var dc = df*(COSADJ + f*(1-COSADJ));

  var stickers=[];
  faces.forEach(function(F, fi){
    var pent=F.pent;
    var A=F.adj, m=A.length;
    function outer(poly, gi){ /* keep side beyond G's cut: n_G·x >= dc */
      return clipPoly(poly, scl(faces[gi].n,-1), -dc);
    }
    function inner(poly, gi){ return clipPoly(poly, faces[gi].n, dc); }
    function push(poly){
      if(poly.length<3) throw new Error("megaminx sticker degenerate");
      var ctr=centroid(poly);
      var shaped=windPoly(chamferPoly(insetPoly(poly,0.92),0.13), F.n);
      stickers.push({ poly:shaped, center:ctr, normal:F.n.slice(), face:fi, depth:0.34*SCALE });
    }
    /* center */
    var mid=pent;
    for(i=0;i<m;i++) mid=inner(mid, A[i]);
    push(mid);
    /* edges & corners between consecutive neighbours */
    for(i=0;i<m;i++){
      var g=A[i], gPrev=A[(i-1+m)%m], gNext=A[(i+1)%m];
      push(inner(inner(outer(pent,g), gPrev), gNext));   /* edge sticker */
      push(outer(outer(pent,g), gNext));                  /* corner sticker */
    }
  });

  var tol=minStickerGap(stickers)*0.4;
  var twists=faces.map(function(F, fi){
    var members=[];
    for(i=0;i<stickers.length;i++)
      if(dot(stickers[i].center, F.n) > dc + 1e-9) members.push(i);
    var to=derivePerm(stickers, members, F.n, 2*Math.PI/5, tol);
    return { axis:F.n.slice(), step:2*Math.PI/5, order:5,
             members:new Int32Array(members), to:to, faceIdx:fi };
  });

  var letters="ABCDEFGHIJKL".split("");
  var P=basePuzzle("mega", stickers, twists, 12, letters);
  P.radius=Math.sqrt(3)*SCALE;
  P.scrambleTwists=twists.map(function(_,idx){ return idx; });
  P.moveName=function(mv){
    var sfx = mv.n===1?"+" : mv.n===2?"++" : mv.n===3?"−−" : "−";
    return letters[P.twists[mv.t].faceIdx]+sfx;
  };
  /* "C+", "F−−", ascii minus accepted too */
  P.namedMove=function(name){
    var m=/^([A-L])(\+\+|\+|−−|−|--|-)$/.exec(name);
    if(!m) throw new Error("bad megaminx move "+name);
    var turns = m[2]==="+" ? 1 : m[2]==="++" ? 2 :
                (m[2]==="−−"||m[2]==="--") ? 3 : 4;
    return { t:letters.indexOf(m[1]), n:turns };
  };
  return P;
}

/* ================= shared puzzle skeleton ================= */

function basePuzzle(kind, stickers, twists, faceCount, faceLetters){
  var size=stickers.length;
  var P={
    kind:kind, stickers:stickers, twists:twists,
    faceCount:faceCount, faceLetters:faceLetters, size:size,

    newColors:function(){
      var c=new Uint8Array(size);
      for(var i=0;i<size;i++) c[i]=stickers[i].face;
      return c;
    },

    applyMove:function(colors, mv){
      var tw=twists[mv.t], to=tw.to, times=((mv.n%tw.order)+tw.order)%tw.order;
      var tmp=new Uint8Array(size);
      for(var k=0;k<times;k++){
        tmp.set(colors);
        for(var i=0;i<size;i++) colors[to[i]]=tmp[i];
      }
      return colors;
    },

    applyWord:function(colors, moves){
      for(var i=0;i<moves.length;i++) P.applyMove(colors, moves[i]);
      return colors;
    },

    invert:function(mv){
      var o=twists[mv.t].order;
      return { t:mv.t, n:(o - (mv.n%o) + o)%o };
    },

    invertWord:function(moves){
      return moves.slice().reverse().map(P.invert);
    },

    isSolved:function(colors){
      var seen={};
      for(var i=0;i<size;i++){
        var f=stickers[i].face;
        if(seen[f]===undefined) seen[f]=colors[i];
        else if(seen[f]!==colors[i]) return false;
      }
      return true;
    },

    scramble:function(count, rand){
      rand=rand||Math.random;
      var moves=[], lastT=-1, lastAx=-1, axRun=0;
      while(moves.length<count){
        var t=P.scrambleTwists[(rand()*P.scrambleTwists.length)|0];
        if(t===lastT) continue;
        var tw=twists[t];
        var axKey=(tw.ax!==undefined)?tw.ax:-1;
        if(axKey>=0 && axKey===lastAx){ if(++axRun>=3) continue; }
        else axRun=1;
        var o=tw.order;
        var turns=1+((rand()*(o-1))|0);
        moves.push({t:t, n:turns});
        lastT=t; lastAx=axKey;
      }
      return moves;
    }
  };
  return P;
}

return {
  build:function(kind){
    if(kind==="mega") return buildMegaminx();
    var n=parseInt(String(kind).replace(/\D/g,""),10);
    if(!(n>=2&&n<=5)) throw new Error("unknown puzzle "+kind);
    return buildCube(n);
  }
};
}));
