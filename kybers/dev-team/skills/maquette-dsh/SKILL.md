---
name: maquette-dsh
description: "Produit une maquette d'interface au CSS réel de DSH, hors application, adossée à une source de vérité et vérifiée par un contrat exécutable (lint + rendu + captures) avant tout câblage."
whenToUse: "Quand on veut valider un écran DSH (structure, contrôles, densité, interactions) avant d'écrire le plugin — ou quand on demande « propose une maquette », « fais-moi une maquette »."
---

# Maquette DSH

Une maquette DSH n'est pas un dessin : c'est une page autonome qui porte **les
vrais contrôles et les vrais jetons de DSH**, adossée à une **source de vérité**,
et qui passe un **contrat exécutable** — jetons, géométrie mesurée, interactions
comptées, captures. Sans source, elle invente ; sans contrat, elle dérive. Ce
skill donne la chaîne complète.

Deux causes expliquent une maquette « basique et fausse » : aucune source de
vérité à recopier (on dessine de mémoire), et aucune vérification mécanique (on
relit à l'œil). Le kit ferme les deux.

## Étape 0 — le kit (le chemin par défaut)

```bash
# 1. créer : dsh.css extrait + capture de l'écran réel + squelette + contrat + README
node scripts/maquette-new.mjs <sujet> --titre "Titre lisible"
#    → docs/handoff/<sujet>/maquette-v1/   (--dossier <chemin> pour ailleurs)

# 2. travailler la page, puis passer le portier
node scripts/check-maquette.mjs docs/handoff/<sujet>/maquette-v1

# sans Chrome de debug (lint seul) / l'inventaire de tout le dépôt
node scripts/check-maquette.mjs <dossier> --lint-seul
node scripts/check-maquette.mjs --tous
```

`check-maquette` vit dans le dépôt (`scripts/check-maquette.mjs`,
`scripts/maquette-lib.mjs`) et lit **`maquette.json`**, écrit dans le dossier de
la maquette. Le contrat remplace les 8 à 27 ko de vérification réécrits à chaque
sujet — c'est cette réécriture évitée qui supprime la variance de qualité.

## La source de vérité — d'abord, toujours

Une maquette sans source de vérité est une invention. Trois formes acceptées,
déclarées dans `maquette.json` :

| `source.kind` | `ref` | quand |
| --- | --- | --- |
| `port` | la maquette fournie (HTML/PNG) copiée dans le dossier | l'utilisateur a dessiné un écran : le reprendre **à l'identique** (structure, libellés, données, règles de filtrage) et ne changer que l'habillage |
| `capture` | `source-ecran-reel.png` | aucun écran fourni : **capturer l'écran réel de DSH au même endroit** avant de dessiner |
| `donnees` | un dossier/fichier réel (chemin absolu accepté) | la maquette repose sur des valeurs réelles (ledger, index, état du dépôt), citées telles quelles |

```bash
# (re)faire la capture de l'écran réel : la page 127.0.0.1:3080 du Chrome de debug (9333)
node scripts/maquette-new.mjs <sujet> --dossier <dossier> --capture-seule
```

La capture ouvre le travail, elle ne le décore pas : la coquille (barre latérale,
densité, hauteurs de rangée, libellés) se recopie depuis elle, au lieu d'être
réinventée dans une page nue — c'est ce qui distingue une maquette d'un dessin.

**Ne jamais inventer une donnée** pour remplir un cadre : afficher l'absence
(« index indisponible », « aucune fiche », « vide aujourd'hui ») est un résultat.
Le portier refuse une source absente ou introuvable.

## Harmoniser avec l'existant — pour chaque maquette, sans exception

**Avant d'inventer un contrôle, chercher celui qui existe déjà** et le reprendre
tel quel. Une maquette qui réinvente un sélecteur d'icônes, une carte de
formulaire ou un état de ligne produit un objet *étranger* : l'utilisateur le sent
sans savoir le nommer (« c'est basique »). La règle vaut pour **toute** maquette,
pas seulement celle du moment.

La procédure, en six temps :

1. **Trouver le module propriétaire** de la fonctionnalité et y chercher le
   contrôle :
   ```bash
   grep -n "Search icons\|iconpick\|fcard\|Change icon" kybernos-slash/client.js
   grep -oE "\.kb8-iconpick\{[^}]*\}" kybernos-plugin/client.js
   ```
   Le plugin de la fonctionnalité d'abord (`kybernos-slash`), la fiche d'entité
   ensuite (`kybernos-plugin` : agent, kyber, fichier).
2. **Lire le balisage ET le CSS** — pas seulement le nom : la structure (une
   ligne de résumé *repliable* n'est pas une rangée de champs), les classes, les
   valeurs exactes (`minmax(40px, 1fr)`, `border-radius: 11px`, `height: 40px`).
3. **Copier le CSS verbatim**, avec **les vraies classes** (`kb8-iconbtn`,
   `kbsl-fcard`) et un commentaire qui cite le fichier source. Les couleurs,
   elles, se résolvent par les jetons DSH de la page : une maquette n'a pas les
   `--kb-*` du plugin, elle a `--dsw-*`.
4. **Exiger sa présence** dans le contrat (`lint.requiresControls`) et **prouver
   sa géométrie** (`measure`) : `width: 40px`, `borderRadius: 11px`. Si le
   contrôle n'existe qu'après une action, la mesure vit **dans l'étape**
   (`etape.mesure`) — le kit la joue juste après le clic.
5. **Jouer son geste** par une étape : ouvrir, filtrer, choisir, replier. Un
   contrôle qu'on ne peut pas cliquer n'est pas emprunté, c'est une image.
6. **Le dire au README** : quel contrôle a été emprunté, à quel module, et
   pourquoi ce variant-là.

**Un sélecteur n'est pas qu'un cadre : c'est son contenu.** Reprendre la grille
`minmax(40px, 1fr)` ne suffit pas si elle ne propose que **douze icônes** — ce
n'est plus un sélecteur, c'est une rangée de vignettes, et le lecteur a
l'impression que rien n'a changé. Le produit a un **jeu d'icônes** (`LUCIDE` dans
`kybernos-plugin/client.js`, avec `KB_DEFAULT_ICONS` comme vitrine par défaut) :
on le reprend tel quel, on cherche par sous-chaîne dans les noms comme le fait
l'application, et le champ annonce le compte réel (`Search 60 icons…`). Même
règle pour les libellés : `Text`/`Choice`/`Yes / No` viennent de `kbTypeLabel`,
pas du nom technique du type.

**Deux variants du même contrôle peuvent coexister.** Le sélecteur d'icônes
existe en grille fluide (`.kb8-iconpick`, fiche d'agent — `minmax(40px, 1fr)`,
bouton 40×40 r11, icône 20 px) et en popover à recherche (`.kbsl-icopick`,
éditeur slash). On prend celui du module propriétaire, on l'écrit dans le README,
et on ne mélange pas les deux.

### Ce que la reprise apporte — et ce qu'elle coûte

Reprendre la **carte de question** de l'éditeur réel (`.kbsl-fcard` : ligne de
résumé `{nom}` + libellé + type + état + chevron, corps déplié à la demande) a
fait passer l'éditeur de cinq rangées de champs écrasés à cinq lignes lisibles,
et le défilement interne de **1053 px à 969 px**. Ce n'est pas la reprise qui
coûte de la place : c'est l'invention. **Optimiser l'espace, c'est d'abord
adopter la densité de l'existant — puis le mesurer avant/après** (le chiffre à
citer est le défilement, pas une impression).

Trois pièges rencontrés en reprenant un contrôle :

- **le gestionnaire placé au mauvais endroit** : un `if (data-champouvrir)` glissé
  *dans* le bloc `if (data-pied)` ne se déclenche jamais — l'étape de geste
  l'attrape, la capture seule ne l'aurait pas montré ;
- **le conteneur de défilement** n'est pas toujours celui qu'on croit
  (`.kbsl-ebody` défile, `.kbsl-esteps` non) : un `scrollTop` posé sur le mauvais
  élément ne fait rien, silencieusement ;
- **la spécificité CSS** : `.kbsl-fieldcard .kbm-in-wrap { flex: 1 }` écrase
  `.kbsl-champ-opt { flex: 1 1 100% }` — le libellé se réduisait à « Scop… » et
  le champ des options restait écrasé sur la ligne. La règle empruntée doit
  porter la même spécificité que celle qui la contredit, et la mesure doit être
  un **plancher** (`minWidth`) plutôt qu'une largeur exacte qui se remet à
  rétrécir.

## Le CSS réel de DSH

`@deepseek-ai/dsh-client-ui-primitives` **n'est pas requêtable** depuis un plugin :
le paquet est compilé dans chaque consommateur, et l'application n'expose que ses
propres entrées (`window.__DSH_BOOT__.entries` — les primitives n'y sont pas).
Les classes de l'application sont hachées à chaque build (`.button_a1b2c3`), donc
inutilisables en dur. La seule voie honnête : lire les modules CSS du paquet dans
l'installation DSH et les préfixer par module.

```bash
# jetons + 11 modules de contrôles, préfixés kbm-* — une maquette quelconque :
node scripts/build-model-catalog-css.mjs --maquette docs/handoff/<sujet>/maquette-v1/dsh.css
#    --dsh <racine> pour viser une autre installation ; --check pour détecter la dérive
```

L'artefact porte la provenance (paquet, version, fichiers) : si DSH est mis à
jour, le portier échoue (`dsh.css à la version installée`) et il faut régénérer.
Le même CSS est embarqué par le plugin (`kybernos-models/dsh-css.js`).

## Écrire la page

- **Autonome** : un `<link rel="stylesheet" href="dsh.css">`, **aucune** ressource
  réseau (ni CDN, ni webfont). Double-clic = ça s'ouvre.
- **Deux couches de styles** : `mk-*` pour la coquille de présentation (le cadre,
  les légendes), `<sujet>-*` pour la mise en page de la fonctionnalité — celle
  qui partira dans le plugin.
- **Jetons uniquement** : `var(--dsw-alias-*)`, jamais une couleur en dur — les
  jetons ne se devinent pas, ils se listent (`grep -o '\-\-dsw-[a-z0-9-]*' dsh.css | sort -u`).
  La géométrie (hauteurs, rayons, largeurs de colonnes) peut être locale.
- **Balisage exact des contrôles** :
  | contrôle | balisage |
  | --- | --- |
  | bouton | `<button class="kbm-btn kbm-btn-md kbm-btn-primary\|outline\|ghost">` (+ `kbm-btn-icon`, `kbm-btn-sm`) |
  | champ | `<span class="kbm-in-wrap">[<span class="kbm-in-icon">]<input class="kbm-in-input">` |
  | puce | `<button class="kbm-pill kbm-pill-interactive [kbm-pill-active]">` |
  | étiquette | `<span class="kbm-tag" data-tone="outline\|solid\|neutral\|quiet\|success\|info\|warning\|danger">` |
  | pastille | `<span class="kbm-dot" data-state="done\|warning\|error\|idle\|ongoing">` **+ une taille locale** |
  | modale | `.kbm-mdl-root > .kbm-mdl-mask + .kbm-mdl-dialog > .kbm-mdl-content[> header, body, footer]` |
  | menu | `.kbm-menu-root > .kbm-menu-list > .kbm-menu-item` |
  | ligne dépliable | `.kbm-dr-root > .kbm-dr-row > .kbm-dr-title` |
  La liste des préfixes est exportée : `DSH_CSS_PREFIXES` dans `dsh-css.js`.
- **Frames** : un cadre = un écran, avec une légende qui dit ce qu'on regarde.
  La page complète est plus haute que la fenêtre : c'est voulu.
- **Pièges vérifiés** :
  - les contrôles DSH posent `display: flex`/`inline-flex`, donc l'attribut
    `hidden` **ne masque rien** → ajouter `[hidden]{display:none!important}` ;
  - `.kbm-dot` **n'a aucune taille par défaut** → la poser localement
    (`.ma-ligne .kbm-dot{width:10px;height:10px;flex:none}`), sinon la pastille
    est dans le DOM et invisible. Attrapé par le portier (§ contrôle invisible) —
    c'est un défaut réel trouvé dans une maquette existante ;
  - `.kbm-btn-icon` est **l'emplacement de l'icône** (16×16), pas un modificateur
    de taille : le poser sur le bouton rétrécit le bouton et écrase le SVG à
    `0 px` — l'icône disparaît. Balisage correct :
    `<button class="kbm-btn kbm-btn-sm kbm-btn-ghost"><span class="kbm-btn-icon"><svg…/></span></button>` ;
  - les primitives n'exposent **aucun module `select`** : un champ à choix se rend
    en `kbm-pill` (+ `kbm-pill-active`), pas en `<select>` maquillé ;
  - boutons-icônes : toujours `aria-label` **et** `title`.

## La rendre interactive

**Règle absolue : une maquette est toujours interactive.** Une image ne se valide
pas — on ne juge un geste qu'en le faisant. Si on se surprend à livrer une page
inerte, c'est un défaut, pas une simplification.

C'est ce qui fait la différence pour une validation. Recette minimale et sans
dépendance :

1. les données dans un tableau JS (les **vraies** valeurs de la machine) ;
2. une fonction de rendu qui produit les lignes — **une seule**, réutilisée par
   l'aperçu de l'éditeur : la ligne montrée est alors littéralement la ligne qui
   s'affichera (dans une colonne étroite, la faire se replier en CSS, pas diverger) ;
3. des écouteurs **délégués** : `input` pour la recherche, `change` pour les
   listes, `click` pour les puces, la flèche et la fermeture, `keydown` Échap ;
4. l'état dans un objet unique (`q`, filtres, tri, brouillon d'édition) ;
5. un état vide explicite (« aucun résultat ne correspond ») ;
6. **le parcours va jusqu'au bout** : on ouvre, on modifie, on enregistre, et
   **la liste derrière se met à jour**. Un formulaire qui ne sauve rien n'est
   qu'un décor qui bouge.

Deux détails qui font la différence entre « ça marche » et « ça se sent » :

- **conserver le curseur** : re-rendre la page à chaque frappe détruit le focus et
  la position du caret. Capturer `selectionStart` avant, le restaurer après
  (`setSelectionRange` dans un `try` — les `select` n'en ont pas) ;
- **élargir le cadre quand un modal s'ouvre** (`.kbsl-scene { min-height }` sous un
  attribut d'état) : sinon le modal est comprimé par la hauteur de la palette et rien
  n'est vérifiable.

Si la source de vérité est une maquette fournie, reprendre **sa** structure à
l'identique et n'ajouter que ce que le plugin apporte.

## Deux defaults, jamais optionnels

Toute maquette sort avec ces deux-là — le squelette (`maquette-new.mjs`) les
génère déjà, le lint les **exige**, le contrat les **prouve** :

1. **Fluide.** Au moins un `@media (max-width…)` : la ligne de liste se replie
   (la description passe à la ligne, les actions restent), l'aperçu de l'éditeur
   glisse sous les étapes au lieu de comprimer la saisie, les pieds de modal
   passent à la ligne. Le lint cherche la règle ; `render.responsive` la vérifie
   pour de bon, à chaque largeur déclarée : le portier mesure le **pire
   débordement horizontal** (il doit rester ≤ 1 px), rejoue les mesures données et
   prend la capture étroite.
2. **Sombre.** Une bascule qui pose `data-ds-dark-theme` sur `<body>` — les jetons
   font le reste, aucune couleur n'est écrite pour le sombre. Le lint exige
   l'attribut ; `render.sombre` clique la bascule, **vérifie que le fond change
   réellement** (sinon c'est un décor), prend la capture, puis revient au clair.
   Le bloc est idempotent : une étape du contrat a pu basculer avant lui.

```json
"sombre": { "bascule": "#dark", "capture": "5-sombre.png", "selector": "#cadre-app" },
"responsive": [
  { "nom": "480 px", "largeur": 480, "hauteur": 900,
    "mesure": [{ "nom": "la description passe à la ligne", "selector": ".pdesc",
                 "prop": "flexBasis", "equals": "100%" }],
    "captures": [{ "fichier": "6-etroit.png", "selector": "#cadre-app" }] }
]
```

Deux pièges de ces deux blocs :

- `measure` compare des **chaînes** de `getComputedStyle` : une grille écrite
  `repeat(auto-fit, minmax(340px, 1fr))` rend `426px` en une colonne, jamais
  `1fr`. Vérifier autre chose (débordement nul, largeur d'une carte) ;
- le bloc `responsive` s'exécute **après** les étapes : l'écran doit alors
  contenir ce qu'on veut mesurer (une carte de question, par exemple — ajouter
  l'étape qui la crée plutôt que de mesurer un sélecteur absent, qui rend `null`).

## États obligatoires

Une maquette qui ne montre qu'un état heureux est incomplète. Le dossier doit
montrer, ou au moins déclarer comme non montré :

- **vide** (aucune donnée — et le dire, pas un cadre blanc) ;
- **chargement** (si l'écran en a un) ;
- **erreur** (échec d'une action, source indisponible) ;
- **survol / focus visible** sur l'action principale ;
- **clair et sombre** si la fonctionnalité touche au thème (bascule
  `document.body.toggleAttribute('data-ds-dark-theme')`, comme les maquettes
  existantes).

## Vérifier : le contrat, pas un script par sujet

Le contrat `<dossier>/maquette.json` :

```json
{
  "source": { "kind": "capture", "ref": "source-ecran-reel.png" },
  "lint":   { "minTokens": 15, "hexAllowlist": [], "allowRemote": [], "requiresControls": ["kbm-btn", "kbm-in-wrap", "kbm-tag", "kbm-dot"] },
  "render": {
    "viewport": [1300, 1240],
    "ready": "document.querySelector('#cadre-liste') !== null",
    "measure": [{ "nom": "bouton DSH : capsule r18 h36", "selector": ".kbm-btn-primary", "prop": "borderRadius", "equals": "18px" }],
    "steps":   [{ "nom": "recherche", "type": ".mk-search", "valeur": "gamma", "expect": "count", "selector": ".mk-row", "equals": 1 }],
    "captures":[{ "fichier": "1-liste.png", "selector": "#cadre-liste", "legende": "la liste" },
                { "fichier": "2-detail.png", "selector": "#fiche", "apres": 2 }]
  }
}
```

`steps` : `click`, `clickText`, `type`+`valeur`, `key`, `wait`, `pause`, puis
`expect` ∈ `count` (avec `equals`/`min`/`max`), `visible`, `hidden`, `text`
(`equals`/`contient`), `value`, `attr` (+ `equals`). Une étape peut porter
l'action **et** son assertion. `captures[].apres: n` capture après la n-ième
étape — de quoi montrer l'écran avant **et** après une interaction.

Ce que le portier prouve, sans navigateur puis dans le Chrome de debug :

- **lint** — contrat présent ; `dsh.css` extrait avec provenance et à la version
  installée ; jetons réellement employés ; **aucune couleur en dur** (zéro
  tolérance, ombre noire exceptée) ; aucune ressource distante ni webfont ;
  `[hidden]` opérant ; boutons-icônes étiquetés ; contrôles DSH employés ;
  source de vérité ; README ; captures prévues ;
- **rendu** — la feuille extraite **parse sans perte** (règles feuille en ligne =
  comptage hors navigateur) ; jetons du thème posés sur `body` ; géométrie DSH
  mesurée (capsule r18 h36, champ 14 px…) ; **aucun contrôle DSH invisible**
  (présent dans le DOM, taille nulle) ; **audit de rendu** (texte tronqué, contenu
  coupé, image cassée, contraste — voir § Avant de livrer) ; interactions pilotées
  et comptées ; **sombre réellement basculé** et **points de rupture** mesurés
  (débordement ≤ 1 px) ; captures en `captureBeyondViewport` et **coordonnées de
  page** (un clip relatif au viewport ne prendrait que la partie visible d'un cadre
  plus haut que la fenêtre) ; console sans erreur ; **planche de contrôle**
  (`planche.png`) prête à regarder.

Code de sortie : `0` tout ✓ · `1` au moins un ✗ · `2` usage ou dossier absent.
`--tous` donne l'état de tout le dépôt : une maquette antérieure sans contrat
apparaît ✗ — c'est exact, et la doter d'un contrat est un travail à part, maquette
par maquette.

## Barre de qualité

À regarder avant de dessiner, pour situer le niveau :

- `docs/handoff/kyber-proof/maquette-v1/` — l'exemple **adossé à un contrat**
  (`maquette.json`), 27/27 ✓, données réelles citées ;
- `docs/handoff/model-catalog/maquette-v3/` — le **port fidèle** d'une maquette
  fournie : structure, libellés, données et règles reprises à l'identique,
  habillage passé aux jetons de DSH ;
- `docs/handoff/sessions-badge/maquette-v1/` — la maquette **interactive** :
  pastilles, fiche à onglets, Échap, thème sombre, 7 captures ;
- `docs/handoff/maquettes-avance/` — six écrans de **référence visuelle** (export
  d'un outil de design, `.dc.html`) : ce sont des cibles de densité et de
  finition, pas du code à reprendre.

## Avant de livrer : la revue visuelle, puis la chasse aux bugs

Un contrat vert ne dit pas qu'une maquette est bonne : il dit qu'elle est
*cohérente*. Le portier **ne voit pas** un cadre deux fois trop large, une capture
prise dans le mauvais thème, une ligne dont le sens dépend d'un détail qu'on a
oublié de dessiner. La règle est donc : **une capture qu'on n'a pas regardée n'est
pas une preuve.**

L'ordre, toujours le même :

1. **Le portier** (`check-maquette.mjs`) : contrat, géométrie, interactions,
   captures, et l'**audit de rendu** — texte tronqué, contenu coupé, image cassée,
   contraste. Il produit la **planche de contrôle** : toutes les captures en une
   image.
2. **La revue visuelle** : ouvrir `planche.png` (ou `planche.html`) et *regarder*.
   C'est le seul moment où l'on voit ce que l'œil voit.
3. **La mesure** : dès qu'un doute apparaît, mesurer au lieu d'interpréter
   (`getComputedStyle`, `getBoundingClientRect` dans la page, une sonde CDP de dix
   lignes). Un « il y a un vide bizarre à droite » se tranche en un chiffre :
   *341 px de blanc dans le cadre*.
4. **La chasse aux bugs** : chaque constat se traduit en correction **et** en
   garde-fou. Si le portier pouvait l'attraper, il doit l'attraper désormais —
   et on le **teste négativement** : on réintroduit le défaut, on vérifie que le
   ✓ devient ✗, on le retire.
5. **Le README** dit ce qui a été regardé et ce qui ne l'a pas été. Une maquette
   livrée sans cette phrase laisse croire que tout a été vu.

### Ce que la revue visuelle doit chercher (ce que le portier ne voit pas)

- une capture **prise dans le mauvais thème** : une étape qui bascule le thème
  avant la fin teinte silencieusement les captures suivantes — **mettre l'étape du
  thème en dernier**, ou la faire porter par `render.sombre` ;
- un **cadre plus large que son contenu** : le blanc à droite dans la capture n'est
  pas du vide, c'est un défaut. Un cadre-fenêtre se resserre
  (`width: fit-content; max-width: 100%`) et la légende garde la même mesure que
  le contenu ;
- une **capture zoomée illisible** (une ligne de 44 px dans un cadre de 800) : le
  bon sélecteur, la bonne échelle ;
- un **état annoncé mais invisible** (une pastille de 10 px sur 40, un libellé
  d'état sans son contrôle) ;
- une **planche dont les vignettes s'étirent** (grille `align-items: start`) ;
- une **capture qui ne se prend pas** (conteneur à hauteur nulle) : le portier le
  dit, mais il faut le lire.

### Le contraste : deux responsabilités, deux planchers

Le portier sépare ce qui est **à toi** de ce qui est **à DSH** :

| texte | plancher | pourquoi |
|---|---|---|
| posé sur un fond de page (le tien) | **3:1** (2:1 sous 12 px) | c'est ta responsabilité ; le jeton *caption* de DSH est lui-même à 2.13:1 sur blanc, on tolère cette échelle-là |
| pris dans un contrôle de DSH (étiquette, puce) | **1.5:1** | sa couleur vient du jeton, la changer serait trahir le contrôle — on publie le chiffre (une étiquette `warning` est à 1.63:1 par construction) |

Le pire ratio est **toujours affiché**, même quand c'est vert : 2.13:1 se voit,
et c'est ainsi qu'on arbitre. Trois règles de couleur en découlent :

- le jeton **`caption`** est fait pour le chrome de l'application : une légende
  que *tu* écris se colorie au jeton `tertiary` au minimum ;
- un **jeton d'état** n'est pas une couleur de texte (`state-success-primary` sur
  blanc = 2.18:1) : soit il porte sa propre pastille, soit on le mélange au jeton
  de label —
  `color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 62%, var(--dsw-alias-label-primary))` ;
- un fond **translucide** ne se juge pas sur sa propre couleur : le contraste se
  calcule sur le **fond effectif**, en compositant les couches jusqu'à la première
  opaque (sinon on croit voir du blanc sur blanc là où il y a du noir dessous).

### Les pièges du kit lui-même

Quand on étend `maquette-lib.mjs`, trois erreurs sont déjà arrivées :

- `getComputedStyle` peut rendre `color(srgb 0.45 0.85 0.6)` (c'est le cas de
  `color-mix`) : les composantes sont alors en **0-1**, pas en 0-255 ;
- un commentaire ou un message **entre backticks** à l'intérieur du littéral
  gabarit de `p.eval(...)` ferme le gabarit : erreur de syntaxe à la ligne du
  `p.eval` suivant, très loin de la vraie faute ;
- `\(` dans un littéral gabarit **non étiqueté** est une séquence interdite :
  écrire `/^color[(]/` plutôt que `/^color\(/`.

## Présenter

`present` sur la page, **la planche de contrôle**, les captures et le README du
dossier, puis poser les
**décisions numérotées** (surface, navigation, sort de l'écran précédent, source
des données) avec une recommandation. La maquette n'écrit **jamais** dans
`settings.yaml` ni dans un store : c'est une proposition.

## Pièges connus

- Le paquet des primitives n'est pas requêtable : ne pas chercher à l'importer.
- Les classes de l'app sont hachées par build : ne pas les copier depuis le DOM.
- Un jeton ne s'invente pas : `--dsw-elevation-prominent` existe,
  `--dsw-alias-shadow` non. Lister les jetons dans `dsh.css`.
- `.kbm-dot` sans `width`/`height` ne se rend pas (voir § Écrire la page).
- `checkVisibility()` tient compte des ancêtres masqués : c'est lui qui évite de
  croire qu'une modale fermée contient des contrôles visibles.
- `CSS.supports('@scope (…)')` est trompeur sur Chrome : préférer le préfixage à
  la construction (ce que fait l'extracteur).
- Une capture de cadre plus haut que la fenêtre exige les coordonnées de page.
- **Un conteneur dont le seul enfant est en `position: absolute` a une hauteur
  nulle** : une capture cadrée dessus est refusée (`capture refusée`). Cadrer le
  modal lui-même (`.…-modal`) ou le cadre, pas le conteneur qui le porte.
- Ne jamais inventer une donnée : l'absence affichée est un résultat.
- Un artefact généré porte un en-tête GÉNÉRÉ et un `--check` dans le script.
- Les `kbm-*` ont leurs propres tailles : préférer le contrôle réel à une réplique
  maison (`kbm-pill` + `kbm-pill-interactive` + `kbm-pill-active`, h24) — et si une
  classe requise par le contrat n'est finalement pas employée, c'est le contrat
  qu'il faut corriger, pas le lint qu'il faut contourner.
