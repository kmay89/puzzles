/* room.js — four letters, and you're in.

   The same front door for every game on this site. A host opens a room and
   reads four letters out loud; everyone else types them. That is the whole
   ritual, and it is the one HIVEMIND has been using at kitchen tables for a
   while now — this is that idea, lifted out and made to fit any game.

   What lives here, and why it is one file rather than three copies of an idea:

     · **the mailbox client** — talks to /api/room, an ephemeral pigeonhole
       that holds a WebRTC handshake under a code. A handshake is ~600
       characters, so it can never be typed; a code can. Nothing about a game
       goes through it, and every game must keep working with it unreachable
       (the paste/QR handshake is still there underneath).

     · **vitals** — a heartbeat over the open channel, so a link that is
       merely slow can be told apart from one that has died, and so the game
       can *say* which it is instead of freezing wordlessly.

     · **healing** — when the link does die, this rebuilds it without asking
       anybody anything. The host reclaims the same four letters with a key
       only it holds; the guest knocks on the same four letters again. Nobody
       reads out a new code, because there isn't a new code.

     · **the keepsake** — the code, the key and the seat, written down where a
       reload can find them. A phone that runs out of battery mid-game comes
       back to a button that says "Rejoin BUZZ", not to a shrug.

   This file is byte-identical in every game folder that uses it; the game
   tells it who it is through Room.configure(). tools/room-parity.js keeps the
   copies honest.                                                            */
(function (root) {
"use strict";

/* ---------- who am I ---------- */
var CFG = {
  game: "test",          /* the namespace on the mailbox                     */
  seats: 2,              /* how many chairs this game has                    */
  label: "room",         /* the word this game uses for a room, in prose     */
  keep: "room:test"      /* where the keepsake is written                    */
};

/* Same-origin first: on kmay89.com the mailbox is right there. The games are
   also mirrored onto GitHub Pages, which has no serverless anything, so a
   mirror falls through to the mailbox on the main site rather than losing the
   feature. If neither answers with JSON, `live` latches false and the game
   falls back to the handshake it has always had. */
var SAME = "/api/room";
var PUBLIC = "https://kmay89.com/api/room";

var Room = {
  live: null,            /* null unknown · true reachable · false gone       */
  base: SAME,
  code: null,            /* the four letters, once we have them              */
  key: null,             /* host only: the secret that reclaims the code     */
  role: "off",           /* off | host | guest                               */
  name: "",              /* my display name                                  */
  title: ""              /* the room's name                                  */
};

Room.configure = function (o) {
  o = o || {};
  if (o.game) { CFG.game = String(o.game); CFG.keep = "room:" + CFG.game; }
  if (o.seats) CFG.seats = o.seats | 0;
  if (o.label) CFG.label = String(o.label);
  if (o.api) { SAME = String(o.api); Room.base = SAME; }
  if (o.publicApi !== undefined) PUBLIC = o.publicApi ? String(o.publicApi) : null;
  return Room;
};
Room.game = function () { return CFG.game; };

/* ---------- codes ---------- */
/* The server never mints I or O, because read aloud they are 1 and 0 — so a
   typed 0 or 1 is a misheard letter rather than a digit, and is put back as
   one. Beyond that nothing is guessed: a code that can't exist is allowed
   through and comes back "no room by that name", which is the truth. */
Room.tidy = function (s) {
  return String(s == null ? "" : s).toUpperCase()
    .replace(/0/g, "O").replace(/1/g, "I")
    .replace(/[^A-Z]/g, "")
    .slice(0, 4);
};
Room.looksLikeCode = function (s) { return /^[A-Z]{4}$/.test(Room.tidy(s)); };
/* Is this whole string a room code, rather than something that merely
   starts with four letters? Both kinds of invite arrive down the same
   pipe — "BUZZ" and "CHESS2.eJx…" — and tidy() would happily turn the
   second into "CHES". */
Room.isCode = function (s) { return /^\s*[A-Za-z]{4}\s*$/.test(String(s == null ? "" : s)); };
/* a code with an I or an O in it cannot be one of ours — worth saying so
   plainly rather than letting them hear "no such room" and doubt the host */
Room.impossible = function (s) { return /[IO]/.test(Room.tidy(s)); };

/* ---------- the wire ---------- */
function once(url, a, body, qs) {
  var to = url + "?a=" + a + "&g=" + encodeURIComponent(CFG.game) +
           (qs ? "&" + qs : "") + "&_=" + (Date.now() + "" + Math.random());
  var opts = body
    ? { method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify(body) }
    : { cache: "no-store" };
  return fetch(to, opts).then(function (r) {
    /* A plain static host answers 404 *HTML* here. Mistaking that for a live
       mailbox is what would strand a joiner at an empty lobby instead of
       sending them to the handshake that does work — so the content type,
       not the status, is what decides whether a mailbox exists at all. */
    var ct = r.headers.get("content-type") || "";
    if (ct.indexOf("application/json") < 0) return { __nomailbox: true };
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok && !j.error) j.error = "that didn't take";
      return j;
    });
  }).catch(function () { return { __nomailbox: true }; });
}

