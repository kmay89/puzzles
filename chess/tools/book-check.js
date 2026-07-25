/* book-check.js — every opening line in book.js must be a sequence of
   legal moves in exactly the SAN the engine itself would write.
   Run: node chess/tools/book-check.js */
"use strict";
const Chess = require("../engine.js");
const Book = require("../book.js");

let failed = 0;
for (const line of Book.LINES) {
  const g = Chess.create();
  const sans = line.seq.split(" ");
  for (let i = 0; i < sans.length; i++) {
    const m = Chess.fromSAN(g, sans[i]);
    if (!m) { console.log(`FAIL  ${line.name}: illegal/misspelt move "${sans[i]}" at ply ${i + 1} (${line.seq})`); failed++; break; }
    const canonical = Chess.play(g, m).replace(/[+#]$/, "");
    if (canonical !== sans[i]) { console.log(`FAIL  ${line.name}: "${sans[i]}" should be written "${canonical}"`); failed++; break; }
  }
  if (line.why && line.why.length > sans.length) { console.log(`FAIL  ${line.name}: why[] longer than the line`); failed++; }
}
console.log(failed ? `${failed} FAILURE(S)` : `all ${Book.LINES.length} lines legal & canonical`);
process.exit(failed ? 1 : 0);
