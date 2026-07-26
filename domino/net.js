/* net.js — four chairs, one table, no server.

   Same-room four-player over WebRTC data channels. No signaling
   server, no account: the invite and its reply are short codes you
   paste, AirDrop, or hold up to a camera. STUN only, for candidate
   discovery; the game itself flows directly between the devices.

   The transport — codes, QR, non-trickle ICE — is carried over from
   HIVEMIND's hive-link by way of the chess room, where it has already
   linked a good many kitchen tables. What is new here is the shape of
   the table.

   ## Four seats, not two

   Chess needs one link. A domino table needs three, and browsers
   cannot mesh themselves, so this is a **star**: the host holds a
   channel to each of the other three and relays between them. The host
   runs the one true game; the other three send what they want to do and
   draw what they are told.

   The host keeps a small pool of unclaimed offers alive at all times,
   because when four people sit down they all tap Join in the same
   second and a single pending offer would serve one of them and drop
   the rest.

   ## The part that is genuinely different: hands are secret

   HIVEMIND broadcasts one shared colony to everybody, and the chess
   room's two players can both see the whole board. Neither precedent
   survives contact with dominoes, where the entire game is that you
   cannot see the other three hands. A single shared snapshot would put
   all four hands on every phone, and any player who opened the
   developer console — or simply installed the game and read it —
   would be able to see them. That is not a leak that can be papered
   over in the interface; it has to be impossible.

   So the host never broadcasts the game. It sends **each seat its own
   view**, built by `Rules.publicView(state, seat)` — the same function
   the AI reasons from, and the one `rules-check.js` proves does not
   leak. What travels to a phone is that phone's own bones, the line on
   the table, the counts, and what everyone has passed on. The other
   three hands never leave the host at all, so there is nothing on the
   wire to find.

   A pleasant consequence: the payload is a quarter of the size, and a
   joiner's screen is drawn from exactly the same structure as a solo
   game's, so there is no second rendering path to keep in step.       */
