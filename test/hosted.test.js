"use strict";

const test = require("node:test");
const assert = require("node:assert");
const hosted = require("../hosted.js");

const KEY = "kys-testkey123456789";

/* Build a fetch-like mock routing on the JSON-RPC method in the request body.
 * handlers: { status, contentType, sessionId, body } or fn(body, url, init) */
function mockFetch(handler) {
  const calls = { list: 0, call: 0, init: 0, all: [] };
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.all.push({ url, body });
    let r;
    if (typeof handler === "function") r = handler(body, url, init);
    else r = handler;
    if (body.method === "tools/list") calls.list++;
    if (body.method === "tools/call") calls.call++;
    if (body.method === "initialize") calls.init++;
    const status = r.status || 200;
    const ctype = r.contentType || "application/json";
    const sid = r.sessionId;
    let text = r.body;
    if (text === undefined) {
      text =
        status >= 200 && status < 300 && body.id !== undefined && body.method !== "notifications/initialized"
          ? JSON.stringify({ jsonrpc: "2.0", id: body.id, result: r.result !== undefined ? r.result : {} })
          : "";
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? ctype : String(h).toLowerCase() === "mcp-session-id" ? sid || null : null) },
      text: async () => text,
    };
  };
  fn.calls = calls;
  return fn;
}

function backend(handler, extra = {}) {
  return hosted.createHostedBackend({ fetchImpl: mockFetch(handler), apiKey: KEY, ...extra });
}

/* ------------------------- error mapping (key-safe) ------------------------- */