/* every call goes through here: try what we believe, fall back once, latch */
function api(a, body, qs) {
  if (Room.live === false) return Promise.resolve(null);
  return once(Room.base, a, body, qs).then(function (j) {
    if (!j.__nomailbox) { Room.live = true; return j; }
    if (PUBLIC && Room.base !== PUBLIC) {
      return once(PUBLIC, a, body, qs).then(function (k) {
        if (k.__nomailbox) { Room.live = false; return null; }
        Room.base = PUBLIC; Room.live = true; return k;
      });
    }
    Room.live = false;
    return null;
  });
}
Room.api = api;

/* a cheap "is there a mailbox at all", answered once and remembered */
Room.reachable = function () {
  if (Room.live !== null) return Promise.resolve(Room.live);
  return api("ping").then(function (r) { return !!(r && r.ok); });
};

/* ---------- the host's side ---------- */
/* Open a room, or reclaim the one we already had. `offer` is a raw SDP.
   Returns {code, key, reclaimed} — or null if there is no mailbox. */
Room.open = function (offer, o) {
  o = o || {};
  var b = { offer: offer, host: o.host || Room.name || "A player",
            name: o.name || Room.title || ("A " + CFG.label),
            seats: o.seats || CFG.seats };
  if (o.reclaim !== false && Room.code && Room.key) { b.code = Room.code; b.key = Room.key; }
  return api("host", b).then(function (r) {
    if (!r || r.error || !r.code) return null;
    Room.role = "host"; Room.code = r.code; Room.key = r.key;
    Room.title = b.name;
    Room.remember({ role: "host", code: r.code, key: r.key, name: b.host, title: b.name });
    return r;
  });
};
/* another spare pigeonhole, so several people tapping Join at once all get in */
Room.spare = function (offer) {
  if (!Room.code || !Room.key) return Promise.resolve(null);
  return api("offer", { code: Room.code, key: Room.key, offer: offer }).then(function (r) {
    return r && !r.error ? r : null;
  });
};
Room.poll = function () {
  if (!Room.code || !Room.key) return Promise.resolve(null);
  return api("poll", null, "code=" + Room.code + "&key=" + encodeURIComponent(Room.key))
    .then(function (r) { return r && !r.error ? r : null; });
};
/* `started` keeps the room addressable (that is where a healing player comes
   back to) while taking it off the list of rooms waiting for someone. */
Room.shut = function (started, stillOpen) {
  if (!Room.code || !Room.key) return Promise.resolve(null);
  var p = api("close", { code: Room.code, key: Room.key,
                         started: started ? 1 : 0, open: stillOpen === false ? 0 : 1 });
  if (!started) { Room.code = null; Room.key = null; Room.forget(); }
  return p;
};

