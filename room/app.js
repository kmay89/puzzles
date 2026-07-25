/* app.js — the solving room, on screen.
   Raw WebGL: every sticker is a little extruded prism; a twist is a
   rotation of one slab of prisms; the camera is a mass on a spring so
   the puzzle carries momentum when you fling it and rubber-bands back
   when you push it past the poles. No libraries. */
/* global PuzzleEngine, MapView */
(function(){
"use strict";
var REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- palettes (the desk's colours) ---------- */
var PLASTIC = [0.085, 0.070, 0.058];
var CUBE_PAL = ["#f2ead9","#ff5d5d","#3fc472","#f5b63f","#ff8a5c","#5aa2ff"]; /* U R F D L B */
/* ordered so the vivid colours land on the faces the default camera sees */
var MEGA_PAL = ["#b79cff","#ff8a5c","#ff9ec2","#3fc472","#f5b63f","#d9c79a",
                "#b7e07a","#9aa7b0","#35c4b5","#f2ead9","#ff5d5d","#5aa2ff"];
function hex2rgb(h){
  return [parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255];
}

var KINDS = {
  cube2:{ label:"2×2", scramble:16, pal:CUBE_PAL,
    method:"God's algorithm — provably optimal",
    fact:"3,674,160 positions · God's number: 11 · solved by breadth-first search over every state" },
  cube3:{ label:"3×3", scramble:25, pal:CUBE_PAL,
    method:"Kociemba two-phase",
    fact:"43,252,003,274,489,856,000 positions · God's number: 20 · solved through the subgroup G1 = ⟨U,D,R²,L²,F²,B²⟩" },
  cube4:{ label:"4×4", scramble:45, pal:CUBE_PAL,
    method:"Ariadne's thread — the scramble, inverted",
    fact:"≈ 7.40 × 10⁴⁵ positions · no optimal solver fits in a browser tab, so it retraces its own thread" },
  cube5:{ label:"5×5", scramble:60, pal:CUBE_PAL,
    method:"Ariadne's thread — the scramble, inverted",
    fact:"≈ 2.83 × 10⁷⁴ positions · more states than atoms in the observable universe, squared wouldn't be far off" },
  mega:{ label:"Megaminx", scramble:70, pal:MEGA_PAL,
    method:"Ariadne's thread — the scramble, inverted",
    fact:"≈ 1.01 × 10⁶⁸ positions · twelve faces, and the same group theory as the cube" }
};

/* ---------- tiny mat4 kit ---------- */
function mIdentity(){ return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mMul(a,b){
  var o=new Array(16), r, c, k, s;
  for(c=0;c<4;c++) for(r=0;r<4;r++){
    s=0; for(k=0;k<4;k++) s+=a[k*4+r]*b[c*4+k];
    o[c*4+r]=s;
  }
  return o;
}
function mPersp(fovy,aspect,near,far){
  var f=1/Math.tan(fovy/2), nf=1/(near-far);
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0];
}
function mTranslate(x,y,z){ var m=mIdentity(); m[12]=x; m[13]=y; m[14]=z; return m; }
function mRotX(a){ var c=Math.cos(a),s=Math.sin(a);
  return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; }
function mRotY(a){ var c=Math.cos(a),s=Math.sin(a);
  return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; }
function mAxisAngle(u,a){
  var c=Math.cos(a), s=Math.sin(a), t=1-c, x=u[0],y=u[1],z=u[2];
  return [ t*x*x+c,   t*x*y+s*z, t*x*z-s*y, 0,
           t*x*y-s*z, t*y*y+c,   t*y*z+s*x, 0,
           t*x*z+s*y, t*y*z-s*x, t*z*z+c,   0,
           0,0,0,1 ];
}

/* ---------- DOM ---------- */
var canvas=document.getElementById("stage");
var elStatus=document.getElementById("status");
var elFact=document.getElementById("fact");
var elTicker=document.getElementById("ticker");
var btnScramble=document.getElementById("btnScramble");
var btnSolve=document.getElementById("btnSolve");
var btnStop=document.getElementById("btnStop");
var btnMap=document.getElementById("btnMap");
var btnScan=document.getElementById("btnScan");
var btnStats=document.getElementById("btnStats");
var btnSpecimen=document.getElementById("btnSpecimen");
var statsCard=document.getElementById("stats");
var statBars=document.getElementById("statBars");
var statCap=document.getElementById("statCap");
var statLines=document.getElementById("statLines");
var mapCanvas=document.getElementById("map");
var mapCap=document.getElementById("mapCap");
var mapLive=document.getElementById("mapLive");
var teachBadge=document.getElementById("teachBadge");
var teachBar=document.getElementById("teachBar");
var btnTeachNext=document.getElementById("teachNext");
var btnTeachAuto=document.getElementById("teachAuto");
var btnTeachExit=document.getElementById("teachExit");
var pickers=Array.prototype.slice.call(document.querySelectorAll("[data-kind]"));

var gl=canvas.getContext("webgl",{antialias:true, alpha:true, premultipliedAlpha:true});
if(!gl){
  document.getElementById("nogl").hidden=false;
  return;
}

/* ---------- shaders ---------- */
function sh(type,src){
  var s=gl.createShader(type);
  gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}
var prog=gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, [
  "attribute vec3 aPos, aNrm, aCol;",
  "attribute float aTop;",
  "uniform mat4 uProj, uView, uModel;",
  "varying vec3 vN, vC, vP;",
  "varying float vT;",
  "void main(){",
  "  vec4 w = uModel * vec4(aPos,1.0);",
  "  gl_Position = uProj * uView * w;",
  "  vN = mat3(uModel) * aNrm;",
  "  vC = aCol; vT = aTop; vP = w.xyz;",
  "}"].join("\n")));
gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, [
  "precision mediump float;",
  "varying vec3 vN, vC, vP;",
  "varying float vT;",
  "uniform float uGlow;",
  "uniform vec3 uEye;",
  "void main(){",
  "  vec3 n = normalize(vN);",
  "  vec3 key = normalize(vec3(0.55, 0.85, 0.55));",
  "  vec3 fill = normalize(vec3(-0.62, 0.15, -0.45));",
  "  float dKey = max(dot(n,key), 0.0);",
  "  float dFill = max(dot(n,fill), 0.0);",
  "  vec3 lit = vC * (0.40 + 0.82*dKey*vec3(1.0,0.93,0.80) + 0.32*dFill*vec3(0.55,0.62,0.80));",
  "  vec3 v = normalize(uEye - vP);",
  "  vec3 h = normalize(key + v);",
  "  float spec = pow(max(dot(n,h),0.0), 60.0) * (0.10 + 0.30*vT);",
  "  lit += spec * vec3(1.0, 0.95, 0.85);",
  "  lit += vC * uGlow * vT * 0.9;",
  "  float fres = pow(1.0 - max(dot(n,v),0.0), 3.0);",
  "  lit += fres * vec3(0.09,0.07,0.05);",
  "  gl_FragColor = vec4(pow(lit, vec3(0.9)), 1.0);",
  "}"].join("\n")));
gl.linkProgram(prog);
if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);

var loc={
  aPos:gl.getAttribLocation(prog,"aPos"),
  aNrm:gl.getAttribLocation(prog,"aNrm"),
  aCol:gl.getAttribLocation(prog,"aCol"),
  aTop:gl.getAttribLocation(prog,"aTop"),
  uProj:gl.getUniformLocation(prog,"uProj"),
  uView:gl.getUniformLocation(prog,"uView"),
  uModel:gl.getUniformLocation(prog,"uModel"),
  uGlow:gl.getUniformLocation(prog,"uGlow"),
  uEye:gl.getUniformLocation(prog,"uEye")
};

var bufPos=gl.createBuffer(), bufNrm=gl.createBuffer(),
    bufCol=gl.createBuffer(), bufTop=gl.createBuffer(),
    idxStatic=gl.createBuffer(), idxMoving=gl.createBuffer();