test("401 maps to the exact generic 'hosted backend unauthorized'", async () => {
  const c = backend({ status: 401, body: '{"error":"bad key kys-testkey123456789"}' });
  const r = await c.callTool("kyber_list", {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.message, "hosted backend unauthorized");
  assert.ok(!r.message.includes(KEY));
  assert.ok(!r.message.includes("kys-"));
});

test("403 maps to the same exact generic message", async () => {
  const c = backend({ status: 403, body: "Forbidden for Bearer kys-testkey123456789" });
  const r = await c.callTool("kyber_get", { id: "x" });
  assert.strictEqual(r.message, "hosted backend unauthorized");
});

test("5xx and network failures map to 'hosted backend unavailable'", async () => {
  const c5 = backend({ status: 502, body: "upstream blew up at https://api.dev.kybernos.app/mcp?key=kys-testkey123456789" });
  assert.strictEqual((await c5.callTool("kyber_list", {})).message, "hosted backend unavailable");
  const cN = hosted.createHostedBackend({ apiKey: KEY, fetchImpl: async () => { throw new Error("ECONNRESET kys-testkey123456789"); } });
  const rn = await cN.callTool("kyber_list", {});
  assert.strictEqual(rn.message, "hosted backend unavailable");
  assert.ok(!rn.message.includes(KEY));
});

test("other 4xx map to a generic rejection without echoing the body", async () => {
  const c = backend({ status: 400, body: "detail: your key kys-testkey123456789 is malformed" });
  const r = await c.callTool("kyber_list", {});
  assert.strictEqual(r.ok, false);
  assert.ok(!r.message.includes(KEY));
  assert.ok(!r.message.includes("detail"));
});

test("missing key fails closed with a generic setup message", async () => {
  const c = hosted.createHostedBackend({ fetchImpl: mockFetch({}), apiKey: "" });
  const saved = process.env.KYBERNOS_API_KEY;
  delete process.env.KYBERNOS_API_KEY;
  try {
    const r = await c.callTool("kyber_list", {});
    assert.strictEqual(r.ok, false);
    assert.ok(/KYBERNOS_API_KEY/.test(r.message));
    assert.ok(!r.message.includes(KEY));
  } finally {
    if (saved !== undefined) process.env.KYBERNOS_API_KEY = saved;
  }
});

/* ---------------------------- forwarding + safety ---------------------------- */

test("tools/call is forwarded over Streamable HTTP and results are sanitized", async () => {
  const f = mockFetch((body) => {
    if (body.method === "tools/call") {
      return { result: { content: [{ type: "text", text: "leaked sk-abcdefghijklmnop123456 and kys-QRSTUVWXYZ098765 and Bearer abcdefghijklmnop12" }] } };
    }
    return {};
  });
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.callTool("kyber_list", { limit: 3 });
  assert.strictEqual(r.ok, true);
  const text = JSON.stringify(r.payload);
  assert.ok(text.includes("[REDACTED]"));
  assert.ok(!text.includes("sk-abcdefghijklmnop123456"));
  assert.ok(!text.includes("kys-QRSTUVWXYZ098765"));
  assert.ok(!text.includes("Bearer abcdefghijklmnop12"));
  assert.strictEqual(r.payload.tool, "kyber_list");
  // Authorization header present on every POST and equals Bearer <key>
  for (const c1 of f.calls.all) {
    // headers not captured in calls; verified below via dedicated capture
  }
});

test("Authorization header carries the key and is the only place it exists", async () => {
  const seen = [];
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, headers: init.headers, body });
    if (body.method === "initialize") {
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }) };
    }
    if (body.method === "tools/call") {
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } }) };
    }
    return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
  };
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.callTool("modules_list", {});
  assert.strictEqual(r.ok, true);
  assert.ok(seen.length >= 2);
  assert.ok(seen.every((s) => s.headers.authorization === `Bearer ${KEY}`));
  assert.ok(seen.every((s) => !s.url.includes(KEY)));
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test("SSE (text/event-stream) responses are parsed", async () => {
  const f = mockFetch((body) => {
    if (body.method === "tools/call") {
      return {
        contentType: "text/event-stream",
        body: `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok from sse" }] } })}\n\n`,
      };
    }
    return {};
  });
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.callTool("skills_list", {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.payload.content[0].text, "ok from sse");
});

test("proxy 'unknown tool' error surfaces a contract mismatch naming the tool", async () => {
  const c = backend((body) => {
    if (body.method === "tools/call") return { result: undefined, status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Unknown tool: kyber_list" } }) };
    return {};
  });
  const r = await c.callTool("kyber_list", {});
  assert.strictEqual(r.code, "hosted-contract-mismatch");
  assert.ok(r.message.includes("kyber_list"));
});

test("calling a tool outside the frozen contract is rejected locally, naming the tool", async () => {
  const c = backend({});
  const r = await c.callTool("totally_new_proxy_tool", {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "hosted-contract-mismatch");
  assert.ok(r.message.includes("totally_new_proxy_tool"));
  assert.ok(r.message.includes(String(hosted.CONTRACT_VERSION)));
});

/* ------------------------- SSE multi-message hardening ------------------------- */

test("SSE multi-event: fragmented data: lines concatenate and id match beats last", async () => {
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") return { ok: true, status: 200, headers: { get: (h) => (h === "mcp-session-id" ? "sess-1" : null) }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }) };
    if (body.method === "notifications/initialized") return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
    if (body.method === "tools/call") {
      // Events: one for unrelated id, one garbage, then the requested id
      // whose payload is fragmented across two data: lines.
      const matchId = body.id;
      const payload = JSON.stringify({ jsonrpc: "2.0", id: matchId, result: { content: [{ type: "text", text: "matched" }] } });
      // fragment the payload mid-string on a safe boundary (after the `id:` value)
      const fragAt = payload.indexOf(`"id":${matchId},`) + `"id":${matchId},`.length;
      const p1 = payload.slice(0, fragAt);
      const p2 = payload.slice(fragAt);
      const sse =
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 999, result: { content: [{ type: "text", text: "other" }] } })}\n\n` +
        `event: message\n: comment line should be ignored\ndata: {not valid json}\n\n` +
        `event: message\ndata: ${p1}\ndata: ${p2}\n\n`;
      return { ok: true, status: 200, headers: { get: (h) => (h === "content-type" ? "text/event-stream" : null) }, text: async () => sse };
    }
    return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
  };
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.callTool("skills_list", {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.payload.content[0].text, "matched"); // id match, not the "other" last message
});

test("SSE: garbage-only and empty streams fall back to ERR_UNAVAILABLE", async () => {
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") return { ok: true, status: 200, headers: { get: (h) => (h === "mcp-session-id" ? "sess-1" : null) }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }) };
    if (body.method === "notifications/initialized") return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
    if (body.method === "tools/call") {
      return { ok: true, status: 200, headers: { get: (h) => (h === "content-type" ? "text/event-stream" : null) }, text: async () => `event: message\ndata: {garbage}\n\n: comment only\n\ndata:\n\n` };
    }
    return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
  };
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.callTool("skills_list", {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.message, hosted.ERR_UNAVAILABLE);
});

test("SSE multi-event: picks the id match even when it is not the last event", async () => {
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") return { ok: true, status: 200, headers: { get: (h) => (h === "mcp-session-id" ? "sess-1" : null) }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }) };
    if (body.method === "notifications/initialized") return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
    if (body.method === "tools/call") {
      const sse =
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "first-match" }] } })}\n\n` +
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id + 1, result: { content: [{ type: "text", text: "later-no-match" }] } })}\n\n`;
      return { ok: true, status: 200, headers: { get: (h) => (h === "content-type" ? "text/event-stream" : null) }, text: async () => sse };
    }
    return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
  };
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.callTool("kyber_list", {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.payload.content[0].text, "first-match");
});

/* --------------------------- bounded 5xx / network retry --------------------------- */

function retryFetch(sequence) {
  // sequence: array of { status, body?, contentType? } for tools/call and
  // tools/list only. initialize + notifications/initialized are auto-succeeded.
  // Returns a mock with a call counter.
  const calls = { total: 0, call: 0, list: 0 };
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.total++;
    if (body.method === "initialize") return { ok: true, status: 200, headers: { get: (h) => (h === "mcp-session-id" ? "sess-1" : null) }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }) };
    if (body.method === "notifications/initialized") return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
    if (body.method === "tools/call") calls.call++;
    if (body.method === "tools/list") calls.list++;
    const item = sequence.splice(0, 1)[0] || { status: 200 };
    const s = item.status;
    const ctype = item.contentType || "application/json";
    let text = "";
    if (s >= 200 && s < 300 && body.id !== undefined) {
      text = JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } });
    }
    return { ok: s >= 200 && s < 300, status: s, headers: { get: (h) => (h === "content-type" ? ctype : null) }, text: async () => text };
  };
  fn.calls = calls;
  return fn;
}

test("retry: 500-then-success for tools/list issues exactly 2 fetch calls", async () => {
  const f = retryFetch([{ status: 500 }, { status: 200 }]);
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.listHostedTools();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(f.calls.list, 2); // list(500) + retried list(200)
});

test("retry: 500-then-success for tools/call WITH idempotency_token issues 2 calls", async () => {
  const f = retryFetch([{ status: 500 }, { status: 200 }]);
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.callTool("kyber_get", { id: "x", idempotency_token: "tok-123" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(f.calls.call, 2); // tools/call(500) + retried tools/call(200)
});

test("retry: 500 for tools/call WITHOUT token is never retried (1 call, error)", async () => {
  const f = retryFetch([{ status: 500 }]);
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.callTool("kyber_get", { id: "x" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.message, hosted.ERR_UNAVAILABLE);
  assert.strictEqual(f.calls.call, 1); // exactly one attempt
});

test("retry: 500-then-success for tools/call WITH token returns the retried result", async () => {
  const f = retryFetch([{ status: 500 }, { status: 200 }]);
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.callTool("kyber_get", { id: "x", idempotency_token: "tok" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.payload.content[0].text, "ok");
});

test("retry: network error then success on tools/list retries to success", async () => {
  let n = 0;
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }) };
    if (body.method === "tools/list") {
      n++;
      if (n === 1) throw new Error("ECONNRESET");
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: hosted.HOSTED_TOOL_NAMES.map((t) => ({ name: t })) } }) };
    }
    return { ok: true, status: 202, headers: { get: () => null }, text: async () => "" };
  };
  f.calls = { list: () => n };
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.listHostedTools();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.contractOk, true);
  assert.strictEqual(n, 2);
});

test("retry: 401 is never retried (single attempt)", async () => {
  const f = retryFetch([{ status: 401 }]);
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.callTool("kyber_list", {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.message, hosted.ERR_UNAUTHORIZED);
  assert.strictEqual(f.calls.call, 1); // never retried
});

/* ------------------------------ list cache (TTL) ------------------------------ */

test("tools/list cache: 60s TTL avoids refetching, errors invalidate", async () => {
  let mode = "ok";
  const f = mockFetch((body) => {
    if (body.method === "tools/list") {
      if (mode === "error") return { status: 500, body: "boom" };
      return { result: { tools: hosted.HOSTED_TOOL_NAMES.map((n) => ({ name: n })) } };
    }
    return {};
  });
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r1 = await c.listHostedTools();
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.contractOk, true);
  const r2 = await c.listHostedTools();
  assert.strictEqual(r2.cached, true);
  assert.strictEqual(f.calls.list, 1); // cached, no extra hop
  mode = "error";
  const r3 = await c.listHostedTools(); // TTL not expired but... cache still valid -> cached
  assert.strictEqual(r3.cached, true); // within TTL the cache is served (by design)
  // force expiry
  const c2 = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY, cacheTtlMs: 5 });
  await new Promise((res) => setTimeout(res, 15));
  mode = "error";
  const r4 = await c2.listHostedTools();
  assert.strictEqual(r4.ok, false);
  assert.strictEqual(r4.message, "hosted backend unavailable");
  mode = "ok";
  const r5 = await c2.listHostedTools(); // invalidated on error -> refetch succeeds
  assert.strictEqual(r5.ok, true);
});

test("listHostedTools names tools outside/missing from the frozen contract", async () => {
  const f = mockFetch((body) => {
    if (body.method === "tools/list") {
      return { result: { tools: [...hosted.HOSTED_TOOL_NAMES.slice(0, 9).map((n) => ({ name: n })), { name: "brand_new_tool" }] } };
    }
    return {};
  });
  const c = hosted.createHostedBackend({ fetchImpl: f, apiKey: KEY });
  const r = await c.listHostedTools();
  assert.deepStrictEqual(r.extras, ["brand_new_tool"]);
  assert.deepStrictEqual(r.missing, [hosted.HOSTED_TOOL_NAMES[9]]);
  assert.strictEqual(r.contractOk, false);
});

/* --------------------------- redaction + cap mirror --------------------------- */

test("sanitizeText redacts sk-, kys- and Bearer tokens", () => {
  const out = hosted.sanitizeText("keys: sk-abcdefghijklmnop123456, kys-QRSTUVWXYZ098765, and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig");
  assert.ok(!out.includes("sk-abcdefghijklmnop123456"));
  assert.ok(!out.includes("kys-QRSTUVWXYZ098765"));
  assert.ok(!out.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
  assert.ok((out.match(/\[REDACTED\]/g) || []).length >= 3);
});

test("sanitizeText caps at 32KB with an explicit truncation marker", () => {
  const big = "A".repeat(64 * 1024);
  const out = hosted.sanitizeText(big);
  assert.ok(out.includes("truncated"));
  assert.ok(Buffer.byteLength(out, "utf8") <= 32 * 1024 + 200); // content 32KB + short marker
});

test("sanitizeText handles multi-byte content at the cap boundary", () => {
  const out = hosted.sanitizeText("é".repeat(40 * 1024)); // 80KB of utf-8
  assert.ok(out.includes("truncated"));
});

test("sanitizeDeep redacts recursively (arrays, nested objects, keys)", () => {
  const out = hosted.sanitizeDeep({
    "kys-ABCDEFGHIJKLMNOP": [{ text: "see sk-abcdefghijklmnop123456" }, { nested: { t: "Bearer abcdefghijklmnop12" } }],
  });
  const s = JSON.stringify(out);
  assert.ok(!s.includes("sk-abcdefghijklmnop123456"));
  assert.ok(!s.includes("kys-ABCDEFGHIJKLMNOP"));
  assert.ok(!s.includes("Bearer abcdefghijklmnop12"));
});

test("frozen contract exposes exactly the 10 proxy tools + version", () => {
  assert.strictEqual(hosted.HOSTED_TOOL_NAMES.length, 10);
  assert.ok(Number.isInteger(hosted.CONTRACT_VERSION));
  assert.deepStrictEqual(
    [...hosted.HOSTED_TOOL_NAMES].sort(),
    ["kyber_get", "kyber_list", "lesson_search", "memory_search", "modules_list", "prompt_get", "prompt_search", "skills_list", "templates_list", "usage_query"]
  );
});
