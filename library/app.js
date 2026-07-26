/* app.js — the conductor: controls, the console shell, and the loop.

   Movement is deliberately one abstraction: every input — keyboard,
   mouse, touch sticks, and a real controller through the Gamepad API —
   is reduced to the same four numbers (move x/z, look x/y) plus a jump
   and a sprint flag. Nothing downstream knows or cares which of them a
   player used, which is why an Xbox pad works without a single special
   case in the movement code.                                          */
(function () {
"use strict";

var Blocks = window.Blocks, Mesher = window.Mesher, WorldLib = window.WorldLib,
    Anvil = window.Anvil, Gfx = window.Gfx;

function $(id) { return document.getElementById(id); }
function press(el, fn) {
  if (!el) return;
  var used = false;
  el.addEventListener("pointerdown", function (e) { used = true; el.classList.add("down"); e.preventDefault(); }, { passive: false });
  el.addEventListener("pointerup", function (e) {
    el.classList.remove("down");
    if (!used) return;
    used = false; e.preventDefault(); fn(e);
  }, { passive: false });
  el.addEventListener("pointercancel", function () { used = false; el.classList.remove("down"); });
  el.addEventListener("click", function (e) { e.preventDefault(); });
}
function esc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function open(id) { $(id).classList.remove("hide"); }
function shut(id) { $(id).classList.add("hide"); }
document.addEventListener("pointerdown", function (e) {
  var c = e.target.getAttribute && e.target.getAttribute("data-close");
  if (c) shut(c);
  if (e.target.classList && e.target.classList.contains("ov")) e.target.classList.add("hide");
});

/* ---------- state ---------- */
var G = {
  world: null, gfx: null, running: false,
  pos: [0, 3, -6], yaw: 0, pitch: 0,
  vel: [0, 0, 0], onGround: false,
  fly: false, meshed: 0, tris: 0, fps: 0,
  title: "", note: "", pad: false
};
var EYE = 1.62, SPEED = 5.2, SPRINT = 9.4, GRAV = 22, JUMP = 7.6;

/* ---------- input, reduced to four numbers ---------- */
var keys = Object.create(null);
var input = { mx: 0, mz: 0, lx: 0, ly: 0, jump: false, sprint: false, fly: false };

window.addEventListener("keydown", function (e) {
  keys[e.code] = true;
  if (e.code === "Escape") release();
  if (e.code === "KeyF") G.fly = !G.fly;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].indexOf(e.code) >= 0) e.preventDefault();
});
window.addEventListener("keyup", function (e) { keys[e.code] = false; });
window.addEventListener("blur", function () { keys = Object.create(null); });

/* mouse look, behind a pointer lock so the cursor does not wander off */
var locked = false;
$("view").addEventListener("mousedown", function () { grab(); });
function grab() {
  var v = $("view");
  if (v.requestPointerLock) v.requestPointerLock();
}
function release() { if (document.exitPointerLock) document.exitPointerLock(); }
document.addEventListener("pointerlockchange", function () {
  locked = document.pointerLockElement === $("view");
  $("cross").classList.toggle("hide", !locked && !isTouch());
});
document.addEventListener("mousemove", function (e) {
  if (!locked) return;
  G.yaw += e.movementX * 0.0022;
  G.pitch -= e.movementY * 0.0022;
  clampPitch();
});
function clampPitch() {
  var lim = Math.PI / 2 - 0.02;
  if (G.pitch > lim) G.pitch = lim;
  if (G.pitch < -lim) G.pitch = -lim;
}

