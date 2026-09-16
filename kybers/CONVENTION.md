# CONVENTION — namespaces, reserved names, publication

**Normative document.** It freezes what must be true for a published kyber to be
findable, installable and non-spoofable. The words **MUST**, **MUST NOT**,
**SHOULD** are to be taken in the strict sense.

This document does not describe the *format* of a `kyber.yml` — that is `INSTALL.md`
§1 — nor the *procedure* for installing one — that is `INSTALL.md` §0 to §5.

Version of this convention: **2**, aligned with `specVersion: 2`.

### The spec applies to itself what it imposes on others

A kyber MUST declare `specVersion` and a `provenance` with a pinned **commit**. This
convention, and the documents that accompany it, MUST satisfy the same two rules.
Otherwise they are unpinnable: nothing says which version of the grammar a
`kyber.yml` published six months ago was validated against.

| Document | Versioned by |
|---|---|
| the format (`kyber.yml`) | `specVersion:` in each file |
| `CONVENTION.md`, `INSTALL.md`, `INSTALL-PROMPT.md` | the `SPEC-VERSION` heading in `CHANGELOG.md` (there is no separate artifact of that name) |
| `lint.cjs` | follows `SPEC_VERSION`, and its change MUST appear in the CHANGELOG |

**Any modification of these documents MUST be accompanied by an entry in
`CHANGELOG.md`** — including a wording fix. An installer that pins a commit must be
able to read what changed between that commit and today.

This section exists because a real installation test measured the opposite: during
its run, `CONVENTION.md` went from 181 to 405 lines and `lint.cjs` went through five
versions — **one of them broken**, `STAGE_FIELDS is not defined`, because the check
was written before the constant it uses. The installer had to freeze its report on a
timestamped state so as not to chase a moving target. A spec that moves faster than
its executors is not a spec, it is a draft.

---

## 1. The three namespaces

| Namespace | Location | Repository name | Who publishes |
|---|---|---|---|
| **Meta** | `github.com/kybernos/kybernos` | `kybernos` | the `kybernos` organization, and it alone |
| **Official** | `github.com/kybernos/kybernos-<name>` | `kybernos-<name>` | the `kybernos` organization |
| **Contributed** | `github.com/<author>/kybernos-contrib-<name>` | `kybernos-contrib-<name>` | anyone, without permission |

### Where the spec lives TODAY — read before fetching

That table describes the **target state**. It does not describe the current state, and
confusing the two makes an installation fail: a real test followed this document,
tried to fetch `github.com/kybernos/kybernos`, and got **404**.

| | Today | Eventually |
|---|---|---|
| Spec (this document, `INSTALL.md`, `lint.cjs`) | `github.com/platonai-net/llm-orchestrator-mcp/tree/main/kybers` | `github.com/kybernos/kybernos` |
| The 4 reference kybers (`audit`, `dev-team`, `veille`, `socratic`) | same repository, `kybers/<name>/` | each kyber in its own `kybernos-<name>` |

**An installation prompt MUST cite a URL that resolves**, therefore today's one.
The move to the `kybernos` organization is **break-free**: GitHub redirects renamed
repositories just as it redirects transferred ones, so a `provenance.url` pinned to
the old path keeps resolving. That is precisely why publishing early costs nothing.

The current location is a **workshop** in the sense of §8: several kybers in a
repository that is not named `kybernos-*`. That is legitimate for writing and testing,
and **invisible** to search by name. A kyber that turns out to be good must be
promoted into its own repository.

**The meta repository MUST NOT begin with `kybernos-`.** That is the rule that makes
everything else possible: it guarantees that the `kybernos-` pattern designates only
kybers, never tooling. A meta repository named `kybernos-mcp`, `kybernos-spec` or
`kybernos-core` would break discovery and **would have to be renamed**.

Corollary: if an existing tool already carries a `kybernos-` name, it MUST be renamed
or moved under the organization, otherwise every kyber search will surface it as a
permanent false positive.

### The `contrib-` prefix — the node-red precedent

