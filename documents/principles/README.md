---
title: Principles
description: The product- and behaviour-level promises podkit makes to a user's library — the "why" layer above ADRs and architecture.
sidebar:
  order: 0
---

The principles series. These docs capture the **behavioural promises podkit
makes to a user's music library** — the philosophy that many individual
decisions (ADRs) exist to honour.

Audience: contributors and AI agents. Like the architecture docs, these are
written once a promise is settled and evolve slowly. Unlike the architecture
docs, they describe *what podkit promises a user*, not *how a subsystem is
built*.

## Where this sits

podkit's design knowledge lives in four layers. Keep each in its lane and
**link, never duplicate**:

| Layer | Answers | Lives in |
|---|---|---|
| **Principles** (this series) | *Why* podkit behaves this way toward your library | `documents/principles/` |
| **ADRs** | *How we decided* to honour a principle, and the alternatives | `adr/` |
| **Architecture** | *How it is wired* in a given subsystem | `documents/architecture/` |
| **PRDs / journals** | In-flight thinking; what's proposed or still smelly | `backlog/docs/` |

A principle is the *why* behind many ADRs. An ADR cites the principle(s) it
serves; an architecture doc describes the mechanics that uphold them; a PRD
must conform to them. When a new ADR reveals a cross-cutting promise not yet
written down, **lift it here**.

Principles are **append-mostly**. *Changing* one is a significant, rippling
event — it can invalidate decisions across many ADRs — so it is done
deliberately, not in passing.

A principle states the promise even while a feature is still being brought
into line with it: principles are **normative** (the spec implementations must
meet), so they may describe a target state that a slice of in-flight work is
still realising. The realisation status lives in the ADRs and tasks, not in
the principle.

## What's here today

- **[library-safety](./library-safety.md)** — the codec-agnostic promises
  about how podkit treats your files and data: never silently degrade, settings
  are ceilings, no surprise re-encodes, destructive actions are explicit,
  visible-not-silent, idempotent, the source is truth.
- **[transfer-modes](./transfer-modes.md)** — what `fast` / `optimised` /
  `portable` each promise, as a metadata/artwork strategy relative to the
  device's storage.
- **[transcoding](./transcoding.md)** — the bitrate/codec axis: down-only
  reduction, convert vs preserve, the cap as a ceiling, the source-proximity
  tolerance, codec selection, and where codec efficiency does and does not
  apply.

## Related

- `adr/` — the decision log that implements these promises.
- `documents/architecture/` — the wiring that upholds them.
- `backlog/docs/doc-036` — Codec and Container Design Principles (the codec /
  container *type-model* specifics; referenced by [transcoding](./transcoding.md)).
