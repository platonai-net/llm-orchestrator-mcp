# Kybers — portable agent teams

A **kyber** is a team of specialist agents with a shape: roles, a topology, model
requirements, and a memory loop. It is a `kyber.yml` file — not a program.

The point: **it installs by pasting a prompt** into any tool that has file access
(Cursor, Opencode, DSH, Claude Code…). No package, no runtime, no account. The agent
that receives the prompt discovers its own tool's architecture, resolves the model
requirements against what you actually have, and asks you for confirmation before
writing.

## The four kybers

| Kyber | Shape | What it does |
|---|---|---|
| **`dev-team`** | `pipeline`, 8 stages | A full software team: map → frame → spec → **gate** → implement → test → **adversarial review** → deliver. Cap of 6 parallel agents, executable DoDs, zero speculative launch before GO. |
| **`audit`** | `adversarial`, 4 stages | Map → findings (iterated, cap 6) → **refutation** → report. Its value: findings that survive refutation, and the ones that fall go to an appendix instead of being erased. |
| **`veille`** | `mapreduce`, 4 stages | **Interviews you first** (10 questions, mandatory), then collects from official sources *and* weak signals, separates signal from noise, writes a dated and cited digest. |
| **`socratic`** | `pipeline`, 4 stages | **Never** gives the answer. Questions, restates, then sets an advocate and a prosecutor against your own thesis. The deliverable is a better-formed thought, not an artifact. |

## Install

Copy this block into your agent:

```text
Install the kyber "dev-team" into my tool.

General spec : https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/INSTALL.md
               https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/CONVENTION.md
Kyber source : https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/dev-team/kyber.yml
               → read INSTALL.md AND CONVENTION.md in full before acting.
If you cannot read the spec, STOP and say so. Do not guess the format.

Apply INSTALL.md §0 to §5. You must, in this order:

1. Discover MY tool's architecture — where agents, skills, connectors and memory
   live — BY INSPECTING. No guessing, no relying on memory.
2. Resolve each role's `needs` against the models I ACTUALLY have, and show me the
   role → model table.
3. Show me BEFORE WRITING ANYTHING: every role `prompt:` IN FULL, every skill IN
   FULL, the resolution table, and the fate of each topology stage.
4. Get my explicit confirmation. No automatic install.
5. Write `provenance` with the URL and the COMMIT — never a branch.
6. Tell me at the end what you installed, and what you DEGRADED.
```

Replace `dev-team` with `audit`, `veille` or `socratic`. The local variant and the
"publish my kyber" variant are in [`INSTALL-PROMPT.md`](INSTALL-PROMPT.md).

> **Why show the prompts in full?** A kyber is not configuration, it is **natural
> language addressed to a tooled agent**. It can contain anything. `INSTALL.md` §0
> requires showing everything before writing, and refusing outright any content that
> exfiltrates, executes remotely or bypasses validations.

## Validate

```bash
node kybers/lint.cjs --dir=$PWD/kybers          # all of them
node kybers/lint.cjs --dir=$PWD/kybers dev-team # a single one
```

The validator checks the file's internal consistency: `id` = folder, spec version,
reachable roles, absence of cycles, gate placement (entry and terminal gates are both
legal, and each draws a warning), `definitionOfDone` non-empty, reserved names, and —
if it finds a `.probe.json` — the state of the declared models. With a probe file it
keeps three states distinct: probed and answering (`OK`), probed and silent
(`INDISPONIBLE`), and **never probed** (`DÉCLARÉ` — declared is not served, so it is
never reported as working).

**What it does not guarantee**: that execution respects the file. It validates a text,
not a behavior.

**And a green `definitionOfDone` proves the form of the contract, never its truth.**
The commands check that files exist, markers are present, counts match and a status
line reads `200`; they cannot check that the content is true, that a human was
interviewed, or that a receipt `200 <sha256> …` attests a real fetch rather than
asserting one. Observed in the one real end-to-end run of `veille`: 15/15 commands
passed while no human was ever interviewed (2 of 10 answer lines read
`OPEN — no answer received`) and only 3 of 7 collection receipts reproduced their
`sha256` on independent re-fetch. A `PASS` is a filter on shape, not evidence of
content.

## Credit

The role prompts, the parallelism doctrine (hard `cap` of 6, zero speculative launch
before GO, definition of done verifiable by command, recursion guard) and the domain
templates are **adapted from the internal `kybernos` project** — translated,
condensed, and copied into each file rather than linked.

**Why no link**: the source repository is not public as of today, so a URL would return
404. A credit that does not resolve is worse than no credit — the reader cannot verify
the origin, and it looks like a claim floating in the air. The link will be restored if
the source is published.

## Known limits of the format

Four kybers written independently converged on the same gaps. They are real and
uncorrected — keeping quiet about them would be worse than documenting them.