The pattern retained is that of `node-red-contrib-<name>`: the core carries the exact
brand name, and everything coming from the community carries the infix `contrib-`.
The node-red reasoning applies here word for word.

**`kybernos-contrib-<name>` is therefore RETAINED for third-party kybers**, for a
reason that weighs more heavily than my own: **the name itself warns**. In an
ecosystem where a kyber is a set of executable instructions, the difference between
"reviewed by the maintainers" and "sent by a stranger" must be visible **before**
opening the repository. With a tier carried by the organization alone, the user has
to inspect the emitter to know. With `contrib-`, they read it in the name.

**The dot stays forbidden: `kybernos.app-contrib-<name>` is REJECTED.** The canonical
query is `q=kybernos- in:name`; `kybernos.app-contrib-audit` does not contain the
substring `kybernos-`, the dot breaks the pattern, and **no contributed repository
would be found**. `kybernos-contrib-audit`, for its part, does contain `kybernos-`
and passes the same query. **The `kybernos.app` domain serves the website, never
repository names.**

### Promotion of a contributed kyber

A contributed kyber that deserves to become official is **transferred** under the
organization and **renamed** `kybernos-contrib-<name>` → `kybernos-<name>`.

My first draft refused this rename on the grounds that it would break installed
`provenance.url`s. **That was wrong:** GitHub redirects renamed repositories too, not
only transferred ones. URLs already recorded keep resolving. The objection collapses,
and the `contrib-` prefix stays.

A single discovery query covers all three namespaces:

```
https://api.github.com/search/repositories?q=kybernos-+in:name&sort=stars&order=desc
```

It returns official **and** contributed. The tier is read in the name: presence of
`-contrib-` = third party.

**A contributed kyber MUST NOT pass itself off as official.** It MUST NOT use
`kybernos-<name>` without the infix — that is the only impersonation the convention must
make impossible, and it makes it visible at a glance.

## 2. Naming rule

A kyber repository MUST be called `kybernos-<name>` (official) or
`kybernos-contrib-<name>` (contributed, §1). No other form.

`<name>` MUST:

- be in `kebab-case`: ASCII lowercase letters, digits and single hyphens;
- be 2 to 40 characters long;
- neither begin nor end with a hyphen, and contain no double hyphen;
- not appear in the list of reserved names (§3);
- **be identical to the `id` field of the `kyber.yml` it contains** (§4);
- not begin with `contrib-`: the infix is reserved for the publication marker, and
  `kybernos-contrib-contrib-audit` makes no sense.

`<name>` MUST NOT contain a dot, an underscore, a space, an uppercase letter or a
non-ASCII character — even though GitHub accepts them. The convention is stricter than
the platform, deliberately: the repository name is an index key, not a title.

## 3. Reserved names

A kyber MUST NOT carry one of these names:

```
mcp  spec  format  schema  core  cli  lint  validate  install  init
search  registry  index  template  example  starter  boilerplate
official  docs  www  site  test  ci  sdk  lib
```

**Principle, more useful than the list:** any name that could be confused with the
spec or its tooling is reserved. The list above is the application of that principle,
not its replacement — an ambiguous name that is not listed SHOULD be refused in
review, and the list updated.

**Adding a reserved name is a breaking change.** A kyber published under a name that is
reserved afterwards becomes invalid without having changed. Any addition to this list
MUST therefore be accompanied by an increment of `specVersion`, and the installer MUST
report the already-installed kybers that this invalidates.

The check is **case-insensitive** and applies to the `id` field. The validator refuses
it.

## 4. `id` ↔ repository suffix binding — mandatory

The repository `kybernos-audit` MUST contain a `kyber.yml` whose `id` field is
`audit`. The repository `kybernos-contrib-audit` MUST contain `id: audit`, **and not
`contrib-audit`**.

**`contrib-` is a publication marker, not a part of the name.** It says who published
and at what trust tier; it is not part of the kyber's identity. The same kyber can go
from `kybernos-contrib-audit` (third party) to `kybernos-audit` (official) **without
its `id` changing** — its mission, its roles and its topology are identical, only its
status has moved. If `contrib-` entered the `id`, promotion would rename the kyber for
all its users, and the folder where it is installed would have to be renamed on every
machine.