(function (root) {
"use strict";

var Rules = (typeof require === "function" && typeof module !== "undefined")
  ? require("./rules.js") : root.Rules;

/* ---------- a tiny QR encoder (byte mode, ECC level L) ----------
   Ported from the public-domain qrcodegen algorithm (Project Nayuki),
   via HIVEMIND, so invites can be scanned instead of pasted. */
var QR_ECC_L = [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30];
var QR_NB_L = [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25];
var QR_EXP = new Uint8Array(512), QR_LOG = new Uint8Array(256);
(function () { var x = 1; for (var i = 0; i < 255; i++) { QR_EXP[i] = x; QR_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; } for (var j = 255; j < 512; j++) QR_EXP[j] = QR_EXP[j - 255]; })();
function qrMul(a, b) { return (a && b) ? QR_EXP[QR_LOG[a] + QR_LOG[b]] : 0; }
function qrRawModules(v) { var r = (16 * v + 128) * v + 64; if (v >= 2) { var na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; } return r; }
function qrDataCW(v) { return (qrRawModules(v) >> 3) - QR_ECC_L[v] * QR_NB_L[v]; }
function qrDivisor(deg) {
  var res = new Uint8Array(deg); res[deg - 1] = 1; var root2 = 1;
  for (var i = 0; i < deg; i++) { for (var j = 0; j < deg; j++) { res[j] = qrMul(res[j], root2) ^ (j + 1 < deg ? res[j + 1] : 0); } root2 = qrMul(root2, 2); }
  return res;
}
function qrRemainder(data, div) {
  var res = new Uint8Array(div.length);
  for (var k = 0; k < data.length; k++) {
    var f = data[k] ^ res[0];
    res.copyWithin(0, 1); res[res.length - 1] = 0;
    for (var j = 0; j < div.length; j++) res[j] ^= qrMul(div[j], f);
  }
  return res;
}
function qrEncode(text) {
  var bytes = new TextEncoder().encode(text), v = 0, t;
  for (t = 1; t <= 40; t++) { if (4 + (t < 10 ? 8 : 16) + bytes.length * 8 <= qrDataCW(t) * 8) { v = t; break; } }
  if (!v) return null;
  var cap = qrDataCW(v) * 8, bits = [];
  var push = function (val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(4, 4); push(bytes.length, v < 10 ? 8 : 16);
  for (var bi = 0; bi < bytes.length; bi++) push(bytes[bi], 8);
  push(0, Math.min(4, cap - bits.length)); if (bits.length % 8) push(0, 8 - bits.length % 8);
  for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) push(pad, 8);
  var data = new Uint8Array(cap / 8);
  for (var di = 0; di < bits.length; di++) data[di >> 3] |= bits[di] << (7 - (di & 7));
  var nb = QR_NB_L[v], ecl = QR_ECC_L[v], total = qrRawModules(v) >> 3;
  var shortData = Math.floor(total / nb) - ecl, numLong = total % nb, div = qrDivisor(ecl), blocks = [];
  var off = 0;
  for (var b1 = 0; b1 < nb; b1++) {
    var len = shortData + (b1 >= nb - numLong ? 1 : 0);
    var d = data.slice(off, off + len); off += len;
    blocks.push({ d: d, e: qrRemainder(d, div) });
  }
  var cw = [];
  for (var i1 = 0; i1 <= shortData; i1++) for (var b2 = 0; b2 < blocks.length; b2++) { if (i1 < blocks[b2].d.length) cw.push(blocks[b2].d[i1]); }
  for (var i2 = 0; i2 < ecl; i2++) for (var b3 = 0; b3 < blocks.length; b3++) cw.push(blocks[b3].e[i2]);
  var size = v * 4 + 17, mod = new Uint8Array(size * size), fun = new Uint8Array(size * size);
  var set = function (x, y, dark) { mod[y * size + x] = dark ? 1 : 0; fun[y * size + x] = 1; };
  var finder = function (cx, cy) {
    for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
      var x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      var dd = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, dd !== 2 && dd !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  for (var ti = 0; ti < size; ti++) { if (!fun[6 * size + ti]) set(ti, 6, ti % 2 === 0); if (!fun[ti * size + 6]) set(6, ti, ti % 2 === 0); }
  if (v >= 2) {
    var na = Math.floor(v / 7) + 2;
    var step = (v === 32) ? 26 : Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2;
    var posl = [6]; for (var p2 = size - 7; posl.length < na; p2 -= step) posl.splice(1, 0, p2);
    for (var ai = 0; ai < na; ai++) for (var aj = 0; aj < na; aj++) {
      if ((ai === 0 && aj === 0) || (ai === 0 && aj === na - 1) || (ai === na - 1 && aj === 0)) continue;
      var cx2 = posl[aj], cy2 = posl[ai];
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) set(cx2 + dx2, cy2 + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }
  }
  if (v >= 7) {
    var rem = v; for (var vi = 0; vi < 12; vi++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var vb = (v << 12) | rem;
    for (var vk = 0; vk < 18; vk++) { var bit = (vb >>> vk) & 1, aa = size - 11 + vk % 3, bb = Math.floor(vk / 3); set(aa, bb, bit); set(bb, aa, bit); }
  }
  for (var fi = 0; fi <= 8; fi++) { if (fi !== 6) { fun[8 * size + fi] = 1; fun[fi * size + 8] = 1; } }
  for (var f2 = 0; f2 < 8; f2++) fun[8 * size + size - 1 - f2] = 1;
  for (var f3 = 0; f3 < 7; f3++) fun[(size - 7 + f3) * size + 8] = 1;
  set(8, size - 8, true);
  var dataPos = [], up = true;
  for (var right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (var kk = 0; kk < size; kk++) {
      var yy = up ? size - 1 - kk : kk;
      var cols = [right, right - 1];
      for (var cc = 0; cc < 2; cc++) if (!fun[yy * size + cols[cc]]) dataPos.push([cols[cc], yy]);
    }
    up = !up;
  }
  for (var dp = 0; dp < dataPos.length; dp++) {
    var xy = dataPos[dp];
    mod[xy[1] * size + xy[0]] = (dp >> 3) < cw.length ? (cw[dp >> 3] >>> (7 - (dp & 7))) & 1 : 0;
  }
  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; }, function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; }, function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
    function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }];
  var writeFormat = function (mask) {
    var fb = (1 << 3) | mask, rem2 = fb;
    for (var i = 0; i < 10; i++) rem2 = (rem2 << 1) ^ ((rem2 >>> 9) * 0x537);
    var fbits = ((fb << 10) | rem2) ^ 0x5412;
    var bitAt = function (i) { return (fbits >>> i) & 1; };
    for (var i0 = 0; i0 <= 5; i0++) mod[i0 * size + 8] = bitAt(i0);
    mod[7 * size + 8] = bitAt(6); mod[8 * size + 8] = bitAt(7); mod[8 * size + 7] = bitAt(8);
    for (var i9 = 9; i9 < 15; i9++) mod[8 * size + (14 - i9)] = bitAt(i9);
    for (var i8 = 0; i8 < 8; i8++) mod[8 * size + (size - 1 - i8)] = bitAt(i8);
    for (var i7 = 8; i7 < 15; i7++) mod[(size - 15 + i7) * size + 8] = bitAt(i7);
  };
  var applyMask = function (mask) {
    for (var i = 0; i < dataPos.length; i++) {
      var q = dataPos[i];
      mod[q[1] * size + q[0]] ^= MASKS[mask](q[0], q[1]) ? 1 : 0;
    }
  };
  var penalty = function () {
    var p = 0, x, y, run;
    for (y = 0; y < size; y++) { run = 1; for (x = 1; x < size; x++) { if (mod[y * size + x] === mod[y * size + x - 1]) { run++; if (x === size - 1 && run >= 5) p += run - 2; } else { if (run >= 5) p += run - 2; run = 1; } } }
    for (x = 0; x < size; x++) { run = 1; for (y = 1; y < size; y++) { if (mod[y * size + x] === mod[(y - 1) * size + x]) { run++; if (y === size - 1 && run >= 5) p += run - 2; } else { if (run >= 5) p += run - 2; run = 1; } } }
    var dark = 0; for (var i = 0; i < size * size; i++) dark += mod[i];
    p += 10 * Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size));
    return p;
  };
  var best = 0, bp = 1e9;
  for (var mi = 0; mi < 8; mi++) { applyMask(mi); writeFormat(mi); var pn = penalty(); if (pn < bp) { bp = pn; best = mi; } applyMask(mi); }
  applyMask(best); writeFormat(best);
  return { size: size, mod: mod };
}
function drawQR(cv, text, dark, light) {
  var q = qrEncode(text);
  if (!q || !cv) return false;
  var quiet = 4, n = q.size + quiet * 2, scale = Math.max(2, Math.floor(560 / n));
  cv.width = n * scale; cv.height = n * scale;
  var g = cv.getContext("2d");
  g.fillStyle = light || "#ffffff"; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = dark || "#1c2028";
  for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) {
    if (q.mod[y * q.size + x]) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  }
  return true;
}

