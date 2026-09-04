#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

/* ------------------------------------------------------------------ */
/*  Configuration : catalogue de modèles + routage                     */
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

const PROVIDERS = {
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
/*  Client HTTP minimal (fetch natif, Node >= 18)                      */
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
  if (!apiKey) {
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
      headers = { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
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
/*  Santé & sélection du meilleur modèle                               */
/* ------------------------------------------------------------------ */

function scoreModel(entry, latencyMs, weights) {
  const w = { ...{ health: 40, latency: 30, context: 20, quality: 10 }, ...weights };
  const health = 100; // présent + réponse valide => opérationnel
  const latencyScore = Math.max(0, 100 - latencyMs / 50); // 50 ms = +1 pt ; 5 s = 0 pt
  const contextScore = Math.min(100, (entry.contextTokens / 100000) * 5); // 100k = 5, 1M = 50, 2M = 100
  const qualityScore = entry.quality * 10;
  return Math.round(health * (w.health / 100) + latencyScore * (w.latency / 100) + contextScore * (w.context / 100) + qualityScore * (w.quality / 100));
}

const state = {
  probed: false,
  scores: {},        // id -> score
  latency: {},       // id -> ms
  status: {},        // id -> { ok, kind, detail }
  orchestrator: null,
};

async function probeAll(force = false) {
  if (state.probed && !force) return state;
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
  const rule = config.routing[taskType] || null;
  const healthy = Object.keys(PROVIDERS).filter((id) => state.status[id] && state.status[id].ok);
  if (!healthy.length) return null;
  const ranked = healthy.slice().sort((a, b) => state.scores[b] - state.scores[a]);
  if (rule) {
    const preferredHealthy = rule.preferred.filter((id) => healthy.includes(id) && state.scores[id] >= (rule.minScore ?? 0));
    if (preferredHealthy.length) return preferredHealthy[0];
  }
  return ranked[0] || state.orchestrator;
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
/*  Serveur MCP (JSON-RPC 2.0 sur stdio, zéro dépendance)              */
/* ------------------------------------------------------------------ */

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "llm_status",
    description:
      "Teste la santé de tous les modèles (GPT-5, Claude 4.5, Gemini 3, Mistral Large 2, Llama 4), calcule leurs scores (santé, latence, contexte, qualité) et désigne le meilleur modèle comme orchestrateur.",
    inputSchema: { type: "object", properties: { force: { type: "boolean", description: "Relancer les tests même si déjà fait" } } },
  },
  {
    name: "llm_delegate",
    description:
      "Délègue une tâche au modèle le plus adapté (ou au modèle choisi). Le meilleur modèle disponible est utilisé par défaut, affiné par type de tâche (code, writing, analysis, longcontext, multimodal, cheap, local).",
    inputSchema: {
      type: "object",
      required: ["task"],
      properties: {
        task: { type: "string", description: "La tâche à exécuter" },
        taskType: { type: "string", enum: Object.keys(config.routing), description: "Type de tâche (détecté automatiquement si omis)" },
        model: { type: "string", enum: Object.keys(PROVIDERS), description: "Forcer un modèle précis" },
        maxTokens: { type: "integer", description: "Taille max de la réponse (défaut 2048)" },
      },
    },
  },
  {
    name: "llm_orchestrate",
    description:
      "Mode orchestrateur : décompose une demande en sous-tâches et exécute chaque sous-tâche sur le modèle le plus adapté, puis synthétise. Utiliser pour les demandes complexes.",
    inputSchema: {
      type: "object",
      required: ["request"],
      properties: {
        request: { type: "string", description: "La demande complète de l'utilisateur" },
        maxSubtasks: { type: "integer", description: "Nombre max de sous-tâches (défaut 5)" },
      },
    },
  },
];

function toolResult(id, payload, isError = false) {
  return {
    jsonrpc: "2.0",
    id: id === undefined ? null : id,
    result: { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError },
  };
}

async function handleToolCall(name, args) {
  if (name === "llm_status") {
    await probeAll(Boolean(args && args.force));
    return {
      orchestrator: state.orchestrator ? { id: state.orchestrator, ...describe(state.orchestrator), score: state.scores[state.orchestrator], latencyMs: state.latency[state.orchestrator] } : null,
      models: Object.keys(PROVIDERS).map((id) => ({
        id, label: PROVIDERS[id].label, ok: state.status[id].ok,
        errorKind: state.status[id].kind || null,
        score: state.scores[id], latencyMs: state.latency[id],
      })),
    };
  }

  await probeAll(false);

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
    const r = await chatOnce(cfg, { system: null, user: task, maxTokens: args.maxTokens || 2048 });
    if (!r.ok) return { error: `${cfg.label} indisponible (${r.error.kind})`, detail: r.error.detail };
    return { delegatedTo: target, label: cfg.label, taskType: taskType || args.taskType || "custom", answer: r.text };
  }

  if (name === "llm_orchestrate") {
    const request = args.request;
    if (!request) return { error: "Paramètre 'request' requis" };
    if (!state.orchestrator) return { error: "Aucun modèle sain disponible pour orchestrer." };
    const maxSubtasks = Math.max(1, Math.min(10, args.maxSubtasks || 5));
    const orchCfg = PROVIDERS[state.orchestrator];
    const planPrompt =
      `Demande de l'utilisateur :\n"""${request}"""\n\n` +
      `Modèles disponibles (id | forces) :\n${Object.keys(PROVIDERS).map((id) => `- ${id} | ${PROVIDERS[id].strengths.join(", ")}`).join("\n")}\n\n` +
      `Décompose cette demande en au maximum ${maxSubtasks} sous-tâches concrètes. ` +
      `Réponds UNIQUEMENT en JSON valide :\n{"subtasks":[{"id":1,"description":"...","taskType":"code|writing|analysis|longcontext|multimodal|cheap|local"}]}`;
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
      const r = await chatOnce(cfg, { system: null, user: st.description, maxTokens: 2048 });
      results.push({
        subtask: st.description,
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
      synthesis: results.map((r, i) => `## ${i + 1}. ${r.subtask}\n[${r.label}${r.ok ? "" : " — ÉCHEC : " + r.errorKind}]\n${r.answer || ""}`).join("\n\n"),
    };
  }

  return { error: `Outil inconnu : ${name}` };
}

function describe(id) {
  const p = PROVIDERS[id];
  return { label: p.label, provider: p.provider, model: p.model, contextTokens: p.contextTokens, strengths: p.strengths };
}

/* ------------------------- boucle JSON-RPC ------------------------- */

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

process.stdin.setEncoding("utf8");
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
    send({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "llm-orchestrator", version: "1.0.0" },
        instructions:
          "Orchestrateur multi-modèles. Utilise llm_status pour tester les modèles et désigner le meilleur (orchestrateur). " +
          "Utilise llm_delegate pour déléguer une tâche au modèle le plus adapté, llm_orchestrate pour décomposer et router une demande complexe.",
      },
    });
    return;
  }
  if (method === "notifications/initialized") return; // pas de réponse
  if (method === "ping") { send({ jsonrpc: "2.0", id, result: {} }); return; }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
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
  process.stderr.write(`[llm-orchestrator] démarré pid=${process.pid} node=${process.version} config=${os.homedir() ? "ok" : "?"}\n`);
}