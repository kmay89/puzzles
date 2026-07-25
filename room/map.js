/* map.js — the map of everywhere the puzzle can be.
   A second little WebGL universe: every dot is a real state (or a real
   solver coordinate), placed on a shell whose radius is its PROVEN
   distance from home. The walk — scramble out, solve back — is drawn
   as a thread through the constellation, synced to the cube's turns.
   No libraries here either. */
(function(root){
"use strict";

function MapView(canvas){
  var gl=canvas.getContext("webgl",{antialias:false, alpha:true, premultipliedAlpha:true});
  if(!gl) return null;

  function sh(type,src){
    var s=gl.createShader(type);
    gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function prog(vs,fs){
    var p=gl.createProgram();
    gl.attachShader(p,sh(gl.VERTEX_SHADER,vs));
    gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  /* stars: one vertex per state */
  var starProg=prog([
    "attribute vec3 aPos; attribute float aDep;",
    "uniform mat4 uPV; uniform float uMaxD, uPtScale;",
    "varying float vD;",
    "void main(){",
    "  gl_Position=uPV*vec4(aPos,1.0);",
    "  float sz=uPtScale*(1.6-0.8*aDep/max(uMaxD,1.0));",
    "  gl_PointSize=max(1.0, sz/max(gl_Position.w,0.2));",
    "  vD=aDep/max(uMaxD,1.0);",
    "}"].join("\n"),[
    "precision mediump float; varying float vD; uniform float uAlpha;",
    "void main(){",
    "  vec2 q=gl_PointCoord-0.5; float r2=dot(q,q); if(r2>0.25) discard;",
    /* home-green through parchment to lamp to ember */
    "  vec3 cNear=vec3(0.39,0.90,0.66), cMid=vec3(0.73,0.66,0.56);",
    "  vec3 cFar=vec3(1.0,0.79,0.48), cEnd=vec3(1.0,0.42,0.36);",
    "  vec3 c = vD<0.35 ? mix(cNear,cMid,vD/0.35)",
    "         : vD<0.7  ? mix(cMid,cFar,(vD-0.35)/0.35)",
    "         : mix(cFar,cEnd,(vD-0.7)/0.3);",
    "  float fade=1.0-r2*4.0;",
    "  gl_FragColor=vec4(c,1.0)*uAlpha*fade;",
    "}"].join("\n"));
  var sLoc={ aPos:gl.getAttribLocation(starProg,"aPos"),
             aDep:gl.getAttribLocation(starProg,"aDep"),
             uPV:gl.getUniformLocation(starProg,"uPV"),
             uMaxD:gl.getUniformLocation(starProg,"uMaxD"),
             uPtScale:gl.getUniformLocation(starProg,"uPtScale"),
             uAlpha:gl.getUniformLocation(starProg,"uAlpha") };

  /* thread + comet */
  var lineProg=prog([
    "attribute vec3 aPos; attribute float aT;",
    "uniform mat4 uPV; varying float vT;",
    "void main(){ gl_Position=uPV*vec4(aPos,1.0); vT=aT; }"].join("\n"),[
    "precision mediump float; varying float vT;",
    "uniform vec3 uCol; uniform float uHead, uAlpha;",
    "void main(){",
    "  float w = clamp(1.0-abs(uHead-vT)*2.2, 0.0, 1.0);",
    "  float base = vT<=uHead ? 0.55 : 0.0;",
    "  gl_FragColor=vec4(uCol,1.0)*uAlpha*(base+w);",
    "}"].join("\n"));
  var lLoc={ aPos:gl.getAttribLocation(lineProg,"aPos"),
             aT:gl.getAttribLocation(lineProg,"aT"),
             uPV:gl.getUniformLocation(lineProg,"uPV"),
             uCol:gl.getUniformLocation(lineProg,"uCol"),
             uHead:gl.getUniformLocation(lineProg,"uHead"),
             uAlpha:gl.getUniformLocation(lineProg,"uAlpha") };

  var cometProg=prog([
    "attribute vec2 aCorner;",
    "uniform mat4 uPV; uniform vec3 uPos; uniform float uSize;",
    "varying vec2 vQ;",
    "void main(){",
    "  vec4 c=uPV*vec4(uPos,1.0);",
    "  gl_Position=c+vec4(aCorner*uSize*c.w*0.06,0.0,0.0);",
    "  vQ=aCorner;",
    "}"].join("\n"),[
    "precision mediump float; varying vec2 vQ; uniform vec3 uCol;",
    "void main(){",
    "  float r=length(vQ); if(r>1.0) discard;",
    "  float a=pow(1.0-r,2.0);",
    "  gl_FragColor=vec4(uCol+vec3(0.4)*a,1.0)*a*1.4;",
    "}"].join("\n"));
  var cLoc={ aCorner:gl.getAttribLocation(cometProg,"aCorner"),
             uPV:gl.getUniformLocation(cometProg,"uPV"),
             uPos:gl.getUniformLocation(cometProg,"uPos"),
             uSize:gl.getUniformLocation(cometProg,"uSize"),
             uCol:gl.getUniformLocation(cometProg,"uCol") };
  var quadBuf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1, 1,-1, -1,1, 1,1]),gl.STATIC_DRAW);

  /* state */
  var clouds=[];         /* [{posBuf, depBuf, n, maxd, alpha, ptScale}] */
  var walk=null;         /* {posBuf, tBuf, n, pts:[[x,y,z]...], mode} */
  var prevWalk=null;
  var maxR=11, spin=0, tilt=0.35, userYaw=0, vYaw=0;
  var head=0;            /* fractional index into walk pts */
  var dragging=false, lastX=0, lastT=0;

  function m4mul(a,b){
    var o=new Array(16),r,c,k,s;
    for(c=0;c<4;c++)for(r=0;r<4;r++){s=0;for(k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}
    return o;
  }
  function persp(f,aspect,n,fr){
    var t=1/Math.tan(f/2),nf=1/(n-fr);
    return [t/aspect,0,0,0, 0,t,0,0, 0,0,(fr+n)*nf,-1, 0,0,2*fr*n*nf,0];
  }
  function rotY(a){var c=Math.cos(a),s=Math.sin(a);return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];}
  function rotX(a){var c=Math.cos(a),s=Math.sin(a);return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1];}
  function trans(z){var m=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];m[14]=z;return m;}

  var api={
    setClouds:function(list){
      clouds.forEach(function(c){ gl.deleteBuffer(c.posBuf); gl.deleteBuffer(c.depBuf); });
      clouds=[]; maxR=1;
      list.forEach(function(c){
        var pb=gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER,pb);
        gl.bufferData(gl.ARRAY_BUFFER,c.pos,gl.STATIC_DRAW);
        var db=gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER,db);
        gl.bufferData(gl.ARRAY_BUFFER,c.dep,gl.STATIC_DRAW);
        clouds.push({posBuf:pb, depBuf:db, n:c.n, maxd:c.maxd,
                     alpha:c.alpha||0.30, ptScale:c.ptScale||46});
        if(!c.core) maxR=Math.max(maxR, c.maxd+1);
      });
    },
    clearClouds:function(){ api.setClouds([]); },

    setWalk:function(pts){
      if(walk){ prevWalk=walk; }
      if(!pts||pts.length<2){ walk=null; head=0; return; }
      var n=pts.length;
      var pos=new Float32Array(n*3), tt=new Float32Array(n);
      for(var i=0;i<n;i++){
        pos[i*3]=pts[i][0]; pos[i*3+1]=pts[i][1]; pos[i*3+2]=pts[i][2];
        tt[i]=i/(n-1);
      }
      var pb=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,pb);
      gl.bufferData(gl.ARRAY_BUFFER,pos,gl.STATIC_DRAW);
      var tb=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,tb);
      gl.bufferData(gl.ARRAY_BUFFER,tt,gl.STATIC_DRAW);
      walk={posBuf:pb, tBuf:tb, n:n, pts:pts};
      head=0;
    },

    /* head position: after move i at eased progress t */
    setProgress:function(i,t){
      if(!walk) return;
      head=Math.max(0, Math.min(walk.n-1, i+t));
    },

    frame:function(dt, active){
      if(canvas.clientWidth===0) return;
      var dpr=Math.min(2,window.devicePixelRatio||1);
      var w=(canvas.clientWidth*dpr)|0, h=(canvas.clientHeight*dpr)|0;
      if(canvas.width!==w||canvas.height!==h){ canvas.width=w; canvas.height=h; }
      gl.viewport(0,0,w,h);
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      if(!dragging){
        spin+=dt*0.05;
        userYaw+=vYaw*dt; vYaw*=Math.pow(0.1,dt);
      }
      var dist=maxR*2.75;
      var pv=m4mul(persp(0.72,w/h,0.1,dist*4),
               m4mul(trans(-dist), m4mul(rotX(tilt), rotY(spin+userYaw))));

      gl.useProgram(starProg);
      gl.uniformMatrix4fv(sLoc.uPV,false,pv);
      clouds.forEach(function(c){
        gl.uniform1f(sLoc.uMaxD,c.maxd);
        gl.uniform1f(sLoc.uPtScale,c.ptScale*dpr);
        gl.uniform1f(sLoc.uAlpha,c.alpha*(active?1:0.6));
        gl.bindBuffer(gl.ARRAY_BUFFER,c.posBuf);
        gl.enableVertexAttribArray(sLoc.aPos);
        gl.vertexAttribPointer(sLoc.aPos,3,gl.FLOAT,false,0,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,c.depBuf);
        gl.enableVertexAttribArray(sLoc.aDep);
        gl.vertexAttribPointer(sLoc.aDep,1,gl.FLOAT,false,0,0);
        gl.drawArrays(gl.POINTS,0,c.n);
      });

      function drawWalk(wk, headT, col, alpha){
        gl.useProgram(lineProg);
        gl.uniformMatrix4fv(lLoc.uPV,false,pv);
        gl.uniform3fv(lLoc.uCol,col);
        gl.uniform1f(lLoc.uHead,headT);
        gl.uniform1f(lLoc.uAlpha,alpha);
        gl.bindBuffer(gl.ARRAY_BUFFER,wk.posBuf);
        gl.enableVertexAttribArray(lLoc.aPos);
        gl.vertexAttribPointer(lLoc.aPos,3,gl.FLOAT,false,0,0);
        gl.disableVertexAttribArray(sLoc.aDep);
        gl.bindBuffer(gl.ARRAY_BUFFER,wk.tBuf);
        gl.enableVertexAttribArray(lLoc.aT);
        gl.vertexAttribPointer(lLoc.aT,1,gl.FLOAT,false,0,0);
        gl.drawArrays(gl.LINE_STRIP,0,wk.n);
      }
      if(prevWalk) drawWalk(prevWalk,1,[0.55,0.48,0.38],0.25);
      if(walk){
        drawWalk(walk, head/(walk.n-1), [1.0,0.79,0.48], 0.9);
        /* comet at the interpolated head */
        var i0=Math.floor(head), t=head-i0;
        var a=walk.pts[Math.min(i0,walk.n-1)], b=walk.pts[Math.min(i0+1,walk.n-1)];
        var px=a[0]+(b[0]-a[0])*t, py=a[1]+(b[1]-a[1])*t, pz=a[2]+(b[2]-a[2])*t;
        gl.useProgram(cometProg);
        gl.uniformMatrix4fv(cLoc.uPV,false,pv);
        gl.uniform3f(cLoc.uPos,px,py,pz);
        gl.uniform1f(cLoc.uSize,1.0);
        gl.uniform3f(cLoc.uCol,1.0,0.85,0.55);
        gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
        gl.enableVertexAttribArray(cLoc.aCorner);
        gl.vertexAttribPointer(cLoc.aCorner,2,gl.FLOAT,false,0,0);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      }
      /* home star */
      gl.useProgram(cometProg);
      gl.uniformMatrix4fv(cLoc.uPV,false,pv);
      gl.uniform3f(cLoc.uPos,0,0,0);
      gl.uniform1f(cLoc.uSize,0.7);
      gl.uniform3f(cLoc.uCol,0.39,0.9,0.66);
      gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
      gl.enableVertexAttribArray(cLoc.aCorner);
      gl.vertexAttribPointer(cLoc.aCorner,2,gl.FLOAT,false,0,0);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
  };

  /* a gentle fling for the map too */
  canvas.addEventListener("pointerdown",function(e){
    canvas.setPointerCapture(e.pointerId);
    dragging=true; lastX=e.clientX; lastT=performance.now(); vYaw=0;
  });
  canvas.addEventListener("pointermove",function(e){
    if(!dragging) return;
    var now=performance.now(), dt=Math.max(1,now-lastT)/1000;
    var dx=(e.clientX-lastX)/Math.max(200,canvas.clientWidth)*3.5;
    userYaw+=dx; vYaw=0.7*vYaw+0.3*(dx/dt);
    lastX=e.clientX; lastT=now;
  });
  function up(){ dragging=false; }
  canvas.addEventListener("pointerup",up);
  canvas.addEventListener("pointercancel",up);

  /* Ariadne's-thread walk for puzzles with no distance table:
     radius = length of the simplified word, winding a spiral */
  api.threadWalk=function(radii){
    var pts=[], i;
    for(i=0;i<radii.length;i++){
      var r=radii[i]===0?0.02:radii[i];
      var th=i*0.61+1.7, ph=Math.sin(i*0.83)*0.5;
      pts.push([Math.cos(th)*Math.cos(ph)*r, Math.sin(ph)*r*0.55, Math.sin(th)*Math.cos(ph)*r]);
    }
    return pts;
  };
  api.setMaxR=function(r){ maxR=r; };

  return api;
}

root.MapView=MapView;
})(typeof self!=="undefined"?self:this);
