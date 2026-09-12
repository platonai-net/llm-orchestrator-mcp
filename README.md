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

**Recommended — download, inspect, then run** (never pipe straight into a shell). This server runs with your API keys in scope, so review what you run:

```bash
curl -fsSL -o install.sh https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/install.sh
less install.sh        # inspect the installer + pinned SHA-256 hashes
sh install.sh
```

**Quick one-liner** (less safe — no inspection, and piped scripts change over time; the pinned checksums inside `install.sh` do still protect the 4 downloaded files, but you haven't reviewed the pipe itself):

```bash
curl -fsSL https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/install.sh | bash
```

> **Supply-chain warning:** only install from the official repo (`platonai-net/llm-orchestrator-mcp`). `install.sh` pins the SHA-256 of `server.js`, `hosted.js`, `memory.js` and `models.json` at download time and aborts on any mismatch — but a modified pipe (or a fork) can change that guarantee, so inspect first. See *Security notes*.

Instead of the one-liner you can also clone the repo and run `install.sh` from the checkout (it then installs from the cloned files directly).

The script auto-registers the server into:

| Client | Config file |
|---|---|
| Opencode | `~/.config/opencode/opencode.json` — `opencode.jsonc` also supported (auto-detected) |
| Cursor | `~/.cursor/mcp.json` |
| Claude Code | `~/.claude.json` (global) + `.mcp.json` (project) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Kimi Code / Kimi CLI | `~/.kimi/mcp.json` |

It is **idempotent** — run it again any time, it merges without touching existing entries (no `jq` needed, falls back to `node`).

The installer also asks for your **backend mode** (see below) — non-interactive runs default to `local`.

Then **restart your client** to load the server.

## Uninstall / key rotation

Remove the server and clear your `KYBERNOS_API_KEY` from the client configs:

```bash
sh install.sh --remove
```

`--remove` is **idempotent** — it deletes only the `llm-orchestrator` entries `install.sh` added (the `mcp`/`mcpServers` key in each of the 5 client config files) and deletes `~/.llm-orchestrator-mcp`. Entries belonging to other tools are left untouched. Run it with a custom `HOME` to dry-run safely:

```bash
HOME=$(mktemp -d) sh install.sh --remove   # exits 0, prints what it would remove
```

**Rotating your Kybernos key:** running `install.sh` again with the new `KYBERNOS_API_KEY` env overwrites the old key's `env` block. To clear a key entirely, run `install.sh --remove`, then re-install with the backend you want.

## Backends: local | hosted | both

The server runs against one of three backends, switched by `KYBERNOS_MCP_BACKEND`:

```bash
export KYBERNOS_MCP_BACKEND=local    # default — your own LLM API keys
export KYBERNOS_MCP_BACKEND=hosted   # Kybernos proxy tools only (virtual key)
export KYBERNOS_MCP_BACKEND=both     # local delegation + hosted tools
```

| | `local` (default) | `hosted` | `both` |
|---|---|---|---|
| **Cost** | Your provider API keys (pay per use, local models free) | Kybernos virtual key (`kys-…`) | Both |
| **Models** | Any LLM you have a key for (OpenAI, Anthropic, Google, Mistral, Groq, Ollama, vLLM…) | Server-side models behind the proxy | All of them |
| **Kybers / crews** | — | `kyber_list`, `kyber_get` (read-only, frozen contract v1) | Same as hosted |
| **Memory** | Local Ruflo-lite memory (`llm_feedback` / `llm_recall`, trajectories + EWMA stats + lessons) | Same local memory | Same local memory |
| **Requirements** | Node ≥ 18 + ≥ 1 provider key | Node ≥ 18 + `KYBERNOS_API_KEY` | Node ≥ 18 + both |

**Start local, upgrade hosted**: begin with zero cost using your existing keys (or a local Ollama), then add a Kybernos virtual key later — set `both` and the hosted tools (`kyber_*`, `prompt_*`, `lesson_search`, `memory_search`, `usage_query`, `skills_list`, `templates_list`, `modules_list`) appear next to the local ones. Nothing else changes; the same server, same client config, one env var.

Hosted endpoints (all configurable):

```bash
export KYBERNOS_MCP_URL=https://api.dev.kybernos.app   # proxy base URL (default)
export KYBERNOS_API_KEY=kys-...                        # virtual key, env only
```

Notes:

- Hosted calls are forwarded over POST-only **Streamable HTTP** to `<base URL>/mcp` with a keep-alive connection and a 30s timeout; `tools/list` results are cached for 60s to avoid double-hop latency.
- The hosted tool surface is a **frozen contract** (`v1`, 11 tools). If the proxy diverges (unknown or missing tool), you get an explicit version-mismatch error naming the tool — never a silent failure.
- Outputs coming back from the hosted backend are **sanitized** (see Security notes).

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

## Local memory (Ruflo-lite)

Every mode ships a tiny local, file-based memory — no embeddings, pure JS keyword scoring, all under a git-ignored `.orchestrator/<hash-of-cwd>/` directory next to where you launch the server (override with `LLM_ORCH_MEMORY_DIR`):

- `memory.jsonl` — append-only trajectories (`{ts, cwd, taskType, model, prompt_summary, outcome}`), fed by `llm_feedback`, searched by `llm_recall`.
- `stats.json` — **EWMA success score** per `(taskType, model)` (α = 0.2, per-update impact clamped). It *biases* model election among **healthy** models only — it can never override health checks or your explicit routing rules.
- `lessons.json` — distilled lessons (≤ 500 chars, keyword tags, capped at 50). The best-matching lessons are auto-injected into `llm_delegate` prompts, and you can search them with `llm_recall`.

Corrupted files are quarantined and regenerated — bad state never crashes the server.

## MCP tools

**Local (all modes):**

| Tool | Purpose |
|---|---|
| `llm_status` | Detect available LLMs, probe all models, compute scores, elect the best one as orchestrator (+ hosted backend health/contract check in hosted\|both) |
| `llm_delegate` | Delegate one task to the best model for its type (auto-detected), optionally with a specialist `role`; top-k relevant lessons injected |
| `llm_orchestrate` | Split a request into sub-tasks, assign roles, route each one, synthesize |
| `llm_feedback` | Record a task outcome (success/failure) + optional distilled lesson into local memory |
| `llm_recall` | Keyword top-k retrieval over trajectories and lessons |

**Hosted (`KYBERNOS_MCP_BACKEND=hosted\|both` only, frozen contract v1):**

| Tool | Purpose |
|---|---|
| `kyber_list` / `kyber_get` | List / read your kybers (agent stacks) on the Kybernos backend |
| `prompt_get` / `prompt_search` | Read / search saved prompts |
| `lesson_search` | Search hosted distilled lessons |
| `memory_search` | Search your hosted long-term memories |
| `usage_query` | Query your token usage statistics |
| `skills_list` / `templates_list` / `modules_list` | List skills, templates, modules |
| `kyber_run` | Run a kyber (agent stack) end-to-end on the hosted Kybernos backend |

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

Backend env vars (see *Backends*): `KYBERNOS_MCP_BACKEND` (`local` | `hosted` | `both`, default `local`), `KYBERNOS_MCP_URL` (default `https://api.dev.kybernos.app`), `KYBERNOS_API_KEY`, and `LLM_ORCH_MEMORY_DIR` for the local memory root.

## Security notes

- **Your key stays in your local config.** `KYBERNOS_API_KEY` is read from the environment only (the env block of your client config — the installer never writes it into any file inside the repo). It is sent solely as the `Authorization: Bearer` header to `KYBERNOS_MCP_URL`, and it is never logged, echoed, or included in any error message or telemetry. There is no telemetry.
- **Generic hosted errors.** Auth failures return exactly `hosted backend unauthorized`; network/5xx failures return `hosted backend unavailable`. Server response bodies are never echoed back (they could leak configuration details).
- **Redacted, capped outputs.** Anything returned by the hosted backend is sanitized before reaching your agent: `sk-…`, `kys-…` and `Bearer …` token substrings are redacted, and results are capped at 32KB with an explicit truncation marker.
- **Only install from the official repo.** This server runs with your API keys in scope. `install.sh` pins the SHA-256 of the 4 downloaded files and aborts on mismatch. Prefer download-then-inspect over `curl | bash`, and treat any fork or unknown pipe as a supply-chain risk (review the diff before running).

## Reliability

- **SSE multi-event.** Streamable-http replies may arrive as several SSE events (with comment lines and fragmented `data:` payloads). The client parses per event: `data:` lines are concatenated and the message whose JSON-RPC `id` matches the request is preferred (last matching message wins); a malformed event is skipped rather than thrown. A response with no valid JSON-RPC message maps to `hosted backend unavailable`.
- **Bounded retry.** Transient failures (HTTP status ≥ 500 or a network-level error) are retried **once** (2 attempts total, 250ms backoff) but **only for requests that are safe to re-run**: pure reads (`initialize`, `tools/list`, `prompts/list`) and `tools/call` **iff** the call carries a non-empty `idempotency_token` (a billed run). A `tools/call` without a token, `401`/`403`/`404` and all other 4xx are **never** retried, so an untokened billed call can never be double-executed. On retry exhaustion the original generic error strings are returned unchanged.

## Tests

Zero-dependency test suite (Node's built-in runner):

```bash
npm test    # node --test — switch logic, hosted error mapping, redaction/cap,
            # EWMA clamp, keyword scoring, kyber_run forwarding, memory corruption
```

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
├── hosted.js        # Kybernos hosted backend passthrough (Streamable HTTP, sanitized)
├── memory.js        # Ruflo-lite local memory (trajectories, EWMA stats, lessons)
├── models.json      # catalog + routing rules + roles + scoring weights
├── models.local.json  # (optional, git-ignored) your own models/providers
├── test/            # zero-dependency node:test suite
├── .orchestrator/   # (runtime, git-ignored) local memory, namespaced per cwd
├── install.sh       # multi-client installer (Opencode incl. .jsonc, Cursor, Claude Code, Windsurf, Kimi Code)
├── package.json
└── README.md
```

## License

MIT