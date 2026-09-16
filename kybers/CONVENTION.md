# CONVENTION — espaces de noms, noms réservés, publication

**Document normatif.** Il fige ce qui doit être vrai pour qu'un kyber publié soit
trouvable, installable et non usurpable. Les mots **DOIT**, **NE DOIT PAS**,
**DEVRAIT** sont à prendre au sens strict.

Ce document ne décrit pas le *format* d'un `kyber.yml` — c'est `INSTALL.md` §1 —
ni la *procédure* d'installation — c'est `INSTALL.md` §0 à §5.

Version de cette convention : **2**, alignée sur `specVersion: 2`.

### La spec s'applique à elle-même ce qu'elle impose

Un kyber DOIT déclarer `specVersion` et une `provenance` avec un **commit**
épinglé. Cette convention, et les documents qui l'accompagnent, DOIVENT satisfaire
les deux mêmes règles. Sans quoi elles sont unpinnables : rien ne dit à quelle
version de la grammaire un `kyber.yml` publié il y a six mois a été validé.

| Document | Versionné par |
|---|---|
| le format (`kyber.yml`) | `specVersion:` dans chaque fichier |
| `CONVENTION.md`, `INSTALL.md`, `INSTALL-PROMPT.md` | `SPEC-VERSION` + `CHANGELOG.md` |
| `lint.cjs` | suit `SPEC_VERSION`, et son changement DOIT apparaître au CHANGELOG |

**Toute modification de ces documents DOIT être accompagnée d'une entrée dans
`CHANGELOG.md`** — y compris une correction de rédaction. Un installateur qui épingle
un commit doit pouvoir lire ce qui a changé entre ce commit et aujourd'hui.

Cette section existe parce qu'un test d'installation réel a mesuré l'inverse :
pendant son exécution, `CONVENTION.md` est passé de 181 à 405 lignes et `lint.cjs`
a connu cinq versions — **dont une cassée**, `STAGE_FIELDS is not defined`, parce
que le contrôle a été écrit avant la constante qu'il utilise. L'installateur a dû
figer son rapport sur un état horodaté pour ne pas courir après une cible mouvante.
Une spec qui bouge plus vite que ses exécutants n'est pas une spec, c'est un
brouillon.

---

## 1. Les trois espaces de noms

| Espace | Emplacement | Nom du dépôt | Qui publie |
|---|---|---|---|
| **Méta** | `github.com/kybernos/kybernos` | `kybernos` | l'organisation `kybernos`, et elle seule |
| **Officiel** | `github.com/kybernos/kybernos-<nom>` | `kybernos-<nom>` | l'organisation `kybernos` |
| **Contribué** | `github.com/<auteur>/kybernos-contrib-<nom>` | `kybernos-contrib-<nom>` | n'importe qui, sans permission |

### Où vit la spec AUJOURD'HUI — à lire avant de fetcher

Ce tableau décrit l'**état cible**. Il ne décrit pas l'état courant, et confondre
les deux fait échouer une installation : un test réel a suivi ce document, tenté de
récupérer `github.com/kybernos/kybernos`, et reçu **404**.

| | Aujourd'hui | À terme |
|---|---|---|
| Spec (ce document, `INSTALL.md`, `lint.cjs`) | `github.com/platonai-net/llm-orchestrator-mcp/tree/main/kybers` | `github.com/kybernos/kybernos` |
| Les 4 kybers de référence (`audit`, `dev-team`, `veille`, `socratic`) | même dépôt, `kybers/<nom>/` | chaque kyber dans son propre `kybernos-<nom>` |

**Un prompt d'installation DOIT citer une URL qui résout**, donc celle d'aujourd'hui.
Le déménagement vers l'organisation `kybernos` est **sans casse** : GitHub redirige
les dépôts renommés comme les dépôts transférés, donc une `provenance.url` épinglée
sur l'ancien chemin continue de résoudre. C'est précisément pourquoi publier tôt ne
coûte rien.

