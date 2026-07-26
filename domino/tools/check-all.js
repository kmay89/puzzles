/* check-all.js — dev-only. Runs the lot.

   Order matters: the cheap checks that catch wrong thinking run first,
   the browser check last, because it is the slow one and there is no
   point opening Chromium to find out the rules are broken.

   Run: node tools/check-all.js [--quick]                              */
"use strict";
var cp = require("child_process");
var path = require("path");

var QUICK = process.argv.indexOf("--quick") >= 0;
var CHECKS = [
  ["rules-check.js", [], "the rules"],
  ["layout-check.js", [], "the table geometry"],
  ["bone-check.js", [], "the shape of a bone"],
  ["skin-check.js", [], "the settings"],
  ["net-check.js", [], "the link"],
  ["coach-check.js", [], "the coach"],
  ["ai-check.js", QUICK ? ["--quick"] : [], "the players"],
  ["room-check.js", [], "the room in a browser"]
];

var failed = [];
var t0 = Date.now();
CHECKS.forEach(function (c) {
  process.stdout.write("\n──  " + c[2] + "\n");
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, c[0])].concat(c[1]), {
    stdio: "inherit", cwd: path.join(__dirname, "..")
  });
  if (r.status !== 0) failed.push(c[2]);
});

console.log("\n" + "═".repeat(52));
if (failed.length) {
  console.log("FAILED: " + failed.join(", "));
  process.exit(1);
}
console.log("everything holds  ·  " + ((Date.now() - t0) / 1000).toFixed(0) + "s");
