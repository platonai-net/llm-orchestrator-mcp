#!/usr/bin/env node
/**
 * kybers/memory.cjs — deterministic memory for a kyber.
 *
 * WHY THIS FILE EXISTS
 *
 * The `kyber-memory` skill described a protocol: after each run, the model wrote
 * a journal line, computed a weighted average, and re-read the file on the next
 * run. Measured on real data: 11 lines, 9 arms, ALL at `ewma = 1`, zero
 * failures — so the margin threshold could mathematically never fire. **The
 * routing half of the self-learning loop had never produced a single decision.**
 *
 * The cause is not the protocol, it is who executes it: asking a model to
 * compute an EWMA in prose is asking it to be a reliable calculator with no way
 * to verify its result. Arithmetic must be code; judgement ("was the
 * expectation contradicted?") must stay with the model.
 *
 * WHAT IS REUSED, AND WHAT IS NOT
 *
 * Reused from `../memory.js` (already tested, 54 tests pass):
 *   EWMA_ALPHA = 0.2, EWMA_MAX_DELTA = 0.15 — same constants, same values
 *   LESSON_MAX_CHARS = 500, LESSONS_MAX_COUNT = 50 — same caps
 *
 * NOT reused despite a signature that looks like it: `ewmaUpdate`. It takes a
 * BOOLEAN `outcome` (`target = outcome ? 1 : 0`); passing it the 0.5 of a
 * success after a retry converts it to 1, hence full credit. See
 * `ewmaThreeValued` below — the bug really happened and it was silent.
 *
 * NOT reused: indexing. `memory.js` indexes by model (`modelBias(taskType)`).
 * Here the key is `kyber|role|provider|model`, because one model can serve two
 * opposing trades — in `dev-team`, `implementeur` and `implementeur-expert` can
 * run on the same model, and giving them a shared score would reproduce exactly
 * the merge that destroyed the first real journal: `auditeur` (reports) and
 * `verificateur` (refutes) shared a key, so a preference learned for one applied
 * silently to the one whose job is to contradict it.
 *
 * Usage :
 *   node kybers/memory.cjs record --kyber dev-team --role implementeur \
 *     --specialty coder --provider ollama-cloud --model glm-5.3 \
 *     --task code --outcome success --attempts 1 [--note "..."]
 *   node kybers/memory.cjs route  --kyber dev-team --role implementeur \
 *     [--provider P --model M]      # the learned arm, or the hypothesis
 *   node kybers/memory.cjs lesson  --kyber dev-team --text "..." --tags a,b
 *   node kybers/memory.cjs used    --kyber dev-team --index 0
 *   node kybers/memory.cjs stats   [--kyber dev-team]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  LESSON_MAX_CHARS,
  LESSONS_MAX_COUNT,
  EWMA_ALPHA,
  EWMA_MAX_DELTA,
} = require("../memory.js");

/* Decay: a score learned once does not stay true. A provider updates a model,
   a prompt changes, a price moves. Without decay, a mislabelled line biases
   routing forever.

   0.001/h ≈ -0.024/day: deliberately much slower than the -0.005/h of `ruflo`,
   whose usage scale is far more intensive. Here an arm can legitimately sit for
   two weeks without running.

   IT IS COMPUTED ON READ, NEVER ONLY ON WRITE. Otherwise an arm nobody runs any
   more keeps its score forever — exactly the case we want to fix. A score only
   updates when something runs; decay must apply even when nothing runs. */
const DECAY_PER_HOUR = 0.001;
const DECAY_FLOOR = 0.1;

const MIN_OBSERVATIONS = 3;
const MIN_MARGIN = 0.15;

const OUTCOMES = ["success", "failure", "blocked"];

function memDir(kyber, override) {
  if (override) return path.resolve(override);
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "kybers", kyber, "memory");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

function readJsonl(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function armKey(kyber, role, provider, model) {
  return [kyber, role, provider, model].join("|");
}

function hoursSince(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now - t) / 3_600_000);
}

/** The effective score, with decay applied. This is THE function not to forget. */
function effective(arm, now) {
  if (!arm || !Number.isFinite(arm.ewma)) return 0.5;
  const decayed = arm.ewma - DECAY_PER_HOUR * hoursSince(arm.updated, now);
  return Math.min(1, Math.max(DECAY_FLOOR, decayed));
}

