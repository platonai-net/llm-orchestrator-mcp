#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

/* ------------------------------------------------------------------ */
/*  Configuration: model catalog + routing                             */
/* ------------------------------------------------------------------ */

const CONFIG_ENV = process.env.LLM_ORCH_CONFIG;
const CONFIG_PATHS = [
  CONFIG_ENV && path.resolve(CONFIG_ENV),
  path.join(__dirname, "models.json"),
].filter(Boolean);

let config = {
  probeTimeoutMs: 8000,
  probeMaxTokens: 16,
  probePrompt: "ping",
  selection: { strategy: "score", weights: { health: 40, latency: 30, context: 20, quality: 10 } },
  routing: {},
  orchestratorSystemPrompt: "Tu es l'orchestrateur.",
};
for (const p of CONFIG_PATHS) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(p, "utf8")) };
    break;
  } catch {
    /* next candidate */
  }
}

/* ------------------------------------------------------------------ */
/*  Backend mode : local | hosted | both (KYBERNOS_MCP_BACKEND)        */
/*  local = stdio-only (unchanged). hosted/both = Kybernos proxy       */
/*  tools merged + forwarded via hosted.js.                            */
/* ------------------------------------------------------------------ */

const hosted = require("./hosted");
const memory = require("./memory");

const BACKEND_ENV = "KYBERNOS_MCP_BACKEND";
let backendWarned = false;
function getBackendMode() {
  const raw = String(process.env[BACKEND_ENV] || "local").trim().toLowerCase();
  if (raw === "local" || raw === "hosted" || raw === "both") return raw;
  if (!backendWarned) {
    backendWarned = true;
    process.stderr.write(`[llm-orchestrator] invalid ${BACKEND_ENV} value — falling back to "local"\n`);
  }
  return "local";
}
function hostedEnabled() {
  const m = getBackendMode();
  return m === "hosted" || m === "both";
}

// Ruflo-lite local memory (git-ignored, namespaced per cwd) — lazy IO, never crashes
const memoryStore = memory.createMemoryStore();

const CATALOG = {
  "gpt-5": {
    label: "GPT-5 (OpenAI)",
    provider: "openai",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    model: process.env.OPENAI_MODEL || "gpt-5",
    contextTokens: 256000,
    quality: 10,
    strengths: ["code", "analysis", "writing", "multimodal"],
  },
  "claude-4.5": {
    label: "Claude 4.5 (Anthropic)",
    provider: "anthropic",
    baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    contextTokens: 1000000,
    quality: 10,
    strengths: ["writing", "analysis", "longcontext", "code"],
  },
  "gemini-3": {
    label: "Gemini 3 (Google)",
    provider: "google",
    baseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
    apiKeyEnv: "GEMINI_API_KEY",
    model: process.env.GEMINI_MODEL || "gemini-3-pro",
    contextTokens: 2000000,
    quality: 9,
    strengths: ["multimodal", "longcontext", "analysis", "cheap"],
  },
  "mistral-large-2": {
    label: "Mistral Large 2",
    provider: "mistral",
    baseUrl: process.env.MISTRAL_BASE_URL || "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    model: process.env.MISTRAL_MODEL || "mistral-large-2",
    contextTokens: 128000,
    quality: 8,
    strengths: ["cheap", "local", "writing", "code"],
  },
  "llama-4": {
    label: "Llama 4 (Meta)",
    provider: "groq",
    baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    model: process.env.GROQ_MODEL || "meta-llama/llama-4-maverick-17b-128e-instruct",
    contextTokens: 512000,
    quality: 7,
    strengths: ["longcontext", "cheap", "local", "code"],
  },
};

/* ------------------------------------------------------------------ */
/*  Dynamic model discovery                                            */
/*  Sources: API keys from env, /models listing, models.local.json,    */
/*  *_MODEL / LLM_ORCH_MODELS variables. Any LLM works.                */
/* ------------------------------------------------------------------ */

const LOCAL_JSON_PATHS = [
  process.env.LLM_ORCH_LOCAL_MODELS && path.resolve(process.env.LLM_ORCH_LOCAL_MODELS),
  path.join(__dirname, "models.local.json"),
].filter(Boolean);

