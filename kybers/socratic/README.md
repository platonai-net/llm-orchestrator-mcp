# socratic — the team that never gives you the answer

A **kyber**: a declarative YAML spec that a generic agent installs as a team of specialist agents.
This one never gives you the answer — it questions your premises, restates your position in its
strongest form, then sets an advocate and a prosecutor against it. **The deliverable is a
better-formed thought, not an artifact**: no stage writes a file, no role decides, and a run ends
with a set of questions addressed to you. `pipeline` · `elucidation: required` · `maxDepth: 1` ·
`tools: []` (no connectors: the corpus is what you say).

## Stages and roles

**Flow:** `elucidation [GATE] → reformulation [GATE] → refutation (cap 2) → handback`

| stage | id | specialty (`role:`) | model |
|---|---|---|---|
| `elucidation` *(entry gate)* | `questioner` | `interviewer` | `ollama-cloud` · `deepseek-v4.1-flash` |
| `reformulation` *(mid gate)* | `restater` | `reformulator` | `ollama-cloud` · `glm-5.3` |
| `refutation` *(cap 2, same input)* | `advocate` | `advocate` | `zai-coding-cn` · `glm-5.3` |
| `refutation` | `prosecutor` | `prosecutor` | `ollama-cloud` · `kimi-k3` |
| `handback` | `renderer` | `facilitator` | `ollama-cloud` · `glm-5.3-flash` |

Model names are *requirements* (`needs: { tier: … }`) the installer resolves against your platform,
not guarantees. The questioner ends with its most useful question framed by `<relance>...</relance>`
— a token kept verbatim: it delimits an output segment a caller may extract, not prose to read.

## When to use it — and when it is the wrong tool

**Use it** when you hold a position and want to know how well it holds: a decision you are about to
make, a belief you never had to defend, a rationale resting on a premise you never stated.

**Do not use it** if you want an answer, a recommendation or a document: it will frustrate you. No
role may conclude, the prosecutor is paid to attack your thesis, and the last word is a question
addressed to you. That is the point, not a defect. For an artifact, use `dev-team`.

## Two gates, two different jobs

- **Entry gate** (`elucidation`): nothing proceeds before you have answered — an entry stage has no
  `inputs` by definition, so it guards the human, not an upstream artifact.
- **Mid gate** (`reformulation`): no camp fights a thesis not first restated in its strongest form —
  *"a thesis attacked before it is understood is a straw man, and a straw man teaches nobody
  anything."*

## There is no definition of done — deliberately

No stage declares `definitionOfDone`, and that is an observation, not an oversight: the completion
criterion lives in a person's head — *does the user still hold their thesis, and for the same
reasons?* — not in a file, and not in a command's output. The workarounds were rejected as
dishonest: `grep -c '?' <output>` verifies a question mark is present, not that no conclusion was
drawn ("so your thesis is false, no?" passes), and fabricating a questions file purely to have
something to measure would manufacture the very artifact this kyber refuses.

**Consequence, stated openly: nothing mechanically verifies that a run of this kyber succeeded.**
`lint.cjs` raises it as a warning, not an error — a non-artifact deliverable may legitimately have
no DoD, but it must never be silent about it, and neither is this README.

## Install

Paste the block below into any agent with file access: it reads the spec, shows every role prompt
before writing, and asks for confirmation. Variants (local folder, publish your own) are in
[`../INSTALL-PROMPT.md`](../INSTALL-PROMPT.md).

```text
Install the kyber "socratic": https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/socratic/kyber.yml
Read https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/INSTALL.md and CONVENTION.md before acting.
```

## Has it been run?

**No.** No stage of this kyber, and no role in it, has ever executed end-to-end on any platform. The
spec validates — `lint.cjs` prints `PASS socratic`, 2 warnings, 0 errors — but its behaviour is
unverified. Read the role prompts and the model assignments as design, not as measured results.