/* touch sticks */
function isTouch() { return matchMedia("(pointer: coarse)").matches; }
if (isTouch()) document.body.classList.add("touch");
function stick(el, onMove) {
  var id = null, cx = 0, cy = 0, nub = el.querySelector(".nub");
  el.addEventListener("pointerdown", function (e) {
    id = e.pointerId;
    var r = el.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    el.setPointerCapture(id);
    e.preventDefault();
  }, { passive: false });
  el.addEventListener("pointermove", function (e) {
    if (e.pointerId !== id) return;
    var dx = (e.clientX - cx) / 46, dy = (e.clientY - cy) / 46;
    var m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    nub.style.transform = "translate(-50%,-50%) translate(" + (dx * 30) + "px," + (dy * 30) + "px)";
    onMove(dx, dy);
    e.preventDefault();
  }, { passive: false });
  var end = function (e) {
    if (e.pointerId !== id) return;
    id = null;
    nub.style.transform = "translate(-50%,-50%)";
    onMove(0, 0);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
var touchMove = [0, 0], touchLook = [0, 0];
stick($("stickL"), function (x, y) { touchMove[0] = x; touchMove[1] = y; });
stick($("stickR"), function (x, y) { touchLook[0] = x; touchLook[1] = y; });

/* A real controller. The Gamepad API is polled, not evented, so this
   runs once a frame; the deadzone is radial rather than per-axis
   because a square deadzone makes diagonals feel sticky. */
function readPad() {
  var pads = navigator.getGamepads ? navigator.getGamepads() : [];
  var p = null;
  for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { p = pads[i]; break; }
  G.pad = !!p;
  if (!p) return null;
  function dead(x, y) {
    var m = Math.hypot(x, y);
    if (m < 0.18) return [0, 0];
    var s = (m - 0.18) / 0.82 / m;
    return [x * s, y * s];
  }
  var L = dead(p.axes[0] || 0, p.axes[1] || 0);
  var R = dead(p.axes[2] || 0, p.axes[3] || 0);
  var btn = function (n) { return p.buttons[n] && p.buttons[n].pressed; };
  return {
    move: L, look: R,
    jump: btn(0),                                   /* A */
    sprint: btn(10) || (p.buttons[7] && p.buttons[7].value > 0.4),  /* L3 or RT */
    fly: btn(3),                                    /* Y */
    menu: btn(9), world: btn(2)                     /* start, X */
  };
}
var padWas = {};

function gather(dt) {
  input.mx = 0; input.mz = 0; input.lx = 0; input.ly = 0;
  input.jump = false; input.sprint = false;

  if (keys.KeyW || keys.ArrowUp) input.mz += 1;
  if (keys.KeyS || keys.ArrowDown) input.mz -= 1;
  if (keys.KeyA || keys.ArrowLeft) input.mx -= 1;
  if (keys.KeyD || keys.ArrowRight) input.mx += 1;
  if (keys.Space) input.jump = true;
  if (keys.ShiftLeft || keys.ShiftRight) input.sprint = true;

  input.mx += touchMove[0]; input.mz -= touchMove[1];
  input.lx += touchLook[0] * 2.4; input.ly += touchLook[1] * 2.4;

  var p = readPad();
  if (p) {
    input.mx += p.move[0]; input.mz -= p.move[1];
    input.lx += p.look[0] * 2.6; input.ly += p.look[1] * 2.6;
    if (p.jump) input.jump = true;
    if (p.sprint) input.sprint = true;
    /* edge-triggered, so holding Y does not strobe flight */
    if (p.fly && !padWas.fly) G.fly = !G.fly;
    if (p.menu && !padWas.menu) showMenu();
    if (p.world && !padWas.world) showWorld();
    padWas = { fly: p.fly, menu: p.menu, world: p.world };
  }

  var m = Math.hypot(input.mx, input.mz);
  if (m > 1) { input.mx /= m; input.mz /= m; }

  G.yaw += input.lx * dt * 1.6;
  G.pitch -= input.ly * dt * 1.6;
  clampPitch();
}

/* ---------- moving through the world ----------
   Axis-by-axis collision against the block grid: move on x, push out of
   anything solid, then z, then y. Doing all three at once is what makes
   a player stick on corners. */
function solidAt(x, y, z) {
  if (!G.world) return false;
  var m = G.world.get(Math.floor(x), Math.floor(y), Math.floor(z));
  return m !== 0 && !Blocks.isSeeThrough(m);
}
var R = 0.3, H = 1.8;
function hits(x, y, z) {
  for (var dx = -1; dx <= 1; dx += 2) for (var dz = -1; dz <= 1; dz += 2) {
    for (var yy = 0; yy <= 2; yy++) {
      var py = y + Math.min(yy * 0.9, H - 0.05);
      if (solidAt(x + dx * R, py, z + dz * R)) return true;
    }
  }
  return false;
}
/* One convention, used by both the camera and the legs:

       forward = ( sin yaw, 0,  cos yaw )
       right   = ( cos yaw, 0, -sin yaw )

   so yaw 0 faces +z and turning right increases it. Getting this
   consistent matters more than which way round it is — the first
   version had the camera looking down -z while W walked toward +z,
   which meant spawning with your back to the library and walking
   backwards out of it. The world rendered perfectly; there was just
   nothing in front of you but sky. */
function step(dt) {
  var sp = (input.sprint ? SPRINT : SPEED) * (G.fly ? 2.1 : 1);
  var sin = Math.sin(G.yaw), cos = Math.cos(G.yaw);
  var wx = input.mx * cos + input.mz * sin;
  var wz = -input.mx * sin + input.mz * cos;

  if (G.fly) {
    G.pos[0] += wx * sp * dt;
    G.pos[2] += wz * sp * dt;
    G.pos[1] += (input.jump ? sp : (keys.ShiftLeft ? -sp : 0)) * dt;
    G.vel[1] = 0;
    return;
  }

  var nx = G.pos[0] + wx * sp * dt;
  if (!hits(nx, G.pos[1], G.pos[2])) G.pos[0] = nx;
  var nz = G.pos[2] + wz * sp * dt;
  if (!hits(G.pos[0], G.pos[1], nz)) G.pos[2] = nz;

  G.vel[1] -= GRAV * dt;
  if (input.jump && G.onGround) { G.vel[1] = JUMP; G.onGround = false; }
  var ny = G.pos[1] + G.vel[1] * dt;
  if (hits(G.pos[0], ny, G.pos[2])) {
    if (G.vel[1] < 0) { G.onGround = true; G.pos[1] = Math.floor(ny) + 1.0; }
    G.vel[1] = 0;
  } else {
    G.pos[1] = ny;
    G.onGround = false;
  }
  /* a floor to fall to, if a world is loaded with nothing under you */
  if (G.pos[1] < -80) { G.pos[1] = 40; G.vel[1] = 0; }
}

/* ---------- meshing ---------- */
function remesh(world, onDone) {
  var list = world.list();
  var i = 0, quads = 0;
  G.gfx.clearChunks();
  function batch() {
    var t0 = performance.now();
    while (i < list.length && performance.now() - t0 < 22) {
      var c = list[i++];
      var qs = Mesher.build(world.volumeFor(c.cx, c.cy, c.cz), { seeThrough: Blocks.isSeeThrough });
      quads += qs.length;
      if (qs.length) {
        var tri = Mesher.toTriangles(qs);
        /* the mesher works in section-local coordinates; shift the
           positions into the world as they are uploaded */
        var ox = c.cx * 16, oy = c.cy * 16, oz = c.cz * 16;
        for (var p = 0; p < tri.positions.length; p += 3) {
          tri.positions[p] += ox; tri.positions[p + 1] += oy; tri.positions[p + 2] += oz;
        }
        G.gfx.setChunk(c.cx + "," + c.cy + "," + c.cz, tri, [ox, oy, oz]);
      }
      G.meshed = i;
    }
    if (i < list.length) { setTimeout(batch, 0); return; }
    G.quads = quads;
    if (onDone) onDone(quads);
  }
  batch();
}

/* ---------- the loop ---------- */
var last = 0, frames = 0, fpsAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!G.gfx || !G.gfx.ok) return;
  var dt = Math.min(0.05, (now - last) / 1000) || 0;
  last = now;

  if (G.running) { gather(dt); step(dt); }

  var cp = Math.cos(G.pitch), sp2 = Math.sin(G.pitch);
  var eye = [G.pos[0], G.pos[1] + EYE, G.pos[2]];
  /* the same forward vector the legs use — see the note above step() */
  var at = [eye[0] + Math.sin(G.yaw) * cp, eye[1] + sp2, eye[2] + Math.cos(G.yaw) * cp];
  var r = G.gfx.draw({ eye: eye, at: at }, { sky: [0.55, 0.68, 0.86], far: 240 });
  G.tris = r.tris;

  frames++;
  if (now - fpsAt > 500) { G.fps = Math.round(frames * 1000 / (now - fpsAt)); frames = 0; fpsAt = now; syncHUD(); }
}
requestAnimationFrame(frame);