function loadLocalModels() {
  for (const p of LOCAL_JSON_PATHS) {
    try {
      const arr = JSON.parse(fs.readFileSync(p, "utf8"));
      if (Array.isArray(arr)) return arr;
    } catch { /* ignore */ }
  }
  return [];
}

// Heuristics for classifying a discovered model
function guessQuality(modelId) {
  const id = modelId.toLowerCase();
  if (/gpt-5|opus|gemini-3|claude-4|sonnet-4/.test(id)) return 10;
  if (/gpt-4|large|sonnet|pro|70b|405b|maverick/.test(id)) return 8;
  if (/mini|small|8b|flash|haiku|turbo/.test(id)) return 6;
  return 7;
}
function guessStrengths(modelId) {
  const id = modelId.toLowerCase();
  const s = new Set(["analysis"]);
  if (/code|coder|dev|stella/.test(id) || /qwen|deepseek/.test(id)) s.add("code");
  if (/large|gpt|claude|sonnet|opus/.test(id)) { s.add("writing"); s.add("code"); }
  if (/mini|small|8b|nano|flash|haiku|turbo/.test(id)) { s.add("cheap"); s.add("local"); }
  if (/vision|image|video|audio|omni|multimodal/.test(id)) s.add("multimodal");
  if (/1m|2m|4m|1m\b|long/.test(id)) s.add("longcontext");
  return [...s];
}
function guessContext(modelId) {
  const id = modelId.toLowerCase();
  if (/1m|2m|4m/.test(id)) return 1000000;
  return 128000;
}

