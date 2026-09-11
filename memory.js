#!/usr/bin/env node
"use strict";

/**
 * Ruflo-lite local memory (zero-dependency, pure JS — no embeddings).
 *
 * Layout (all git-ignored, namespaced per working directory):
 *   <root>/.orchestrator/<sha256(cwd)[:12]>/memory.jsonl  — append-only trajectories
 *   <root>/.orchestrator/<sha256(cwd)[:12]>/stats.json    — EWMA success score per (taskType, model)
 *   <root>/.orchestrator/<sha256(cwd)[:12]>/lessons.json  — distilled keyword-tagged lessons
 *
 * Invariants:
 *   - File IO is defensive: corrupted JSON is quarantined (<file>.corrupt-<ts>)
 *     and regenerated — the server NEVER crashes on bad state.
 *   - stats bias refines ranking among healthy models only; it can never
 *     resurrect an unhealthy model (health checks always win).
 *   - Lessons are hard-capped (500 chars each) before storage.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LESSON_MAX_CHARS = 500;
const LESSONS_MAX_COUNT = 50;
const MEMORY_JSONL_MAX_BYTES = 1_000_000; // rotate beyond this
const MEMORY_JSONL_KEEP_LINES = 500;
const EWMA_ALPHA = 0.2; // conservative
const EWMA_MAX_DELTA = 0.15; // single-feedback impact cap (per-update clamp)

/* ----------------------------- pure functions ----------------------------- */

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "in", "on", "to", "for", "with", "is", "are", "was", "be", "by", "at", "it", "this", "that", "as", "from", "how", "les", "des", "une", "un", "la", "le", "et", "ou", "au", "aux", "avec", "dans", "pour", "sur", "est"]);

function tokenize(str) {
  return String(str || "")
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ_+-]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function keywordScore(queryTokens, text) {
  if (!queryTokens.length) return 0;
  const tokens = tokenize(text);
  if (!tokens.length) return 0;
  const counts = new Map();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  let score = 0;
  for (const q of new Set(queryTokens)) {
    const c = counts.get(q) || 0;
    if (c) score += 1 + Math.min(c - 1, 2) * 0.25; // hit + small repetition bonus
  }
  return score / queryTokens.length; // 0..1-ish
}

/**
 * EWMA update with a per-update delta clamp (single feedback can never move
 * the score by more than maxDelta). outcome: 1 (success) | 0 (failure).
 */
function ewmaUpdate(prev, outcome, opts) {
  const alpha = opts && opts.alpha !== undefined ? opts.alpha : EWMA_ALPHA;
  const maxDelta = opts && opts.maxDelta !== undefined ? opts.maxDelta : EWMA_MAX_DELTA;
  const p = Number.isFinite(prev) ? Math.min(1, Math.max(0, prev)) : 0.5;
  const target = outcome ? 1 : 0;
  let next = p + alpha * (target - p);
  next = Math.min(p + maxDelta, Math.max(p - maxDelta, next)); // clamp per-update delta
  return Math.min(1, Math.max(0, next));
}

/**
 * Bias ranking among healthy models only. bias: { modelId -> ewma score (0..1) },
 * absent entries are neutral (0.5). maxPoints caps the influence so bias
 * refines the probe-score ranking but never overrides health/minScore gates.
 */
function applyMemoryBias(ranked, bias, opts) {
  const maxPoints = opts && opts.maxPoints !== undefined ? opts.maxPoints : 10;
  const b = bias || {};
  return ranked
    .slice()
    .map((r) => {
      const ewma = Number.isFinite(b[r.id]) ? b[r.id] : 0.5;
      return { id: r.id, score: r.score, biasPoints: Math.round((ewma - 0.5) * 2 * maxPoints) };
    })
    .map((r) => ({ ...r, adjusted: r.score + r.biasPoints }))
    .sort((a, c) => c.adjusted - a.adjusted);
}

function cwdHash(cwd) {
  return crypto.createHash("sha256").update(String(cwd)).digest("hex").slice(0, 12);
}