/* ---------- the joiner's side ---------- */
Room.list = function () {
  return api("list").then(function (r) { return r ? (r.rooms || []) : null; });
};
Room.peek = function (code) {
  return api("peek", null, "code=" + Room.tidy(code)).then(function (r) { return r || null; });
};
/* take the offer waiting under a code. Returns {slot, offer, name, host}. */
Room.knock = function (code, name) {
  code = Room.tidy(code);
  return api("join", { code: code, name: name || Room.name }).then(function (r) {
    if (!r) return null;
    if (r.error) return r;
    Room.role = "guest"; Room.code = code; Room.title = r.name || "";
    return r;
  });
};
Room.reply = function (slot, answer) {
  return api("answer", { code: Room.code, slot: slot, answer: answer })
    .then(function (r) { return r && !r.error ? r : null; });
};

/* ---------- the keepsake ----------
   Small, boring, and the difference between "my phone died" being a shrug and
   being a button. Nothing here is secret to anyone but this device: the host
   key would let somebody else re-host the room, which is exactly what the
   person holding this phone is entitled to do. */
var KEEP_FOR = 8 * 60 * 60 * 1000;
function ls() { try { return root.localStorage; } catch (e) { return null; } }
Room.remember = function (extra) {
  var s = ls(); if (!s) return;
  var o = Room.recall() || {};
  for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k];
  o.game = CFG.game; o.at = Date.now();
  try { s.setItem(CFG.keep, JSON.stringify(o)); } catch (e) {}
};
Room.recall = function () {
  var s = ls(); if (!s) return null;
  try {
    var o = JSON.parse(s.getItem(CFG.keep) || "null");
    if (!o || !o.code || !o.at || Date.now() - o.at > KEEP_FOR) return null;
    return o;
  } catch (e) { return null; }
};
Room.forget = function () { var s = ls(); if (s) try { s.removeItem(CFG.keep); } catch (e) {} };
/* step back into a remembered room without re-typing anything */
Room.resume = function (o) {
  o = o || Room.recall(); if (!o) return null;
  Room.code = o.code; Room.key = o.key || null; Room.role = o.role || "off";
  Room.name = o.name || Room.name; Room.title = o.title || Room.title;
  return o;
};

/* ---------- vitals: a pulse, and what to do when it stops ----------
   Control frames use the key `_`, which no game here uses, so they can ride
   the same channel as the game's own messages without a namespace fight.

     {_:"p", t}   ping     · answered with {_:"q", t}
     {_:"q", t}   pong     · carries the ping's stamp back, so RTT is honest
     {_:"bye"}    a clean goodbye, so the other side stops trying to heal

   States, in the order things go wrong:
     live    · heard from recently, round trip comfortable
     slow    · still there, but the round trip is long enough to feel
     stale   · nothing heard for a while; probably a tunnel
     healing · rebuilding the link, without asking anybody anything
     lost    · healing has been trying for a long time and hasn't got there
*/
function Vitals(o) {
  this.o = o || {};
  this.state = "off";
  this.rtt = 0;
  this.lastHeard = 0;
  this.attempt = 0;
  this.timer = null;
  this.healTimer = null;
  this.on = false;
}
Vitals.prototype._say = function (s, info) {
  if (this.state === s) return;
  this.state = s;
  if (this.o.change) try { this.o.change(s, info || {}); } catch (e) {}
};
Vitals.prototype.start = function () {
  var v = this;
  if (v.on) return v;
  v.on = true; v.attempt = 0; v.lastHeard = Date.now();
  v._say("live");
  v.timer = setInterval(function () { v.tick(); }, v.o.every || 2000);
  /* a phone that was asleep should not wait out a whole tick to notice */
  v._wake = function () { if (root.document && root.document.visibilityState === "visible") v.tick(true); };
  v._net = function () { v.tick(true); };
  if (root.document) root.document.addEventListener("visibilitychange", v._wake);
  if (root.addEventListener) root.addEventListener("online", v._net);
  return v;
};
Vitals.prototype.stop = function () {
  this.on = false;
  if (this.timer) { clearInterval(this.timer); this.timer = null; }
  if (this.healTimer) { clearTimeout(this.healTimer); this.healTimer = null; }
  if (root.document && this._wake) root.document.removeEventListener("visibilitychange", this._wake);
  if (root.removeEventListener && this._net) root.removeEventListener("online", this._net);
  this._say("off");
};
/* anything at all arriving counts as a sign of life — including a message
   that lands while we are busy rebuilding, which is proof we needn't be */
