# dev-team — a complete software development team

`dev-team` is a portable team of 9 specialist agents covering a software request end to end: mapping,
framing into disjoint batches, specification, an explicit **GO gate**, bounded parallel implementation,
user-journey testing, adversarial review, and delivery whose "done" is proven by command. It is a
declarative file (`kyber.yml`), not a program.

## Shape

`topology: pipeline`, 8 stages, `elucidation: required` (it interviews you **before** composing itself),
`maxDepth: 1` (no subagent re-delegates). `id` and `role` keep the author's kebab-case keys —
identifiers, not prose (they appear in `stages[].roles`, `inputs`, and the memory key
`kyber|role|provider|model`). Every other word of the file is English.

```
cartographie → cadrage → specification → ┃porte-spec┃ → implementation → test → revue-adversariale → livraison
 map, once     frame, once  spec, ×N, cap 6    GATE, once    impl, ×N, cap 6     once    adversarial, once    once
```

The gate hands implementation **exactly** the specs it let through: the second fan-out iterates the gate's
output, not the framing's.

## Roles

| `id` | `role:` | resolved model | job |
|---|---|---|---|
| `cartographe` | `scout` | `ollama-cloud/deepseek-v4.1-flash` | read-only map: batches, file perimeters, verbatim `file:line` anchors |
| `orchestrateur` | `orchestrator` | `ollama-cloud/kimi-k3` | cuts disjoint batches, writes delegation contracts, announces parallelism |
| `redacteur-spec` | `spec-writer` | `ollama-cloud/glm-5.3` | one spec per batch: criteria, `OUT OF SCOPE`, lane A/B, executable DoD |
| `validateur-spec` | `checker` | `zai-coding-cn/glm-5.3` | **the gate**: anchors must resolve, DoD must discriminate; `GO \| AMEND \| NO-GO` + blame tag |
| `implementeur` | `coder` | `ollama-cloud/glm-5.3` | one validated batch → one surgical diff, after capturing the DoD failing |
| `implementeur-expert` | `coder-security` | `zai-coding-cn/glm-5.3` | critical batches (auth, RLS, secrets, billing, migrations), fail-closed |
| `testeur` | `tester` | `zai-coding-cn/GLM-5.3-Flash` | user journeys and design checks; requires `modality: image` |
| `verificateur` | `checker` | `ollama-cloud/kimi-k3` | adversarial review of the merged diff: six points, `BLOCK` + `BLAME` |
| `livreur` | `integrator` | `ollama-cloud/glm-5.3` | wrap-up, debt, git lifecycle, `DoD-Verified` evidence |

`provider`/`model` is this platform's resolution; `needs` (`modality`/`tier`/`context`) is the portable
requirement your installer resolves against your own models.

## The rules that make it work

- **`cap: 6`** on each fan-out: parallelism is bounded where it is declared.
- **`gate: true`** on `porte-spec`: nothing downstream starts before an explicit verdict.
- **`definitionOfDone` = commands, never prose**: "it works" is grounds for refusing a delegation.
- **One adversarial stage on a model distinct from its target**: it destroys the diff, and never receives the implementer's own account of it.

## When to use it — and when not to

Use it for a multi-file change in an existing repository where "done" must be provable and the result must
survive hostile reading, and when you can answer framing questions up front.

Do **not** use it for a one-line fix or a spike: 9 roles, an interview and a gate are pure overhead. It is
not a security audit (use `audit`), decides no product or UX question, and wants a human twice — the pre-run
interview, and the push to a protected branch. With no image-capable model, `testeur` must be reported
UNAVAILABLE, never replaced by a text model: a blind tester returns verdicts that look valid.

## Install

Paste this into any agent with file access; the general spec and the other variants (local folder, publish
your own) are in [`../INSTALL-PROMPT.md`](../INSTALL-PROMPT.md):

```text
Install the kyber "dev-team" from https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/dev-team/kyber.yml — read https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/INSTALL.md and https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/main/kybers/CONVENTION.md in full first, show me every role prompt in full and the role → model table before writing anything, then wait for my explicit confirmation.
```

The installer must inspect your architecture, resolve `needs` against the models you actually have, show you
the prompts **before** writing, and record `provenance` with the URL and commit. Validate the file with
`node kybers/lint.cjs --dir=$PWD/kybers dev-team`.

## Known limitations

All are documented in the file's own comments; none is cosmetic.

1. **The AMEND cycle is prose-only**: `AMEND` sends work back to an earlier stage, and `inputs` citing a later stage is a validator error — "two AMEND cycles at most, never three" is an instruction only.
2. **The terminal human gate is declared, not enforced**: `livraison` carries `gate: true` for the push-to-main/staging validation. The validator accepts a
   terminal gate with a warning; no platform primitive makes it bind, so nothing mechanically stops a push.
3. **The root-stage fan-out is lost**: "N read-only scouts over disjoint areas" needs `forEach` on a stage with no `inputs`; it survives only in the mapper's prompt, so nothing bounds the count.
4. **`inputs` only adds, never subtracts**: the format cannot declare a removal of context. The anti-anchoring rule ("never receive the implementer's account")
   is in fact provided structurally — each `agent()` child is a fresh context, and in a measured probe a sibling given a sentinel answered `NO-ACCESS` — but
   nothing prevents the orchestrator from pasting the account into a downstream prompt, so the isolation is structural yet not guaranteed.
5. **Batch-content routing is undeclarable**: `implementeur` and `implementeur-expert` share one stage because the format has no conditional routing, so "critical batch → expert" is an instruction.
6. **The write-disjointness predicate is invented here**: `test -z "$(git diff --name-only | grep -v -E '<batch-paths>')"` is the only expression of "one writer per worktree", and it fails on legitimate writes outside the declared set (lockfiles, generated files) unless each spec lists them.
7. **No run-artifact contract, and no declared executables**: no field says where a stage writes its outputs, and the DoD floor silently assumes `make`, `pnpm`, `playwright`, `curl`, `jq` and `git`, which `tools:` cannot declare. `../README.md` records for `dev-team` the same single-level DoD and the absence of any stop or escalation mechanism: a run that should halt and ask a human cannot be halted.

## Verification status

**This kyber has never been executed.** It passes `kybers/lint.cjs` (PASS, plus the expected "`tier` is
unverifiable" warnings); its DoD entries are templates whose angle-bracket slots each batch's spec must fill,
and — unlike `audit` and `veille` — they have never been probed against fixtures. None of the four kybers in
this repository has been run end to end.
