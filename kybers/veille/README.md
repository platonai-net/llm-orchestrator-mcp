# `veille` — a watch team that interviews you before composing anything

`veille` monitors a domain you name, detects what materially changed, and writes a dated,
cited digest that separates signal from noise. It is a `kyber.yml` — a declarative spec for a
team of specialist agents, installed on any platform. The interview happens **before the
workflow starts**, in conversation with the orchestrator: nothing is composed before you
answer it.

## Shape

```text
framing (once)              records the interview → $RUN/framing.md, the watchlist the next stage iterates
collection (forEach, cap 6) one agent per confirmed source — official / weak signals
triage (once, gate)         N bulletins → one ranked list: signal | watch | noise
synthesis (once)            $RUN/digest.md — Signal / Watch / Discarded, all cited
```

| role id | specialty (`role:`) | model as authored (resolved at install) | job |
|---|---|---|---|
| `framer` | `business-analyst` | `zai-coding-cn/glm-5.3` | records the ten answers as the watchlist (the interview itself happens before the run) |
| `official-collector` | `scout` | `ollama-cloud/deepseek-v4.1-flash` | one official source: dated facts + receipt |
| `weak-signal-collector` | `scout` | `ollama-cloud/glm-5.3-flash` | one weak-signal source: reviews, forums, social |
| `signal-analyst` | `analyst` | `ollama-cloud/kimi-k3` | triage; collects nothing, writes nothing |
| `synthesizer` | `presenter` | `ollama-cloud/glm-5.3` | writes the digest; re-ranks nothing |

## Use it when / not when

Use it to monitor a domain you can already name, on a cadence, when the digest must cite
every claim and name what it discarded: moves, prices, launches, hiring, filings.

Do not use it for one-off research (the deliverable is a file, not an answer), for real-time
alerting (the shape is a batch cycle), or when you cannot name sources and cadence —
`elucidation: required` makes the interview mandatory, and nothing lets the agent decide what
to watch for you. It also wires no connectors (`tools: []` is deliberate).

## The elucidation mechanic

This kyber is the repo's clearest case of `elucidation: required`: the interview is
load-bearing, not ceremonial. `framing` has no `inputs`, and in a `mapreduce` shape the entry
stage is exactly what produces the list the next stage iterates — the ten answers *are* the
watchlist. Without them `collection` has nothing to walk and the fan-out has no size.

**Where the interview has to happen: before the workflow starts, in conversation.** No
workflow script can pause to ask a human anything — a fan-out script's globals are exactly the
launch primitives (`agent`, `parallel`, `pipeline`), progress narration (`phase`, `log`) and
the immutable `args`, with no `escalate`, `abortWorkflow` or `requestApproval` — and a role
inside a stage runs as a subagent with no channel to the human. So the orchestrator, **not the
`framer` role**, MUST put the ten questions to the human before it launches the script, and
write the answers to a file the first stage reads. That is what `elucidation: required` has to
mean here: nothing enforces it mid-run, and `lint.cjs` only checks the enum value.

The concrete contract this kyber invented: the ten questions live in the `framer` prompt (the
only executable place the format offers), and the answers are pinned to `$RUN/framing.md` —
one `Q<n>:` line per question, one `R<n>:` line per answer received, then `SOURCE: <url>` per
confirmed source and `ALERT-LEVEL: <what triggers an alert>` — checkable in the `framing` DoD.
The `framing` stage reads the answers already collected and structures them; it does not, and
cannot, interrogate anyone. "No collection before the interview" is declared as `gate: true` on
`framing` itself: an entry stage *may* carry a gate — an earlier revision of this kyber said
otherwise and cited a `lint.cjs` message that does not exist — the validator emits only a
warning for that position, and no platform primitive enforces it. The gate is declared intent,
not a constraint.

**The failure this pattern still permits.** In the one real end-to-end run of this kyber the
script was launched with no interview at all: the answers were authored by the orchestrator,
2 of the 10 `R<n>:` lines literally read `OPEN — no answer received`, and the `framing` DoD
still passed 4/4. The file contract makes the interview *recordable*, not *enforced*; only the
orchestrator's discipline does that.

## Install

Paste [`INSTALL-PROMPT.md`](../INSTALL-PROMPT.md)'s prompt, pointed at this kyber:

```text
Install the kyber "veille" from https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/veille/kyber.yml
Follow INSTALL.md §0–§5 from .../kybers/: inspect my tool, resolve each role's `needs`,
show me every prompt in full, and wait for my confirmation.
```

## Known limitations, specific to this kyber

- **"What changed since the last cycle" has nowhere to live.** The template this kyber derives
  from requires tracking it, and the digest must be a file precisely so it can be compared with
  the previous one — but `memory:` stores routing scores keyed (kyber, id, provider, model), not
  domain observations. Nothing holds last cycle's prices, so the comparison depends on the
  operator keeping old runs around.
- **The interview is verifiable; its quality is not** — the DoD proves ten answers were written
  down, not that a human gave them nor that they were understood, and **no business skill ships
  with it**: which sources to watch, and how often, lives only in the `framer` prompt.
- **Two collectors share one stage** (a role `id` can be reached by one stage only), so routing
  a source to official or weak-signal is the orchestrator's judgement; and 15 DoD commands pin
  the artifact contract (`$RUN/framing.md`, `$RUN/collection/*.json|.fetch`,
  `$RUN/triage.jsonl`, `$RUN/digest.md`).

## Verification

Its 15 `definitionOfDone` commands **have been exercised against fixtures** in a simulated run
directory: each passes on a complete run and fails when the artifact it guards is removed or
mutated (including reverting a translated marker).

The kyber has since been **run end-to-end once, on a real subject** (which Node.js release lines
are supported as of 2026-09-16). All four stages executed, all five roles returned, all 15 DoD
commands passed, and the digest was independently fact-checked as accurate. That run also
produced the finding that matters most for reading this file: **the DoD verifies the form of a
contract, never its truth.** The framing DoD counts `R<n>:` lines, so it passed 4/4 while no
human was ever interrogated — the answers came from the orchestrator, and 2 of 10 were
transcribed `OPEN — no answer received`. The collection DoD greps `^200 ` and counts files, so it
passed while only 3 of 7 receipt sha256 values reproduced on independent re-fetch. A receipt and
an interview are self-attested; nothing cross-checks either.