Reading rule, without ambiguity:

| Repository name | Expected `id` |
|---|---|
| `kybernos-audit` | `audit` |
| `kybernos-contrib-audit` | `audit` |
| `kybernos-contrib-audit-v2` | `audit-v2` |

This is the most important rule in this document, because **everything else depends on
it**: discovery returns a repository name, and that name becomes the kyber's identity.
A `kybernos-audit` repository containing `id: audit-v2` makes the directory lie, and
the name installed locally no longer matches what was found.

The installer MUST refuse installation if the two differ, and say which of the two it
read.

## 5. Discovery

**The canonical query:**

```
https://api.github.com/search/repositories?q=kybernos-+in:name&sort=stars&order=desc
```

It works without authentication (low rate limit: cache, and authenticate as soon as
possible). It returns **candidates**.

**The name is only a hint. `kyber.yml` is the truth.** A repository can be called
`kybernos-*` without being a kyber — that is even the case for any homonymous
repository. The discovery pipeline is therefore:

```
search by name     →  candidates
                   →  presence of a kyber.yml at the root    (filter)
                   →  validation by lint.cjs                 (truth)
                   →  reserved names, id ↔ suffix binding    (conformance)
                   →  list to display to the human
```

None of these steps MUST be skipped, and **none MUST write to disk**. Discovery
produces a list; installation is a human decision (`INSTALL.md` §0).

### `provider`/`model` are hints. `needs` is the contract.

A published kyber records, per role, the binding its author resolved (`provider`,
`model`) and the requirement the role actually has (`needs`). Discovery MUST NOT read
the binding as a target or a recommendation for the installing platform: the same id
(`ollama-cloud/glm-5.3`) means nothing elsewhere, and an installer that copies it has
installed a name, not a capability.

The resolver on the installing platform MUST satisfy `needs`. It MAY bind a different
model, provided the chosen model satisfies `needs`; the declared binding is the
PREFERRED choice, used when it satisfies `needs` and no learned preference overrides it.
`INSTALL.md` §1 owns the field definition and states the hard case: where the platform
cannot MEASURE a need — no price, no latency, no throughput, hence no resolvable
`tier` — the hint becomes authoritative for that role and **no learning is possible for
it**. The publication tier of §6 says who published a kyber, never which model works on
your machine.

Consequence for memory: the unit of comparison is the **arm** — one role bound to one
model — never the kyber. Two runs of the same arm are comparable; learning happens by
comparing *different arms of the same role*. A kyber that declares one model per role
produces one arm per role, so at any sample size there is no alternative to compare
against and no routing decision can ever be demonstrated.

### What validation does not prove — two limits

`lint.cjs` proves the file's structure: `id` = folder, spec version, reachable roles,
no cycle, enum values, gates, non-empty `definitionOfDone`. It proves nothing about
execution, and it MUST NOT be reported as if it did.

`definitionOfDone` (the stage field, described in `INSTALL.md` §1) goes one step
further and no further: **a `PASS` proves the FORM of the contract, never its truth.**
Its commands check that files exist, markers are present, counts match and a status line
reads `200`. They cannot check that a quotation is faithful, that a receipt
`200 <sha256> …` attests a real fetch rather than asserting one, or that a human
answered an interview. **Observed** in a real run of `veille`: 15/15 commands passed
while no human was ever interviewed (2 of 10 answer lines read
`OPEN — no answer received`) and, on independent re-fetch, only 3 of 7 collection
receipts reproduced their `sha256`. A green validation and a green DoD are consistency,
not truth: a filter on shape, never evidence of content.

## 6. Trust tiers

The installer MUST display the tier, derived from the **name** (and not from the
organization alone, so that the tier is readable before opening the repository):

