#!/usr/bin/env node
/**
 * kyber-lint — validateur structurel des définitions de kyber.
 *
 * Vérifie ce qu'un agent ne voit pas en lisant un kyber.yml :
 *   - un rôle qu'aucune étape n'atteint (rôle orphelin = rôle qui ne tourne jamais)
 *   - un étage qui référence un rôle ou un étage inexistant
 *   - une dépendance cyclique ou déclarée avant sa source
 *   - une topologie déclarée qui contredit les étages
 *   - un provider/model absent de ~/.dsh/settings.yaml
 *
 * Usage :  node ~/.dsh/kybers/lint.cjs [kyber-id ...]
 * Sortie  : 0 si tout passe, 1 dès qu'une erreur est trouvée.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");

/* Le répertoire est surchargeable, et ce n'est pas un confort : un installateur
   DOIT pouvoir valider une COPIE qu'il vient d'écrire ailleurs que dans
   $DSH_HOME/kybers. Sans cette surcharge il est obligé de fabriquer des liens
   symboliques pour vérifier son propre travail — constaté lors d'un test
   d'installation réel, où le harnais de validation a dû être reconstruit dans
   /tmp. Un validateur qu'on ne peut pas pointer sur ce qu'on vient d'écrire ne
   valide rien. */
function resolveKybersDir() {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--dir="));
  if (arg) return path.resolve(arg.slice("--dir=".length));
  if (process.env.KYBER_LINT_DIR) return path.resolve(process.env.KYBER_LINT_DIR);
  return path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "kybers");
}
const KYBERS_DIR = resolveKybersDir();
const PRESET_SKILLS = path.join(
  process.env.KYBER_LINT_SKILLS || path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), ".agent-presets"),
  "kyber",
  "skills",
);
const SETTINGS = path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "settings.yaml");

const SHAPES = ["pool", "pipeline", "adversarial", "mapreduce", "loop"];
const MODES = ["once", "forEach", "untilConverged"];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function loadYaml() {
  const candidates = [];
  try {
    const root = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (root) candidates.push(path.join(root, "@deepseek-ai/dsh/node_modules/yaml"));
  } catch {
    /* npm absent : on tente les chemins connus */
  }
  candidates.push("/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/yaml");
  candidates.push("/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/yaml");
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* candidat suivant */
    }
  }
  return null;
}

function declaredModels() {
  const YAML = loadYaml();
  if (!YAML || !fs.existsSync(SETTINGS)) return null;
  try {
    const doc = YAML.parse(fs.readFileSync(SETTINGS, "utf8"));
    const providers = (doc["llm-pi-ai"] && doc["llm-pi-ai"].providers) || {};
    const map = new Map();
    for (const [p, v] of Object.entries(providers)) {
      for (const m of (v && v.models) || []) {
        map.set(p + "|" + m.id, {
          provider: p,
          id: m.id,
          input: Array.isArray(m.input) ? m.input : ["text"],
          contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : null,
        });
      }
    }
    return map;
  } catch {
    return null;
  }
}

const NEED_KEYS = ["modality", "tier", "context"];
const MODALITIES = ["text", "image"];
const TIERS = ["fast", "balanced", "deep"];
const CONTEXTS = ["standard", "large"];

/* Version de la spec que CE lint comprend. Un kyber qui en déclare une plus
   récente est refusé, pas deviné. Voir la règle de compatibilité dans
   lintKyber, et `INSTALL.md` §7 pour la politique de publication. */
const SPEC_VERSION = 2;
const KNOWN_TOP_FIELDS = [
  "id", "specVersion", "mission", "topology", "stages", "roles", "memory", "skills", "tools", "provenance",
  "elucidation", "maxDepth",
];
const STAGE_FIELDS = [
  "id", "roles", "inputs", "mode", "maxRounds", "adversarial",
  "cap", "gate", "definitionOfDone",
];
/* `sourcePath` existe pour le cas `origin: local`. Sans lui, un kyber écrit
   localement ne peut PAS enregistrer d'où il vient : la liste fermée le refuse,
   et l'installateur n'a alors que deux mauvaises options — inventer un champ, ou
   ne rien noter du tout. Constaté lors d'un test d'installation réel, où
   `sourcePath` a produit une erreur dure. */
const PROVENANCE_FIELDS = ["origin", "url", "commit", "installedAt", "installedBy", "sourcePath", "license", "author", "installHint"];

