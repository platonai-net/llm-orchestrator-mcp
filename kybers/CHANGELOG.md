# CHANGELOG — kybernos spec

Log of changes to the **format** and to the normative documents. Any modification of
`CONVENTION.md`, `INSTALL.md`, `INSTALL-PROMPT.md` or `lint.cjs` MUST appear here —
including a wording fix.

An installer that pins a commit (`INSTALL.md` §0) must be able to read what changed
between that commit and today. That is the counterpart of the requirement we impose on
kybers.

## SPEC-VERSION 2 — 2026-09-16

**Breaking.** Five fields that change behavior at execution have been added; a
consumer that ignores them produces a different result without reporting it. Rationale:
the orchestration doctrine of the `kybernos` project (`kybernos-parallel`,
`kybernos-delegation`) contains five mechanisms that the v1 format had no way to
express.

### Added — at the kyber level

- `elucidation: none | required` — the orchestrator MUST interview the human before
  composing the team. Taken from the "HARD MANDATE: interview first" of the domain
  templates, which never launch agents on assumptions.
- `maxDepth: 0 | 1` — recursion guard. `depth >= 2` forbidden: beyond that, nobody
  knows any more who launched what, nor whom to blame for a failure.

### Added — at the level of a stage

- `cap: <integer >= 1>` — ceiling on simultaneous agents. Taken from the hard cap of 6.
- `gate: true` — nothing downstream leaves before this stage validates. Taken from
  "zero speculative launch pre-GO". Requires a downstream stage that cites it in its
  `inputs`; an entry stage MAY carry a gate (warning only), and so may a terminal
  stage. Note that no platform primitive enforces a gate — it is declared intent.
- `definitionOfDone: [<commands>]` — "a DoD not verifiable by command is not a DoD".
  Taken from the delegation contract.

### Added — provenance

- `provenance.author` **mandatory** as soon as `origin: repository` (attribution, §10).
- `provenance.installHint` — the line that lets the reader of a deliverable install the
  kyber that produced it. Closes the viral loop.

### Added — convention

- Prefix `kybernos-contrib-<name>` for third-party kybers (precedent
  `node-red-contrib-*`). `kybernos.app-contrib-<name>` remains **rejected**: the dot
  breaks the `q=kybernos- in:name` query.
- `contrib-` is a **publication** marker, never a part of the `id`.
- Reserved names: 25 entries, refused by the validator.
- `lessons.jsonl` **publishable**; `ledger.jsonl` and `routing.local.json` **never**.

### Fixed — my own mistakes

- **"Adding an optional field is not a breaking change" was false.** The criterion is
  not *mandatory or optional*, it is: *does a consumer that ignores this field produce
  a different result?* `gate: true` ignored makes the next stage depart without waiting
  for validation. Hence the version break.
- **"Renaming breaks `provenance.url`s" was false.** GitHub redirects renamed
  repositories too, not only transferred ones.
- **`adversarial: true` outside `topology: adversarial` is no longer refused.** A
  pipeline legitimately contains a review that refutes the implementer. Refused only
  under `pool`.
- **`role` and `specialty` separated** in the ledger. Confusing them merged `auditeur`
  and `verificateur`, two opposed trades, under a single key.
- **`tools:` is a declaration, not a provision.** Only the preset owns the tools.

### Added — memory (`kyber-memory`)

Five mechanisms taken from `ruflo`, each fixing an observed defect:

- **Decay** (`decayPerHour`, to be computed **on read**) — a score learned once does
  not stay true.
- **`attempts` in the ledger** — a success after a retry is not a clean success.
  Observed: a line said `success` while the same run had weathered two schema
  rejections.
- **Purge of reasoning** — no reflection text in memory.
- **Lesson lifecycle** (`uses`, `lastUsed`) — eviction by real usefulness, no longer by
  age.
- **Thresholded inter-kyber transfer** (`uses >= 3`) — replaces an overly coarse
  prohibition.

### Fixed after a real installation test — 13 failures observed