function syncHUD() {
  if (!G.running) return;
  $("hud").innerHTML =
    "<b>" + Math.round(G.pos[0]) + ", " + Math.round(G.pos[1]) + ", " + Math.round(G.pos[2]) + "</b><br>" +
    G.fps + " fps · " + Math.round(G.tris).toLocaleString() + " tris<br>" +
    (G.world ? G.world.count.toLocaleString() + " blocks" : "") +
    (G.fly ? "<br><span class='warn'>flying</span>" : "") +
    (G.pad ? "<br>controller" : "");
}

/* ---------- worlds ---------- */
function play(world, title, note) {
  G.world = world;
  G.title = title; G.note = note || "";
  var sp = world.spawn || { x: 0, y: 40, z: 0 };
  G.pos = [sp.x + 0.5, sp.y, sp.z + 0.5];
  G.yaw = sp.yaw || 0; G.pitch = sp.pitch || 0;
  G.vel = [0, 0, 0];
  $("title").innerHTML = "<b>" + esc(title) + "</b>" + esc(note || "");
  $("title").classList.remove("hide");
  $("hud").classList.remove("hide");
  $("ring").classList.add("boot");
  remesh(world, function () {
    $("ring").classList.remove("boot");
    G.running = true;
    syncHUD();
  });
}