/* ---------- signaling codes ---------- */
function b64(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unB64(str) {
  var s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  var b = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
function nothing() { /* a rejection we have already decided not to care about */ }
function enc(o) {
  var json = JSON.stringify(o);
  if (typeof CompressionStream === "function") {
    try {
      var cs = new CompressionStream("deflate-raw"), w = cs.writable.getWriter();
      /* the writer's own promises need catching too — see the note in
         `dec` below; the same trap, the same one-line fix */
      w.write(new TextEncoder().encode(json)).catch(nothing);
      w.close().catch(nothing);
      return new Response(cs.readable).arrayBuffer().then(function (buf) {
        return "DTAB2." + b64(new Uint8Array(buf));
      }).catch(function () { return null; });
    } catch (e) { /* fall through to plain */ }
  }
  return Promise.resolve("DTAB1." + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_"));
}
function dec(t) {
  t = (t || "").replace(/\s+/g, "");
  var m = t.match(/DTAB(1|2)\.([A-Za-z0-9_-]+)/);
  if (!m) return Promise.resolve(null);
  try {
    if (m[1] === "2") {
      if (typeof DecompressionStream !== "function") return Promise.resolve(null);
      var ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter();
      /* A damaged code is not an edge case — it is what you get when
         somebody's messaging app helpfully truncates a long link, and
         it has to fail as a quiet "that code didn't work" rather than
         as noise in the console.

         The catch on the *read* side is not enough. When the deflate
         stream is malformed the writer's own promises reject too, and
         with nothing attached to them that surfaces as an unhandled
         rejection — which in node takes the whole process down, and in
         a browser fills the console with something that looks like a
         crash. Both of the writer's promises need somewhere to land. */
      w.write(unB64(m[2])).catch(nothing);
      w.close().catch(nothing);
      return new Response(ds.readable).arrayBuffer().then(function (buf) {
        return JSON.parse(new TextDecoder().decode(buf));
      }).catch(function () { return null; });
    }
    return Promise.resolve(JSON.parse(decodeURIComponent(escape(atob(m[2].replace(/-/g, "+").replace(/_/g, "/"))))));
  } catch (e) { return Promise.resolve(null); }
}


/* ---------- the links ---------- */
function rtc() {
  return new RTCPeerConnection({
    iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
  });
}
/* non-trickle: wait for the whole candidate set so one code carries
   everything (same-room iPhones link via the STUN reflexive candidates,
   because iOS Safari withholds host candidates without camera
   permission) */
function iceDone(pc) {
  return new Promise(function (res) {
    if (pc.iceGatheringState === "complete") return res();
    var t = setTimeout(res, 3500);
    pc.addEventListener("icegatheringstatechange", function () {
      if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); }
    });
  });
}

var SEATS = 4;

var Net = {
  role: "off",          /* off | host | guest                              */
  seat: 0,              /* which chair this device is sitting in           */
  peers: [],            /* host only: one entry per other chair            */
  pool: [],             /* host only: offers minted and waiting to be taken */
  pc: null, dc: null,   /* guest only: the single link to the host          */
  name: "",
  roster: [],           /* [{seat, name, here, bot}] as the host sees it    */
  onMessage: null,      /* (msg, fromSeat)                                  */
  onRoster: null,
  onLink: null,
  onDrop: null,         /* (seat) — a chair emptied                         */
  lastHeard: 0
};

/* ---------- the host ----------
   Mints an offer and holds it open. Several people tapping Join at the
   same moment is the normal case, not an edge case, so the pool keeps
   spares: without them the second and third person to tap get nothing
   and have to be told to try again, which is exactly the ritual this is
   meant to remove. */
Net.startHosting = function (name) {
  Net.close();
  Net.role = "host";
  Net.seat = 0;
  Net.name = name || "Host";
  Net.peers = [];
  Net.pool = [];
  Net.roster = [{ seat: 0, name: Net.name, here: true, bot: false }];
  for (var s = 1; s < SEATS; s++) Net.roster.push({ seat: s, name: "", here: false, bot: true });
  return Net.mintInvite();
};

/* one invite. `meta` rides along so a joiner's screen can greet them by
   the host's name and show the house rules before they commit. */
Net.mintInvite = function (meta) {
  if (Net.role !== "host") return Promise.resolve(null);
  if (Net.seatsFree() <= 0) return Promise.resolve(null);
  var pc = rtc();
  var slot = { pc: pc, dc: null, claimed: false };
  var dc = pc.createDataChannel("table", { ordered: true });
  slot.dc = dc;
  wireHostChannel(slot);
  pc.onconnectionstatechange = function () {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") dropSlot(slot);
  };
  Net.pool.push(slot);
  return pc.createOffer()
    .then(function (o) { return pc.setLocalDescription(o); })
    .then(function () { return iceDone(pc); })
    .then(function () {
      return enc({
        v: 1, k: "invite", sdp: pc.localDescription.sdp,
        meta: meta || { host: Net.name, seats: Net.seatsFree() }
      });
    });
};

Net.seatsFree = function () {
  var n = 0;
  for (var s = 1; s < SEATS; s++) if (!seatTaken(s)) n++;
  return n;
};
function seatTaken(s) {
  for (var i = 0; i < Net.peers.length; i++) if (Net.peers[i].seat === s) return true;
  return false;
}
/* Somebody reconnecting keeps their chair. Names are what a seat is
   remembered by, so a player whose phone locked, or whose train went
   into a tunnel, comes back to the same seat and the same bones rather
   than to whichever chair happened to be free. */
function seatFor(name) {
  var i;
  for (i = 0; i < Net.roster.length; i++) {
    if (Net.roster[i].name && Net.roster[i].name === name && !seatTaken(Net.roster[i].seat)) {
      return Net.roster[i].seat;
    }
  }
  for (i = 1; i < SEATS; i++) if (!seatTaken(i)) return i;
  return -1;
}

function wireHostChannel(slot) {
  var dc = slot.dc;
  dc.onopen = function () { /* wait for the guest to say who they are */ };
  dc.onmessage = function (e) {
    var msg = null;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg) return;
    Net.lastHeard = Date.now();

    if (msg.k === "hi") {
      /* the greeting is sent more than once on purpose — a channel-open
         race must not be able to eat the name a seat is keyed on, so
         this has to be idempotent */
      if (slot.claimed) { sendTo(slot, { k: "seat", seat: slot.seat, roster: Net.roster }); return; }
      var nm = cleanName(msg.name);
      var seat = seatFor(nm);
      if (seat < 0) { sendTo(slot, { k: "full" }); return; }
      slot.claimed = true;
      slot.seat = seat;
      slot.name = nm;
      Net.peers.push(slot);
      var idx = Net.pool.indexOf(slot);
      if (idx >= 0) Net.pool.splice(idx, 1);
      Net.roster[seat] = { seat: seat, name: nm, here: true, bot: false };
      sendTo(slot, { k: "seat", seat: seat, roster: Net.roster });
      Net.broadcast({ k: "lob", roster: Net.roster });
      if (Net.onRoster) Net.onRoster(Net.roster);
      if (Net.onLink) Net.onLink(seat, nm);
      return;
    }
    if (!slot.claimed) return;
    if (msg.k === "ka") return;                 /* keepalive; nothing to do */
    if (Net.onMessage) Net.onMessage(msg, slot.seat);
  };
  dc.onclose = function () { dropSlot(slot); };
  dc.onerror = function () { dropSlot(slot); };
}

