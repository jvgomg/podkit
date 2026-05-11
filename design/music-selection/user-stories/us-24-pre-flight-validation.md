---
id: US-24
title: Pre-flight validation
priority: P1
status: open
scope: in
theme: diagnostics-ux
last-updated: 2026-05-11
addressed-by:
  features: [selector-pipeline]
  principles: [runtime-mismatches-not-config-errors, source-capabilities]
  open-questions: []
  spikes: []
---

# US-24 — Pre-flight validation

> Before sync starts, tell me about config or data mismatches I can fix.
> Don't surface them four minutes in.

## Detail

Config gets stale: a playlist gets renamed, a source goes offline, a
filter references a genre that no longer matches anything. Currently the
user finds out only when the sync misbehaves. A pre-flight check should
catch these classes of issue up front, with actionable diagnostics.

## Acceptance signal

`podkit doctor` (or implicit pre-flight in `sync`):

```
✓ Source "navidrome" is reachable.
✓ Source "music-local" is readable.
⚠ Collection "commute" references playlist "Commute Mix" — not found
  in active source "navidrome". (Did you rename it?)
✓ Capacity check: device has 5.0 GB free; estimated sync 4.2 GB ±10%.
⚠ Device playlist "Sleep Sounds" missing from collection — will be
  removed on sync.
```

Actionable: each warning either suggests a fix or links to docs.

## Notes

Aligned with
[runtime-mismatches-not-config-errors](../principles/runtime-mismatches-not-config-errors.md):
mismatches are warnings, not blockers — but they should be surfaced
early.

The validator also uses
[source capabilities](../principles/source-capabilities.md) to detect
collection-vs-source incompatibilities (e.g., a collection wanting
playlists from a source that doesn't provide them).
