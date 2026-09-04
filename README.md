# LLM Orchestrator MCP

**Zero-dependency MCP server** (Node ≥ 18, native `fetch`) that turns any MCP-compatible coding agent into a **multi-model orchestrator**.

After installation, it:

1. **Health-checks** every model in the catalog (GPT-5, Claude 4.5, Gemini 3, Mistral Large 2, Llama 4) — availability + latency.
2. **Detects the best model** in the list (score = health 40%, latency 30%, context 20%, quality 10% — weights editable in `models.json`).
3. **Promotes it to orchestrator**: it breaks complex requests into sub-tasks.
4. **Delegates each task** to the most suitable model by task type: `code`, `writing`, `analysis`, `longcontext`, `multimodal`, `cheap`, `local` (routing rules editable in `models.json`).
5. **Synthesizes** all sub-task results into a single answer.

Works with **Opencode, Cursor, Claude Code, Windsurf** — and any MCP stdio client.

```
┌───────────────┐     MCP stdio     ┌──────────────────────────────┐
│ Your agent    │◄────────────────►│ llm-orchestrator (this MCP)  │
│ (any client)  │                  │  best model = orchestrator   │
└───────────────┘                  └───────┬──────────────────────┘
                                           │ delegates per task type
          ┌────────────┬────────────┬──────┴─────┬────────────┐
          ▼            ▼            ▼            ▼            ▼
        GPT-5      Claude 4.5    Gemini 3    Mistral L2    Llama 4
        (code)     (writing)   (multimodal)   (cheap)   (longcontext)
```

## Requirements

- **Node.js ≥ 18** (uses native `fetch`)
- At least **one API key** (OpenAI, Anthropic, Google, Mistral or Groq)

## Quick install (multi-client)

```bash
git clone https://github.com/platonai-net/llm-orchestrator-mcp.git
cd llm-orchestrator-mcp
bash install.sh
```

The script auto-registers the server into:

| Client | Config file |
|---|---|
| Opencode | `~/.config/opencode/opencode.json` |
| Cursor | `~/.cursor/mcp.json` |
| Claude Code | `~/.claude.json` (global) + `.mcp.json` (project) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

It is **idempotent** — run it again any time, it merges without touching existing entries (no `jq` needed, falls back to `node`).

Then **restart your client** to load the server.

## Manual registration (any MCP client)

Add to your client's MCP config:

```json
{
  "mcpServers": {
    "llm-orchestrator": {
      "command": "node",
      "args": ["/absolute/path/to/llm-orchestrator-mcp/server.js"]
    }
  }
}
```

> Opencode uses `"type": "local", "command": ["node", "..."]`; Claude Code uses `"type": "stdio"`.

## API keys

Set at least one (the server reads them from the **client's environment** — export them in your shell profile, e.g. `~/.zshrc`):

```bash
export OPENAI_API_KEY=...      # GPT-5
export ANTHROPIC_API_KEY=...   # Claude 4.5
export GEMINI_API_KEY=...      # Gemini 3
export MISTRAL_API_KEY=...     # Mistral Large 2
export GROQ_API_KEY=...        # Llama 4 (served via Groq)
```

Models without a key (or failing with 401/429/404/network errors) are **automatically excluded** — the orchestrator is elected among **healthy models only**.

## MCP tools

| Tool | Purpose |
|---|---|
| `llm_status` | Probe all models, compute scores, elect the best one as orchestrator |
| `llm_delegate` | Delegate one task to the best model for its type (auto-detected) |
| `llm_orchestrate` | Split a request into sub-tasks, route each one, synthesize |

### `llm_delegate` arguments

| Arg | Type | Description |
|---|---|---|
| `task` | string (required) | The task to run |
| `taskType` | enum | `code`, `writing`, `analysis`, `longcontext`, `multimodal`, `cheap`, `local` (auto-detected if omitted) |
| `model` | enum | Force a specific model (`gpt-5`, `claude-4.5`, ...) |
| `maxTokens` | integer | Max answer size (default 2048) |

### `llm_orchestrate` arguments

| Arg | Type | Description |
|---|---|---|
| `request` | string (required) | The full user request |
| `maxSubtasks` | integer | Max sub-tasks (default 5) |

## Usage in your agent

> "check the health of the models and pick the best"

→ calls `llm_status`; the orchestrator is elected.

> "orchestrate: analyze this long contract, write a summary email and fix the build script"

→ calls `llm_orchestrate`: each sub-task goes to the best-suited model, then results are synthesized.

> "delegate to the cheapest model: translate this text"

→ calls `llm_delegate` with `taskType: "cheap"`.

## How models are scored

```
score = health×40% + latency×30% + context×20% + quality×10%
```

- **health** — model answered a live probe (mandatory, otherwise score = 0)
- **latency** — probe round-trip time (50 ms = +1 pt, 5 s = 0 pt)
- **context** — context window size (100k = 5 pts, 1M = 50 pts, 2M = 100 pts)
- **quality** — static rating per model in the catalog

The highest-scoring healthy model becomes the **orchestrator**; routing preference per task type is applied next.

## Configuration

Everything lives in `models.json`:

- `selection.weights` — scoring weights (health / latency / context / quality)
- `routing.<type>.preferred` — model preference order per task type, `minScore` floor
- `probeTimeoutMs`, `probeMaxTokens`, `probePrompt` — health probe tuning
- `orchestratorSystemPrompt` — the orchestrator's system instruction

Per-model env overrides: `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `MISTRAL_MODEL`, `GROQ_MODEL`, and `*_BASE_URL` for each provider.

## Troubleshooting

```bash
LLM_ORCH_DEBUG=1 node server.js                       # startup logs
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node server.js
```

Check a client actually sees the server: run `llm_status` in your agent — a model with `errorKind: "no-key"` means the client's environment lacks the key.

## Repository layout

```
llm-orchestrator-mcp/
├── server.js     # MCP server (JSON-RPC over stdio, zero dependencies)
├── models.json   # catalog + routing rules + scoring weights
├── install.sh    # multi-client installer (Opencode, Cursor, Claude Code, Windsurf)
├── package.json
└── README.md
```

## License

MIT