/**
 * Three values, not two: a success after a retry is not a clean success.
 * Observed in a real journal — one line said `success` while the lesson of the
 * same run described a rejected schema that had required two attempts. The
 * failure had vanished from the record.
 *
 * The 0.5 is a CONVENTION, not a measurement: it says "two attempts are worth
 * less than one", without claiming that it is exactly twice less.
 */
function outcomeValue(outcome, attempts) {
  if (outcome === "success") return attempts >= 2 ? 0.5 : 1;
  return 0;
}

/**
 * WHY THIS FUNCTION DOES NOT CALL `ewmaUpdate` FROM `memory.js`
 *
 * I used to call it, and it was a silent bug. The signature in `memory.js` is
 * `ewmaUpdate(prev, outcome, opts)` where `outcome` is a BOOLEAN — its body does
 * `const target = outcome ? 1 : 0`. Passing it my `0.5`, truthy, converted it to
 * `1`: a success after a retry received FULL CREDIT, and my three-valued
 * refinement was useless.
 *
 * The symptom was visible and I first misread it: two arms, one with three clean
 * successes and the other with three successes after a retry, displayed the same
 * `ewma` (0.744) while their `essais_moy` differed (1 vs 2).
 *
 * The lesson goes beyond this case: "reuse rather than duplicate" holds when the
 * contracts coincide. Here mine is finer than the exported function's, so
 * calling it was not reuse, it was a silent type conversion. The clamp and the
 * constants, though, are indeed taken from `memory.js` — that is the part whose
 * contract coincides exactly.
 */
function ewmaThreeValued(prev, x, opts) {
  const alpha = (opts && opts.alpha) ?? EWMA_ALPHA;
  const maxDelta = (opts && opts.maxDelta) ?? EWMA_MAX_DELTA;
  const p = Number.isFinite(prev) ? Math.min(1, Math.max(0, prev)) : 0.5;
  let next = p + alpha * (x - p);
  next = Math.min(p + maxDelta, Math.max(p - maxDelta, next));
  return Math.min(1, Math.max(0, next));
}

function loadArms(kyber, dirOverride) {
  const file = path.join(memDir(kyber, dirOverride), "routing.local.json");
  const data = readJson(file, null);
  return {
    file,
    data: data || {
      alpha: EWMA_ALPHA,
      maxDelta: EWMA_MAX_DELTA,
      decayPerHour: DECAY_PER_HOUR,
      decayFloor: DECAY_FLOOR,
      minObservations: MIN_OBSERVATIONS,
      minMargin: MIN_MARGIN,
      keyFormat: "kyber|role|provider|model",
      arms: {},
    },
  };
}

/* ------------------------------------------------------------------ record */

function cmdRecord(argv) {
  const kyber = argv.kyber;
  const role = argv.role;
  const provider = argv.provider;
  const model = argv.model;
  const outcome = argv.outcome;
  const attempts = Number(argv.attempts || 1);
  const task = argv.task || "other";

  if (!kyber || !role || !provider || !model || !outcome) {
    throw new Error("record exige --kyber --role --provider --model --outcome");
  }
  if (!OUTCOMES.includes(outcome)) {
    throw new Error(`--outcome doit être ${OUTCOMES.join(" | ")} (reçu : ${outcome})`);
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("--attempts doit être un entier >= 1");
  }

  const now = Date.now();
  const ts = new Date(now).toISOString();
  const dir = memDir(kyber, argv.dir);

  appendJsonl(path.join(dir, "ledger.jsonl"), {
    ts,
    kyber,
    role,
    specialty: argv.specialty || null,
    provider,
    model,
    taskType: task,
    outcome,
    attempts,
    note: (argv.note || "").slice(0, 200),
  });

  /* `blocked` is not `failure`: an unknown model, an auth error or a reached
     ceiling say NOTHING about the quality of the model. We journal it and
     exclude it from the score — conflating the two pollutes the routing table. */
  if (outcome === "blocked") {
    return { recorded: true, scored: false, reason: "blocked — exclu du score" };
  }

  const { file, data } = loadArms(kyber, argv.dir);
  const key = armKey(kyber, role, provider, model);
  const prev = data.arms[key];
  const prior = effective(prev, now);
  const x = outcomeValue(outcome, attempts);

  data.arms[key] = {
    n: (prev ? prev.n : 0) + 1,
    successes: (prev ? prev.successes : 0) + (outcome === "success" ? 1 : 0),
    attemptsTotal: (prev ? prev.attemptsTotal || 0 : 0) + attempts,
    ewma: ewmaThreeValued(prior, x, { alpha: EWMA_ALPHA, maxDelta: EWMA_MAX_DELTA }),
    updated: ts,
  };

  writeJson(file, data);
  return {
    recorded: true,
    scored: true,
    arm: key,
    prior: Number(prior.toFixed(4)),
    x,
    ewma: Number(data.arms[key].ewma.toFixed(4)),
    n: data.arms[key].n,
  };
}

