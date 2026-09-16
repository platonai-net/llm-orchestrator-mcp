# Kybers — équipes d'agents portables

Un **kyber** est une équipe d'agents spécialisés avec une forme : des rôles, une
topologie, des exigences de modèles, et une boucle de mémoire. C'est un fichier
`kyber.yml` — pas un programme.

L'intérêt : **il s'installe en collant un prompt** dans n'importe quel outil
(Cursor, Opencode, DSH, Claude Code…) qui a accès aux fichiers. Pas de paquet, pas
de runtime, pas de compte. L'agent qui reçoit le prompt découvre l'architecture de
son propre outil, résout les exigences de modèles contre ce qui existe réellement
chez vous, et vous demande confirmation avant d'écrire.

## Les quatre kybers

| Kyber | Forme | Ce qu'il fait |
|---|---|---|
| **`dev-team`** | `pipeline`, 8 étages | Une équipe de développement complète : cartographie → cadrage → spec → **porte** → implémentation → test → **revue adverse** → livraison. Cap de 6 agents en parallèle, DoD exécutables, zéro lancement spéculatif avant le GO. |
| **`audit`** | `adversarial`, 4 étages | Cartographie → constats (itérés, cap 6) → **réfutation** → rapport. Sa valeur : des constats qui résistent à la réfutation, et les constats tombés partent en annexe au lieu d'être effacés. |
| **`veille`** | `mapreduce`, 4 étages | **Interroge d'abord** (10 questions, obligatoire), puis collecte sur des sources officielles *et* des signaux faibles, trie le signal du bruit, écrit un digest daté et cité. |
| **`socratic`** | `pipeline`, 4 étages | Ne donne **jamais** la réponse. Questionne, reformule, puis fait s'affronter avocat et procureur de votre propre thèse. Le livrable est une pensée mieux formée, pas un artefact. |

## Installer

Copiez ce bloc dans votre agent :

```text
Installe le kyber « dev-team » dans mon outil.

Spec générale : https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/INSTALL.md
                https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/CONVENTION.md
Source du kyber : https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/dev-team/kyber.yml
                  → lis INSTALL.md ET CONVENTION.md en entier avant d'agir.
Si tu ne peux pas lire la spec, ARRÊTE-TOI et dis-le. Ne devine pas le format.

Applique INSTALL.md §0 à §5. Tu dois, dans cet ordre :

1. Découvrir l'architecture de MON outil — où vivent les agents, les skills, les
   connecteurs, la mémoire — EN INSPECTANT. Pas de mémoire, pas de supposition.
2. Résoudre le champ `needs` de chaque rôle contre les modèles RÉELLEMENT
   disponibles chez moi, et me montrer la table rôle → modèle.
3. M'afficher AVANT D'ÉCRIRE QUOI QUE CE SOIT : chaque `prompt:` de rôle EN
   ENTIER, chaque skill EN ENTIER, la table de résolution, et le sort de chaque
   étage de topologie.
4. Obtenir ma confirmation explicite. Pas d'installation automatique.
5. Écrire `provenance` avec l'URL et le COMMIT — jamais une branche.
6. Me dire à la fin ce que tu as installé, et ce que tu as DÉGRADÉ.
```

Remplacez `dev-team` par `audit`, `veille` ou `socratic`. Les variantes locale et
« publier mon kyber » sont dans [`INSTALL-PROMPT.md`](INSTALL-PROMPT.md).

> **Pourquoi montrer les prompts en entier ?** Un kyber n'est pas de la
> configuration, c'est du **langage naturel adressé à un agent outillé**. Il peut
> contenir n'importe quoi. `INSTALL.md` §0 impose de tout afficher avant d'écrire,
> et de refuser sans négocier un contenu qui exfiltre, exécute à distance ou
> contourne les validations.

## Valider

```bash
node kybers/lint.cjs --dir=$PWD/kybers          # tous
node kybers/lint.cjs --dir=$PWD/kybers dev-team # un seul
```

Le validateur vérifie la cohérence du fichier : `id` = dossier, version de spec,
rôles atteignables, absence de cycle, portes qui gardent réellement quelque chose,
`definitionOfDone` non vide, noms réservés, et — s'il trouve un `.probe.json` — la
disponibilité réelle des modèles déclarés.

**Ce qu'il ne garantit pas** : que l'exécution respecte le fichier. Il valide un
texte, pas un comportement.

## Crédit

Les prompts de rôles, la doctrine de parallélisme (`cap` dur à 6, zéro lancement
spéculatif avant GO, definition of done vérifiable par commande, garde de
récursion) et les gabarits de domaines sont **adaptés du projet interne
`kybernos`** — traduits, condensés, et recopiés dans chaque fichier plutôt que
liés.

**Pourquoi pas de lien** : le dépôt source n'est pas public à ce jour, donc une
URL renverrait 404. Un crédit qui ne résout pas est pire que pas de crédit — le
lecteur ne peut pas vérifier l'origine, et ça ressemble à une revendication en
l'air. Le lien sera rétabli si la source est publiée.

## Limites connues du format

Trois kybers écrits indépendamment ont convergé sur les mêmes manques. Ils sont
réels et non corrigés — les taire serait pire que les documenter.

