---
id: TASK-381
title: IpodAdapter portable-tag-write result type — doc-041 §3.2/Q4
status: To Do
assignee: []
created_date: '2026-06-03 09:09'
labels:
  - enhancement
  - save-transaction
  - ipod
  - error-handling
  - json-output
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/device/ipod-adapter.ts
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: low
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`doc-041 §3.2`: `IpodAdapter.save()` warns to stderr on tag-write failure, while `MassStorageAdapter.save()` throws `TagWriteError`. The asymmetry is principled (different sources of truth) but the warn is silent in the JSON output and discoverable only via stderr scraping.

## Scope

1. Change `IpodAdapter.save()` to return a typed result rather than `void` — `{ portableTagWarnings: string[] }`.
2. Surface those warnings in `SyncOutput` (the `--json` payload) so consumers can pin them.
3. CLI: render the warning count in the summary line (`"3 portable-tag writes failed (run with -vv for details)"`).
4. Keep the stderr warn as a fallback for CLI users not consuming JSON.

## Open question (Q4 in doc-041)

Should the typed result let CALLERS decide whether to throw? Today's CLI would still treat them as warnings; a daemon could choose to retry. Probably yes — keep it data, not flow.

## Reference

`doc-041` §3.2, Q4 in §8.
<!-- SECTION:DESCRIPTION:END -->