function startTribute() {
  var w = WorldLib.buildTribute();
  play(w, "The Reading Room", " · built in tribute");
}

/* drop / pick region files */
function loadFiles(files) {
  var picks = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var nm = f.webkitRelativePath || f.name;
    if (Anvil.regionName(nm)) picks.push(f);
  }
  var out = $("loadOut"), bar = $("bar").firstElementChild;
  if (!picks.length) {
    out.innerHTML = "<p class='note warn' style='color:var(--amber)'>No region files in that. Look for a <code>region</code> folder with <code>r.0.0.mca</code> files in it.</p>";
    return;
  }
  /* a browser tab will not mesh a whole library at once, and pretending
     otherwise just hangs the page */
  var MAX = 6;
  var used = picks.slice(0, MAX);
  out.innerHTML = "<p class='note'>Reading " + used.length + " region file" + (used.length > 1 ? "s" : "") +
    (picks.length > used.length ? " (of " + picks.length + " — the rest are left for now)" : "") + "…</p>";

  var world = new WorldLib.World({ name: "Your world" });
  var done = 0, chunks = 0, blocks = 0;
  var chain = Promise.resolve();
  used.forEach(function (f) {
    chain = chain.then(function () {
      return f.arrayBuffer().then(function (buf) {
        return WorldLib.importRegion(world, new Uint8Array(buf), { maxChunks: 220 });
      }).then(function (r) {
        done++; chunks += r.chunks; blocks += r.blocks;
        bar.style.width = Math.round(done / used.length * 100) + "%";
        out.innerHTML = "<p class='note'>" + chunks + " chunks · " + blocks.toLocaleString() + " blocks…</p>";
      }).catch(function (e) {
        done++;
        out.innerHTML = "<p class='note' style='color:var(--amber)'>" + esc(f.name) + ": " + esc(e.message) + "</p>";
      });
    });
  });
  chain.then(function () {
    if (world.isEmpty()) {
      out.innerHTML = "<p class='note' style='color:var(--amber)'>Those region files held no blocks this room could read.</p>";
      return;
    }
    /* stand somewhere sensible: the highest solid block near the middle */
    var mx = Math.round((world.min.x + world.max.x) / 2), mz = Math.round((world.min.z + world.max.z) / 2);
    var y = world.max.y;
    while (y > world.min.y && !world.get(mx, y, mz)) y--;
    world.spawn = { x: mx, y: y + 2, z: mz, yaw: 0, pitch: -0.15 };
    shut("ovWorld");
    play(world, "Your world", " · " + chunks + " chunks, " + blocks.toLocaleString() + " blocks");
  });
}

