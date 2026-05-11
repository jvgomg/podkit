---
id: US-26
title: Config migration friendliness
priority: P1
status: open
scope: in
theme: diagnostics-ux
last-updated: 2026-05-11
addressed-by:
  features: [sources-and-collections]
  principles: []
  open-questions: []
  spikes: []
---

# US-26 — Config migration friendliness

> When the config format changes, migrate my existing config without
> losing curation. Tell me what changed.

## Detail

The sources-and-collections rearchitecture is a breaking config change.
The user has invested in their current `[music.*]` / `[video.*]` setup
and doesn't want to lose it. The migration framework (doc-006) handles
the bump mechanically; the user-facing piece is:

- Clear summary of what changed when the migration runs.
- Round-trip preserves all selection intent that survives the new model.
- Explicit calls-out for anything that can't be auto-migrated (e.g., a
  video collection that needs splitting into TV and movies).
- Easy undo / dry-run.

## Acceptance signal

```
$ podkit migrate config
Detected config version 1 → 2 (sources & collections rearchitecture).

Auto-migrated:
  [music.main] (path) → [sources.main] + [devices.<default>] music.source = "main"
  ...

Manual review needed:
  [video.movies] → ambiguous content type.
  Original section preserved in config.bak; please specify either:
    [collections.<name>] content = "tv"
    [collections.<name>] content = "movies"

Dry-run: no changes written. Re-run with --apply to commit.
```

## Notes

The migration framework itself (doc-006) handles the version-bump
mechanics. This story is the UX wrapper: explanatory output, safe
defaults, dry-run, undo.