/* ---------- puzzle & geometry ---------- */
var P=null, kind=null, colors=null, history=[];
var geo=null;         /* {stickerTopRange, stickerIdxRange, indexArr, vertexColors} */
var pal=null;

function buildGeometry(){
  var pos=[], nrm=[], col=[], top=[], idx=[];
  var topRanges=[], idxRanges=[];
  var i, j;
  for(i=0;i<P.stickers.length;i++){
    var st=P.stickers[i];
    var poly=st.poly, k=poly.length, n=st.normal, d=st.depth;
    var bot=poly.map(function(p){ return [p[0]-n[0]*d, p[1]-n[1]*d, p[2]-n[2]*d]; });
    var v0=pos.length/3, i0=idx.length;

    /* top fan (coloured) */
    var topStart=pos.length/3;
    for(j=0;j<k;j++){
      pos.push(poly[j][0],poly[j][1],poly[j][2]);
      nrm.push(n[0],n[1],n[2]);
      col.push(1,1,1); top.push(1);
    }
    for(j=1;j<k-1;j++) idx.push(v0, v0+j, v0+j+1);
    topRanges.push({start:topStart, count:k});

    /* sides (plastic) */
    for(j=0;j<k;j++){
      var a=poly[j], b=poly[(j+1)%k], a2=bot[j], b2=bot[(j+1)%k];
      var e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
      var e2=[a2[0]-a[0],a2[1]-a[1],a2[2]-a[2]];
      /* outward = e2 × e1 for a CCW-wound top polygon */
      var fn=[e2[1]*e1[2]-e2[2]*e1[1], e2[2]*e1[0]-e2[0]*e1[2], e2[0]*e1[1]-e2[1]*e1[0]];
      var l=Math.hypot(fn[0],fn[1],fn[2])||1;
      fn=[fn[0]/l,fn[1]/l,fn[2]/l];
      var vv=pos.length/3;
      [a,a2,b2,b].forEach(function(p){
        pos.push(p[0],p[1],p[2]); nrm.push(fn[0],fn[1],fn[2]);
        col.push(PLASTIC[0],PLASTIC[1],PLASTIC[2]); top.push(0);
      });
      idx.push(vv,vv+1,vv+2, vv,vv+2,vv+3);
    }
    /* bottom cap (plastic, reversed) */
    var vb=pos.length/3;
    for(j=0;j<k;j++){
      pos.push(bot[j][0],bot[j][1],bot[j][2]);
      nrm.push(-n[0],-n[1],-n[2]);
      col.push(PLASTIC[0],PLASTIC[1],PLASTIC[2]); top.push(0);
    }
    for(j=1;j<k-1;j++) idx.push(vb, vb+j+1, vb+j);

    idxRanges.push({start:i0, count:idx.length-i0});
  }

  geo={ topRanges:topRanges, idxRanges:idxRanges,
        indexArr:new Uint16Array(idx), colorArr:new Float32Array(col),
        vertexCount:pos.length/3 };

  gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufNrm);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nrm), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufTop);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(top), gl.STATIC_DRAW);
  refreshColors();
  setIndexAll();
}

function refreshColors(){
  var i, j;
  for(i=0;i<P.stickers.length;i++){
    var c=pal[colors[i]];
    var r=geo.topRanges[i];
    for(j=0;j<r.count;j++){
      geo.colorArr[(r.start+j)*3]=c[0];
      geo.colorArr[(r.start+j)*3+1]=c[1];
      geo.colorArr[(r.start+j)*3+2]=c[2];
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, bufCol);
  gl.bufferData(gl.ARRAY_BUFFER, geo.colorArr, gl.DYNAMIC_DRAW);
}

var staticCount=0, movingCount=0;
function setIndexAll(){
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxStatic);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indexArr, gl.DYNAMIC_DRAW);
  staticCount=geo.indexArr.length; movingCount=0;
}
function splitIndex(members){
  var isM={}, i, j;
  for(i=0;i<members.length;i++) isM[members[i]]=1;
  var sArr=[], mArr=[];
  for(i=0;i<geo.idxRanges.length;i++){
    var r=geo.idxRanges[i], dst=isM[i]?mArr:sArr;
    for(j=0;j<r.count;j++) dst.push(geo.indexArr[r.start+j]);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxStatic);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(sArr), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxMoving);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mArr), gl.DYNAMIC_DRAW);
  staticCount=sArr.length; movingCount=mArr.length;
}

/* ---------- the teacher's arrow: which layer, which way ----------
   A glowing arc drawn on the turning face before each taught move,
   sweeping in the direction the hand should go, riding the layer
   while it rotates. */
function crossv(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function normv(a){ var l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; }

var arrowBufs=null, arrowFor=null, arrowIdxCount=0;
function buildArrow(mv){
  arrowFor=mv;
  var tw=P.twists[mv.t];
  var n=P.n||3, ua=tw.axis, i2;
  /* megaminx twists have no layer: the face normal is the outside */
  var posEnd = tw.layer===undefined ? true : tw.layer >= n/2;
  var w = posEnd ? ua.slice() : [-ua[0],-ua[1],-ua[2]];
  /* how far out this face sits, measured off the actual stickers */
  var h=0;
  for(i2=0;i2<P.stickers.length;i2++){
    var cc=P.stickers[i2].center;
    var dd=cc[0]*w[0]+cc[1]*w[1]+cc[2]*w[2];
    if(dd>h) h=dd;
  }
  h+=0.05;
  var pick = Math.abs(w[1])>0.9 ? [0,0,1] : [0,1,0];
  var u = normv(crossv(pick, w));
  var v = crossv(w, u);
  var tSigned = mv.n>tw.order/2 ? mv.n-tw.order : mv.n;
  /* which way the stickers will visibly travel, seen from outside */
  var visSign = (posEnd?1:-1) * (tSigned>0?1:-1);
  var sweep = tw.order===5 ? (Math.abs(tSigned)===2 ? 2.2 : 1.35)
                           : (Math.abs(tSigned)===2 ? 3.0 : 1.8);
  var r=0.62*h, wd=0.13, STEPS=20;
  var pos=[], nrm=[], col=[], top=[], idx=[];
  function push(p){
    pos.push(p[0],p[1],p[2]); nrm.push(w[0],w[1],w[2]);
    col.push(1.0,0.79,0.48); top.push(1);
  }
  function pt(th, rr){
    var cu=rr*Math.cos(th), cv=rr*Math.sin(th);
    return [ w[0]*h+u[0]*cu+v[0]*cv, w[1]*h+u[1]*cu+v[1]*cv, w[2]*h+u[2]*cu+v[2]*cv ];
  }
  for(var s=0;s<=STEPS;s++){
    var th=(-sweep/2 + sweep*s/STEPS)*visSign;
    var base=pos.length/3;
    push(pt(th, r-wd)); push(pt(th, r+wd));
    if(s>0) idx.push(base-2,base-1,base, base,base-1,base+1);
  }
  var thE=(sweep/2)*visSign;
  var b2=pos.length/3;
  push(pt(thE, r-0.30)); push(pt(thE, r+0.30)); push(pt(thE+0.45*visSign, r));
  idx.push(b2,b2+1,b2+2);

  if(!arrowBufs) arrowBufs={p:gl.createBuffer(), n:gl.createBuffer(),
                            c:gl.createBuffer(), t:gl.createBuffer(), i:gl.createBuffer()};
  gl.bindBuffer(gl.ARRAY_BUFFER,arrowBufs.p);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(pos),gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,arrowBufs.n);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(nrm),gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,arrowBufs.c);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(col),gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,arrowBufs.t);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(top),gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,arrowBufs.i);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(idx),gl.DYNAMIC_DRAW);
  arrowIdxCount=idx.length;
}