Vitals.prototype.heard = function () {
  this.lastHeard = Date.now();
  if (this.state === "stale" || this.state === "lost" || this.state === "healing") this.well();
};
/* hand every inbound message here first; true means "this was mine" */
Vitals.prototype.frame = function (msg) {
  if (!msg || typeof msg !== "object" || msg._ === undefined) { this.heard(); return false; }
  this.heard();
  if (msg._ === "p") { if (this.o.send) this.o.send({ _: "q", t: msg.t }); return true; }
  if (msg._ === "q") {
    if (msg.t) {
      var r = Date.now() - msg.t;
      this.rtt = this.rtt ? Math.round(this.rtt * 0.6 + r * 0.4) : r;
      this._say(this.rtt > (this.o.slowMs || 1200) ? "slow" : "live", { rtt: this.rtt });
    }
    return true;
  }
  if (msg._ === "bye") { this.o.bye && this.o.bye(); return true; }
  return false;   /* "_sync" and anything else a game invents is the game's */
};
Vitals.prototype.tick = function (urgent) {
  if (!this.on) return;
  var down = this.o.down ? this.o.down() : false;
  var quiet = Date.now() - this.lastHeard;
  if (!down) {
    if (this.o.send) this.o.send({ _: "p", t: Date.now() });
    if (quiet > (this.o.lostMs || 12000)) down = true;
    else if (quiet > (this.o.staleMs || 6000)) this._say("stale", { quiet: quiet });
  }
  if (down) this.mend(urgent);
};
/* the healing loop: patient, silent, and it never invents a new code */
Vitals.prototype.mend = function (now) {
  var v = this;
  if (!v.on || v.healTimer) return;
  if (v.state !== "healing" && v.state !== "lost") v._say("healing", { attempt: 1 });
  var base = v.o.backoffMs || 800, cap = v.o.maxBackoffMs || 10000;
  var wait = now ? Math.min(200, base) : Math.min(cap, base * Math.pow(2, Math.min(v.attempt, 4)));
  v.attempt++;
  if (v.attempt > (v.o.tries || 40)) { v._say("lost", { attempt: v.attempt }); v.attempt = 0; }
  v.healTimer = setTimeout(function () {
    v.healTimer = null;
    if (!v.on) return;
    var done = function (ok) {
      if (!v.on) return;
      if (ok) { v.attempt = 0; v.lastHeard = Date.now(); v._say("live"); }
      else v.mend(false);
    };
    var r;
    try { r = v.o.heal ? v.o.heal(v.attempt) : false; } catch (e) { r = false; }
    if (r && typeof r.then === "function") r.then(done, function () { done(false); });
    else done(!!r);
  }, wait);
};
/* the link came back by itself (a channel reopened) — call this and the
   healing loop stands down */
Vitals.prototype.well = function () {
  this.attempt = 0;
  this.lastHeard = Date.now();
  if (this.healTimer) { clearTimeout(this.healTimer); this.healTimer = null; }
  this._say("live");
};
Vitals.prototype.words = function () {
  switch (this.state) {
    case "live": return this.rtt ? "linked · " + this.rtt + "ms" : "linked";
    case "slow": return "linked, slowly · " + this.rtt + "ms";
    case "stale": return "quiet — waiting for them…";
    case "healing": return "the link dropped — putting it back…";
    case "lost": return "still trying to reach them…";
    default: return "not linked";
  }
};
Room.vitals = function (o) { return new Vitals(o); };
Room.Vitals = Vitals;

if (typeof module !== "undefined" && module.exports) module.exports = Room;
else root.Room = Room;
})(typeof self !== "undefined" ? self : this);