function dropSlot(slot) {
  var i = Net.pool.indexOf(slot);
  if (i >= 0) { Net.pool.splice(i, 1); return; }
  i = Net.peers.indexOf(slot);
  if (i < 0) return;
  Net.peers.splice(i, 1);
  var seat = slot.seat;
  /* the chair does not disappear — it goes back to being played by the
     house, and keeps the name so its owner can take it back */
  if (seat >= 1 && seat < SEATS) {
    Net.roster[seat] = { seat: seat, name: Net.roster[seat].name, here: false, bot: true };
  }
  Net.broadcast({ k: "lob", roster: Net.roster });
  if (Net.onRoster) Net.onRoster(Net.roster);
  if (Net.onDrop) Net.onDrop(seat);
}

Net.acceptReply = function (code) {
  return dec(code).then(function (o) {
    if (!o || o.k !== "reply" || !o.sdp) return false;
    /* the reply does not say which offer it answers, so try each
       unclaimed one; the wrong pairing simply rejects */
    var tries = Net.pool.slice();
    return (function next(i) {
      if (i >= tries.length) return false;
      var slot = tries[i];
      return slot.pc.setRemoteDescription({ type: "answer", sdp: o.sdp })
        .then(function () { return true; })
        .catch(function () { return next(i + 1); });
    })(0);
  }).catch(function () { return false; });
};

