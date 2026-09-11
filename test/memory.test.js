"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const memory = require("../memory.js");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "orch-mem-"));
}

/* ------------------------------ EWMA clamp math ------------------------------ */

test("ewmaUpdate: alpha 0.2 from 0.5 on success gives exactly 0.6", () => {
  assert.strictEqual(memory.ewmaUpdate(0.5, 1), 0.6);
});

test("ewmaUpdate: per-update delta is clamped (single feedback cannot jump)", () => {
  // target move would be +0.5 (alpha 0.5 from 0), clamped to maxDelta 0.1
  assert.strictEqual(memory.ewmaUpdate(0, 1, { alpha: 0.5, maxDelta: 0.1 }), 0.1);
  // downward clamp too: from 1, alpha 0.9, maxDelta 0.15
  assert.strictEqual(memory.ewmaUpdate(1, 0, { alpha: 0.9, maxDelta: 0.15 }), 0.85);
});

test("ewmaUpdate stays within [0,1] and treats missing prev as neutral 0.5", () => {
  assert.strictEqual(memory.ewmaUpdate(undefined, 1), 0.6);
  assert.ok(memory.ewmaUpdate(0.99, 1, { alpha: 1, maxDelta: 1 }) <= 1);
  assert.ok(memory.ewmaUpdate(0.01, 0, { alpha: 1, maxDelta: 1 }) >= 0);
});

/* ------------------------------ keyword scoring ------------------------------ */

test("tokenize + keywordScore rank relevant text higher", () => {
  const q = memory.tokenize("fix regex bug in python");
  const good = memory.keywordScore(q, "python regex bug fixed quickly");
  const bad = memory.keywordScore(q, "write a marketing email in french");
  assert.ok(good > bad);
  assert.ok(good > 0);
  assert.strictEqual(bad, 0);
});

test("applyMemoryBias reorders healthy candidates but never exceeds maxPoints", () => {
  const ranked = [
    { id: "a", score: 80 },
    { id: "b", score: 78 },
    { id: "c", score: 70 },
  ];
  const bias = { b: 1, a: 0, c: 0.5 }; // b has perfect history, a failed
  const out = memory.applyMemoryBias(ranked, bias, { maxPoints: 10 });
  const pos = (id) => out.findIndex((r) => r.id === id);
  assert.strictEqual(out[0].id, "b"); // +10 pushes b (78+10=88) over a (80-10=70)
  assert.ok(pos("b") < pos("a"));
  assert.ok(pos("b") < pos("c"));
  assert.ok(out.every((r) => Math.abs(r.biasPoints) <= 10));
  // neutral model untouched
  assert.deepStrictEqual(out.find((r) => r.id === "c").biasPoints, 0);
});

/* --------------------------- store: feedback + recall --------------------------- */