(function wireDrop() {
  var d = $("drop");
  ["dragenter", "dragover"].forEach(function (t) {
    d.addEventListener(t, function (e) { e.preventDefault(); d.classList.add("hot"); });
  });
  ["dragleave", "drop"].forEach(function (t) {
    d.addEventListener(t, function (e) { e.preventDefault(); d.classList.remove("hot"); });
  });
  d.addEventListener("drop", function (e) {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files) loadFiles(e.dataTransfer.files);
  });
  /* the whole window too, so a hurried drop outside the box still works */
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    e.preventDefault();
    if (!$("ovWorld").classList.contains("hide") && e.dataTransfer) loadFiles(e.dataTransfer.files);
  });
  press($("pickFiles"), function () { $("fileIn").click(); });
  press($("pickFolder"), function () { $("dirIn").click(); });
  $("fileIn").addEventListener("change", function (e) { loadFiles(e.target.files); });
  $("dirIn").addEventListener("change", function (e) { loadFiles(e.target.files); });
})();

/* ---------- the shell ---------- */
function showMenu() {
  $("menuState").textContent = G.world
    ? G.title + " — " + G.world.count.toLocaleString() + " blocks, " + Math.round(G.tris).toLocaleString() + " triangles on screen"
    : "Nothing loaded yet.";
  $("menuNote").textContent = G.pad
    ? "A controller is connected. Left stick walks, right stick looks, A jumps, Y flies."
    : "Plug in a controller and it will just work — the sticks, the triggers, all of it.";
  open("ovMenu");
}
function showWorld() { open("ovWorld"); }
function showControls() {
  $("controlsBody").innerHTML =
    "<ul>" +
    "<li><b>Controller</b> — left stick walks, right stick looks, <b>A</b> jumps, <b>Y</b> toggles flight, <b>RT</b> or <b>L3</b> sprints, <b>Start</b> opens this menu.</li>" +
    "<li><b>Keyboard</b> — <b>W A S D</b> walks, <b>Space</b> jumps, <b>Shift</b> sprints, <b>F</b> flies, <b>Esc</b> lets the mouse go.</li>" +
    "<li><b>Mouse</b> — click the picture to look around; the pointer is captured until you press Esc.</li>" +
    "<li><b>Touch</b> — two sticks, left to walk and right to look.</li>" +
    "</ul>" +
    "<p class='note'>Flight is there because a library is worth seeing from the gallery, and because a world you have loaded yourself may not have put you anywhere sensible.</p>";
  open("ovControls");
}

press($("btnMenu"), showMenu);
press($("btnLook"), function () { grab(); });
press($("btnWorld"), showWorld);
press($("btnAbout"), function () { open("ovAbout"); });
press($("mWalk"), function () { shut("ovMenu"); startTribute(); });
press($("mWorld"), function () { shut("ovMenu"); showWorld(); });
press($("mAbout"), function () { shut("ovMenu"); open("ovAbout"); });
press($("mControls"), function () { shut("ovMenu"); showControls(); });

press($("goWalk"), function () { boot(); startTribute(); });
press($("goLoad"), function () { boot(); showWorld(); });
press($("goAbout"), function () { open("ovAbout"); });

function boot() {
  $("boot").classList.add("gone");
  setTimeout(function () { $("boot").style.display = "none"; }, 520);
  resize();
}

/* ---------- canvas ---------- */
function resize() {
  var b = $("bezel");
  var w = b.clientWidth, h = b.clientHeight;
  if (!w || !h || !G.gfx) return;
  G.gfx.resize(w, h, window.devicePixelRatio || 1);
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", function () { setTimeout(resize, 200); });

window.addEventListener("gamepadconnected", function () { G.pad = true; syncHUD(); });
window.addEventListener("gamepaddisconnected", function () { G.pad = false; });

/* ---------- boot ---------- */
(function start() {
  var g = new Gfx($("view"));
  if (!g.ok) {
    $("boot").innerHTML = "<div class='mark'><span>📚</span></div><h1>The Reading Room</h1>" +
      "<p class='sub'>This browser cannot do WebGL, which is what draws the world. " +
      (g.error ? "(" + esc(g.error) + ")" : "") + "</p>";
    return;
  }
  G.gfx = g;
  resize();
  /* the ring on the case comes to rest once there is something to draw */
  $("ring").classList.remove("boot");
})();

if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}

/* handles for the browser check and for anyone curious */
window.__rr = function () { return { G: G, play: play, startTribute: startTribute, loadFiles: loadFiles }; };
})();