L'emplacement actuel est un **atelier** au sens du §8 : plusieurs kybers dans un
dépôt qui n'est pas nommé `kybernos-*`. C'est légitime pour écrire et tester, et
**invisible** à la recherche par nom. Un kyber qui s'avère bon doit être promu dans
son propre dépôt.

**Le dépôt méta NE DOIT PAS commencer par `kybernos-`.** C'est la règle qui rend
tout le reste possible : elle garantit que le motif `kybernos-` ne désigne que des
kybers, jamais l'outillage. Un dépôt méta nommé `kybernos-mcp`, `kybernos-spec` ou
`kybernos-core` casserait la découverte et **devrait être renommé**.

Corollaire : si un outil existant porte déjà un nom en `kybernos-`, il DOIT être
renommé ou déplacé sous l'organisation, sans quoi chaque recherche de kyber le
remontera comme un faux positif permanent.

### Le préfixe `contrib-` — précédent node-red

Le motif retenu est celui de `node-red-contrib-<nom>` : le noyau porte le nom
exact de la marque, et tout ce qui vient de la communauté porte l'infixe
`contrib-`. Le raisonnement de node-red s'applique ici mot pour mot.

**`kybernos-contrib-<nom>` est donc RETENU pour les kybers tiers**, pour une raison
qui pèse plus lourd que la mienne : **le nom lui-même avertit**. Dans un écosystème
où un kyber est un ensemble d'instructions exécutables, la différence entre « revu
par les mainteneurs » et « envoyé par un inconnu » doit être visible **avant**
d'ouvrir le dépôt. Avec un niveau porté par l'organisation seule, l'utilisateur
doit inspecter l'émetteur pour le savoir. Avec `contrib-`, il le lit dans le nom.

**Le point reste interdit : `kybernos.app-contrib-<nom>` est REJETÉ.** La requête
canonique est `q=kybernos- in:name` ; `kybernos.app-contrib-audit` ne contient pas
la sous-chaîne `kybernos-`, le point interrompt le motif, et **aucun dépôt contribué
ne serait trouvé**. `kybernos-contrib-audit`, lui, contient bien `kybernos-` et
passe la même requête. **Le domaine `kybernos.app` sert au site web, jamais aux
noms de dépôts.**

### Promotion d'un kyber contribué

Un kyber contribué qui mérite de devenir officiel est **transféré** sous
l'organisation et **renommé** `kybernos-contrib-<nom>` → `kybernos-<nom>`.

Ma première rédaction refusait ce renommage au motif qu'il casserait les
`provenance.url` installées. **C'était faux :** GitHub redirige aussi les dépôts
renommés, pas seulement les transférés. Les URL déjà enregistrées continuent de
résoudre. L'objection tombe, et le préfixe `contrib-` reste.

Une seule requête de découverte couvre les trois espaces :

```
https://api.github.com/search/repositories?q=kybernos-+in:name&sort=stars&order=desc
```

Elle ramène officiels **et** contribués. Le niveau se lit dans le nom : présence de
`-contrib-` = tiers.

**Un kyber contribué NE DOIT PAS se faire passer pour officiel.** Il NE DOIT PAS
utiliser `kybernos-<nom>` sans l'infixe — c'est la seule usurpation que la
convention doit rendre impossible, et elle la rend visible d'un coup d'œil.

## 2. Règle de nommage

Un dépôt de kyber DOIT s'appeler `kybernos-<nom>` (officiel) ou
`kybernos-contrib-<nom>` (contribué, §1). Aucune autre forme.

`<nom>` DOIT :

- être en `kebab-case` : minuscules ASCII, chiffres et tirets simples ;
- faire 2 à 40 caractères ;
- ne pas commencer ni finir par un tiret, ne pas contenir de tiret double ;
- ne pas figurer dans la liste des noms réservés (§3) ;
- **être identique au champ `id` du `kyber.yml` qu'il contient** (§4) ;
- ne pas commencer par `contrib-` : l'infixe est réservé au marqueur de
  publication, et `kybernos-contrib-contrib-audit` n'a aucun sens.