function drawArrow(model, now){
  gl.uniformMatrix4fv(loc.uModel,false,model);
  gl.uniform1f(loc.uGlow, 0.55+0.35*Math.sin(now/260));
  [[arrowBufs.p,loc.aPos,3],[arrowBufs.n,loc.aNrm,3],
   [arrowBufs.c,loc.aCol,3],[arrowBufs.t,loc.aTop,1]].forEach(function(b){
    gl.bindBuffer(gl.ARRAY_BUFFER,b[0]);
    gl.enableVertexAttribArray(b[1]);
    gl.vertexAttribPointer(b[1],b[2],gl.FLOAT,false,0,0);
  });
  gl.disable(gl.CULL_FACE);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,arrowBufs.i);
  gl.drawElements(gl.TRIANGLES,arrowIdxCount,gl.UNSIGNED_SHORT,0);
  gl.enable(gl.CULL_FACE);
}

/* ---------- camera: a mass on a spring ---------- */
var cam={
  yaw:-0.62, pitch:0.44, dist:7.4,
  vyaw:0, vpitch:0, zoom:1, targetZoom:1, fit:1,
  dragging:false, lastX:0, lastY:0, lastT:0,
  idleAt:performance.now()
};
var PITCH_MAX=1.35, BASE_DIST=7.4;

var teachAim=null;   /* {yaw,pitch} — the room shows you the face to turn */
function camTick(dt){
  if(teachAim && !cam.dragging){
    var dy=teachAim.yaw-cam.yaw;
    dy-=Math.round(dy/(2*Math.PI))*2*Math.PI;   /* shortest way round */
    cam.yaw += dy*Math.min(1,2.6*dt);
    cam.pitch += (teachAim.pitch-cam.pitch)*Math.min(1,2.6*dt);
    cam.vyaw=0; cam.vpitch=0;
  }
  if(!cam.dragging){
    cam.yaw += cam.vyaw*dt;
    cam.pitch += cam.vpitch*dt;
    var damp=Math.pow(0.14, dt);          /* momentum bleeding off */
    cam.vyaw*=damp; cam.vpitch*=damp;
    /* rubber band past the poles */
    if(cam.pitch>PITCH_MAX){ cam.pitch += (PITCH_MAX-cam.pitch)*Math.min(1,12*dt); cam.vpitch*=Math.pow(0.002,dt); }
    if(cam.pitch<-PITCH_MAX){ cam.pitch += (-PITCH_MAX-cam.pitch)*Math.min(1,12*dt); cam.vpitch*=Math.pow(0.002,dt); }
    /* idle: the puzzle turns itself to be admired */
    if(!REDUCED && performance.now()-cam.idleAt>5000 && queue.length===0 && !anim){
      cam.vyaw += (0.22-cam.vyaw)*Math.min(1,0.5*dt);
    }
  }
  cam.zoom += (cam.targetZoom-cam.zoom)*Math.min(1,10*dt);
  cam.dist = BASE_DIST*cam.fit*cam.zoom;
}

canvas.addEventListener("pointerdown", function(e){
  if(AR&&AR.mode()==="window"){ AR.tap(); return; }
  if(AR&&AR.mode()) return;
  canvas.setPointerCapture(e.pointerId);
  cam.dragging=true; cam.lastX=e.clientX; cam.lastY=e.clientY;
  cam.lastT=performance.now(); cam.vyaw=0; cam.vpitch=0;
  cam.idleAt=performance.now();
});
canvas.addEventListener("pointermove", function(e){
  if(!cam.dragging) return;
  var now=performance.now(), dt=Math.max(1,now-cam.lastT)/1000;
  var dx=(e.clientX-cam.lastX)/canvas.clientHeight*3.2;
  var dy=(e.clientY-cam.lastY)/canvas.clientHeight*3.2;
  /* pushing past a pole meets rubber, not a wall */
  var give=(cam.pitch>PITCH_MAX||cam.pitch<-PITCH_MAX)?0.28:1;
  cam.yaw+=dx; cam.pitch+=dy*give;
  cam.vyaw=0.7*cam.vyaw+0.3*(dx/dt);
  cam.vpitch=0.7*cam.vpitch+0.3*(dy*give/dt);
  cam.lastX=e.clientX; cam.lastY=e.clientY; cam.lastT=now;
  cam.idleAt=now;
});
function endDrag(){
  cam.dragging=false; cam.idleAt=performance.now();
  if(REDUCED){ cam.vyaw=0; cam.vpitch=0; }
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("wheel", function(e){
  e.preventDefault();
  cam.targetZoom=Math.max(0.62, Math.min(1.6, cam.targetZoom*(1+e.deltaY*0.0012)));
  cam.idleAt=performance.now();
},{passive:false});
canvas.addEventListener("dblclick", function(){
  cam.targetZoom=1; cam.vyaw=0; cam.vpitch=0;
  cam.idleAt=performance.now();
});
/* pinch zoom */
var pinch=null;
canvas.addEventListener("touchstart", function(e){
  if(e.touches.length===2){
    pinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                     e.touches[0].clientY-e.touches[1].clientY);
  }
},{passive:true});
canvas.addEventListener("touchmove", function(e){
  if(e.touches.length===2&&pinch){
    var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                     e.touches[0].clientY-e.touches[1].clientY);
    cam.targetZoom=Math.max(0.62, Math.min(1.6, cam.targetZoom*pinch/d));
    pinch=d;
  }
},{passive:true});
canvas.addEventListener("touchend", function(){ pinch=null; },{passive:true});

/* ---------- move queue & animation ---------- */
var queue=[];         /* [{mv, dur}] */
var anim=null;        /* {mv, twist, t0, dur, target} */
var glow=0, playing=null; /* playing: {label, names, at, t0} for the ticker */
var teach=null;       /* {auto, armed} while the guided solve is on */

/* ---------- the map of everywhere ---------- */
var mapView=null, mapOpen=false, mapCloudKind=null;
var walkReqId=0, walkSteps=null, threadRadii=null;

var MAP_CAPTIONS={
  cube2:"every dot is a real position of the pocket cube · shells = exact turns from home (the God table)",
  cube3:"nebula: all 1,082,565 orientation×slice coordinates, shells = proven turns to G1 · nucleus: the corner-permutation space inside G1",
  other:"the fog is an impression of the word tree — the glowing thread through it is real"
};

function mapStride(){
  var small=Math.min(innerWidth,innerHeight)<700;
  return kind==="cube2" ? (small?4:2) : (small?2:1);
}

/* the big puzzles can't chart their true space (10⁴⁵⁺ states), so the
   map sketches the one thing that IS countable: the tree of move-words,
   thickening outward as every turn multiplies the paths. An impression,
   labeled as one — the walk's thread through it is exact. */
function impressionCloud(){
  var shells=KINDS[kind].scramble;
  var small=Math.min(innerWidth,innerHeight)<700;
  var budget=small?200000:520000;
  var weights=[], total=0, d, i;
  for(d=1; d<=shells; d++){ var x=Math.pow(1.30,d); weights.push(x); total+=x; }
  var pos=new Float32Array(budget*3), dep=new Float32Array(budget), k=0;
  var seed=48271;
  function h(){ seed=(Math.imul(seed,48271)%2147483647+2147483647)%2147483647; return seed/2147483647; }
  for(d=1; d<=shells && k<budget; d++){
    var cnt=Math.max(50, Math.round(budget*weights[d-1]/total));
    for(i=0; i<cnt && k<budget; i++, k++){
      var u=h(), v=h(), jj=h();
      var th=6.2831853*u, cph=2*v-1, sph=Math.sqrt(Math.max(0,1-cph*cph));
      var r=d+(jj-0.5)*0.85;
      pos[k*3]=Math.cos(th)*sph*r;
      pos[k*3+1]=cph*r*0.55;
      pos[k*3+2]=Math.sin(th)*sph*r;
      dep[k]=d;
    }
  }
  return { pos:pos.subarray(0,k*3).slice(), dep:dep.subarray(0,k).slice(),
           n:k, maxd:shells };
}

function ensureMap(){
  if(!mapView){
    mapView=MapView(mapCanvas);
    if(!mapView){ setStatus("the map needs WebGL too — it stays rolled up"); return false; }
  }
  return true;
}