// Model listing endpoints per API style
async function listProviderModels(cfg) {
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(config.probeTimeoutMs, 6000));
  try {
    let url, headers;
    if (cfg.provider === "anthropic") {
      url = `${cfg.baseUrl}/models`;
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    } else if (cfg.provider === "google") {
      url = `${cfg.baseUrl}/models`;
      headers = { "x-goog-api-key": apiKey };
    } else {
      url = `${cfg.baseUrl}/models`;
      headers = { Authorization: `Bearer ${apiKey}` };
    }
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return [];
    const json = await res.json();
    let ids = [];
    if (Array.isArray(json.data)) ids = json.data.map((m) => m.id || m.name);
    else if (Array.isArray(json.models)) ids = json.models.map((m) => m.name || m.id || m.model);
    else if (Array.isArray(json)) ids = json.map((m) => m.id || m.name);
    ids = ids.filter(Boolean).filter((id) => !/(embed|whisper|tts|dall|moderation|babbage|davinci|image-gen|aqa)/i.test(id));
    if (cfg.provider === "google") ids = ids.map((n) => String(n).replace(/^models\//, "")).filter((n) => /gemini/.test(n));
    return ids;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Builds PROVIDERS: base catalog + discoveries (env, API listing, local)
function buildProviders() {
  const providers = { ...CATALOG };

  // 1) Custom models via environment variables
  //    LLM_ORCH_MODELS="openai:gpt-4.1-mini,anthropic:claude-3-5-haiku,ollama:qwen2.5-coder:7b"
  if (process.env.LLM_ORCH_MODELS) {
    for (const raw of process.env.LLM_ORCH_MODELS.split(",")) {
      const spec = raw.trim();
      if (!spec) continue;
      const [prov, ...rest] = spec.split(":");
      const modelId = rest.join(":") || prov;
      const provider = rest.length ? prov.toLowerCase() : "openai";
      const id = `${provider}:${modelId}`.toLowerCase();
      if (providers[id]) continue;
      providers[id] = {
        label: `${modelId} (${provider})`,
        provider,
        baseUrl: process.env.LLM_ORCH_BASE_URL || "https://api.openai.com/v1",
        apiKeyEnv: provider.toUpperCase() === "OLLAMA" ? "OLLAMA_API_KEY" : "OPENAI_API_KEY",
        model: modelId,
        contextTokens: guessContext(modelId),
        quality: guessQuality(modelId),
        strengths: guessStrengths(modelId),
        discovered: "env",
      };
      if (provider === "ollama") {
        providers[id].baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1";
        providers[id].apiKeyEnv = "OLLAMA_API_KEY";
      }
    }
  }

  // 2) models.local.json: any provider, without modifying the repository
  //    [{ "id":"qwen-coder", "provider":"ollama", "baseUrl":"http://localhost:11434/v1", "model":"qwen2.5-coder:7b", "apiKeyEnv":"...", "contextTokens":32768 }]
  for (const m of loadLocalModels()) {
    if (!m || !m.model || !m.provider) continue;
    const id = (m.id || `${m.provider}:${m.model}`).toLowerCase();
    if (providers[id]) continue;
    providers[id] = {
      label: m.label || `${m.model} (${m.provider})`,
      provider: m.provider,
      baseUrl: m.baseUrl || "https://api.openai.com/v1",
      apiKeyEnv: m.apiKeyEnv || "OPENAI_API_KEY",
      model: m.model,
      contextTokens: m.contextTokens || guessContext(m.model),
      quality: m.quality || guessQuality(m.model),
      strengths: m.strengths || guessStrengths(m.model),
      discovered: "local",
    };
  }

  // 3) Dynamic /models listing — handled asynchronously by buildProvidersAsync()
  return providers;
}

async function buildProvidersAsync() {
  const providers = buildProviders(); // env + local first (synchronous)
  const disc = { enabled: true, maxPerProvider: 6, maxTotal: 24, ...(config.discovery || {}) };
  if (!disc.enabled) return providers;
  const seen = new Set(Object.values(providers).map((p) => p.model));
  let total = Object.keys(providers).length;
  const jobs = Object.keys(CATALOG).map(async (key) => {
    const cfg = CATALOG[key];
    const ids = await listProviderModels(cfg);
    let added = 0;
    for (const id of ids) {
      if (added >= disc.maxPerProvider || total >= disc.maxTotal) break;
      if (seen.has(id)) continue;
      seen.add(id);
      const pid = `${cfg.provider}:${id}`.toLowerCase();
      providers[pid] = {
        label: `${id} (${cfg.provider})`,
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        apiKeyEnv: cfg.apiKeyEnv,
        model: id,
        contextTokens: guessContext(id),
        quality: guessQuality(id),
        strengths: guessStrengths(id),
        discovered: "api",
      };
      added++; total++;
    }
  });
  await Promise.all(jobs);
  return providers;
}

/* ------------------------------------------------------------------ */
/*  Minimal HTTP client (native fetch, Node >= 18)                     */
/* ------------------------------------------------------------------ */

function classifyProviderError(status, body) {
  const text = String(body || "").slice(0, 300);
  const lower = text.toLowerCase();
  if (status === 401 || status === 403 || lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("invalid_api_key"))
    return { kind: "auth", detail: text };
  if (status === 429 || lower.includes("rate limit") || lower.includes("quota"))
    return { kind: "rate-limit", detail: text };
  if (status === 404 || lower.includes("model_not_found") || lower.includes("does not exist") || lower.includes("not found"))
    return { kind: "not-found", detail: text };
  if (status === 0 || /econnrefused|enotfound|etimedout|econnreset|fetch failed/.test(lower))
    return { kind: "unreachable", detail: text };
  if (status >= 500)
    return { kind: "server", detail: text };
  return { kind: "other", detail: text };
}

async function chatOnce(cfg, { system, user, maxTokens }) {
  const apiKey = process.env[cfg.apiKeyEnv];
  const isOpenAIStyle = !["anthropic", "google"].includes(cfg.provider);
  if (!apiKey && !(isOpenAIStyle && (cfg.provider === "ollama" || /localhost|127\.0\.0\.1/.test(cfg.baseUrl || "")))) {
    return { ok: false, status: 0, error: { kind: "no-key", detail: `${cfg.apiKeyEnv} non définie` } };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.probeTimeoutMs);
  try {
    let url, headers, body;
    if (cfg.provider === "anthropic") {
      url = `${cfg.baseUrl}/messages`;
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
      body = { model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] };
    } else if (cfg.provider === "google") {
      url = `${cfg.baseUrl}/models/${cfg.model}:generateContent`;
      headers = { "x-goog-api-key": apiKey, "content-type": "application/json" };
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      };
    } else {
      url = `${cfg.baseUrl}/chat/completions`;
      headers = { "content-type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      body = { model: cfg.model, max_tokens: maxTokens, messages: system ? [{ role: "system", content: system }, { role: "user", content: user }] : [{ role: "user", content: user }] };
    }
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, error: classifyProviderError(res.status, raw) };
    }
    let json;
    try { json = JSON.parse(raw); } catch { return { ok: false, status: res.status, error: { kind: "bad-response", detail: "Réponse non-JSON" } }; }
    let text = "";
    if (cfg.provider === "anthropic" && Array.isArray(json.content)) {
      text = json.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    } else if (cfg.provider === "google" && Array.isArray(json.candidates)) {
      const parts = json.candidates?.[0]?.content?.parts || [];
      text = parts.map((p) => p.text || "").join("\n").trim();
    } else if (json.choices?.[0]?.message?.content) {
      text = String(json.choices[0].message.content).trim();
    }
    return { ok: true, status: res.status, text, usage: json.usage || null };
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || e.code === "ABORT_ERR");
    return { ok: false, status: 0, error: classifyProviderError(0, aborted ? "timeout" : e.message) };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/*  Health & best-model selection                                      */
/* ------------------------------------------------------------------ */

function scoreModel(entry, latencyMs, weights) {
  const w = { ...{ health: 40, latency: 30, context: 20, quality: 10 }, ...weights };
  const health = 100; // present + valid response => operational
  const latencyScore = Math.max(0, 100 - latencyMs / 50); // 50 ms = +1 pt ; 5 s = 0 pt
  const contextScore = Math.min(100, (entry.contextTokens / 100000) * 5); // 100k = 5, 1M = 50, 2M = 100
  const qualityScore = entry.quality * 10;
  return Math.round(health * (w.health / 100) + latencyScore * (w.latency / 100) + contextScore * (w.context / 100) + qualityScore * (w.quality / 100));
}

const state = {
  probed: false,
  providers: {},     // dynamic catalog (detection of available LLMs)
  discoveredFrom: [],// detection sources used
  scores: {},        // id -> score
  latency: {},       // id -> ms
  status: {},        // id -> { ok, kind, detail }
  orchestrator: null,
};

async function probeAll(force = false) {
  if (state.probed && !force) return state;
  if (force || !Object.keys(state.providers).length) {
    state.providers = await buildProvidersAsync();
    state.discoveredFrom = [
      process.env.LLM_ORCH_MODELS ? "env(LLM_ORCH_MODELS)" : null,
      loadLocalModels().length ? "models.local.json" : null,
      "api-listing",
      "catalog",
    ].filter(Boolean);
  }
  const PROVIDERS = state.providers;
  const ids = Object.keys(PROVIDERS);
  await Promise.all(
    ids.map(async (id) => {
      const cfg = PROVIDERS[id];
      const t0 = Date.now();
      const r = await chatOnce(cfg, { system: null, user: config.probePrompt, maxTokens: config.probeMaxTokens });
      const latencyMs = Date.now() - t0;
      state.latency[id] = latencyMs;
      if (r.ok) {
        state.status[id] = { ok: true };
        state.scores[id] = scoreModel(cfg, latencyMs, config.selection.weights);
      } else {
        state.status[id] = { ok: false, kind: r.error.kind, detail: r.error.detail };
        state.scores[id] = 0;
      }
    })
  );
  const healthy = ids.filter((id) => state.status[id].ok);
  healthy.sort((a, b) => state.scores[b] - state.scores[a] || state.latency[a] - state.latency[b]);
  state.orchestrator = healthy[0] || null;
  state.probed = true;
  return state;
}

function pickForTask(taskType) {
  const PROVIDERS = state.providers;
  const rule = config.routing[taskType] || null;
  const healthy = Object.keys(PROVIDERS).filter((id) => state.status[id] && state.status[id].ok);
  if (!healthy.length) return null;
  const ranked = healthy.slice().sort((a, b) => state.scores[b] - state.scores[a]);
  // Local-memory bias (EWMA stats): refines ranking among HEALTHY models only —
  // explicit routing rules and health checks always win over memory.
  const biased = memory.applyMemoryBias(
    ranked.map((id) => ({ id, score: state.scores[id] })),
    memoryStore.modelBias(taskType)
  );
  if (rule) {
    const preferredHealthy = rule.preferred.filter((id) => healthy.includes(id) && state.scores[id] >= (rule.minScore ?? 0));
    if (preferredHealthy.length) return preferredHealthy[0];
  }
  return biased.length ? biased[0].id : state.orchestrator;
}

function inferTaskType(text) {
  const t = String(text || "").toLowerCase();
  const has = (re) => re.test(t);
  if (has(/\b(code|bug|refactor|fonction|classe|test unitaire|typescript|python|javascript|sql|regex|api)\b/)) return "code";
  if (has(/\b(rédige|écris|write|traduis|reformule|email|post|article|ton|style|synthèse marketing)\b/)) return "writing";
  if (has(/\b(document|pdf|contrat|juridi|long|1m|analyse complète|corpus)\b/)) return "longcontext";
  if (has(/\b(image|photo|vidéo|audio|schéma|multimodal)\b/)) return "multimodal";
  if (has(/\b(résume|analyse|compare|évalue|stratégie|rapport)\b/)) return "analysis";
  return "analysis";
}

/* ------------------------------------------------------------------ */
/*  MCP server (JSON-RPC 2.0 over stdio, zero dependency)              */
/* ------------------------------------------------------------------ */

const PROTOCOL_VERSION = "2024-11-05";

function localToolSchemas() {
  const known = Object.keys(state.providers);
  return [
    {
      name: "llm_status",
      description:
        `Détecte automatiquement les LLM disponibles (${known.length} modèles enregistrés actuellement : clés API de l'environnement, listing /models de chaque fournisseur, LLM_ORCH_MODELS, models.local.json — y compris Ollama et tout endpoint OpenAI-compatible), teste leur santé, calcule leurs scores et élit le meilleur comme orchestrateur.`,
      inputSchema: { type: "object", properties: { force: { type: "boolean", description: "Re-run detection and health tests even if already done" } } },
    },
    {
      name: "llm_delegate",
      description:
        "Delegates a task to the best-suited model (or to the chosen model/role). The best available model is used by default, refined by task type (code, writing, analysis, longcontext, multimodal, cheap, local).",
      inputSchema: {
        type: "object",
        required: ["task"],
        properties: {
          task: { type: "string", description: "The task to execute" },
          taskType: { type: "string", enum: Object.keys(config.routing), description: "Task type (auto-detected if omitted)" },
          model: { type: "string", description: `Forcer un modèle précis (id exact, ex: ${known.slice(0, 3).join(", ") || "gpt-5"}...)` },
          role: { type: "string", enum: Object.keys(config.roles || {}), description: "Specialist mini-prompt applied to the task (orchestrator, github-manager, auditor, business-analyst...)" },
          maxTokens: { type: "integer", description: "Max response size (default 2048)" },
        },
      },
    },
    {
      name: "llm_orchestrate",
      description:
        "Orchestrator mode: splits a request into subtasks, assigns a specialist role to each (orchestrator, github-manager, auditor, business-analyst...), runs each subtask on the best-suited model, then synthesizes.",
      inputSchema: {
        type: "object",
        required: ["request"],
        properties: {
          request: { type: "string", description: "The user's full request" },
          maxSubtasks: { type: "integer", description: "Max number of subtasks (default 5)" },
          roles: { type: "boolean", description: "Enable specialist role assignment (default true)" },
        },
      },
    },
  ];
}

function memoryToolSchemas() {
  return [
    {
      name: "llm_feedback",
      description:
        "Records the outcome of a (delegated) task into local memory: appends a trajectory, updates the EWMA success score per (taskType, model) used to bias future model election (never overrides health checks), and optionally upserts a distilled lesson (max 500 chars).",
      inputSchema: {
        type: "object",
        required: ["outcome"],
        properties: {
          outcome: { type: "string", enum: ["success", "failure"], description: "Task outcome" },
          taskType: { type: "string", description: "Task type (code, writing, analysis...)" },
          model: { type: "string", description: "Model id the task ran on" },
          task: { type: "string", description: "Short prompt summary of the task" },
          lesson: {
            description: "Optional distilled lesson — either a plain string or { text, tags: string[] } (max 500 chars)",
          },
        },
      },
    },
    {
      name: "llm_recall",
      description:
        "Keyword-scored retrieval (pure JS, no embeddings) over local memory: past trajectories and/or distilled lessons, top-k. Use it to ground decisions on what worked before.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Keywords to search for" },
          k: { type: "integer", description: "Max results per kind (default 5)" },
          kind: { type: "string", enum: ["all", "trajectories", "lessons"], description: "What to search (default all)" },
        },
      },
    },
  ];
}

