/* net-check.js — dev-only. Proves the parts of the link that can be
   proved without two browsers.

   The handshake itself needs real WebRTC and real cameras, and is
   exercised by hand across four phones. What *can* be pinned down here
   is the thing that would matter most if it were ever wrong:

   **the host must never put another player's bones on the wire.**

   In HIVEMIND everybody shares one colony and the snapshot is the whole
   state. Copying that here would send all four hands to all four
   phones, and the game would be over — not because of anything visible
   in the interface, but because the hands would be sitting in the
   message log of every device at the table. So the host sends each seat
   its own view, and this file takes the messages the host would
   actually send and checks them, bone by bone, against the hands it is
   supposed to be hiding.

   Run: node tools/net-check.js [--verbose]                            */
"use strict";

/* the module wants a browser; give it only what it touches */
if (typeof global.btoa !== "function") {
  global.btoa = function (s) { return Buffer.from(s, "binary").toString("base64"); };
  global.atob = function (s) { return Buffer.from(s, "base64").toString("binary"); };
}
global.location = { protocol: "https:", origin: "https://example.com", pathname: "/domino/" };
/* just enough of a peer connection for the seat bookkeeping to run;
   the handshake itself is exercised across real phones */
global.RTCPeerConnection = function () {
  this.iceGatheringState = "complete";
  this.localDescription = { sdp: "v=0\r\n" };
  this.connectionState = "new";
};
global.RTCPeerConnection.prototype.createDataChannel = function () {
  return { readyState: "connecting", send: function () {}, close: function () {} };
};
global.RTCPeerConnection.prototype.createOffer = function () { return Promise.resolve({ sdp: "v=0\r\n" }); };
global.RTCPeerConnection.prototype.setLocalDescription = function () { return Promise.resolve(); };
global.RTCPeerConnection.prototype.setRemoteDescription = function () { return Promise.resolve(); };
global.RTCPeerConnection.prototype.createAnswer = function () { return Promise.resolve({ sdp: "v=0\r\n" }); };
global.RTCPeerConnection.prototype.addEventListener = function () {};
global.RTCPeerConnection.prototype.close = function () {};

var R = require("../rules.js");
var Net = require("../net.js");

var VERBOSE = process.argv.indexOf("--verbose") >= 0;
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}
function done() {
  console.log("\n" + (fail === 0
    ? "the table keeps its secrets — " + pass + " checks passed"
    : fail + " of " + (pass + fail) + " checks FAILED"));
  if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
}

