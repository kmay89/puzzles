/* check-all.js — dev-only. Runs the lot, cheapest first.

   The format and geometry checks come before the browser one: there is
   no point starting Chromium to discover that the region reader is
   wrong.

   Run: node tools/check-all.js                                        */
"use strict";
var cp = require("child_process"), path = require("path");
var CHECKS = [
  ["nbt-check.js", "the NBT format"],
  ["anvil-check.js", "the region reader"],
  ["mesher-check.js", "the mesher"],
  ["room-check.js", "the room in a browser"]
];
var failed = [], t0 = Date.now();
CHECKS.forEach(function (c) {
  process.stdout.write("\n──  " + c[1] + "\n");
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, c[0])], {
    stdio: "inherit", cwd: path.join(__dirname, "..")
  });
  if (r.status !== 0) failed.push(c[1]);
});
console.log("\n" + "═".repeat(52));
if (failed.length) { console.log("FAILED: " + failed.join(", ")); process.exit(1); }
console.log("everything holds  ·  " + ((Date.now() - t0) / 1000).toFixed(0) + "s");
