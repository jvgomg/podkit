---
id: TASK-431.01
title: Raw dump tracer bullet (package scaffold + device archive --dump-only)
status: To Do
assignee: []
created_date: '2026-06-22 11:01'
labels:
  - feature
  - ipod
  - archive
  - cli
dependencies: []
references:
  - backlog/docs/doc-047 - PRD-iPod-Archive-Command-device-archive.md
parent_task_id: TASK-431
ordinal: 155000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First vertical slice. Scaffold the new leaf package `@podkit/ipod-archive` (build like `devices-ipod`: `bun build` + `tsc --emitDeclarationOnly`, turbo `build`) and wire a thin `podkit device archive` CLI subcommand supporting `--dump-only`. Implement `VolumeClassifier` (whitelist/junk/foreign), `RawDumper` (node:fs streaming copy hashing through node:crypto sha256, emitting `manifest.sha256`), output-dir naming `<deviceName>-<serial>-<timestamp>` with graceful degradation (serial → FireWireGUID → volume-label/timestamp), and `runDump` orchestrator.

Demoable: run against a real/dummy iPod → a read-only `raw dump/` mirror with manifest; macOS junk and foreign files skipped (not copied). Use node:fs streams only (no Bun.* APIs — CLI ships under Node via npm).

Spec: doc-047 (Stage 1 — raw dump; Packaging & boundaries).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `@podkit/ipod-archive` package builds and is depended on by podkit-cli
- [ ] #2 `podkit device archive --dump-only` produces a dump dir mirroring the iPod whitelist with a `manifest.sha256` verifiable by `shasum -c`
- [ ] #3 macOS junk (._*, .DS_Store, .Spotlight-V100, .fseventsd, .Trashes) and foreign files are skipped and recorded, not copied
- [ ] #4 Output dir named <deviceName>-<serial>-<timestamp>, degrading gracefully when serial absent
- [ ] #5 VolumeClassifier unit-tested (whitelist/junk/foreign incl. clean stock-iPod case); RawDumper integration-tested (manifest + failures-recorded)
- [ ] #6 No Bun.* runtime APIs used in shipped code
<!-- AC:END -->