`<nom>` NE DOIT PAS contenir de point, d'underscore, d'espace, de majuscule ni de
caractère non-ASCII — même si GitHub les accepte. La convention est plus stricte
que la plateforme, délibérément : le nom du dépôt est une clé d'index, pas un
titre.

## 3. Noms réservés

Un kyber NE DOIT PAS porter l'un de ces noms :

```
mcp  spec  format  schema  core  cli  lint  validate  install  init
search  registry  index  template  example  starter  boilerplate
official  docs  www  site  test  ci  sdk  lib
```

**Principe, plus utile que la liste :** est réservé tout nom qui pourrait être
confondu avec la spec ou son outillage. La liste ci-dessus est l'application de ce
principe, pas son remplacement — un nom ambigu non listé DEVRAIT être refusé en
revue, et la liste mise à jour.

**Ajouter un nom réservé est un changement de rupture.** Un kyber publié sous un
nom qu'on réserve ensuite devient invalide sans avoir changé. Toute addition à
cette liste DOIT donc s'accompagner d'une incrémentation de `specVersion`, et
l'installateur DOIT signaler les kybers déjà installés que cela invalide.

Le contrôle est **insensible à la casse** et porte sur le champ `id`. Le
validateur le refuse.

## 4. Liaison `id` ↔ suffixe du dépôt — obligatoire

Le dépôt `kybernos-audit` DOIT contenir un `kyber.yml` dont le champ `id` vaut
`audit`. Le dépôt `kybernos-contrib-audit` DOIT contenir `id: audit`, **et non
`contrib-audit`**.

**`contrib-` est un marqueur de publication, pas une partie du nom.** Il dit qui a
publié et à quel niveau de confiance ; il ne fait pas partie de l'identité du
kyber. Un même kyber peut passer de `kybernos-contrib-audit` (tiers) à
`kybernos-audit` (officiel) **sans que son `id` change** — sa mission, ses rôles et
sa topologie sont identiques, seul son statut a bougé. Si `contrib-` entrait dans
l'`id`, la promotion renommerait le kyber chez tous ses utilisateurs, et le dossier où il est installé devrait être
renommé sur chaque machine.

Règle de lecture, sans ambiguïté :

| Nom du dépôt | `id` attendu |
|---|---|
| `kybernos-audit` | `audit` |
| `kybernos-contrib-audit` | `audit` |
| `kybernos-contrib-audit-v2` | `audit-v2` |

C'est la règle la plus importante de ce document, parce que **tout le reste en
dépend** : la découverte ramène un nom de dépôt, et c'est ce nom qui devient
l'identité du kyber. Un dépôt `kybernos-audit` contenant `id: audit-v2` rend
l'annuaire menteur, et le nom installé localement ne correspond plus à ce qui a
été trouvé.

L'installateur DOIT refuser l'installation si les deux diffèrent, et dire lequel
des deux il a lu.

## 5. Découverte

**La requête canonique :**

```
https://api.github.com/search/repositories?q=kybernos-+in:name&sort=stars&order=desc
```

Elle fonctionne sans authentification (limite de débit basse : mettre en cache, et
s'authentifier dès que possible). Elle ramène des **candidats**.

**Le nom n'est qu'un indice. `kyber.yml` est la vérité.** Un dépôt peut s'appeler
`kybernos-*` sans être un kyber — c'est même le cas de tout dépôt homonyme. Le
pipeline de découverte est donc :

```
recherche par nom  →  candidats
                   →  présence d'un kyber.yml à la racine     (filtre)
                   →  validation par lint.cjs                  (vérité)
                   →  noms réservés, liaison id ↔ suffixe      (conformité)
                   →  liste affichable à l'humain
```

Aucune de ces étapes NE DOIT être sautée, et **aucune NE DOIT écrire sur le
disque**. La découverte produit une liste ; l'installation est une décision
humaine (`INSTALL.md` §0).

## 6. Niveaux de confiance

L'installateur DOIT afficher le niveau, dérivé du **nom** (et non de
l'organisation seule, pour que le niveau soit lisible avant d'ouvrir le dépôt) :

