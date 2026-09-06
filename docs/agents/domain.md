# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

This repo is **single-context**: one root `CONTEXT.md`, one ADR directory. It is a
monorepo (`packages/*`, `test-packages/*`), but per-package subsystem knowledge already
lives in `docs/architecture/`, so there is deliberately no `CONTEXT-MAP.md`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Files are
  named `adr-NNN-<slug>.md`; `docs/adr/index.md` is the register.
- **`docs/architecture/`** — settled descriptions of how each subsystem is put
  together. Start at its `README.md`. The cross-cutting rules every package and PR must
  follow live in `docs/architecture/conventions.md`.
- **`docs/principles/`** — the *why* layer above ADRs: the behavioural promises podkit
  makes to a user's library. Read before changing user-facing sync or transcoding
  behaviour.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't
suggest creating them upfront. The `/domain-modeling` skill (reached via
`/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms
or decisions actually get resolved.

`CONTEXT.md` does not exist yet — that's expected.

## How the doc layers relate

Principles are the *why*; ADRs decide *how* to honour them; architecture docs *wire*
them; specs and PRDs must *conform*. Link between them, never duplicate. Two further
homes are distinct from all of the above and shouldn't absorb their content: the
rough-edges journals in `backlog/docs/doc-NNN-*.md` (a working catalogue of what's still
smelly) and the published user documentation in `packages/docs-site/`.

When a refactor changes a convention, update the relevant architecture doc in the same
PR.

## File structure

`docs/` is the internal documentation root — agents and contributors only, nothing in
it is published:

```
/
├── CONTEXT.md                      ← domain glossary (created lazily)
├── docs/
│   ├── agents/                     ← per-subsystem agent guides + skill config
│   ├── adr/                        ← decision log, frozen at decision time
│   ├── architecture/               ← how subsystems are wired, + conventions.md
│   ├── principles/                 ← behavioural promises
│   ├── formats/                    ← iPod database/format reference
│   └── sysinfo-captures/           ← captured hardware XML
├── packages/
│   └── docs-site/src/content/docs/ ← the published documentation site
└── test-packages/
```

`docs/agents/*.md` holds task-specific agent instructions — testing, libgpod-node,
releases, docker, and so on — indexed from `AGENTS.md`. Read the relevant one before
working in that area. Alongside them sit this file, `issue-tracker.md` and
`triage-labels.md`, which configure the engineering skills.

## Use the glossary's vocabulary

When your output names a domain concept (in a ticket title, a refactor proposal, a
hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to
synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're
inventing language the project doesn't use (reconsider) or there's a real gap (note it
for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently
overriding:

> _Contradicts ADR-009 (self-healing sync), but worth reopening because…_