/* ------------------------------ store factory ------------------------------ */

function safeMkdir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e && e.code !== "ENOENT") {
      // Corrupted -> quarantine + regenerate (never crash)
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        /* best effort */
      }
    }
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    safeMkdir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

function createMemoryStore(options = {}) {
  const root = options.rootDir || process.env.LLM_ORCH_MEMORY_DIR || path.join(process.cwd(), ".orchestrator");
  const ns = cwdHash(options.cwd || process.cwd());
  const dir = path.join(root, ns);
  const memoryPath = path.join(dir, "memory.jsonl");
  const statsPath = path.join(dir, "stats.json");
  const lessonsPath = path.join(dir, "lessons.json");

  function readStats() {
    const v = readJson(statsPath, null);
    if (!v || typeof v !== "object" || !v.entries || typeof v.entries !== "object") {
      return { version: 1, entries: {} };
    }
    return { version: 1, entries: v.entries };
  }

  function readLessons() {
    const v = readJson(lessonsPath, null);
    if (!v || typeof v !== "object" || !Array.isArray(v.lessons)) return { version: 1, lessons: [] };
    return { version: 1, lessons: v.lessons.filter((l) => l && typeof l.text === "string") };
  }

  function readTrajectories() {
    let raw = "";
    try {
      raw = fs.readFileSync(memoryPath, "utf8");
    } catch {
      return [];
    }
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try {
        const o = JSON.parse(s);
        if (o && typeof o === "object") out.push(o); // skip corrupted lines silently
      } catch {
        /* skip corrupted line */
      }
    }
    return out;
  }

  function appendLine(obj) {
    if (!safeMkdir(dir)) return false;
    try {
      try {
        const st = fs.statSync(memoryPath);
        if (st.size > MEMORY_JSONL_MAX_BYTES) {
          const lines = fs.readFileSync(memoryPath, "utf8").split(/\r?\n/).filter((l) => l.trim());
          fs.writeFileSync(memoryPath, lines.slice(-MEMORY_JSONL_KEEP_LINES).join("\n") + "\n");
        }
      } catch {
        /* no file yet */
      }
      fs.appendFileSync(memoryPath, JSON.stringify(obj) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  /* ------------------------------ public API ------------------------------ */

  function recordFeedback(input) {
    const outcome = String((input && input.outcome) || "").toLowerCase();
    if (outcome !== "success" && outcome !== "failure") {
      return { error: "outcome must be 'success' or 'failure'" };
    }
    const taskType = String((input && input.taskType) || "analysis").slice(0, 40);
    const model = String((input && input.model) || "unknown").slice(0, 80);
    const prompt = String((input && input.prompt) || "").slice(0, 200);

    const appended = appendLine({
      ts: Date.now(),
      cwd: options.cwd || process.cwd(),
      taskType,
      model,
      prompt_summary: prompt,
      outcome,
    });

    // EWMA stats update
    const stats = readStats();
    const key = `${taskType}|${model}`;
    const prev = stats.entries[key] && Number.isFinite(stats.entries[key].score) ? stats.entries[key].score : 0.5;
    const score = ewmaUpdate(prev, outcome === "success" ? 1 : 0);
    stats.entries[key] = { score: Math.round(score * 1000) / 1000, n: ((stats.entries[key] && stats.entries[key].n) || 0) + 1, updated: Date.now() };
    writeJson(statsPath, stats);

    let lessonId = null;
    if (input && input.lesson && String(input.lesson.text || input.lesson).trim()) {
      const r = upsertLesson(typeof input.lesson === "string" ? { text: input.lesson } : input.lesson);
      lessonId = r.id || null;
    }

    return { recorded: appended || true, taskType, model, outcome, ewma: stats.entries[key].score, lessonId, memoryDir: dir };
  }

  function upsertLesson(lesson) {
    const lessons = readLessons().lessons;
    let text = String((lesson && lesson.text) || "").trim();
    if (!text) return { error: "lesson text is required" };
    if (text.length > LESSON_MAX_CHARS) text = text.slice(0, LESSON_MAX_CHARS) + "…[capped at 500 chars]";
    const tags = (Array.isArray(lesson && lesson.tags) ? lesson.tags : [])
      .map((t) => String(t).trim().toLowerCase().slice(0, 40))
      .filter(Boolean)
      .slice(0, 8);
    const now = Date.now();
    let entry;
    if (lesson && lesson.id) {
      entry = lessons.find((l) => l.id === lesson.id);
    }
    if (entry) {
      entry.text = text;
      entry.tags = tags;
      entry.updated = now;
    } else {
      entry = { id: `l-${now}-${Math.random().toString(36).slice(2, 8)}`, text, tags, created: now, updated: now };
      lessons.push(entry);
    }
    // FIFO eviction beyond cap (oldest first)
    while (lessons.length > LESSONS_MAX_COUNT) {
      let oldest = 0;
      for (let i = 1; i < lessons.length; i++) if ((lessons[i].created || 0) < (lessons[oldest].created || 0)) oldest = i;
      lessons.splice(oldest, 1);
    }
    writeJson(lessonsPath, { version: 1, lessons });
    return { id: entry.id, text: entry.text, tags: entry.tags };
  }

  function recall(query, opts) {
    const k = Math.max(1, Math.min(20, (opts && opts.k) || 5));
    const kind = (opts && opts.kind) || "all";
    const qTokens = tokenize(query);
    const out = {};
    if (kind === "all" || kind === "trajectories") {
      out.trajectories = readTrajectories()
        .map((t) => ({ t, score: keywordScore(qTokens, `${t.prompt_summary || ""} ${t.taskType || ""} ${t.model || ""}`) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || (b.t.ts || 0) - (a.t.ts || 0))
        .slice(0, k)
        .map((x) => ({ ...x.t, score: Math.round(x.score * 100) / 100 }));
    }
    if (kind === "all" || kind === "lessons") {
      out.lessons = readLessons().lessons
        .map((l) => ({ l, score: keywordScore(qTokens, `${l.text || ""} ${(l.tags || []).join(" ")}`) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || (b.l.updated || 0) - (a.l.updated || 0))
        .slice(0, k)
        .map((x) => ({ id: x.l.id, text: x.l.text, tags: x.l.tags || [], score: Math.round(x.score * 100) / 100 }));
    }
    return { query, k, kind, ...out };
  }

  function relevantLessons(text, k) {
    const kk = Math.max(1, Math.min(10, k || 3));
    const qTokens = tokenize(text);
    if (!qTokens.length) return [];
    return readLessons().lessons
      .map((l) => ({ l, score: keywordScore(qTokens, `${l.text || ""} ${(l.tags || []).join(" ")}`) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, kk)
      .map((x) => ({ id: x.l.id, text: x.l.text, tags: x.l.tags || [] }));
  }

  function modelBias(taskType) {
    const stats = readStats();
    const out = {};
    for (const [key, v] of Object.entries(stats.entries || {})) {
      const [tt, ...rest] = key.split("|");
      if (tt !== String(taskType || "")) continue;
      const model = rest.join("|");
      if (!model) continue;
      out[model] = Number.isFinite(v.score) ? v.score : 0.5;
    }
    return out;
  }

  function statsSnapshot() {
    return readStats();
  }

  return { dir, recordFeedback, upsertLesson, recall, relevantLessons, modelBias, applyMemoryBiasFor: (ranked, taskType) => applyMemoryBias(ranked, modelBias(taskType)), statsSnapshot };
}

module.exports = {
  createMemoryStore,
  cwdHash,
  tokenize,
  keywordScore,
  ewmaUpdate,
  applyMemoryBias,
  LESSON_MAX_CHARS,
  LESSONS_MAX_COUNT,
  EWMA_ALPHA,
  EWMA_MAX_DELTA,
};
