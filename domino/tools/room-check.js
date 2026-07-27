/* room-check.js — dev-only. Opens the actual room in an actual browser
   and plays it.

   Every other check in this folder tests a module in isolation, in
   node, where there is no canvas and no WebGL and nothing can be
   clicked. They are the checks that catch wrong *thinking*. This one
   catches the other kind: a typo in an id, a listener wired to a button
   that isn't there, a shader that will not compile, a settings pane
   that throws the moment it opens.

   It drives headless Chromium through the things a person does in the
   first two minutes — start a match, tap a bone, play it, ask for a
   hint, open the counting panel, change the colours, switch to 2D and
   back, open the join door — and fails on any console error at all.

   Needs `playwright-core`; the browser is already on the machine. If
   playwright is missing it says so and exits 0, so the check is a bonus
   rather than a barrier on a machine that hasn't got it.

   Run: node tools/room-check.js [--head] [--verbose]                  */
"use strict";

var path = require("path");
var http = require("http");
var fs = require("fs");

var VERBOSE = process.argv.indexOf("--verbose") >= 0;
var pass = 0, fail = 0, failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

var pw;
try { pw = require("playwright-core"); }
catch (e) {
  console.log("playwright-core is not installed — skipping the browser check.");
  console.log("  npm i --no-save playwright-core");
  process.exit(0);
}

var CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
if (!fs.existsSync(CHROME)) {
  var alt = ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"];
  CHROME = alt.filter(function (p) { return fs.existsSync(p); })[0] || null;
}
if (!CHROME) { console.log("no chromium on this machine — skipping the browser check."); process.exit(0); }

var ROOT = path.join(__dirname, "..");
var TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
              ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css" };

function serve() {
  return new Promise(function (res) {
    var srv = http.createServer(function (req, rep) {
      var f = req.url.split("?")[0];
      if (f === "/") f = "/index.html";
      var p = path.join(ROOT, path.normalize(f).replace(/^(\.\.[/\\])+/, ""));
      fs.readFile(p, function (err, buf) {
        if (err) { rep.writeHead(404); rep.end("no"); return; }
        rep.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
        rep.end(buf);
      });
    });
    srv.listen(0, "127.0.0.1", function () { res(srv); });
  });
}

/* a canvas that is one flat colour has not drawn anything */
var VARIED = "(() => { const c = document.getElementById('table');" +
  "const g = c.getContext('webgl') || c.getContext('2d');" +
  "let px; if (g && g.readPixels) { px = new Uint8Array(c.width*c.height*4); g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,px); }" +
  "else { px = c.getContext('2d').getImageData(0,0,c.width,c.height).data; }" +
  "const seen = new Set(); for (let i=0;i<px.length;i+=4*97) seen.add(px[i]+','+px[i+1]+','+px[i+2]);" +
  "return seen.size; })()";