/* ------------------------------------------------------------------- route */

function cmdRoute(argv) {
  const kyber = argv.kyber;
  const role = argv.role;
  if (!kyber) throw new Error("route exige --kyber");

  const now = Date.now();
  const { data } = loadArms(kyber, argv.dir);
  const arms = Object.entries(data.arms)
    .filter(([k]) => {
      const [, r] = k.split("|");
      return !role || r === role;
    })
    .map(([key, arm]) => {
      const [k, r, provider, model] = key.split("|");
      return {
        key,
        kyber: k,
        role: r,
        provider,
        model,
        n: arm.n,
        successes: arm.successes,
        attemptsAvg: arm.n ? Number(((arm.attemptsTotal || arm.n) / arm.n).toFixed(2)) : 1,
        ewmaRaw: arm.ewma,
        ewma: Number(effective(arm, now).toFixed(4)),
        staleHours: Math.round(hoursSince(arm.updated, now)),
      };
    })
    .sort((a, b) => b.ewma - a.ewma);

  if (!arms.length) {
    return {
      decision: "hypothèse",
      reason: role
        ? `aucun bras observé pour le rôle « ${role} » — applique l'hypothèse de kyber-routing`
        : "aucun bras observé",
      arms: [],
    };
  }

  const best = arms[0];
  const eligible = arms.filter((a) => a.n >= MIN_OBSERVATIONS);
  if (!eligible.length) {
    return {
      decision: "hypothèse",
      reason: `aucun bras n'atteint n=${MIN_OBSERVATIONS} observation(s) — la mémoire ne peut pas trancher sur un échantillon insignifiant`,
      arms,
    };
  }

  /* The second eligible arm serves as the reference: the margin is judged
     against the best ALTERNATIVE, not against an average.

     Without a second arm there is NO margin to establish — my first version
     returned 1.0 and concluded "appris", i.e. it declared a preference based on
     a single candidate. That is the opposite of the goal: you do not
     demonstrate that an arm is better when nothing is compared against it. A
     single candidate remains a hypothesis, even after a hundred observations. */
  const runnerUp = eligible[1];
  if (!runnerUp) {
    return {
      decision: "hypothèse",
      reason: `un seul bras atteint n=${MIN_OBSERVATIONS} (${eligible[0].provider}/${eligible[0].model}) — aucune alternative à lui comparer, donc aucune marge démontrable`,
      arms,
    };
  }

  const margin = eligible[0].ewma - runnerUp.ewma;
  if (margin < MIN_MARGIN) {
    return {
      decision: "hypothèse",
      reason: `marge ${margin.toFixed(3)} < ${MIN_MARGIN} entre les deux meilleurs bras éligibles — pas de préférence apprise défendable`,
      arms,
    };
  }

  return {
    decision: "appris",
    chosen: eligible[0],
    margin: Number(margin.toFixed(4)),
    reason: `n=${eligible[0].n}, marge ${margin.toFixed(3)} sur ${runnerUp.provider}/${runnerUp.model}`,
    arms,
  };
}

/* ------------------------------------------------------------------ lesson */

