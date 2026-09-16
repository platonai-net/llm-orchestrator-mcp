# CHANGELOG — spec kybernos

Journal des modifications du **format** et des documents normatifs. Toute
modification de `CONVENTION.md`, `INSTALL.md`, `INSTALL-PROMPT.md` ou `lint.cjs`
DOIT apparaître ici — y compris une correction de rédaction.

Un installateur qui épingle un commit (`INSTALL.md` §0) doit pouvoir lire ce qui a
changé entre ce commit et aujourd'hui. C'est la contrepartie de l'exigence qu'on
impose aux kybers.

## SPEC-VERSION 2 — 2026-09-16

**Rupture.** Cinq champs qui changent le comportement à l'exécution ont été
ajoutés ; un consommateur qui les ignore produit un résultat différent sans le
signaler. Motif : la doctrine d'orchestration du projet `kybernos`
(`kybernos-parallel`, `kybernos-delegation`) contient cinq mécanismes que le
format v1 n'avait aucun moyen d'exprimer.

### Ajouté — au niveau du kyber

- `elucidation: none | required` — l'orchestrateur DOIT interroger l'humain avant
  de composer l'équipe. Repris du « HARD MANDATE: interview first » des gabarits de
  domaines, qui ne lancent jamais d'agents sur des hypothèses.
- `maxDepth: 0 | 1` — garde de récursion. `depth >= 2` interdit : au-delà, personne
  ne sait plus qui a lancé quoi ni à qui imputer un échec.

### Ajouté — au niveau d'un étage

- `cap: <entier >= 1>` — plafond d'agents simultanés. Repris du cap dur à 6.
- `gate: true` — rien en aval ne part avant que cet étage valide. Repris du « zéro
  lancement spéculatif pré-GO ». Exige des `inputs` **et** un étage en aval.
- `definitionOfDone: [<commandes>]` — « une DoD non vérifiable par commande n'est
  pas une DoD ». Repris du contrat de délégation.

### Ajouté — provenance

- `provenance.author` **obligatoire** dès `origin: repository` (attribution, §10).
- `provenance.installHint` — la ligne qui permet au lecteur d'un livrable
  d'installer le kyber qui l'a produit. Ferme la boucle virale.

### Ajouté — convention

- Préfixe `kybernos-contrib-<nom>` pour les kybers tiers (précédent
  `node-red-contrib-*`). `kybernos.app-contrib-<nom>` reste **rejeté** : le point
  casse la requête `q=kybernos- in:name`.
- `contrib-` est un marqueur de **publication**, jamais une partie de l'`id`.
- Noms réservés : 25 entrées, refusées par le validateur.
- `lessons.jsonl` **publiable** ; `ledger.jsonl` et `routing.local.json` **jamais**.

### Corrigé — mes propres erreurs

- **« Ajouter un champ optionnel n'est pas une rupture » était faux.** Le critère
  n'est pas *obligatoire ou optionnel*, c'est : *un consommateur qui ignore ce
  champ produit-il un résultat différent ?* `gate: true` ignoré fait partir
  l'étage suivant sans attendre la validation. D'où la rupture de version.
- **« Le renommage casse les `provenance.url` » était faux.** GitHub redirige
  aussi les dépôts renommés, pas seulement les transférés.
- **`adversarial: true` hors de `topology: adversarial` n'est plus refusé.** Un
  pipeline contient légitimement une revue qui réfute l'implémenteur. Refusé
  seulement sous `pool`.
- **`role` et `specialty` séparés** dans le ledger. Les confondre fusionnait
  `auditeur` et `verificateur`, deux métiers opposés, sous une seule clé.
- **`tools:` est une déclaration, pas une fourniture.** Seul le preset possède les
  outils.

### Ajouté — mémoire (`kyber-memory`)

Cinq mécanismes repris de `ruflo`, chacun réglant un défaut constaté :

- **Décroissance** (`decayPerHour`, à calculer **à la lecture**) — un score appris
  une fois ne reste pas vrai.
- **`attempts` dans le ledger** — un succès après reprise n'est pas un succès
  propre. Constaté : une ligne disait `success` alors que le même run avait
  essuyé deux rejets de schéma.
- **Purge du raisonnement** — aucun texte de réflexion en mémoire.
- **Cycle de vie des leçons** (`uses`, `lastUsed`) — éviction par utilité réelle,
  plus par ancienneté.
- **Transfert inter-kybers à seuil** (`uses >= 3`) — remplace une interdiction
  trop grossière.

### Corrigé après un test d'installation réel — 13 échecs constatés

Un installateur a exécuté `INSTALL-PROMPT.md` pour de vrai, sur une cible isolée,
et documenté treize échecs. Corrections qui en découlent :