function toolSchema() {
  const mode = getBackendMode();
  const tools = [];
  if (mode !== "hosted") tools.push(...localToolSchemas()); // local LLM delegation (hidden in hosted-only mode)
  tools.push(...memoryToolSchemas());
  if (hostedEnabled()) {
    tools.push(...hosted.hostedToolSchemas());
    tools.push(hosted.kyberRunToolSchema());
  }
  return tools;
}

function toolResult(id, payload, isError = false) {
  return {
    jsonrpc: "2.0",
    id: id === undefined ? null : id,
    result: { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError },
  };
}

/* Hosted backend health + frozen-contract check (uses the 60s TTL list cache) */
async function hostedStatus() {
  try {
    const r = await hosted.getDefaultClient().listHostedTools();
    if (!r.ok) return { ok: false, error: r.message };
    return {
      ok: true,
      baseUrl: hosted.getDefaultClient().getBaseUrl(),
      contractVersion: r.contractVersion,
      contractOk: r.contractOk,
      unknownTools: r.extras,   // proxy tools outside the frozen contract (named)
      missingTools: r.missing,  // frozen tools the proxy no longer exposes (named)
    };
  } catch {
    return { ok: false, error: hosted.ERR_UNAVAILABLE };
  }
}

async function handleToolCall(name, args) {
  if (name === "llm_status") {
    await probeAll(Boolean(args && args.force));
    const PROVIDERS = state.providers;
    return {
      backend: { mode: getBackendMode(), hosted: hostedEnabled() ? await hostedStatus() : null },
      detectedFrom: state.discoveredFrom,
      orchestrator: state.orchestrator ? { id: state.orchestrator, ...describe(state.orchestrator), score: state.scores[state.orchestrator], latencyMs: state.latency[state.orchestrator] } : null,
      models: Object.keys(PROVIDERS).map((id) => ({
        id, label: PROVIDERS[id].label, ok: state.status[id].ok,
        discovered: PROVIDERS[id].discovered || "catalog",
        errorKind: state.status[id].kind || null,
        score: state.scores[id], latencyMs: state.latency[id],
      })),
    };
  }

  /* ---- Hosted backend tools (no local probing on this path) ---- */
  if (hosted.isHostedToolName(name)) {
    if (!hostedEnabled()) return { error: `Unknown tool: ${name} (hosted-only — set ${BACKEND_ENV}=hosted|both to enable it)` };
    const r = await hosted.getDefaultClient().callTool(name, args || {});
    if (!r.ok) return { error: r.message, code: r.code || "hosted-error" };
    return r.payload;
  }

  /* ---- Local memory tools (available in every mode, zero network) ---- */
  if (name === "llm_feedback") {
    const outcome = String((args && args.outcome) || "").toLowerCase();
    if (outcome !== "success" && outcome !== "failure") return { error: "Parameter 'outcome' must be 'success' or 'failure'" };
    return memoryStore.recordFeedback({
      outcome,
      taskType: args.taskType,
      model: args.model,
      prompt: args.task,
      lesson: args.lesson ? (typeof args.lesson === "string" ? { text: args.lesson } : args.lesson) : null,
    });
  }
  if (name === "llm_recall") {
    if (!args || !args.query) return { error: "Parameter 'query' is required" };
    const k = Math.max(1, Math.min(20, args.k || 5));
    return memoryStore.recall(args.query, { k, kind: args.kind || "all" });
  }

  await probeAll(false);
  const PROVIDERS = state.providers;

  if (name === "llm_delegate") {
    const task = args.task;
    if (!task) return { error: "Paramètre 'task' requis" };
    if (args.model && !PROVIDERS[args.model]) return { error: `Modèle inconnu : ${args.model}` };
    let target = args.model;
    let taskType = args.taskType;
    if (!target) {
      taskType = taskType && config.routing[taskType] ? taskType : inferTaskType(task);
      target = pickForTask(taskType) || state.orchestrator;
    }
    if (!target) return { error: "Aucun modèle sain disponible. Vérifie les clés API." };
    const cfg = PROVIDERS[target];
    const role = args.role && (config.roles || {})[args.role] ? config.roles[args.role] : null;
    // Top-k keyword lessons from local memory, injected into the prompt (capped)
    const lessons = memoryStore.relevantLessons(task, 3);
    let system = role ? role.prompt : null;
    if (lessons.length) {
      const block = "Lessons distilled from past runs (apply when relevant):\n- " + lessons.map((l) => l.text).join("\n- ").slice(0, 1500);
      system = system ? system + "\n\n" + block : block;
    }
    const r = await chatOnce(cfg, { system, user: task, maxTokens: args.maxTokens || 2048 });
    if (!r.ok) return { error: `${cfg.label} indisponible (${r.error.kind})`, detail: r.error.detail };
    return { delegatedTo: target, label: cfg.label, taskType: taskType || args.taskType || "custom", role: role ? role.title : null, lessonsUsed: lessons.length, answer: r.text };
  }

  if (name === "llm_orchestrate") {
    const request = args.request;
    if (!request) return { error: "Paramètre 'request' requis" };
    if (!state.orchestrator) return { error: "Aucun modèle sain disponible pour orchestrer." };
    const maxSubtasks = Math.max(1, Math.min(10, args.maxSubtasks || 5));
    const useRoles = args.roles !== false && Object.keys(config.roles || {}).length > 0;
    const rolesList = Object.keys(config.roles || {}).map((r) => `${r} (${config.roles[r].title})`).join(", ");
    const orchCfg = PROVIDERS[state.orchestrator];
    const planPrompt =
      `Demande de l'utilisateur :\n"""${request}"""\n\n` +
      `Modèles disponibles (id | forces) :\n${Object.keys(PROVIDERS).map((id) => `- ${id} | ${PROVIDERS[id].strengths.join(", ")}`).join("\n")}\n\n` +
      (useRoles ? `Rôles disponibles : ${rolesList}\n` : "") +
      `Décompose cette demande en au maximum ${maxSubtasks} sous-tâches concrètes. ` +
      (useRoles
        ? `Assigne à chaque sous-tâche le rôle de spécialiste le plus pertinent. `
        : "") +
      `Réponds UNIQUEMENT en JSON valide :\n{"subtasks":[{"id":1,"description":"...",${useRoles ? '"role":"<role-id>",' : ""}"taskType":"code|writing|analysis|longcontext|multimodal|cheap|local"}]}`;
    const plan = await chatOnce(orchCfg, { system: config.orchestratorSystemPrompt, user: planPrompt, maxTokens: 1500 });
    if (!plan.ok) return { error: `Orchestrateur (${orchCfg.label}) indisponible : ${plan.error.kind}` };
    let parsed;
    try {
      const m = plan.text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : plan.text);
    } catch {
      parsed = { subtasks: [{ id: 1, description: request, taskType: inferTaskType(request) }] };
    }
    const subtasks = (parsed.subtasks || []).slice(0, maxSubtasks);
    const results = [];
    for (const st of subtasks) {
      const taskType = st.taskType && config.routing[st.taskType] ? st.taskType : inferTaskType(st.description);
      const target = pickForTask(taskType) || state.orchestrator;
      const cfg = PROVIDERS[target];
      const role = useRoles && st.role && (config.roles || {})[st.role] ? config.roles[st.role] : null;
      const r = await chatOnce(cfg, { system: role ? role.prompt : null, user: st.description, maxTokens: 2048 });
      results.push({
        subtask: st.description,
        role: role ? role.title : null,
        taskType,
        delegatedTo: target,
        label: cfg.label,
        ok: r.ok,
        errorKind: r.ok ? null : (r.error && r.error.kind) || "unknown",
        answer: r.ok ? r.text : null,
      });
    }
    return {
      orchestrator: state.orchestrator,
      orchestratorLabel: orchCfg.label,
      plan: subtasks,
      results,
      synthesis: results.map((r, i) => `## ${i + 1}. ${r.subtask}\n[${r.label}${r.role ? " · rôle " + r.role : ""}${r.ok ? "" : " — ÉCHEC : " + r.errorKind}]\n${r.answer || ""}`).join("\n\n"),
    };
  }

  return { error: `Outil inconnu : ${name}` };
}

