/* forge.js — where puzzles are made, in public.

   Making a sudoku is three honest jobs, and the room shows all three:

     1. FILL   a blank grid at random until it is a legal solution.
               Constraint propagation does nearly all of it: place a
               digit, strike it from everything that can see it, and
               watch squares fall out on their own.
     2. DIG    take clues away one at a time, and after every removal
               ask the two questions that matter — *does it still have
               exactly one answer?* (a brute-force count, capped at two)
               and *can it still be finished by the techniques this
               difficulty promises?* If either answer is no, the clue
               goes back.
     3. GRADE  solve it the way a person would, one named technique at a
               time, and let the hardest thing it needed name its band.

   The job is time-sliced. `tick(ms)` does as much work as fits in the
   budget and leaves a queue of events behind it, so The Forge screen
   animates the algorithm that actually ran — no re-enactments. Nothing
   here blocks a frame, and nothing needs a worker, so it still works
   from a file:// URL.

   No libraries. Browser (window.Forge) and node (module.exports). */
(function (root) {
"use strict";

var isNode = (typeof module !== "undefined" && module.exports);
var S = isNode ? require("./core.js") : root.Sudoku;
var Strat = isNode ? require("./strategies.js") : root.Strat;

/* The five bands the room ships. Each promises "solvable with nothing
   harder than this", and asks for at least one sighting of its own tier
   so the name is earned rather than aspirational. */
var LEVELS = [
  { id: "gentle", name: "Gentle", tier: 0, symmetric: true, attempts: 20,
    note: "Singles only. The whole game in its simplest clothes." },
  { id: "steady", name: "Steady", tier: 1, symmetric: true, attempts: 40,
    note: "Boxes start talking to lines. Naked pairs appear." },
  { id: "tricky", name: "Tricky", tier: 2, symmetric: true, attempts: 120,
    note: "Hidden pairs, triples, and the first X-Wing." },
  { id: "devious", name: "Devious", tier: 3, symmetric: false, attempts: 80,
    note: "Colour chains and wings. You will need paper, or nerve." },
  { id: "diabolical", name: "Diabolical", tier: 4, symmetric: false, attempts: 160,
    note: "Swordfish, rectangles, arguments about the puzzle itself." }
];
var BY_ID = {};
for (var L = 0; L < LEVELS.length; L++) BY_ID[LEVELS[L].id] = LEVELS[L];

function levelOf(id) { return BY_ID[id] || LEVELS[0]; }

/* ---------- the job ---------- */

function Job(opts) {
  opts = opts || {};
  this.level = levelOf(opts.level);
  this.seed = (opts.seed === undefined ? (Math.random() * 4294967296) >>> 0 : opts.seed) >>> 0;
  this.maxAttempts = opts.maxAttempts || this.level.attempts || 60;
  this.allowed = Strat.techsUpTo(this.level.tier);
  this.attempt = 0;
  this.events = [];
  this.done = false;
  this.result = null;
  this.best = null;
  /* A miss is still a perfectly good puzzle of *some* band — asking for
     Tricky and being handed a Steady is only a waste if you throw it
     away. The room files them in the cupboard instead. */
  this.spares = [];
  this.stage = "idle";
  this.work = 0;               // units of real work done, for the progress bar
  this.beginAttempt();
}

Job.prototype.emit = function (e) { this.events.push(e); };

/* Take everything the theatre has not read yet. */
Job.prototype.drain = function () {
  var e = this.events; this.events = [];
  return e;
};

Job.prototype.beginAttempt = function () {
  this.attempt++;
  this.rnd = S.rng(this.seed + this.attempt * 2654435761);
  this.stage = "fill";
  this.freePass = false;
  this.emit({ t: "stage", stage: "fill", attempt: this.attempt });
};

Job.prototype.stepFill = function () {
  var self = this;
  this.solution = S.fullGrid(this.rnd, function (ev) { self.emit(ev); });
  this.puzzle = S.clone(this.solution);
  this.order = this.buildOrder(this.level.symmetric);
  this.at = 0;
  this.removed = 0;
  this.stage = "dig";
  this.emit({ t: "stage", stage: "dig", attempt: this.attempt, symmetric: this.level.symmetric });
};

/* Rotationally symmetric puzzles look like the ones in newspapers, and
   the shape is part of the pleasure. Hard bands dig freely, because
   symmetry costs clues and clues are what make a puzzle hard. */
Job.prototype.buildOrder = function (symmetric) {
  var order = [], i;
  if (symmetric) {
    var seen = {};
    for (i = 0; i < 81; i++) {
      var j = 80 - i;
      if (seen[i]) continue;
      seen[i] = seen[j] = 1;
      order.push(i === j ? [i] : [i, j]);
    }
  } else {
    for (i = 0; i < 81; i++) order.push([i]);
  }
  return S.shuffle(order, this.rnd);
};

Job.prototype.stepDig = function () {
  if (this.at >= this.order.length) {
    this.stage = "grade";
    this.gradeState = Strat.state(this.puzzle);
    this.gradeCounts = {}; this.gradeScore = 0; this.gradeTier = 0;
    this.gradeSteps = []; this.gradeHardest = null;
    this.emit({ t: "stage", stage: "grade", attempt: this.attempt, clues: S.countClues(this.puzzle) });
    return;
  }
  var group = this.order[this.at++], kept = [], k;
  for (k = 0; k < group.length; k++) {
    if (this.puzzle[group[k]]) kept.push({ i: group[k], d: this.puzzle[group[k]] });
    this.puzzle[group[k]] = 0;
  }
  if (!kept.length) return;                       // already gone (free pass over a dug grid)
  this.emit({ t: "test", cells: kept.map(function (c) { return c.i; }) });
  this.work++;

  var n = S.countSolutions(this.puzzle, 2);
  var why = null;
  if (n !== 1) why = "two";
  else if (!Strat.run(this.puzzle, { allowed: this.allowed }).solved) why = "hard";

  if (why) {
    for (k = 0; k < kept.length; k++) this.puzzle[kept[k].i] = kept[k].d;
    this.emit({ t: "kept", cells: kept.map(function (c) { return c.i; }), why: why, n: n });
  } else {
    this.removed += kept.length;
    this.emit({ t: "removed", cells: kept.map(function (c) { return c.i; }), clues: S.countClues(this.puzzle) });
  }
};

Job.prototype.stepGrade = function () {
  var st = this.gradeState;
  if (S.isComplete(st.g)) return this.verdict(true);
  var step = Strat.nextStep(st, null);
  if (!step) return this.verdict(false);
  Strat.apply(st, step);
  this.gradeSteps.push(step.tech);
  this.gradeCounts[step.tech] = (this.gradeCounts[step.tech] || 0) + 1;
  var tech = Strat.BY_ID[step.tech];
  this.gradeScore += this.gradeCounts[step.tech] === 1 ? tech.cost : Math.round(tech.cost * 0.55);
  if (tech.tier > this.gradeTier) { this.gradeTier = tech.tier; this.gradeHardest = tech.id; }
  this.emit({ t: "step", tech: step.tech, name: tech.name, tier: tech.tier, cells: step.focus });
  this.work++;
};

Job.prototype.verdict = function (solved) {
  var clues = S.countClues(this.puzzle);
  var result = {
    puzzle: S.clone(this.puzzle), solution: S.clone(this.solution),
    level: this.level.id, seed: this.seed, attempt: this.attempt,
    clues: clues, solved: solved,
    tier: this.gradeTier, band: Strat.TIERS[this.gradeTier].id,
    bandName: Strat.TIERS[this.gradeTier].name,
    score: this.gradeScore, counts: this.gradeCounts,
    hardestId: this.gradeHardest, steps: this.gradeSteps.length,
    symmetric: this.level.symmetric && !this.freePass
  };
  if (!this.best || result.tier > this.best.tier ||
      (result.tier === this.best.tier && result.score > this.best.score)) this.best = result;

  this.emit({ t: "verdict", band: result.band, bandName: result.bandName, tier: result.tier,
              score: result.score, clues: clues, hardest: result.hardestId,
              wanted: this.level.tier, ok: solved && result.tier >= this.level.tier });

  if (solved && result.tier >= this.level.tier) return this.finish(result);

  /* Not hard enough yet. A symmetric grid still has clues that a free
     pass could take — try that before throwing the whole grid away. */
  if (solved && this.spares.length < 12) this.spares.push(result);
  if (solved && this.level.symmetric && !this.freePass) {
    this.freePass = true;
    this.order = this.buildOrder(false);
    this.at = 0;
    this.stage = "dig";
    this.emit({ t: "stage", stage: "dig", attempt: this.attempt, symmetric: false, second: true });
    return;
  }
  if (this.attempt < this.maxAttempts) { this.emit({ t: "retry", attempt: this.attempt }); return this.beginAttempt(); }
  return this.finish(this.best || result);
};

Job.prototype.finish = function (result) {
  this.done = true;
  this.stage = "done";
  this.result = result;
  this.emit({ t: "done", result: result });
};

/* One slice of work. Returns true while there is more to do. */
Job.prototype.tick = function (budgetMs) {
  var end = Date.now() + (budgetMs || 8);
  while (!this.done) {
    if (this.stage === "fill") this.stepFill();
    else if (this.stage === "dig") this.stepDig();
    else if (this.stage === "grade") this.stepGrade();
    else break;
    if (Date.now() >= end) break;
  }
  return !this.done;
};

/* Rough progress in 0..1 — honest about being rough: attempts are not
   predictable, so it counts what has been done against a typical run. */
Job.prototype.progress = function () {
  if (this.done) return 1;
  var per = 1 / this.maxAttempts;
  var base = (this.attempt - 1) * per;
  var inner = this.stage === "fill" ? 0.02
    : this.stage === "dig" ? 0.05 + 0.8 * (this.at / Math.max(1, this.order.length))
    : 0.9;
  return Math.min(0.99, base + per * inner);
};

/* ---------- the impatient front door ----------
   Same machine, run to completion right now. The tests and the puzzle
   cupboard use this; the screen uses the ticking job. */
function make(level, seed, opts) {
  var job = new Job({ level: level, seed: seed, maxAttempts: opts && opts.maxAttempts });
  var guard = 0;
  while (job.tick(1000) && guard++ < 100000) { /* keep going */ }
  return job.result;
}

/* The daily puzzle: one seed a day for everyone, from the date alone.
   The band walks through the week — gentle on Monday, and the weekend
   is where it bites. */
var WEEK = ["gentle", "steady", "steady", "tricky", "tricky", "devious", "diabolical"];
function dailySeed(date) {
  var d = date || new Date();
  var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return (y * 10000 + m * 100 + day) >>> 0;
}
function dailyKey(date) {
  var d = date || new Date();
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
/* Monday-first, so the week builds towards a weekend worth clearing
   the table for. */
function dailyLevel(date) {
  var d = date || new Date();
  return WEEK[(d.getDay() + 6) % 7];
}

var Forge = {
  LEVELS: LEVELS, levelOf: levelOf, Job: Job,
  job: function (opts) { return new Job(opts); },
  make: make,
  dailySeed: dailySeed, dailyKey: dailyKey, dailyLevel: dailyLevel, WEEK: WEEK
};

if (isNode) module.exports = Forge;
else root.Forge = Forge;
})(typeof self !== "undefined" ? self : this);