| Tier | Condition | Meaning |
|---|---|---|
| `official` | `kybernos-<name>`, under `github.com/kybernos/` | reviewed by the spec maintainers |
| `contributed` | `kybernos-contrib-<name>` | **no review**. Unverified instructions. |

Both conditions must be met for `official`: the name **and** the organization. A
third-party repository named `kybernos-audit` without the infix is an
**impersonation** — the installer MUST refuse to display it as official and MUST report
it as non-conformant (§1).

`official` MUST NOT be presented as "safe": it means *reviewed*, not *harmless*. In
both cases human review of the prompts remains mandatory, because a prompt is
executable code in natural language.

## 7. The two version axes — do not confuse them

| Axis | Where | Versions | Changes when |
|---|---|---|---|
| **Format** | `specVersion:` in `kyber.yml` | the grammar the file uses | the spec changes incompatibly |
| **Kyber** | repository tag (`v1.4.0`) | the roles, prompts and topology of *this* kyber | the author evolves their kyber |

A kyber MUST declare `specVersion` but MUST NOT put the kyber's version in a field of
`kyber.yml`: that is the repository tag's job. A `version:` field in the file would
recreate the confusion this section exists to avoid.

### Correction: "optional field" is not "safe addition"

My first draft said that adding an optional field is not a breaking change. **That is
false, and the counter-example arrived immediately.**

The criterion is not *mandatory or optional*, it is: **does the consumer's behavior
depend on this field?**

Take `gate: true` on a stage. The field is optional — absent, it says nothing. But a
consumer that ignores it **launches the next stage without waiting for validation**,
whereas a consumer that understands it waits. Both read the same file, produce
different results, and **the older one reports nothing**. That is exactly the failure
mode that forward-refusal exists to prevent, reintroduced through the compatibility
door.

Corrected rule:

| Type of addition | Breaking? |
|---|---|
| field that **changes behavior** at execution (`gate`, `cap`, `adversarial`, `elucidation`) | **YES** — increment `specVersion` |
| purely documentary field, with no effect at execution (`license`, `installHint`) | no |
| removal of an enum value, modified semantics | **YES** |

The test to apply before adding a field: *does a consumer that ignores it produce a
different result?* If yes, it is a breaking change.

## 8. What a kyber repository contains

```
kybernos-<name>/
├── kyber.yml     # MANDATORY — the spec, id == <name>
├── README.md     # MANDATORY — mission, roles, when to use it, when NOT to
├── LICENSE       # MANDATORY — without a license, nobody can use it
└── skills/       # optional — skills specific to this kyber
```

**A kyber repository MUST NOT contain a `memory/` folder.** Memory is local by
construction: it records what *your* runs learned about *your* models, at *your*
prices. On someone else's machine those scores are wrong, and harmful — they steer
routing towards models that have never been evaluated there.

**But the rule targets scores, not knowledge.** The distinction matters, and my
initial prohibition was too broad:

| | Publishable? | Why |
|---|---|---|
| `ledger.jsonl`, `routing.local.json` | **NO** | these are **local measurements**: they are only valid on the machine and the models that produced them. |
| `lessons.jsonl` | **YES, if general** | these are **facts about the world**: "such-and-such a model rejects an accented property in a schema" is true everywhere. |

A kyber published **with its general lessons** starts less cold for whoever installs
it. That is the only honest bootstrapping mechanism: you do not pass on what worked at
home, you pass on what you understood.

A publishable lesson **MUST NOT** cite a local model, a price, a machine path, or a
preference that only makes sense on one platform. The published file is called
`lessons.jsonl` and lives at the root of the repository, **never** in `memory/`.

It MUST NOT contain secrets, keys, `models.local.json` or `.env` either.

### One repository per kyber — but the workshop is free

The tree above is **one repository containing ONE kyber**. A repository containing
`kybers/a/`, `kybers/b/`, `kybers/c/` is not a distribution unit:

1. **Discovery cannot find it.** The query returns a repository **name**. A
   `kybernos-dev-team` repository containing four kybers names only one of them; the
   other three are invisible.
2. **The commit no longer designates a version of a kyber.** `provenance.commit` would
   record a commit that also touches three other kybers.
