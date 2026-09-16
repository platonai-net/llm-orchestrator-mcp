# `veille` — a watch team that interviews you before composing anything

`veille` monitors a domain you name, detects what materially changed, and writes a dated,
cited digest that separates signal from noise. It is a `kyber.yml` — a declarative spec for a
team of specialist agents, installed on any platform. Stage 0 is an interview, not a
preamble: nothing is composed before you answer it.

## Shape

```text
framing (once)              interview → $RUN/framing.md, the watchlist the next stage iterates
collection (forEach, cap 6) one agent per confirmed source — official / weak signals
triage (once, gate)         N bulletins → one ranked list: signal | watch | noise
synthesis (once)            $RUN/digest.md — Signal / Watch / Discarded, all cited
```

| role id | specialty (`role:`) | model as authored (resolved at install) | job |
|---|---|---|---|
| `framer` | `business-analyst` | `zai-coding-cn/glm-5.3` | asks the ten questions, writes the watchlist |
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

The format can express neither *what* to ask nor *where* the answers go, so the author
invented the contract: ten questions in the `framer` prompt (the only executable place), and
answers pinned to `$RUN/framing.md` — one `Q<n>:` line per question, one `R<n>:` line per
answer received, then `SOURCE: <url>` per confirmed source and `ALERT-LEVEL: <what triggers
an alert>` — checkable in the `framing` DoD. "No collection before the interview" is declared
as `gate: true` on `framing` itself. An entry stage *may* carry a gate; an earlier revision of
this kyber said otherwise and cited a `lint.cjs` message that does not exist. The gate is
declared, but no platform primitive enforces it — it is intent, not a constraint.

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
  down, not that they were understood, and **no business skill ships with it**: which sources
  to watch, and how often, lives only in the `framer` prompt.
- **Two collectors share one stage** (a role `id` can be reached by one stage only), so routing
  a source to official or weak-signal is the orchestrator's judgement; and 15 DoD commands pin
  the artifact contract (`$RUN/framing.md`, `$RUN/collection/*.json|.fetch`,
  `$RUN/triage.jsonl`, `$RUN/digest.md`).

## Verification

Its 15 `definitionOfDone` commands **have been exercised against fixtures** in a simulated run
directory: each passes on a complete run and fails when the artifact it guards is removed or
mutated (including reverting a translated marker). **No role of this kyber has ever run
end-to-end** — no agent was executed here, so this shows the criteria are machine-checkable,
not that the team writes a good digest.
