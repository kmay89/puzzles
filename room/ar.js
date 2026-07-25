/* ar.js — put it in your room.
   Two ways out of the flat screen, both hand-rolled, no libraries:

   · WebXR ("xr") — real augmented reality where the browser offers it
     (Android Chrome, headsets): camera passthrough, the puzzle rides
     the hit-test point until you tap to set it down on a real surface
     at roughly hand size, then you walk around it while it solves.

   · The window ("window") — everywhere else with a camera and a
     gyroscope (iPhones especially): the rear camera becomes the
     backdrop and the gyroscope steers the view, so the puzzle hangs
     pinned in a direction of your room. It is a window, not full
     world-tracking — Safari doesn't offer WebXR AR — and the room
     says so honestly.

   The app hands us its renderScene(proj, view, world, now); we hand
   back camera matrices. Solving, animation and the workers carry on
   unchanged underneath. */
(function(root){
"use strict";

function RoomAR(opts){
  var gl=opts.gl, canvas=opts.canvas;

  /* ---- tiny matrix/quaternion kit (self-contained on purpose) ---- */
  function mMul(a,b){
    var o=new Float32Array(16),r,c,k,s;
    for(c=0;c<4;c++)for(r=0;r<4;r++){s=0;for(k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];o[c*4+r]=s;}
    return o;
  }
  function mIdent(){ return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]); }
  function mTrans(x,y,z){ var m=mIdent(); m[12]=x;m[13]=y;m[14]=z; return m; }
  function mScale(s){ var m=mIdent(); m[0]=s;m[5]=s;m[10]=s; return m; }
  function mPersp(fovy,aspect,near,far){
    var f=1/Math.tan(fovy/2), nf=1/(near-far);
    return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
  }
  function qAxis(ax,ay,az,ang){
    var s=Math.sin(ang/2);
    return [ax*s, ay*s, az*s, Math.cos(ang/2)];
  }
  function qMul(a,b){
    return [
      a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
      a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
      a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
      a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
    ];
  }
  /* rotation matrix (column-major) from quaternion */
  function qMat(q){
    var x=q[0],y=q[1],z=q[2],w=q[3];
    var m=mIdent();
    m[0]=1-2*(y*y+z*z); m[4]=2*(x*y-z*w);  m[8]=2*(x*z+y*w);
    m[1]=2*(x*y+z*w);   m[5]=1-2*(x*x+z*z);m[9]=2*(y*z-x*w);
    m[2]=2*(x*z-y*w);   m[6]=2*(y*z+x*w);  m[10]=1-2*(x*x+y*y);
    return m;
  }
  function mTransposeRot(m){
    var o=mIdent();
    o[0]=m[0];o[4]=m[1];o[8]=m[2];
    o[1]=m[4];o[5]=m[5];o[9]=m[6];
    o[2]=m[8];o[6]=m[9];o[10]=m[10];
    return o;
  }

  var SCALE=0.036;               /* engine units → metres: a ~9 cm cube */
  var LIFT=1.32*SCALE;           /* rest the puzzle on the surface */

  var mode=null;                 /* null | 'xr' | 'window' */
  var xr={ session:null, refSpace:null, hitSource:null, lastHit:null, placed:null };
  var win={ stream:null, video:null, euler:null, placed:null, lastWorld:null, handler:null };

  /* ---------------- WebXR: the real thing ---------------- */
  function enterXR(){
    navigator.xr.requestSession("immersive-ar",{
      requiredFeatures:["hit-test"],
      optionalFeatures:["dom-overlay"],
      domOverlay:{ root:document.body }
    }).then(function(session){
      xr.session=session;
      mode="xr";
      return Promise.all([
        gl.makeXRCompatible(),
        session.requestReferenceSpace("local"),
        session.requestReferenceSpace("viewer")
      ]).then(function(rs){
        xr.refSpace=rs[1];
        session.updateRenderState({ baseLayer:new XRWebGLLayer(session, gl) });
        return session.requestHitTestSource({ space:rs[2] });
      }).then(function(src){
        xr.hitSource=src;
        session.addEventListener("select", function(){
          if(xr.lastHit && !xr.placed) xr.placed=xr.lastHit;
          else xr.placed=null;   /* tap again to pick it back up */
        });
        session.addEventListener("end", function(){ cleanupXR(); });
        opts.onEnter&&opts.onEnter("xr");
        opts.onStatus&&opts.onStatus("point at a table — tap to set it down");
        session.requestAnimationFrame(onXRFrame);
      });
    }).catch(function(err){
      mode=null;
      opts.onStatus&&opts.onStatus("the doorway didn't open ("+ (err&&err.message||err) +") — trying the window instead");
      enterWindow();
    });
  }

  function cleanupXR(){
    xr.session=null; xr.hitSource=null; xr.lastHit=null; xr.placed=null;
    mode=null;
    opts.onExit&&opts.onExit();
  }

  function withPose(poseMatrix){
    return mMul(poseMatrix, mMul(mTrans(0,LIFT,0), mScale(SCALE)));
  }

  function onXRFrame(t, frame){
    var session=xr.session;
    if(!session) return;
    session.requestAnimationFrame(onXRFrame);
    var pose=frame.getViewerPose(xr.refSpace);
    if(!pose) return;
    if(xr.hitSource && !xr.placed){
      var hits=frame.getHitTestResults(xr.hitSource);
      if(hits.length) xr.lastHit=hits[0].getPose(xr.refSpace).transform.matrix.slice(0);
    }
    var layer=session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    var world = xr.placed ? withPose(xr.placed)
              : xr.lastHit ? withPose(xr.lastHit)
              : mMul(mTrans(0,-0.05,-0.5), mScale(SCALE));  /* floats ahead until a surface appears */
    for(var i=0;i<pose.views.length;i++){
      var view=pose.views[i];
      var vp=layer.getViewport(view);
      gl.viewport(vp.x,vp.y,vp.width,vp.height);
      opts.renderScene(view.projectionMatrix, view.transform.inverse.matrix, world, t);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* ---------------- the window: camera + gyroscope ---------------- */
  function enterWindow(){
    var need=[];
    need.push(navigator.mediaDevices.getUserMedia({video:{facingMode:"environment", width:{ideal:1280}}}));
    if(typeof DeviceOrientationEvent!=="undefined" &&
       typeof DeviceOrientationEvent.requestPermission==="function"){
      need.push(DeviceOrientationEvent.requestPermission());
    }
    Promise.all(need).then(function(res){
      win.stream=res[0];
      win.video=document.createElement("video");
      win.video.className="ar-video";
      win.video.autoplay=true; win.video.muted=true; win.video.playsInline=true;
      win.video.srcObject=win.stream;
      win.video.onloadedmetadata=function(){
        var p=win.video.play();
        if(p&&p.catch) p.catch(function(){});
      };
      document.body.insertBefore(win.video, canvas);
      win.handler=function(e){
        if(e.alpha===null) return;
        win.euler=[e.alpha*Math.PI/180, e.beta*Math.PI/180, e.gamma*Math.PI/180];
      };
      window.addEventListener("deviceorientation", win.handler, true);
      mode="window";
      win.placed=null;
      opts.onEnter&&opts.onEnter("window");
      opts.onStatus&&opts.onStatus("look around — the puzzle floats ahead · tap to pin it in place");
    }).catch(function(){
      opts.onStatus&&opts.onStatus("this trick wants a phone with a camera and a gyroscope — open the room there and try again");
    });
  }

  function cleanupWindow(){
    if(win.stream) win.stream.getTracks().forEach(function(tk){ tk.stop(); });
    if(win.video&&win.video.parentNode) win.video.parentNode.removeChild(win.video);
    if(win.handler) window.removeEventListener("deviceorientation", win.handler, true);
    win.stream=null; win.video=null; win.handler=null; win.euler=null;
    win.placed=null; win.lastWorld=null;
    mode=null;
    opts.onExit&&opts.onExit();
  }

  /* device orientation → camera rotation (the classic ZXY dance,
     corrected for the screen's own rotation) */
  function windowView(){
    if(!win.euler) return mIdent();
    var alpha=win.euler[0], beta=win.euler[1], gamma=win.euler[2];
    /* q = qY(alpha) ⊗ qX(beta) ⊗ qZ(-gamma), then tilt back -90° about X,
       then undo the screen rotation about Z */
    var q=qMul(qMul(qAxis(0,1,0,alpha), qAxis(1,0,0,beta)), qAxis(0,0,1,-gamma));
    q=qMul(q, qAxis(1,0,0,-Math.PI/2));
    var orient=(screen.orientation&&screen.orientation.angle)||window.orientation||0;
    q=qMul(q, qAxis(0,0,1,-orient*Math.PI/180));
    return mTransposeRot(qMat(q));   /* view = inverse of camera rotation */
  }

  function windowCamera(aspect){
    if(mode!=="window") return null;
    var view=windowView();
    var world;
    if(win.placed) world=win.placed;
    else{
      /* hover 55 cm ahead of wherever the camera looks */
      var fx=-view[2], fy=-view[6], fz=-view[10];
      world=mMul(mTrans(fx*0.55, fy*0.55, fz*0.55), mScale(0.05));
      win.lastWorld=world;
    }
    return { proj:mPersp(1.05, aspect, 0.05, 40), view:view, world:world };
  }

  /* ---------------- public face ---------------- */
  var api={
    mode:function(){ return mode; },
    enter:function(){
      if(mode) return;
      if(navigator.xr && navigator.xr.isSessionSupported){
        navigator.xr.isSessionSupported("immersive-ar").then(function(ok){
          if(ok) enterXR(); else enterWindow();
        }).catch(enterWindow);
      } else if(navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
        enterWindow();
      } else {
        opts.onStatus&&opts.onStatus("this trick wants a phone with a camera — open the room there and press it again");
      }
    },
    exit:function(){
      if(mode==="xr" && xr.session) xr.session.end();
      else if(mode==="window") cleanupWindow();
    },
    windowCamera:windowCamera,
    tap:function(){
      if(mode!=="window") return;
      win.placed = win.placed ? null : win.lastWorld;
      opts.onStatus&&opts.onStatus(win.placed
        ? "pinned — it lives there now · tap to pick it back up"
        : "following your gaze again · tap to pin it");
    }
  };
  return api;
}

root.RoomAR=RoomAR;
})(typeof self!=="undefined"?self:this);
