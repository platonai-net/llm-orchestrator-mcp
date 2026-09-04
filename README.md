# LLM Orchestrator MCP

Petit serveur MCP **zéro dépendance** (Node ≥ 18, fetch natif) qui, après installation :

1. **Teste la santé** de chaque modèle (GPT-5, Claude 4.5, Gemini 3, Mistral Large 2, Llama 4) — latence + disponibilité.
2. **Détecte le meilleur modèle** de la liste (score = santé 40 %, latence 30 %, contexte 20 %, qualité 10 %, pondérations éditables dans `models.json`).
3. **Prend ce modèle comme orchestrateur** : il décompose les demandes complexes en sous-tâches.
4. **Délègue chaque tâche** au modèle le plus adapté : `code`, `writing`, `analysis`, `longcontext`, `multimodal`, `cheap`, `local` (règles éditables dans `models.json`).
5. **Synthétise** les résultats de toutes les sous-tâches.

Multi-plateforme : fonctionne avec **Opencode, Cursor, Claude Code, Windsurf** (et tout client MCP stdio).

## Installation

```bash
bash install.sh
```

Le script inscrit le serveur dans :
- `~/.config/opencode/opencode.json` (Opencode)
- `~/.cursor/mcp.json` (Cursor)
- `~/.claude.json` + `.mcp.json` du projet (Claude Code)
- `~/.codeium/windsurf/mcp_config.json` (Windsurf)

Redémarre ensuite ton client.

## Clés API

Au moins une est nécessaire (le serveur lit les variables d'environnement du client) :

```bash
export OPENAI_API_KEY=...      # GPT-5
export ANTHROPIC_API_KEY=...   # Claude 4.5
export GEMINI_API_KEY=...      # Gemini 3
export MISTRAL_API_KEY=...     # Mistral Large 2
export GROQ_API_KEY=...        # Llama 4 (via Groq)
```

Les modèles sans clé (ou en erreur 401/429/404/réseau) sont automatiquement exclus de la sélection — l'orchestrateur est choisi parmi les modèles **sains uniquement**.

## Outils MCP exposés

| Outil | Rôle |
|---|---|
| `llm_status` | Sonde tous les modèles, calcule les scores, désigne l'orchestrateur (le meilleur) |
| `llm_delegate` | Délègue une tâche au meilleur modèle pour son type (détecté automatiquement) |
| `llm_orchestrate` | Décompose une demande en sous-tâches, route chacune, synthétise |

## Exemples d'usage dans ton agent

> « teste la santé des modèles et choisis le meilleur »

→ appelle `llm_status`, l'orchestrateur est désigné.

> « orchestre : analyse ce rapport, rédige la synthèse et corrige le script de build »

→ appelle `llm_orchestrate` : chaque sous-tâche part vers le modèle adéquat, puis l'orchestrateur synthétise.

> « délègue au modèle le moins cher : traduis ce texte »

→ appelle `llm_delegate` avec `taskType: "cheap"`.

## Personnalisation

Tout se règle dans `models.json` :
- `selection.weights` : pondérations du score (santé/latence/contexte/qualité).
- `routing.<type>.preferred` : ordre de préférence par type de tâche.
- `probeTimeoutMs` : timeout de sondage santé.
- `orchestratorSystemPrompt` : consigne système de l'orchestrateur.

Chemins de config surchargés par variables d'environnement côté modèles : `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `MISTRAL_MODEL`, `GROQ_MODEL`, `*_BASE_URL`.

## Dépannage

```bash
LLM_ORCH_DEBUG=1 node server.js     # logs de démarrage
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node server.js
```

## Arborescence

```
llm-orchestrator-mcp/
├── server.js     # serveur MCP (JSON-RPC stdio, sans dépendance)
├── models.json   # catalogue + règles de routage + pondérations
├── install.sh    # installation multi-clients (Opencode, Cursor, Claude, Windsurf)
├── package.json
└── README.md
```