function cmdLesson(argv) {
  const kyber = argv.kyber;
  const text = argv.text;
  if (!kyber || !text) throw new Error("lesson exige --kyber et --text");

  const dir = memDir(kyber, argv.dir);
  const file = path.join(dir, "lessons.jsonl");
  const capped = text.length > LESSON_MAX_CHARS ? text.slice(0, LESSON_MAX_CHARS) + "…" : text;
  const entry = {
    ts: new Date().toISOString(),
    text: capped,
    tags: (argv.tags || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5),
    uses: 0,
    lastUsed: null,
  };
  if (argv.from) entry.from = argv.from;
  appendJsonl(file, entry);

  /* Eviction by REAL UTILITY, never by creation age: an unused and old lesson
     leaves first; a lesson used twenty times stays even if old — that is
     precisely the signal that it is useful. */
  let lessons = readJsonl(file);
  let evicted = null;
  if (lessons.length > LESSONS_MAX_COUNT) {
    const sorted = lessons
      .map((l, i) => ({ l, i }))
      .sort((a, b) => (a.l.uses || 0) - (b.l.uses || 0) || Date.parse(a.l.ts) - Date.parse(b.l.ts));
    const doomed = new Set(sorted.slice(0, lessons.length - LESSONS_MAX_COUNT).map((x) => x.i));
    evicted = lessons.filter((_, i) => doomed.has(i)).map((l) => l.text.slice(0, 60));
    lessons = lessons.filter((_, i) => !doomed.has(i));
    fs.writeFileSync(file, lessons.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  return { added: true, chars: capped.length, total: lessons.length, evicted };
}

function cmdUsed(argv) {
  const kyber = argv.kyber;
  const idx = Number(argv.index);
  if (!kyber || !Number.isInteger(idx)) throw new Error("used exige --kyber et --index <n>");
  const file = path.join(memDir(kyber, argv.dir), "lessons.jsonl");
  const lessons = readJsonl(file);
  if (!lessons[idx]) throw new Error(`leçon ${idx} inexistante (${lessons.length} au total)`);
  lessons[idx].uses = (lessons[idx].uses || 0) + 1;
  lessons[idx].lastUsed = new Date().toISOString();
  fs.writeFileSync(file, lessons.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return { index: idx, uses: lessons[idx].uses };
}

/* ------------------------------------------------------------------- stats */

function cmdStats(argv) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const root = argv.dir ? path.resolve(argv.dir) : path.join(home, "kybers");
  let kybers = [];
  try {
    kybers = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return { kybers: [] };
  }
  if (argv.kyber) kybers = kybers.filter((k) => k === argv.kyber);

  return {
    kybers: kybers.map((k) => {
      const dir = path.join(root, k, "memory");
      const ledger = readJsonl(path.join(dir, "ledger.jsonl"));
      const lessons = readJsonl(path.join(dir, "lessons.jsonl"));
      const { data } = loadArms(k, path.join(root, k, "memory"));
      const now = Date.now();
      const arms = Object.entries(data.arms || {});
      return {
        kyber: k,
        ledgerLines: ledger.length,
        lessons: lessons.length,
        lessonsUsed: lessons.filter((l) => (l.uses || 0) > 0).length,
        arms: arms.length,
        armsAtCeiling: arms.filter(([, a]) => effective(a, now) >= 0.999).length,
        outcomes: ledger.reduce((acc, l) => ((acc[l.outcome] = (acc[l.outcome] || 0) + 1), acc), {}),
      };
    }),
  };
}

/* -------------------------------------------------------------------- main */

const BOOL_FLAGS = new Set(["help"]);

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith("--")) continue;
    const name = a.slice(2);
    if (BOOL_FLAGS.has(name)) {
      out[name] = true;
      continue;
    }
    const next = list[i + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`--${name} attend une valeur`);
    out[name] = next;
    i++;
  }
  return out;
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(fs.readFileSync(__filename, "utf8").split("Usage :")[1].split("*/")[0]);
    return 0;
  }
  const argv = parseArgs(rest);
  const table = { record: cmdRecord, route: cmdRoute, lesson: cmdLesson, used: cmdUsed, stats: cmdStats };
  const fn = table[cmd];
  if (!fn) {
    console.error(`commande inconnue : ${cmd} (attendu : ${Object.keys(table).join(" | ")})`);
    return 2;
  }
  try {
    console.log(JSON.stringify(fn(argv), null, 2));
    return 0;
  } catch (e) {
    console.error(`ERREUR  ${e.message}`);
    return 1;
  }
}

if (require.main === module) process.exit(main());

module.exports = { effective, outcomeValue, armKey, cmdRoute, cmdRecord };