function describe(id) {
  const p = state.providers[id];
  if (!p) return { id };
  return { label: p.label, provider: p.provider, model: p.model, contextTokens: p.contextTokens, strengths: p.strengths };
}

/* -------------------------- loop JSON-RPC -------------------------- */

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const { id, method, params } = msg || {};

  if (method === "initialize") {
    const mode = getBackendMode();
    send({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "llm-orchestrator", version: "1.0.0" },
        instructions:
          "Orchestrateur multi-modèles. Utilise llm_status pour tester les modèles et désigner le meilleur (orchestrateur). " +
          "Utilise llm_delegate pour déléguer une tâche au modèle le plus adapté, llm_orchestrate pour décomposer et router une demande complexe. " +
          `Backend mode: ${mode}. ` +
          (hostedEnabled()
            ? `Hosted Kybernos tools (frozen contract v${hosted.CONTRACT_VERSION}) are exposed and forwarded to ${hosted.DEFAULT_BASE_URL}. `
            : "Hosted Kybernos tools are disabled (set KYBERNOS_MCP_BACKEND=hosted|both to enable). ") +
          "Local memory: llm_feedback records outcomes/lessons, llm_recall retrieves them by keywords.",
      },
    });
    return;
  }
  if (method === "notifications/initialized") return; // no response
  if (method === "ping") { send({ jsonrpc: "2.0", id, result: {} }); return; }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: toolSchema() } });
    return;
  }
  if (method === "tools/call") {
    const r = await handleToolCall(params && params.name, (params && params.arguments) || {});
    send(toolResult(id, r, Boolean(r && r.error)));
    return;
  }
  if (method === "resources/list") { send({ jsonrpc: "2.0", id, result: { resources: [] } }); return; }
  if (method === "prompts/list") { send({ jsonrpc: "2.0", id, result: { prompts: [] } }); return; }
  if (method && /^notifications\//.test(method)) return;
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

if (process.env.LLM_ORCH_DEBUG) {
  process.stderr.write(`[llm-orchestrator] démarré pid=${process.pid} node=${process.version} backend=${getBackendMode()} config=${os.homedir() ? "ok" : "?"}\n`);
}

/* -------- stdio server loop (only when run as the main module) -------- */

if (require.main === module) {
  let buffer = "";
  let pending = 0;
  let stdinEnded = false;

  function maybeExit() {
    if (stdinEnded && pending === 0) process.exit(0);
  }

  async function handleSafe(line) {
    pending++;
    try {
      await handleMessage(line);
    } finally {
      pending--;
      maybeExit();
    }
  }

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) void handleSafe(line);
    }
  });

  process.stdin.on("end", () => {
    stdinEnded = true;
    if (buffer.trim()) {
      const line = buffer.trim();
      buffer = "";
      void handleSafe(line);
    } else {
      maybeExit();
    }
  });

  process.on("uncaughtException", (e) => {
    process.stderr.write(`[llm-orchestrator] ${e && e.stack ? e.stack : e}\n`);
  });
  process.on("unhandledRejection", (e) => {
    process.stderr.write(`[llm-orchestrator] ${e && e.stack ? e.stack : e}\n`);
  });
}

/* Exposed for the zero-dependency test suite (node --test test/) */
module.exports = { getBackendMode, toolSchema, handleToolCall, handleMessage };