| Niveau | Condition | Signification |
|---|---|---|
| `officiel` | `kybernos-<nom>`, sous `github.com/kybernos/` | revu par les mainteneurs de la spec |
| `contribué` | `kybernos-contrib-<nom>` | **aucune revue**. Instructions non vérifiées. |

Les deux conditions doivent être réunies pour `officiel` : le nom **et**
l'organisation. Un dépôt tiers nommé `kybernos-audit` sans l'infixe est une
**usurpation** — l'installateur DOIT refuser de l'afficher comme officiel et DOIT
le signaler comme non conforme (§1).

`officiel` NE DOIT PAS être présenté comme « sûr » : cela veut dire *revu*, pas
*inoffensif*. Dans les deux cas la revue humaine des prompts reste obligatoire,
parce qu'un prompt est du code exécutable en langage naturel.

## 7. Les deux axes de version — ne pas les confondre

| Axe | Où | Versionne | Change quand |
|---|---|---|---|
| **Format** | `specVersion:` dans `kyber.yml` | la grammaire que le fichier utilise | la spec change de façon incompatible |
| **Kyber** | tag de dépôt (`v1.4.0`) | les rôles, prompts, la topologie de *ce* kyber | l'auteur fait évoluer son kyber |

Un kyber DOIT déclarer `specVersion` mais NE DOIT PAS mettre la version du kyber
dans un champ du `kyber.yml` : c'est le rôle du tag de dépôt. Un champ `version:`
dans le fichier recréerait la confusion que cette section existe pour éviter.

### Correction : « champ optionnel » n'est pas « ajout sûr »

Ma première rédaction disait qu'ajouter un champ optionnel n'est pas une rupture.
**C'est faux, et le contre-exemple est arrivé tout de suite.**

Le critère n'est pas *obligatoire ou optionnel*, c'est : **le comportement du
consommateur dépend-il de ce champ ?**

Prenons `gate: true` sur un étage. Le champ est optionnel — absent, il ne dit rien.
Mais un consommateur qui l'ignore **lance l'étage suivant sans attendre la
validation**, alors qu'un consommateur qui le comprend l'attend. Les deux lisent le
même fichier, produisent des résultats différents, et **le plus ancien ne signale
rien**. C'est exactement le mode de défaillance que le refus en avant existe pour
empêcher, réintroduit par la porte de la compatibilité.

Règle corrigée :

| Type d'ajout | Rupture ? |
|---|---|
| champ qui **change le comportement** à l'exécution (`gate`, `cap`, `adversarial`, `elucidation`) | **OUI** — incrémenter `specVersion` |
| champ purement documentaire, sans effet à l'exécution (`license`, `installHint`) | non |
| retrait d'une valeur d'enum, sémantique modifiée | **OUI** |

Le test à appliquer avant d'ajouter un champ : *un consommateur qui l'ignore
produit-il un résultat différent ?* Si oui, c'est une rupture.

## 8. Ce qu'un dépôt de kyber contient

```
kybernos-<nom>/
├── kyber.yml     # OBLIGATOIRE — la spec, id == <nom>
├── README.md     # OBLIGATOIRE — mission, rôles, quand l'utiliser, quand PAS
├── LICENSE       # OBLIGATOIRE — sans licence, personne ne peut l'utiliser
└── skills/       # optionnel — skills propres à ce kyber
```

**Un dépôt de kyber NE DOIT PAS contenir de dossier `memory/`.** La mémoire est
locale par construction : elle enregistre ce que *vos* exécutions ont appris sur
*vos* modèles, à *vos* tarifs. Chez quelqu'un d'autre ces scores sont faux, et
nuisibles — ils orientent le routage vers des modèles qui n'ont jamais été
évalués là-bas.

