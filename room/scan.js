/* scan.js — read a real cube through the camera, then teach its solve.
   Pure getUserMedia + pixel arithmetic: no ML models, no libraries.
   Every frame stays on the device; nothing is uploaded anywhere.

   Protocol: six captures, each fully determined by "which centre faces
   the camera, which centre is up" — a rigid cube has no other freedom.
   The centre stickers of the six captures become the six reference
   colours, and every other sticker is classified to its nearest
   reference in chromaticity space. The user can correct any misread
   swatch by tapping it, and the worker checks the laws of the cube
   (corner twist, edge flip, permutation parity) before teaching. */
/* global PuzzleEngine, RoomAPI */
(function(root){
"use strict";

/* ---------- the screen-order mapping, derived from geometry ---------- */
function buildScreenMap(){
  var P=PuzzleEngine.build("cube3");
  var F=P.faceOf;
  function nrm(f){ return {U:[0,1,0],D:[0,-1,0],R:[1,0,0],L:[-1,0,0],F:[0,0,1],B:[0,0,-1]}[f]; }
  var views=[   /* capture order: centre facing camera, centre up */
    {face:"F", up:"U", say:"the GREEN centre facing the camera, WHITE centre up"},
    {face:"R", up:"U", say:"the RED centre facing the camera, WHITE centre up"},
    {face:"B", up:"U", say:"the BLUE centre facing the camera, WHITE centre up"},
    {face:"L", up:"U", say:"the ORANGE centre facing the camera, WHITE centre up"},
    {face:"U", up:"B", say:"the WHITE centre facing the camera, BLUE centre up"},
    {face:"D", up:"F", say:"the YELLOW centre facing the camera, GREEN centre up"}
  ];
  function cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
  views.forEach(function(v){
    var n=nrm(v.face), up=nrm(v.up), right=cross(up,n);
    var fid=F[v.face];
    var list=[];
    P.stickers.forEach(function(s,i){ if(s.face===fid) list.push({i:i, c:s.center}); });
    /* screen order: rows top→bottom, columns left→right, camera outside */
    list.sort(function(a,b){
      var ra=Math.round(dot(a.c,up)*4), rb=Math.round(dot(b.c,up)*4);
      if(ra!==rb) return rb-ra;
      return Math.round(dot(a.c,right)*4)-Math.round(dot(b.c,right)*4);
    });
    v.stickers=list.map(function(x){ return x.i; });
    v.faceId=fid;
  });
  return { views:views, faceOf:F };
}

/* ---------- colour classification ---------- */
function feat(rgb){
  var s=rgb[0]+rgb[1]+rgb[2]+1e-3;
  return [rgb[0]/s, rgb[1]/s, rgb[2]/s, s/765*0.5];
}
function fdist(a,b){
  var d=0;
  for(var i=0;i<4;i++){ var x=a[i]-b[i]; d+=x*x*(i===3?0.35:1); }
  return d;
}
/* refs: array of 6 rgb (the captured centres, in capture order);
   returns for each sample the index of the nearest reference */
function classify(samples, refs){
  var rf=refs.map(feat);
  return samples.map(function(s){
    var f=feat(s), best=0, bd=Infinity;
    for(var i=0;i<6;i++){
      var d=fdist(f,rf[i]);
      if(d<bd){ bd=d; best=i; }
    }
    return best;
  });
}

/* node export for tests */
if(typeof module!=="undefined"&&module.exports){
  module.exports={ buildScreenMap:buildScreenMap, classify:classify, feat:feat };
  return;
}

/* ---------- the scanning booth (browser only) ---------- */
var MAP=null;
var panel=document.getElementById("scan");
var scanStage=document.getElementById("scanStage");
var btnOpen=document.getElementById("btnScan");
if(!panel||!btnOpen) return;

var state={ mode:"intro", captureAt:0, grids:[], refs:[], net:null, stream:null };
var video=null, sampleCanvas=null;

function el(tag, cls, html){
  var e=document.createElement(tag);
  if(cls) e.className=cls;
  if(html!==undefined) e.innerHTML=html;
  return e;
}

function stopCamera(){
  if(state.stream){
    state.stream.getTracks().forEach(function(t){ t.stop(); });
    state.stream=null;
  }
}

function close(){
  stopCamera();
  panel.classList.remove("show");
  setTimeout(function(){ panel.hidden=true; }, 350);
}

function open(){
  if(!MAP) MAP=buildScreenMap();
  RoomAPI.ensureCube3();
  panel.hidden=false;
  requestAnimationFrame(function(){ panel.classList.add("show"); });
  showIntro();
}
btnOpen.addEventListener("click", open);
document.getElementById("scanClose").addEventListener("click", close);

function showIntro(){
  state.mode="intro";
  scanStage.innerHTML="";
  scanStage.appendChild(el("p","s-text",
    "Hold up a real 3×3 with the standard colours — white opposite yellow, "+
    "red opposite orange, green opposite blue. The camera reads each face in "+
    "six short poses; every frame stays on this device. Then the room solves "+
    "<i>your</i> cube and teaches the turns one at a time."));
  var row=el("div","s-row");
  var b1=el("button","s-btn","use the camera");
  var b2=el("button","s-btn s-quiet","enter the colours by hand");
  b1.addEventListener("click", startCamera);
  b2.addEventListener("click", function(){ startManual(); });
  row.appendChild(b1); row.appendChild(b2);
  scanStage.appendChild(row);
}

function startCamera(){
  state.mode="camera"; state.captureAt=0; state.grids=[]; state.refs=[];
  scanStage.innerHTML="";
  var wrap=el("div","s-camwrap");
  video=document.createElement("video");
  video.autoplay=true; video.playsInline=true; video.muted=true;
  var overlay=el("div","s-grid");
  for(var i=0;i<9;i++) overlay.appendChild(el("span"));
  wrap.appendChild(video); wrap.appendChild(overlay);
  scanStage.appendChild(wrap);
  var say=el("p","s-text s-say","");
  scanStage.appendChild(say);
  var row=el("div","s-row");
  var cap=el("button","s-btn","capture face 1 of 6");
  var redo=el("button","s-btn s-quiet","redo previous");
  redo.disabled=true;
  row.appendChild(cap); row.appendChild(redo);
  scanStage.appendChild(row);
  sampleCanvas=document.createElement("canvas");

  function instruct(){
    var v=MAP.views[state.captureAt];
    say.innerHTML="face "+(state.captureAt+1)+" of 6 — hold it with "+v.say+
      ", filling the square.";
    cap.textContent="capture face "+(state.captureAt+1)+" of 6";
    redo.disabled=state.captureAt===0;
  }

  navigator.mediaDevices.getUserMedia({video:{facingMode:"environment", width:{ideal:960}}})
  .then(function(stream){
    state.stream=stream;
    video.srcObject=stream;
    instruct();
  })
  .catch(function(){
    scanStage.innerHTML="";
    scanStage.appendChild(el("p","s-text",
      "The camera said no — that's fine. You can paint the colours in by hand instead."));
    var r2=el("div","s-row");
    var b=el("button","s-btn","enter the colours by hand");
    b.addEventListener("click", function(){ startManual(); });
    r2.appendChild(b); scanStage.appendChild(r2);
  });

  cap.addEventListener("click", function(){
    if(!video.videoWidth) return;
    var W=video.videoWidth, H=video.videoHeight;
    sampleCanvas.width=W; sampleCanvas.height=H;
    var ctx=sampleCanvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(video,0,0);
    /* the guide square is centred, 62% of the smaller side */
    var S=Math.min(W,H)*0.62, x0=(W-S)/2, y0=(H-S)/2;
    var grid=[];
    for(var r=0;r<3;r++) for(var c=0;c<3;c++){
      var cx=x0+S*(c+0.5)/3, cy=y0+S*(r+0.5)/3;
      var d=ctx.getImageData(cx-7,cy-7,14,14).data;
      var rr=0,gg=0,bb=0,n=d.length/4;
      for(var k=0;k<d.length;k+=4){ rr+=d[k]; gg+=d[k+1]; bb+=d[k+2]; }
      grid.push([rr/n,gg/n,bb/n]);
    }
    state.grids.push(grid);
    state.refs.push(grid[4]);          /* the centre sticker is the reference */
    state.captureAt++;
    if(state.captureAt>=6){ finishCapture(); }
    else instruct();
  });
  redo.addEventListener("click", function(){
    if(state.captureAt>0){
      state.captureAt--; state.grids.pop(); state.refs.pop(); instruct();
    }
  });
}

function finishCapture(){
  stopCamera();
  /* classify all 54 samples against the six captured centres */
  var net=[];
  for(var f=0;f<6;f++){
    var ids=classify(state.grids[f], state.refs);
    net.push(ids);
  }
  startReview(net, "check the reading — tap any square that looks wrong.");
}

function startManual(){
  var net=[];
  for(var f=0;f<6;f++){
    var row=[];
    for(var i=0;i<9;i++) row.push(f);
    net.push(row);
  }
  startReview(net, "paint your cube: tap squares to cycle their colours. "+
    "centres are fixed — they name the faces.");
}

/* net[captureIdx][cell 0..8] = capture index of the classified colour.
   capture order is F,R,B,L,U,D — so "capture index" doubles as a colour
   name: 0 green, 1 red, 2 blue, 3 orange, 4 white, 5 yellow. */
var CAP_COLORS=["#3fc472","#ff5d5d","#5aa2ff","#ff8a5c","#f2ead9","#f5b63f"];
var CAP_NAMES=["green","red","blue","orange","white","yellow"];

function startReview(net, blurb){
  state.mode="review"; state.net=net;
  scanStage.innerHTML="";
  scanStage.appendChild(el("p","s-text",blurb));
  var verdict=el("p","s-verdict","");
  var netEl=el("div","s-net");
  /* cross layout:      [U]
                    [L][F][R][B]
                        [D]      — capture idx: U=4 L=3 F=0 R=1 B=2 D=5 */
  var layout=[[null,4,null,null],[3,0,1,2],[null,5,null,null]];
  layout.forEach(function(rowFaces){
    var rowEl=el("div","s-netrow");
    rowFaces.forEach(function(fi){
      var cell=el("div","s-face"+(fi===null?" s-hole":""));
      if(fi!==null){
        for(var i=0;i<9;i++)(function(i){
          var sw=el("button","s-sw");
          sw.style.background=CAP_COLORS[net[fi][i]];
          sw.setAttribute("aria-label",CAP_NAMES[net[fi][i]]);
          if(i===4){ sw.disabled=true; sw.classList.add("s-center"); }
          else sw.addEventListener("click",function(){
            net[fi][i]=(net[fi][i]+1)%6;
            sw.style.background=CAP_COLORS[net[fi][i]];
            sw.setAttribute("aria-label",CAP_NAMES[net[fi][i]]);
            validate();
          });
          cell.appendChild(sw);
        })(i);
      }
      rowEl.appendChild(cell);
    });
    netEl.appendChild(rowEl);
  });
  scanStage.appendChild(netEl);
  var row=el("div","s-row");
  var teachB=el("button","s-btn","teach me the solve");
  var solveB=el("button","s-btn s-quiet","just watch it solve");
  var backB=el("button","s-btn s-quiet","start over");
  teachB.disabled=true; solveB.disabled=true;
  row.appendChild(teachB); row.appendChild(solveB); row.appendChild(backB);
  scanStage.appendChild(row);
  scanStage.appendChild(verdict);

  function toColors54(){
    /* engine colours: sticker index → face id */
    var out=new Array(54);
    for(var f=0;f<6;f++){
      var view=MAP.views[f];
      for(var i=0;i<9;i++){
        var capIdx=net[f][i];
        out[view.stickers[i]]=MAP.views[capIdx].faceId;
      }
    }
    return out;
  }
  var lastOk=false;
  function validate(){
    /* counts first — cheap and catches most misreads */
    var counts=[0,0,0,0,0,0];
    for(var f=0;f<6;f++) for(var i=0;i<9;i++) counts[net[f][i]]++;
    for(var c2=0;c2<6;c2++) if(counts[c2]!==9){
      verdict.textContent="I count "+counts[c2]+" "+CAP_NAMES[c2]+
        " stickers — a real cube has exactly 9. tap the misread squares.";
      teachB.disabled=true; solveB.disabled=true; lastOk=false;
      return;
    }
    verdict.textContent="checking against the laws of the cube…";
    var cols=toColors54();
    RoomAPI.check(cols, function(ok, reason){
      if(state.mode!=="review") return;
      lastOk=ok;
      teachB.disabled=!ok; solveB.disabled=!ok;
      verdict.textContent= ok
        ? "that's a possible cube — "+(isHome(cols)?"and it's already solved!":"ready when you are.")
        : "something's off: "+reason;
    });
  }
  function isHome(cols){
    for(var i=0;i<54;i++) if(cols[i]!==MAP.homeOf(i)) return false;
    return true;
  }
  MAP.homeOf=MAP.homeOf||function(i){
    var P=PuzzleEngine.build("cube3");
    var arr=P.newColors();
    MAP.homeOf=function(j){ return arr[j]; };
    return arr[i];
  };
  teachB.addEventListener("click",function(){
    if(!lastOk) return;
    RoomAPI.applyScan(toColors54());
    close();
    RoomAPI.teachSolve();
  });
  solveB.addEventListener("click",function(){
    if(!lastOk) return;
    RoomAPI.applyScan(toColors54());
    close();
    document.getElementById("btnSolve").click();
  });
  backB.addEventListener("click", showIntro);
  validate();
}

})(typeof self!=="undefined"?self:this);