function requestCloud(){
  if(!mapView||!mapOpen) return;
  if(kind==="cube2"||kind==="cube3"){
    mapCap.textContent="charting the space…";
    if(mapCloudKind!==kind)
      getWorker().postMessage({cmd:"map", kind:kind, stride:mapStride()});
    else mapCap.textContent=MAP_CAPTIONS[kind];
  } else {
    var imp=impressionCloud();
    mapView.setClouds([{pos:imp.pos, dep:imp.dep, n:imp.n, maxd:imp.maxd,
                        alpha:0.26, ptScale:34}]);
    mapView.setMaxR(KINDS[kind].scramble*1.02);
    mapCloudKind=null;
    var branch=P.scrambleTwists.length*(P.twists[0].order-1);
    mapCap.textContent=MAP_CAPTIONS.other+" · every turn multiplies the paths ×"+branch;
  }
}

function requestWalk(moves){
  if(!mapView&&!statsOpen) return;
  walkSteps=null; threadRadii=null; hereNow=null;
  if(kind==="cube2"||kind==="cube3"){
    var id=++walkReqId;
    getWorker().postMessage({cmd:"walk", kind:kind, id:id,
      colors:Array.prototype.slice.call(colors),
      names:moves.map(function(m){ return P.moveName(m); })});
  } else {
    var hist=history.slice(), radii=[simplifyWord(hist).length];
    for(var i=0;i<moves.length;i++){
      hist.push(moves[i]);
      radii.push(simplifyWord(hist).length);
    }
    threadRadii=radii;
    if(mapView) mapView.setWalk(mapView.threadWalk(radii));
    updateReadout();
  }
}

/* ---------- the numbers: an exact statistical engine ----------
   Distributions and means computed live from the God table and the
   pruning tables — nothing here is hard-coded except the labels. */
var statsOpen=false, statsCache={}, hereNow=null, locateId=0;

var THREAD_DIGITS={ cube4:45.87, cube5:74.45, mega:68.0 };

function depthColor(f){ /* the map's ramp, for histogram bars */
  function mix(a,b,t){ return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]; }
  var cN=[99,230,169], cM=[186,168,143], cF=[255,201,122], cE=[255,107,92];
  var c=f<0.35?mix(cN,cM,f/0.35):f<0.7?mix(cM,cF,(f-0.35)/0.35):mix(cF,cE,(f-0.7)/0.3);
  return "rgb("+(c[0]|0)+","+(c[1]|0)+","+(c[2]|0)+")";
}

function renderStats(){
  if(!statsOpen) return;
  statBars.innerHTML=""; statLines.innerHTML="";
  var s=statsCache[kind];
  if(kind==="cube2"||kind==="cube3"){
    if(!s){ statCap.textContent="counting every state…"; return; }
    var main=s.main, i;
    var logMax=Math.log10(Math.max.apply(null,main.hist)+1);
    for(i=0;i<main.hist.length;i++){
      var bar=document.createElement("div");
      bar.className="sb";
      bar.style.height=Math.max(2,(Math.log10(main.hist[i]+1)/logMax*100))+"%";
      bar.style.background=depthColor(i/main.maxd);
      bar.dataset.d=i;
      bar.title=i+" turns: "+main.hist[i].toLocaleString()+" states";
      statBars.appendChild(bar);
    }
    statCap.textContent= kind==="cube2"
      ? "all "+main.total.toLocaleString()+" positions, by exact distance from home (log scale)"
      : "all "+main.total.toLocaleString()+" phase-1 coordinates, by proven minimum turns to G1 (log scale)";
    var l1=document.createElement("p");
    l1.innerHTML= kind==="cube2"
      ? "a random scramble lands, on average, <b>"+main.mean.toFixed(3)+" turns</b> from home"
      : "a random state needs, on average, at least <b>"+main.mean.toFixed(3)+" turns</b> to reach G1"+
        " · inside G1: at least <b>"+s.core.mean.toFixed(2)+"</b> more";
    statLines.appendChild(l1);
    var l2=document.createElement("p");
    l2.id="statHere";
    statLines.appendChild(l2);
    renderStatsLive();
  } else {
    var c2=P.scrambleTwists.length*(P.twists[0].order-1);
    statCap.textContent="too many states to count — so count the words instead";
    var n=threadRadii?threadRadii[Math.min(playing?Math.max(0,playing.at+(anim?0:1)):threadRadii.length-1,threadRadii.length-1)]:simplifyWord(history).length;
    var digits=(n*Math.log10(c2));
    var lines=[
      "every turn picks one of <b>"+c2+"</b> possible moves",
      "a thread "+n+" turns long is one of ~<b>10<sup>"+digits.toFixed(1)+"</sup></b> possible move-words",
      "the puzzle itself has ~<b>10<sup>"+THREAD_DIGITS[kind]+"</sup></b> positions — "+
        (digits>=THREAD_DIGITS[kind] ? "the words now outnumber the states" :
         "at ~"+Math.ceil(THREAD_DIGITS[kind]/Math.log10(c2))+" turns the words outnumber the states")
    ];
    lines.forEach(function(t){
      var p=document.createElement("p"); p.innerHTML=t; statLines.appendChild(p);
    });
    var bar=document.createElement("div");
    bar.className="sb-growth";
    bar.innerHTML="<i style='width:"+Math.min(100,digits/THREAD_DIGITS[kind]*100)+"%'></i>";
    statBars.innerHTML=""; statBars.appendChild(bar);
  }
}

function renderStatsLive(){
  if(!statsOpen||!(kind==="cube2"||kind==="cube3")) return;
  var s=statsCache[kind];
  var here=document.getElementById("statHere");
  if(!s||!here) return;
  var info=null;
  if(walkSteps&&playing){
    var i=Math.max(0, playing.at+(anim?0:1));
    info=walkSteps[Math.min(i,walkSteps.length-1)];
  } else if(hereNow) info=hereNow;
  Array.prototype.forEach.call(statBars.children,function(b){ b.classList.remove("here"); });
  if(!info){ here.textContent=""; return; }
  var d=info.g?0:info.d;
  var cum=0, main=s.main;
  for(var k2=0;k2<d;k2++) cum+=main.hist[k2];
  var pct=100*cum/main.total;
  var bar=statBars.children[d];
  if(bar) bar.classList.add("here");
  if(kind==="cube2"){
    here.innerHTML= d===0 ? "you are <b>home</b> — the single state at distance zero"
      : "you are here: <b>"+d+" turns out</b> — deeper than <b>"+pct.toFixed(2)+"%</b> of all positions";
  } else {
    here.innerHTML= info.g
      ? (info.d2===0 ? "you are <b>home</b>"
         : "inside G1 — proven ≥ <b>"+info.d2+"</b> turns from home")
      : "you are here: proven ≥ <b>"+info.d+"</b> turns from G1 — deeper than <b>"+pct.toFixed(2)+"%</b> of coordinates";
  }
}

function requestLocate(){
  if(!statsOpen||!(kind==="cube2"||kind==="cube3")) return;
  var id=++locateId;
  getWorker().postMessage({cmd:"locate", kind:kind, id:id,
                           colors:Array.prototype.slice.call(colors)});
}

function updateReadout(){
  renderStatsLive();
  if(kind!=="cube2"&&kind!=="cube3"&&statsOpen&&playing) renderStats();
  if(!mapOpen) return;
  var i=playing ? Math.max(0, playing.at+(anim?0:1)) : 0;
  if(walkSteps){
    var s=walkSteps[Math.min(i,walkSteps.length-1)];
    if(kind==="cube2")
      mapLive.textContent="exactly "+s.d+" turn"+(s.d===1?"":"s")+" from home";
    else
      mapLive.textContent= s.g
        ? (s.d2===0 ? "home — the centre of everything"
                    : "inside G1 · proven ≥ "+s.d2+" turns to home")
        : "outside G1 · proven ≥ "+s.d+" turns to reach it";
  } else if(threadRadii){
    var r=threadRadii[Math.min(i,threadRadii.length-1)];
    mapLive.textContent="thread length: "+r+" turn"+(r===1?"":"s");
  } else if(!playing){
    mapLive.textContent="";
  }
}

