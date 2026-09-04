# LLM Orchestrator MCP

**Zero-dependency MCP server** (Node ≥ 18, native `fetch`) that turns any MCP-compatible coding agent into a **multi-model orchestrator** — with **any LLM**, not just the built-in catalog.

After installation, it:

1. **Detects available LLMs automatically** (see *Dynamic detection* below) — OpenAI, Anthropic, Google, Mistral, Groq, **Ollama**, vLLM, LM Studio… any OpenAI-compatible endpoint.
2. **Health-checks** every detected model — availability + latency.
3. **Detects the best model** in the list (score = health 40%, latency 30%, context 20%, quality 10% — weights editable in `models.json`).
4. **Promotes it to orchestrator**: it breaks complex requests into sub-tasks.
5. **Delegates each task** to the most suitable model by task type (`code`, `writing`, `analysis`, `longcontext`, `multimodal`, `cheap`, `local`) and **specialist role** (`orchestrator`, `github-manager`, `auditor`, `business-analyst`…).
6. **Synthesizes** all sub-task results into a single answer.

Works with **Opencode, Cursor, Claude Code, Windsurf, Kimi Code** — and any MCP stdio client.

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

**Or one-liner** (no clone needed — auto-downloads to `~/.llm-orchestrator-mcp`):

```bash
curl -fsSL https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/install.sh | bash
```

The script auto-registers the server into:

| Client | Config file |
|---|---|
| Opencode | `~/.config/opencode/opencode.json` |
| Cursor | `~/.cursor/mcp.json` |
| Claude Code | `~/.claude.json` (global) + `.mcp.json` (project) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Kimi Code / Kimi CLI | `~/.kimi/mcp.json` |

It is **idempotent** — run it again any time, it merges without touching existing entries (no `jq` needed, falls back to `node`).

Then **restart your client** to load the server.

## Copy-paste install (per client)

Prefer adding the config by hand? Copy the block below into your client's config file — replace `/absolute/path/to/llm-orchestrator-mcp` with the real path (e.g. `~/.llm-orchestrator-mcp` if you used the one-liner).