/* ---------- a guest ---------- */
Net.join = function (code, name) {
  return dec(code).then(function (o) {
    if (!o || o.k !== "invite" || !o.sdp) return null;
    Net.close();
    Net.role = "guest";
    Net.name = cleanName(name);
    var pc = rtc();
    Net.pc = pc;
    pc.ondatachannel = function (e) { wireGuestChannel(e.channel); };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        if (Net.onDrop) Net.onDrop(-1);
      }
    };
    return pc.setRemoteDescription({ type: "offer", sdp: o.sdp })
      .then(function () { return pc.createAnswer(); })
      .then(function (a) { return pc.setLocalDescription(a); })
      .then(function () { return iceDone(pc); })
      .then(function () {
        return enc({ v: 1, k: "reply", sdp: pc.localDescription.sdp }).then(function (reply) {
          return { reply: reply, meta: o.meta || {} };
        });
      });
  });
};

function wireGuestChannel(dc) {
  Net.dc = dc;
  dc.onopen = function () {
    /* said three times, a beat apart: the host keys a seat on this name
       and a lost greeting would put the player in the wrong chair */
    var say = function () { Net.send({ k: "hi", name: Net.name }); };
    say();
    setTimeout(say, 220);
    setTimeout(say, 700);
    if (Net.keep) clearInterval(Net.keep);
    /* hold the NAT binding open through a quiet spell */
    Net.keep = setInterval(function () { Net.send({ k: "ka" }); }, 2000);
  };
  dc.onmessage = function (e) {
    var msg = null;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg) return;
    Net.lastHeard = Date.now();
    if (msg.k === "seat") {
      Net.seat = msg.seat | 0;
      Net.roster = msg.roster || [];
      if (Net.onRoster) Net.onRoster(Net.roster);
      if (Net.onLink) Net.onLink(Net.seat, Net.name);
      return;
    }
    if (msg.k === "lob") {
      Net.roster = msg.roster || [];
      if (Net.onRoster) Net.onRoster(Net.roster);
      return;
    }
    if (Net.onMessage) Net.onMessage(msg, 0);
  };
  dc.onclose = function () { if (Net.onDrop) Net.onDrop(-1); };
  dc.onerror = function () { if (Net.onDrop) Net.onDrop(-1); };
}

