---
title: "ADR-025: Canonical Test Taxonomy — Depth × Surface, No Tier Numbers"
description: Retire the colliding "Tier N" testing vocabularies. Classify every test on two orthogonal axes — Depth (Unit/Integration/E2E) and, for E2E, Surface (Runtime × Source × Device). Numbers are removed from the testing domain because they cross-cut depth and collided across subsystems.
sidebar:
  order: 26
---

# ADR-025: Canonical Test Taxonomy — Depth × Surface, No Tier Numbers

## Status

**Accepted** (2026-07-12)

Establishes the vocabulary documented in
[documents/architecture/testing/taxonomy.md](/developers/architecture/testing/taxonomy).
Re-labels the "five tiers" of **doc-053 (podkit-docker testing strategy)**
and the "Tier-3" alias introduced by
[ADR-016](/developers/adr/adr-016-linux-vm-test-harness). ADR-016 is left
frozen (decision records are not rewritten); this ADR supersedes only its
*naming*, not its architecture.

## Context

The word "tier" had accreted at least seven independent meanings in the
repository, two of them competing **numbered** testing vocabularies:

- **doc-053** defined a Docker testing strategy as **Tier 1–5**: (1)
  daemon unit, (2) entrypoint bats, (3) image smoke, (4) loopback, (5)
  image + USB in the VM. Cost-ordered.
- **ADR-016 / vm-testing.md** defined the classic pyramid Unit →
  Integration → E2E, and aliased the VM e2e layer **"Tier-3"**.

These collided head-on. "**Tier 3**" meant *image smoke* (doc-053),
*VM e2e* (ADR-016), and — in unrelated domains — a Docker
`--device-cgroup-rule` privilege mode (task-165). "Tier 1" and "Tier 2"
collided across the same three axes. A gap analysis or a task titled
"add a Tier 3 test" was irreducibly ambiguous.

The root cause is not "two schemes" but a **category error**: doc-053's
numbers cross-cut test *depth*. Its Tier 1 is a Unit test; its Tier 5 is
an E2E test. Numbering a value that is really two orthogonal
properties (how deep, and on what surface) guarantees that any second
axis will collide with the first.

## Decision drivers

- **One label, one meaning.** A test's classification must be
  unambiguous and legible without tribal knowledge.
- **Fix the category error, don't rename around it.** Namespacing the
  numbers (D1–D5) would remove the string collision but preserve the
  conceptual muddle (a "D1" that is really a unit test).
- **Match reality already in the tree.** File suffixes already encode
  depth; `e2e-vm-tests` already foldered off a non-default surface
  (`docker-dist/`). The scheme should ratify existing structure, not
  fight it.
- **Make gaps visible.** The classification should double as a coverage
  map — an empty cell is a missing test.
- **Bounded blast radius.** Reserve the change to the *testing* axes;
  leave the unrelated domain "tiers" (device access, verification,
  quality, privilege) alone beyond a disambiguating note.

## Decision

### 1. Two orthogonal axes

- **Depth** (every test): `Unit` → `Integration` → `E2E`.
- **Surface** (E2E only): a triple **Runtime × Source × Device** —
  Runtime ∈ {`host-binary`, `host-docker-image`, `vm-binary`,
  `vm-docker-image`}, Source ∈ {`local-dir`, `docker-sidecar`}, Device ∈
  {`none`, `dir`, `loopback-fat`, `usb-synth`}.

### 2. No "Tier N" in the testing domain

Numbers are removed. doc-053's Tier 1–5 and the VM "Tier-3" alias are
re-expressed as (Depth, Surface) coordinates
([taxonomy §8](/developers/architecture/testing/taxonomy)). doc-053
keeps its role as the Docker-vertical *strategy/rollout* narrative but no
longer owns a numbering.

### 3. Depth by suffix, Surface by directory

Depth stays suffix-encoded (`.integration.`, `.perf.`, `.e2e.`, bare).
Surface is directory-encoded under the rule: **the default surface for a
package lives at the package root (in its feature directories); every
non-default surface gets a subdirectory** — ratifying the existing
`docker-dist/` precedent.

### 4. "Tier" survives only for non-testing domains

Device access (`syncable`/`read-only`/`none`), `device add` verification
(`verify`/`trust-disk`/`config-inject`), and quality presets are
legitimate uses of the word and are untouched. The task-165 Docker
privilege "Tier 1–4" numbering is dead vocabulary and is not revived.

## Alternatives considered

- **Namespaced numbered ladders (docker = D1–D5, pyramid stays
  named).** Lowest churn; kills the string collision. Rejected: leaves
  the category error intact — "D1" is still a unit test wearing a
  strategy number, and the two axes remain fused.
- **Single unified 1–N ladder** (1 Unit … 5 vm-usb). Rejected: forces
  the Docker and device verticals onto one false linear cost order,
  renumbers every task and doc, and re-bakes the number-cross-cuts-depth
  confusion permanently.

## Consequences

- **Positive.** Every test is classifiable and its infrastructure cost
  legible from its path. The coverage grid surfaces real gaps (e.g. no
  `docker-sidecar` source is ever synced to a `usb-synth` device).
  Adding an infrastructure combination is a new cell, not a contested
  number.
- **Cost.** A one-time migration: move the ~8 host `*.docker.test.ts`
  files (today scattered under the feature dirs) into `docker-source/`,
  rename `docker-dist/` → `vm-docker/`, re-key the affected `test:e2e*`
  globs, and update the prose in doc-053, vm-testing.md, and
  agents/testing.md. Existing task titles ("Test Tier N", TASK-447–451)
  are left as historical record; the two open tasks (task-450, TASK-463)
  are reframed to the canonical coordinates.
- **Neutral.** Normalising `e2e-tests`' bare `*.test.ts` files to the
  `.e2e.` suffix is deferred — a wide mechanical rename with consistency
  as its only payoff, tracked separately rather than bundled here.

## References

- [documents/architecture/testing/taxonomy.md](/developers/architecture/testing/taxonomy) — the vocabulary this ADR ratifies.
- [ADR-016](/developers/adr/adr-016-linux-vm-test-harness) — the "three-tier" harness architecture whose *naming* this supersedes.
- doc-053 (podkit-docker testing strategy) — the Docker-vertical rollout, re-labelled to canonical coordinates.