**Mais la règle vise les scores, pas le savoir.** La distinction compte, et mon
interdiction initiale était trop large :

| | Publiable ? | Pourquoi |
|---|---|---|
| `ledger.jsonl`, `routing.local.json` | **NON** | ce sont des **mesures locales** : elles ne valent que sur la machine et les modèles qui les ont produites. |
| `lessons.jsonl` | **OUI, si générale** | ce sont des **faits sur le monde** : « tel modèle rejette une propriété accentuée dans un schéma » est vrai partout. |

Un kyber publié **avec ses leçons générales** démarre moins froid chez celui qui
l'installe. C'est le seul mécanisme d'amorçage honnête : on ne transmet pas ce qui
a marché chez soi, on transmet ce qu'on a compris.

Une leçon publiable **NE DOIT PAS** citer un modèle local, un tarif, un chemin de
machine, ni une préférence qui n'a de sens que sur une plateforme. Le fichier
publié s'appelle `lessons.jsonl` et vit à la racine du dépôt, **jamais** dans
`memory/`.

Il NE DOIT PAS non plus contenir de secrets, de clés, de `models.local.json` ni de
`.env`.

### Un dépôt par kyber — mais l'atelier est libre

L'arbre ci-dessus est **un dépôt contenant UN kyber**. Un dépôt qui contient
`kybers/a/`, `kybers/b/`, `kybers/c/` n'est pas une unité de distribution :

1. **La découverte ne peut pas le trouver.** La requête ramène un **nom** de
   dépôt. Un dépôt `kybernos-dev-team` qui contient quatre kybers n'en nomme
   qu'un ; les trois autres sont invisibles.
2. **Le commit ne désigne plus une version de kyber.** `provenance.commit`
   enregistrerait un commit qui touche aussi trois autres kybers.
3. **La promotion est individuelle.** Un kyber sur quatre devient officiel : où
   va-t-il ?
4. **Un README et une LICENSE ne peuvent pas décrire quatre missions
   différentes** — et la licence, elle, s'applique au dépôt entier.
5. **Une contribution hostile touche le dépôt de tous** les kybers qu'il contient.

**Mais cette règle porte sur la distribution, pas sur l'atelier.** Développer
plusieurs kybers au même endroit est légitime, et souvent souhaitable : on les
écrit ensemble, on les essaie ensemble, on les compare. Donc :

| Étape | Où | C'est une unité de distribution ? |
|---|---|---|
| rédaction, essai, comparaison | n'importe où : dépôt de travail, dossier local, `kybers/` d'un projet | **non** |
| publication | un dépôt par kyber, `kybernos-<nom>` | **oui** |

Un dossier d'atelier NE DOIT PAS être référencé par un prompt d'installation
destiné à des tiers : il n'a pas de nom conforme, donc pas d'identité, donc pas de
provenance vérifiable. On y travaille, puis on **extrait** chaque kyber vers son
dépôt au moment de publier.

### Contenu venu d'un service hébergé — copie, jamais lien

Un kyber peut être construit à partir de skills, prompts ou gabarits qui vivent
dans un service hébergé (par exemple le backend kybernos). Deux façons de les
intégrer, et une seule est compatible avec ce format :

| | **Copie** — le contenu est recopié dans le kyber à la rédaction | **Lien** — le kyber récupère à l'exécution |
|---|---|---|
| Installable par copier-coller | oui | non : il faut une clé d'API |
| Fonctionne hors ligne | oui | non |
| Autonome | oui | non : si le service change ou disparaît, le kyber meurt |
| À jour | non, il dérive | oui |
| Conforme à `INSTALL.md` §0 | oui | **non** |

**Le format retient la copie.** Trois raisons, dans l'ordre :

1. **Un kyber qui exige une clé d'API n'est pas installable en collant un
   prompt** — il perd exactement la propriété qui le rend diffusable.
