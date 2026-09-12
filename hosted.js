#!/usr/bin/env node
"use strict";

/**
 * Hosted backend (Kybernos MCP proxy) — Streamable HTTP passthrough.
 *
 * Zero-dependency client for the Kybernos /mcp endpoint (JSON-RPC 2.0 over
 * POST-only Streamable HTTP). Key-safety invariants (fail-closed):
 *   - The Authorization header value NEVER appears in errors, logs or results.
 *   - Any 401/403 maps to the exact generic message "hosted backend unauthorized".
 *   - Network errors / 5xx map to "hosted backend unavailable".
 *   - Server bodies are never echoed verbatim (oracle risk) — only sanitized text.
 *   - Every hosted output is redacted (sk- / kys- / Bearer) and capped at 32KB.
 *
 * Clean-room implementation: behaviors only, no code from any private repo.
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");

/* ------------------------- frozen tool contract ------------------------- */
/* Single source of truth for the hosted tool surface this client supports.  */
/* If the proxy exposes a tool outside this list, or a call targets one, a   */
/* version-mismatch error naming the tool is surfaced (never a silent gap). */

const CONTRACT_VERSION = 1;

const HOSTED_TOOL_NAMES = Object.freeze([
  "kyber_list",
  "kyber_get",
  "prompt_get",
  "prompt_search",
  "lesson_search",
  "memory_search",
  "usage_query",
  "skills_list",
  "templates_list",
  "modules_list",
]);

const KYBER_RUN_TOOL = "kyber_run";

/* Generic, key-safe error messages (exact strings — do not interpolate) */
const ERR_UNAUTHORIZED = "hosted backend unauthorized";
const ERR_UNAVAILABLE = "hosted backend unavailable";
const ERR_REJECTED = "hosted backend rejected the request";
const ERR_SESSION_EXPIRED = "hosted backend session expired — re-run the call";
const ERR_NO_KEY = "hosted backend requires KYBERNOS_API_KEY (add it to your client config env block)";

const DEFAULT_BASE_URL = "https://api.dev.kybernos.app";
const MCP_PATH = "/mcp";
const PROTOCOL_VERSION = "2025-03-26";
const REQUEST_TIMEOUT_MS = 30_000;
const LIST_CACHE_TTL_MS = 60_000;
const RESULT_CAP_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // defensive read cap on proxy responses

// Bounded retry: ONE retry (2 attempts total) on transient 5xx / network errors,
// backoff 250ms. Only safe methods ever retry — see isRetrySafe.
const RETRY_BACKOFF_MS = 250;
const RETRY_SAFE_METHODS = ["initialize", "tools/list", "prompts/list"];

/* --------------------------- output sanitation --------------------------- */

const REDACTION_PATTERNS = [
  { re: /\bsk-[A-Za-z0-9_-]{6,}/g, repl: "sk-[REDACTED]" },
  { re: /\bkys-[A-Za-z0-9_-]{6,}/g, repl: "kys-[REDACTED]" },
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, repl: "Bearer [REDACTED]" },
];

function sanitizeText(text) {
  let s = String(text === null || text === undefined ? "" : text);
  for (const { re, repl } of REDACTION_PATTERNS) s = s.replace(re, repl);
  if (Buffer.byteLength(s, "utf8") > RESULT_CAP_BYTES) {
    s = Buffer.from(s, "utf8").slice(0, RESULT_CAP_BYTES).toString("utf8");
    s += "\n[truncated at 32KB by llm-orchestrator]";
  }
  return s;
}

function sanitizeDeep(value, depth = 0) {
  if (depth > 24) return "[sanitizer: max depth reached]";
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[sanitizeText(k)] = sanitizeDeep(v, depth + 1);
    return out;
  }
  return value;
}

/* ------------------------ HTTP transport (default) ------------------------ */
/* Native fetch pools connections (undici), but we hand-roll the POST to get */
/* an explicit keep-alive agent + a hard 30s timeout, zero-dependency.       */

const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 4 });
const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 4 });

