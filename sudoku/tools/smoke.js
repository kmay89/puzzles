/* smoke.js — drive the room in a real browser.

   Boots the page in headless Chromium, walks the things a person walks
   (start a puzzle, write digits, ask for a hint, open the codex, do a
   lesson, watch the forge, finish a grid) and fails on any console
   error, page error, or missing element. Screenshots land next to the
   run so a change to the look can be eyeballed.

       node sudoku/tools/smoke.js                 # against a local server
       node sudoku/tools/smoke.js --url=…         # against anything
       node sudoku/tools/smoke.js --shots=/tmp/s  # keep the pictures

   Needs playwright available to node; it is dev-only and never ships. */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

let URL_ = "http://localhost:8123/sudoku/";
let SHOTS = null;
process.argv.slice(2).forEach((a) => {
  if (a.startsWith("--url=")) URL_ = a.slice(6);
  if (a.startsWith("--shots=")) SHOTS = a.slice(8);
});

let failures = 0;
const ok = (cond, what, detail) => {
  if (!cond) { failures++; console.log("  ✗ " + what + (detail ? " — " + detail : "")); }
  else console.log("  ✓ " + what);
  return cond;
};

(async () => {
  /* Use whatever chromium this machine already has; playwright's own
     download is not required and never shipped. */
  const launch = {};
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }); };

  console.log("\nthe room boots");
  await page.goto(URL_, { waitUntil: "networkidle" });
  ok(await page.locator("#home").isVisible(), "home screen shows");
  ok((await page.locator("#bandList .band").count()) === 5, "five bands offered");
  ok(await page.locator("#dailyCard").isVisible(), "the daily is offered");
  await shot("01-home");

  console.log("\na puzzle");
  await page.locator("#bandList .band").first().click();
  await page.waitForSelector("#play.on", { timeout: 20000 });
  await page.waitForFunction(() => window.__sudoku && window.__sudoku().G, null, { timeout: 20000 });
  const info = await page.evaluate(() => {
    const g = window.__sudoku().G;
    return { band: g.band, clues: g.clues, tier: g.tier };
  });
  ok(info.band === "gentle", "a Gentle puzzle was dealt", info.band);
  ok(info.clues > 17 && info.clues < 50, "sane clue count", String(info.clues));
  ok((await page.locator("#board .cell").count()) === 81, "81 squares drawn");
  ok((await page.locator("#board .cell.given").count()) === info.clues, "givens match the clue count");
  await shot("02-play");

  console.log("\nwriting in it");
  /* find the first empty square, select it, and write the right digit */
  const first = await page.evaluate(() => {
    const g = window.__sudoku().G;
    for (let i = 0; i < 81; i++) if (!g.grid[i]) return { i, d: g.solution[i] };
    return null;
  });
  await page.locator(`#board .cell[data-i="${first.i}"]`).click();
  ok(await page.locator(`#board .cell[data-i="${first.i}"]`).evaluate((el) => el.classList.contains("sel")), "the square selects");
  await page.locator(`#pad .key[data-d="${first.d}"]`).click();
  ok(await page.evaluate((i) => window.__sudoku().G.grid[i], first.i) === first.d, "the digit is written");
  ok((await page.locator("#board .cell.bad").count()) === 0, "a right digit is not marked wrong");

  /* a wrong digit must be caught */
  const wrong = await page.evaluate(() => {
    const g = window.__sudoku().G;
    for (let i = 0; i < 81; i++) if (!g.grid[i]) return { i, d: (g.solution[i] % 9) + 1 };
    return null;
  });
  await page.locator(`#board .cell[data-i="${wrong.i}"]`).click();
  await page.locator(`#pad .key[data-d="${wrong.d}"]`).click();
  ok((await page.locator("#board .cell.bad").count()) === 1, "a wrong digit is marked");
  await page.locator("#toolUndo").click();
  ok((await page.locator("#board .cell.bad").count()) === 0, "undo takes it back");

  console.log("\npencil marks");
  await page.locator("#toolAuto").click();
  const marks = await page.locator("#board .pm span.on").count();
  ok(marks > 20, "fill notes writes candidates", String(marks));
  await page.locator("#toolAuto").click();
  ok((await page.locator("#board .pm span.on").count()) === 0, "pressing again rubs them out");

  console.log("\nthe hint ladder");
  await page.locator("#toolHint").click();
  ok((await page.locator("#margin").textContent()).length > 20, "hint 1 names a technique");
  const h1 = await page.locator("#margin").textContent();
  await page.locator("#toolHint").click();
  ok((await page.locator("#board .cell.pat").count()) > 0, "hint 2 lights the pattern");
  await page.locator("#toolHint").click();
  const h3 = await page.locator("#margin").textContent();
  ok(h3 !== h1 && h3.length > 40, "hint 3 explains it in words");
  await shot("03-hint");
  await page.locator("#toolHint").click();
  ok(await page.evaluate(() => {
    const g = window.__sudoku().G;
    let n = 0;
    for (let i = 0; i < 81; i++) if (g.grid[i]) n++;
    return n > 0;
  }), "hint 4 plays the move");
  ok(await page.evaluate(() => Object.keys(window.__sudoku().profile.mastery).length > 0), "the technique joined the codex");

  console.log("\nfinishing");
  /* fill the rest from the answer, one digit at a time through the real
     input path, so completion runs the way it does for a player */
  await page.evaluate(async () => {
    const api = window.__sudoku();
    const g = api.G;
    for (let i = 0; i < 81; i++) if (g.grid[i] !== g.solution[i]) api.place(i, g.solution[i]);
  });
  await page.waitForSelector("#ovWin:not(.hide)", { timeout: 15000 });
  ok(true, "the win screen arrives");
  ok((await page.locator("#winPath span").count()) > 0, "the path through the puzzle is listed");
  ok((await page.locator("#winBadges .newbadge").count()) > 0, "a badge was earned");
  await shot("04-win");
  ok(await page.evaluate(() => window.__sudoku().profile.solves.gentle >= 1), "the solve was recorded");

  console.log("\nthe codex and a lesson");
  await page.locator("#winHome").click();
  await page.locator("#toDojo").click();
  await page.waitForSelector("#ovDojo:not(.hide)");
  const techs = await page.locator("#codexList .tech").count();
  ok(techs === 20, "twenty entries in the codex", String(techs));
  await shot("05-codex");
  await page.locator("#codexList .tech").nth(2).click();
  await page.waitForSelector("#ovLesson:not(.hide)");
  ok((await page.locator("#lessonBoard .cell").count()) === 81, "the lesson draws a board");
  ok((await page.locator("#lessonBoard .pm span.on").count()) > 10, "the lesson pencils in the candidates");
  /* tap the right squares */
  const focus = await page.evaluate(() => null); // the room keeps it private; use "show me"
  await page.locator("#lessonReveal").click();
  ok((await page.locator("#lessonBoard .cell.pat").count()) > 0, "'show me' lights the pattern");
  await shot("06-lesson");
  await page.locator("#lessonApply").click();
  ok((await page.locator("#lessonPrompt").textContent()).indexOf("one step of a solve") > 0, "'apply it' plays the step");
  await page.locator("#lessonClose").click();
  await page.locator("#dojoClose").click();

  console.log("\nthe forge");
  await page.locator("#toForge").click();
  await page.waitForSelector("#ovForge:not(.hide)");
  ok((await page.locator("#forgeBoard .fc").count()) === 81, "the forge draws its grid");
  /* wind the speed round to "at once" whatever it started on */
  for (let n = 0; n < 5 && !(await page.locator("#forgeSpeed").textContent()).includes("at once"); n++) {
    await page.locator("#forgeSpeed").click();
  }
  await page.locator("#forgeStart").click();
  await page.waitForSelector("#forgePlay:not(.hide)", { timeout: 60000 });
  ok(true, "a puzzle was forged end to end");
  ok((await page.locator("#forgeLedger div").count()) > 0, "the ledger recorded its reasoning");
  ok((await page.locator("#forgeNarr").textContent()).indexOf("clues") > 0, "the verdict is narrated");
  await shot("07-forge");
  await page.locator("#forgePlay").click();
  await page.waitForSelector("#play.on");
  ok(await page.evaluate(() => !!window.__sudoku().G), "the forged puzzle can be played");

  console.log("\nthe wall, and coming back");
  await page.locator("#backBtn").click();
  await page.locator("#toWall").click();
  await page.waitForSelector("#ovWall:not(.hide)");
  ok((await page.locator("#wallList .badge").count()) === 32, "thirty-two things on the wall");
  ok((await page.locator("#wallList .badge.got").count()) > 0, "some of them are lit");
  await shot("08-wall");
  await page.locator("#wallClose").click();
  ok(await page.locator("#contCard").isVisible(), "the unfinished puzzle is offered again");
  await page.reload({ waitUntil: "networkidle" });
  ok(await page.locator("#contCard").isVisible(), "…and it survives a reload");
  await page.locator("#contCard").click();
  await page.waitForSelector("#play.on");
  ok(await page.evaluate(() => !!window.__sudoku().G), "and reopens");

  console.log("\nthe slate, and zen");
  await page.locator("#menuBtn").click();
  await page.locator("#sSlate").click();
  ok(await page.evaluate(() => document.body.classList.contains("slate")), "the slate look applies");
  await shot("09-slate");
  await page.locator("#sSlate").click();
  await page.locator("#mLeave").click();
  await page.locator("#toZen").click();
  await page.waitForSelector("#play.on", { timeout: 30000 });
  ok(await page.evaluate(() => window.__sudoku().G.zen), "zen mode starts");
  ok(!(await page.locator("#clock").isVisible()), "zen hides the clock");

  console.log("\nconsole");
  ok(errors.length === 0, "no console or page errors", errors.slice(0, 4).join(" | "));

  await browser.close();
  console.log("\n" + (failures ? "FAILED " + failures + " checks" : "smoke test clean") + "\n");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
