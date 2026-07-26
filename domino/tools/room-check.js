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
