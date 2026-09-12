"use strict";

/* Backend-switch tests at server level. Provider env keys are scrubbed so the
 * probe path stays offline and deterministic; hosted calls use a fetch mock. */

process.env.LLM_ORCH_MEMORY_DIR = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "orch-switch-"));

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const hosted = require("../hosted.js");
const server = require("../server.js");

const PROVIDER_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "OLLAMA_API_KEY", "LLM_ORCH_MODELS", "LLM_ORCH_LOCAL_MODELS"];
const saved = {};
for (const k of PROVIDER_KEYS) {
  saved[k] = process.env[k];
  delete process.env[k];
}

test.after(() => {
  for (const k of PROVIDER_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  delete process.env.KYBERNOS_MCP_BACKEND;
  delete process.env.KYBERNOS_API_KEY;
  hosted.__setFetchForTests(null);
});

/* ------------------------------ switch logic ------------------------------ */

test("default backend mode is local", () => {
  delete process.env.KYBERNOS_MCP_BACKEND;
  assert.strictEqual(server.getBackendMode(), "local");
});

test("KYBERNOS_MCP_BACKEND accepts local|hosted|both and falls back to local on garbage", () => {
  for (const m of ["local", "hosted", "both"]) {
    process.env.KYBERNOS_MCP_BACKEND = m;
    assert.strictEqual(server.getBackendMode(), m);
  }
  process.env.KYBERNOS_MCP_BACKEND = "CLOUD-9";
  assert.strictEqual(server.getBackendMode(), "local");
  delete process.env.KYBERNOS_MCP_BACKEND;
});

test("tools/list surface per mode", () => {
  const names = (mode) => {
    process.env.KYBERNOS_MCP_BACKEND = mode;
    return server.toolSchema().map((t) => t.name);
  };
  const local = names("local");
  assert.ok(local.includes("llm_status"));
  assert.ok(local.includes("llm_delegate"));
  assert.ok(local.includes("llm_orchestrate"));
  assert.ok(local.includes("llm_feedback"));
  assert.ok(local.includes("llm_recall"));
  assert.ok(!local.includes("kyber_list"));
  assert.ok(!local.includes("kyber_run"));

  const hostedMode = names("hosted");
  assert.ok(hostedMode.includes("kyber_list"));
  assert.ok(hostedMode.includes("kyber_run"));
  assert.ok(hostedMode.includes("llm_feedback"));
  assert.ok(!hostedMode.includes("llm_delegate")); // hosted-only mode hides local delegation

  const both = names("both");
  assert.ok(both.includes("llm_delegate"));
  assert.ok(both.includes("kyber_list"));
  assert.ok(both.includes("kyber_run"));
  delete process.env.KYBERNOS_MCP_BACKEND;
});

test("local mode: hosted tool calls are rejected as unknown with a hint", async () => {
  process.env.KYBERNOS_MCP_BACKEND = "local";
  const r = await server.handleToolCall("kyber_list", {});
  assert.ok(r.error);
  assert.ok(/Unknown tool/.test(r.error));
  assert.ok(/KYBERNOS_MCP_BACKEND/.test(r.error));
});

/* ------------------------------ kyber_run forwarding ------------------------------ */

test("kyber_run is forwarded through the hosted client in hosted/both (not stubbed)", async () => {
  process.env.KYBERNOS_API_KEY = "kys-testkey123456789";
  let forwarded = 0;
  const calledTools = [];
  hosted.__setFetchForTests(async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return { ok: true, status: 200, headers: { get: (h) => (h === "mcp-session-id" ? "sess-1" : null) }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }) };
    }
    if (body.method === "tools/call") {
      forwarded++;
      calledTools.push(body.params.name);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: `proxied run for ${body.params.name}` }] } }) };
    }
    return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
  });
  for (const mode of ["hosted", "both"]) {
    process.env.KYBERNOS_MCP_BACKEND = mode;
    const r = await server.handleToolCall("kyber_run", { request: "run it" });
    assert.ok(!r.error, "unexpected error: " + JSON.stringify(r));
    assert.ok(r.content[0].text.includes("proxied run"));
  }
  assert.strictEqual(calledTools.length, 2);
  assert.ok(calledTools.every((t) => t === "kyber_run"));
  assert.strictEqual(forwarded, 2);
  hosted.__setFetchForTests(null);
});

