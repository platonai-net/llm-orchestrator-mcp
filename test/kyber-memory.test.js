"use strict";

/* ── kybers/memory.cjs : la moitié LECTURE de la mémoire ─────────────────────
 *
 *  Le magasin de leçons était en écriture seule : `lesson` ajoutait, et la
 *  51e leçon DÉTRUISAIT en silence la moins utilisée. Personne ne pouvait
 *  relire le magasin sans ouvrir le JSONL à la main — donc le seul moyen de
 *  « garder » une leçon était de la recopier dans AGENTS.md, le fichier chargé
 *  en entier à chaque session.
 *
 *  Ces tests tiennent les trois promesses qui corrigent ça :
 *    1. `lessons` relit le magasin (par kyber, par tag, par texte) ;
 *    2. l'éviction ARCHIVE — une leçon chassée reste retrouvable ;
 *    3. `consolidate` fusionne les doublons (le plus utilisé gagne, ses `uses`
 *       sont additionnés) et `--dry-run` ne touche à rien.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const CLI = path.join(__dirname, "..", "kybers", "memory.cjs");
const { LESSONS_MAX_COUNT } = require("../memory.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kyber-mem-"));
}

function cli(args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

function cliJson(args) {
  return JSON.parse(cli(args));
}

function lireJsonl(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch (e) {
    return [];
  }
}

function ecrire(dir, text, tags, uses, ts) {
  cli(["lesson", "--dir", dir, "--kyber", "k", "--text", text, "--tags", tags]);
  if (uses === undefined && ts === undefined) return;
  const file = path.join(dir, "lessons.jsonl");
  const lessons = lireJsonl(file);
  const last = lessons[lessons.length - 1];
  if (uses !== undefined) last.uses = uses;
  if (ts !== undefined) last.ts = ts;
  fs.writeFileSync(file, lessons.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

/* ----------------------------- lessons : relire ---------------------------- */

test("lessons : relit ce que lesson a écrit, du plus récent au plus ancien", () => {
  const dir = tmpDir();
  ecrire(dir, "première leçon sur les ports", "reseau,ports");
  ecrire(dir, "seconde leçon sur les tests visuels", "preuve,visuel");
  const out = cliJson(["lessons", "--dir", dir, "--kyber", "k"]);
  const k = out.kybers[0];
  assert.strictEqual(k.total, 2);
  assert.strictEqual(k.matches, 2);
  assert.strictEqual(k.lessons[0].text, "seconde leçon sur les tests visuels");
  assert.deepStrictEqual(k.lessons[0].tags, ["preuve", "visuel"]);
  assert.strictEqual(k.lessons[0].index, 1, "l'index est l'index BRUT dans lessons.jsonl");
});

test("lessons : --tag filtre, --q cherche dans le texte, --limit borne", () => {
  const dir = tmpDir();
  ecrire(dir, "alpha un", "reseau");
  ecrire(dir, "beta deux", "preuve");
  ecrire(dir, "gamma trois", "preuve");
  assert.strictEqual(cliJson(["lessons", "--dir", dir, "--kyber", "k", "--tag", "preuve"]).kybers[0].matches, 2);
  assert.strictEqual(cliJson(["lessons", "--dir", dir, "--kyber", "k", "--q", "gamma"]).kybers[0].matches, 1);
  const borne = cliJson(["lessons", "--dir", dir, "--kyber", "k", "--limit", "1"]).kybers[0];
  assert.strictEqual(borne.matches, 3);
  assert.strictEqual(borne.shown, 1);
  assert.strictEqual(borne.lessons.length, 1);
});

/* --------------------------- éviction : archiver --------------------------- */

test("lesson : au-delà du plafond, l'éviction ARCHIVE au lieu de détruire", () => {
  const dir = tmpDir();
  // Toutes les leçons ont le MÊME nombre d'usages : l'arbitrage se fait alors
  // sur l'ancienneté, et c'est la plus vieille qui part.
  for (let i = 0; i < LESSONS_MAX_COUNT + 2; i++) {
    ecrire(dir, "leçon numero " + i, "cap", 3, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString());
  }
  const hot = lireJsonl(path.join(dir, "lessons.jsonl"));
  const archive = lireJsonl(path.join(dir, "lessons.archive.jsonl"));
  assert.strictEqual(hot.length, LESSONS_MAX_COUNT, "le magasin chaud tient le plafond");
  assert.strictEqual(archive.length, 2, "les deux chassées sont dans l'archive, pas perdues");
  assert.strictEqual(archive[0].archivedBecause, "cap:" + LESSONS_MAX_COUNT);
  assert.ok(archive.every((l) => typeof l.archivedAt === "string" && l.archivedAt.length > 0));
  assert.ok(hot.some((l) => l.text === "leçon numero 50"), "les récentes restent");
  assert.ok(!hot.some((l) => l.text === "leçon numero 0"), "les plus vieilles partent à l'archive");
});