/* Noms réservés (CONVENTION.md §3) : un kyber ainsi nommé pourrait être confondu
   avec la spec ou son outillage. Le contrôle est insensible à la casse.
   AJOUTER UN NOM ICI EST UN CHANGEMENT DE RUPTURE : un kyber déjà publié sous ce
   nom devient invalide sans avoir changé. Toute addition doit s'accompagner d'une
   incrémentation de SPEC_VERSION. */
const RESERVED_NAMES = [
  "mcp", "spec", "format", "schema", "core", "cli", "lint", "validate", "install", "init",
  "search", "registry", "index", "template", "example", "starter", "boilerplate",
  "official", "docs", "www", "site", "test", "ci", "sdk", "lib",
];

/* Résultats de sonde : DÉCLARÉ n'est pas SERVI. Un modèle peut être présent dans
   settings.yaml et ne jamais répondre — constaté sur zai-coding-cn/glm-5v-turbo,
   qui est justement le seul à déclarer une grande fenêtre de contexte. Sans ce
   fichier, le lint ne peut juger que des déclarations, et il le dira. */
function loadProbes() {
  const f = path.join(KYBERS_DIR, ".probe.json");
  if (!fs.existsSync(f)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(f, "utf8"));
    const map = new Map();
    for (const [k, v] of Object.entries(doc.results || {})) map.set(k, v);
    return { map, probedAt: doc.probedAt || null };
  } catch {
    return null;
  }
}

function classify(candidates, probes, need) {
  const declared = candidates.map((m) => m.provider + "/" + m.id);
  if (probes) {
    const alive = candidates.filter((m) => {
      const p = probes.map.get(m.provider + "|" + m.id);
      return !(p && p.ok === false);
    });
    const dead = candidates.filter((m) => {
      const p = probes.map.get(m.provider + "|" + m.id);
      return p && p.ok === false;
    });
    if (alive.length) {
      return { need, status: "OK", how: alive.map((m) => m.provider + "/" + m.id).join(", ") };
    }
    if (dead.length) {
      return {
        need,
        status: "INDISPONIBLE",
        how:
          "candidat(s) déclaré(s) " +
          dead.map((m) => m.provider + "/" + m.id).join(", ") +
          " — SONDÉ(S) ET SANS RÉPONSE. Déclaré n'est pas servi.",
      };
    }
  }
  if (declared.length) {
    return { need, status: "DÉCLARÉ", how: declared.join(", ") + " — non sondé, donc non prouvé" };
  }
  return { need, status: "INDISPONIBLE", how: "aucun modèle déclaré ne satisfait cette exigence" };
}

/* Résolution des exigences PORTABLES contre les modèles de cette plateforme.
   `modality` et `context` sont des exigences DURES : une non-satisfaction est
   rapportée comme INDISPONIBLE, jamais substituée. `tier` est une préférence
   molle et n'est PAS vérifiable statiquement — le harness n'expose ni vitesse
   ni prix, donc le lint le dit au lieu de faire semblant. */
function resolveNeeds(role, models, probes) {
  const needs = (role && role.needs) || {};
  const out = { role: role && role.id, hard: [], soft: [] };
  if (models) {
    const all = [...models.values()];
    if (needs.modality === "image") {
      out.hard.push(classify(all.filter((m) => m.input.includes("image")), probes, "modality: image"));
    }
    if (needs.context === "large") {
      out.hard.push(
        classify(all.filter((m) => m.contextWindow !== null && m.contextWindow >= 100000), probes, "context: large"),
      );
    }
  }
  if (needs.tier) {
    out.soft.push({
      need: "tier: " + needs.tier,
      status: "non vérifiable",
      how: "le harness n'expose ni vitesse ni prix — seule la mémoire apprise peut trancher",
    });
  }
  return out;
}

