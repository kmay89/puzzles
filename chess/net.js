/* net.js — two chairs, one board, no server.
   Same-room (LAN/nearby) two-player over a WebRTC data channel. There is
   no signaling server and no account: the invite and its reply are short
   codes you paste, AirDrop, or scan as QR — the whole handshake is two
   messages. STUN only, for candidate discovery; the game itself flows
   directly device-to-device.

   The transport (codes, QR, non-trickle ICE) is carried over from
   HIVEMIND's hive-link, where it has already linked many a kitchen
   table; here it is trimmed to exactly two seats. Codes are deflated
   when the browser can (CHESS2 ≈ half the size — smaller QR); CHESS1
   is the plain fallback and stays accepted forever.

   An invite can also carry a game in progress: if the link ever drops,
   either player mints a fresh invite and the same game resumes from the
   exact position and clocks. Self-healing, not self-pitying. */
(function (root) {
"use strict";

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
function enc(o) {
  var json = JSON.stringify(o);
  if (typeof CompressionStream === "function") {
    try {
      var cs = new CompressionStream("deflate-raw"), w = cs.writable.getWriter();
      w.write(new TextEncoder().encode(json)); w.close();
      return new Response(cs.readable).arrayBuffer().then(function (buf) {
        return "CHESS2." + b64(new Uint8Array(buf));
      });
    } catch (e) { /* fall through to plain */ }
  }
  return Promise.resolve("CHESS1." + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_"));
}
function dec(t) {
  t = (t || "").replace(/\s+/g, "");
  var m = t.match(/CHESS(1|2)\.([A-Za-z0-9_-]+)/);
  if (!m) return Promise.resolve(null);
  try {
    if (m[1] === "2") {
      if (typeof DecompressionStream !== "function") return Promise.resolve(null);
      var ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter();
      w.write(unB64(m[2])); w.close();
      return new Response(ds.readable).arrayBuffer().then(function (buf) {
        return JSON.parse(new TextDecoder().decode(buf));
      }).catch(function () { return null; });
    }
    return Promise.resolve(JSON.parse(decodeURIComponent(escape(atob(m[2].replace(/-/g, "+").replace(/_/g, "/"))))));
  } catch (e) { return Promise.resolve(null); }
}

/* ---------- the link ---------- */
function rtc() {
  return new RTCPeerConnection({ iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] });
}
/* non-trickle: wait for the full candidate set so one code carries
   everything (same-room iPhones link via the STUN reflexive candidates) */
function iceDone(pc) {
  return new Promise(function (res) {
    if (pc.iceGatheringState === "complete") return res();
    var t = setTimeout(res, 3500);
    pc.addEventListener("icegatheringstatechange", function () {
      if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); }
    });
  });
}

var Net = {
  state: "off",           /* off | hosting | joining | linked */
  isHost: false,
  pc: null, dc: null,
  onMessage: null, onLink: null, onDrop: null,
  peerMeta: null
};

function wireChannel(dc) {
  Net.dc = dc;
  dc.onopen = function () {
    Net.state = "linked";
    if (Net.onLink) Net.onLink();
  };
  dc.onmessage = function (e) {
    var msg = null;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg && Net.onMessage) Net.onMessage(msg);
  };
  dc.onclose = function () { drop(); };
  dc.onerror = function () { drop(); };
}
function drop() {
  if (Net.state === "off") return;
  var was = Net.state;
  Net.state = "off";
  if (was === "linked" && Net.onDrop) Net.onDrop();
}

/* host: build an offer, return the invite code. `meta` rides along —
   name, clock settings, which colour the host takes, and (on a resume)
   the game so far. */
Net.host = function (meta) {
  Net.close();
  Net.isHost = true;
  var pc = rtc();
  Net.pc = pc;
  Net.state = "hosting";
  wireChannel(pc.createDataChannel("game", { ordered: true }));
  pc.onconnectionstatechange = function () {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") drop();
  };
  return pc.createOffer().then(function (offer) {
    return pc.setLocalDescription(offer);
  }).then(function () { return iceDone(pc); }).then(function () {
    return enc({ v: 1, k: "invite", sdp: pc.localDescription.sdp, meta: meta || {} });
  });
};

/* joiner: read the invite, return {reply, meta} */
Net.join = function (code) {
  return dec(code).then(function (o) {
    if (!o || o.k !== "invite" || !o.sdp) return null;
    Net.close();
    Net.isHost = false;
    var pc = rtc();
    Net.pc = pc;
    Net.state = "joining";
    Net.peerMeta = o.meta || {};
    pc.ondatachannel = function (e) { wireChannel(e.channel); };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") drop();
    };
    return pc.setRemoteDescription({ type: "offer", sdp: o.sdp }).then(function () {
      return pc.createAnswer();
    }).then(function (ans) {
      return pc.setLocalDescription(ans);
    }).then(function () { return iceDone(pc); }).then(function () {
      return enc({ v: 1, k: "reply", sdp: pc.localDescription.sdp }).then(function (reply) {
        return { reply: reply, meta: o.meta || {} };
      });
    });
  });
};

/* host: paste in the reply and the room connects */
Net.acceptReply = function (code) {
  return dec(code).then(function (o) {
    if (!o || o.k !== "reply" || !o.sdp || !Net.pc || Net.state !== "hosting") return false;
    return Net.pc.setRemoteDescription({ type: "answer", sdp: o.sdp }).then(function () { return true; });
  });
};

Net.send = function (obj) {
  if (Net.dc && Net.dc.readyState === "open") {
    try { Net.dc.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  return false;
};

Net.linked = function () { return Net.state === "linked"; };

Net.close = function () {
  var pc = Net.pc, dc = Net.dc;
  Net.pc = null; Net.dc = null; Net.peerMeta = null;
  Net.state = "off";
  try { if (dc) { dc.onclose = null; dc.close(); } } catch (e) {}
  try { if (pc) { pc.onconnectionstatechange = null; pc.close(); } } catch (e) {}
};

/* invite/reply travel as tappable links on the web, raw codes on file:// */
Net.url = function (code) {
  var web = (location.protocol === "https:" || location.protocol === "http:");
  return web ? (location.origin + location.pathname + "#join=" + code) : code;
};

Net.drawQR = drawQR;
Net.decode = dec;

if (typeof module !== "undefined" && module.exports) module.exports = Net;
else root.Net = Net;
})(typeof self !== "undefined" ? self : this);