function easeOutBack(t){
  var c1=0.9, c3=c1+1;
  return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2);
}
function easeOutQuad(t){ return 1-(1-t)*(1-t); }
function clamp01(f){ return function(t){ return t<0?0:t>1?1:f(t); }; }
var easeSnap=clamp01(easeOutBack), easeBlur=clamp01(easeOutQuad);
function ease(t){ return easeSnap(t); }

/* magician pacing: open deliberately, blur through the middle like a
   film wound forward, then land the last turns with weight */
function showmanSolveDur(i, total){
  var fromEnd=total-1-i;
  if(i===0) return 470;
  if(i===1) return 360;
  if(i===2) return 280;
  if(fromEnd===0) return 640;
  if(fromEnd===1) return 430;
  if(fromEnd===2) return 330;
  if(fromEnd===3) return 260;
  return Math.max(68, 250-28*(i-2));
}
function showmanScrambleDur(i, total){
  var fromEnd=total-1-i;
  if(i===0) return 400;
  if(i===1) return 300;
  if(fromEnd===0) return 280;
  if(fromEnd===1) return 210;
  return Math.max(60, 210-32*(i-1));
}

function pump(now){
  if(anim || queue.length===0) return;
  if(teach && !teach.auto && !teach.armed) return;  /* wait for "next" */
  if(teach) teach.armed=false;
  var next=queue.shift();
  var tw=P.twists[next.mv.t];
  var turns=next.mv.n>tw.order/2 ? next.mv.n-tw.order : next.mv.n; /* shortest arc */
  splitIndex(tw.members);
  var dur=REDUCED?80:next.dur;
  anim={ mv:next.mv, twist:tw, t0:now, dur:dur,
         easeFn: dur<140 ? easeBlur : easeSnap,
         target:turns*tw.step };
  if(playing){
    playing.at++;
    renderTicker();
    if(teach) showTeachMove(playing.names[playing.at],
                            playing.at+1, playing.names.length);
    updateReadout();
  }
}

function animTick(now){
  if(!anim) return;
  var t=(now-anim.t0)/anim.dur;
  if(t>=1){
    P.applyMove(colors, anim.mv);
    history.push(anim.mv);
    var wasSilent=anim.silent;
    if(teach && !wasSilent) lastTaught=anim.mv;
    anim=null;
    refreshColors();
    setIndexAll();
    updateReadout();
    if(wasSilent){
      /* a back-step: the program didn't advance — it retreated */
      if(playing){
        playing.at--;
        lastTaught = playing.at>=0 ? playing.moves[playing.at] : null;
        renderTicker();
        if(teach) showTeachMove(playing.names[playing.at+1],
                                playing.at+2, playing.names.length);
      }
      return;
    }
    if(queue.length===0){ onProgramDone(); }
    else if(teach && playing){
      /* point badge, arrow and camera at the turn now waiting */
      showTeachMove(playing.names[playing.at+1], playing.at+2, playing.names.length);
    }
  }
}