function lintKyber(id, served, probes) {
  const errors = [];
  const warnings = [];
  const file = path.join(KYBERS_DIR, id, "kyber.yml");
  const YAML = loadYaml();

  if (!YAML) {
    return { id, errors: ["parseur YAML introuvable — lint impossible"], warnings };
  }
  if (!fs.existsSync(file)) {
    return { id, errors: ["kyber.yml absent"], warnings };
  }

  let k;
  try {
    k = YAML.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { id, errors: ["YAML invalide : " + e.message], warnings };
  }

  if (k.id !== id) errors.push(`id "${k.id}" != répertoire "${id}"`);
  if (!KEBAB.test(String(k.id || ""))) errors.push(`id non kebab-case : "${k.id}"`);
  if (RESERVED_NAMES.includes(String(k.id || "").toLowerCase())) {
    errors.push(
      `id "${k.id}" est un nom RÉSERVÉ (CONVENTION.md §3) — il pourrait être confondu avec la spec ou son outillage`,
    );
  }

  /* --- version de spec ---
     Règle de compatibilité : REFUSER EN AVANT, ACCEPTER EN ARRIÈRE.
     Un kyber écrit pour une spec plus récente peut porter des champs que ce
     lint ne connaît pas — et ces champs peuvent être la topologie ou une
     exigence dure. L'installer en silence le viderait de sa forme sans que
     personne ne le voie. On refuse donc, franchement. */
  const sv = k.specVersion;
  if (sv === undefined) {
    warnings.push(`specVersion absent — supposé ${SPEC_VERSION}. Ajoute-le : sans lui, aucun contrôle de compatibilité n'est possible`);
  } else if (!Number.isInteger(sv)) {
    errors.push(`specVersion non entier : ${JSON.stringify(sv)}`);
  } else if (sv > SPEC_VERSION) {
    errors.push(
      `specVersion ${sv} > ${SPEC_VERSION} supportée — kyber écrit pour une spec plus récente. REFUSÉ : ` +
        `des champs inconnus peuvent porter la topologie ou une exigence dure, et l'installer les perdrait en silence`,
    );
  } else if (sv < SPEC_VERSION) {
    warnings.push(`specVersion ${sv} < ${SPEC_VERSION} — vérifie qu'aucune exigence dure n'est absente`);
  }

  for (const key of Object.keys(k)) {
    if (!KNOWN_TOP_FIELDS.includes(key)) {
      warnings.push(`champ de premier niveau inconnu "${key}" — conservé tel quel par l'installateur, jamais supprimé`);
    }
  }

  /* --- provenance ---
     Renseignée par l'installateur, jamais par l'auteur. Elle existe pour que
     l'on puisse répondre plus tard à « d'où vient ce kyber et qu'a-t-il
     exactement exécuté ». */
  if (k.provenance !== undefined) {
    const p = k.provenance;
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      errors.push("provenance non objet");
    } else {
      for (const key of Object.keys(p)) {
        if (!PROVENANCE_FIELDS.includes(key)) errors.push(`provenance.${key} inconnu (attendu : ${PROVENANCE_FIELDS.join(", ")})`);
      }
      if (p.origin !== undefined && !["local", "repository"].includes(p.origin)) {
        errors.push(`provenance.origin="${p.origin}" (attendu : local | repository)`);
      }
      if (p.origin === "repository") {
        if (!p.url) errors.push("provenance.origin=repository sans provenance.url");
        if (!p.commit) {
          errors.push("provenance.origin=repository sans provenance.commit — un tag ou une branche bouge, un commit non");
        }
        if (!p.installedAt) errors.push("provenance.origin=repository sans provenance.installedAt");
        /* L'attribution est le rouage viral (CONVENTION.md §10) : sans auteur, un
           kyber publié ne rapporte rien à qui l'a écrit, donc personne ne publie. */
        if (!p.author) {
          errors.push("provenance.origin=repository sans provenance.author — un kyber partagé doit nommer son auteur");
        }
      }
    }
  }

  const mission = String(k.mission || "").trim();
  if (mission.length < 40) {
    errors.push(`mission absente ou trop courte (${mission.length} car.) — la sélection compare les missions`);
  }

  /* --- rôles --- */
  const roles = Array.isArray(k.roles) ? k.roles : [];
  if (roles.length === 0) errors.push("aucun rôle défini");
  const roleIds = new Set();
  for (const r of roles) {
    const rid = String((r && r.id) || "");
    if (!KEBAB.test(rid)) errors.push(`rôle id non kebab-case : "${rid}"`);
    if (roleIds.has(rid)) errors.push(`rôle id dupliqué : "${rid}"`);
    roleIds.add(rid);
    for (const field of ["provider", "model", "prompt"]) {
      if (!r || !r[field] || typeof r[field] !== "string") errors.push(`rôle "${rid}" : champ "${field}" manquant`);
    }
    if (r && r.provider && r.model && served && !served.has(r.provider + "|" + r.model)) {
      errors.push(`rôle "${rid}" : ${r.provider}/${r.model} absent de settings.yaml`);
    }
    if (r && r.prompt && String(r.prompt).trim().length < 30) {
      warnings.push(`rôle "${rid}" : prompt très court (${String(r.prompt).trim().length} car.)`);
    }

    const needs = r && r.needs;
    if (!needs || typeof needs !== "object") {
      warnings.push(`rôle "${rid}" : pas de "needs" — la spec n'est portable que par ses ids de modèle, qui ne le sont pas`);
    } else {
      for (const k of Object.keys(needs)) {
        if (!NEED_KEYS.includes(k)) errors.push(`rôle "${rid}" : needs.${k} inconnu (attendu : ${NEED_KEYS.join(", ")})`);
      }
      if (needs.modality !== undefined && !MODALITIES.includes(needs.modality)) {
        errors.push(`rôle "${rid}" : needs.modality="${needs.modality}" (attendu : ${MODALITIES.join(" | ")})`);
      }
      if (needs.tier !== undefined && !TIERS.includes(needs.tier)) {
        errors.push(`rôle "${rid}" : needs.tier="${needs.tier}" (attendu : ${TIERS.join(" | ")})`);
      }
      if (needs.context !== undefined && !CONTEXTS.includes(needs.context)) {
        errors.push(`rôle "${rid}" : needs.context="${needs.context}" (attendu : ${CONTEXTS.join(" | ")})`);
      }
    }
  }

  /* --- topologie --- */
  const stages = Array.isArray(k.stages) ? k.stages : [];
  const topology = k.topology;

  if (stages.length === 0) {
    errors.push("aucun étage défini — un rôle hors étape ne tourne jamais");
  }
  if (!topology) {
    errors.push("topology non déclarée (pool | pipeline | adversarial | mapreduce | loop)");
  } else if (!SHAPES.includes(topology)) {
    errors.push(`topology inconnue : "${topology}"`);
  }

  const seen = new Map();
  const reached = new Map();
  let adversarialStages = 0;

  /* --- doctrine au niveau du kyber --- */
  if (k.elucidation !== undefined && !["required", "none"].includes(k.elucidation)) {
    errors.push(`elucidation="${k.elucidation}" (attendu : required | none)`);
  }
  if (k.maxDepth !== undefined && ![0, 1].includes(k.maxDepth)) {
    errors.push(
      `maxDepth=${JSON.stringify(k.maxDepth)} — 0 ou 1 seulement. Un subagent ne se re-délègue pas indéfiniment : ` +
        `au-delà de 1, personne ne sait plus qui a lancé quoi ni à qui imputer un échec`,
    );
  }

  stages.forEach((st, idx) => {
    const sid = String((st && st.id) || "");
    if (!KEBAB.test(sid)) errors.push(`étage #${idx} : id non kebab-case : "${sid}"`);
    if (seen.has(sid)) errors.push(`étage id dupliqué : "${sid}"`);
    seen.set(sid, idx);

    const stRoles = Array.isArray(st && st.roles) ? st.roles : [];
    if (stRoles.length === 0) errors.push(`étage "${sid}" : aucun rôle`);
    for (const rid of stRoles) {
      if (!roleIds.has(rid)) errors.push(`étage "${sid}" : rôle inconnu "${rid}"`);
      const prev = reached.get(rid);
      if (prev !== undefined) errors.push(`rôle "${rid}" atteint par deux étages ("${prev}" et "${sid}")`);
      reached.set(rid, sid);
    }

    const inputs = Array.isArray(st && st.inputs) ? st.inputs : [];
    for (const dep of inputs) {
      if (!seen.has(dep)) {
        errors.push(`étage "${sid}" : dépendance "${dep}" inexistante ou déclarée APRÈS lui (cycle)`);
      }
    }

    const mode = (st && st.mode) || "once";
    if (!MODES.includes(mode)) errors.push(`étage "${sid}" : mode inconnu "${mode}"`);
    if (mode === "untilConverged" && !(st && st.maxRounds > 0)) {
      errors.push(`étage "${sid}" : mode untilConverged sans maxRounds — boucle non bornée`);
    }
    if (mode === "forEach" && inputs.length === 0) {
      /* Un étage RACINE ne peut pas avoir d'`inputs`, et le fan-out read-only est
         pourtant la vague parallèle la moins risquée d'une doctrine réelle :
         « N scouts read-only sur des zones disjointes ». Ce que `forEach` itère
         est ici déterminé par le rôle, pas par un étage amont. Avertissement et
         non erreur : c'est moins vérifiable, ce n'est pas incohérent. */
      warnings.push(
        `étage "${sid}" : forEach sur un étage racine — ce qui est itéré vient du rôle, pas d'un amont : rien ne borne le nombre d'itérations`,
      );
    }

    /* --- champs de doctrine, repris de kybernos-parallel et kybernos-delegation ---
       Ces trois-là ne sont pas des détails : sans `cap`, rien ne borne le
       parallélisme ; sans `gate`, une implémentation peut partir avant que la
       spec soit validée ; sans `definitionOfDone`, « terminé » n'est vérifiable
       par personne. */
    if (st && st.cap !== undefined) {
      if (!Number.isInteger(st.cap) || st.cap < 1) {
        errors.push(`étage "${sid}" : cap doit être un entier >= 1 (reçu : ${JSON.stringify(st.cap)})`);
      }
    }
    if (st && st.gate !== undefined && typeof st.gate !== "boolean") {
      errors.push(`étage "${sid}" : gate doit être booléen`);
    }
    /* Une porte sur un ÉTAGE D'ENTRÉE est légitime et était refusée à tort.
       Trois kybers écrits indépendamment ont buté dessus, parce que les deux
       portes les plus importantes d'une doctrine réelle sont celle de l'entrée
       (« aucune collecte avant que l'humain ait répondu ») et celle de la sortie
       (« rien ne part en production sans validation humaine »), et l'étage
       d'entrée n'a pas d'`inputs` par définition.
       Le contrôle « la porte doit garder quelque chose » est déjà assuré plus
       bas : un étage en aval doit citer cette porte dans ses `inputs`. Un étage
       d'entrée que personne ne consomme reste donc refusé, sans qu'il faille
       exiger des `inputs` à une porte qui, par nature, n'en a pas. */
    if (st && st.gate === true && inputs.length === 0) {
      warnings.push(
        `étage "${sid}" : gate sur un étage d'entrée — rien ne démarre avant sa validation`,
      );
    }
    if (st && st.definitionOfDone !== undefined) {
      if (!Array.isArray(st.definitionOfDone) || st.definitionOfDone.length === 0) {
        errors.push(`étage "${sid}" : definitionOfDone doit être une liste non vide de commandes`);
      } else {
        for (const c of st.definitionOfDone) {
          if (typeof c !== "string" || c.trim().length === 0) {
            errors.push(`étage "${sid}" : definitionOfDone contient une entrée vide — une DoD non vérifiable par commande n'est pas une DoD`);
          }
        }
      }
    }
    for (const key of Object.keys(st || {})) {
      if (!STAGE_FIELDS.includes(key)) {
        warnings.push(`étage "${sid}" : champ inconnu "${key}" — conservé tel quel, jamais supprimé`);
      }
    }

    if (st && st.adversarial === true) {
      adversarialStages++;
      /* Un étage adversarial RÉFUTE la sortie d'un autre : il a donc besoin
         d'inputs. C'est la seule vraie condition. Interdire `adversarial: true`
         hors de `topology: adversarial` était trop strict — un pipeline de
         développement contient légitimement une étape de revue qui réfute le
         travail de l'implémenteur, sans que tout le kyber soit une machine à
         réfuter. La seule topologie où un étage adversarial n'a pas de sens est
         `pool`, où il n'existe aucune dépendance par définition (et le contrôle
         ci-dessous le refuse déjà, puisque `pool` interdit les inputs). */
      if (inputs.length === 0) {
        errors.push(`étage "${sid}" : adversarial sans inputs — un réfutateur sans cible`);
      }
      if (topology === "pool") {
        errors.push(`étage "${sid}" : adversarial:true sous topology="pool" — un réservoir n'a pas de dépendances à réfuter`);
      }
    }

    if (topology === "pool" && inputs.length > 0) {
      errors.push(`étage "${sid}" : topology="pool" mais des inputs déclarent une dépendance`);
    }
  });

  if (topology === "adversarial" && adversarialStages === 0) {
    errors.push('topology="adversarial" mais aucun étage adversarial:true');
  }

  /* Une porte doit garder quelque chose. Les inputs ne peuvent référencer qu'un
     étage DÉCLARÉ AVANT (contrôle de cycle ci-dessus), donc « en aval » = un étage
     ultérieur dont les inputs citent cette porte. */
  for (const [sid, idx] of seen) {
    if (stages[idx] && stages[idx].gate === true) {
      const downstream = stages.some((o) => Array.isArray(o && o.inputs) && o.inputs.includes(sid));
      /* Une porte TERMINALE est légitime, et elle était refusée à tort. La porte la
         plus coûteuse d'une doctrine réelle est la dernière : « rien ne part en
         production sans validation humaine ». Elle ne garde aucun étage — elle
         garde la LIVRAISON, donc l'absence d'aval est sa définition, pas un défaut.
         Un kyber réel a dû la taire, et son auteur a refusé d'ajouter un étage
         factice dont le seul rôle serait de la rendre déclarable — ce qui aurait
         été exactement le lancement spéculatif que `gate` existe pour empêcher. */
      const hasLaterStage = stages.some((o, j) => j > idx && Array.isArray(o && o.inputs) && o.inputs.length);
      if (!downstream && !hasLaterStage) {
        warnings.push(`étage "${sid}" : gate terminal — aucun étage en aval, la porte garde la livraison`);
      } else if (!downstream) {
        errors.push(`étage "${sid}" : gate sans étage en aval qui en dépend — la porte ne garde rien`);
      }
    }
  }

  const orphans = [...roleIds].filter((r) => !reached.has(r));
  for (const o of orphans) errors.push(`rôle ORPHELIN "${o}" — atteint par aucune étape, il ne tournera jamais`);

  /* --- `role:` (la spécialité) --- */
  /* Ce champ n'était validé par RIEN : il n'était lu que pour l'affichage, alors
     qu'INSTALL.md §1 le présente comme vital pour la mémoire et que deux kybers
     écrits indépendamment l'ont signalé. Un champ dont dépend l'apprentissage ne
     peut pas être un commentaire décoratif. */
  const bySpecialty = {};
  for (const r of roles) {
    if (r.role === undefined) {
      warnings.push(`rôle "${r.id}" : pas de champ role: — le report inter-kybers par spécialité sera impossible`);
      continue;
    }
    if (typeof r.role !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.role)) {
      errors.push(`rôle "${r.id}" : role="${r.role}" doit être un jeton ASCII minuscule à tirets (auditor, business-analyst) — c'est une clé de report, pas une phrase`);
    }
    (bySpecialty[r.role] = bySpecialty[r.role] || []).push(r.id);
  }
  for (const [spec, ids] of Object.entries(bySpecialty)) {
    if (ids.length > 1) {
      /* Légitime (deux scouts sur des zones disjointes) mais jamais anodin.
         Le routage n'est PAS affecté — la clé d'apprentissage est l'`id` — mais
         tout report inter-kybers fondé sur la spécialité fusionnera ces métiers.
         Cas réel : `auditeur` (constate) et `verificateur` (réfute) partageaient
         `role: auditor`, deux métiers opposés sous une seule étiquette de report. */
      warnings.push(`role="${spec}" partagé par ${ids.join(", ")} — le routage reste distinct (clé = id), mais le report inter-kybers les fusionnera`);
    }
  }

  /* --- mémoire et skills --- */
  if (!k.memory) errors.push("champ memory manquant — pas de boucle d'apprentissage");
  const skills = Array.isArray(k.skills) ? k.skills : [];
  if (skills.length === 0) warnings.push("aucune skill déclarée");
  for (const s of skills) {
    /* Une skill peut venir de TROIS endroits, et le troisième est celui qui rend
       un kyber publiable : le preset (partagée entre kybers), le preset local de
       la plateforme, ou le kyber lui-même. Un kyber distribué DOIT pouvoir
       emporter ses skills — sinon il n'est installable que sur la machine de son
       auteur, et le format devient un format de fichiers locaux. */
    const found = [
      path.join(PRESET_SKILLS, s, "SKILL.md"),
      path.join(KYBERS_DIR, id, "skills", s, "SKILL.md"),
    ].some((p) => fs.existsSync(p));
    if (!found) {
      errors.push(`skill "${s}" introuvable — ni dans le preset (${PRESET_SKILLS}) ni dans ${path.join(KYBERS_DIR, id, "skills")}`);
    }
  }

  if (k.tools !== undefined && !Array.isArray(k.tools)) {
    errors.push("champ tools non tableau — déclare les besoins en connecteurs, ou []");
  } else if (Array.isArray(k.tools) && k.tools.length > 0) {
    warnings.push(
      `${k.tools.length} connecteur(s) déclaré(s) : ${k.tools.join(", ")} — un kyber DÉCLARE ses besoins, seul le preset les fournit`,
    );
  }

  const resolutions = roles.map((r) => resolveNeeds(r, served, probes)).filter((x) => x.hard.length || x.soft.length);

  /* Un kyber SANS AUCUNE `definitionOfDone` passait la validation en silence, alors
     que la spec présente ce champ comme LA garantie que « terminé » est
     vérifiable. Constaté sur un kyber réel dont le livrable n'est pas un artefact
     (un kyber socratique : son critère d'achèvement se constate dans une tête, pas
     dans une commande) — l'auteur a refusé d'écrire une fausse commande, et rien
     ne l'a signalé. Avertissement et non erreur : l'absence peut être le bon
     choix, mais elle ne doit jamais être silencieuse. */
  if (stages.length > 0 && !stages.some((s) => Array.isArray(s.definitionOfDone) && s.definitionOfDone.length)) {
    warnings.push(
      "aucune definitionOfDone sur aucun étage — rien ne prouve mécaniquement qu'un run a réussi. Si c'est délibéré (livrable non-artefact), dis-le dans le README du kyber.",
    );
  }

  return { id, errors, warnings, resolutions };
}