test("lesson : la leçon qu'on vient d'écrire n'est JAMAIS celle qu'on chasse", () => {
  // Le défaut trouvé le 22/09 : la nouvelle leçon arrive avec `uses: 0`, donc
  // sur un magasin plein elle triait première et était détruite dans l'écriture
  // même qui l'avait créée — dès qu'une autre leçon avait un `uses` non nul.
  const dir = tmpDir();
  for (let i = 0; i < LESSONS_MAX_COUNT; i++) {
    ecrire(dir, "ancienne " + i, "cap", 9, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString());
  }
  ecrire(dir, "celle que je viens d'apprendre", "neuve");
  const hot = lireJsonl(path.join(dir, "lessons.jsonl"));
  assert.strictEqual(hot.length, LESSONS_MAX_COUNT);
  assert.ok(hot.some((l) => l.text === "celle que je viens d'apprendre"), "la nouvelle survit à son écriture");
  assert.strictEqual(lireJsonl(path.join(dir, "lessons.archive.jsonl")).length, 1);
});

/* ------------------------- consolidate : fusionner ------------------------- */

test("consolidate : le même piège écrit deux fois devient une leçon, uses additionnés", () => {
  const dir = tmpDir();
  ecrire(dir, "Un plafond muet est un mensonge : paginer, jamais couper.", "preuve", 1, "2026-01-01T00:00:00.000Z");
  ecrire(dir, "un plafond muet est un mensonge, paginer jamais couper", "preuve", 4, "2026-02-01T00:00:00.000Z");
  ecrire(dir, "Autre chose, sans rapport.", "ui", 0, "2026-03-01T00:00:00.000Z");
  const res = cliJson(["consolidate", "--dir", dir, "--kyber", "k"]);
  assert.strictEqual(res.before, 3);
  assert.strictEqual(res.after, 2);
  assert.strictEqual(res.merged, 1);
  const hot = lireJsonl(path.join(dir, "lessons.jsonl"));
  const gardee = hot.find((l) => l.text === "un plafond muet est un mensonge, paginer jamais couper");
  assert.ok(gardee, "c'est la copie la plus utilisée qui reste");
  assert.strictEqual(gardee.uses, 5, "les uses des deux copies s'additionnent");
  assert.strictEqual(lireJsonl(path.join(dir, "lessons.archive.jsonl")).length, 1);
});

test("consolidate --dry-run ne change rien sur le disque", () => {
  const dir = tmpDir();
  ecrire(dir, "doublon identique", "t");
  ecrire(dir, "doublon identique", "t");
  const avant = fs.readFileSync(path.join(dir, "lessons.jsonl"), "utf8");
  const res = cliJson(["consolidate", "--dir", dir, "--kyber", "k", "--dry-run"]);
  assert.strictEqual(res.dryRun, true);
  assert.strictEqual(res.merged, 1);
  assert.strictEqual(fs.readFileSync(path.join(dir, "lessons.jsonl"), "utf8"), avant);
  assert.strictEqual(fs.existsSync(path.join(dir, "lessons.archive.jsonl")), false);
});

/* ----------------------------------- stats --------------------------------- */

test("stats : annonce les leçons gardées, et l'archive séparément", () => {
  // `stats --dir` prend une RACINE DE KYBERS (comme ~/.dsh/kybers), pas un
  // dossier de mémoire : c'est `<racine>/<kyber>/memory` qu'il balaie.
  const racine = tmpDir();
  const dir = path.join(racine, "k", "memory");
  ecrire(dir, "une", "t", 2);
  ecrire(dir, "deux", "t");
  const st = cliJson(["stats", "--dir", racine, "--kyber", "k"]);
  const k = st.kybers.find((x) => x.kyber === "k");
  assert.strictEqual(k.lessons, 2);
  assert.strictEqual(k.lessonsUsed, 1);
  assert.strictEqual(k.ledgerLines, 0);
});
