/* room-check.js — dev-only. Opens the room in a real browser and walks it.

   The node checks prove the file formats and the geometry. They cannot
   see a shader that will not compile, an atlas sampled as black, a
   control scheme wired to a button that isn't there, or a world that
   meshes to nothing. This does.

   It also does the one end-to-end thing that matters most: it **builds
   a region file in memory, hands it to the page as a dropped file, and
   checks the world that comes out the other side** — the same path a
   real Minecraft save takes, exercised without needing one.

   Needs playwright-core; exits 0 with a note if it is not installed.

   Run: node tools/room-check.js [--head] [--verbose]                  */
"use strict";
var path = require("path"), http = require("http"), fs = require("fs"), zlib = require("zlib");

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
var CHROME = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
              "/opt/pw-browsers/chromium/chrome-linux/chrome",
              "/usr/bin/chromium", "/usr/bin/google-chrome"]
  .filter(function (p) { return fs.existsSync(p); })[0];
if (!CHROME) { console.log("no chromium here — skipping the browser check."); process.exit(0); }

var ROOT = path.join(__dirname, "..");
var TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
              ".webmanifest": "application/manifest+json", ".png": "image/png" };
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

/* ---------- a real region file, built here ----------
   Same encoder the anvil check uses, so what the page receives is a
   genuine .mca and not a convenient stub. */
var W = require("./nbt-write.js");
function packNoSpan(idx, bits) {
  var per = Math.floor(64 / bits);
  var longs = new Array(Math.ceil(idx.length / per)).fill(0n);
  for (var i = 0; i < idx.length; i++) {
    var v = BigInt(idx[i]) & ((1n << BigInt(bits)) - 1n);
    longs[Math.floor(i / per)] = BigInt.asUintN(64,
      longs[Math.floor(i / per)] | (v << BigInt((i % per) * bits)));
  }
  return longs.map(function (l) { return BigInt.asIntN(64, l); });
}
function makeRegion() {
  /* one chunk: the bottom half stone, a floor of oak planks, and a
     bookshelf wall — recognisable when it renders */
  var idx = new Uint16Array(4096);
  for (var i = 0; i < 4096; i++) {
    var y = i >> 8, x = i & 15, z = (i >> 4) & 15;
    idx[i] = y < 4 ? 1 : (y === 4 ? 2 : (y < 9 && (x === 0 || z === 0) ? 3 : 0));
  }
  var doc = W.doc(10, "", [
    [3, "DataVersion", 3465], [3, "xPos", 0], [3, "zPos", 0],
    [9, "sections", { itemType: 10, items: [[
      [1, "Y", 0],
      [10, "block_states", [
        [9, "palette", { itemType: 10, items: [
          [[8, "Name", "minecraft:air"]], [[8, "Name", "minecraft:stone"]],
          [[8, "Name", "minecraft:oak_planks"]], [[8, "Name", "minecraft:bookshelf"]]
        ] }],
        [12, "data", packNoSpan(idx, 4).map(String)]
      ]]
    ]] }]
  ]);
  var payload = zlib.deflateSync(Buffer.from(doc));
  var head = Buffer.alloc(5);
  head.writeUInt32BE(payload.length + 1, 0);
  head.writeUInt8(2, 4);
  var block = Buffer.concat([head, payload]);
  var pad = (4096 - (block.length % 4096)) % 4096;
  var full = Buffer.concat([block, Buffer.alloc(pad)]);
  var loc = Buffer.alloc(4096), ts = Buffer.alloc(4096);
  loc.writeUInt32BE((2 << 8) | (full.length / 4096), 0);
  ts.writeUInt32BE(1700000000, 0);
  return Buffer.concat([loc, ts, full]);
}

