---
id: TASK-435
title: sync --json emits multiple concatenated JSON objects for multi-collection runs
status: To Do
assignee: []
created_date: '2026-06-23 20:22'
labels:
  - sync
  - cli
  - json
  - bug
dependencies: []
references:
  - doc-049 - RFC-Playlist-Scoped-Subsonic-Collections.md
  - test-packages/e2e-tests/src/workflows/playlist-scoped-sync.docker.test.ts
priority: medium
ordinal: 180000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Pre-existing product defect surfaced by task-434.05 e2e work.**

`podkit sync --json` writes one JSON envelope per collection (per-collection result is emitted inside the collection loop) PLUS a final run-summary JSON object. When 2+ collections are processed — or when a collection fails — stdout receives multiple pretty-printed JSON objects concatenated back-to-back. `JSON.parse(stdout)` then fails for any machine consumer (CI tooling, the daemon, users piping to `jq`).

Surfaced because the 434.05 e2e test had to add a brace-depth `splitJsonObjects()` tokenizer to parse sync `--json` failure output. The playlist feature did not introduce this — it is general to multi-collection/failing `--json` syncs — but it makes the `--json` contract unreliable.

Likely sites (verify): the per-collection `out.json(result.jsonOutput)` call inside the sync collection loop (sync-collection-phase) and the run-summary `out.json({...})` at the end of `runSync` (sync.ts). A single well-formed top-level JSON document should be emitted (e.g. a run object with a `collections[]` array), not N concatenated objects.

This is a contract/design decision (what the canonical `sync --json` shape should be), so scope it before implementing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `podkit sync --json` emits exactly one parseable top-level JSON document regardless of collection count or success/failure
- [ ] #2 Per-collection results are nested (e.g. a `collections[]` array) within that single document
- [ ] #3 A multi-collection and a failing-collection sync both produce `JSON.parse`-able stdout
- [ ] #4 Existing consumers (daemon, e2e splitJsonObjects workaround) updated/removed accordingly
<!-- AC:END -->