/* ---------- the teacher's voice ---------- */
var FACE_WORDS={U:"top",D:"bottom",R:"right",L:"left",F:"front",B:"back"};
function moveDesc(name){
  var mg=/^([A-L])(\+\+|\+|−−|−|--|-)$/.exec(name);
  if(mg){
    var amt5 = mg[2]==="+" ? "one fifth clockwise"
             : mg[2]==="++" ? "two fifths clockwise"
             : (mg[2]==="−−"||mg[2]==="--") ? "two fifths counter-clockwise"
             : "one fifth counter-clockwise";
    return "turn face "+mg[1]+" "+amt5;
  }
  var m=/^(\d*)([URFDLB])(2|')?$/.exec(name);
  if(!m) return "turn face "+name;
  var layer=m[1]?["","","second ","third "][+m[1]]+"layer from the ":"";
  var amt=m[3]==="2"?"a half turn":
          m[3]==="'"?"a quarter turn counter-clockwise":
          "a quarter turn clockwise";
  return "turn the "+layer+FACE_WORDS[m[2]].toUpperCase()+" face "+amt+
         (m[3]==="'"?" (that's what the ' mark means)":"");
}
function showTeachMove(name, at, total){
  teachBadge.hidden=false;
  teachBadge.innerHTML="<b>"+name+"</b><span>"+moveDesc(name)+
    "</span><i>turn "+at+" of "+total+"</i>";
  /* swing the camera so the face about to turn is in view */
  try{
    var tw=P.twists[P.namedMove(name).t];
    var n=P.n||3;
    var posEnd = tw.layer===undefined ? true : tw.layer>=n/2;
    var w=posEnd?tw.axis:[-tw.axis[0],-tw.axis[1],-tw.axis[2]];
    var yaw = Math.abs(w[1])>0.9 ? cam.yaw : Math.atan2(-w[0], w[2])+0.45;
    var pitch = w[1]*0.85 + 0.28;
    teachAim={yaw:yaw, pitch:Math.max(-1.15,Math.min(1.15,pitch))};
  }catch(e){ teachAim=null; }
}
function showTeachIntro(total){
  teachBadge.hidden=false;
  teachBadge.innerHTML="<b>ready</b><span>hold your cube exactly as you scanned it — "+
    "white on top, green facing you. press <em>next turn</em> and make each move "+
    "along with the screen.</span><i>"+total+" turns to home</i>";
}
btnTeachNext.addEventListener("click", function(){ if(teach) teach.armed=true; });
var btnTeachBack=document.getElementById("teachBack");
btnTeachBack.addEventListener("click", function(){
  /* walk the sequence backwards: animate the inverse of the last
     executed turn and hand that turn back to the queue */
  if(!teach||anim||!playing||playing.at<0) return;
  teach.auto=false; btnTeachAuto.textContent="auto: off";
  teach.armed=false;
  var mv=playing.moves[playing.at];
  var inv=P.invert(mv);
  var tw=P.twists[inv.t];
  var turns=inv.n>tw.order/2 ? inv.n-tw.order : inv.n;
  splitIndex(tw.members);
  queue.unshift({mv:mv, dur:680});
  anim={ mv:inv, twist:tw, t0:performance.now(), dur:REDUCED?80:480,
         easeFn:easeSnap, target:turns*tw.step, silent:true };
});
var btnTeachAgain=document.getElementById("teachAgain");
btnTeachAgain.addEventListener("click", function(){
  /* undo the last taught turn instantly, then offer it again slowly */
  if(!teach||anim||!playing||playing.at<0||lastTaught===null) return;
  P.applyMove(colors, P.invert(lastTaught));
  history.push(P.invert(lastTaught));
  refreshColors();
  queue.unshift({mv:lastTaught, dur:680});
  playing.at--;
  teach.armed=true;   /* replay immediately */
  renderTicker();
});
var lastTaught=null;
btnTeachAuto.addEventListener("click", function(){
  if(!teach) return;
  teach.auto=!teach.auto;
  btnTeachAuto.textContent="auto: "+(teach.auto?"on":"off");
});
btnTeachExit.addEventListener("click", function(){
  teach=null; teachBar.hidden=true; teachBadge.hidden=true; teachAim=null;
});

function onProgramDone(){
  var wasSolving=playing&&playing.solving;
  var wasTeach=playing&&playing.teach;
  var wasDoneLabel=playing&&playing.doneLabel;
  playing=null;
  if(wasTeach){
    teach=null; teachBar.hidden=true; teachAim=null;
    teachBadge.innerHTML="<b>solved</b><span>and now your real cube is home too. "+
      "scramble it and come back any time.</span><i>🎉</i>";
    setTimeout(function(){ teachBadge.hidden=true; }, 5200);
  }
  setBusy(false);
  if(P.isSolved(colors)){
    history=[];
    if(wasSolving){
      glow=1.9;
      canvas.classList.add("solved");
      setTimeout(function(){ canvas.classList.remove("solved"); }, 2400);
      var dt=((performance.now()-wasSolvingT0)/1000).toFixed(1);
      setStatus("solved — "+wasSolving.count+" turns, "+dt+" s · "+KINDS[kind].method);
    } else {
      setStatus("home again");
    }
  } else if(wasSolving){
    setStatus("stopped mid-thought — press solve to finish");
  } else if(wasDoneLabel){
    setStatus(wasDoneLabel);
  } else {
    setStatus("scrambled — "+history.length+" turns deep · press solve");
    overtureAfterScramble();
  }
  requestLocate();
  setTimeout(function(){ if(!playing) elTicker.classList.remove("show"); }, 1600);
}
var wasSolvingT0=0;

/* ---------- program helpers ---------- */
function enqueueProgram(moves, opts){
  var names=moves.map(function(m){ return P.moveName(m); });
  playing={ names:names, at:-1, teach:!!opts.teach,
            split:(opts.split!==undefined&&opts.split>=0)?opts.split:null,
            doneLabel:opts.doneLabel||null,
            solving:opts.solving?{count:moves.length}:null };
  if(opts.solving) wasSolvingT0=performance.now();
  if(opts.teach){
    teach={auto:false, armed:false};
    teachBar.hidden=false;
    btnTeachAuto.textContent="auto: off";
    showTeachIntro(moves.length);
  }
  playing.moves=moves;
  var total=moves.length;
  queue=moves.map(function(m,i){
    var dur;
    if(opts.teach){
      dur = 680;
    } else if(opts.solving){
      dur = showmanSolveDur(i,total);
    } else if(opts.showman){
      dur = showmanScrambleDur(i,total);
    } else {
      dur = 88;
    }
    return { mv:m, dur:dur };
  });
  renderTicker();
  elTicker.classList.add("show");
  setBusy(true);
  requestWalk(moves);
}

function simplifyWord(moves){
  var out=[];
  for(var i=0;i<moves.length;i++){
    var m=moves[i];
    if(out.length && out[out.length-1].t===m.t){
      var o=P.twists[m.t].order;
      var n=(out[out.length-1].n+m.n)%o;
      out.pop();
      if(n!==0) out.push({t:m.t,n:n});
    } else out.push({t:m.t,n:m.n});
  }
  return out;
}

/* ---------- ticker / status ---------- */
function renderTicker(){
  if(!playing){ elTicker.innerHTML=""; return; }
  var html="", from=Math.max(0, playing.at-4);
  var upto=Math.min(playing.names.length, playing.at+9);
  if(from>0) html+="<span class='dim'>…</span>";
  for(var i=from;i<upto;i++){
    var cls=(i===playing.at?"now":i<playing.at?"done":"");
    /* Kociemba's two phases, visible in the notation itself */
    if(playing.split!==null) cls+=(i<playing.split?" ph1":" ph2");
    html+="<span class='"+cls+"'>"+playing.names[i]+"</span>";
  }
  if(upto<playing.names.length) html+="<span class='dim'>…</span>";
  elTicker.innerHTML=html;
}
/* click the ticker to copy the whole move word */
elTicker.addEventListener("click", function(){
  if(!playing||!navigator.clipboard) return;
  navigator.clipboard.writeText(playing.names.join(" ")).then(function(){
    setStatus("move word copied — take it with you");
  });
});
function setStatus(t){ elStatus.textContent=t; }
function setBusy(b){
  btnScramble.disabled=b; btnSolve.disabled=b;
  btnStop.hidden=!b;
  pickers.forEach(function(p){ p.disabled=b; });
}

/* ---------- the solver in the back office ---------- */
var worker=null, solveId=0, pendingSolve=null, workerReady={};
var checkId=0, pendingChecks={};
function getWorker(){
  if(worker) return worker;
  worker=new Worker("worker.js?v=3");
  worker.onmessage=function(e){
    var d=e.data;
    if(d.type==="progress"){
      if(pendingSolve && pendingSolve.kind===d.kind)
        setStatus("preparing the mathematics — "+d.label+" ("+Math.round(d.pct*100)+"%)");
      else if(mapOpen && mapCloudKind!==kind && d.kind===kind)
        mapCap.textContent="charting the space — "+d.label+" ("+Math.round(d.pct*100)+"%)";
    } else if(d.type==="ready"){
      workerReady[d.kind]=true;
    } else if(d.type==="solution"){
      workerReady[d.kind]=true;
      if(pendingSolve && d.id===pendingSolve.id && d.kind===kind){
        var wasTeach=pendingSolve.teach;
        pendingSolve=null;
        var moves=d.moves.map(P.namedMove);
        var split=(kind==="cube3"&&d.split>=0)?d.split:undefined;
        setStatus(wasTeach
          ? "your cube's solution — "+moves.length+" turns, one at a time"
          : split!==undefined
            ? "Kociemba two-phase · "+split+" turns to G1 + "+(moves.length-split)+" inside"
            : KINDS[kind].method+" · "+moves.length+" turns");
        enqueueProgram(moves,{solving:true, teach:wasTeach, split:split});
      }
    } else if(d.type==="antipode"){
      if(d.kind===kind&&kind==="cube2"){
        var amoves=d.moves.map(P.namedMove);
        setStatus("walking to an antipode — "+amoves.length+" turns out");
        enqueueProgram(amoves,{solving:false,
          doneLabel:"an antipode — one of only 2,644 positions a proven maximum 11 turns from home"});
      }
    } else if(d.type==="map"){
      if(mapView && d.kind===kind){
        var list=[{pos:d.cloud.pos, dep:d.cloud.dep, n:d.cloud.n, maxd:d.cloud.maxd,
                   alpha:kind==="cube2"?0.22:0.28, ptScale:kind==="cube2"?34:44}];
        if(d.core) list.push({pos:d.core.pos, dep:d.core.dep, n:d.core.n,
                              maxd:d.core.maxd, alpha:0.5, ptScale:20, core:true});
        mapView.setClouds(list);
        mapCloudKind=d.kind;
        mapCap.textContent=MAP_CAPTIONS[d.kind]+" · "+d.cloud.n.toLocaleString()+" dots";
      }
    } else if(d.type==="walk"){
      if(mapView && d.id===walkReqId && d.kind===kind){
        walkSteps=d.steps;
        mapView.setWalk(d.steps.map(function(s){ return [s.x,s.y,s.z]; }));
        updateReadout();
      }
    } else if(d.type==="stats"){
      statsCache[d.kind]={main:d.main, core:d.core};
      if(d.kind===kind) renderStats();
    } else if(d.type==="locate"){
      if(d.id===locateId&&d.kind===kind){
        hereNow={d:d.d, g:d.g, d2:d.d2};
        renderStatsLive();
      }
    } else if(d.type==="check"){
      var cb=pendingChecks[d.id];
      delete pendingChecks[d.id];
      if(cb) cb(d.ok, d.reason);
    } else if(d.type==="error"){
      pendingSolve=null;
      setBusy(false);
      setStatus("the solver lost the plot: "+d.message);
    }
  };
  return worker;
}

/* ---------- actions ---------- */
function doScramble(showman){
  var moves=P.scramble(KINDS[kind].scramble);
  setStatus("scrambling…");
  enqueueProgram(moves,{solving:false, showman:!!showman});
}
function doSolve(){
  if(P.isSolved(colors)){ setStatus("already home — scramble it first"); return; }
  if(kind==="cube2"||kind==="cube3"){
    setBusy(true);
    setStatus("reading the stickers…");
    var id=++solveId;
    pendingSolve={id:id, kind:kind};
    getWorker().postMessage({cmd:"solve", kind:kind, id:id,
                             colors:Array.prototype.slice.call(colors)});
  } else {
    var thread=simplifyWord(P.invertWord(history));
    setStatus(KINDS[kind].method+" · "+thread.length+" turns");
    enqueueProgram(thread,{solving:true});
  }
}
btnScramble.addEventListener("click", function(){ overtureStage=2; doScramble(); });
btnSolve.addEventListener("click", function(){ overtureStage=2; doSolve(); });

/* ---------- the overture ----------
   Nobody should have to press a button to see the point. If the
   visitor touches nothing, the room clears its throat, scrambles,
   and unties itself — once. Any real interaction cancels it. */
var overtureStage = REDUCED ? 2 : 0;   /* 0 waiting · 1 mid-show · 2 done */
setTimeout(function(){
  if(overtureStage===0 && !playing && queue.length===0 && P.isSolved(colors)){
    overtureStage=1;
    doScramble(true);
    setStatus("watch — it scrambles itself, then unties the knot");
  } else overtureStage=2;
}, 1700);
function overtureAfterScramble(){
  if(overtureStage!==1) return;
  setTimeout(function(){
    if(overtureStage===1 && !playing && queue.length===0){
      overtureStage=2;
      doSolve();
    }
  }, 1100);
}

btnStop.addEventListener("click", function(){
  queue=[];
  if(playing){ playing.solving=null; playing.teach=false; }
  teach=null; teachBar.hidden=true; teachBadge.hidden=true; teachAim=null;
});

btnMap.addEventListener("click", function(){
  if(!ensureMap()) return;
  mapOpen=!mapOpen;
  document.body.classList.toggle("map-on", mapOpen);
  btnMap.textContent=mapOpen?"roll up the map ✦":"the map ✦";
  if(mapOpen){ requestCloud(); updateReadout(); }
});

btnStats.addEventListener("click", function(){
  statsOpen=!statsOpen;
  statsCard.hidden=!statsOpen;
  document.body.classList.toggle("stats-on", statsOpen);
  btnStats.textContent=statsOpen?"fold the numbers ✦":"the numbers ✦";
  if(statsOpen){
    if((kind==="cube2"||kind==="cube3")&&!statsCache[kind])
      getWorker().postMessage({cmd:"stats", kind:kind});
    renderStats();
    requestLocate();
  }
});

/* famous specimens: positions worth meeting by name */
var SUPERFLIP="U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2";
btnSpecimen.addEventListener("click", function(){
  overtureStage=2;
  if(kind==="cube2"){
    setBusy(true);
    setStatus("finding a farthest place…");
    getWorker().postMessage({cmd:"antipode", kind:"cube2", id:++solveId,
      seed:(Date.now()%2147483000)+1,
      colors:Array.prototype.slice.call(colors)});
  } else if(kind==="cube3"){
    if(!P.isSolved(colors)){ setStatus("solve it first — the superflip is measured from home"); return; }
    var moves=SUPERFLIP.split(" ").map(P.namedMove);
    setStatus("applying the superflip…");
    enqueueProgram(moves,{solving:false,
      doneLabel:"the superflip — every edge flipped in place; the first position proven to need all 20 turns"});
  }
});

pickers.forEach(function(btn){
  btn.addEventListener("click", function(){ setKind(btn.dataset.kind); });
});

function setKind(k){
  if(kind!==null) overtureStage=2;   /* a choice was made; no need to perform */
  kind=k;
  P=PuzzleEngine.build(k==="mega"?"mega":k);
  pal=KINDS[k].pal.map(hex2rgb);
  colors=P.newColors();
  history=[]; queue=[]; anim=null; playing=null; pendingSolve=null; glow=0;
  teach=null; teachBar.hidden=true; teachBadge.hidden=true; teachAim=null;
  walkSteps=null; threadRadii=null; hereNow=null;
  if(mapView) mapView.setWalk(null);
  btnScan.hidden = k!=="cube3";
  btnSpecimen.hidden = !(k==="cube2"||k==="cube3");
  btnSpecimen.textContent = k==="cube2" ? "the antipode ✦" : "the superflip ✦";
  if(statsOpen){
    if((k==="cube2"||k==="cube3")&&!statsCache[k])
      getWorker().postMessage({cmd:"stats", kind:k});
    renderStats();
    requestLocate();
  }
  buildGeometry();
  pickers.forEach(function(p){ p.classList.toggle("on", p.dataset.kind===k); });
  elFact.textContent=KINDS[k].fact;
  if(mapOpen){ requestCloud(); mapLive.textContent=""; }
  setStatus(k==="mega"
    ? "the shape from the photographs — drag it, fling it, scramble it"
    : "drag to turn it · fling it and it keeps going");
  setBusy(false);
  elTicker.classList.remove("show");
  /* warm the solver while nobody's looking */
  if(k==="cube2"||k==="cube3") getWorker().postMessage({cmd:"prep", kind:k});
}

/* ---------- render loop ---------- */
function resize(){
  var dpr=Math.min(2, window.devicePixelRatio||1);
  var w=canvas.clientWidth*dpr, h=canvas.clientHeight*dpr;
  if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; }
  gl.viewport(0,0,w,h);
  /* on tall screens, step back so the puzzle fits the narrow side */
  var aspect=w/h;
  cam.fit=Math.min(1.9, Math.max(1, 0.92/aspect));
}