/* a canvas that is one flat colour has drawn nothing */
var VARIED = "(() => { const c = document.getElementById('view');" +
  "const g = c.getContext('webgl'); const px = new Uint8Array(c.width*c.height*4);" +
  "g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,px);" +
  "const s = new Set(); for (let i=0;i<px.length;i+=4*131) s.add(px[i]+','+px[i+1]+','+px[i+2]);" +
  "return s.size; })()";

(async function main() {
  var srv = await serve();
  var base = "http://127.0.0.1:" + srv.address().port + "/";
  var browser = await pw.chromium.launch({
    executablePath: CHROME,
    headless: process.argv.indexOf("--head") < 0,
    args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"]
  });
  var ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
  var page = await ctx.newPage();
  var errors = [];
  page.on("console", function (m) { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", function (e) { errors.push("pageerror: " + e.message); });

  await page.goto(base, { waitUntil: "networkidle" });
  ok("the room loads clean", errors.length === 0, errors.slice(0, 3).join(" | "));
  var mods = await page.evaluate("[!!window.NBT,!!window.Anvil,!!window.Blocks,!!window.Mesher,!!window.WorldLib,!!window.Gfx].every(Boolean)");
  ok("every module is on the page", mods === true);
  ok("WebGL came up", await page.evaluate("!!(window.__rr && window.__rr().G.gfx && window.__rr().G.gfx.ok)"));

  /* ---------- the tribute build ---------- */
  await page.click("#goWalk");
  await page.waitForFunction("window.__rr().G.running === true", null, { timeout: 30000 });
  await page.waitForTimeout(700);

  var st = await page.evaluate("(()=>{const g=window.__rr().G;return {blocks:g.world.count,tris:g.tris,pos:g.pos.map(Math.round),title:g.title};})()");
  ok("the library is built", st.blocks > 5000, st.blocks + " blocks");
  ok("and meshed onto the screen", st.tris > 500, st.tris + " triangles");
  ok("with the player standing in it", Math.abs(st.pos[1]) < 60, JSON.stringify(st.pos));

  var colours = await page.evaluate(VARIED);
  ok("the world actually draws", colours > 6, colours + " distinct samples");
  /* the black-atlas failure: a world that renders but is entirely dark
     passes a naive "did anything draw" test */
  var bright = await page.evaluate("(() => { const c=document.getElementById('view');" +
    "const g=c.getContext('webgl'); const px=new Uint8Array(c.width*c.height*4);" +
    "g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,px);" +
    "let lit=0,n=0; for(let i=0;i<px.length;i+=4*97){n++; if(px[i]+px[i+1]+px[i+2] > 120) lit++;}" +
    "return lit/n; })()");
  ok("and is lit, not a black atlas", bright > 0.25, (bright * 100).toFixed(0) + "% of samples lit");

  /* ---------- walking ---------- */
  var before = await page.evaluate("window.__rr().G.pos.slice()");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(700);
  await page.keyboard.up("KeyW");
  var after = await page.evaluate("window.__rr().G.pos.slice()");
  var moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
  ok("pressing W walks", moved > 0.4, "moved " + moved.toFixed(2));

  /* and does not walk through walls: aim at a wall and shove */
  await page.evaluate("(()=>{const g=window.__rr().G; g.pos=[0,2,20]; g.yaw=Math.PI/2; g.fly=false;})()");
  var wallBefore = await page.evaluate("window.__rr().G.pos.slice()");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1600);
  await page.keyboard.up("KeyW");
  var wallAfter = await page.evaluate("window.__rr().G.pos.slice()");
  ok("but not through the wall of the hall", Math.abs(wallAfter[0]) < 24,
     "ended at x=" + wallAfter[0].toFixed(1));

  /* flight, since a library is worth seeing from the gallery */
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(120);
  ok("F toggles flight", await page.evaluate("window.__rr().G.fly === true"));
  await page.keyboard.press("KeyF");

  /* ---------- a real region file, dropped in ----------
     The whole path: bytes → NBT → Anvil → palette → world → mesh. */
  var region = makeRegion();
  await page.click("#btnWorld");
  await page.waitForTimeout(300);
  ok("the load door opens", await page.isVisible("#ovWorld"));

  await page.setInputFiles("#fileIn", {
    name: "r.0.0.mca", mimeType: "application/octet-stream", buffer: region
  });
  await page.waitForFunction("window.__rr().G.title === 'Your world'", null, { timeout: 30000 });
  await page.waitForTimeout(900);

  var loaded = await page.evaluate("(()=>{const g=window.__rr().G;return {blocks:g.world.count,tris:g.tris,title:g.title};})()");
  /* the region holds 4 layers of stone, a plank floor and two bookshelf
     walls in one 16×16 chunk — a bit over a thousand blocks */
  ok("a real region file loads and becomes a world", loaded.blocks > 900, loaded.blocks + " blocks");
  ok("and it meshes", loaded.tris > 20, loaded.tris + " triangles");
  var mats = await page.evaluate("(()=>{const w=window.__rr().G.world,B=window.Blocks;const seen={};" +
    "for(let y=0;y<10;y++)for(let z=0;z<16;z+=3)for(let x=0;x<16;x+=3){const m=w.get(x,y,z);if(m)seen[B.material(m).key]=1;}" +
    "return Object.keys(seen).sort().join(',');})()");
  ok("with the blocks it actually contained", /bookshelf/.test(mats) && /planks/.test(mats) && /stone/.test(mats), mats);
  var stillDrawing = await page.evaluate(VARIED);
  ok("and the loaded world draws too", stillDrawing > 4, stillDrawing + "");

  /* ---------- the panels ---------- */
  await page.click("#btnAbout");
  await page.waitForTimeout(250);
  ok("the about panel opens", await page.isVisible("#ovAbout"));
  var about = await page.textContent("#ovAbout");
  ok("and credits RSF and BlockWorks", /Reporters Without Borders/.test(about) && /BlockWorks/.test(about));
  ok("and is straight about Mojang", /not affiliated/i.test(about) && /trademark/i.test(about));
  await page.click("[data-close=ovAbout]");

  await page.click("#btnMenu");
  await page.waitForTimeout(200);
  await page.click("#mControls");
  await page.waitForTimeout(250);
  var ctrls = await page.textContent("#ovControls");
  ok("the controls are documented", /left stick/i.test(ctrls) && /W A S D/.test(ctrls));
  await page.click("[data-close=ovControls]");

  /* ---------- it survives being resized ---------- */
  await page.setViewportSize({ width: 500, height: 900 });
  await page.waitForTimeout(600);
  ok("it redraws on a tall screen", (await page.evaluate(VARIED)) > 4);
  await page.setViewportSize({ width: 1200, height: 500 });
  await page.waitForTimeout(600);
  ok("and a wide one", (await page.evaluate(VARIED)) > 4);

  ok("no console error in the whole session", errors.length === 0, errors.slice(0, 4).join(" | "));

  if (process.env.RR_SHOT) {
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.evaluate("(()=>{const g=window.__rr(); g.startTribute();})()");
    await page.waitForFunction("window.__rr().G.running === true", null, { timeout: 30000 });
    await page.evaluate("(()=>{const g=window.__rr().G; g.pos=[0,6,-14]; g.yaw=0; g.pitch=-0.05; g.fly=true;})()");
    await page.waitForTimeout(900);
    await page.screenshot({ path: process.env.RR_SHOT });
    console.log("      wrote " + process.env.RR_SHOT);
  }

  await browser.close();
  srv.close();
  console.log("\n" + (fail === 0
    ? "the room opens and walks — " + pass + " checks passed"
    : fail + " of " + (pass + fail) + " checks FAILED"));
  if (fail) { failures.forEach(function (f) { console.log("  · " + f); }); process.exit(1); }
})().catch(function (e) {
  console.log("FAIL  the browser check itself threw — " + e.message);
  process.exit(1);
});