test("recordFeedback appends a trajectory and updates EWMA stats", () => {
  const root = tmpRoot();
  const store = memory.createMemoryStore({ rootDir: root, cwd: "/proj/a" });
  const r = store.recordFeedback({ taskType: "code", model: "gpt-5", prompt: "fix the regex bug", outcome: "success" });
  assert.strictEqual(r.outcome, "success");
  assert.ok(r.ewma > 0.5 && r.ewma <= 0.65); // 0.5 -> 0.6 with alpha 0.2
  const lines = fs.readFileSync(path.join(store.dir, "memory.jsonl"), "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.strictEqual(entry.taskType, "code");
  assert.strictEqual(entry.model, "gpt-5");
  assert.strictEqual(entry.outcome, "success");
  assert.ok(entry.prompt_summary.includes("regex"));
  assert.ok(typeof entry.ts === "number");
  // second feedback lowers the score after a failure
  store.recordFeedback({ taskType: "code", model: "gpt-5", outcome: "failure" });
  const stats = JSON.parse(fs.readFileSync(path.join(store.dir, "stats.json"), "utf8"));
  const e = stats.entries["code|gpt-5"];
  assert.ok(e.score < 0.6);
  assert.strictEqual(e.n, 2);
});

test("llm_recall returns keyword-scored top-k trajectories and lessons", () => {
  const root = tmpRoot();
  const store = memory.createMemoryStore({ rootDir: root, cwd: "/proj/a" });
  store.recordFeedback({ taskType: "code", model: "gpt-5", prompt: "python regex bug", outcome: "success" });
  store.recordFeedback({ taskType: "writing", model: "claude-4.5", prompt: "marketing email in french", outcome: "success" });
  store.upsertLesson({ text: "Always pin python versions in CI", tags: ["python", "ci"] });
  const r = store.recall("python regex", { k: 5 });
  assert.strictEqual(r.trajectories.length, 1);
  assert.strictEqual(r.trajectories[0].model, "gpt-5");
  assert.ok(r.trajectories[0].score > 0);
  assert.strictEqual(r.lessons.length, 1);
  assert.ok(r.lessons[0].text.includes("python"));
  const r2 = store.recall("python regex", { k: 1, kind: "trajectories" });
  assert.strictEqual(r2.trajectories.length, 1);
  assert.strictEqual(r2.lessons, undefined);
});

test("modelBias returns per-taskType EWMA map only", () => {
  const root = tmpRoot();
  const store = memory.createMemoryStore({ rootDir: root, cwd: "/proj/a" });
  store.recordFeedback({ taskType: "code", model: "gpt-5", outcome: "success" });
  store.recordFeedback({ taskType: "writing", model: "claude-4.5", outcome: "failure" });
  const bias = store.modelBias("code");
  assert.deepStrictEqual(Object.keys(bias), ["gpt-5"]);
  assert.ok(bias["gpt-5"] > 0.5);
  assert.deepStrictEqual(store.modelBias("multimodal"), {});
});

/* --------------------------------- lessons --------------------------------- */

test("lessons are hard-capped at 500 chars", () => {
  const root = tmpRoot();
  const store = memory.createMemoryStore({ rootDir: root, cwd: "/p" });
  const r = store.upsertLesson({ text: "L".repeat(900), tags: ["t"] });
  assert.ok(r.text.length <= 501 + 30); // 500 + cap marker
  assert.ok(r.text.includes("capped"));
});

test("lessons list is capped at 50 with FIFO eviction", () => {
  const root = tmpRoot();
  const store = memory.createMemoryStore({ rootDir: root, cwd: "/p" });
  const first = store.upsertLesson({ text: "first lesson ever" });
  for (let i = 0; i < 60; i++) store.upsertLesson({ text: "lesson number " + i });
  const lessons = JSON.parse(fs.readFileSync(path.join(store.dir, "lessons.json"), "utf8")).lessons;
  assert.strictEqual(lessons.length, 50);
  assert.ok(!lessons.some((l) => l.id === first.id)); // oldest evicted
});

test("relevantLessons does top-k keyword injection", () => {
  const root = tmpRoot();
  const store = memory.createMemoryStore({ rootDir: root, cwd: "/p" });
  store.upsertLesson({ text: "Pin the node version in CI", tags: ["ci"] });
  store.upsertLesson({ text: "Prefer French tone for emails", tags: ["writing"] });
  const hits = store.relevantLessons("how to make CI stable with node", 3);
  assert.strictEqual(hits.length, 1);
  assert.ok(hits[0].text.includes("node"));
});

/* --------------------------- corruption resilience --------------------------- */

test("corrupted stats.json / lessons.json are quarantined and regenerated, never crash", () => {
  const root = tmpRoot();
  const store = memory.createMemoryStore({ rootDir: root, cwd: "/p" });
  fs.mkdirSync(store.dir, { recursive: true });
  fs.writeFileSync(path.join(store.dir, "stats.json"), "{ this is not json !!");
  fs.writeFileSync(path.join(store.dir, "lessons.json"), "\x00\x00garbage");
  let r;
  assert.doesNotThrow(() => {
    r = store.recordFeedback({ taskType: "code", model: "llama-4", outcome: "success" });
  });
  assert.strictEqual(r.outcome, "success");
  const stats = JSON.parse(fs.readFileSync(path.join(store.dir, "stats.json"), "utf8")); // valid again
  assert.ok(stats.entries["code|llama-4"]);
  // corrupted lessons.json is quarantined on read, regenerated on next lesson write
  store.upsertLesson({ text: "rebuilt after corruption" });
  const lessons = JSON.parse(fs.readFileSync(path.join(store.dir, "lessons.json"), "utf8"));
  assert.ok(lessons.lessons.some((l) => l.text === "rebuilt after corruption"));
  const quarantined = fs.readdirSync(store.dir).filter((f) => f.includes(".corrupt-"));
  assert.ok(quarantined.length >= 2); // stats + lessons were quarantined, not lost silently
});

test("corrupted memory.jsonl lines are skipped silently", () => {
  const root = tmpRoot();
  const store = memory.createMemoryStore({ rootDir: root, cwd: "/p" });
  fs.mkdirSync(store.dir, { recursive: true });
  fs.writeFileSync(path.join(store.dir, "memory.jsonl"), 'not json at all\n{"ts":1,"taskType":"code","model":"gpt-5","prompt_summary":"python regex bug","outcome":"success"}\n\n');
  const r = store.recall("python regex", { k: 5 });
  assert.strictEqual(r.trajectories.length, 1);
  assert.ok(store.recall("anything else", { k: 5 }).trajectories.length <= 1);
});

test("stores are namespaced per cwd under .orchestrator/<hash-of-cwd>", () => {
  const root = tmpRoot();
  const a = memory.createMemoryStore({ rootDir: root, cwd: "/proj/alpha" });
  const b = memory.createMemoryStore({ rootDir: root, cwd: "/proj/beta" });
  assert.notStrictEqual(a.dir, b.dir);
  assert.ok(a.dir.startsWith(path.join(root, memory.cwdHash("/proj/alpha"))));
  assert.ok(path.basename(a.dir).length === 12);
  a.recordFeedback({ taskType: "code", model: "gpt-5", outcome: "success" });
  assert.deepStrictEqual(b.modelBias("code"), {}); // isolation
});