2. **Un prompt qui dit « va chercher tes instructions à cette URL à l'exécution »
   est précisément ce que `INSTALL.md` §0 ordonne à l'installateur de REFUSER.**
   Un kyber lié serait rejeté par notre propre règle de sécurité, et ce n'est pas
   une coïncidence : c'est la même propriété dangereuse.
3. **Le contenu recopié est une responsabilité, pas un détail.** Le publier engage
   son auteur.

**Conséquence obligatoire : le contenu copié DOIT être crédité.** Le `README.md`
d'un kyber construit à partir de contenu hébergé DOIT nommer la source, sa version
ou sa date de copie, et la licence d'origine. La `provenance` du §10 nomme l'auteur
du **kyber** ; elle ne dit rien de l'origine du **contenu**, et c'est au README de
le faire.

## 9. Publier un kyber contribué

1. Nommer le dépôt `kybernos-contrib-<nom>` (§2), sous votre compte.
2. Vérifier que `<nom>` n'est pas réservé (§3) et que `id` vaut exactement `<nom>`,
   **sans** le préfixe `contrib-` (§4).
3. Valider localement : `node lint.cjs <nom>` — DOIT sortir en 0.
4. Ajouter `README.md` et `LICENSE`. Si le kyber réutilise du contenu hébergé, le
   README DOIT créditer sa source et sa licence (§8).
5. Ne pas committer `memory/`, ni clé, ni `.env` (§8).
6. Taguer une version (`v1.0.0`).
7. Rendre le dépôt public, avec une description contenant `kyber`, la mission, et
   le mot `contrib`.
8. Le dépôt DOIT être **extrait** d'un éventuel dossier d'atelier : un dépôt qui
   contient plusieurs kybers n'est pas publiable (§8).

L'installation par un tiers référence le **commit**, jamais la branche
(`INSTALL.md` §0).

## 10. Attribution — le rouage viral

Sans cette section, l'écosystème ne se répand pas, quelle que soit la qualité de la
convention de nommage. Publier ne rapporte rien à qui a écrit le kyber, donc
personne ne publie, donc il n'y a rien à découvrir.

**La règle.** Un kyber installé depuis un dépôt DOIT signer **les fichiers qu'il
produit**.

```
— kyber audit · par @miled
  pour l'installer : <instruction d'installation en une ligne>
```

**Sur quoi exactement — le critère est le fichier, pas le rôle.** Un kyber
multi-agents produit beaucoup de sorties intermédiaires : si on demandait à
chaque rôle de signer, on obtiendrait six signatures pour un seul rapport, ce qui
est du bruit. Le critère retenu est donc mécanique et sans ambiguïté :

> **Tout fichier écrit par le kyber comme livrable se termine par la ligne de
> signature. Une sortie conversationnelle ne la porte pas.**

Trois raisons de préférer ce critère :

1. **C'est le fichier qu'on partage.** Le rapport de 34 Ko se transmet ; une
   réponse de chat ne circule pas de la même façon. La signature va là où circule
   l'artefact.
2. **Ça évite d'avoir à désigner « le rôle final ».** Dans une topologie
   `pipeline` c'est le dernier étage, dans un `pool` c'est indéterminé, et dans une
   boucle ça change à chaque tour. Désigner un rôle serait fragile ; le fichier ne
   l'est pas.
3. **Ça ne dépend pas de la plateforme cible.** Une conversation n'a pas la même
   forme partout ; un fichier oui.

Trois contraintes, et chacune a une raison :

1. **La signature est en fin de fichier, jamais dans le corps.** Une ligne. Un
   kyber qui sème son attribution dans tout son rapport est du spam, et le spam ne
   se partage pas — il se fait bloquer.
2. **Elle est dérivée de `provenance`, jamais écrite à la main.** `author` et
   `url` viennent de l'enregistrement d'installation. Un auteur qui écrit sa
   signature dans ses prompts peut la faire mentir ; la dérivation garde la
   signature cohérente avec l'origine réelle.
