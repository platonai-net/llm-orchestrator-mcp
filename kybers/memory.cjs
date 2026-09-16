#!/usr/bin/env node
/**
 * kybers/memory.cjs — mémoire déterministe d'un kyber.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * La skill `kyber-memory` décrivait un protocole : après chaque exécution, le
 * modèle écrivait une ligne de journal, calculait une moyenne pondérée, et
 * relisait le fichier au run suivant. Mesure sur données réelles : 11 lignes,
 * 9 bras, TOUS à `ewma = 1`, zéro échec — donc le seuil de marge ne pouvait
 * mathématiquement jamais se déclencher. **La moitié routage de
 * l'auto-apprentissage n'avait jamais produit une seule décision.**
 *
 * La cause n'est pas le protocole, c'est qui l'exécute : demander à un modèle de
 * calculer une EWMA en prose, c'est lui demander d'être une calculatrice fiable
 * sans pouvoir vérifier son résultat. L'arithmétique doit être du code ; le
 * jugement (« l'attente a-t-elle été contredite ? ») doit rester au modèle.
 *
 * CE QUI EST RÉUTILISÉ, ET CE QUI NE L'EST PAS
 *
 * Réutilisé depuis `../memory.js` (déjà testé, 54 tests passent) :
 *   EWMA_ALPHA = 0.2, EWMA_MAX_DELTA = 0.15 — mêmes constantes, mêmes valeurs
 *   LESSON_MAX_CHARS = 500, LESSONS_MAX_COUNT = 50 — mêmes plafonds
 *
 * NON réutilisé malgré une signature qui y ressemble : `ewmaUpdate`. Elle prend
 * un `outcome` BOOLÉEN (`target = outcome ? 1 : 0`) ; lui passer le 0.5 du succès
 * après reprise le convertit en 1, donc en crédit plein. Voir `ewmaThreeValued`
 * ci-dessous — le bug a réellement eu lieu et il était silencieux.
 *
 * NON réutilisé : l'indexation. `memory.js` indexe par modèle
 * (`modelBias(taskType)`). Ici la clé est `kyber|role|provider|model`, parce
 * qu'un même modèle peut servir deux métiers opposés — dans `dev-team`,
 * `implementeur` et `implementeur-expert` peuvent tourner sur le même modèle, et
 * leur donner un score commun reproduirait exactement la fusion qui a détruit le
 * premier journal réel : `auditeur` (constate) et `verificateur` (réfute)
 * partageaient une clé, donc une préférence apprise pour l'un s'appliquait
 * silencieusement à celui dont le travail est de le contredire.
 *
 * Usage :
 *   node kybers/memory.cjs record --kyber dev-team --role implementeur \
 *     --specialty coder --provider ollama-cloud --model glm-5.3 \
 *     --task code --outcome success --attempts 1 [--note "..."]
 *   node kybers/memory.cjs route  --kyber dev-team --role implementeur \
 *     [--provider P --model M]      # le bras appris, ou l'hypothèse
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

/* Décroissance : un score appris une fois ne reste pas vrai. Un fournisseur met
   à jour un modèle, un prompt change, un tarif bouge. Sans décroissance, une
   ligne mal étiquetée biaise le routage indéfiniment.

   0.001/h ≈ -0.024/jour : délibérément beaucoup plus lent que les -0.005/h de
   `ruflo`, dont l'échelle d'usage est bien plus intensive. Ici un bras peut
   légitimement rester deux semaines sans tourner.

   ELLE SE CALCULE À LA LECTURE, JAMAIS SEULEMENT À L'ÉCRITURE. Sinon un bras
   que plus personne n'exécute conserve son score pour toujours — exactement le
   cas qu'on veut corriger. Un score ne se met à jour que quand quelque chose
   tourne ; la décroissance doit s'appliquer même quand rien ne tourne. */
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

/** Le score effectif, décroissance appliquée. C'est LA fonction à ne pas oublier. */
function effective(arm, now) {
  if (!arm || !Number.isFinite(arm.ewma)) return 0.5;
  const decayed = arm.ewma - DECAY_PER_HOUR * hoursSince(arm.updated, now);
  return Math.min(1, Math.max(DECAY_FLOOR, decayed));
}

/**
 * Trois valeurs, pas deux : un succès après reprise n'est pas un succès propre.
 * Constaté sur un vrai journal — une ligne disait `success` alors que la leçon
 * du même run décrivait un schéma rejeté ayant exigé deux tentatives. La panne
 * avait disparu du dossier.
 *
 * Le 0.5 est une CONVENTION, pas une mesure : elle dit « deux essais valent
 * moins qu'un », sans prétendre que c'est exactement deux fois moins.
 */
function outcomeValue(outcome, attempts) {
  if (outcome === "success") return attempts >= 2 ? 0.5 : 1;
  return 0;
}

/**
 * POURQUOI CETTE FONCTION N'APPELLE PAS `ewmaUpdate` DE `memory.js`
 *
 * Je l'appelais, et c'était un bug silencieux. La signature de `memory.js` est
 * `ewmaUpdate(prev, outcome, opts)` où `outcome` est un BOOLÉEN — son corps fait
 * `const target = outcome ? 1 : 0`. En lui passant mon `0.5`, truthy, il le
 * convertissait en `1` : le succès après reprise recevait le CRÉDIT PLEIN, et
 * mon raffinement à trois valeurs ne servait à rien.
 *
 * Le symptôme était visible et je l'ai d'abord mal lu : deux bras, l'un à trois
 * succès propres et l'autre à trois succès après reprise, affichaient la même
 * `ewma` (0.744) alors que leurs `essais_moy` différaient (1 vs 2).
 *
 * La leçon dépasse ce cas : « réutiliser plutôt que dupliquer » tient quand les
 * contrats coïncident. Ici le mien est plus fin que celui de la fonction
 * exportée, donc l'appeler n'était pas de la réutilisation, c'était une
 * conversion de type silencieuse. Le clamp et les constantes, eux, sont bien
 * repris de `memory.js` — c'est la partie dont le contrat coïncide exactement.
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

  /* `blocked` n'est pas `failure` : un modèle inconnu, une erreur d'auth ou un
     plafond atteint ne disent RIEN sur la qualité du modèle. On journalise et on
     exclut du score — confondre les deux pollue la table de routage. */
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

  /* Le second éligible sert de référence : la marge se juge contre la meilleure
     ALTERNATIVE, pas contre une moyenne.

     Sans second bras, il n'y a AUCUNE marge à établir — ma première version
     renvoyait alors 1.0 et concluait « appris », c'est-à-dire qu'elle déclarait
     une préférence fondée sur un unique candidat. C'est le contraire du but : on
     ne démontre pas qu'un bras est meilleur quand rien ne lui est comparé. Un
     seul candidat reste une hypothèse, même après cent observations. */
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

  /* Éviction par UTILITÉ RÉELLE, jamais par ancienneté de création : une leçon
     jamais utilisée et vieille part la première ; une leçon utilisée vingt fois
     reste même si elle est ancienne — c'est précisément le signal qu'elle sert. */
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