/* ---------- talking ---------- */
function sendTo(slot, obj) {
  if (slot && slot.dc && slot.dc.readyState === "open") {
    try { slot.dc.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  return false;
}
Net.send = function (obj) {
  if (Net.role === "guest") {
    if (Net.dc && Net.dc.readyState === "open") {
      try { Net.dc.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }
    return false;
  }
  return Net.broadcast(obj);
};
Net.broadcast = function (obj) {
  var n = 0;
  for (var i = 0; i < Net.peers.length; i++) if (sendTo(Net.peers[i], obj)) n++;
  return n;
};
Net.sendSeat = function (seat, obj) {
  for (var i = 0; i < Net.peers.length; i++) if (Net.peers[i].seat === seat) return sendTo(Net.peers[i], obj);
  return false;
};

/* The one that matters. Each chair is sent its own view of the table
   and nothing else — its own bones, the line, the counts, the passes.
   The other three hands never go on the wire, so they cannot be read
   off it. Built by the same `publicView` the AI reasons from, which is
   the function `rules-check.js` proves does not leak. */
Net.dealViews = function (state, extra) {
  if (Net.role !== "host") return 0;
  var n = 0;
  for (var i = 0; i < Net.peers.length; i++) {
    var p = Net.peers[i];
    var msg = { k: "view", view: Rules.publicView(state, p.seat) };
    if (extra) for (var key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) msg[key] = extra[key];
    if (sendTo(p, msg)) n++;
  }
  return n;
};

Net.linked = function () {
  if (Net.role === "guest") return !!(Net.dc && Net.dc.readyState === "open");
  return Net.peers.length > 0;
};
Net.count = function () { return Net.role === "host" ? Net.peers.length + 1 : Net.roster.length; };

Net.close = function () {
  if (Net.keep) { clearInterval(Net.keep); Net.keep = null; }
  var all = Net.peers.concat(Net.pool);
  for (var i = 0; i < all.length; i++) {
    try { if (all[i].dc) { all[i].dc.onclose = null; all[i].dc.close(); } } catch (e) {}
    try { if (all[i].pc) { all[i].pc.onconnectionstatechange = null; all[i].pc.close(); } } catch (e) {}
  }
  try { if (Net.dc) { Net.dc.onclose = null; Net.dc.close(); } } catch (e) {}
  try { if (Net.pc) { Net.pc.onconnectionstatechange = null; Net.pc.close(); } } catch (e) {}
  Net.peers = []; Net.pool = []; Net.pc = null; Net.dc = null;
  Net.role = "off"; Net.seat = 0; Net.roster = [];
};

/* a name is going onto three other people's screens, so it is cleaned
   here rather than trusted to the sender */
function cleanName(n) {
  var s = String(n === undefined || n === null ? "" : n)
    .replace(/[<>&"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 14);
  return s || "Jugador";
}

/* invites travel as tappable links on the web and as raw codes on
   file://, where a link would have nowhere to go */
Net.url = function (code) {
  var web = (location.protocol === "https:" || location.protocol === "http:");
  return web ? (location.origin + location.pathname + "#join=" + code) : code;
};

Net.drawQR = drawQR;
Net.decode = dec;
Net.encode = enc;
Net.cleanName = cleanName;
Net.SEATS = SEATS;

if (typeof module !== "undefined" && module.exports) module.exports = Net;
else root.Net = Net;
})(typeof self !== "undefined" ? self : this);