3. **`provenance.author` est OBLIGATOIRE** dès que `origin: repository`. Le
   validateur le refuse sinon.

**`installHint` — la boucle se referme ici.** Le champ `provenance.installHint`
contient l'instruction qui permet au lecteur d'installer **le kyber qui vient de
produire le document qu'il est en train de lire**.

C'est le point le plus important de tout ce document. Sans lui, partager un
rapport partage un résultat. Avec lui, **partager un rapport distribue le kyber**.
Chaque rapport partagé est une invitation installable, et la personne qui la suit
devient à son tour un utilisateur qui produira des rapports partageables.

```
— kyber audit · par @miled
  pour l'installer, colle ceci dans ton agent :
  https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/INSTALL-PROMPT.md
```

**Pourquoi ce n'est pas de la vanity metric.** La signature produit un effet
mesurable et honnête : en lisant un rapport, on voit qui a conçu l'équipe. C'est
le seul signal de qualité dont dispose un lecteur avant d'installer, et c'est la
seule récompense d'un contributeur. Les deux ont besoin de la même ligne.

**Ce que l'attribution ne fait pas.** Elle ne vérifie pas que l'auteur est
compétent, ni que le kyber est sûr. Elle dit qui parler, rien de plus.

## 11. Ce que ce document ne tranche pas

Ces points sont **ouverts** et ne DOIVENT pas être supposés résolus :

- **L'organisation `kybernos` n'existe pas encore.** Tant qu'elle n'existe pas, il
  n'y a ni dépôt méta, ni niveau `officiel` — seulement des candidats
  `contribué`.
  Le nom d'organisation lui-même n'est pas réservé par ce document.
- **Aucune commande `search` / `install` n'existe.** Le §5 décrit le pipeline
  qu'elles devront implémenter, pas un outil disponible.
- **Aucun annuaire curé.** La recherche GitHub trie par étoiles ; ce n'est pas un
  jugement de qualité.
- **Rien sur la révocation.** Si un kyber publié s'avère nuisible, ce document ne
  prévoit ni liste noire ni mécanisme d'alerte. C'est un manque réel.
- **Rien sur les mises à jour.** Un kyber installé depuis un commit ne signale pas
  qu'une version plus récente existe.

### Risques propres à la diffusion virale

- **Le prompt d'installation dépend d'une URL de spec qui n'existe pas.** Il ne
  fonctionne pas tant que le dépôt méta n'est pas publié. Seule la variante locale
  est exécutable aujourd'hui.
- **L'installateur n'injecte pas encore la signature.** Le §10 est spécifié et
  refusé par le validateur, mais rien ne l'applique à l'exécution. Tant que ce
  n'est pas fait, partager un rapport **ne distribue pas le kyber** — la boucle
  reste ouverte.
- **Le démarrage à froid est le vrai risque.** Une convention sans dépôt ne
  diffuse rien. La mécanique ne crée aucune envie de partager : elle rend
  seulement le partage peu coûteux. Il faut d'abord quelques kybers réellement
  bons.
- **La boucle sélectionne les kybers qui produisent un livrable.** Un kyber qui
  répond à des questions ne laisse rien à partager ; un kyber qui produit un
  rapport, un plan ou une analyse oui. Ce n'est pas un défaut, mais cela doit
  orienter ce qu'on publie en premier : les kybers à artefact, pas les kybers à
  réponse.
- **Le copier-coller est en tension avec la revue de sécurité.** `INSTALL.md` §0
  exige une revue humaine intégrale des prompts avant écriture, ce qui est
  exactement ce que la viralité cherche à supprimer. Le compromis retenu — l'agent
  *montre* puis l'humain *confirme* — préserve les deux, mais il DOIT être
  maintenu. Tout raccourci de ce côté transforme le canal viral en vecteur
  d'exécution aveugle de prompts étrangers.