function defaultFetchImpl(url, init) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error("invalid url"));
    }
    const mod = u.protocol === "http:" ? http : https;
    const agent = u.protocol === "http:" ? httpAgent : httpsAgent;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.pathname + u.search,
        method: "POST",
        agent,
        headers: init.headers,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size <= MAX_RESPONSE_BYTES) chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: { get: (h) => (res.headers[String(h).toLowerCase()] !== undefined ? String(res.headers[String(h).toLowerCase()]) : null) },
            text: async () => Buffer.concat(chunks).toString("utf8"),
          })
        );
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("hosted request timeout")));
    req.on("error", reject);
    req.end(init.body);
  });
}

/* ----------------------------- hosted client ----------------------------- */

function hostedToolSchemas() {
  const mk = (name, description, props) => ({
    name,
    description,
    inputSchema: { type: "object", additionalProperties: true, properties: props || {} },
  });
  return [
    mk("kyber_list", "List kybers (hosted Kybernos backend, frozen contract v" + CONTRACT_VERSION + ").", { limit: { type: "integer" } }),
    mk("kyber_get", "Get one kyber by id (hosted Kybernos backend).", { id: { type: "string" } }),
    mk("prompt_get", "Get one saved prompt by id (hosted Kybernos backend).", { id: { type: "string" } }),
    mk("prompt_search", "Search saved prompts by keywords (hosted Kybernos backend).", { query: { type: "string" }, limit: { type: "integer" } }),
    mk("lesson_search", "Search distilled lessons by keywords (hosted Kybernos backend).", { query: { type: "string" }, limit: { type: "integer" } }),
    mk("memory_search", "Search your hosted long-term memories by keywords (hosted Kybernos backend).", { query: { type: "string" }, limit: { type: "integer" } }),
    mk("usage_query", "Query your token/usage statistics (hosted Kybernos backend).", { since: { type: "string" } }),
    mk("skills_list", "List available skills (hosted Kybernos backend).", {}),
    mk("templates_list", "List available templates (hosted Kybernos backend).", {}),
    mk("modules_list", "List available modules (hosted Kybernos backend).", {}),
  ];
}

function kyberRunToolSchema() {
  return {
    name: KYBER_RUN_TOOL,
    description:
      "Run a kyber (agent stack) end-to-end on the hosted Kybernos backend. RESERVED: returns an explicit 'hosted-p2-required' error until proxy P2 ships — never forwarded.",
    inputSchema: {
      type: "object",
      required: ["request"],
      properties: { request: { type: "string", description: "The full request to run" }, kyber: { type: "string", description: "Optional kyber id/name" } },
    },
  };
}

function isHostedToolName(name) {
  return HOSTED_TOOL_NAMES.includes(name);
}

function parseSse(raw, wantId) {
  // Split into events on blank lines per the SSE spec. Within one event the
  // payload is the concatenation of its `data:` lines (joined with "\n"
  // before JSON.parse). Comment lines (":") and empty data are ignored and a
  // non-JSON event payload is skipped, never thrown. Zero valid messages
  // keeps the previous ERR_UNAVAILABLE contract.
  let match = null;
  let last = null;
  let eventData = null; // concatenated data lines of the current event
  for (const line of String(raw).split(/\r?\n/)) {
    if (line.length === 0) {
      if (eventData !== null) {
        try {
          const msg = JSON.parse(eventData);
          last = msg;
          if (wantId !== undefined && msg.id === wantId) match = msg;
        } catch {
          /* skip malformed event payload */
        }
        eventData = null;
      }
      continue;
    }
    if (line.startsWith(":")) continue; // SSE comment
    if (line.startsWith("data:")) {
      const data = line.slice(5);
      eventData = eventData === null ? data : eventData + "\n" + data;
    }
  }
  // Flush any trailing event that was not followed by a blank line.
  if (eventData !== null) {
    try {
      const msg = JSON.parse(eventData);
      last = msg;
      if (wantId !== undefined && msg.id === wantId) match = msg;
    } catch {
      /* skip malformed event payload */
    }
  }
  const picked = match || last;
  if (!picked) throw { __hostedError: true, message: ERR_UNAVAILABLE };
  return picked;
}