3. **Promotion is individual.** One kyber out of four becomes official: where does it
   go?
4. **One README and one LICENSE cannot describe four different missions** — and the
   license applies to the whole repository.
5. **A hostile contribution touches the repository of every** kyber it contains.

**But this rule is about distribution, not about the workshop.** Developing several
kybers in the same place is legitimate, and often desirable: you write them together,
you try them together, you compare them. Therefore:

| Step | Where | Is it a distribution unit? |
|---|---|---|
| writing, trying, comparing | anywhere: work repository, local folder, a project's `kybers/` | **no** |
| publication | one repository per kyber, `kybernos-<name>` | **yes** |

A workshop folder MUST NOT be referenced by an installation prompt intended for third
parties: it has no conformant name, therefore no identity, therefore no verifiable
provenance. You work there, then you **extract** each kyber into its own repository at
publication time.

### Content coming from a hosted service — copy, never link

A kyber can be built from skills, prompts or templates that live in a hosted service
(for example the kybernos backend). Two ways to integrate them, and only one is
compatible with this format:

| | **Copy** — the content is copied into the kyber at writing time | **Link** — the kyber fetches it at execution |
|---|---|---|
| Installable by copy-paste | yes | no: an API key is required |
| Works offline | yes | no |
| Self-contained | yes | no: if the service changes or disappears, the kyber dies |
| Up to date | no, it drifts | yes |
| Conformant with `INSTALL.md` §0 | yes | **no** |

**The format chooses copy.** Three reasons, in order:

1. **A kyber that requires an API key is not installable by pasting a prompt** — it
   loses exactly the property that makes it distributable.
2. **A prompt that says "go and fetch your instructions at this URL at execution time"
   is precisely what `INSTALL.md` §0 orders the installer to REFUSE.** A linked kyber
   would be rejected by our own security rule, and that is not a coincidence: it is
   the same dangerous property.
3. **Copied content is a responsibility, not a detail.** Publishing it commits its
   author.

**Mandatory consequence: copied content MUST be credited.** The `README.md` of a kyber
built from hosted content MUST name the source, its version or its copy date, and the
original license. The `provenance` of §10 names the author of the **kyber**; it says
nothing about the origin of the **content**, and it is up to the README to do so.

## 9. Publishing a contributed kyber

1. Name the repository `kybernos-contrib-<name>` (§2), under your account.
2. Check that `<name>` is not reserved (§3) and that `id` is exactly `<name>`,
   **without** the `contrib-` prefix (§4).
3. Validate locally: `node lint.cjs <name>` — MUST exit 0.
4. Add `README.md` and `LICENSE`. If the kyber reuses hosted content, the README MUST
   credit its source and its license (§8).
5. Do not commit `memory/`, nor a key, nor `.env` (§8).
6. Tag a version (`v1.0.0`).
7. Make the repository public, with a description containing `kyber`, the mission, and
   the word `contrib`.
8. The repository MUST be **extracted** from any workshop folder: a repository
   containing several kybers is not publishable (§8).

Installation by a third party references the **commit**, never the branch
(`INSTALL.md` §0).

## 10. Attribution — the viral cog

Without this section, the ecosystem does not spread, whatever the quality of the
naming convention. Publishing brings nothing to whoever wrote the kyber, so nobody
publishes, so there is nothing to discover.

**The rule.** A kyber installed from a repository MUST sign **the files it produces**.

```
— kyber audit · by @miled
  to install it: <one-line installation instruction>
```

**On what exactly — the criterion is the file, not the role.** A multi-agent kyber
produces a lot of intermediate output: if every role were asked to sign, you would get
six signatures for a single report, which is noise. The criterion retained is therefore
mechanical and unambiguous:

> **Every file written by the kyber as a deliverable ends with the signature line. A
> conversational output does not carry it.**

Three reasons to prefer this criterion:

1. **It is the file that gets shared.** The 34 KB report gets passed around; a chat
   reply does not circulate the same way. The signature goes where the artifact
   circulates.