(async function main() {
  var srv = await serve();
  var port = srv.address().port;
  var base = "http://127.0.0.1:" + port + "/";

  var browser = await pw.chromium.launch({
    executablePath: CHROME,
    headless: process.argv.indexOf("--head") < 0,
    args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"]
  });
  var ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  var page = await ctx.newPage();

  var errors = [];
  page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", function (e) { errors.push("pageerror: " + e.message); });

  await page.goto(base, { waitUntil: "networkidle" });

  /* ---------- it boots ---------- */
  ok("the room loads without a console error", errors.length === 0, errors.slice(0, 3).join(" | "));
  ok("the splash is up", await page.isVisible("#splash"));
  var mods = await page.evaluate("[!!window.Rules,!!window.Layout,!!window.AI,!!window.Coach,!!window.Skins,!!window.Gfx2D,!!window.Gfx3D,!!window.Net].every(Boolean)");
  ok("every module is on the page", mods === true);

  /* ---------- a match starts ---------- */
  await page.click("#goSolo");
  await page.waitForTimeout(1700);
  ok("the splash gets out of the way", !(await page.isVisible("#splash")));

  var colours = await page.evaluate(VARIED);
  ok("the table actually draws something", colours > 4, colours + " distinct samples");

  var renderer = await page.evaluate("window.__dt().gfx.kind");
  ok("it came up in 3D", renderer === "3d", "got " + renderer);


  var st = await page.evaluate("(()=>{const g=window.__dt().G;return {seat:g.mySeat,hand:g.view.hand.length,turn:g.view.turn,line:g.view.line.length};})()");
  ok("you have seven bones", st.hand === 7, "got " + st.hand);
  ok("and a seat at the table", st.seat === 0);

  /* the first hand of a match is opened by the 6|6 */
  var opener = await page.evaluate("(()=>{const g=window.__dt().G;return g.st.mustLeadMula;})()");
  ok("the first hand must be opened with the mula de seis", opener === true);

  /* ---------- playing ---------- */
  /* wait for our turn — the opener may be one of the others */
  var waited = 0;
  while (waited < 12000) {
    var mine = await page.evaluate("window.__dt().G.view.turn === window.__dt().G.mySeat");
    if (mine) break;
    await page.waitForTimeout(400); waited += 400;
  }
  ok("the turn comes round to you", waited < 12000, "waited " + waited + "ms");

  var before = await page.evaluate("window.__dt().G.view.hand.length");
  /* tap the first playable bone where it actually is on screen */
  var spot = await page.evaluate(
    "(()=>{const d=window.__dt(),s=d.scene(),L=window.Layout;" +
    "const r=L.handRow(s.hand.length, d.gfx.w, d.gfx.h, {pad:10});" +
    "for(let i=0;i<s.hand.length;i++){ if(s.playable[s.hand[i]]) return {x:r[i].x+r[i].w/2,y:r[i].y+r[i].h/2}; }" +
    "return null;})()");
  ok("at least one bone in hand can be played", !!spot);
  if (spot) {
    var box = await page.evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return {x:r.left,y:r.top};})()");
    await page.mouse.click(box.x + spot.x, box.y + spot.y);
    await page.waitForTimeout(900);
    var after = await page.evaluate("window.__dt().G.view.hand.length");
    var line = await page.evaluate("window.__dt().G.view.line.length");
    /* either it went straight down, or it was lifted for a choice of end */
    var lifted = await page.evaluate("window.__dt().G.sel !== null");
    ok("tapping a bone plays it or lifts it", after === before - 1 || lifted,
       "hand " + before + "→" + after + ", line " + line + ", lifted " + lifted);
  }

  /* let the machines play a while — this is where a bad rollout or a
     bad layout would throw */
  await page.waitForTimeout(6000);
  var played = await page.evaluate("window.__dt().G.view.line.length");
  ok("the hand plays on by itself", played >= 2, played + " bones down");
  ok("and nothing has thrown", errors.length === 0, errors.slice(0, 3).join(" | "));

  /* ---------- the bones have sides ----------
     "There is more than one colour on the canvas" is the check that let
     a table of flat white cards ship twice. A bone drawn without its
     sides still passes it, still passes every count of triangles, and
     still looks like a domino seen from directly overhead — the fault
     only exists at the angle a player actually sees.

     The obvious next test is a histogram: collect the bone-coloured
     pixels and look for a spread of brightness. It does not work, and
     it is worth saying why, because it looks like it should. Flattening
     the shader so every face takes the top face's light — a literal
     flat card — leaves that check green. The pips are drilled, so their
     bores and their antialiased rims supply a full ramp of tone inside
     the face on their own. The spread was never coming from the sides.

     So project instead of sampling blind. For each bone take the centre
     of its top face and the midpoint of whichever of its four walls
     most faces the camera, push both through the same proj·view the
     frame was drawn with, and read those two pixels. That compares the
     two surfaces that must differ, and nothing else. */
  /* let anything mid-slam land first — a bone in the air is not where
     the resting layout says it is */
  await page.waitForFunction("!window.__dt().scene().anim", null, { timeout: 4000 }).catch(function () {});
  var sides = await page.evaluate(
    "(() => {" +
    "const d = window.__dt(), g = d.gfx, s = d.scene(), cam = g.lastCam, L = window.Layout;" +
    "if (!cam) return {err:'no camera'};" +
    "const hx = L.LEN/2, hy = L.WID/2, hz = 0.17;" +
    "const cv = document.getElementById('table'), gl = cv.getContext('webgl');" +
    "const px = new Uint8Array(cv.width*cv.height*4);" +
    "gl.readPixels(0,0,cv.width,cv.height,gl.RGBA,gl.UNSIGNED_BYTE,px);" +
    "const mv = (m,v) => [0,1,2,3].map(r => m[r]*v[0]+m[4+r]*v[1]+m[8+r]*v[2]+m[12+r]*v[3]);" +
    "function lum(p){" +
    "  const c = mv(cam.proj, mv(cam.view, [p[0],p[1],p[2],1]));" +
    "  if (c[3] <= 0) return null;" +
    /* readPixels counts rows from the bottom, which is also which way
       NDC y runs, so no flip is needed here */
    "  const X = Math.round((c[0]/c[3]*0.5+0.5)*cv.width), Y = Math.round((c[1]/c[3]*0.5+0.5)*cv.height);" +
    "  if (X<2||Y<2||X>=cv.width-2||Y>=cv.height-2) return null;" +
    "  let a=0; for(let j=-1;j<=1;j++) for(let i=-1;i<=1;i++){" +
    "    const k=((Y+j)*cv.width+(X+i))*4; a+=0.299*px[k]+0.587*px[k+1]+0.114*px[k+2]; }" +
    "  return a/9; }" +
    "const out=[];" +
    "for (const b of s.table.bones){" +
    "  const r=b.rot*Math.PI/180, C=Math.cos(r), S=Math.sin(r);" +
    "  const to=(lx,ly,lz)=>[b.x+lx*C-ly*S, b.y+lx*S+ly*C, lz];" +
    "  const top=lum(to(0,0,hz));" +
    "  let best=null,bd=-2;" +
    "  for (const w of [[0,-hy,0,-1],[0,hy,0,1],[-hx,0,-1,0],[hx,0,1,0]]){" +
    "    const n=[w[2]*C-w[3]*S, w[2]*S+w[3]*C, 0], p=to(w[0],w[1],-0.03);" +
    "    const dv=[cam.eye[0]-p[0],cam.eye[1]-p[1],cam.eye[2]-p[2]];" +
    "    const dd=(n[0]*dv[0]+n[1]*dv[1]+n[2]*dv[2])/Math.hypot(dv[0],dv[1],dv[2]);" +
    "    if(dd>bd){bd=dd;best=p;} }" +
    "  const side=lum(best);" +
    "  if(top&&side) out.push(+(side/top).toFixed(3)); }" +
    "return {ratios:out}; })()");
  ok("the bones can be measured", !!(sides.ratios && sides.ratios.length),
     sides.err || (sides.ratios || []).length + " bones");
  if (sides.ratios && sides.ratios.length) {
    /* The *best* wall on the table, not the average of them and not one
       chosen bone. Two things push a reading up towards 1.0 without
       anything being wrong: a bone in the middle of a folded line can
       have all four walls hidden behind neighbours, and a bone caught
       mid-slam is not where the resting layout says it is, so both
       samples land on felt. Both are noise in one direction only. A
       flat card cannot produce a *low* reading, so taking the minimum
       is immune to all of it — the check asks whether anywhere on this
       table a bone shows a wall clearly darker than its own face, which
       is exactly the thing that was missing.

       The real table reads 0.71-0.83 where a wall is visible. A shader
       flattened so every surface takes the top face's light could not
       get a single bone under 1.28, because the bevel then catches
       *more* light than the face does. Nowhere near each other. */
    var best = Math.min.apply(null, sides.ratios);
    ok("a bone is a solid, not a flat card — the wall facing you is darker than the face",
       best < 0.85,
       "best wall reads " + (best * 100).toFixed(0) + "% of its own face, across " +
       sides.ratios.length + " bones");
  }

  /* ---------- the table has a pulse ----------
     Three machines deciding as fast as they can is unreadable: bones
     appear and you work out backwards who put them there. A turn is
     three beats now — the seat says it is thinking, the play lands, and
     there is a pause to look at it before the next one starts. Measured
     rather than assumed, because a pace constant nobody reads is worth
     nothing. */
  var beats = await page.evaluate(`(async () => {
    const d = window.__dt();
    const stamps = [];
    let last = d.G.view.line.length;
    const t0 = performance.now();
    while (performance.now() - t0 < 14000 && stamps.length < 4) {
      await new Promise(r => setTimeout(r, 30));
      /* Keep the hand moving. It is the player's turn a quarter of the
         time and the room is quite right to sit there waiting — but a
         stalled window measures nothing, and the first version of this
         check reported "0 plays seen" for exactly that reason. */
      const g = d.G;
      if (g.view && g.view.turn === g.mySeat && !g.busy) {
        const mv = window.AI.movesFor(g.view);
        if (mv.length) d.tryPlay(mv[0].tile, mv[0].end);
        else d.doPass(g.mySeat);
      }
      const n = d.G.view.line.length;
      if (n > last) { stamps.push(performance.now()); last = n; }
    }
    const gaps = [];
    for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i-1]);
    return { gaps: gaps, n: stamps.length };
  })()`);

  ok("bones keep going down while you watch", beats.n >= 2, beats.n + " plays seen");
  if (beats.gaps.length) {
    var quickest = Math.min.apply(null, beats.gaps);
    /* relaxed is 900ms of thinking plus up to 700 of spread plus 750 to
       settle, so the tightest honest gap is about 1.6s; under a second
       means the beats are not being waited on at all */
    ok("and never faster than a person could follow", quickest > 950,
       "quickest gap " + Math.round(quickest) + "ms");
    console.log("      gaps between plays: " +
                beats.gaps.map(function (g) { return Math.round(g) + "ms"; }).join(", "));
  }

  /* and the table says who is doing what */
  var sawThinking = await page.evaluate(`(async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 8000) {
      const el = document.getElementById('lastPlay');
      if (el && /thinking/.test(el.className)) return el.textContent;
      await new Promise(r => setTimeout(r, 40));
    }
    return null;
  })()`);
  ok("it names whoever is deciding", !!sawThinking && /thinking/i.test(sawThinking), sawThinking);
  /* and then what they did — waited for, not snatched, because the
     caption is showing "…is thinking" for a good second either side of
     the play and reading it at the wrong instant proves nothing */
  var sawPlay = await page.evaluate(`(async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 8000) {
      const t = document.getElementById('lastPlay').textContent || "";
      if (/played the|paso/i.test(t)) return t;
      await new Promise(r => setTimeout(r, 40));
    }
    return document.getElementById('lastPlay').textContent;
  })()`);
  ok("and says what they did", /played the \d\|\d|paso/i.test(sawPlay || ""), sawPlay);

  /* ---------- a tap on the 3D table lands where it looks ----------
     `pointOnTable` inverts the view-projection to turn a pixel back
     into a place on the felt. It went untested at first, and it was
     wrong the whole time: the matrix helper multiplied its arguments in
     the reverse order, which the drawing never noticed (the shader
     multiplies proj and view itself) but which sent every tap on an end
     to the wrong spot. Nothing on screen looked amiss. */
  var aim = await page.evaluate(
    "(()=>{const d=window.__dt(); if(d.gfx.kind!=='3d') return null;" +
    "const c=d.gfx.lastCam; if(!c) return null;" +
    "const at=(fx,fy)=>{const p=d.gfx.pointOnTable(d.gfx.w*fx, d.gfx.h*fy); return p?[p.x,p.y]:null;};" +
    "return {mid:at(0.5,0.5), left:at(0.2,0.5), right:at(0.8,0.5), up:at(0.5,0.3)," +
    " cx:c.cx, cy:c.cy};})()");
  ok("the middle of the screen unprojects onto the table", !!(aim && aim.mid));
  if (aim && aim.mid && aim.left && aim.right && aim.up) {
    ok("and lands where the camera is looking",
       Math.hypot(aim.mid[0] - aim.cx, aim.mid[1] - aim.cy) < 1.5,
       "off by " + Math.hypot(aim.mid[0] - aim.cx, aim.mid[1] - aim.cy).toFixed(2));

    /* The check that actually bites. A reversed matrix product does not
       shift the answer a little — it collapses it, and *every* pixel
       comes back as the same point on the felt. That is invisible to a
       tolerance test around the centre (the collapsed point sits near
       the middle anyway, which is how the first version of this check
       passed against the bug it was written for). Distinct pixels
       landing in distinct places is the property that cannot survive
       it. */
    var spreadX = Math.abs(aim.right[0] - aim.left[0]);
    var spreadY = Math.abs(aim.up[1] - aim.mid[1]);
    ok("and taps to the left and right land apart", spreadX > 2,
       "only " + spreadX.toFixed(2) + " apart");
    ok("as do taps nearer and further up the table", spreadY > 0.5,
       "only " + spreadY.toFixed(2) + " apart");
  }

  /* ---------- the panels ---------- */
  await page.click("#btnHint");
  await page.waitForTimeout(300);
  var hint = await page.textContent("#chuySay");
  ok("the hint says something", !!hint && hint.length > 5, hint);

  await page.click("#btnCount");
  await page.waitForTimeout(300);
  ok("the counting panel opens", await page.isVisible("#ovCount"));
  var cells = await page.evaluate("document.querySelectorAll('#countBody .cs').length");
  ok("with a column for all seven suits", cells === 7, cells + "");
  await page.click("[data-close=ovCount]");
  await page.waitForTimeout(200);
  ok("and closes again", !(await page.isVisible("#ovCount")));

  await page.click("#btnMenu");
  await page.waitForTimeout(250);
  await page.click("#mLook");
  await page.waitForTimeout(500);
  ok("the colours pane opens", await page.isVisible("#ovLook"));
  var tiles = await page.evaluate("document.querySelectorAll('#gallery .tile').length");
  ok("the gallery shows the house tables", tiles >= 8, tiles + "");
  var swatches = await page.evaluate("document.querySelectorAll('#editor input[type=color]').length");
  ok("and every colour can be changed", swatches === 10, swatches + "");
  var sliders = await page.evaluate("document.querySelectorAll('#editor input[type=range]').length");
  ok("with sliders for the rest", sliders === 4, sliders + "");

  /* pick a different table and check it reaches the renderer */
  await page.click("#gallery .tile:nth-child(4)");
  await page.waitForTimeout(400);
  var felt = await page.evaluate("window.__dt().P.skin.table.felt");
  ok("choosing a table changes the felt", /^#[0-9a-f]{6}$/.test(felt), felt);
  await page.click("[data-close=ovLook]");
  await page.waitForTimeout(200);

  /* ---------- 2D and back ---------- */
  await page.click("#btnMenu");
  await page.waitForTimeout(200);
  await page.click("#mView");
  await page.waitForTimeout(700);
  var kind2 = await page.evaluate("window.__dt().gfx.kind");
  ok("it switches to 2D mid-hand", kind2 === "2d", kind2);
  var flat = await page.evaluate(VARIED);
  ok("and the flat table draws too", flat > 4, flat + " distinct samples");
  var kept = await page.evaluate("window.__dt().G.view.line.length");
  ok("without losing the hand", kept >= played, kept + " vs " + played);

  await page.click("#btnMenu");
  await page.waitForTimeout(200);
  await page.click("#mView");
  await page.waitForTimeout(700);
  ok("and back to 3D", (await page.evaluate("window.__dt().gfx.kind")) === "3d");

  /* ---------- the join door ---------- */
  await page.click("#btnMenu");
  await page.waitForTimeout(200);
  await page.click("#mParty");
  await page.waitForTimeout(400);
  ok("the join door opens", await page.isVisible("#ovParty"));
  ok("and asks for a name first", await page.isVisible("#pName"));
  await page.click("[data-close=ovParty]");

  /* ---------- house rules ---------- */
  await page.click("#btnMenu");
  await page.waitForTimeout(200);
  await page.click("#mRules");
  await page.waitForTimeout(300);
  var opts = await page.evaluate("document.querySelectorAll('#rulesForm [data-rk]').length");
  ok("the house rules are all offered", opts >= 14, opts + " choices");
  await page.click("[data-rk=target][data-rv='50']");
  await page.waitForTimeout(300);
  var tgt = await page.evaluate("window.__dt().P.rules.target");
  ok("and picking one takes", tgt === 50, tgt + "");

  /* Every row must show what is currently chosen. Three of these rows do
     not live in P.rules — level and pace are preferences on P itself —
     and a row that reads the wrong place still renders perfectly, just
     with nothing lit up. Counting the lit buttons is what catches it:
     one per row, no more and no fewer. */
  var lit = await page.evaluate(
    "(function(){var rows={},b=document.querySelectorAll('#rulesForm [data-rk]');" +
    "for(var i=0;i<b.length;i++){var k=b[i].getAttribute('data-rk');" +
    "rows[k]=(rows[k]||0)+(b[i].classList.contains('on')?1:0);}return rows;})()");
  var keys = Object.keys(lit), everyRowLit = keys.length > 0;
  for (var ri = 0; ri < keys.length; ri++) if (lit[keys[ri]] !== 1) everyRowLit = false;
  ok("every rule row shows its current setting", everyRowLit,
    keys.map(function (k) { return k + "=" + lit[k]; }).join(" "));

  await page.click("[data-rk=pace][data-rv='quick']");
  await page.waitForTimeout(300);
  var pc = await page.evaluate("window.__dt().P.pace");
  ok("the pace can be changed", pc === "quick", pc + "");
  await page.click("[data-rk=pace][data-rv='relaxed']");
  await page.waitForTimeout(200);
  await page.click("[data-close=ovRules]");

  /* ---------- how it's played ---------- */
  await page.click("#btnMenu");
  await page.waitForTimeout(200);
  await page.click("#mLearn");
  await page.waitForTimeout(300);
  var cards = await page.evaluate("document.querySelectorAll('#lessons .opt').length");
  ok("the short course is there", cards === 5, cards + " cards");
  await page.click("[data-close=ovLearn]");

  /* ---------- it survives being resized ---------- */
  await page.setViewportSize({ width: 820, height: 420 });
  await page.waitForTimeout(600);
  var wide = await page.evaluate(VARIED);
  ok("it redraws on a landscape screen", wide > 4, wide + "");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(600);
  var small = await page.evaluate(VARIED);
  ok("and on a very small one", small > 4, small + "");

  /* ---------- what it remembers ---------- */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  var saved = await page.evaluate("(()=>{const raw=JSON.parse(localStorage.getItem('dominotable.v1')||'null');return raw&&raw.rules?raw.rules.target:0;})()");
  ok("the house rules survive a reload", saved === 50, saved + "");

  ok("no console error in the whole session", errors.length === 0,
     errors.slice(0, 4).join(" | "));

  await browser.close();
  srv.close();

  console.log("\n" + (fail === 0
    ? "the room opens and plays — " + pass + " checks passed"
    : fail + " of " + (pass + fail) + " checks FAILED"));
  if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
})().catch(function (e) {
  console.log("FAIL  the browser check itself threw — " + e.message);
  process.exit(1);
});