### Opencode — `~/.config/opencode/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "llm-orchestrator": {
      "type": "local",
      "command": ["node", "/absolute/path/to/llm-orchestrator-mcp/server.js"],
      "enabled": true
    }
  }
}
```

### Cursor — `~/.cursor/mcp.json`

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

### Claude Code — `~/.claude.json` (or project `.mcp.json`)

```json
{
  "mcpServers": {
    "llm-orchestrator": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/llm-orchestrator-mcp/server.js"]
    }
  }
}
```

Or simply:

```bash
claude mcp add llm-orchestrator -- node /absolute/path/to/llm-orchestrator-mcp/server.js
```

### Windsurf — `~/.codeium/windsurf/mcp_config.json`

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

### Kimi Code / Kimi CLI — `~/.kimi/mcp.json`

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

Or via the CLI (well-known MCP config format also supported):

```bash
kimi mcp add --transport stdio llm-orchestrator -- node /absolute/path/to/llm-orchestrator-mcp/server.js
```

> If your agent config lives elsewhere, any MCP-stdio entry pointing at `node /path/to/server.js` works — the protocol is standard JSON-RPC over stdio.

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

## Dynamic detection (any LLM)

The server **discovers available LLMs itself** at runtime — no hard-coded list. Four sources, combined:

| Source | How it works |
|---|---|
| **API keys in env** | Any provider key present (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `OLLAMA_API_KEY`…) activates its provider |
| **`/models` listing** | Queries each provider's model-list endpoint and auto-registers usable models (embeddings/image models filtered out) |
| **`LLM_ORCH_MODELS` env** | `export LLM_ORCH_MODELS="ollama:qwen2.5-coder:7b,openai:gpt-4.1-mini,anthropic:claude-3-5-haiku"` |
| **`models.local.json`** | Git-ignored file next to `server.js` (or `LLM_ORCH_LOCAL_MODELS=path`) for full control |

`models.local.json` example — **any provider, any OpenAI-compatible endpoint**:

```json
[
  { "id": "qwen-coder", "provider": "ollama", "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5-coder:7b" },
  { "id": "vllm-70b", "provider": "vllm", "baseUrl": "http://my-server:8000/v1", "model": "qwen-72b", "apiKeyEnv": "VLLM_API_KEY" },
  { "id": "lmstudio", "provider": "lmstudio", "baseUrl": "http://localhost:1234/v1", "model": "mistral-small" }
]
```

Local servers (**Ollama, vLLM, LM Studio, llama.cpp**) work **without any API key**. Discovery is capped (`discovery.maxPerProvider` / `maxTotal` in `models.json`) to keep probing fast.

## Specialist roles (mini-prompts)

Tasks can run under a **role** — a compact specialist system-prompt. Built-in roles (editable in `models.json`):

| Role | Specialty |
|---|---|
| `orchestrator` | Decompose, sequence, delegate, merge |
| `github-manager` | Repos, branches, commits, PRs, issues, releases (via `gh`/git CLI) |
| `auditor` | Code/security/compliance review, severity-rated findings |
| `business-analyst` | Requirements, user stories, KPIs, process maps, risks |

Add your own in `models.json` under `"roles"` — the orchestrator auto-assigns roles per sub-task, or force one:

> "delegate to the auditor role: review this repo"

## MCP tools

| Tool | Purpose |
|---|---|
| `llm_status` | Detect available LLMs, probe all models, compute scores, elect the best one as orchestrator |
| `llm_delegate` | Delegate one task to the best model for its type (auto-detected), optionally with a specialist `role` |
| `llm_orchestrate` | Split a request into sub-tasks, assign roles, route each one, synthesize |

### `llm_delegate` arguments

| Arg | Type | Description |
|---|---|---|
| `task` | string (required) | The task to run |
| `taskType` | enum | `code`, `writing`, `analysis`, `longcontext`, `multimodal`, `cheap`, `local` (auto-detected if omitted) |
| `model` | string | Force a specific model (any detected id, e.g. `gpt-5`, `ollama:qwen2.5-coder:7b`) |
| `role` | enum | Specialist mini-prompt: `orchestrator`, `github-manager`, `auditor`, `business-analyst`, … |
| `maxTokens` | integer | Max answer size (default 2048) |

### `llm_orchestrate` arguments

| Arg | Type | Description |
|---|---|---|
| `request` | string (required) | The full user request |
| `maxSubtasks` | integer | Max sub-tasks (default 5) |
| `roles` | boolean | Enable specialist-role assignment (default true) |

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
- `roles.<id>.prompt` — specialist mini-prompts (orchestrator, github-manager, auditor, business-analyst, + your own)
- `discovery` — `enabled`, `maxPerProvider`, `maxTotal` for automatic model detection
- `probeTimeoutMs`, `probeMaxTokens`, `probePrompt` — health probe tuning
- `orchestratorSystemPrompt` — the orchestrator's system instruction

Per-model env overrides: `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `MISTRAL_MODEL`, `GROQ_MODEL`, `OLLAMA_BASE_URL`, and `*_BASE_URL` for each provider.

## Troubleshooting

```bash
LLM_ORCH_DEBUG=1 node server.js                       # startup logs
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node server.js
```

Check a client actually sees the server: run `llm_status` in your agent — a model with `errorKind: "no-key"` means the client's environment lacks the key.

## Repository layout

```
llm-orchestrator-mcp/
├── server.js        # MCP server (JSON-RPC over stdio, zero dependencies)
├── models.json      # catalog + routing rules + roles + scoring weights
├── models.local.json  # (optional, git-ignored) your own models/providers
├── install.sh       # multi-client installer (Opencode, Cursor, Claude Code, Windsurf, Kimi Code)
├── package.json
└── README.md
```

## License

MIT