2. **It avoids having to designate "the final role".** In a `pipeline` topology that is
   the last stage, in a `pool` it is undetermined, and in a loop it changes on every
   turn. Designating a role would be fragile; the file is not.
3. **It does not depend on the target platform.** A conversation does not have the same
   shape everywhere; a file does.

Three constraints, and each one has a reason:

1. **The signature is at the end of the file, never in the body.** One line. A kyber
   that scatters its attribution throughout its report is spam, and spam does not get
   shared — it gets blocked.
2. **It is derived from `provenance`, never written by hand.** `author` and `url` come
   from the installation record. An author who writes their signature into their
   prompts can make it lie; derivation keeps the signature consistent with the real
   origin.
3. **`provenance.author` is MANDATORY** as soon as `origin: repository`. The validator
   refuses otherwise.

**`installHint` — the loop closes here.** The `provenance.installHint` field contains
the instruction that lets the reader install **the kyber that has just produced the
document they are reading**.

**The hint pins a COMMIT, never a branch.** §0's reason applies to `installHint` word
for word: a branch moves, so a hint pointing at one stops designating what the author
installed the day the signature was written. The commit in the URL is the
`provenance.commit` recorded at installation; use it verbatim.

This is the most important point in this entire document. Without it, sharing a report
shares a result. With it, **sharing a report distributes the kyber**. Every shared
report is an installable invitation, and the person who follows it in turn becomes a
user who will produce shareable reports.

```
— kyber audit · by @miled
  to install it, paste this into your agent:
  https://raw.githubusercontent.com/platonai-net/llm-orchestrator-mcp/<commit>/kybers/INSTALL-PROMPT.md
```

`<commit>` is the full SHA from `provenance.commit` — **not** `main`, not a tag. The
same rule governs the `provenance.url` of §0 and the third-party installation of §9:
both reference the commit.

**Why this is not a vanity metric.** The signature produces a measurable and honest
effect: reading a report, you see who designed the team. It is the only quality signal
a reader has before installing, and it is a contributor's only reward. Both need the
same line.

**What attribution does not do.** It does not verify that the author is competent, nor
that the kyber is safe. It says who to talk to, nothing more.

## 11. What this document does not settle

These points are **open** and MUST NOT be assumed resolved:

- **The `kybernos` organization does not exist yet.** As long as it does not exist,
  there is neither a meta repository nor an `official` tier — only `contributed`
  candidates.
  The organization name itself is not reserved by this document.
- **No `search` / `install` command exists.** §5 describes the pipeline they will have
  to implement, not an available tool.
- **No curated directory.** GitHub search sorts by stars; that is not a judgement of
  quality.
- **Nothing on revocation.** If a published kyber turns out to be harmful, this
  document provides neither a blacklist nor an alerting mechanism. That is a real gap.
- **Nothing on updates.** A kyber installed from a commit does not signal that a newer
  version exists.

### Risks specific to viral distribution

- **The installation prompt depends on a spec URL that does not exist.** It does not
  work until the meta repository is published. Only the local variant is executable
  today.
- **The installer does not inject the signature yet.** §10 is specified and enforced by
  the validator, but nothing applies it at execution. Until that is done, sharing a
  report **does not distribute the kyber** — the loop stays open.
- **Cold start is the real risk.** A convention without a repository spreads nothing.
  The mechanics create no desire to share: they merely make sharing cheap. A few
  genuinely good kybers are needed first.
- **The loop selects for kybers that produce a deliverable.** A kyber that answers
  questions leaves nothing to share; a kyber that produces a report, a plan or an
  analysis does. That is not a defect, but it must steer what gets published first:
  artifact kybers, not answer kybers.
- **Copy-paste is in tension with security review.** `INSTALL.md` §0 requires a full
  human review of the prompts before writing, which is exactly what virality seeks to
  remove. The compromise retained — the agent *shows*, then the human *confirms* —
  preserves both, but it MUST be maintained. Any shortcut on that side turns the viral
  channel into a vector for blindly executing foreign prompts.