test("kyber_run in local mode is rejected as unknown (hosted-only hint, preserved)", async () => {
  process.env.KYBERNOS_MCP_BACKEND = "local";
  const r = await server.handleToolCall("kyber_run", { request: "run it" });
  assert.ok(r.error);
  assert.ok(/Unknown tool/.test(r.error));
  assert.ok(/KYBERNOS_MCP_BACKEND/.test(r.error));
  assert.notStrictEqual(r.error, "hosted-p2-required");
  delete process.env.KYBERNOS_MCP_BACKEND;
});

/* --------------------------- hosted forwarding --------------------------- */

test("hosted tool calls are forwarded through the hosted client (mock fetch)", async () => {
  process.env.KYBERNOS_MCP_BACKEND = "hosted";
  process.env.KYBERNOS_API_KEY = "kys-testkey123456789";
  const KEY = process.env.KYBERNOS_API_KEY;
  const seen = [];
  hosted.__setFetchForTests(async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return { ok: true, status: 200, headers: { get: (h) => (h === "mcp-session-id" ? "sess-1" : null) }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }) };
    }
    if (body.method === "tools/call") {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: `proxied answer for ${body.params.name} (leak check: ${KEY})` }] } }),
      };
    }
    return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
  });
  const r = await server.handleToolCall("prompt_search", { query: "code review" });
  assert.ok(!r.error, "unexpected error: " + JSON.stringify(r));
  assert.strictEqual(r.tool, "prompt_search");
  assert.ok(r.content[0].text.includes("proxied answer"));
  assert.ok(!JSON.stringify(r).includes(KEY)); // key never leaks into results
  assert.ok(seen.some((s) => s.body.method === "initialize" && s.headers["mcp-session-id"] === undefined));
  assert.ok(seen.some((s) => s.body.method === "tools/call" && s.headers["mcp-session-id"] === "sess-1"));
  assert.ok(seen.every((s) => s.headers.authorization === `Bearer ${KEY}`));
  hosted.__setFetchForTests(null);
});

test("hosted auth failure surfaces the generic unauthorized message", async () => {
  process.env.KYBERNOS_MCP_BACKEND = "both";
  process.env.KYBERNOS_API_KEY = "kys-wrongkey000000000";
  hosted.__setFetchForTests(async () => ({ ok: false, status: 401, headers: { get: () => "application/json" }, text: async () => '{"error":"invalid key kys-wrongkey000000000"}' }));
  const r = await server.handleToolCall("kyber_list", {});
  assert.strictEqual(r.error, "hosted backend unauthorized");
  assert.ok(!JSON.stringify(r).includes("kys-wrongkey000000000"));
  hosted.__setFetchForTests(null);
});

/* --------------------------- memory tools (all modes) --------------------------- */

test("llm_feedback / llm_recall work in local mode with validation", async () => {
  process.env.KYBERNOS_MCP_BACKEND = "local";
  const bad = await server.handleToolCall("llm_feedback", { outcome: "meh" });
  assert.ok(/outcome/.test(bad.error));
  const ok = await server.handleToolCall("llm_feedback", { outcome: "success", taskType: "code", model: "gpt-5", task: "python regex bug fixed", lesson: { text: "Use re.VERBOSE for complex regexes", tags: ["python", "regex"] } });
  assert.strictEqual(ok.recorded, true);
  assert.ok(ok.ewma > 0.5);
  assert.ok(ok.lessonId);
  const rec = await server.handleToolCall("llm_recall", { query: "python regex", k: 3 });
  assert.strictEqual(rec.trajectories.length, 1);
  assert.ok(rec.lessons.length >= 1);
  assert.ok(rec.lessons[0].text.includes("regex"));
});

/* ------------------------------ local regression ------------------------------ */

test("local mode behavior unchanged: llm_status works without any provider key", async () => {
  process.env.KYBERNOS_MCP_BACKEND = "local";
  const r = await server.handleToolCall("llm_status", { force: true });
  assert.strictEqual(r.backend.mode, "local");
  assert.strictEqual(r.backend.hosted, null);
  assert.ok(Array.isArray(r.models));
  assert.ok(r.models.every((m) => m.ok === false)); // no keys -> nothing healthy, no crash
});