- **`INSTALL.md` §0 : l'exemple `provenance` était refusé par le validateur que §0
  désigne lui-même** — `author` manquait. La règle avait été ajoutée au linter et
  à `CONVENTION.md` §10, mais l'exemple était resté faux. *Défaut dur, re-testé
  trois fois par l'installateur.*
- **§0 : la revue obligatoire ne portait que sur `prompt:`, pas sur `skills:`.** Une
  skill est le même matériau — du langage naturel adressé à un agent outillé — et
  le kyber en tire son code le plus exécutable. Une revue partielle laissait passer
  la moitié de la surface d'attaque. Les critères de refus couvrent les deux.
- **§0 : le cas « installation locale sans humain » n'était pas tranché.** La règle
  de confirmation était inconditionnelle et sa seule nuance parlait du cas distant.
  Remplacé par une table explicite, asymétrique par origine.
- **§1 : le champ `role:` (spécialité) n'était pas documenté**, alors que
  `kyber-memory` fait reposer sa clé d'apprentissage sur l'`id`. Le retirer
  **fusionne `auditeur` et `verificateur` en un seul bras de routage** — le bug que
  la mémoire documente avoir déjà eu lieu. Ajouté, avec la raison.
- **§1 : le bloc de format était présenté sans référence à la source de vérité.**
  Un installateur qui ne lisait que ce résumé produisait un kyber amputé de `cap`,
  `gate` et `definitionOfDone` — la doctrine entière — sans qu'aucun contrôle ne le
  signale. Le bloc est désormais explicitement un résumé ; `lint.cjs` fait foi.
- **§2 point 5 : « dégradation » était défini comme « exigence dure non
  satisfaite »**, et **aucune** des quatre dégradations réellement constatées n'en
  était une : `tier` non résolu, mémoire apprise non reportée (six observations
  perdues), skills résolus seulement sous le preset `kyber` alors que le défaut est
  `cordis`, `README`/`LICENSE` absents. Redéfini en trois catégories.
- **§3 Phase 2 :** le prompt d'installation local référençait un dossier
  d'atelier, ce que `CONVENTION.md` §8 interdit. Reformulé.
- **`provenance.sourcePath` ajouté** : un kyber local ne pouvait pas enregistrer
  d'où il venait — la liste fermée refusait le champ, et l'installateur n'avait que
  deux mauvaises options, inventer un champ ou ne rien noter.
- **`CONVENTION.md` : un chemin DSH en dur** avait fui dans le texte normatif,
  alors que `INSTALL.md` §0 promet une spec sans chemin de plateforme.
- **`lint.cjs` accepte `--dir=`** : un installateur ne pouvait pas valider la copie
  qu'il venait d'écrire. Il devait fabriquer un harnais de liens symboliques dans
  `/tmp` pour vérifier son propre travail.
- **`CONVENTION.md` : la spec s'applique désormais à elle-même** `SPEC-VERSION` et
  un `CHANGELOG`. Elle imposait aux kybers une version de grammaire et un commit
  épinglé sans appliquer ni l'une ni l'autre à son propre texte.

**Le défaut de fond, et il est de méthode.** Pendant l'exécution du test, ces
documents ont été réécrits quatre fois : `CONVENTION.md` de 181 à 405 lignes,
`lint.cjs` en cinq versions, `INSTALL.md` en deux états — et **à un moment
`lint.cjs` était cassé** (`ReferenceError: STAGE_FIELDS is not defined`, puis un
doublon de `const PRESET_SKILLS`), parce que j'écrivais un contrôle avant la
constante qu'il utilise **sans lancer le validateur entre mes modifications**. Je
vérifiais à la fin, pas entre les étapes. **Un validateur se lance après chaque
changement, pas après la série.**

### Non repris de `ruflo`, et pourquoi

- **EWC++** — pour l'affinage de réseaux de neurones. Nous n'en faisons pas.
- **HNSW / quantisation / rerank** — infrastructure d'échelle. Déclencheur
  mesurable avant adoption : `lessons.jsonl` > ~500 lignes, ou `ledger.jsonl` > ~5 000.
- **`@ruvector/emergent-time`, PageHinkley, LearnedWeights** — leur propre ADR
  cite le README de la dépendance : *« no proven early-warning lead over a fair
  baseline »*, et les gèle derrière un feature flag.

---

## SPEC-VERSION 1 — 2026-09-16

Version initiale. Format `kyber.yml` : `id`, `mission`, `topology`, `stages`,
`roles` (avec `needs`, `provider`, `model`, `prompt`), `memory`, `skills`, `tools`.
Topologies `pool`, `pipeline`, `adversarial`, `mapreduce`, `loop` ; modes `once`,
`forEach`, `untilConverged`. Validateur `lint.cjs` ; installation par un agent
(`INSTALL.md`) ; convention de nommage (`CONVENTION.md`).
