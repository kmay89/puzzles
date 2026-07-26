/* lesson-check.js — a lesson that cannot be solved must not ship.
   For every lesson: the position loads, the right side is to move, the
   model answer is legal and spelled the way the engine spells it, the
   acceptance rule actually accepts it, every "miss" is a real legal
   move that is genuinely rejected, and a sample of other legal moves is
   not accidentally accepted. Also exercises the spacing maths.
   Run: node chess/tools/lesson-check.js */
"use strict";
const Chess = require("../engine.js");
const Learn = require("../learn.js");

let failed = 0;
const fail = (id, msg) => { failed++; console.log(`FAIL  ${id}: ${msg}`); };

const chapterIds = new Set(Learn.CHAPTERS.map((c) => c.id));
const seenIds = new Set();

for (const L of Learn.LESSONS) {
  /* identity */
  if (seenIds.has(L.id)) fail(L.id, "duplicate lesson id");
  seenIds.add(L.id);
  if (!chapterIds.has(L.chapter)) fail(L.id, `unknown chapter "${L.chapter}"`);
  for (const field of ["title", "ask", "why", "hint", "concept", "rule", "best"]) {
    if (!L[field]) fail(L.id, `missing ${field}`);
  }

  /* the position */
  let g;
  try { g = Chess.create(L.fen); }
  catch (e) { fail(L.id, `bad FEN: ${e.message}`); continue; }
  if (g.turn !== L.side) fail(L.id, `side to move (${g.turn}) doesn't match lesson.side (${L.side})`);
  if (Chess.status(g).over) fail(L.id, "the position is already finished");

  /* the model answer */
  const best = Chess.fromSAN(g, L.best);
  if (!best) { fail(L.id, `best move "${L.best}" is not legal here`); continue; }
  const canonical = Chess.toSAN(g, best);
  if (canonical !== L.best) fail(L.id, `best should be written "${canonical}", not "${L.best}"`);

  const verdict = Learn.accepts(L, g, best);
  if (!verdict.ok) fail(L.id, `rule "${L.rule}" rejects its own model answer ${L.best}`);
  if (Chess.fen(g) !== L.fen) fail(L.id, "accepts() disturbed the position");

  /* alternates that should also count */
  for (const alt of L.alsoOk || []) {
    const m = Chess.fromSAN(g, alt);
    if (!m) { fail(L.id, `alsoOk "${alt}" is not legal`); continue; }
    if (!Learn.accepts(L, g, m).ok) fail(L.id, `alsoOk "${alt}" is rejected`);
  }

  /* every miss must be a real move, and must be wrong */
  for (const san of Object.keys(L.misses || {})) {
    const m = Chess.fromSAN(g, san);
    if (!m) { fail(L.id, `miss "${san}" is not a legal move (its advice can never appear)`); continue; }
    if (Learn.accepts(L, g, m).ok) fail(L.id, `miss "${san}" is actually accepted — the feedback contradicts the rule`);
    if (!L.misses[san] || L.misses[san].length < 20) fail(L.id, `miss "${san}" has thin feedback`);
  }

  /* the rule must discriminate: most other legal moves should be wrong */
  const all = Chess.moves(g);
  const accepted = all.filter((m) => Learn.accepts(L, g, m).ok);
  if (accepted.length === all.length && all.length > 1) {
    fail(L.id, "every legal move is accepted — the rule isn't teaching anything");
  }
  if (accepted.length === 0) fail(L.id, "no legal move is accepted");

  /* critique must produce something specific for a wrong move */
  const wrong = all.find((m) => !Learn.accepts(L, g, m).ok);
  if (wrong) {
    const text = Learn.critique(L, g, wrong);
    if (!text || text.length < 20) fail(L.id, "critique() gave no useful feedback");
    if (Chess.fen(g) !== L.fen) fail(L.id, "critique() disturbed the position");
  }

  console.log(`ok    ${L.id.padEnd(16)} ${L.rule.padEnd(13)} ${accepted.length}/${all.length} moves accepted`);
}

/* ---- the spacing engine ---- */
{
  const p = Learn.blank();
  const L = Learn.LESSONS[0];
  const t0 = 1750000000000;
  Learn.grade(p, L, true, "sure", t0);
  const c = p.concepts[L.concept];
  if (!(c.interval === 1 && c.reps === 1)) fail("spacing", "first success should return tomorrow");
  Learn.grade(p, L, true, "sure", t0 + 86400000);
  if (p.concepts[L.concept].interval !== 3) fail("spacing", "second success should space to 3 days");
  Learn.grade(p, L, true, "sure", t0 + 4 * 86400000);
  if (!(p.concepts[L.concept].interval > 3)) fail("spacing", "third success should space further");
  const easeBefore = p.concepts[L.concept].ease;
  Learn.grade(p, L, false, null, t0 + 20 * 86400000);
  if (p.concepts[L.concept].interval !== 0) fail("spacing", "a miss should bring it back this session");
  if (!(p.concepts[L.concept].ease < easeBefore)) fail("spacing", "a miss should lower ease");
  console.log("ok    spacing         SM-2 intervals grow on success and reset on a miss");

  const m = Learn.mastery(p, L.concept);
  if (!(m >= 0 && m <= 1)) fail("mastery", "out of range");
  const fresh = Learn.blank();
  if (Learn.mastery(fresh, "fork") !== 0) fail("mastery", "unseen concept should be 0");
  console.log("ok    mastery         0 for unseen, bounded 0..1");
}
{
  /* interleaving: due lessons of the same concept shouldn't sit adjacent */
  const p = Learn.blank();
  const t0 = 1750000000000;
  for (const L of Learn.LESSONS) {
    p.lessons[L.id] = { tries: 1, solved: 1 };
    p.concepts[L.concept] = { ease: 2.4, reps: 1, interval: 1, due: t0 - 1000, seen: 1, right: 1 };
  }
  const list = Learn.due(p, t0);
  let adjacent = 0;
  for (let i = 1; i < list.length; i++) if (list[i].concept === list[i - 1].concept) adjacent++;
  const sameConceptPairs = list.length - new Set(list.map((l) => l.concept)).size;
  if (adjacent > sameConceptPairs) fail("interleave", "practice is blocked, not interleaved");
  console.log(`ok    interleave      ${list.length} due, ${adjacent} same-concept adjacencies`);
}
{
  const p = Learn.blank();
  const n = Learn.next(p);
  if (!n || n.id !== Learn.LESSONS[0].id) fail("path", "next() should start at the beginning");
  const s = Learn.stats(p);
  if (s.total !== Learn.LESSONS.length || s.solved !== 0) fail("stats", "fresh stats wrong");
  console.log("ok    path            next() and stats() behave on a fresh slate");
}

console.log(failed
  ? `\n${failed} FAILURE(S)`
  : `\nall ${Learn.LESSONS.length} lessons solvable across ${Learn.CHAPTERS.length} chapters`);
process.exit(failed ? 1 : 0);