/* the camera's position in the world, recovered from a view matrix */
function eyeFromView(V){
  return [
    -(V[0]*V[12]+V[1]*V[13]+V[2]*V[14]),
    -(V[4]*V[12]+V[5]*V[13]+V[6]*V[14]),
    -(V[8]*V[12]+V[9]*V[13]+V[10]*V[14])
  ];
}

/* draw the puzzle with any camera and any world placement — the flat
   screen, the gyro window, and WebXR all come through here */
function renderScene(proj, view, world, now){
  gl.uniformMatrix4fv(loc.uProj,false,proj);
  gl.uniformMatrix4fv(loc.uView,false,view);
  gl.uniform1f(loc.uGlow, Math.min(1,glow));
  gl.uniform3fv(loc.uEye, eyeFromView(view));

  [[bufPos,loc.aPos,3],[bufNrm,loc.aNrm,3],[bufCol,loc.aCol,3],[bufTop,loc.aTop,1]]
  .forEach(function(b){
    gl.bindBuffer(gl.ARRAY_BUFFER,b[0]);
    gl.enableVertexAttribArray(b[1]);
    gl.vertexAttribPointer(b[1],b[2],gl.FLOAT,false,0,0);
  });

  gl.uniformMatrix4fv(loc.uModel,false,world);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxStatic);
  gl.drawElements(gl.TRIANGLES, staticCount, gl.UNSIGNED_SHORT, 0);

  if(anim && movingCount>0){
    var t=(now-anim.t0)/anim.dur;
    var a=anim.target*anim.easeFn(t);
    gl.uniformMatrix4fv(loc.uModel,false,mMul(world, mAxisAngle(anim.twist.axis,a)));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxMoving);
    gl.drawElements(gl.TRIANGLES, movingCount, gl.UNSIGNED_SHORT, 0);
  }

  /* the teacher's arrow: shown while a taught turn waits, and riding
     the layer while it plays */
  if(teach && playing){
    var mvA = anim ? anim.mv : (queue[0] && queue[0].mv);
    if(mvA){
      if(mvA!==arrowFor) buildArrow(mvA);
      var am = (anim && anim.mv===mvA)
        ? mAxisAngle(anim.twist.axis, anim.target*anim.easeFn((now-anim.t0)/anim.dur))
        : mIdentity();
      drawArrow(mMul(world, am), now);
    } else arrowFor=null;
  } else arrowFor=null;
}

/* while it lives in your room it behaves like an ornament that
   thinks: scramble, solve, breathe, repeat */
var arIdleAt=0;
function arAmbient(now){
  if(teach){ arIdleAt=now; return; }
  if(playing||queue.length||anim||pendingSolve){ arIdleAt=now; return; }
  if(now-arIdleAt<2800) return;
  arIdleAt=now;
  if(P.isSolved(colors)) doScramble(true);
  else doSolve();
}

