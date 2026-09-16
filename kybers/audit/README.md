# `audit` — an audit team whose findings survive refutation

Five specialist agents that audit a repository, a service or a process and hand back findings that **survive an adversary**, then a written report. Every
finding carries a `file:line` anchor and a command that reproduces the defect: the value is a short list of defects someone tried hard to destroy and could not,
plus a report a stranger can act on. The team fixes nothing, deploys nothing, writes no product documentation.

```
mapping (once)       findings (forEach, cap 6)            refutation (once)      report (once)
cartographer    →    code-auditor × security-auditor  →  refuter  [GATE]   →    reporter
```

`topology: adversarial`: the refuter runs *after* the findings and receives them as `inputs` — that dependency, not the declaration, is what makes it a refuter.

## Roles

| id | specialty (`role:`) | needs | provider / model |
|---|---|---|---|
| `cartographer` | `scout` | fast | `ollama-cloud` / `deepseek-v4.1-flash` |
| `code-auditor` | `auditor` | balanced | `zai-coding-cn` / `glm-5.3` |
| `security-auditor` | `security-auditor` | deep | `ollama-cloud` / `glm-5.3` |
| `refuter` | `checker` | deep | `ollama-cloud` / `kimi-k3` |
| `reporter` | `presenter` | balanced | `zai-coding-cn` / `GLM-5.3-Flash` |

`needs` is a portable preference (`text`, `standard`), resolved at install time against your real models; the refuter carries `checker`, not `auditor`, because
`kyber-memory` keys its learned score on the role `id`. No connectors (`tools: []`).

## The adversary, and what falls

Per finding the refuter actively tries to break it: anchor that does not resolve, a reproduction command that *passes* (so it discriminates nothing), a case
impossible in practice, an upstream protection, a known false positive. Its only material is the anchor, the reproduction command and the audited artefact —
never the auditor's reasoning. Fail-closed: no anchor, non-executable or non-reproducible command, passing command → `refuted`; there is no implicit pass.

Verdicts are `confirmed` | `weakened` | `refuted`, each refutation tagged `dead-anchor`, `passing-repro`, `false-premise` or `upstream-protection`; above a
third refuted, the refuter says so at the head of its verdict.

**Nothing is deleted.** Refuted findings leave the body and are gathered under `## Appendix`, one entry each with the reason for its refutation — the definition
of done fails both if one is missing there and if one is cited in the body.

## Use it — and don't

Use it when findings must not be arguable away: a release gate, a due diligence, a security posture you have to state in writing. One run per surface, not
continuously.

Not to fix anything (read-only, checked by an empty `git status --porcelain`), not as a style review (out of scope), not for pentest-grade work (no destructive
load, no out-of-scope target), not for judgement-type findings (see Limits), and not when the scope must be settled *with you before* the run starts:
`elucidation: none` is deliberate — the scope is declared by `mapping` and contested by `refutation`.

## Install

Full block and variants (local folder, publishing your own): [`../INSTALL-PROMPT.md`](../INSTALL-PROMPT.md). Validate first: `node kybers/lint.cjs
--dir=$PWD/kybers audit` → `PASS audit`. One line, for a chat message or a report footer:

```text
Install the kyber "audit": https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/audit/kyber.yml — procedure: https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/INSTALL-PROMPT.md — read the spec in full, show me every role prompt IN FULL and the role → model table before writing anything, then wait for my confirmation.
```

## Limits specific to this kyber (read out of its own comments)

- **Two rules of one doctrine, and the format forced a choice.** The file is categorical: *"DoD by COMMAND, never prose — a DoD not verifiable by command is not
  a DoD."* Yet the doctrine underneath has **two levels** — must-pass (machine-checkable) and advisory (human judgement) — and the format gives one flat list.
  So must-pass became the eight commands, and the advisory level was demoted to prompt prose, the very form the field exists to fight.
- **A reproduction command is mandatory, which demotes judgement-type findings.** Commands #4/#5 demand a non-empty `repro` *and* that it FAIL on the current
  tree, so "this design is risky" or "this is undocumented" is not weakened but excluded.
- **Two structural gaps, left open.** The first stage cannot be gated (the lint refuses a gate without `inputs`, and a first stage has nothing to receive), so
  only the declared dependency `findings ← mapping` holds the downstream. And no field declares the run layout or the `bash`/`jq`/`git` the commands need.

## Has this been run?

**Not end-to-end — not this file.** An **earlier, shorter version** of this same kyber *did* run for real on one platform (DSH): 4 roles, no technical failure,
one finding refuted and then moved to the appendix. This version's eight translated `definitionOfDone` commands were run against a healthy fixture, and each
failed on perturbation — findings still keyed `ancre`/`severite`/`elevee`, or a report using `## Annexe`, now fail.
