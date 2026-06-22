---
id: TASK-431.02
title: 'Spike: SQLite strategy (Bun-only CLI vs Node-safe driver)'
status: Done
assignee: []
created_date: '2026-06-22 11:02'
updated_date: '2026-06-22 13:26'
labels:
  - feature
  - ipod
  - archive
  - spike
  - hitl
dependencies: []
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
  - adr/adr-001-runtime.md
  - adr/adr-021-cli-bun-binary-distribution.md
parent_task_id: TASK-431
ordinal: 156000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
HITL spike. The `library.sqlite` deliverable forces a runtime decision because the npm-distributed CLI runs under Node (`#!/usr/bin/env node`, `bun build --target node`, ADR-001), ruling out `bun:sqlite` today. Investigate and recommend one of:

- **Branch A** — make the CLI a Bun-only binary (drop the npm/Node channel so it ships only as a `bun --compile` binary), unlocking `bun:sqlite`. This is an ADR-001 reversal — assess full blast radius: `npm i -g podkit` removal, install docs, release workflow, Docker, every consumer assumption.
- **Branch B** — keep dual-channel distribution and use a Node-safe driver: `better-sqlite3` (native; rides existing prebuild + compile.sh `.node` staging like libgpod-node/usb) or `sql.js` (pure wasm; no native build, ~1MB, in-memory then write).

Deliverable: a written recommendation (A vs B; if B, which driver) with evidence on build/distribution impact, cross-platform/musl prebuild burden, and single-file-binary bundling. Capture as an ADR or a decision note. **Blocks the SQLite catalogue subtask.**

Spec: doc-047 (SPIKE: SQLite strategy; CLI distribution & runtime).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Branch A blast radius assessed (npm removal, docs, release, Docker, ADR-001 impact)
- [x] #2 Branch B options evaluated: better-sqlite3 vs sql.js, incl. prebuild/musl burden and bun --compile bundling
- [x] #3 A single recommendation is made and recorded (ADR or decision note)
- [x] #4 Decision unblocks the LibraryDbWriter subtask
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Spike resolved. Reframed by project owner: ADR-001 conflated "we distribute on Node" with "every distributable is Node-runnable." Those are separable — libraries stay Node-compatible; the CLI is itself a consumer whose only deployment target is a Bun binary.

Branch A blast radius (AC#1): smaller than the PRD feared. Docker already COPYs prebuilt musl Bun binaries; releases/brew already ship `bun --compile` binaries. Dropping the npm CLI channel loses only `npm i -g podkit` / `npx podkit` + install-doc references. No effect on Docker/release/brew pipelines. Not a full ADR-001 reversal — a refinement of its distribution clause.

Branch B evaluation (AC#2): better-sqlite3 = native addon, rides existing `.node` staging (one `compile.sh` line like `usb`) BUT adds a 3rd native dep to the prebuild matrix and has no upstream musl prebuilds → build-from-source on Alpine. sql.js = pure wasm, runtime-agnostic, zero native, but needs a ~1MB wasm bundled into the binary + whole-DB-in-memory. Neither needed once the CLI is accepted as Bun-only.

Decision (AC#3): Option A. CLI ships only as a Bun `--compile` binary; `@podkit/ipod-archive` is an explicitly Bun-targeted leaf using built-in `bun:sqlite` (zero dep, no native, no wasm, no musl concern). Bun coupling confined to two artifacts: the CLI binary and `@podkit/ipod-archive`. Recorded as ADR-021; ADR-001 status updated to Accepted (refined by ADR-021).

Unblocks LibraryDbWriter (AC#4): TASK-431.06 uses `bun:sqlite`. Mechanical CLI-to-Bun-only conversion tracked separately as TASK-431.10 (does not block LibraryDbWriter — the compiled-binary path already runs Bun)."
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
**Outcome: Branch A (refined) — CLI ships as a Bun binary only; `@podkit/ipod-archive` uses `bun:sqlite`.**

The driver question dissolved once the runtime intent was clarified: libraries (`@podkit/core` + all `@podkit/*`) stay Node-compatible for future Node consumers, while the CLI is a consumer whose sole deployment target is a Bun `--compile` binary. Dropping the largely-vestigial npm CLI channel unlocks the built-in `bun:sqlite` — zero dependency, no native staging, no wasm payload, no musl/glibc/arch matrix entry — which is strictly simpler than both Branch B drivers (better-sqlite3's native+musl burden, sql.js's wasm bundle).

Recorded in **ADR-021** (CLI Distributes as a Bun Binary Only); ADR-001 refined. Docs aligned: building-from-source, roadmap, releases, AGENTS, feature-requests. LibraryDbWriter (TASK-431.06) is unblocked and uses `bun:sqlite`. Mechanical CLI conversion tracked as **TASK-431.10**.
<!-- SECTION:FINAL_SUMMARY:END -->