var lastFrame=performance.now();
function frame(now){
  requestAnimationFrame(frame);
  var dt=Math.min(0.05,(now-lastFrame)/1000);
  lastFrame=now;
  var arMode=AR?AR.mode():null;
  camTick(dt);
  pump(now);
  animTick(now);
  if(glow>0) glow=Math.max(0, glow-dt*1.1);
  if(arMode) arAmbient(now);

  if(mapOpen&&mapView){
    if(playing&&playing.at>=0){
      var mt=anim?Math.max(0,Math.min(1,(now-anim.t0)/anim.dur)):1;
      mapView.setProgress(playing.at, mt);
    }
    mapView.frame(dt, true);
  }

  if(arMode==="xr") return;      /* the XR loop draws for itself */

  resize();
  gl.clearColor(0,0,0,0);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

  if(arMode==="window"){
    var camA=AR.windowCamera(canvas.width/canvas.height);
    if(camA) renderScene(camA.proj, camA.view, camA.world, now);
    return;
  }

  var aspect=canvas.width/canvas.height;
  var proj=mPersp(0.62, aspect, 0.1, 60);
  var view=mMul(mTranslate(0,0,-cam.dist), mMul(mRotX(cam.pitch), mRotY(cam.yaw)));
  renderScene(proj, view, mIdentity(), now);
}

/* ---------- the score: write a sequence, the room performs it ---------- */
var btnScore=document.getElementById("btnScore");
var scorePanel=document.getElementById("score");
var scoreInput=document.getElementById("scoreInput");
var scoreTokens=document.getElementById("scoreTokens");
var scorePerform=document.getElementById("scorePerform");
var scoreStep=document.getElementById("scoreStep");
var scorePatterns=document.getElementById("scorePatterns");
var scoreClose=document.getElementById("scoreClose");
var scoreMoves=[];

var PATTERNS3=[
  {name:"checkerboard", word:"U2 D2 F2 B2 L2 R2"},
  {name:"cube in a cube", word:"F L F U' R U F2 L2 U' L' B D' B' L2 U"},
  {name:"six spots", word:"U D' R L' F B' U D'"},
  {name:"the superflip", word:"U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"}
];

function scoreParse(){
  var raw=scoreInput.value.trim();
  var tokens=raw?raw.split(/\s+/):[];
  scoreMoves=[];
  var ok=tokens.length>0, html="";
  tokens.forEach(function(tk){
    var good=true;
    try{ scoreMoves.push(P.namedMove(tk)); }
    catch(e){ good=false; ok=false; }
    html+="<span class='"+(good?"ok":"bad")+"'>"+tk.replace(/</g,"&lt;")+"</span>";
  });
  scoreTokens.innerHTML=html || "<span class='dim'>the notation appears here as you type</span>";
  scorePerform.disabled=!ok;
  scoreStep.disabled=!ok;
}
scoreInput.addEventListener("input", scoreParse);

function openScore(){
  overtureStage=2;
  scorePanel.hidden=false;
  requestAnimationFrame(function(){ scorePanel.classList.add("show"); });
  /* pattern chips only where they mean something */
  scorePatterns.innerHTML="";
  if(kind==="cube3"){
    PATTERNS3.forEach(function(p){
      var b=document.createElement("button");
      b.textContent=p.name;
      b.addEventListener("click", function(){
        scoreInput.value=p.word;
        scoreParse();
      });
      scorePatterns.appendChild(b);
    });
  }
  document.getElementById("scoreHint").textContent =
    kind==="mega" ? "megaminx notation: faces A–L with +, ++, − or −− (fifths of a turn)"
    : (kind==="cube4"||kind==="cube5") ? "notation: U R F D L B, with ' and 2 — and 2R, 3L for inner layers"
    : "notation: U R F D L B · ' means counter-clockwise · 2 means a half turn";
  scoreParse();
  scoreInput.focus();
}
function closeScore(){
  scorePanel.classList.remove("show");
  setTimeout(function(){ scorePanel.hidden=true; }, 300);
}
btnScore.addEventListener("click", openScore);
scoreClose.addEventListener("click", closeScore);
scorePerform.addEventListener("click", function(){
  if(!scoreMoves.length) return;
  closeScore();
  setStatus("your sequence — performed");
  enqueueProgram(scoreMoves.slice(),{solving:false, showman:true,
    doneLabel:"your sequence, performed — "+scoreMoves.length+" turns · press solve to watch it untied"});
});
scoreStep.addEventListener("click", function(){
  if(!scoreMoves.length) return;
  closeScore();
  setStatus("your sequence — one turn at a time, forwards and back");
  enqueueProgram(scoreMoves.slice(),{solving:false, teach:true,
    doneLabel:"your sequence, complete — "+scoreMoves.length+" turns"});
});

/* ---------- ?ar=1 — arrive with the door already ajar ---------- */
var arPrompt=document.getElementById("arPrompt");
if(/[?&]ar=1/.test(location.search)){
  overtureStage=2;
  arPrompt.hidden=false;
}
document.getElementById("arPromptGo").addEventListener("click", function(){
  arPrompt.hidden=true;
  if(AR) AR.enter();
});
document.getElementById("arPromptNo").addEventListener("click", function(){
  arPrompt.hidden=true;
});

/* ---------- maths panel ---------- */
var mathsBtn=document.getElementById("btnMaths");
var mathsPanel=document.getElementById("maths");
function setMaths(open){
  mathsPanel.classList.toggle("show", open);
  mathsBtn.textContent=open?"back to the puzzle ×":"the mathematics ✦";
}
mathsBtn.addEventListener("click", function(){
  setMaths(!mathsPanel.classList.contains("show"));
});
document.getElementById("mathsClose").addEventListener("click", function(){
  setMaths(false);
});

/* Escape closes whichever overlay is open — no one gets trapped */
window.addEventListener("keydown", function(e){
  if(e.key!=="Escape") return;
  if(mathsPanel.classList.contains("show")){ setMaths(false); return; }
  if(!scorePanel.hidden){ closeScore(); return; }
  var scanP=document.getElementById("scan");
  if(scanP&&!scanP.hidden){
    var c=document.getElementById("scanClose");
    if(c) c.click();
    return;
  }
  if(!arPrompt.hidden){ arPrompt.hidden=true; }
});

/* ---------- put it in your room ---------- */
var btnRoom=document.getElementById("btnRoom");
var AR=null;
if(window.RoomAR){
  AR=RoomAR({
    gl:gl, canvas:canvas, renderScene:renderScene,
    onStatus:setStatus,
    onEnter:function(m){
      overtureStage=2;
      if(mapOpen){ btnMap.click(); }
      if(statsOpen){ btnStats.click(); }
      document.body.classList.add("ar");
      btnRoom.textContent="back to the flat screen ×";
      arIdleAt=performance.now();
      elFact.textContent = m==="xr"
        ? "true augmented reality — walk around it while it thinks"
        : "the window — a gyroscope and a camera, honestly; Safari keeps real AR to itself";
    },
    onExit:function(){
      document.body.classList.remove("ar");
      btnRoom.textContent="put it in your room ✦";
      elFact.textContent=KINDS[kind].fact;
      setStatus("back on the desk");
    }
  });
}
btnRoom.addEventListener("click", function(){
  if(!AR){ setStatus("the doorway is missing — ar.js didn't load"); return; }
  if(AR.mode()) AR.exit(); else AR.enter();
});

/* ---------- the scanner's doorway into the room ---------- */
window.RoomAPI={
  getKind:function(){ return kind; },
  palette:CUBE_PAL,
  ensureCube3:function(){ if(kind!=="cube3") setKind("cube3"); },
  check:function(cols, cb){
    var id=++checkId;
    pendingChecks[id]=cb;
    getWorker().postMessage({cmd:"check", kind:"cube3", id:id,
                             colors:Array.prototype.slice.call(cols)});
  },
  applyScan:function(cols){
    if(kind!=="cube3") setKind("cube3");
    colors.set(cols);
    history=[];
    refreshColors();
    setStatus("your cube, read from the stickers — press solve, or let it teach you");
  },
  teachSolve:function(){
    overtureStage=2;
    if(kind!=="cube3") return;
    if(P.isSolved(colors)){ setStatus("this cube is already home"); return; }
    setBusy(true);
    setStatus("reading the stickers…");
    var id=++solveId;
    pendingSolve={id:id, kind:kind, teach:true};
    getWorker().postMessage({cmd:"solve", kind:kind, id:id,
                             colors:Array.prototype.slice.call(colors)});
  }
};

if(/[?&]og=1/.test(location.search)) document.body.classList.add("og");
setKind("mega");
requestAnimationFrame(frame);
})();