An installer actually executed `INSTALL-PROMPT.md`, on an isolated target, and
documented thirteen failures. The corrections that follow from them:

- **`INSTALL.md` §0: the `provenance` example was refused by the very validator §0
  designates** — `author` was missing. The rule had been added to the linter and to
  `CONVENTION.md` §10, but the example had stayed wrong. *Hard defect, re-tested three
  times by the installer.*
- **§0: the mandatory review covered only `prompt:`, not `skills:`.** A skill is the
  same material — natural language addressed to a tooled agent — and the kyber gets its
  most executable code from it. A partial review let half the attack surface through.
  The refusal criteria cover both.
- **§0: the case "local installation with no human" was not settled.** The confirmation
  rule was unconditional and its only nuance spoke of the remote case. Replaced by an
  explicit table, asymmetric by origin.
- **§1: the `role:` field (specialty) was not documented**, whereas `kyber-memory`
  bases its learning key on the `id`. Removing it **merges `auditeur` and
  `verificateur` into a single routing arm** — the bug that the memory documents as
  having already happened. Added, with the reason.
- **§1: the format block was presented without reference to the source of truth.** An
  installer who read only that summary produced a kyber amputated of `cap`, `gate` and
  `definitionOfDone` — the entire doctrine — without any check reporting it. The block
  is now explicitly a summary; `lint.cjs` is authoritative.
- **§2 point 5: "degradation" was defined as "unsatisfied hard requirement"**, and
  **none** of the four degradations actually observed was one: unresolved `tier`,
  learned memory not carried over (six observations lost), skills resolved only under
  the `kyber` preset whereas the default is `cordis`, missing `README`/`LICENSE`.
  Redefined into three categories.
- **§3 Phase 2:** the local installation prompt referenced a workshop folder, which
  `CONVENTION.md` §8 forbids. Reworded.
- **`provenance.sourcePath` added**: a local kyber could not record where it came from
  — the closed list refused the field, and the installer had only two bad options,
  invent a field or note nothing.
- **`CONVENTION.md`: a hard-coded DSH path** had leaked into the normative text, whereas
  `INSTALL.md` §0 promises a spec with no platform path.
- **`lint.cjs` accepts `--dir=`**: an installer could not validate the copy it had just
  written. It had to build a harness of symbolic links in `/tmp` to check its own work.
- **`CONVENTION.md`: the spec now applies to itself** `SPEC-VERSION` and a `CHANGELOG`.
  It imposed on kybers a grammar version and a pinned commit without applying either to
  its own text.

**The underlying defect, and it is one of method.** During the test run, these documents
were rewritten four times: `CONVENTION.md` from 181 to 405 lines, `lint.cjs` in five
versions, `INSTALL.md` in two states — and **at one point `lint.cjs` was broken**
(`ReferenceError: STAGE_FIELDS is not defined`, then a duplicate `const PRESET_SKILLS`),
because I was writing a check before the constant it uses **without running the
validator between my modifications**. I verified at the end, not between the steps. **A
validator is run after every change, not after the series.**

### Not taken from `ruflo`, and why

- **EWC++** — for fine-tuning neural networks. We do not do that.
- **HNSW / quantisation / rerank** — scale infrastructure. Measurable trigger before
  adoption: `lessons.jsonl` > ~500 lines, or `ledger.jsonl` > ~5,000.
- **`@ruvector/emergent-time`, PageHinkley, LearnedWeights** — their own ADR cites the
  dependency's README: *"no proven early-warning lead over a fair baseline"*, and
  freezes them behind a feature flag.

---

## SPEC-VERSION 1 — 2026-09-16

Initial version. `kyber.yml` format: `id`, `mission`, `topology`, `stages`,
`roles` (with `needs`, `provider`, `model`, `prompt`), `memory`, `skills`, `tools`.
Topologies `pool`, `pipeline`, `adversarial`, `mapreduce`, `loop`; modes `once`,
`forEach`, `untilConverged`. Validator `lint.cjs`; installation by an agent
(`INSTALL.md`); naming convention (`CONVENTION.md`).