/* ---------- names are cleaned before they reach three other screens ---------- */
(function () {
  var nasty = [
    /* the angle brackets and quotes go, then it is cut to chip length —
       which is why this one ends mid-word rather than looking tidy */
    ['<img src=x onerror="alert(1)">', "img src=x oner"],
    ["</script><script>", "/scriptscript"],
    ["   spaced   out   ", "spaced out"],
    ["", "Jugador"],
    [null, "Jugador"],
    [undefined, "Jugador"],
    ["averyveryverylongnameindeed", "averyveryveryl"]
  ];
  var bad = [];
  nasty.forEach(function (n) {
    var got = Net.cleanName(n[0]);
    if (got !== n[1]) bad.push(JSON.stringify(n[0]) + " → " + JSON.stringify(got) + " (wanted " + JSON.stringify(n[1]) + ")");
    if (/[<>&"'`\\]/.test(got)) bad.push("markup survived in " + JSON.stringify(got));
  });
  ok("a name is cleaned before it goes on other people's screens", bad.length === 0, bad.join("; "));
  ok("and is never empty", Net.cleanName("<<<>>>").length > 0);
  ok("and never longer than a chip", Net.cleanName("x".repeat(200)).length <= 14);
})();

/* ---------- codes round-trip ---------- */
Net.encode({ v: 1, k: "invite", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n", meta: { host: "Chuy", seats: 3 } })
  .then(function (code) {
    ok("an invite encodes to a code", typeof code === "string" && /^DTAB[12]\./.test(code), code && code.slice(0, 12));
    ok("and it is this room's code, not the chess room's", code.indexOf("CHESS") < 0);
    return Net.decode(code).then(function (back) {
      ok("and decodes back to the same offer", back && back.k === "invite" && back.sdp.indexOf("v=0") === 0);
      ok("carrying the host's name", back && back.meta && back.meta.host === "Chuy");
      return code;
    });
  })
  .then(function (code) {
    /* codes arrive mangled — pasted mid-sentence, wrapped, as a link */
    var manglings = [
      ["as a link", "https://example.com/domino/#join=" + code],
      ["in a sentence", "here you go " + code + " see you in a minute"],
      ["wrapped", code.slice(0, 50) + "\n" + code.slice(50)],
      ["with spaces", code.slice(0, 30) + " " + code.slice(30)]
    ];
    return Promise.all(manglings.map(function (m) {
      return Net.decode(m[1]).then(function (b) { return { name: m[0], ok: !!(b && b.k === "invite") }; });
    })).then(function (res) {
      var bad = res.filter(function (r) { return !r.ok; }).map(function (r) { return r.name; });
      ok("a code still reads when it arrives mangled", bad.length === 0, bad.join(", "));
    });
  })
  .then(function () {
    var junk = ["", null, undefined, "not a code", "DTAB1.", "DTAB1.!!!!", "DTAB9." + "A".repeat(100),
                "CHESS1.abcdef", "DTAB2." + "A".repeat(4000)];
    return Promise.all(junk.map(function (j) {
      return Net.decode(j).then(function (b) { return b; }, function () { return "threw"; });
    })).then(function (res) {
      ok("junk never decodes into something", res.every(function (r) { return r === null || r === undefined; }),
         JSON.stringify(res.filter(function (r) { return r; })).slice(0, 120));
      ok("and never throws", res.indexOf("threw") < 0);
    });
  })
  .then(function () {
    ok("an invite travels as a tappable link on the web", Net.url("DTAB1.xyz").indexOf("https://") === 0);
    ok("with the code in the fragment", Net.url("DTAB1.xyz").indexOf("#join=DTAB1.xyz") > 0);
  })
  .then(secrecy)
  .then(done)
  .catch(function (e) { console.log("FAIL  the checks themselves threw — " + e.message); process.exit(1); });

/* ---------- the one that matters ---------- */
function secrecy() {
  /* stand a fake table up: the host in seat 0, three guests wired to
     channels that record what they are sent rather than sending it */
  var sent = { 1: [], 2: [], 3: [] };
  function fakePeer(seat) {
    return {
      seat: seat, claimed: true, name: "P" + seat,
      dc: { readyState: "open", send: function (s) { sent[seat].push(JSON.parse(s)); } },
      pc: null
    };
  }
  Net.role = "host";
  Net.seat = 0;
  Net.peers = [fakePeer(1), fakePeer(2), fakePeer(3)];

  var leaks = 0, missing = 0, wrongSeat = 0, hands = 0, checked = 0;

  for (var g = 0; g < 200; g++) {
    var m = R.newMatch({ seed: g * 2654435761 + 5 });
    var st = R.dealHand(m), rand = R.rng(g + 3), guard = 0;

    while (!st.over && guard++ < 200) {
      sent[1] = []; sent[2] = []; sent[3] = [];
      Net.dealViews(st, { turn: st.turn });

      for (var seat = 1; seat <= 3; seat++) {
        var msgs = sent[seat];
        if (msgs.length !== 1) { missing++; continue; }
        var v = msgs[0].view;
        checked++;
        if (!v) { missing++; continue; }
        if (v.seat !== seat) wrongSeat++;

        /* it holds this seat's own bones, exactly */
        if (v.hand.join() !== st.hands[seat].slice().join()) hands++;

        /* The secrecy property, stated exactly.

           It is tempting to scan the wire for other people's bones, and
           that is what this check did first — but it fires on `unseen`,
           the list of bones not visible from this chair, and gets 52,000
           "leaks" that are nothing of the kind. Which bones are still
           out is public: anybody at a real table knows it, because it is
           twenty-eight minus their own hand minus what is lying face-up.

           The secret is not *which* bones are out. It is *how they are
           split between the other three hands*. So the test is a
           permutation test: shuffle the other three hands among
           themselves, keeping each hand's size, and rebuild the view. If
           the message changes by so much as a byte, it encodes something
           about the split, and that something is a leak. If it is
           identical for every rearrangement, the message cannot possibly
           say who holds what — no scanning required, and no way for a
           future field to sneak past it. */
        var wire = JSON.stringify(msgs[0]);
        var pool = [], sizes = [], s2;
        for (s2 = 0; s2 < 4; s2++) {
          sizes.push(st.hands[s2].length);
          if (s2 !== seat) pool = pool.concat(st.hands[s2]);
        }
        for (var trial = 0; trial < 3; trial++) {
          for (var z = pool.length - 1; z > 0; z--) {
            var j = Math.floor(rand() * (z + 1)), tmp = pool[z]; pool[z] = pool[j]; pool[j] = tmp;
          }
          var alt = { hands: [], line: st.line, left: st.left, right: st.right,
                      voids: st.voids, turn: st.turn, passes: st.passes,
                      rules: st.rules, mustLeadMula: st.mustLeadMula };
          var at = 0;
          for (s2 = 0; s2 < 4; s2++) {
            if (s2 === seat) { alt.hands[s2] = st.hands[s2].slice(); }
            else { alt.hands[s2] = pool.slice(at, at + sizes[s2]); at += sizes[s2]; }
          }
          var altWire = JSON.stringify({ k: "view", view: R.publicView(alt, seat), turn: st.turn });
          if (altWire !== wire) leaks++;
        }

        /* the counts are public and must be right */
        for (s2 = 0; s2 < 4; s2++) if (v.counts[s2] !== st.hands[s2].length) missing++;
      }

      if (!R.canPlay(st, st.turn)) { R.pass(st); continue; }
      var mv = R.moves(st);
      R.play(st, mv[Math.floor(rand() * mv.length) % mv.length]);
      if (st.error) break;
    }
  }

  ok("every seat is sent its own view and only its own", missing === 0, missing + " malformed");
  ok("addressed to the right chair", wrongSeat === 0, wrongSeat + " misaddressed");
  ok("carrying exactly that player's bones", hands === 0, hands + " wrong hands");
  ok("and saying nothing whatever about how the rest are split",
     leaks === 0, leaks + " views changed when the other hands were rearranged");
  console.log("      " + checked + " views checked across 200 hands, each against 3 rearrangements");

  /* a guest cannot deal views at all */
  Net.role = "guest";
  ok("a guest cannot deal views", Net.dealViews({}) === 0);
  Net.role = "host";

  /* the roster hides nothing it should not, but also carries no bones */
  Net.startHosting("Chuy");
  ok("hosting seats you first", Net.seat === 0 && Net.roster[0].name === "Chuy");
  ok("with three chairs waiting", Net.seatsFree() === 3);
  ok("and the empty chairs played by the house", Net.roster[1].bot === true);
  ok("the roster never carries bones", JSON.stringify(Net.roster).indexOf("hand") < 0);
  Net.close();
  ok("closing puts everything back", Net.role === "off" && Net.peers.length === 0);
  return Promise.resolve();
}