function isRetrySafe(body) {
  const method = body && body.method;
  if (RETRY_SAFE_METHODS.indexOf(method) !== -1) return true;
  // tools/call is a billed run: only retry when an explicit idempotency_token
  // protects the attempt from double-billing.
  if (method === "tools/call") {
    const token = body.params && body.params.arguments && body.params.arguments.idempotency_token;
    return typeof token === "string" && token.length > 0;
  }
  return false; // unknown methods / notifications are never retried
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function createHostedBackend(options = {}) {
  const baseUrl = () =>
    String(options.baseUrl || process.env.KYBERNOS_MCP_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = () => String(options.apiKey || process.env.KYBERNOS_API_KEY || "");
  const fetchImpl = options.fetchImpl || defaultFetchImpl;
  const cacheTtlMs = options.cacheTtlMs === undefined ? LIST_CACHE_TTL_MS : options.cacheTtlMs;

  let sessionId = null;
  let listCache = null; // { at, names } — short-lived tools/list cache
  let nextId = 1;

  async function post(body) {
    const url = baseUrl() + MCP_PATH;
    const key = apiKey();
    if (!key) throw { __hostedError: true, message: ERR_NO_KEY };
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${key}`, // NEVER logged, NEVER echoed in errors
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    // Bounded retry (ONE retry, 2 attempts total) purely on transient status
    // (>=500) or network-level fetch failures, ONLY for requests that are safe
    // to re-run. 401/403/404 and all other 4xx are never retried.
    const retryable = isRetrySafe(body);
    let res;
    let lastError = null;
    for (let attempt = 1; attempt <= (retryable ? 2 : 1); attempt++) {
      try {
        if (attempt > 1) await sleep(RETRY_BACKOFF_MS);
        res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body) });
        lastError = null;
        if (res.status < 500) break; // 2xx/3xx or a non-transient 4xx — no more attempts
      } catch (err) {
        lastError = err;
        if (!retryable) break; // network error on a non-retryable request — surface now
        // else: retryable network error -> fall through to next attempt
      }
    }
    if (lastError) throw { __hostedError: true, message: ERR_UNAVAILABLE };

    // Generic error mapping — status only, no body, no URL, no key.
    if (res.status === 401 || res.status === 403) throw { __hostedError: true, message: ERR_UNAUTHORIZED };
    if (res.status >= 500) throw { __hostedError: true, message: ERR_UNAVAILABLE };
    if (res.status === 404 && sessionId && body.method && body.method !== "initialize") {
      if (isRetrySafe(body)) {
        // Expired session — re-handshake and replay ONLY requests that are safe
        // to re-run (pure reads, or a billed tools/call carrying an explicit
        // idempotency_token). Re-sending an untokened billed call after a session
        // reset is a double-billing vector, so it is never replayed.
        sessionId = null;
        await ensureSession();
        return post(body);
      }
      // Not safe to replay (e.g. an untokened billed tools/call). Surface a clear
      // session-expired error instead of silently dropping or double-sending.
      throw { __hostedError: true, message: ERR_SESSION_EXPIRED };
    }
    if (res.status < 200 || res.status >= 300) throw { __hostedError: true, message: ERR_REJECTED };

    const sid = res.headers && typeof res.headers.get === "function" ? res.headers.get("mcp-session-id") : null;
    if (sid) sessionId = String(sid);
    const ctype = String((res.headers && typeof res.headers.get === "function" && res.headers.get("content-type")) || "");
    let raw;
    try {
      raw = await res.text();
    } catch {
      throw { __hostedError: true, message: ERR_UNAVAILABLE };
    }
    if (/text\/event-stream/i.test(ctype)) return parseSse(raw, body.id);
    if (!raw.trim()) {
      // 202 Accepted with no body is the normal reply to notifications
      if (body.method && body.method.startsWith("notifications/")) return null;
      throw { __hostedError: true, message: ERR_UNAVAILABLE };
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw { __hostedError: true, message: ERR_UNAVAILABLE };
    }
  }

  // Streamable HTTP handshake: initialize -> (capture session id) -> initialized notification
  async function ensureSession() {
    if (sessionId) return;
    const init = await post({
      jsonrpc: "2.0",
      id: nextId++,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "llm-orchestrator-mcp", version: "hosted-passthrough-v" + CONTRACT_VERSION },
      },
    });
    if (init && init.error) {
      // Sanitized proxy-side error only (no raw body echo)
      throw { __hostedError: true, message: sanitizeText(String(init.error.message || ERR_UNAVAILABLE)).slice(0, 200) };
    }
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }); // 202 accepted, no response body
  }

  async function callTool(name, args) {
    if (!isHostedToolName(name)) {
      return {
        ok: false,
        code: "hosted-contract-mismatch",
        message: `hosted contract mismatch: tool "${name}" is not part of the frozen contract v${CONTRACT_VERSION} — update llm-orchestrator-mcp to match the proxy`,
      };
    }
    let msg;
    try {
      await ensureSession();
      msg = await post({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args || {} } });
    } catch (e) {
      const message = e && e.__hostedError ? e.message : ERR_UNAVAILABLE;
      listCache = null; // invalidate cache on error
      return { ok: false, code: "hosted-error", message };
    }
    if (msg && msg.error) {
      const m = String(msg.error.message || "");
      // Proxy says the tool is unknown -> contract divergence, name the tool.
      if (/unknown tool|tool not found|no tool|not found/i.test(m)) {
        return {
          ok: false,
          code: "hosted-contract-mismatch",
          message: `hosted contract mismatch: proxy does not know tool "${name}" (contract v${CONTRACT_VERSION}) — update llm-orchestrator-mcp`,
        };
      }
      return { ok: false, code: "hosted-error", message: sanitizeText(m).slice(0, 300) || ERR_REJECTED };
    }
    const result = (msg && msg.result) || {};
    const content = Array.isArray(result.content) ? sanitizeDeep(result.content) : [];
    return { ok: true, payload: { tool: name, content, isError: Boolean(result.isError) } };
  }

  async function listHostedTools() {
    if (listCache && Date.now() - listCache.at < cacheTtlMs) {
      return { ...listCache.result, cached: true };
    }
    let msg;
    try {
      await ensureSession();
      msg = await post({ jsonrpc: "2.0", id: nextId++, method: "tools/list" });
    } catch (e) {
      listCache = null; // invalidate on error — never serve stale over failures
      return { ok: false, message: e && e.__hostedError ? e.message : ERR_UNAVAILABLE };
    }
    if (msg && msg.error) {
      listCache = null;
      return { ok: false, message: sanitizeText(String(msg.error.message || ERR_REJECTED)).slice(0, 300) };
    }
    const names = ((msg && msg.result && msg.result.tools) || []).map((t) => t && t.name).filter(Boolean);
    const frozen = HOSTED_TOOL_NAMES;
    const extras = names.filter((n) => !frozen.includes(n));
    const missing = frozen.filter((n) => !names.includes(n));
    const result = {
      ok: true,
      names,
      extras,   // proxy tools outside the frozen contract (version drift, named)
      missing,  // frozen tools the proxy no longer exposes (version drift, named)
      contractOk: extras.length === 0 && missing.length === 0,
      contractVersion: CONTRACT_VERSION,
    };
    listCache = { at: Date.now(), result };
    return { ...result, cached: false };
  }

  return { callTool, listHostedTools, getBaseUrl: baseUrl };
}

/* --------------------------- default singleton --------------------------- */

let defaultClient = null;
function getDefaultClient() {
  if (!defaultClient) defaultClient = createHostedBackend({});
  return defaultClient;
}
// Test hook: inject a fetch-like override into the default client (never used in prod paths).
function __setFetchForTests(fetchImpl) {
  defaultClient = fetchImpl ? createHostedBackend({ fetchImpl }) : null;
}

module.exports = {
  CONTRACT_VERSION,
  HOSTED_TOOL_NAMES,
  KYBER_RUN_TOOL,
  ERR_UNAUTHORIZED,
  ERR_UNAVAILABLE,
  ERR_SESSION_EXPIRED,
  DEFAULT_BASE_URL,
  sanitizeText,
  sanitizeDeep,
  isHostedToolName,
  hostedToolSchemas,
  kyberRunToolSchema,
  createHostedBackend,
  getDefaultClient,
  __setFetchForTests,
};