> ### Comment ces limites ont été trouvées
>
> Les quatre kybers ont été écrits **par des agents séparés, sans se voir**, à
> partir du même format et de la même doctrine. Trois d'entre eux ont buté
> **indépendamment** sur exactement les mêmes défauts :
>
> | Défaut | `dev-team` | `veille` | `audit` | `socratic` |
> |---|:---:|:---:|:---:|:---:|
> | Une porte ne peut pas garder l'entrée | ✓ | ✓ | ✓ | ✓ |
> | `inputs` ne sait qu'ajouter, jamais retirer | ✓ | | ✓ | |
> | DoD à deux niveaux sans logement | ✓ | | ✓ | ✓ |
> | Aucun mécanisme d'arrêt ni d'escalade | ✓ | | ✓ | |
> | `role:` non vérifié par le validateur | ✓ | ✓ | ✓ | |
> | Contrat d'artefacts à inventer | ✓ | ✓ | ✓ | |
>
> **Quatre agents sur quatre** ont buté sur la porte d'entrée, et chacun a réagi
> différemment — l'un a déplacé la porte, l'autre l'a tue, deux l'ont documentée
> comme un renoncement. Aucun n'a inventé de champ. C'est ce qui a permis de
> trancher entre « le format a raison et l'auteur se trompe » et « le format a
> tort » : quand quatre lecteurs indépendants se heurtent au même mur, c'est le
> mur.
>
> Les trois premiers défauts de ce tableau sont **corrigés depuis**. Les autres
> sont ouverts.

| Limite | Conséquence |
|---|---|
| **Pas d'arête arrière** | Le verdict ternaire de la doctrine (GO / **AMEND** / NO-GO), où AMEND renvoie le travail en arrière, est inexprimable : les `inputs` ne peuvent citer qu'un étage antérieur. La boucle de correction n'existe qu'en prose. |
| **`inputs` ne sait qu'ajouter** | L'invariant qui fonde la revue adverse — « ne reçois jamais le récit de l'implémenteur, juge sur la spec et le diff » — est une **soustraction** de contexte. `inputs` ne sait pas retirer. |
| **Une porte ne peut pas être terminale** | La porte de production (« rien ne part sans validation humaine ») est la dernière. `gate` exige un étage en aval. *(Les portes d'entrée sont désormais acceptées.)* |
| **DoD à un seul niveau** | La doctrine distingue `must-pass` et `advisory` (critères humains). Le format n'a qu'une liste plate, donc l'advisory finit en prose — exactement la forme non vérifiable que le champ combat. |
| **`elucidation` n'est lu par rien** | Le champ dit *qu'il faut* interroger l'humain, jamais **quoi** demander ni **où** mettre les réponses. Aucune skill ne le lit : un orchestrateur qui l'ignore compose l'équipe sans rien demander, **et ne le signale pas**. |
| **`cap` n'a pas de sémantique tranchée** | Quota par vague ou plafond en vol ? Deux lectures, deux comportements. Le disjoncteur de saturation (cap 6 → 3 après erreurs) exige un plafond **variable**, que le champ n'accepte pas. |
| **Pas de contrat d'artefacts** | Aucun champ ne dit où un étage écrit ses sorties. Deux kybers ont inventé `$RUN/…` séparément, avec des conventions différentes. C'est leur principale fragilité. |
| **Pas d'état inter-runs** | `memory:` ne porte que des scores de routage. « Ce qui a changé depuis le dernier cycle » — le cœur d'une veille — n'a nulle part où être rangé. |
| **Pas d'enveloppe de ressources** | La doctrine impose un budget en minutes par contrat, avec des plafonds par rôle. Rien de déclarable ; `maxDepth` borne la cascade, pas le coût. |
| **Aucun mécanisme d'arrêt ni d'escalade** | C'est le manque le plus grave. La doctrine définit un disjoncteur (« > 30 % de tâches bloquées → arrêt du run + escalade humaine ») et une chaîne d'escalade à déclencheurs observés (même signature d'erreur 2×, 3 tentatives sans progrès). Aucun champ ne permet d'**arrêter un run ni d'interroger l'humain pendant qu'il tourne** — `elucidation` interroge *avant* de composer, jamais pendant. Un kyber réel a dû dégrader la règle en simple mention dans le rapport : le « passer au suivant » et l'escalade ont disparu. **Toutes les règles qui empêchent de boucler indéfiniment atterrissent ici.** |
| **Les dépendances binaires ne sont déclarables nulle part** | Des `definitionOfDone` réelles s'appuient sur `jq` et `git`. `tools:` sert aux connecteurs, pas aux exécutables : rien ne dit qu'un étage refuse de tourner sans `jq`, ni où le déclarer. Une DoD peut donc être inapplicable sur la machine cible **sans que rien ne le signale à l'installation**. |

## État de vérification

Les quatre fichiers passent `lint.cjs`. `audit` et `veille` ont en outre **exercé
leurs `definitionOfDone` contre des fixtures** — 27 commandes au total, chacune
vérifiée comme discriminante (source absente → échec, arbre pollué → échec,
constat réfuté cité dans le corps → échec).

**Aucun des quatre n'a été exécuté de bout en bout** au sens d'`INSTALL.md` §2.4.
Une version antérieure d'`audit` a réellement tourné sur DSH (4 rôles, 0 échec
technique, un constat réfuté puis écarté en annexe), mais pas ces fichiers-ci.