/* ------------------------------- exécution ------------------------------- */

const yamlOk = loadYaml() !== null;
const served = declaredModels();
const probes = loadProbes();

let ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (ids.length === 0) {
  ids = fs.existsSync(KYBERS_DIR)
    ? fs.readdirSync(KYBERS_DIR).filter((d) => !d.startsWith(".") && fs.statSync(path.join(KYBERS_DIR, d)).isDirectory())
    : [];
}

if (ids.length === 0) {
  console.log("Aucun kyber à valider dans " + KYBERS_DIR);
  process.exit(0);
}

console.log(`kyber-lint — ${ids.length} kyber(s) dans ${KYBERS_DIR}`);
if (!yamlOk) console.log("  (parseur YAML introuvable : validation impossible)");
if (served === null) console.log("  (settings.yaml illisible : contrôle des modèles désactivé)");
if (probes === null) {
  console.log("  (aucun .probe.json : la résolution ne juge que des DÉCLARATIONS — un modèle déclaré peut ne pas répondre)");
} else {
  console.log(`  (sondes du ${probes.probedAt} : ${probes.map.size} modèle(s) réellement exercés)`);
}

let failures = 0;
let unsatisfied = 0;
let declaredOnly = 0;
for (const id of ids) {
  const { errors, warnings, resolutions } = lintKyber(id, served, probes);
  const mark = errors.length === 0 ? "PASS" : "FAIL";
  console.log(`\n${mark}  ${id}`);
  for (const e of errors) console.log(`   ERREUR  ${e}`);
  for (const w of warnings) console.log(`   avert.  ${w}`);
  if (errors.length === 0 && warnings.length === 0) console.log("   structure complète");

  if (resolutions && resolutions.length) {
    console.log("   — résolution des exigences portables (plateforme : DSH) —");
    for (const r of resolutions) {
      for (const h of r.hard) {
        if (h.status === "INDISPONIBLE") unsatisfied++;
        if (h.status === "DÉCLARÉ") declaredOnly++;
        const tag = h.status === "OK" ? "OK          " : h.status === "DÉCLARÉ" ? "DÉCLARÉ     " : "INDISPONIBLE";
        console.log(`     ${tag}  ${r.role} · ${h.need} → ${h.how}`);
      }
      for (const s of r.soft) console.log(`     ${s.status.padEnd(12)}  ${r.role} · ${s.need} → ${s.how}`);
    }
  }

  if (errors.length) failures++;
}

const notes = [];
if (unsatisfied) notes.push(`${unsatisfied} exigence(s) dure(s) NON SATISFAITE(S) sur cette plateforme`);
if (declaredOnly) notes.push(`${declaredOnly} exigence(s) dure(s) seulement DÉCLARÉE(S), non sondée(S)`);
console.log(
  failures === 0
    ? `\n${ids.length}/${ids.length} kyber(s) valides` + (notes.length ? " — " + notes.join(", ") : "")
    : `\n${failures}/${ids.length} kyber(s) invalides`,
);
process.exit(failures === 0 ? 0 : 1);