> ### How these limits were found
>
> The four kybers were written **by separate agents, without seeing each other**,
> starting from the same format and the same doctrine. Three of them ran into
> **independently** on exactly the same defects:
>
> | Defect | `dev-team` | `veille` | `audit` | `socratic` |
> |---|:---:|:---:|:---:|:---:|
> | A gate cannot guard the entry point | ✓ | ✓ | ✓ | ✓ |
> | `inputs` only knows how to add, never remove | ✓ | | ✓ | |
> | Two-level DoD with nowhere to live | ✓ | | ✓ | ✓ |
> | No stop or escalation mechanism | ✓ | | ✓ | |
> | `role:` not checked by the validator | ✓ | ✓ | ✓ | |
> | Artifact contract left to be invented | ✓ | ✓ | ✓ | |
>
> **Four agents out of four** ran into the entry-point gate, and each reacted
> differently — one moved the gate, another killed it, two documented it as a
> renunciation. None invented a field. That is what made it possible to decide between
> "the format is right and the author is wrong" and "the format is wrong": when four
> independent readers hit the same wall, it is the wall.
>
> The entry-point gate and the unchecked `role:` in that table are **fixed since**:
> `lint.cjs` now legalises an entry-stage gate and emits only a warning, and it now
> validates `role:`. The `inputs` subtraction, the two-level DoD, escalation and the
> artifact contract remain open.

| Limit | Consequence |
|---|---|
| **No back edge** | The doctrine's ternary verdict (GO / **AMEND** / NO-GO), where AMEND sends the work backwards, is inexpressible: `inputs` can only cite an earlier stage. The correction loop exists only in prose. |
| **`inputs` only knows how to add** | The invariant that founds adversarial review — "never receive the implementer's account, judge on the spec and the diff" — is a **subtraction** of context. `inputs` does not know how to remove. |
| **A gate is intent, not enforcement** | The production gate ("nothing leaves without human validation") is the last one, and `lint.cjs` accepts it: entry and terminal gates are both legal and each draws only a warning. But no platform primitive makes a downstream stage wait — `gate: true` records a doctrine the orchestrator must honour; it cannot make it. |
| **Single-level DoD** | The doctrine distinguishes `must-pass` and `advisory` (human criteria). The format has only a flat list, so the advisory ends up in prose — exactly the non-verifiable form the field fights. |
| **`elucidation` is read by nothing** | The field says *that* the human must be interviewed, never **what** to ask nor **where** to put the answers, and no skill reads it. It also cannot be enforced mid-run: a fan-out script's globals are only launch primitives, progress narration and the immutable `args` — no pause, escalate, abort or approval primitive exists — so the interview MUST happen in conversation **before** the workflow starts, with the answers written to a file the first stage reads. An orchestrator that skips it composes on assumptions, **does not report it**, and the DoD still passes. |
| **`cap` has no settled semantics** | Quota per wave or ceiling in flight? Two readings, two behaviors. The saturation circuit breaker (cap 6 → 3 after errors) requires a **variable** ceiling, which the field does not accept. |
| **No artifact contract** | No field says where a stage writes its outputs. Two kybers invented `$RUN/…` separately, with different conventions. That is their main fragility. |
| **No inter-run state** | `memory:` carries only routing scores. "What has changed since the last cycle" — the heart of a veille — has nowhere to be stored. |
| **No resource envelope** | The doctrine imposes a budget in minutes per contract, with per-role ceilings. Nothing declarable; `maxDepth` bounds the cascade, not the cost. |
| **No stop or escalation mechanism** | This is the most serious gap. The doctrine defines a circuit breaker ("> 30% of tasks blocked → stop the run + human escalation") and an escalation chain with observed triggers (same error signature 2×, 3 attempts without progress). No field allows **stopping a run or consulting the human while it runs** — `elucidation` interviews *before* composing, never during. A real kyber had to degrade the rule into a mere mention in the report: the "move on to the next one" and the escalation disappeared. **Every rule that prevents looping indefinitely lands here.** |
| **Binary dependencies are declarable nowhere** | Real `definitionOfDone`s rely on `jq` and `git`. `tools:` serves connectors, not executables: nothing says that a stage refuses to run without `jq`, nor where to declare it. A DoD can therefore be inapplicable on the target machine **without anything reporting it at installation**. |

## Verification status

The four files pass `lint.cjs`. `audit` and `veille` have in addition **exercised their
`definitionOfDone`s against fixtures** — 23 commands in total (8 + 15), each verified as
discriminating (source absent → failure, polluted tree → failure, refuted finding cited
in the body → failure).

**None of the four has been executed end to end** in the sense of `INSTALL.md` §2.4. An
earlier version of `audit` did actually run on DSH (4 roles, 0 technical failure, one
finding refuted and then set aside in an appendix), but not these files.
